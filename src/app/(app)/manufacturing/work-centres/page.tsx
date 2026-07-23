import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { fmtFjd } from "@/lib/format";
import { WorkCentreForm } from "./WorkCentreForm";

export const dynamic = "force-dynamic";

type WC = {
  work_centre_id: number;
  code: string;
  name: string;
  plant: string;
  daily_capacity: number;
  efficiency_pct: number;
  labour_rate: number | null;
  is_active: boolean;
};

export default async function WorkCentresPage() {
  const supabase = await createClient();
  const { data: wcs } = await supabase
    .schema("mfg")
    .from("work_centres")
    .select("*")
    .order("code")
    .returns<WC[]>();

  return (
    <div>
      <PageHeader
        title="Work centres"
        subtitle="Capacity + labour rates feed routings, the capacity load view (M5) and the cost roll."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Plant</th>
                <th className="px-4 py-2.5">Cap/day</th>
                <th className="px-4 py-2.5">Eff %</th>
                <th className="px-4 py-2.5">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wcs && wcs.length > 0 ? (
                wcs.map((w) => (
                  <tr key={w.work_centre_id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{w.code}</td>
                    <td className="px-4 py-2.5 text-slate-600">{w.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">{w.plant}</td>
                    <td className="px-4 py-2.5 text-slate-500">{w.daily_capacity}</td>
                    <td className="px-4 py-2.5 text-slate-500">{w.efficiency_pct}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {w.labour_rate ? fmtFjd(w.labour_rate) : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No work centres yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <WorkCentreForm />
      </div>
    </div>
  );
}
