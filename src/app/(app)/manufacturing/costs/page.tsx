import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { fmtFjd, fmtDateTime } from "@/lib/format";
import { CostRowForm } from "./CostRowForm";

export const dynamic = "force-dynamic";

type Item = { item_id: number; item_no: string; description: string };
type Cost = { item_id: number; std_cost: number; source: string; updated_at: string };

export default async function CostsPage() {
  const ctx = await getSessionContext();
  const canEdit = (ctx?.roles ?? []).some((r) => r === "planner" || r === "admin");

  const supabase = await createClient();
  const [{ data: items }, { data: costs }] = await Promise.all([
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .eq("is_active", true)
      .order("item_no")
      .returns<Item[]>(),
    supabase
      .schema("mfg")
      .from("item_cost")
      .select("item_id, std_cost, source, updated_at")
      .returns<Cost[]>(),
  ]);
  const costMap = new Map((costs ?? []).map((c) => [c.item_id, c]));

  return (
    <div>
      <PageHeader
        title="Standard costs"
        subtitle="Cached mirror of BC standard cost per item (I1 — BC is the costing master). Feeds the production cost roll-up (M2). Refreshed by the gateway; editable here as a stopgap by planners."
      />

      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5">Updated</th>
              <th className="px-4 py-2.5 text-right">Std cost (FJD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items && items.length > 0 ? (
              items.map((it) => {
                const c = costMap.get(it.item_id);
                return (
                  <tr key={it.item_id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-700">{it.item_no}</span>
                      <span className="ml-2 text-slate-400">{it.description}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {c ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                          {c.source === "bc_cache" ? "BC cache" : "manual"}
                        </span>
                      ) : (
                        <span className="text-slate-300">unset</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">
                      {c ? fmtDateTime(c.updated_at) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canEdit ? (
                        <CostRowForm itemId={it.item_id} currentCost={c ? c.std_cost : null} />
                      ) : (
                        <span className="tabular-nums text-slate-700">
                          {c ? fmtFjd(c.std_cost) : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!canEdit && (
        <p className="mt-3 text-xs text-slate-400">
          Editing standard costs is restricted to the planner and admin roles.
        </p>
      )}
    </div>
  );
}
