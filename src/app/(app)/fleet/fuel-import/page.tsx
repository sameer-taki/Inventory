import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate, fmtFjd } from "@/lib/format";
import { FuelImportUpload } from "./FuelImportUpload";
import { ImportRowButtons } from "./ImportRowButtons";

export const dynamic = "force-dynamic";

type Row = {
  row_id: number;
  batch_id: number;
  fleet_code: string | null;
  vehicle_id: number | null;
  filled_at: string | null;
  litres: number | null;
  cost_fjd: number | null;
  meter_reading: number | null;
  status: string;
};

export default async function FuelImportPage() {
  const supabase = await createClient();
  const { data: pending } = await supabase
    .schema("fleet")
    .from("fuel_import_rows")
    .select("row_id, batch_id, fleet_code, vehicle_id, filled_at, litres, cost_fjd, meter_reading, status")
    .eq("status", "pending")
    .order("row_id")
    .returns<Row[]>();

  return (
    <div>
      <PageHeader
        title="Fuel statement import"
        subtitle="Upload a fuel-card statement; rows are staged and only become fuel logs once verified (F3). No imported figure enters analytics unverified."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <FuelImportUpload />
        </div>

        <div className="card overflow-hidden lg:col-span-2">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
            Verification queue ({pending?.length ?? 0} pending)
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Litres</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Meter</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pending && pending.length > 0 ? (
                pending.map((r) => (
                  <tr key={r.row_id}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-700">{r.fleet_code ?? "—"}</span>
                      {!r.vehicle_id && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">
                          unmatched
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(r.filled_at)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.litres ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtFjd(r.cost_fjd)}</td>
                    <td className="px-3 py-2 text-slate-500">{r.meter_reading ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <ImportRowButtons rowId={r.row_id} matched={Boolean(r.vehicle_id)} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Nothing awaiting verification. Upload a statement to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
