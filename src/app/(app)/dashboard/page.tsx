import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type QualityStats = {
  open_ncrs: number;
  open_critical_ncrs: number;
  ncrs_under_review: number;
  open_capas: number;
  overdue_capas: number;
};

type NcrRow = {
  ncr_no: string;
  severity: string;
  status: string;
  source: string;
  raised_at: string;
};

const MODULE_STATUS: { module: string; name: string; status: string }[] = [
  { module: "M0", name: "Foundations & discovery", status: "done" },
  { module: "M1", name: "Quality / NCR / CAPA", status: "live" },
  { module: "M3", name: "BOMs / routings / work centres", status: "live" },
  { module: "M2", name: "Production + BC write-back", status: "live" },
  { module: "M4", name: "MRP / MPS engine", status: "live" },
  { module: "M6", name: "Lot/serial genealogy", status: "schema" },
  { module: "F1–F3", name: "Fleet register / renewals / fuel", status: "live" },
];

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: stats } = await supabase
    .schema("quality")
    .from("v_dashboard_stats")
    .select("*")
    .maybeSingle<QualityStats>();

  const { data: recent } = await supabase
    .schema("quality")
    .from("ncrs")
    .select("ncr_no, severity, status, source, raised_at")
    .order("raised_at", { ascending: false })
    .limit(5)
    .returns<NcrRow[]>();

  const { count: dueRenewals } = await supabase
    .schema("fleet")
    .from("v_due_renewals")
    .select("renewal_id", { count: "exact", head: true });

  return (
    <div>
      <PageHeader
        title="Operations dashboard"
        subtitle="Golden Manufacturers Group — one platform, every module."
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Quality (MAX Stage 1)
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              Recent NCRs
            </h2>
            <Link
              href="/quality/ncr"
              className="text-xs font-medium text-gold-700 hover:underline"
            >
              View all
            </Link>
          </div>
          {recent && recent.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {recent.map((n) => (
                <li
                  key={n.ncr_no}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <span className="font-medium text-slate-800">
                      {n.ncr_no}
                    </span>
                    <span className="ml-2 text-slate-400">
                      {titleCase(n.source)} · {fmtDate(n.raised_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={n.severity} />
                    <StatusBadge value={n.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">
              No NCRs yet.
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Module build status
          </h2>
          <ul className="space-y-1.5">
            {MODULE_STATUS.map((m) => (
              <li
                key={m.module}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-slate-600">
                  <span className="mr-2 inline-block w-12 font-mono text-xs text-slate-400">
                    {m.module}
                  </span>
                  {m.name}
                </span>
                <StatusChip status={m.status} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400">
            Fleet compliance: {dueRenewals ?? 0} renewal(s) due within their
            reminder window.
          </p>
        </section>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "bg-emerald-100 text-emerald-700",
    live: "bg-gold-100 text-gold-800",
    schema: "bg-slate-100 text-slate-500",
  };
  const label: Record<string, string> = {
    done: "Done",
    live: "Live",
    schema: "Schema laid",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[status]}`}
    >
      {label[status] ?? status}
    </span>
  );
}
