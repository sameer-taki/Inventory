import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDateTime, titleCase } from "@/lib/format";
import { OutboxRowActions } from "./OutboxRowActions";

export const dynamic = "force-dynamic";

type Outbox = {
  outbox_id: number;
  aggregate_type: string;
  aggregate_id: number;
  event_type: string;
  target_system: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  external_ref_no: string | null;
  created_at: string;
  sent_at: string | null;
};

const STATUSES = ["pending", "failed", "dead", "sent"];

export default async function OutboxMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx?.roles.includes("admin")) {
    return (
      <div>
        <PageHeader title="Integration outbox" />
        <div className="card p-6 text-sm text-slate-600">
          This monitor is restricted to the <span className="font-medium">admin</span> role.
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .schema("ops")
    .from("integration_outbox")
    .select(
      "outbox_id, aggregate_type, aggregate_id, event_type, target_system, idempotency_key, status, attempts, last_error, external_ref_no, created_at, sent_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (sp.status) query = query.eq("status", sp.status);
  const { data: rows } = await query.returns<Outbox[]>();

  const counts: Record<string, number> = {};
  for (const st of STATUSES) {
    const { count } = await supabase
      .schema("ops")
      .from("integration_outbox")
      .select("outbox_id", { count: "exact", head: true })
      .eq("status", st);
    counts[st] = count ?? 0;
  }

  return (
    <div>
      <PageHeader
        title="Integration outbox"
        subtitle="Single-writer queue to BC (P2/I2). The gateway bridge delivers rows and marks them sent; here an admin can re-queue or kill a poison row."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterLink label="All" active={!sp.status} href="/admin/outbox" />
        {STATUSES.map((st) => (
          <FilterLink
            key={st}
            label={`${titleCase(st)} (${counts[st]})`}
            active={sp.status === st}
            href={`/admin/outbox?status=${st}`}
          />
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Aggregate</th>
              <th className="px-3 py-2.5">Event → target</th>
              <th className="px-3 py-2.5">Idempotency key</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Attempts</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows && rows.length > 0 ? (
              rows.map((r) => (
                <tr key={r.outbox_id} className="align-top">
                  <td className="px-3 py-2.5 text-slate-400">{r.outbox_id}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {r.aggregate_type}
                    <span className="text-slate-400"> #{r.aggregate_id}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {r.event_type}
                    <div className="text-xs text-slate-400">→ {r.target_system}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="text-xs text-slate-500">{r.idempotency_key}</code>
                    {r.external_ref_no && (
                      <div className="text-xs text-emerald-600">BC {r.external_ref_no}</div>
                    )}
                    {r.last_error && (
                      <div className="mt-0.5 max-w-[280px] truncate text-xs text-red-600" title={r.last_error}>
                        {r.last_error}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge
                      value={
                        r.status === "sent"
                          ? "renewed"
                          : r.status === "pending"
                            ? "open"
                            : r.status === "failed"
                              ? "overdue"
                              : r.status
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{r.attempts}</td>
                  <td className="px-3 py-2.5 text-slate-500">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <OutboxRowActions outboxId={r.outbox_id} status={r.status} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  No outbox rows{sp.status ? ` with status "${sp.status}"` : ""}. Postings
                  appear here when production completions are posted.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
