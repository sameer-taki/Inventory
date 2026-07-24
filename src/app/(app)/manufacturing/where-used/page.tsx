import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

type Row = { item_id: number; parent_item_id: number; level: number; qty_per: number };
type Item = { item_id: number; item_no: string; description: string };

export default async function WhereUsedPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const sp = await searchParams;
  const itemId = sp.item ? Number(sp.item) : null;

  const supabase = await createClient();
  const { data: items } = await supabase
    .schema("ops")
    .from("items")
    .select("item_id, item_no, description")
    .order("item_no")
    .returns<Item[]>();
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));

  let rows: Row[] = [];
  if (itemId) {
    const { data } = await supabase
      .schema("mfg")
      .from("v_where_used")
      .select("item_id, parent_item_id, level, qty_per")
      .eq("item_id", itemId)
      .order("level")
      .returns<Row[]>();
    rows = data ?? [];
  }
  const selected = itemId ? itemMap.get(itemId) : null;

  return (
    <div>
      <PageHeader
        title="Where used"
        subtitle="Every parent assembly a component feeds — the inverse of BOM explosion (recursive over approved BOMs). Use it before an ECO or when discontinuing a part."
      />

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="item">Component</label>
          <select id="item" name="item" defaultValue={itemId ?? ""} className="field min-w-[20rem]">
            <option value="" disabled>Select a component…</option>
            {(items ?? []).map((i) => (
              <option key={i.item_id} value={i.item_id}>
                {i.item_no} — {i.description}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">Show</button>
      </form>

      {itemId && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
            {selected ? `${selected.item_no} — ${selected.description}` : `Item ${itemId}`}
            <span className="ml-2 font-normal text-slate-400">
              used in {rows.length} assembl{rows.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Level</th>
                <th className="px-4 py-2.5">Parent / assembly</th>
                <th className="px-4 py-2.5 text-right">Qty per</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length > 0 ? (
                rows.map((r, i) => {
                  const p = itemMap.get(r.parent_item_id);
                  return (
                    <tr key={`${r.parent_item_id}-${i}`}>
                      <td className="px-4 py-2.5 text-slate-400">
                        {r.level === 1 ? "direct" : `+${r.level - 1}`}
                      </td>
                      <td className="px-4 py-2.5" style={{ paddingLeft: `${1 + (r.level - 1) * 1.25}rem` }}>
                        <Link
                          href={`/manufacturing/where-used?item=${r.parent_item_id}`}
                          className="font-medium text-gold-700 hover:underline"
                          title="Where is this parent used?"
                        >
                          {p?.item_no ?? r.parent_item_id}
                        </Link>
                        <span className="ml-2 text-slate-400">{p?.description}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.qty_per}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                    Not used in any approved BOM — safe to change or retire.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
