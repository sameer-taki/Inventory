import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";

export const dynamic = "force-dynamic";

type Shortage = {
  item_id: number;
  required_qty: number;
  on_hand: number;
  short_qty: number;
  open_orders: number;
};

export default async function ShortagesPage() {
  const supabase = await createClient();
  const [{ data: rows }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("v_component_shortage")
      .select("item_id, required_qty, on_hand, short_qty, open_orders")
      .order("short_qty", { ascending: false })
      .returns<Shortage[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));
  const list = rows ?? [];
  const shortCount = list.filter((r) => Number(r.short_qty) > 0).length;

  return (
    <div>
      <PageHeader
        title="Component shortages"
        subtitle="Material required by released / in-progress production orders vs on-hand (BC snapshot, I1). Deterministic SQL (I4)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Components required" value={list.length} />
        <StatTile label="Short" value={shortCount} tone={shortCount > 0 ? "danger" : "good"} />
        <StatTile label="Covered" value={list.length - shortCount} tone="good" />
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Component</th>
              <th className="px-4 py-2.5">Open orders</th>
              <th className="px-4 py-2.5 text-right">Required</th>
              <th className="px-4 py-2.5 text-right">On hand</th>
              <th className="px-4 py-2.5 text-right">Short</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length > 0 ? (
              list.map((r) => {
                const it = itemMap.get(r.item_id);
                const short = Number(r.short_qty) > 0;
                return (
                  <tr key={r.item_id} className={short ? "bg-red-50/40" : ""}>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/manufacturing/where-used?item=${r.item_id}`}
                        className="font-medium text-gold-700 hover:underline"
                      >
                        {it?.item_no ?? r.item_id}
                      </Link>
                      <span className="ml-2 text-slate-400">{it?.description}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{r.open_orders}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.required_qty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.on_hand}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {short ? <span className="text-red-600">{r.short_qty}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {short ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">short</span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">covered</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No released or in-progress orders consuming components.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Required = Σ (remaining qty × BOM qty-per × scrap) across open orders. On-hand
        is the latest BC inventory snapshot; run MRP for time-phased coverage.
      </p>
    </div>
  );
}
