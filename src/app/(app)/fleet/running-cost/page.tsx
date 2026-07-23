import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { BarRow } from "@/components/BarRow";
import { fmtDate, fmtFjd } from "@/lib/format";

export const dynamic = "force-dynamic";

type Summary = {
  active_vehicles: number;
  fuelled_vehicles: number;
  total_fuel_fjd: number;
  total_maint_fjd: number;
  current_month_fjd: number;
};
type Monthly = {
  month: string;
  fuel_fjd: number;
  parts_fjd: number;
  labour_fjd: number;
  total_fjd: number;
  vehicle_count: number;
};
type VehicleRow = {
  vehicle_id: number;
  fleet_code: string;
  meter_kind: string;
  fill_count: number;
  total_fuel_fjd: number;
  avg_per_100_units: number | null;
  avg_cost_per_unit_fjd: number | null;
};
type MonthlyByVehicle = { vehicle_id: number; parts_fjd: number; labour_fjd: number };
type Anomaly = {
  fuel_log_id: number;
  vehicle_id: number;
  filled_at: string;
  distance_or_hours: number;
  litres: number;
  per_100_units: number;
  baseline_per_100_units: number;
  deviation_pct: number;
};

function unitShort(meterKind: string): string {
  return meterKind === "km" ? "km" : "hr";
}
function monthLabel(m: string): string {
  return new Date(m).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export default async function RunningCostPage() {
  const supabase = await createClient();
  const [{ data: summary }, { data: monthly }, { data: vehicles }, { data: vMonthly }] =
    await Promise.all([
      supabase
        .schema("fleet")
        .from("v_fleet_cost_summary")
        .select("active_vehicles, fuelled_vehicles, total_fuel_fjd, total_maint_fjd, current_month_fjd")
        .maybeSingle<Summary>(),
      supabase
        .schema("fleet")
        .from("v_fleet_monthly_cost")
        .select("month, fuel_fjd, parts_fjd, labour_fjd, total_fjd, vehicle_count")
        .order("month", { ascending: false })
        .limit(12)
        .returns<Monthly[]>(),
      supabase
        .schema("fleet")
        .from("v_vehicle_fuel_summary")
        .select("vehicle_id, fleet_code, meter_kind, fill_count, total_fuel_fjd, avg_per_100_units, avg_cost_per_unit_fjd")
        .order("fleet_code")
        .returns<VehicleRow[]>(),
      supabase
        .schema("fleet")
        .from("v_vehicle_monthly_cost")
        .select("vehicle_id, parts_fjd, labour_fjd")
        .returns<MonthlyByVehicle[]>(),
    ]);

  const { data: anomalies } = await supabase
    .schema("fleet")
    .from("v_consumption_anomaly")
    .select("fuel_log_id, vehicle_id, filled_at, distance_or_hours, litres, per_100_units, baseline_per_100_units, deviation_pct")
    .eq("is_anomaly", true)
    .order("filled_at", { ascending: false })
    .limit(20)
    .returns<Anomaly[]>();

  // per-vehicle maintenance spend (parts + labour), summed from the monthly view
  const maintByVehicle = new Map<number, number>();
  for (const r of vMonthly ?? []) {
    maintByVehicle.set(
      r.vehicle_id,
      (maintByVehicle.get(r.vehicle_id) ?? 0) + Number(r.parts_fjd) + Number(r.labour_fjd),
    );
  }

  // league: total running cost per vehicle (FJD) — unit-agnostic, comparable
  const league = (vehicles ?? [])
    .map((v) => ({
      ...v,
      maint_fjd: maintByVehicle.get(v.vehicle_id) ?? 0,
      total_fjd: Number(v.total_fuel_fjd) + (maintByVehicle.get(v.vehicle_id) ?? 0),
    }))
    .sort((a, b) => b.total_fjd - a.total_fjd);
  const leagueMax = league.reduce((m, v) => Math.max(m, v.total_fjd), 0);

  const months = [...(monthly ?? [])].reverse(); // chronological for the trend
  const monthMax = months.reduce((m, r) => Math.max(m, Number(r.total_fjd)), 0);

  const grandTotal =
    Number(summary?.total_fuel_fjd ?? 0) + Number(summary?.total_maint_fjd ?? 0);

  const vehicleMeta = new Map(
    (vehicles ?? []).map((v) => [v.vehicle_id, { fleet_code: v.fleet_code, meter_kind: v.meter_kind }]),
  );
  const flagged = anomalies ?? [];

  return (
    <div>
      <PageHeader
        title="Fleet running cost"
        subtitle="Deterministic SQL analytics (F4) across the fleet — fuel from the pump logs, maintenance from closed job cards. BC remains the financial master (F1); these are operational figures, not GL."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total running cost" value={fmtFjd(grandTotal)} />
        <StatTile label="Fuel" value={fmtFjd(summary?.total_fuel_fjd ?? 0)} />
        <StatTile label="Maintenance" value={fmtFjd(summary?.total_maint_fjd ?? 0)} />
        <StatTile
          label="This month"
          value={fmtFjd(summary?.current_month_fjd ?? 0)}
          hint={`${summary?.fuelled_vehicles ?? 0} of ${summary?.active_vehicles ?? 0} vehicles fuelled`}
        />
      </div>

      <section
        className={`card mb-6 p-5 ${flagged.length > 0 ? "border-amber-300 bg-amber-50/40" : ""}`}
      >
        <h2 className="mb-1 text-sm font-semibold text-slate-700">
          Fills to review
          <span className="ml-2 text-xs font-normal text-slate-400">
            efficiency anomalies vs each vehicle&rsquo;s baseline (F4)
          </span>
        </h2>
        {flagged.length > 0 ? (
          <table className="mt-2 min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1.5 pr-4">Vehicle</th>
                <th className="py-1.5 pr-4">Filled</th>
                <th className="py-1.5 pr-4">Distance / hrs</th>
                <th className="py-1.5 pr-4">Litres</th>
                <th className="py-1.5 pr-4">L / 100</th>
                <th className="py-1.5 pr-4">Baseline</th>
                <th className="py-1.5">Deviation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {flagged.map((a) => {
                const meta = vehicleMeta.get(a.vehicle_id);
                const u = meta ? unitShort(meta.meter_kind) : "";
                return (
                  <tr key={a.fuel_log_id}>
                    <td className="py-1.5 pr-4">
                      <Link
                        href={`/fleet/vehicles/${a.vehicle_id}`}
                        className="font-medium text-gold-700 hover:underline"
                      >
                        {meta?.fleet_code ?? `#${a.vehicle_id}`}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500">{fmtDate(a.filled_at)}</td>
                    <td className="py-1.5 pr-4 text-slate-600">
                      {a.distance_or_hours} {u}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-600">{a.litres}</td>
                    <td className="py-1.5 pr-4 text-slate-700">{a.per_100_units}</td>
                    <td className="py-1.5 pr-4 text-slate-400">{a.baseline_per_100_units}</td>
                    <td className="py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          a.deviation_pct > 0
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {a.deviation_pct > 0 ? "+" : ""}
                        {a.deviation_pct}% {a.deviation_pct > 0 ? "· high" : "· low"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="py-2 text-sm text-slate-500">
            No fills flagged — every full-to-full segment is within 25% of its
            vehicle&rsquo;s baseline (vehicles need ≥ 3 segments to be assessed).
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">
            Total running cost by vehicle
          </h2>
          <p className="mb-3 text-xs text-slate-400">
            Fuel + maintenance, FJD. Comparable across meter kinds; per-unit
            efficiency is in the table below.
          </p>
          {league.length > 0 ? (
            <div className="space-y-0.5">
              {league.map((v) => (
                <BarRow
                  key={v.vehicle_id}
                  label={v.fleet_code}
                  value={v.total_fjd}
                  max={leagueMax}
                  display={fmtFjd(v.total_fjd)}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-slate-400">No cost data yet.</p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">
            Fleet running cost by month
          </h2>
          <p className="mb-3 text-xs text-slate-400">
            Fuel + closed job cards, all vehicles, most recent 12 months.
          </p>
          {months.length > 0 ? (
            <div className="space-y-0.5">
              {months.map((m) => (
                <BarRow
                  key={m.month}
                  label={monthLabel(m.month)}
                  value={Number(m.total_fjd)}
                  max={monthMax}
                  display={fmtFjd(m.total_fjd)}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-slate-400">No monthly cost yet.</p>
          )}
        </section>
      </div>

      <section className="card mt-6 overflow-x-auto p-0">
        <div className="p-5 pb-3">
          <h2 className="text-sm font-semibold text-slate-700">Per-vehicle breakdown</h2>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Vehicle</th>
              <th className="px-4 py-2.5">Fuel</th>
              <th className="px-4 py-2.5">Maintenance</th>
              <th className="px-4 py-2.5">Total</th>
              <th className="px-4 py-2.5">Efficiency</th>
              <th className="px-4 py-2.5">Cost / unit</th>
              <th className="px-4 py-2.5">Fills</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {league.length > 0 ? (
              league.map((v) => (
                <tr key={v.vehicle_id}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/fleet/vehicles/${v.vehicle_id}`}
                      className="font-medium text-gold-700 hover:underline"
                    >
                      {v.fleet_code}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtFjd(v.total_fuel_fjd)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtFjd(v.maint_fjd)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{fmtFjd(v.total_fjd)}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {v.avg_per_100_units != null
                      ? `${v.avg_per_100_units} L/100${unitShort(v.meter_kind)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {v.avg_cost_per_unit_fjd != null
                      ? `${fmtFjd(v.avg_cost_per_unit_fjd)}/${unitShort(v.meter_kind)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{v.fill_count}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No vehicles with cost data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
