import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { runShadowMrpAction } from "../actions";
import { CategoriseForm } from "./CategoriseForm";

export const dynamic = "force-dynamic";

type Status = {
  shadow_run_id: number | null;
  shadow_snapshot_at: string | null;
  rec_batch_id: number | null;
  rec_rowcount: number | null;
  rec_extracted_at: string | null;
};

type Diff = {
  mrp_run_id: number | null;
  item_id: number;
  due_date: string;
  ours_qty: number;
  max_qty: number;
  variance: number;
  status: string;
  category: string | null;
  note: string | null;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  match: { label: "match", cls: "bg-emerald-100 text-emerald-800" },
  qty_diff: { label: "qty diff", cls: "bg-amber-100 text-amber-800" },
  ours_only: { label: "ours only", cls: "bg-blue-100 text-blue-800" },
  max_only: { label: "MAX only", cls: "bg-red-100 text-red-800" },
};

export default async function ShadowPage() {
  const ctx = await getSessionContext();
  if (!ctx?.roles.some((r) => r === "planner" || r === "admin")) {
    return (
      <div>
        <PageHeader title="MRP shadow-run diff" />
        <div className="card p-6 text-sm text-slate-600">
          The shadow-run acceptance tool is restricted to the{" "}
          <span className="font-medium">planner</span> and{" "}
          <span className="font-medium">admin</span> roles.
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: status }, { data: diff }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("v_mrp_shadow_status")
      .select("shadow_run_id, shadow_snapshot_at, rec_batch_id, rec_rowcount, rec_extracted_at")
      .maybeSingle<Status>(),
    supabase
      .schema("mfg")
      .from("v_mrp_shadow_diff")
      .select("mrp_run_id, item_id, due_date, ours_qty, max_qty, variance, status, category, note")
      .order("status")
      .returns<Diff[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
  ]);
  const run = status?.shadow_run_id ? status : null;
  const batch = status?.rec_batch_id ? status : null;
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));
  const rows = diff ?? [];
  const variances = rows.filter((r) => r.status !== "match");
  const uncategorised = variances.filter((r) => !r.category).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">MRP shadow-run diff</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Stage-3 acceptance (G3): our shadow MRP vs MAX&rsquo;s own recommendations,
            per item and demand bucket. Every material variance must be categorised
            (data / logic / MAX bug / accepted) before MAX planning is switched off.
          </p>
        </div>
        <form action={runShadowMrpAction}>
          <button type="submit" className="btn-primary">Run shadow MRP</button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-500">
        <span>
          Shadow run{" "}
          {run ? <span className="font-mono">#{run.shadow_run_id}</span> : <span className="text-slate-400">none yet</span>}
          {run && <span className="ml-2">snapshot {fmtDateTime(run.shadow_snapshot_at)}</span>}
        </span>
        <span>
          MAX recommendations{" "}
          {batch ? (
            <>batch #{batch.rec_batch_id} · {batch.rec_rowcount} rows · {fmtDateTime(batch.rec_extracted_at)}</>
          ) : (
            <span className="text-slate-400">not loaded</span>
          )}
        </span>
      </div>

      {!run || !batch ? (
        <div className="card p-8 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Nothing to diff yet.</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-500">
            {!run && <li>Run MRP in shadow mode (button above).</li>}
            {!batch && (
              <li>
                Load MAX&rsquo;s recommendations into{" "}
                <code className="text-xs">max_stage.mrp_recommendations</code> (via the
                extraction job over <code className="text-xs">max_ro</code>) — one batch per cycle.
              </li>
            )}
          </ul>
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <StatTile label="Lines" value={rows.length} />
            <StatTile label="Matches" value={rows.length - variances.length} tone="good" />
            <StatTile label="Variances" value={variances.length} tone={variances.length > 0 ? "warn" : "good"} />
            <StatTile
              label="Uncategorised"
              value={uncategorised}
              tone={uncategorised > 0 ? "danger" : "good"}
              hint="block G3 until zero"
            />
          </div>

          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Item</th>
                  <th className="px-4 py-2.5">Bucket</th>
                  <th className="px-4 py-2.5 text-right">Ours</th>
                  <th className="px-4 py-2.5 text-right">MAX</th>
                  <th className="px-4 py-2.5 text-right">Variance</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => {
                  const st = STATUS_LABEL[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-700" };
                  const v = Number(r.variance);
                  return (
                    <tr key={`${r.item_id}-${r.due_date}-${i}`} className={r.status !== "match" && !r.category ? "bg-amber-50/30" : ""}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-slate-700">{itemMap.get(r.item_id)?.item_no ?? r.item_id}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.due_date)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.ours_qty}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.max_qty}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${v === 0 ? "text-slate-400" : v > 0 ? "text-blue-600" : "text-red-600"}`}>
                        {v > 0 ? "+" : ""}{r.variance}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.status === "match" ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <CategoriseForm
                            itemId={r.item_id}
                            dueDate={r.due_date}
                            category={r.category}
                            note={r.note}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Shadow runs write no production orders — they only produce planned-order
            suggestions to compare. G3 passes when every variance is categorised and
            the planner + Aqib sign the report (plan §9).
          </p>
        </>
      )}
    </div>
  );
}
