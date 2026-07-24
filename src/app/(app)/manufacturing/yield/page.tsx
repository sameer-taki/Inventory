import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type ByOrder = {
  production_order_id: number;
  order_no: string;
  item_id: number;
  qty_good: number;
  qty_scrap: number;
  yield_pct: number | null;
  last_posted: string;
};
type ByItem = {
  item_id: number;
  orders: number;
  qty_good: number;
  qty_scrap: number;
  yield_pct: number | null;
};

function yieldTone(pct: number | null): string {
  if (pct === null) return "text-slate-500";
  if (pct >= 98) return "text-emerald-600";
  if (pct >= 90) return "text-amber-600";
  return "text-red-600";
}

export default async function YieldPage() {
  const supabase = await createClient();
  const [{ data: byOrder }, { data: byItem }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("v_yield_by_order")
      .select("production_order_id, order_no, item_id, qty_good, qty_scrap, yield_pct, last_posted")
      .order("last_posted", { ascending: false })
      .returns<ByOrder[]>(),
    supabase
      .schema("mfg")
      .from("v_yield_by_item")
      .select("item_id, orders, qty_good, qty_scrap, yield_pct")
      .returns<ByItem[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));
  const orders = byOrder ?? [];
  const perItem = byItem ?? [];

  const totalGood = perItem.reduce((s, r) => s + Number(r.qty_good), 0);
  const totalScrap = perItem.reduce((s, r) => s + Number(r.qty_scrap), 0);
  const overall =
    totalGood + totalScrap > 0 ? Math.round((totalGood / (totalGood + totalScrap)) * 10000) / 100 : null;

  return (
    <div>
      <PageHeader
        title="Scrap & yield"
        subtitle="Good vs scrap from posted completions (deterministic, I4). Yield = good ÷ (good + scrap)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Overall yield"
          value={overall !== null ? `${overall}%` : "—"}
          tone={overall === null ? "default" : overall >= 98 ? "good" : overall >= 90 ? "warn" : "danger"}
        />
        <StatTile label="Good produced" value={totalGood} />
        <StatTile label="Scrapped" value={totalScrap} tone={totalScrap > 0 ? "warn" : "good"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
            Yield by item
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2 text-right">Good</th>
                <th className="px-4 py-2 text-right">Scrap</th>
                <th className="px-4 py-2 text-right">Yield</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {perItem.length > 0 ? (
                perItem.map((r) => (
                  <tr key={r.item_id}>
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {itemMap.get(r.item_id)?.item_no ?? r.item_id}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{r.orders}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.qty_good}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.qty_scrap}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${yieldTone(r.yield_pct)}`}>
                      {r.yield_pct ?? "—"}%
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No completions posted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
            Yield by order
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2 text-right">Good</th>
                <th className="px-4 py-2 text-right">Scrap</th>
                <th className="px-4 py-2 text-right">Yield</th>
                <th className="px-4 py-2">Last posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.length > 0 ? (
                orders.map((r) => (
                  <tr key={r.production_order_id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/manufacturing/production/${r.production_order_id}`}
                        className="font-medium text-gold-700 hover:underline"
                      >
                        {r.order_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.qty_good}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.qty_scrap}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${yieldTone(r.yield_pct)}`}>
                      {r.yield_pct ?? "—"}%
                    </td>
                    <td className="px-4 py-2 text-slate-400">{fmtDateTime(r.last_posted)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No completions posted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
