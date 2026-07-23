import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { fmtFjd } from "@/lib/format";

export const dynamic = "force-dynamic";

const BUILD = [
  { m: "M3", name: "BOMs / routings / work centres", note: "maintenance UI + versioning (ECO-lite); migration loads" },
  { m: "M2", name: "Production orders + shop-floor execution", note: "D-3 write-back spike first (assembly order vs item journal)" },
  { m: "M4", name: "MRP / MPS netting engine", note: "golden-dataset harness is the first ticket; validated hardest" },
  { m: "M5", name: "Capacity scheduling", note: "advisory load view first" },
  { m: "M6", name: "Lot/serial genealogy", note: "append-only edges from first M2 posting; mock-recall drill" },
];

export default async function ManufacturingPage() {
  const supabase = await createClient();
  const [{ data: workCentres }, { data: items }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("work_centres")
      .select("code, name, plant, daily_capacity, labour_rate, is_active")
      .order("code")
      .returns<
        {
          code: string;
          name: string;
          plant: string;
          daily_capacity: number;
          labour_rate: number | null;
          is_active: boolean;
        }[]
      >(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_no, description, make_or_buy, item_category")
      .order("item_no")
      .returns<
        {
          item_no: string;
          description: string;
          make_or_buy: string | null;
          item_category: string | null;
        }[]
      >(),
  ]);

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        subtitle="MAX replacement — the Premium-only manufacturing slice, built as platform modules. Schema is laid; module UIs follow the locked build order."
      />

      <div className="mb-6 rounded-md border border-gold-200 bg-gold-50 p-4 text-sm text-gold-900">
        <p className="font-medium">Scope guardrails (invariants):</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-gold-800">
          <li>BC Essentials stays the inventory + costing master (I1). If a quantity disagrees with BC, BC is right.</li>
          <li>Every BC posting goes through the outbox with an idempotency key (I2); no direct OData writes.</li>
          <li>Corrugated stays in Kiwiplan; the mfg BOM never mirrors it (I5).</li>
          <li>All planning/costing math is deterministic SQL/Python (I4).</li>
        </ul>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Work centres
          </h2>
          {workCentres && workCentres.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 pr-4">Code</th>
                  <th className="py-1.5 pr-4">Name</th>
                  <th className="py-1.5 pr-4">Plant</th>
                  <th className="py-1.5 pr-4">Cap/day</th>
                  <th className="py-1.5">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workCentres.map((w) => (
                  <tr key={w.code}>
                    <td className="py-1.5 pr-4 font-medium text-slate-700">
                      {w.code}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-600">{w.name}</td>
                    <td className="py-1.5 pr-4 text-slate-500">{w.plant}</td>
                    <td className="py-1.5 pr-4 text-slate-500">
                      {w.daily_capacity}
                    </td>
                    <td className="py-1.5 text-slate-500">
                      {w.labour_rate ? fmtFjd(w.labour_rate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-sm text-slate-400">
              No work centres yet — seeded during M3 masters migration.
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Canonical items{" "}
            <span className="font-normal text-slate-400">
              (mirror of BC master)
            </span>
          </h2>
          {items && items.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {items.map((it) => (
                <li key={it.item_no} className="flex justify-between py-1.5">
                  <span>
                    <span className="font-medium text-slate-700">
                      {it.item_no}
                    </span>{" "}
                    <span className="text-slate-500">{it.description}</span>
                  </span>
                  <span className="text-xs uppercase text-slate-400">
                    {it.make_or_buy ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-slate-400">
              No items yet — synced from BC via the gateway adapter.
            </p>
          )}
        </section>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Build order (locked, MAX plan §5)
        </h2>
        <ul className="space-y-2 text-sm">
          {BUILD.map((b) => (
            <li key={b.m} className="flex gap-3">
              <span className="w-10 shrink-0 font-mono text-xs text-slate-400">
                {b.m}
              </span>
              <span>
                <span className="font-medium text-slate-700">{b.name}</span>
                <span className="text-slate-500"> — {b.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
