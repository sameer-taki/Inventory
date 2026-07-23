import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

type Edge = {
  depth: number;
  output_lot_no: string;
  consumed_item_id: number;
  consumed_lot_no: string;
  qty: number;
};

export default async function GenealogyPage({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const lot = (sp.lot ?? "").trim();
  const dir = sp.dir === "forward" ? "forward" : "backward";
  const supabase = await createClient();

  let edges: Edge[] = [];
  let itemMap = new Map<number, string>();
  let error: string | null = null;

  if (lot) {
    const { data, error: rpcErr } = await supabase
      .schema("mfg")
      .rpc(dir === "forward" ? "trace_forward" : "trace_backward", { p_lot: lot });
    if (rpcErr) error = rpcErr.message;
    edges = (data as Edge[] | null) ?? [];
    const ids = Array.from(new Set(edges.map((e) => e.consumed_item_id)));
    if (ids.length) {
      const { data: items } = await supabase
        .schema("ops")
        .from("items")
        .select("item_id, item_no")
        .in("item_id", ids)
        .returns<{ item_id: number; item_no: string }[]>();
      itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));
    }
  }

  return (
    <div>
      <PageHeader
        title="Lot genealogy & traceability"
        subtitle="Forward trace (raw lot → affected finished goods) powers the recall drill; backward trace (FG lot → all inputs) powers investigations. Edges are append-only (I8)."
      />

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="lot">
            Lot number
          </label>
          <input
            id="lot"
            name="lot"
            defaultValue={lot}
            placeholder="e.g. LOT-TRAY-260801 or PL-260801"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="dir">
            Direction
          </label>
          <select id="dir" name="dir" defaultValue={dir} className="field">
            <option value="backward">Backward — this lot&apos;s inputs</option>
            <option value="forward">Forward — where this lot went</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">
          Trace
        </button>
      </form>

      {error ? (
        <div className="card p-6 text-sm text-red-700">{error}</div>
      ) : lot ? (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600">
            {dir === "forward" ? "Forward" : "Backward"} trace for{" "}
            <span className="font-medium text-slate-800">{lot}</span> —{" "}
            {edges.length} edge(s)
          </div>
          {edges.length > 0 ? (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Level</th>
                  <th className="px-4 py-2">Output lot</th>
                  <th className="px-4 py-2">Consumed item</th>
                  <th className="px-4 py-2">Consumed lot</th>
                  <th className="px-4 py-2">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {edges.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-slate-400">{e.depth}</td>
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {e.output_lot_no}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {itemMap.get(e.consumed_item_id) ?? e.consumed_item_id}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{e.consumed_lot_no}</td>
                    <td className="px-4 py-2 text-slate-500">{e.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-8 text-center text-slate-400">
              No genealogy edges found for this lot.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Enter a lot number and choose a direction to trace.
        </p>
      )}
    </div>
  );
}
