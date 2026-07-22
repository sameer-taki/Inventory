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
  origin: string;
};

export default async function ProductionPage() {
  const supabase = await createClient();
  const [{ data: pos }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("production_orders")
      .select("production_order_id, order_no, item_id, plant, qty_ordered, qty_completed, uom, due_date, status, origin")
      .order("created_at", { ascending: false })
      .returns<PO[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no")
      .returns<{ item_id: number; item_no: string }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));

  return (
    <div>
      <PageHeader
        title="Production orders"
        subtitle="Order lifecycle and shop-floor completion. Completions queue a BC posting via the outbox (I2) and capture genealogy edges (I8)."
        action={{ href: "/manufacturing/production/new", label: "New order" }}
      />
      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Order</th>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Plant</th>
              <th className="px-4 py-2.5">Qty (done/ord)</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5">Origin</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pos && pos.length > 0 ? (
              pos.map((p) => (
                <tr key={p.production_order_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/manufacturing/production/${p.production_order_id}`}
                      className="font-medium text-gold-700 hover:underline"
                    >
                      {p.order_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {itemMap.get(p.item_id) ?? p.item_id}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{p.plant}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {p.qty_completed}/{p.qty_ordered} {p.uom}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(p.due_date)}</td>
                  <td className="px-4 py-2.5 text-xs uppercase text-slate-400">
                    {p.origin}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge value={p.status === "in_progress" ? "in_progress" : p.status} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No production orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
