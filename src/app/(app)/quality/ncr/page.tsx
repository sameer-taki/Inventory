import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type NcrRow = {
  ncr_id: number;
  ncr_no: string;
  source: string;
  plant: string | null;
  severity: string;
  status: string;
  disposition: string | null;
  raised_at: string;
};

const STATUSES = ["open", "under_review", "dispositioned", "closed"];

export default async function NcrListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .schema("quality")
    .from("ncrs")
    .select(
      "ncr_id, ncr_no, source, plant, severity, status, disposition, raised_at",
    )
    .order("raised_at", { ascending: false });

  if (sp.status) query = query.eq("status", sp.status);
  if (sp.severity) query = query.eq("severity", sp.severity);

  const { data: ncrs, error } = await query.returns<NcrRow[]>();

  return (
    <div>
      <PageHeader
        title="Non-conformance reports"
        subtitle="Raise, review and disposition NCRs. Every transition is logged (I9)."
        action={{ href: "/quality/ncr/new", label: "Raise NCR" }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterLink label="All" active={!sp.status} href="/quality/ncr" />
        {STATUSES.map((s) => (
          <FilterLink
            key={s}
            label={titleCase(s)}
            active={sp.status === s}
            href={`/quality/ncr?status=${s}`}
          />
        ))}
      </div>

      {error ? (
        <ErrorNote message={error.message} />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">NCR</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Plant</th>
                <th className="px-4 py-2.5">Severity</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Disposition</th>
                <th className="px-4 py-2.5">Raised</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ncrs && ncrs.length > 0 ? (
                ncrs.map((n) => (
                  <tr key={n.ncr_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/quality/ncr/${n.ncr_id}`}
                        className="font-medium text-gold-700 hover:underline"
                      >
                        {n.ncr_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {titleCase(n.source)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {n.plant ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={n.severity} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={n.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={n.disposition} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {fmtDate(n.raised_at)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    No NCRs match this filter.
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

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active
          ? "border-gold-600 bg-gold-50 text-gold-800"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="card p-6 text-sm text-red-700">
      <p className="font-medium">Couldn&apos;t load NCRs.</p>
      <p className="mt-1 text-red-600">{message}</p>
      <p className="mt-2 text-slate-500">
        If this is a fresh deployment, confirm the module schemas are exposed in
        the Supabase API settings and the migrations have been applied.
      </p>
    </div>
  );
}
