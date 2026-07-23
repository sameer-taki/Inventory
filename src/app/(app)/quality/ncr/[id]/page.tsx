import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { NcrTransition } from "./NcrTransition";

export const dynamic = "force-dynamic";

type Ncr = {
  ncr_id: number;
  ncr_no: string;
  source: string;
  plant: string | null;
  item_id: number | null;
  lot_no: string | null;
  production_order_id: number | null;
  description: string;
  severity: string;
  disposition: string | null;
  status: string;
  raised_by: number;
  raised_at: string;
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

export default async function NcrDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ncrId = Number(id);
  if (!Number.isFinite(ncrId)) notFound();

  const supabase = await createClient();

  const { data: ncr } = await supabase
    .schema("quality")
    .from("ncrs")
    .select("*")
    .eq("ncr_id", ncrId)
    .maybeSingle<Ncr>();

  if (!ncr) notFound();

  const [{ data: events }, { data: capas }, { data: users }, { data: item }] =
    await Promise.all([
      supabase
        .schema("quality")
        .from("status_events")
        .select("*")
        .eq("entity_type", "ncr")
        .eq("entity_id", ncrId)
        .order("created_at", { ascending: true })
        .returns<Event[]>(),
      supabase
        .schema("quality")
        .from("capas")
        .select("capa_id, capa_no, kind, status, due_date")
        .eq("ncr_id", ncrId)
        .returns<
          {
            capa_id: number;
            capa_no: string;
            kind: string;
            status: string;
            due_date: string;
          }[]
        >(),
      supabase
        .schema("ops")
        .from("users")
        .select("user_id, full_name, email")
        .returns<{ user_id: number; full_name: string | null; email: string }[]>(),
      ncr.item_id
        ? supabase
            .schema("ops")
            .from("items")
            .select("item_no, description")
            .eq("item_id", ncr.item_id)
            .maybeSingle<{ item_no: string; description: string }>()
        : Promise.resolve({ data: null }),
    ]);

  const userName = (uid: number) => {
    const u = users?.find((x) => x.user_id === uid);
    return u?.full_name || u?.email || `user #${uid}`;
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/quality/ncr"
          className="text-sm text-slate-500 hover:underline"
        >
          ← NCRs
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{ncr.ncr_no}</h1>
        <StatusBadge value={ncr.status} />
        <StatusBadge value={ncr.severity} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Details
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Source" value={titleCase(ncr.source)} />
              <Field label="Plant" value={ncr.plant ?? "—"} />
              <Field
                label="Item"
                value={item ? `${item.item_no} — ${item.description}` : "—"}
              />
              <Field label="Lot" value={ncr.lot_no ?? "—"} />
              <Field
                label="Production order"
                value={ncr.production_order_id?.toString() ?? "—"}
              />
              <Field label="Disposition" value={ncr.disposition ?? "—"} />
              <Field label="Raised by" value={userName(ncr.raised_by)} />
              <Field label="Raised at" value={fmtDateTime(ncr.raised_at)} />
              <Field label="Closed at" value={fmtDateTime(ncr.closed_at)} />
            </dl>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Description
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {ncr.description}
              </p>
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Linked CAPAs
              </h2>
              <Link
                href={`/quality/capa/new?ncr_id=${ncr.ncr_id}`}
                className="text-xs font-medium text-gold-700 hover:underline"
              >
                Raise CAPA
              </Link>
            </div>
            {capas && capas.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {capas.map((c) => (
                  <li
                    key={c.capa_id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <Link
                      href={`/quality/capa/${c.capa_id}`}
                      className="font-medium text-gold-700 hover:underline"
                    >
                      {c.capa_no}
                    </Link>
                    <div className="flex items-center gap-3 text-slate-500">
                      <span>{titleCase(c.kind)}</span>
                      <span>due {fmtDate(c.due_date)}</span>
                      <StatusBadge value={c.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-sm text-slate-400">
                No CAPAs linked to this NCR yet.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Disposition / transition
            </h2>
            <NcrTransition ncrId={ncr.ncr_id} status={ncr.status} />
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
