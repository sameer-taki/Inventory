import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type CapaRow = {
  capa_id: number;
  capa_no: string;
  kind: string;
  status: string;
  due_date: string;
  ncr_id: number | null;
};

export default async function CapaListPage() {
  const supabase = await createClient();
  const { data: capas, error } = await supabase
    .schema("quality")
    .from("capas")
    .select("capa_id, capa_no, kind, status, due_date, ncr_id")
    .order("created_at", { ascending: false })
    .returns<CapaRow[]>();

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Corrective / preventive actions"
        subtitle="CAPA lifecycle with logged status transitions and an effectiveness check before closure."
        action={{ href: "/quality/capa/new", label: "Raise CAPA" }}
      />

      {error ? (
        <div className="card p-6 text-sm text-red-700">{error.message}</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">CAPA</th>
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Due</th>
                <th className="px-4 py-2.5">NCR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {capas && capas.length > 0 ? (
                capas.map((c) => {
                  const overdue = c.status !== "closed" && c.due_date < today;
                  return (
                    <tr key={c.capa_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/quality/capa/${c.capa_id}`}
                          className="font-medium text-gold-700 hover:underline"
                        >
                          {c.capa_no}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {titleCase(c.kind)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge value={c.status} />
                      </td>
                      <td
                        className={`px-4 py-2.5 ${
                          overdue ? "font-medium text-red-600" : "text-slate-500"
                        }`}
                      >
                        {fmtDate(c.due_date)}
                        {overdue && " · overdue"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {c.ncr_id ? (
                          <Link
                            href={`/quality/ncr/${c.ncr_id}`}
                            className="hover:underline"
                          >
                            #{c.ncr_id}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    No CAPAs raised yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
