import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import { DriverForm } from "./DriverForm";

export const dynamic = "force-dynamic";

type Driver = {
  driver_id: number;
  user_id: number;
  licence_class: string;
  licence_expiry: string;
  forklift_certified: boolean;
  forklift_cert_expiry: string | null;
  is_active: boolean;
};
type User = { user_id: number; full_name: string | null; email: string };

function expiryTone(d: string): string {
  const days = (new Date(d).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "bg-red-50 text-red-700";
  if (days < 45) return "bg-amber-50 text-amber-800";
  return "text-slate-600";
}

export default async function DriversPage() {
  const ctx = await getSessionContext();
  if (!ctx?.roles.includes("fleet_admin")) {
    return (
      <div>
        <PageHeader title="Drivers" />
        <div className="card p-6 text-sm text-slate-600">
          Driver licence data is personal (F8). This screen is restricted to the{" "}
          <span className="font-medium">fleet_admin</span> role.
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: drivers }, { data: users }] = await Promise.all([
    supabase
      .schema("fleet")
      .from("drivers")
      .select(
        "driver_id, user_id, licence_class, licence_expiry, forklift_certified, forklift_cert_expiry, is_active",
      )
      .order("driver_id")
      .returns<Driver[]>(),
    supabase
      .schema("ops")
      .from("users")
      .select("user_id, full_name, email")
      .eq("is_active", true)
      .order("user_id")
      .returns<User[]>(),
  ]);
  const userMap = new Map((users ?? []).map((u) => [u.user_id, u.full_name || u.email]));
  const assignedIds = new Set((drivers ?? []).map((d) => d.user_id));
  const unassignedUsers = (users ?? []).filter((u) => !assignedIds.has(u.user_id));

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle="Thin driver records — licence class and expiry only (F8). HR remains the master for people; nothing else is stored here."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Person</th>
                  <th className="px-4 py-2.5">Licence class</th>
                  <th className="px-4 py-2.5">Licence expiry</th>
                  <th className="px-4 py-2.5">Forklift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers && drivers.length > 0 ? (
                  drivers.map((d) => (
                    <tr key={d.driver_id}>
                      <td className="px-4 py-2.5 font-medium text-slate-700">
                        {userMap.get(d.user_id) ?? `User #${d.user_id}`}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{d.licence_class}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 ${expiryTone(d.licence_expiry)}`}>
                          {fmtDate(d.licence_expiry)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {d.forklift_certified ? (
                          <span>
                            certified
                            {d.forklift_cert_expiry && (
                              <span className="ml-1 text-slate-400">
                                · {fmtDate(d.forklift_cert_expiry)}
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      No drivers yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Add driver</h2>
            {unassignedUsers.length > 0 ? (
              <DriverForm users={unassignedUsers} />
            ) : (
              <p className="text-sm text-slate-400">
                Every active platform user already has a driver record.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
