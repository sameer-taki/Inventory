"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string } | undefined;

function s(v: FormDataEntryValue | null): string | null {
  const t = v ? String(v).trim() : "";
  return t.length ? t : null;
}
function n(v: FormDataEntryValue | null): number | null {
  const t = v ? String(v).trim() : "";
  if (!t.length) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
function row<T>(d: unknown): T {
  return (Array.isArray(d) ? d[0] : d) as T;
}

// ── Planning (MRP) ─────────────────────────────────────────────────────────
export async function runMrpAction(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("mfg")
    .rpc("run_mrp", { p_horizon_days: 120, p_run_type: "regenerative" });
  if (error) throw new Error(error.message);
  revalidatePath("/manufacturing/planning");
  redirect("/manufacturing/planning");
}

export async function firmPlannedOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("planned_order_id"));
  if (!id) return { error: "Missing planned order." };
  const supabase = await createClient();
  const { error } = await supabase
    .schema("mfg")
    .rpc("firm_planned_order", { p_planned_order_id: id });
  if (error) return { error: error.message };
  revalidatePath("/manufacturing/planning");
  return {};
}

// ── MPS ─────────────────────────────────────────────────────────────────────
export async function saveMpsEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const itemId = n(formData.get("item_id"));
  const plant = s(formData.get("plant"));
  const bucket = s(formData.get("bucket_start"));
  const qty = n(formData.get("qty"));
  const kind = s(formData.get("kind"));
  if (!itemId || !plant || !bucket || qty === null || !kind) {
    return { error: "Item, plant, bucket start, quantity and kind are required." };
  }
  const supabase = await createClient();
  const { error } = await supabase.schema("mfg").rpc("save_mps_entry", {
    p_item_id: itemId,
    p_plant: plant,
    p_bucket_start: bucket,
    p_qty: qty,
    p_kind: kind,
  });
  if (error) return { error: error.message };
  revalidatePath("/manufacturing/mps");
  return {};
}

export async function actionMessageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("action_id"));
  const to = s(formData.get("to_status"));
  if (!id || !to) return { error: "Missing action message or status." };
  const supabase = await createClient();
  const { error } = await supabase
    .schema("mfg")
    .rpc("action_message_transition", { p_action_id: id, p_to_status: to });
  if (error) return { error: error.message };
  revalidatePath("/manufacturing/planning");
  return {};
}

// ── Work centres ────────────────────────────────────────────────────────────
export async function createWorkCentreAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = s(formData.get("code"));
  const name = s(formData.get("name"));
  const plant = s(formData.get("plant"));
  if (!code || !name || !plant)
    return { error: "Code, name and plant are required." };
  const supabase = await createClient();
  const { error } = await supabase.schema("mfg").rpc("save_work_centre", {
    p_code: code,
    p_name: name,
    p_plant: plant,
    p_daily_capacity: n(formData.get("daily_capacity")) ?? 0,
    p_efficiency_pct: n(formData.get("efficiency_pct")) ?? 100,
    p_labour_rate: n(formData.get("labour_rate")),
  });
  if (error) return { error: error.message };
  revalidatePath("/manufacturing/work-centres");
  redirect("/manufacturing/work-centres");
}

// ── Routings ────────────────────────────────────────────────────────────────
export async function createRoutingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const itemId = n(formData.get("item_id"));
  const effectiveFrom = s(formData.get("effective_from"));
  const opsRaw = s(formData.get("operations"));
  if (!itemId || !effectiveFrom) return { error: "Item and effective-from are required." };
  let operations: unknown;
  try {
    operations = JSON.parse(opsRaw ?? "[]");
  } catch {
    return { error: "Operations are malformed." };
  }
  if (!Array.isArray(operations) || operations.length === 0)
    return { error: "Add at least one operation." };

  const supabase = await createClient();
  const { data, error } = await supabase.schema("mfg").rpc("create_routing", {
    p_item_id: itemId,
    p_effective_from: effectiveFrom,
    p_operations: operations,
  });
  if (error) return { error: error.message };
  const r = row<{ routing_id: number }>(data);
  revalidatePath("/manufacturing/routings");
  redirect(`/manufacturing/routings/${r.routing_id}`);
}

