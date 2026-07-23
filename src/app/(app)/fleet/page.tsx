import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type Vehicle = {
  vehicle_id: number;
  fleet_code: string;
  rego_no: string | null;
  make_model: string;
  kind: string;
  site: string;
  status: string;
  meter_kind: string;
};

type Renewal = {
  renewal_id: number;
  entity_type: string;
  entity_id: number;
  kind: string;
  due_date: string;
  status: string;
  days_left: number;
};

type CurrentAssignment = {
  assignment_id: number;
  vehicle_id: number;
  fleet_code: string;
  make_model: string;
  vehicle_kind: string;
  driver_id: number | null;
  assignment_site: string | null;
  assigned_from: string;
  note: string | null;
  days_assigned: number;
};

export default async function FleetPage() {
  const ctx = await getSessionContext();
  const isFleetAdmin = ctx?.roles.includes("fleet_admin") ?? false;
  const supabase = await createClient();

  const [{ data: vehicles }, { data: due }, { data: assignments }] =
    await Promise.all([
      supabase
        .schema("fleet")
        .from("vehicles")
        .select("vehicle_id, fleet_code, rego_no, make_model, kind, site, status, meter_kind")
        .order("fleet_code")
        .returns<Vehicle[]>(),
      supabase
        .schema("fleet")
        .from("v_due_renewals")
        .select("renewal_id, entity_type, entity_id, kind, due_date, status, days_left")
        .order("due_date", { ascending: true })
        .returns<Renewal[]>(),
      supabase
        .schema("fleet")
        .from("v_current_assignments")
        .select(
          "assignment_id, vehicle_id, fleet_code, make_model, vehicle_kind, driver_id, assignment_site, assigned_from, note, days_assigned",
        )
        .order("fleet_code")
        .returns<CurrentAssignment[]>(),
    ]);

  // Driver names are personal (F8) → resolved for fleet_admin only.
  let driverName = new Map<number, string>();
  if (isFleetAdmin) {
    const driverIds = Array.from(
      new Set((assignments ?? []).map((a) => a.driver_id).filter((x): x is number => !!x)),
    );
    if (driverIds.length) {
      const { data: drivers } = await supabase
        .schema("fleet")
        .from("drivers")
        .select("driver_id, user_id")
        .in("driver_id", driverIds)
        .returns<{ driver_id: number; user_id: number }[]>();
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
    }
  }
  const driverLabel = (id: number | null) =>
    id
      ? isFleetAdmin
        ? (driverName.get(id) ?? `Driver #${id}`)
        : "On file (restricted)"
      : "Pool / unassigned";

  const totalVehicles = vehicles?.length ?? 0;
  const activeAssignments = assignments?.length ?? 0;
  const assignedVehicleIds = new Set((assignments ?? []).map((a) => a.vehicle_id));
  const unassigned = (vehicles ?? []).filter((v) => !assignedVehicleIds.has(v.vehicle_id));

  return (
    <div>
      <PageHeader
        title="Fleet"
        subtitle="Vehicle & plant register, compliance renewals, job cards and fuel analytics. Gated after MAX Stage 1 (FG0); schema is laid."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Vehicles & plant" value={totalVehicles} />
        <StatTile label="Currently assigned" value={activeAssignments} />
        <StatTile label="Unassigned / pool" value={unassigned.length} />
      </div>

      <section className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Current assignments
            <span className="ml-2 text-xs font-normal text-slate-400">
              live holder per vehicle (F6)
            </span>
          </h2>
          {isFleetAdmin && (
            <Link href="/fleet/drivers" className="text-xs text-gold-700 hover:underline">
              Manage drivers →
            </Link>
          )}
        </div>
        {assignments && assignments.length > 0 ? (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1.5 pr-4">Vehicle</th>
                <th className="py-1.5 pr-4">Driver</th>
                <th className="py-1.5 pr-4">Site</th>
                <th className="py-1.5 pr-4">Since</th>
                <th className="py-1.5">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assignments.map((a) => (
                <tr key={a.assignment_id}>
                  <td className="py-1.5 pr-4">
                    <Link
                      href={`/fleet/vehicles/${a.vehicle_id}`}
                      className="font-medium text-gold-700 hover:underline"
                    >
                      {a.fleet_code}
                    </Link>
                    <span className="ml-2 text-slate-400">{a.make_model}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600">{driverLabel(a.driver_id)}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{a.assignment_site ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{fmtDate(a.assigned_from)}</td>
                  <td className="py-1.5 text-slate-500">{a.days_assigned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-4 text-sm text-slate-400">
            No vehicles are currently assigned. Assign one from its detail page.
          </p>
        )}
        {unassigned.length > 0 && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Unassigned / pool:{" "}
            {unassigned.map((v, i) => (
              <span key={v.vehicle_id}>
                {i > 0 && ", "}
                <Link href={`/fleet/vehicles/${v.vehicle_id}`} className="hover:underline">
                  {v.fleet_code}
                </Link>
              </span>
            ))}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Renewals due
          </h2>
          {due && due.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {due.map((r) => (
                <li
                  key={r.renewal_id}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-slate-700">
                    {titleCase(r.kind)}{" "}
                    <span className="text-slate-400">
                      · {r.entity_type} #{r.entity_id}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-500">{fmtDate(r.due_date)}</span>
                    <StatusBadge value={r.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-slate-400">
              Nothing due within the reminder window.
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Vehicle register
          </h2>
          {vehicles && vehicles.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 pr-4">Code</th>
                  <th className="py-1.5 pr-4">Rego</th>
                  <th className="py-1.5 pr-4">Vehicle</th>
                  <th className="py-1.5 pr-4">Kind</th>
                  <th className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.map((v) => (
                  <tr key={v.vehicle_id}>
                    <td className="py-1.5 pr-4 font-medium text-slate-700">
                      <Link
                        href={`/fleet/vehicles/${v.vehicle_id}`}
                        className="hover:underline"
                      >
                        {v.fleet_code}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500">
                      {v.rego_no ?? "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-600">
                      {v.make_model}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500">
                      {titleCase(v.kind)}
                    </td>
                    <td className="py-1.5">
                      <StatusBadge value={v.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-sm text-slate-400">
              No vehicles yet — captured during the F0 census walkaround.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
