import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtFjd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Summary = {
  open_orders: number;
  released_orders: number;
  in_progress_orders: number;
  completed_orders: number;
  wip_actual_cost: number;
  total_variance_fjd: number;
};
type PO = {
  production_order_id: number;
  order_no: string;
  item_id: number;
  qty_ordered: number;
  qty_completed: number;
  uom: string;
  status: string;
  due_date: string;
};
type Cost = {
  production_order_id: number;
  actual_total_cost: number;
  variance_fjd: number;
  qty_completed: number;
};

export default async function ManufacturingPage() {
  const supabase = await createClient();
  const [{ data: summary }, { data: orders }, { data: costs }, { data: items }] =
    await Promise.all([
      supabase
        .schema("mfg")
        .from("v_production_summary")
        .select("open_orders, released_orders, in_progress_orders, completed_orders, wip_actual_cost, total_variance_fjd")
        .maybeSingle<Summary>(),
      supabase
        .schema("mfg")
        .from("production_orders")
        .select("production_order_id, order_no, item_id, qty_ordered, qty_completed, uom, status, due_date")
        .not("status", "in", "(closed,cancelled)")
        .order("due_date")
        .limit(12)
        .returns<PO[]>(),
      supabase
        .schema("mfg")
        .from("v_po_cost")
        .select("production_order_id, actual_total_cost, variance_fjd, qty_completed")
        .returns<Cost[]>(),
      supabase
        .schema("ops")
        .from("items")
        .select("item_id, item_no")
        .returns<{ item_id: number; item_no: string }[]>(),
    ]);
  const costMap = new Map((costs ?? []).map((c) => [c.production_order_id, c]));
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));

  const variance = Number(summary?.total_variance_fjd ?? 0);

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        subtitle="MAX replacement — live production. BC Essentials stays the inventory + costing master (I1); every posting goes through the outbox (I2); all costing math is deterministic SQL (I4)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Open orders"
          value={summary?.open_orders ?? 0}
          hint={`${summary?.in_progress_orders ?? 0} in progress · ${summary?.released_orders ?? 0} released`}
        />
        <StatTile label="Completed" value={summary?.completed_orders ?? 0} />
        <StatTile label="WIP cost booked" value={fmtFjd(summary?.wip_actual_cost ?? 0)} />
        <StatTile
          label="Cost variance"
          value={`${variance > 0 ? "+" : ""}${fmtFjd(variance)}`}
          tone={variance > 0.005 ? "danger" : variance < -0.005 ? "good" : "default"}
          hint={variance > 0 ? "over standard" : variance < 0 ? "under standard" : "on standard"}
        />
      </div>

      <section className="card mb-6 overflow-x-auto">
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="text-sm font-semibold text-slate-700">Active production orders</h2>
          <div className="flex gap-3 text-xs">
            <Link href="/manufacturing/shopfloor" className="text-gold-700 hover:underline">Shop floor →</Link>
            <Link href="/manufacturing/production" className="text-gold-700 hover:underline">All orders →</Link>
          </div>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Order</th>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Progress</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5 text-right">Actual cost</th>
              <th className="px-4 py-2.5 text-right">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders && orders.length > 0 ? (
              orders.map((po) => {
                const c = costMap.get(po.production_order_id);
                const v = Number(c?.variance_fjd ?? 0);
                const hasOutput = Number(c?.qty_completed ?? 0) > 0;
                return (
                  <tr key={po.production_order_id}>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/manufacturing/production/${po.production_order_id}`}
                        className="font-medium text-gold-700 hover:underline"
                      >
                        {po.order_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{itemMap.get(po.item_id) ?? po.item_id}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {po.qty_completed} / {po.qty_ordered} {po.uom}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={po.status} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(po.due_date)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {hasOutput ? fmtFjd(c!.actual_total_cost) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {hasOutput ? (
                        <span className={v > 0.005 ? "text-red-600" : v < -0.005 ? "text-emerald-600" : "text-slate-500"}>
                          {v > 0 ? "+" : ""}
                          {fmtFjd(v)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No active production orders. Create one from Production.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickLink href="/manufacturing/production" title="Production orders" note="Create, release, complete" />
        <QuickLink href="/manufacturing/shopfloor" title="Shop floor" note="Operator completion + labour" />
        <QuickLink href="/manufacturing/planning" title="Planning (MRP)" note="Netting + action messages" />
        <QuickLink href="/manufacturing/boms" title="BOMs" note="Versioned, ECO-lite" />
        <QuickLink href="/manufacturing/routings" title="Routings" note="Operations over work centres" />
        <QuickLink href="/manufacturing/costs" title="Standard costs" note="BC-cached, feeds the roll-up" />
        <QuickLink href="/manufacturing/capacity" title="Capacity" note="Advisory work-centre load" />
        <QuickLink href="/manufacturing/genealogy" title="Genealogy" note="Lot trace / recall" />
        <QuickLink href="/manufacturing/mps" title="MPS" note="Master schedule demand" />
      </div>
    </div>
  );
}

function QuickLink({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <Link href={href} className="card p-4 transition hover:border-gold-400 hover:shadow-sm">
      <div className="font-medium text-slate-800">{title}</div>
      <div className="mt-0.5 text-xs text-slate-400">{note}</div>
    </Link>
  );
}
