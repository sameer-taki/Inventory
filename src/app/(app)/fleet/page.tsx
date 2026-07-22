import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
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

export default async function FleetPage() {
  const supabase = await createClient();

  const [{ data: vehicles }, { data: due }] = await Promise.all([
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
  ]);

  return (
    <div>
      <PageHeader
        title="Fleet"
        subtitle="Vehicle & plant register, compliance renewals, job cards and fuel analytics. Gated after MAX Stage 1 (FG0); schema is laid."
      />

      <div className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        A register, a reminder engine, job cards, and fuel analytics — deliberately
        small. BC remains the financial master (F1); no GPS/telematics or TMS
        (F5/F6); driver licence data is fleet-admin-only (F8).
      </div>

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
                      {v.fleet_code}
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
