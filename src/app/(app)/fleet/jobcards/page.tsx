import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtFjd, titleCase } from "@/lib/format";
import { OpenJobCardForm, JobCardTransition } from "./JobCardControls";

export const dynamic = "force-dynamic";

type Job = {
  job_id: number;
  job_no: string;
  vehicle_id: number;
  kind: string;
  workshop: string;
  status: string;
  parts_cost_fjd: number;
  labour_cost_fjd: number;
  po_ref: string | null;
  invoice_ref: string | null;
  opened_at: string;
};

export default async function JobCardsPage() {
  const supabase = await createClient();
  const [{ data: jobs }, { data: vehicles }] = await Promise.all([
    supabase
      .schema("fleet")
      .from("job_cards")
      .select("job_id, job_no, vehicle_id, kind, workshop, status, parts_cost_fjd, labour_cost_fjd, po_ref, invoice_ref, opened_at")
      .order("opened_at", { ascending: false })
      .returns<Job[]>(),
    supabase
      .schema("fleet")
      .from("vehicles")
      .select("vehicle_id, fleet_code")
      .order("fleet_code")
      .returns<{ vehicle_id: number; fleet_code: string }[]>(),
  ]);
  const vMap = new Map((vehicles ?? []).map((v) => [v.vehicle_id, v.fleet_code]));

  return (
    <div>
      <PageHeader
        title="Job cards"
        subtitle="Scheduled and breakdown work with cost + downtime capture. Parts reference a BC PO / invoice — BC stays the financial master (F1)."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Job</th>
                <th className="px-3 py-2.5">Vehicle</th>
                <th className="px-3 py-2.5">Kind</th>
                <th className="px-3 py-2.5">Cost</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs && jobs.length > 0 ? (
                jobs.map((j) => (
                  <tr key={j.job_id} className="align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-700">{j.job_no}</div>
                      <div className="text-xs text-slate-400">{fmtDate(j.opened_at)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {vMap.get(j.vehicle_id) ?? j.vehicle_id}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {titleCase(j.kind)}
                      <div className="text-xs text-slate-400">{j.workshop}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {fmtFjd((Number(j.parts_cost_fjd) || 0) + (Number(j.labour_cost_fjd) || 0))}
                      {j.invoice_ref && (
                        <div className="text-xs text-slate-400">inv {j.invoice_ref}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge value={j.status === "done" ? "renewed" : j.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <JobCardTransition jobId={j.job_id} status={j.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No job cards yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <OpenJobCardForm vehicles={vehicles ?? []} />
      </div>
    </div>
  );
}
