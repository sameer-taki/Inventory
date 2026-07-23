import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { fmtDate, fmtDateTime, fmtFjd, titleCase } from "@/lib/format";
import { MeterForm, FuelForm, RenewalForm } from "./VehicleForms";
import { AssignForm, EndAssignmentForm } from "./AssignmentForms";

export const dynamic = "force-dynamic";

type Assignment = {
  assignment_id: number;
  driver_id: number | null;
  site: string | null;
  assigned_from: string;
  assigned_to: string | null;
  note: string | null;
};

type FuelSummary = {
  meter_kind: string;
  fill_count: number;
  total_litres: number;
  total_fuel_fjd: number;
  first_fill: string | null;
  last_fill: string | null;
  units_measured: number;
  avg_per_100_units: number | null;
  avg_cost_per_unit_fjd: number | null;
};
type Segment = {
  fuel_log_id: number;
  filled_at: string;
  distance_or_hours: number;
  litres: number;
  per_100_units: number | null;
  cost_per_unit_fjd: number | null;
  baseline_per_100_units: number | null;
  deviation_pct: number | null;
  is_anomaly: boolean;
};
type MonthlyCost = {
  month: string;
  fuel_fjd: number;
  parts_fjd: number;
  labour_fjd: number;
};

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

  const ctx = await getSessionContext();
  const roles = ctx?.roles ?? [];
  const isFleetAdmin = roles.includes("fleet_admin");
  const canAssign =
    isFleetAdmin || roles.includes("workshop") || roles.includes("admin");

  const supabase = await createClient();
  const { data: v } = await supabase
    .schema("fleet")
    .from("vehicles")
    .select("*")
    .eq("vehicle_id", vid)
    .maybeSingle<Vehicle>();
  if (!v) notFound();

  const [{ data: meters }, { data: fuel }, { data: renewals }, { data: assignments }] =
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
      supabase
        .schema("fleet")
        .from("assignments")
        .select("assignment_id, driver_id, site, assigned_from, assigned_to, note")
        .eq("vehicle_id", vid)
        .order("assigned_from", { ascending: false })
        .order("assignment_id", { ascending: false })
        .limit(10)
        .returns<Assignment[]>(),
    ]);

  const [{ data: fuelSummary }, { data: segments }, { data: monthly }] =
    await Promise.all([
      supabase
        .schema("fleet")
        .from("v_vehicle_fuel_summary")
        .select(
          "meter_kind, fill_count, total_litres, total_fuel_fjd, first_fill, last_fill, units_measured, avg_per_100_units, avg_cost_per_unit_fjd",
        )
        .eq("vehicle_id", vid)
        .maybeSingle<FuelSummary>(),
      supabase
        .schema("fleet")
        .from("v_consumption_anomaly")
        .select(
          "fuel_log_id, filled_at, distance_or_hours, litres, per_100_units, cost_per_unit_fjd, baseline_per_100_units, deviation_pct, is_anomaly",
        )
        .eq("vehicle_id", vid)
        .order("filled_at", { ascending: false })
        .limit(8)
        .returns<Segment[]>(),
      supabase
        .schema("fleet")
        .from("v_vehicle_monthly_cost")
        .select("month, fuel_fjd, parts_fjd, labour_fjd")
        .eq("vehicle_id", vid)
        .order("month", { ascending: false })
        .limit(6)
        .returns<MonthlyCost[]>(),
    ]);

  const unit = v.meter_kind; // 'km' | 'hours'
  const hasFuelData = (fuelSummary?.fill_count ?? 0) > 0;

  // Driver names are personal data (F8) → resolvable by fleet_admin only.
  const driverIds = Array.from(
    new Set((assignments ?? []).map((a) => a.driver_id).filter((x): x is number => !!x)),
  );
  let driverName = new Map<number, string>();
  let driverOptions: { driver_id: number; name: string }[] = [];
  if (isFleetAdmin) {
    const { data: drivers } = await supabase
      .schema("fleet")
      .from("drivers")
      .select("driver_id, user_id, is_active")
      .returns<{ driver_id: number; user_id: number; is_active: boolean }[]>();
    const userIds = Array.from(new Set((drivers ?? []).map((d) => d.user_id)));
    const { data: users } = userIds.length
      ? await supabase
          .schema("ops")
          .from("users")
          .select("user_id, full_name, email")
          .in("user_id", userIds)
          .returns<{ user_id: number; full_name: string | null; email: string }[]>()
      : { data: [] as { user_id: number; full_name: string | null; email: string }[] };
    const uMap = new Map((users ?? []).map((u) => [u.user_id, u.full_name || u.email]));
    driverName = new Map(
      (drivers ?? []).map((d) => [d.driver_id, uMap.get(d.user_id) ?? `User #${d.user_id}`]),
    );
    driverOptions = (drivers ?? [])
      .filter((d) => d.is_active)
      .map((d) => ({ driver_id: d.driver_id, name: uMap.get(d.user_id) ?? `User #${d.user_id}` }));
  }
  const openAssignment = (assignments ?? []).find((a) => !a.assigned_to);
  const driverLabel = (id: number | null) =>
    id ? (driverName.get(id) ?? (isFleetAdmin ? `Driver #${id}` : "On file (restricted)")) : "Pool / unassigned";

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

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Assignment log
              <span className="ml-2 text-xs font-normal text-slate-400">
                who holds this vehicle, and when (F6 — thin log)
              </span>
            </h2>
            {assignments && assignments.length > 0 ? (
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-1.5 pr-4">Driver</th>
                    <th className="py-1.5 pr-4">Site</th>
                    <th className="py-1.5 pr-4">Period</th>
                    <th className="py-1.5">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.map((a) => (
                    <tr key={a.assignment_id} className={a.assigned_to ? "" : "bg-emerald-50/40"}>
                      <td className="py-1.5 pr-4 font-medium text-slate-700">
                        {driverLabel(a.driver_id)}
                      </td>
                      <td className="py-1.5 pr-4 text-slate-500">{a.site ?? "—"}</td>
                      <td className="py-1.5 pr-4 text-slate-500">
                        {fmtDate(a.assigned_from)} →{" "}
                        {a.assigned_to ? (
                          fmtDate(a.assigned_to)
                        ) : (
                          <span className="font-medium text-emerald-700">current</span>
                        )}
                      </td>
                      <td className="py-1.5 text-slate-400">{a.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-400">No assignments recorded.</p>
            )}
            {canAssign && openAssignment && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  End current assignment
                </p>
                <EndAssignmentForm assignmentId={openAssignment.assignment_id} vehicleId={vid} />
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Fuel &amp; running cost
              <span className="ml-2 text-xs font-normal text-slate-400">
                deterministic SQL analytics (F4) · full-to-full basis
              </span>
            </h2>
            {hasFuelData ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Total fuel spend" value={fmtFjd(fuelSummary!.total_fuel_fjd)} />
                  <StatTile
                    label={`Cost / ${unitShort(unit)}`}
                    value={
                      fuelSummary!.avg_cost_per_unit_fjd != null
                        ? fmtFjd(fuelSummary!.avg_cost_per_unit_fjd)
                        : "—"
                    }
                  />
                  <StatTile
                    label={`L / 100 ${unitShort(unit)}`}
                    value={fuelSummary!.avg_per_100_units ?? "—"}
                  />
                  <StatTile
                    label={`Fills · ${unit === "km" ? "km" : "hrs"} run`}
                    value={`${fuelSummary!.fill_count} · ${fuelSummary!.units_measured}`}
                  />
                </div>

                {segments && segments.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Consumption per full-to-full segment
                    </p>
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-xs uppercase text-slate-400">
                        <tr>
                          <th className="py-1.5 pr-4">Filled</th>
                          <th className="py-1.5 pr-4">{titleCase(unit)}</th>
                          <th className="py-1.5 pr-4">Litres</th>
                          <th className="py-1.5 pr-4">L / 100 {unitShort(unit)}</th>
                          <th className="py-1.5 pr-4">FJD / {unitShort(unit)}</th>
                          <th className="py-1.5">vs baseline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {segments.map((s) => (
                          <tr key={s.fuel_log_id} className={s.is_anomaly ? "bg-amber-50/60" : ""}>
                            <td className="py-1.5 pr-4 text-slate-500">{fmtDate(s.filled_at)}</td>
                            <td className="py-1.5 pr-4 text-slate-600">{s.distance_or_hours}</td>
                            <td className="py-1.5 pr-4 text-slate-600">{s.litres}</td>
                            <td className="py-1.5 pr-4 text-slate-600">
                              {s.per_100_units ?? "—"}
                              {s.is_anomaly && (
                                <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                                  review
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-4 text-slate-600">{s.cost_per_unit_fjd ?? "—"}</td>
                            <td className="py-1.5 text-slate-500">
                              {s.deviation_pct != null ? (
                                <span
                                  className={
                                    s.is_anomaly
                                      ? "font-medium text-amber-700"
                                      : "text-slate-400"
                                  }
                                >
                                  {s.deviation_pct > 0 ? "+" : ""}
                                  {s.deviation_pct}%
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-slate-400">
                      &ldquo;Review&rdquo; flags a segment whose efficiency deviates ≥ 25% from this
                      vehicle&rsquo;s own baseline (needs ≥ 3 segments) — a possible leak, hard use,
                      or a mis-recorded fill (F4).
                    </p>
                  </div>
                )}

                {monthly && monthly.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Monthly running cost (fuel + closed job cards)
                    </p>
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-xs uppercase text-slate-400">
                        <tr>
                          <th className="py-1.5 pr-4">Month</th>
                          <th className="py-1.5 pr-4">Fuel</th>
                          <th className="py-1.5 pr-4">Parts</th>
                          <th className="py-1.5 pr-4">Labour</th>
                          <th className="py-1.5">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {monthly.map((m) => (
                          <tr key={m.month}>
                            <td className="py-1.5 pr-4 text-slate-600">
                              {new Date(m.month).toLocaleDateString("en-GB", {
                                month: "short",
                                year: "numeric",
                              })}
                            </td>
                            <td className="py-1.5 pr-4 text-slate-500">{fmtFjd(m.fuel_fjd)}</td>
                            <td className="py-1.5 pr-4 text-slate-500">{fmtFjd(m.parts_fjd)}</td>
                            <td className="py-1.5 pr-4 text-slate-500">{fmtFjd(m.labour_fjd)}</td>
                            <td className="py-1.5 font-medium text-slate-700">
                              {fmtFjd(Number(m.fuel_fjd) + Number(m.parts_fjd) + Number(m.labour_fjd))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-400">
                No fuel logged yet. Efficiency needs at least two full fills with
                meter readings; log fills on the right or via Fuel import.
              </p>
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
          {canAssign && (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Assign vehicle</h2>
              <AssignForm vehicleId={vid} drivers={driverOptions} />
              {!isFleetAdmin && (
                <p className="mt-2 text-xs text-slate-400">
                  Driver names are restricted to fleet_admin (F8); assign to a
                  site or leave as pool.
                </p>
              )}
            </section>
          )}
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

function unitShort(meterKind: string): string {
  return meterKind === "km" ? "km" : "hr";
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
