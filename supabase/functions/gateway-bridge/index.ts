// ============================================================================
// gateway-bridge — the single writer's delivery worker (Platform P2 / MFG I2)
// ----------------------------------------------------------------------------
// Drains ops.integration_outbox and delivers each row to Business Central over
// OData, then finalises atomically via ops.outbox_mark_sent / _mark_failed.
// Nothing else writes to BC; app code only ENQUEUES rows (see mfg.post_completion).
//
// Runs on Supabase Edge (Deno). Invoke on a schedule (pg_cron / Supabase
// scheduled functions) or by HTTP. See supabase/functions/gateway-bridge/README.md.
//
// Modes:
//   • dry-run (default, and whenever BC_ODATA_URL is unset, or ?dryRun=true):
//     read-only — reports what WOULD be delivered, mutates nothing. Safe to
//     expose; lets you wire scheduling before BC connectivity exists.
//   • deliver (BC_ODATA_URL set): posts each row to BC; requires the
//     x-bridge-secret header to match BRIDGE_SECRET.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected by the runtime)
//   BC_ODATA_URL      BC OData endpoint that creates the posting document
//   BC_ODATA_AUTH     Authorization header value for BC (e.g. "Basic ..." )
//   BRIDGE_SECRET     shared secret required to run in deliver mode
//   BRIDGE_BATCH      rows per invocation (default 20)
//   BRIDGE_MAX_ATTEMPTS  attempts before a row is marked dead (default 5)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BC_ODATA_URL = Deno.env.get("BC_ODATA_URL") ?? "";
const BC_ODATA_AUTH = Deno.env.get("BC_ODATA_AUTH") ?? "";
const BRIDGE_SECRET = Deno.env.get("BRIDGE_SECRET") ?? "";
const BATCH = Number(Deno.env.get("BRIDGE_BATCH") ?? "20");
const MAX_ATTEMPTS = Number(Deno.env.get("BRIDGE_MAX_ATTEMPTS") ?? "5");

type OutboxRow = {
  outbox_id: number;
  aggregate_type: string;
  aggregate_id: number;
  event_type: string;
  target_system: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Resolve canonical item_ids -> BC item numbers via ops.external_refs (I10). */
async function resolveBcItems(itemIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const ids = Array.from(new Set(itemIds.filter((x) => Number.isFinite(x))));
  if (!ids.length) return map;
  const { data } = await sb
    .schema("ops")
    .from("external_refs")
    .select("entity_id, external_id")
    .eq("entity_type", "ops.item")
    .eq("system", "bc")
    .in("entity_id", ids);
  for (const r of data ?? []) map.set(r.entity_id as number, r.external_id as string);
  return map;
}

/**
 * Build the BC posting document from an outbox row.
 * NOTE: field names below are the D-3 CONTRACT STUB (BC Assembly Order). Confirm
 * them against the real BC OData metadata before enabling deliver mode — the
 * shape is intentionally isolated here so only this function changes.
 */
async function buildBcDocument(row: OutboxRow): Promise<Record<string, unknown>> {
  if (row.aggregate_type === "mfg.completion") {
    const p = row.payload as {
      production_order_no: string;
      output_item_id: number;
      qty_good: number;
      output_lot_no?: string;
      location?: string;
      posting_date?: string;
      consumption?: Array<{ component_item_id: number; qty: number; uom: string; lot_no?: string }>;
    };
    const items = await resolveBcItems([
      p.output_item_id,
      ...(p.consumption ?? []).map((c) => c.component_item_id),
    ]);
    const outputBcNo = items.get(p.output_item_id);
    if (!outputBcNo) throw new Error(`output item ${p.output_item_id} has no BC mapping (I10)`);

    return {
      // — BC Assembly Order header (contract stub) —
      Item_No: outputBcNo,
      Quantity: p.qty_good,
      Location_Code: p.location ?? null,
      Posting_Date: p.posting_date ?? null,
      External_Document_No: p.production_order_no,
      Lot_No: p.output_lot_no ?? null,
      // — component (material) lines —
      Components: (p.consumption ?? []).map((c) => {
        const bcNo = items.get(c.component_item_id);
        if (!bcNo) throw new Error(`component ${c.component_item_id} has no BC mapping (I10)`);
        return { Item_No: bcNo, Quantity: c.qty, Unit_of_Measure: c.uom, Lot_No: c.lot_no ?? null };
      }),
    };
  }
  // other aggregate types get a generic passthrough until their contract lands
  return { event_type: row.event_type, payload: row.payload };
}

async function postToBc(row: OutboxRow): Promise<string> {
  const doc = await buildBcDocument(row);
  const res = await fetch(BC_ODATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(BC_ODATA_AUTH ? { authorization: BC_ODATA_AUTH } : {}),
      // idempotency: BC should treat a repeated key as the same document
      "x-idempotency-key": row.idempotency_key,
    },
    body: JSON.stringify(doc),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`BC ${res.status}: ${text.slice(0, 300)}`);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* BC returned non-JSON; fall back to the idempotency key as the ref */
  }
  return (
    (parsed.No as string) ??
    (parsed.Document_No as string) ??
    (parsed.id as string) ??
    row.idempotency_key
  );
}

Deno.serve(async (req) => {
  const dryRun = !BC_ODATA_URL || new URL(req.url).searchParams.get("dryRun") === "true";

  // deliver mode requires the shared secret
  if (!dryRun && BRIDGE_SECRET && req.headers.get("x-bridge-secret") !== BRIDGE_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const { data: rows, error } = await sb
    .schema("ops")
    .from("integration_outbox")
    .select(
      "outbox_id, aggregate_type, aggregate_id, event_type, target_system, idempotency_key, payload, attempts",
    )
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH)
    .returns<OutboxRow[]>();

  if (error) return json({ error: error.message }, 500);
  const batch = rows ?? [];

  if (dryRun) {
    return json({
      mode: "dry-run",
      reason: BC_ODATA_URL ? "dryRun=true" : "BC_ODATA_URL not set",
      would_deliver: batch.length,
      rows: batch.map((r) => ({
        outbox_id: r.outbox_id,
        aggregate: `${r.aggregate_type}#${r.aggregate_id}`,
        event_type: r.event_type,
        idempotency_key: r.idempotency_key,
      })),
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const r of batch) {
    try {
      const docNo = await postToBc(r);
      const { error: e } = await sb
        .schema("ops")
        .rpc("outbox_mark_sent", { p_outbox_id: r.outbox_id, p_external_ref_no: docNo });
      if (e) throw new Error(`mark_sent failed: ${e.message}`);
      results.push({ outbox_id: r.outbox_id, status: "sent", bc: docNo });
    } catch (err) {
      const dead = (r.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
      await sb.schema("ops").rpc("outbox_mark_failed", {
        p_outbox_id: r.outbox_id,
        p_error: String(err).slice(0, 500),
        p_dead: dead,
      });
      results.push({ outbox_id: r.outbox_id, status: dead ? "dead" : "failed", error: String(err) });
    }
  }
  return json({ mode: "deliver", processed: results.length, results });
});