export async function approveRoutingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("routing_id"));
  if (!id) return { error: "Missing routing." };
  const supabase = await createClient();
  const { error } = await supabase.schema("mfg").rpc("approve_routing", { p_routing_id: id });
  if (error) return { error: error.message };
  revalidatePath("/manufacturing/routings");
  revalidatePath(`/manufacturing/routings/${id}`);
  return {};
}

// ── BOMs ──────────────────────────────────────────────────────────────────
export async function createBomAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const itemId = n(formData.get("item_id"));
  const effectiveFrom = s(formData.get("effective_from"));
  const linesRaw = s(formData.get("lines"));
  if (!itemId || !effectiveFrom) return { error: "Item and effective-from are required." };
  let lines: unknown;
  try {
    lines = JSON.parse(linesRaw ?? "[]");
  } catch {
    return { error: "Component lines are malformed." };
  }
  if (!Array.isArray(lines) || lines.length === 0)
    return { error: "Add at least one component line." };

  const supabase = await createClient();
  const { data, error } = await supabase.schema("mfg").rpc("create_bom", {
    p_item_id: itemId,
    p_effective_from: effectiveFrom,
    p_lines: lines,
  });
  if (error) return { error: error.message };
  const bom = row<{ bom_id: number }>(data);
  revalidatePath("/manufacturing/boms");
  redirect(`/manufacturing/boms?created=${bom.bom_id}`);
}

export async function approveBomAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("bom_id"));
  if (!id) return { error: "Missing BOM." };
  const supabase = await createClient();
  const { error } = await supabase.schema("mfg").rpc("approve_bom", { p_bom_id: id });
  if (error) return { error: error.message };
  revalidatePath("/manufacturing/boms");
  return {};
}

// ── Production orders ────────────────────────────────────────────────────────
export async function createProductionOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const itemId = n(formData.get("item_id"));
  const bomId = n(formData.get("bom_id"));
  const plant = s(formData.get("plant"));
  const qty = n(formData.get("qty"));
  const uom = s(formData.get("uom"));
  const dueDate = s(formData.get("due_date"));
  if (!itemId || !bomId || !plant || !qty || !uom || !dueDate)
    return { error: "Item, BOM, plant, quantity, UoM and due date are required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("mfg")
    .rpc("create_production_order", {
      p_item_id: itemId,
      p_bom_id: bomId,
      p_plant: plant,
      p_qty: qty,
      p_uom: uom,
      p_due_date: dueDate,
      p_routing_id: n(formData.get("routing_id")),
    });
  if (error) return { error: error.message };
  const po = row<{ production_order_id: number }>(data);
  revalidatePath("/manufacturing/production");
  redirect(`/manufacturing/production/${po.production_order_id}`);
}

export async function transitionProductionOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("po_id"));
  const to = s(formData.get("to_status"));
  if (!id || !to) return { error: "Missing order or target status." };
  const supabase = await createClient();
  const { error } = await supabase
    .schema("mfg")
    .rpc("transition_production_order", { p_po_id: id, p_to_status: to });
  if (error) return { error: error.message };
  revalidatePath(`/manufacturing/production/${id}`);
  return {};
}

export async function postCompletionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("po_id"));
  const qtyGood = n(formData.get("qty_good"));
  const qtyScrap = n(formData.get("qty_scrap")) ?? 0;
  const location = s(formData.get("bc_location"));
  const outputLot = s(formData.get("output_lot_no"));
  const consumptionRaw = s(formData.get("consumption"));
  if (!id || qtyGood === null || !location)
    return { error: "Quantity produced and BC location are required." };
  let consumption: unknown;
  try {
    consumption = JSON.parse(consumptionRaw ?? "[]");
  } catch {
    return { error: "Consumption lines are malformed." };
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("mfg").rpc("post_completion", {
    p_po_id: id,
    p_qty_good: qtyGood,
    p_qty_scrap: qtyScrap,
    p_consumption: consumption,
    p_bc_location: location,
    p_output_lot_no: outputLot,
  });
  if (error) return { error: error.message };
  revalidatePath(`/manufacturing/production/${id}`);
  return {};
}
