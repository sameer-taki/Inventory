import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Event = {
  event_id: number;
  entity_type: string;
  entity_id: number;
  event_type: string;
  actor_id: number | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const CHIPS: { label: string; entity?: string; event?: string }[] = [
  { label: "All" },
  { label: "Manufacturing", entity: "mfg." },
  { label: "Fleet", entity: "fleet." },
  { label: "Integration", entity: "ops.integration_outbox" },
  { label: "BC posted", event: "bc_posted" },
  { label: "BC failed", event: "bc_post_failed" },
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; event?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx?.roles.includes("admin")) {
    return (
      <div>
        <PageHeader title="Audit log" />
        <div className="card p-6 text-sm text-slate-600">
          This viewer is restricted to the <span className="font-medium">admin</span> role.
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const entity = (sp.entity ?? "").trim();
  const event = (sp.event ?? "").trim();
  const supabase = await createClient();

  let query = supabase
    .schema("ops")
    .from("event_log")
    .select("event_id, entity_type, entity_id, event_type, actor_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(250);
  if (entity) query = query.ilike("entity_type", `%${entity}%`);
  if (event) query = query.ilike("event_type", `%${event}%`);

  const [{ data: events }, { data: users }] = await Promise.all([
    query.returns<Event[]>(),
    supabase
      .schema("ops")
      .from("users")
      .select("user_id, full_name, email")
      .returns<{ user_id: number; full_name: string | null; email: string }[]>(),
  ]);
  const userMap = new Map((users ?? []).map((u) => [u.user_id, u.full_name || u.email]));

  const chipActive = (c: (typeof CHIPS)[number]) =>
    (c.entity ?? "") === entity && (c.event ?? "") === event;
  const chipHref = (c: (typeof CHIPS)[number]) => {
    const p = new URLSearchParams();
    if (c.entity) p.set("entity", c.entity);
    if (c.event) p.set("event", c.event);
    const qs = p.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Every logged material state change (P3/I3). Append-only; the newest 250 matching events. Quality NCR/CAPA transitions have their own timeline on each record."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <Link
            key={c.label}
            href={chipHref(c)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              chipActive(c)
                ? "border-gold-600 bg-gold-50 text-gold-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="entity">Entity type contains</label>
          <input id="entity" name="entity" defaultValue={entity} className="field" placeholder="mfg.production_order" />
        </div>
        <div>
          <label className="label" htmlFor="event">Event type contains</label>
          <input id="event" name="event" defaultValue={event} className="field" placeholder="status_change" />
        </div>
        <button type="submit" className="btn-primary">Filter</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5">When</th>
              <th className="px-3 py-2.5">Entity</th>
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5">Actor</th>
              <th className="px-3 py-2.5">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events && events.length > 0 ? (
              events.map((e) => (
                <tr key={e.event_id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {fmtDateTime(e.created_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {e.entity_type}
                    <span className="text-slate-400"> #{e.entity_id}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {e.event_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {e.actor_id ? (userMap.get(e.actor_id) ?? `#${e.actor_id}`) : "system"}
                  </td>
                  <td className="max-w-[420px] px-3 py-2">
                    {e.detail ? (
                      <code className="block truncate text-xs text-slate-500" title={JSON.stringify(e.detail)}>
                        {JSON.stringify(e.detail)}
                      </code>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No matching events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
