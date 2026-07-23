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
  let itemMap = new Map<number, string>();

  if (run) {
    const [{ data: po }, { data: am }, { data: items }] = await Promise.all([
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
        .schema("ops")
        .from("items")
        .select("item_id, item_no")
        .returns<{ item_id: number; item_no: string }[]>(),
    ]);
    planned = po ?? [];
    actions = am ?? [];
    itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));
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
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
        </>
      )}
    </div>
  );
}
