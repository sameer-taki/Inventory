import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, titleCase } from "@/lib/format";
import { runRemindersAction } from "../actions";
import { CompleteRenewalForm } from "./CompleteRenewalForm";

export const dynamic = "force-dynamic";

type Renewal = {
  renewal_id: number;
  entity_type: string;
  entity_id: number;
  kind: string;
  reference_no: string | null;
  due_date: string;
  status: string;
};

export default async function RenewalsPage() {
  const supabase = await createClient();
  const [{ data: renewals }, { data: vehicles }] = await Promise.all([
    supabase
      .schema("fleet")
      .from("renewals")
      .select("renewal_id, entity_type, entity_id, kind, reference_no, due_date, status")
      .neq("status", "renewed")
      .neq("status", "na")
      .order("due_date")
      .returns<Renewal[]>(),
    supabase
      .schema("fleet")
      .from("vehicles")
      .select("vehicle_id, fleet_code")
      .returns<{ vehicle_id: number; fleet_code: string }[]>(),
  ]);
  const vMap = new Map((vehicles ?? []).map((v) => [v.vehicle_id, v.fleet_code]));

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Renewals</h1>
          <p className="mt-1 text-sm text-slate-500">
            LTA registration, fitness (CoF), insurance, statutory plant
            inspections. The reminder engine escalates due/overdue items
            automatically each night (06:00 Fiji); use the button to run it now.
          </p>
        </div>
        <form action={runRemindersAction}>
          <button type="submit" className="btn-secondary">
            Run now
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">For</th>
              <th className="px-4 py-2.5">Kind</th>
              <th className="px-4 py-2.5">Reference</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {renewals && renewals.length > 0 ? (
              renewals.map((r) => (
                <tr key={r.renewal_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-600">
                    {r.entity_type === "vehicle"
                      ? (vMap.get(r.entity_id) ?? `vehicle #${r.entity_id}`)
                      : `driver #${r.entity_id}`}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{titleCase(r.kind)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.reference_no ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.due_date)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge value={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <CompleteRenewalForm renewalId={r.renewal_id} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No open renewals.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
