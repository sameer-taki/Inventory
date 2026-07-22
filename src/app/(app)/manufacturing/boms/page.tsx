import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { ApproveBomButton } from "./ApproveBomButton";

export const dynamic = "force-dynamic";

type Bom = {
  bom_id: number;
  item_id: number;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
};

export default async function BomsPage() {
  const supabase = await createClient();
  const [{ data: boms }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("boms")
      .select("bom_id, item_id, version_no, status, effective_from, effective_to")
      .order("item_id")
      .order("version_no", { ascending: false })
      .returns<Bom[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));

  return (
    <div>
      <PageHeader
        title="Manufacturing BOMs"
        subtitle="Versioned, effectivity-dated, approval-gated (ECO-lite). Never mirrors Kiwiplan's production BOM (I5)."
        action={{ href: "/manufacturing/boms/new", label: "New BOM" }}
      />
      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Version</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Effective</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {boms && boms.length > 0 ? (
              boms.map((b) => (
                <tr key={b.bom_id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-700">
                      {itemMap.get(b.item_id)?.item_no ?? b.item_id}
                    </span>
                    <span className="ml-2 text-slate-400">
                      {itemMap.get(b.item_id)?.description}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">v{b.version_no}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge value={b.status === "approved" ? "renewed" : b.status === "draft" ? "open" : b.status} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {fmtDate(b.effective_from)}
                    {b.effective_to ? ` → ${fmtDate(b.effective_to)}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {b.status === "draft" && <ApproveBomButton bomId={b.bom_id} />}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No BOMs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
