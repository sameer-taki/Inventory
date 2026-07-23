import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime, fmtFjd, titleCase } from "@/lib/format";
import { MeterForm, FuelForm, RenewalForm } from "./VehicleForms";

export const dynamic = "force-dynamic";

type Vehicle = {
  vehicle_id: number;
  fleet_code: string;
  rego_no: string | null;
  make_model: string;
  year: number | null;
  kind: string;
  site: string;
  ownership: string;
  meter_kind: string;
  fuel_kind: string | null;
  status: string;
};

export default async function VehicleDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vid = Number(id);
  if (!Number.isFinite(vid)) notFound();

  const supabase = await createClient();
  const { data: v } = await supabase
    .schema("fleet")
    .from("vehicles")
    .select("*")
    .eq("vehicle_id", vid)
    .maybeSingle<Vehicle>();
  if (!v) notFound();

  const [{ data: meters }, { data: fuel }, { data: renewals }] =
    await Promise.all([
      supabase
        .schema("fleet")
        .from("meter_readings")
        .select("reading_id, reading, read_at, source, is_flagged, flag_reason")
        .eq("vehicle_id", vid)
        .order("read_at", { ascending: false })
        .limit(5)
        .returns<{ reading_id: number; reading: number; read_at: string; source: string; is_flagged: boolean; flag_reason: string | null }[]>(),
      supabase
        .schema("fleet")
        .from("fuel_logs")
        .select("fuel_log_id, filled_at, litres, cost_fjd, meter_reading")
        .eq("vehicle_id", vid)
        .order("filled_at", { ascending: false })
        .limit(5)
        .returns<{ fuel_log_id: number; filled_at: string; litres: number; cost_fjd: number; meter_reading: number | null }[]>(),
      supabase
        .schema("fleet")
        .from("renewals")
        .select("renewal_id, kind, due_date, status, reference_no")
        .eq("entity_type", "vehicle")
        .eq("entity_id", vid)
        .neq("status", "renewed")
        .order("due_date")
        .returns<{ renewal_id: number; kind: string; due_date: string; status: string; reference_no: string | null }[]>(),
    ]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link href="/fleet/vehicles" className="text-sm text-slate-500 hover:underline">
          ← Vehicles
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{v.fleet_code}</h1>
        <StatusBadge value={v.status === "active" ? "current" : v.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Vehicle</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Field label="Make / model" value={v.make_model} />
              <Field label="Rego" value={v.rego_no ?? "—"} />
              <Field label="Year" value={v.year?.toString() ?? "—"} />
              <Field label="Kind" value={titleCase(v.kind)} />
              <Field label="Site" value={v.site} />
              <Field label="Ownership" value={titleCase(v.ownership)} />
              <Field label="Meter" value={v.meter_kind} />
              <Field label="Fuel" value={v.fuel_kind ?? "—"} />
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Open renewals</h2>
            {renewals && renewals.length > 0 ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {renewals.map((r) => (
                  <li key={r.renewal_id} className="flex items-center justify-between py-2">
                    <span className="text-slate-700">
                      {titleCase(r.kind)}
                      {r.reference_no && (
                        <span className="ml-2 text-slate-400">{r.reference_no}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-slate-500">{fmtDate(r.due_date)}</span>
                      <StatusBadge value={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No open renewals.</p>
            )}
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent meter readings</h2>
              {meters && meters.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {meters.map((m) => (
                    <li key={m.reading_id} className="flex justify-between">
                      <span className="text-slate-700">
                        {m.reading} {v.meter_kind}
                        {m.is_flagged && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">
                            flagged
                          </span>
                        )}
                      </span>
                      <span className="text-slate-400">{fmtDateTime(m.read_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No readings yet.</p>
              )}
            </section>
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent fills</h2>
              {fuel && fuel.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {fuel.map((f) => (
                    <li key={f.fuel_log_id} className="flex justify-between">
                      <span className="text-slate-700">
                        {f.litres} L · {fmtFjd(f.cost_fjd)}
                      </span>
                      <span className="text-slate-400">{fmtDate(f.filled_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No fills yet.</p>
              )}
            </section>
          </div>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Record meter</h2>
            <MeterForm vehicleId={vid} />
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Log fuel</h2>
            <FuelForm vehicleId={vid} />
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Add renewal</h2>
            <RenewalForm vehicleId={vid} />
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
