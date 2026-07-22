import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { CapaTransition } from "./CapaTransition";

export const dynamic = "force-dynamic";

type Capa = {
  capa_id: number;
  capa_no: string;
  ncr_id: number | null;
  kind: string;
  root_cause: string | null;
  action_plan: string;
  owner_id: number;
  due_date: string;
  effectiveness_check: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
};

type Event = {
  event_id: number;
  from_status: string | null;
  to_status: string;
  actor_id: number;
  note: string | null;
  created_at: string;
};

export default async function CapaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const capaId = Number(id);
  if (!Number.isFinite(capaId)) notFound();

  const supabase = await createClient();
  const { data: capa } = await supabase
    .schema("quality")
    .from("capas")
    .select("*")
    .eq("capa_id", capaId)
    .maybeSingle<Capa>();
  if (!capa) notFound();

  const [{ data: events }, { data: users }] = await Promise.all([
    supabase
      .schema("quality")
      .from("status_events")
      .select("*")
      .eq("entity_type", "capa")
      .eq("entity_id", capaId)
      .order("created_at", { ascending: true })
      .returns<Event[]>(),
    supabase
      .schema("ops")
      .from("users")
      .select("user_id, full_name, email")
      .returns<{ user_id: number; full_name: string | null; email: string }[]>(),
  ]);

  const userName = (uid: number) => {
    const u = users?.find((x) => x.user_id === uid);
    return u?.full_name || u?.email || `user #${uid}`;
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/quality/capa"
          className="text-sm text-slate-500 hover:underline"
        >
          ← CAPAs
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{capa.capa_no}</h1>
        <StatusBadge value={capa.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Details
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Kind" value={titleCase(capa.kind)} />
              <Field label="Owner" value={userName(capa.owner_id)} />
              <Field label="Due date" value={fmtDate(capa.due_date)} />
              <Field
                label="Linked NCR"
                value={capa.ncr_id ? `#${capa.ncr_id}` : "—"}
              />
              <Field label="Created" value={fmtDateTime(capa.created_at)} />
              <Field label="Closed" value={fmtDateTime(capa.closed_at)} />
            </dl>

            <Block label="Root cause" value={capa.root_cause} />
            <Block label="Action plan" value={capa.action_plan} />
            <Block
              label="Effectiveness check"
              value={capa.effectiveness_check}
            />
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Transition
            </h2>
            <CapaTransition capaId={capa.capa_id} status={capa.status} />
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Status timeline (I9)
            </h2>
            <ol className="space-y-3">
              {(events ?? []).map((e) => (
                <li key={e.event_id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">
                      {e.from_status ? titleCase(e.from_status) : "—"} →
                    </span>
                    <StatusBadge value={e.to_status} />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {userName(e.actor_id)} · {fmtDateTime(e.created_at)}
                  </div>
                  {e.note && (
                    <p className="mt-1 text-xs text-slate-600">{e.note}</p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-700">{value}</dd>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
        {value || "—"}
      </p>
    </div>
  );
}
