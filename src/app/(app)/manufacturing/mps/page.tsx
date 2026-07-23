import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import { MpsForm } from "./MpsForm";

export const dynamic = "force-dynamic";

type Mps = {
  mps_id: number;
  item_id: number;
  plant: string;
  bucket_start: string;
  qty: number;
  kind: string;
};

export default async function MpsPage() {
  const supabase = await createClient();
  const [{ data: entries }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("mps_entries")
      .select("mps_id, item_id, plant, bucket_start, qty, kind")
      .order("bucket_start")
      .returns<Mps[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .eq("is_active", true)
      .order("item_no")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));

  return (
    <div>
      <PageHeader
        title="Master production schedule"
        subtitle="Independent demand the MRP engine nets against. Firm is always counted; forecast fills the horizon."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Item</th>
                <th className="px-4 py-2.5">Bucket</th>
                <th className="px-4 py-2.5">Qty</th>
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Plant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries && entries.length > 0 ? (
                entries.map((e) => (
                  <tr key={e.mps_id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      {itemMap.get(e.item_id) ?? e.item_id}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(e.bucket_start)}</td>
                    <td className="px-4 py-2.5 text-slate-700">{e.qty}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          e.kind === "firm"
                            ? "bg-gold-100 text-gold-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {e.kind}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{e.plant}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No MPS entries yet — add one, then run MRP under Planning.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <MpsForm items={items ?? []} />
      </div>
    </div>
  );
}
