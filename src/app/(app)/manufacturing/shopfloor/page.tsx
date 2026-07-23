import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type PO = {
  production_order_id: number;
  order_no: string;
  item_id: number;
  plant: string;
  qty_ordered: number;
  qty_completed: number;
  uom: string;
  due_date: string;
  status: string;
};

export default async function ShopfloorPage() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .schema("mfg")
    .from("production_orders")
    .select("production_order_id, order_no, item_id, plant, qty_ordered, qty_completed, uom, due_date, status")
    .in("status", ["released", "in_progress"])
    .order("due_date")
    .returns<PO[]>();

  const { data: items } = await supabase
    .schema("ops")
    .from("items")
    .select("item_id, item_no, description")
    .returns<{ item_id: number; item_no: string; description: string }[]>();
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));

  return (
    <div>
      <PageHeader
        title="Shop floor"
        subtitle="Released and in-progress orders ready for completion. Tap an order to record output, backflush materials and log labour."
      />

      {orders && orders.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((po) => {
            const it = itemMap.get(po.item_id);
            const pct =
              po.qty_ordered > 0
                ? Math.min(100, Math.round((po.qty_completed / po.qty_ordered) * 100))
                : 0;
            return (
              <Link
                key={po.production_order_id}
                href={`/manufacturing/shopfloor/${po.production_order_id}`}
                className="card flex flex-col gap-3 p-5 transition hover:border-gold-400 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-slate-900">{po.order_no}</span>
                  <StatusBadge value={po.status} />
                </div>
                <div className="text-sm text-slate-600">
                  <div className="font-medium text-slate-800">{it?.item_no ?? po.item_id}</div>
                  <div className="text-slate-400">{it?.description}</div>
                </div>
                <div className="mt-1">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>
                      {po.qty_completed} / {po.qty_ordered} {po.uom}
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-gold-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{po.plant}</span>
                  <span>due {fmtDate(po.due_date)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card p-10 text-center text-slate-400">
          No released or in-progress orders. Release an order from Production.
        </div>
      )}
    </div>
  );
}
