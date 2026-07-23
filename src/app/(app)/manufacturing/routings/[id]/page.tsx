import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtFjd } from "@/lib/format";
import { ApproveRoutingButton } from "../ApproveRoutingButton";

export const dynamic = "force-dynamic";

type Routing = {
  routing_id: number;
  item_id: number;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  source: string;
  created_at: string;
};
type Op = {
  operation_id: number;
  operation_seq: number;
  work_centre_id: number;
  description: string;
  setup_minutes: number;
  run_minutes_per_unit: number;
  queue_minutes: number;
};
type WC = {
  work_centre_id: number;
  code: string;
  name: string;
  labour_rate: number | null;
  overhead_rate: number | null;
};

function statusTone(s: string) {
  return s === "approved" ? "renewed" : s === "draft" ? "open" : s;
}

export default async function RoutingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rid = Number(id);
  if (!Number.isFinite(rid)) notFound();

  const supabase = await createClient();
  const { data: routing } = await supabase
    .schema("mfg")
    .from("routings")
    .select("*")
    .eq("routing_id", rid)
    .maybeSingle<Routing>();
  if (!routing) notFound();

  const [{ data: ops }, { data: versions }, { data: item }, { data: wcs }] =
    await Promise.all([
      supabase
        .schema("mfg")
        .from("routing_operations")
        .select("operation_id, operation_seq, work_centre_id, description, setup_minutes, run_minutes_per_unit, queue_minutes")
        .eq("routing_id", rid)
        .order("operation_seq")
        .returns<Op[]>(),
      supabase
        .schema("mfg")
        .from("routings")
        .select("routing_id, version_no, status, effective_from, effective_to, created_at")
        .eq("item_id", routing.item_id)
        .order("version_no", { ascending: false })
        .returns<Routing[]>(),
      supabase
        .schema("ops")
        .from("items")
        .select("item_no, description")
        .eq("item_id", routing.item_id)
        .maybeSingle<{ item_no: string; description: string }>(),
      supabase
        .schema("mfg")
        .from("work_centres")
        .select("work_centre_id, code, name, labour_rate, overhead_rate")
        .returns<WC[]>(),
    ]);
  const wcMap = new Map((wcs ?? []).map((w) => [w.work_centre_id, w]));

  // indicative standard time + labour/overhead cost per unit (planning figure —
  // the cost of record is the M2 costing roll-up view).
  let setupMin = 0;
  let runMinPerUnit = 0;
  let costPerUnit = 0;
  for (const o of ops ?? []) {
    setupMin += Number(o.setup_minutes);
    runMinPerUnit += Number(o.run_minutes_per_unit);
    const wc = wcMap.get(o.work_centre_id);
    const rate = (Number(wc?.labour_rate ?? 0) + Number(wc?.overhead_rate ?? 0)) / 60; // per minute
    costPerUnit += Number(o.run_minutes_per_unit) * rate;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/manufacturing/routings" className="text-sm text-slate-500 hover:underline">
          ← Routings
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">
          {item ? item.item_no : `Item ${routing.item_id}`} · Routing v{routing.version_no}
        </h1>
        <StatusBadge value={statusTone(routing.status)} />
        {routing.status === "draft" && <ApproveRoutingButton routingId={routing.routing_id} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Operations</h2>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 pr-4">Seq</th>
                  <th className="py-1.5 pr-4">Work centre</th>
                  <th className="py-1.5 pr-4">Description</th>
                  <th className="py-1.5 pr-4">Setup (min)</th>
                  <th className="py-1.5 pr-4">Run (min/unit)</th>
                  <th className="py-1.5">Queue (min)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(ops ?? []).map((o) => {
                  const wc = wcMap.get(o.work_centre_id);
                  return (
                    <tr key={o.operation_id}>
                      <td className="py-1.5 pr-4 text-slate-400">{o.operation_seq}</td>
                      <td className="py-1.5 pr-4 font-medium text-slate-700">
                        {wc ? wc.code : o.work_centre_id}
                        <span className="ml-1 text-slate-400">{wc?.name}</span>
                      </td>
                      <td className="py-1.5 pr-4 text-slate-600">{o.description}</td>
                      <td className="py-1.5 pr-4 text-slate-500">{o.setup_minutes}</td>
                      <td className="py-1.5 pr-4 text-slate-500">{o.run_minutes_per_unit}</td>
                      <td className="py-1.5 text-slate-500">{o.queue_minutes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Standard (indicative)</h2>
            <dl className="space-y-2 text-sm">
              <Field label="Item" value={item ? `${item.item_no} — ${item.description}` : String(routing.item_id)} />
              <Field label="Effective" value={`${fmtDate(routing.effective_from)}${routing.effective_to ? " → " + fmtDate(routing.effective_to) : ""}`} />
              <Field label="Setup total" value={`${setupMin.toFixed(2)} min`} />
              <Field label="Run / unit" value={`${runMinPerUnit.toFixed(4)} min`} />
              <Field label="Labour+OH / unit" value={fmtFjd(costPerUnit)} />
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Planning estimate from work-centre labour + overhead rates. The
              cost of record comes from the production cost roll-up (M2).
            </p>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Version history</h2>
            <ul className="space-y-1.5 text-sm">
              {(versions ?? []).map((v) => (
                <li key={v.routing_id} className="flex items-center justify-between">
                  <Link
                    href={`/manufacturing/routings/${v.routing_id}`}
                    className={`font-medium hover:underline ${v.routing_id === routing.routing_id ? "text-gold-800" : "text-gold-700"}`}
                  >
                    v{v.version_no}
                    {v.routing_id === routing.routing_id && " (viewing)"}
                  </Link>
                  <span className="flex items-center gap-2 text-slate-400">
                    <span>{fmtDate(v.effective_from)}</span>
                    <StatusBadge value={statusTone(v.status)} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value}</dd>
    </div>
  );
}
