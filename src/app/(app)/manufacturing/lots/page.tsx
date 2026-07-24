import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Lot = {
  lot_no: string;
  item_id: number;
  produced_by: string;
  produced_qty: number;
  produced_at: string;
  consumed_qty: number;
};

export default async function LotsPage() {
  const supabase = await createClient();
  const [{ data: lots }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("v_lot_status")
      .select("lot_no, item_id, produced_by, produced_qty, produced_at, consumed_qty")
      .order("produced_at", { ascending: false })
      .returns<Lot[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));
  const list = lots ?? [];
  const consumed = list.filter((l) => Number(l.consumed_qty) > 0).length;

  return (
    <div>
      <PageHeader
        title="Lot status"
        subtitle="Register of production-output lots (I8, append-only genealogy). Trace any lot forward (recall) or backward (investigation)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Output lots" value={list.length} />
        <StatTile label="Consumed downstream" value={consumed} />
        <StatTile label="Not yet consumed" value={list.length - consumed} tone="good" />
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Lot</th>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Produced by</th>
              <th className="px-4 py-2.5 text-right">Qty</th>
              <th className="px-4 py-2.5 text-right">Consumed</th>
              <th className="px-4 py-2.5">Produced</th>
              <th className="px-4 py-2.5">Trace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length > 0 ? (
              list.map((l) => (
                <tr key={l.lot_no}>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{l.lot_no}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {itemMap.get(l.item_id)?.item_no ?? l.item_id}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{l.produced_by}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{l.produced_qty}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {Number(l.consumed_qty) > 0 ? (
                      <span className="text-slate-700">{l.consumed_qty}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{fmtDateTime(l.produced_at)}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/manufacturing/genealogy?lot=${encodeURIComponent(l.lot_no)}&dir=forward`}
                      className="text-xs text-gold-700 hover:underline"
                    >
                      forward
                    </Link>
                    <span className="mx-1 text-slate-300">·</span>
                    <Link
                      href={`/manufacturing/genealogy?lot=${encodeURIComponent(l.lot_no)}&dir=backward`}
                      className="text-xs text-gold-700 hover:underline"
                    >
                      backward
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No output lots yet — post a completion with an output lot number.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
