import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { BarRow } from "@/components/BarRow";

export const dynamic = "force-dynamic";

type Load = {
  work_centre_id: number;
  code: string;
  name: string;
  plant: string;
  effective_daily_capacity: number;
  required_minutes: number;
  load_pct: number | null;
};

export default async function CapacityPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .schema("mfg")
    .from("v_work_centre_load")
    .select("*")
    .order("code")
    .returns<Load[]>();

  const load = rows ?? [];

  return (
    <div>
      <PageHeader
        title="Capacity — work-centre load"
        subtitle="Advisory (M5): required minutes from open production orders vs effective daily capacity. Overloaded centres are flagged; scheduling stays infinite-capacity until M2/M4 are stable."
      />

      <section className="card mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Load vs capacity</h2>
        {load.length > 0 ? (
          <div className="space-y-1">
            {load.map((w) => {
              const pct = w.load_pct ?? 0;
              const tone = pct > 100 ? "danger" : pct > 85 ? "warn" : "good";
              return (
                <BarRow
                  key={w.work_centre_id}
                  label={`${w.code} — ${w.name}`}
                  value={pct}
                  max={Math.max(100, pct)}
                  display={`${pct}%`}
                  tone={tone}
                />
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-sm text-slate-400">No active work centres.</p>
        )}
      </section>

      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Work centre</th>
              <th className="px-4 py-2.5">Plant</th>
              <th className="px-4 py-2.5">Required (min)</th>
              <th className="px-4 py-2.5">Capacity/day (min)</th>
              <th className="px-4 py-2.5">Load</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {load.map((w) => {
              const pct = w.load_pct ?? 0;
              return (
                <tr key={w.work_centre_id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-700">{w.code}</span>{" "}
                    <span className="text-slate-400">{w.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{w.plant}</td>
                  <td className="px-4 py-2.5 text-slate-600">{w.required_minutes}</td>
                  <td className="px-4 py-2.5 text-slate-600">{w.effective_daily_capacity}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        pct > 100
                          ? "bg-red-100 text-red-800"
                          : pct > 85
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {pct}%{pct > 100 ? " · overloaded" : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
