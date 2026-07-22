import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { titleCase } from "@/lib/format";
import { AddVehicleForm } from "./AddVehicleForm";

export const dynamic = "force-dynamic";

type Vehicle = {
  vehicle_id: number;
  fleet_code: string;
  rego_no: string | null;
  make_model: string;
  kind: string;
  site: string;
  status: string;
};

export default async function VehiclesPage() {
  const supabase = await createClient();
  const { data: vehicles } = await supabase
    .schema("fleet")
    .from("vehicles")
    .select("vehicle_id, fleet_code, rego_no, make_model, kind, site, status")
    .order("fleet_code")
    .returns<Vehicle[]>();

  return (
    <div>
      <PageHeader
        title="Vehicles & plant"
        subtitle="The register seeded from the F0 census. Meter and fuel entry are mobile-first (F1)."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Rego</th>
                <th className="px-4 py-2.5">Vehicle</th>
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles && vehicles.length > 0 ? (
                vehicles.map((v) => (
                  <tr key={v.vehicle_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/fleet/vehicles/${v.vehicle_id}`}
                        className="font-medium text-gold-700 hover:underline"
                      >
                        {v.fleet_code}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{v.rego_no ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{v.make_model}</td>
                    <td className="px-4 py-2.5 text-slate-500">{titleCase(v.kind)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={v.status === "active" ? "current" : v.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    No vehicles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <AddVehicleForm />
      </div>
    </div>
  );
}
