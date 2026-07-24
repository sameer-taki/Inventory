import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = {
  item_id: number;
  item_no: string;
  description: string;
  on_hand: number;
  on_order: number;
  allocated: number;
  available: number;
  snapshot_at: string | null;
};

export default async function InventoryPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .schema("mfg")
    .from("v_inventory")
    .select("item_id, item_no, description, on_hand, on_order, allocated, available, snapshot_at")
    .order("item_no")
    .returns<Row[]>();

  const list = rows ?? [];
  const negative = list.filter((r) => Number(r.available) < 0).length;
  const latest = list.reduce<string | null>(
    (acc, r) => (r.snapshot_at && (!acc || r.snapshot_at > acc) ? r.snapshot_at : acc),
    null,
  );

  return (
    <div>
      <PageHeader
        title="Inventory status"
        subtitle="Read-only planning snapshot. BC Essentials is the inventory master (I1); balances mirror the latest BC snapshot. Deterministic SQL (I4)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Items" value={list.length} />
        <StatTile
          label="Negative available"
          value={negative}
          tone={negative > 0 ? "danger" : "good"}
          hint="allocated exceeds on-hand"
        />
        <StatTile label="Snapshot" value={latest ? fmtDateTime(latest) : "—"} />
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5 text-right">On hand</th>
              <th className="px-4 py-2.5 text-right">On order</th>
              <th className="px-4 py-2.5 text-right">Allocated</th>
              <th className="px-4 py-2.5 text-right">Available</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length > 0 ? (
              list.map((r) => {
                const avail = Number(r.available);
                return (
                  <tr key={r.item_id} className={avail < 0 ? "bg-red-50/40" : ""}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-700">{r.item_no}</span>
                      <span className="ml-2 text-slate-400">{r.description}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.on_hand}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.on_order}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.allocated}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      <span className={avail < 0 ? "text-red-600" : "text-slate-800"}>{r.available}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/manufacturing/where-used?item=${r.item_id}`}
                        className="text-xs text-gold-700 hover:underline"
                      >
                        where used
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        On order = open production orders + BC open POs. Allocated = component
        demand from released / in-progress orders. Available = on-hand − allocated;
        negative means over-committed — run MRP for the time-phased picture.
      </p>
    </div>
  );
}
