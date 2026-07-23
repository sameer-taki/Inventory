import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { StatusBadge } from "@/components/StatusBadge";
import { BarRow } from "@/components/BarRow";
import { titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type Stats = {
  open_ncrs: number;
  open_critical_ncrs: number;
  ncrs_under_review: number;
  open_capas: number;
  overdue_capas: number;
};
type Count = { source?: string; severity?: string; ncr_count: number };
type Ageing = {
  ncr_id: number;
  ncr_no: string;
  source: string;
  severity: string;
  status: string;
  age_days: number;
};

export default async function QualityDashboardPage() {
  const supabase = await createClient();
  const [{ data: stats }, { data: bySource }, { data: bySeverity }, { data: ageing }] =
    await Promise.all([
      supabase.schema("quality").from("v_dashboard_stats").select("*").maybeSingle<Stats>(),
      supabase.schema("quality").from("v_ncr_by_source").select("*").returns<Count[]>(),
      supabase.schema("quality").from("v_ncr_by_severity").select("*").returns<Count[]>(),
      supabase
        .schema("quality")
        .from("v_ncr_ageing")
        .select("ncr_id, ncr_no, source, severity, status, age_days")
        .order("age_days", { ascending: false })
        .limit(8)
        .returns<Ageing[]>(),
    ]);

  const sourceMax = Math.max(1, ...(bySource ?? []).map((r) => r.ncr_count));
  const sevMax = Math.max(1, ...(bySeverity ?? []).map((r) => r.ncr_count));
  const sevTone: Record<string, "default" | "warn" | "danger"> = {
    minor: "default",
    major: "warn",
    critical: "danger",
  };

  return (
    <div>
      <PageHeader
        title="Quality dashboard"
        subtitle="Open workload, Pareto by source and severity, and the oldest open NCRs. All figures are deterministic SQL views."
      />

      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile label="Open NCRs" value={stats?.open_ncrs ?? 0} />
        <StatTile
          label="Critical open"
          value={stats?.open_critical_ncrs ?? 0}
          tone={stats?.open_critical_ncrs ? "danger" : "default"}
        />
        <StatTile
          label="Under review"
          value={stats?.ncrs_under_review ?? 0}
          tone={stats?.ncrs_under_review ? "warn" : "default"}
        />
        <StatTile label="Open CAPAs" value={stats?.open_capas ?? 0} />
        <StatTile
          label="Overdue CAPAs"
          value={stats?.overdue_capas ?? 0}
          tone={stats?.overdue_capas ? "danger" : "default"}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">NCRs by source (Pareto)</h2>
          {bySource && bySource.length > 0 ? (
            <div className="space-y-1">
              {bySource.map((r) => (
                <BarRow
                  key={r.source}
                  label={titleCase(r.source ?? "")}
                  value={r.ncr_count}
                  max={sourceMax}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-slate-400">No NCRs yet.</p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">NCRs by severity</h2>
          {bySeverity && bySeverity.length > 0 ? (
            <div className="space-y-1">
              {bySeverity.map((r) => (
                <BarRow
                  key={r.severity}
                  label={titleCase(r.severity ?? "")}
                  value={r.ncr_count}
                  max={sevMax}
                  tone={sevTone[r.severity ?? ""] ?? "default"}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-slate-400">No NCRs yet.</p>
          )}
        </section>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Oldest open NCRs</h2>
        {ageing && ageing.length > 0 ? (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1.5 pr-4">NCR</th>
                <th className="py-1.5 pr-4">Source</th>
                <th className="py-1.5 pr-4">Severity</th>
                <th className="py-1.5 pr-4">Status</th>
                <th className="py-1.5">Age (days)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ageing.map((n) => (
                <tr key={n.ncr_id}>
                  <td className="py-1.5 pr-4 font-medium text-slate-700">{n.ncr_no}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{titleCase(n.source)}</td>
                  <td className="py-1.5 pr-4"><StatusBadge value={n.severity} /></td>
                  <td className="py-1.5 pr-4"><StatusBadge value={n.status} /></td>
                  <td className="py-1.5 font-medium text-slate-700">{n.age_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-4 text-sm text-slate-400">No open NCRs.</p>
        )}
      </section>
    </div>
  );
}
