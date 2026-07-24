import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { runMrpAction } from "../actions";
import { FirmButton } from "./FirmButton";
import { ActionMessageButtons } from "./ActionMessageButtons";

export const dynamic = "force-dynamic";

type Run = {
  mrp_run_id: number;
  run_type: string;
  snapshot_at: string;
  started_at: string;
  finished_at: string | null;
  status: string;
};
type Planned = {
  planned_order_id: number;
  item_id: number;
  kind: string;
  qty: number;
  due_date: string;
  release_date: string;
  status: string;
};
type Action = {
  action_id: number;
  kind: string;
  target_type: string;
  target_ref: string;
  detail: Record<string, unknown>;
  status: string;
};
type Projection = {
  item_id: number;
  seq: number;
  bucket_date: string;
  event_type: string;
  qty: number;
  projected_available: number;
};

type Peg = {
  planned_order_id: number;
  demand_date: string;
  source_type: string;
  parent_item_id: number | null;
};

const EVENT_LABEL: Record<string, string> = {
  opening: "Opening (net of safety)",
  scheduled_receipt: "Scheduled receipt",
  planned_receipt: "Planned receipt",
  gross_req: "Gross requirement",
};

export default async function PlanningPage() {
  const supabase = await createClient();

  const { data: run } = await supabase
    .schema("mfg")
    .from("mrp_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<Run>();

  let planned: Planned[] = [];
  let actions: Action[] = [];
  let projection: Projection[] = [];
  let pegs: Peg[] = [];
  let itemMap = new Map<number, string>();

  if (run) {
    const [{ data: po }, { data: am }, { data: proj }, { data: pg }, { data: items }] = await Promise.all([
      supabase
        .schema("mfg")
        .from("planned_orders")
        .select("planned_order_id, item_id, kind, qty, due_date, release_date, status")
        .eq("mrp_run_id", run.mrp_run_id)
        .order("release_date")
        .returns<Planned[]>(),
      supabase
        .schema("mfg")
        .from("action_messages")
        .select("action_id, kind, target_type, target_ref, detail, status")
        .eq("mrp_run_id", run.mrp_run_id)
        .returns<Action[]>(),
      supabase
        .schema("mfg")
        .from("mrp_projection")
        .select("item_id, seq, bucket_date, event_type, qty, projected_available")
        .eq("mrp_run_id", run.mrp_run_id)
        .order("item_id")
        .order("seq")
        .returns<Projection[]>(),
      supabase
        .schema("mfg")
        .from("v_pegging")
        .select("planned_order_id, demand_date, source_type, parent_item_id")
        .eq("mrp_run_id", run.mrp_run_id)
        .returns<Peg[]>(),
      supabase
        .schema("ops")
        .from("items")
        .select("item_id, item_no")
        .returns<{ item_id: number; item_no: string }[]>(),
    ]);
    planned = po ?? [];
    actions = am ?? [];
    projection = proj ?? [];
    pegs = pg ?? [];
    itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));
  }
  const pegMap = new Map(pegs.map((p) => [p.planned_order_id, p]));

  // group the time-phased ledger by item
  const projByItem = new Map<number, Projection[]>();
  for (const p of projection) {
    const arr = projByItem.get(p.item_id) ?? [];
    arr.push(p);
    projByItem.set(p.item_id, arr);
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Planning — MRP
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Regenerative, deterministic netting (I4). Planner reviews and firms
            every suggested order; nothing is auto-ordered.
          </p>
        </div>
        <form action={runMrpAction}>
          <button type="submit" className="btn-primary">
            Run MRP
          </button>
        </form>
      </div>

      {!run ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          No MRP run yet. Click <span className="font-medium">Run MRP</span> to
          net demand against supply.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-500">
            <span>
              Run <span className="font-mono">#{run.mrp_run_id}</span>
            </span>
            <span>type {run.run_type}</span>
            <span>snapshot {fmtDateTime(run.snapshot_at)}</span>
            <StatusBadge value={run.status === "succeeded" ? "renewed" : run.status} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="card overflow-hidden lg:col-span-2">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
                Planned orders ({planned.length})
              </div>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Kind</th>
                    <th className="px-4 py-2">Qty</th>
                    <th className="px-4 py-2">Pegged to</th>
                    <th className="px-4 py-2">Release</th>
                    <th className="px-4 py-2">Due</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {planned.length > 0 ? (
                    planned.map((p) => (
                      <tr key={p.planned_order_id}>
                        <td className="px-4 py-2 font-medium text-slate-700">
                          {itemMap.get(p.item_id) ?? p.item_id}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              p.kind === "make"
                                ? "bg-gold-100 text-gold-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {p.kind}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-700">{p.qty}</td>
                        <td className="px-4 py-2 text-slate-500">
                          {(() => {
                            const peg = pegMap.get(p.planned_order_id);
                            if (!peg) return <span className="text-slate-300">—</span>;
                            return peg.source_type === "mps" ? (
                              <span className="text-slate-600">MPS · {fmtDate(peg.demand_date)}</span>
                            ) : (
                              <span className="text-slate-600">
                                {itemMap.get(peg.parent_item_id ?? -1) ?? `#${peg.parent_item_id}`}{" "}
                                <span className="text-slate-400">order</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2 text-slate-500">
                          {fmtDate(p.release_date)}
                        </td>
                        <td className="px-4 py-2 text-slate-500">
                          {fmtDate(p.due_date)}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge value={p.status === "suggested" ? "open" : p.status} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {p.status === "suggested" && (
                            <FirmButton plannedOrderId={p.planned_order_id} />
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                        No shortages — nothing to plan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                Action messages ({actions.length})
              </h2>
              {actions.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {actions.map((a) => (
                    <li key={a.action_id} className="rounded-md bg-amber-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-medium text-amber-800">
                            {titleCase(a.kind)}
                          </span>{" "}
                          <span className="text-amber-700">
                            {a.target_type.replace(/_/g, " ")} {a.target_ref}
                          </span>
                        </span>
                        <StatusBadge value={a.status === "open" ? "open" : a.status} />
                      </div>
                      <div className="text-xs text-amber-600">
                        {JSON.stringify(a.detail)}
                      </div>
                      {a.status === "open" && (
                        <ActionMessageButtons actionId={a.action_id} />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No action messages.</p>
              )}
            </section>
          </div>

          {projByItem.size > 0 && (
            <section className="mt-6">
              <h2 className="mb-1 text-sm font-semibold text-slate-700">
                Time-phased plan
                <span className="ml-2 text-xs font-normal text-slate-400">
                  projected available balance per item (deterministic, I4)
                </span>
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {Array.from(projByItem.entries()).map(([itemId, rows]) => (
                  <div key={itemId} className="card overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
                      {itemMap.get(itemId) ?? `Item ${itemId}`}
                    </div>
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Event</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Projected</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r) => (
                          <tr key={r.seq} className={r.event_type === "planned_receipt" ? "bg-gold-50/40" : ""}>
                            <td className="px-3 py-1.5 text-slate-500">{fmtDate(r.bucket_date)}</td>
                            <td className="px-3 py-1.5 text-slate-600">
                              {EVENT_LABEL[r.event_type] ?? r.event_type}
                            </td>
                            <td className={`px-3 py-1.5 text-right tabular-nums ${Number(r.qty) < 0 ? "text-slate-500" : "text-slate-700"}`}>
                              {Number(r.qty) > 0 ? "+" : ""}
                              {r.qty}
                            </td>
                            <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${Number(r.projected_available) < 0 ? "text-red-600" : "text-slate-800"}`}>
                              {r.projected_available}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Planned receipts (highlighted) are the engine&rsquo;s suggestions that
                bring projected available back to zero at each shortage — the same
                math behind the planned orders above.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
