import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime, fmtFjd } from "@/lib/format";
import { POActions } from "./POActions";

export const dynamic = "force-dynamic";

type PoCost = {
  qty_completed: number;
  components_without_cost: number;
  std_material_per_unit: number;
  std_conv_per_unit: number;
  std_cost_per_unit: number;
  earned_standard_cost: number;
  actual_material_cost: number;
  actual_labour_cost: number;
  actual_total_cost: number;
  variance_fjd: number;
};

type PO = {
  production_order_id: number;
  order_no: string;
  item_id: number;
  bom_id: number;
  routing_id: number | null;
  plant: string;
  qty_ordered: number;
  qty_completed: number;
  qty_scrapped: number;
  uom: string;
  due_date: string;
  status: string;
  origin: string;
};

type Completion = {
  completion_id: number;
  seq: number;
  qty_good: number;
  qty_scrap: number;
  output_lot_no: string | null;
  posted_at: string;
  bc_document_no: string | null;
  outbox_id: number | null;
};

export default async function ProductionOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const poId = Number(id);
  if (!Number.isFinite(poId)) notFound();

  const supabase = await createClient();
  const { data: po } = await supabase
    .schema("mfg")
    .from("production_orders")
    .select("*")
    .eq("production_order_id", poId)
    .maybeSingle<PO>();
  if (!po) notFound();

  const [{ data: item }, { data: bomLines }, { data: completions }] =
    await Promise.all([
      supabase
        .schema("ops")
        .from("items")
        .select("item_no, description")
        .eq("item_id", po.item_id)
        .maybeSingle<{ item_no: string; description: string }>(),
      supabase
        .schema("mfg")
        .from("bom_lines")
        .select("component_item_id, qty_per, uom")
        .eq("bom_id", po.bom_id)
        .returns<{ component_item_id: number; qty_per: number; uom: string }[]>(),
      supabase
        .schema("mfg")
        .from("completions")
        .select("completion_id, seq, qty_good, qty_scrap, output_lot_no, posted_at, bc_document_no, outbox_id")
        .eq("production_order_id", poId)
        .order("seq")
        .returns<Completion[]>(),
    ]);

  const { data: cost } = await supabase
    .schema("mfg")
    .from("v_po_cost")
    .select(
      "qty_completed, components_without_cost, std_material_per_unit, std_conv_per_unit, std_cost_per_unit, earned_standard_cost, actual_material_cost, actual_labour_cost, actual_total_cost, variance_fjd",
    )
    .eq("production_order_id", poId)
    .maybeSingle<PoCost>();

  const { data: compItems } = await supabase
    .schema("ops")
    .from("items")
    .select("item_id, item_no")
    .in("item_id", (bomLines ?? []).map((l) => l.component_item_id).concat([-1]))
    .returns<{ item_id: number; item_no: string }[]>();
  const compMap = new Map((compItems ?? []).map((i) => [i.item_id, i.item_no]));

  const components = (bomLines ?? []).map((l) => ({
    component_item_id: l.component_item_id,
    item_no: compMap.get(l.component_item_id) ?? String(l.component_item_id),
    uom: l.uom,
    qty_per: l.qty_per,
  }));

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link href="/manufacturing/production" className="text-sm text-slate-500 hover:underline">
          ← Production
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{po.order_no}</h1>
        <StatusBadge value={po.status === "in_progress" ? "in_progress" : po.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Order</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <Field label="Item" value={item ? `${item.item_no}` : String(po.item_id)} />
              <Field label="Plant" value={po.plant} />
              <Field label="Origin" value={po.origin} />
              <Field label="Ordered" value={`${po.qty_ordered} ${po.uom}`} />
              <Field label="Completed" value={`${po.qty_completed} ${po.uom}`} />
              <Field label="Scrapped" value={`${po.qty_scrapped} ${po.uom}`} />
              <Field label="Due" value={fmtDate(po.due_date)} />
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Completions ({completions?.length ?? 0})
            </h2>
            {completions && completions.length > 0 ? (
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-1.5 pr-4">#</th>
                    <th className="py-1.5 pr-4">Good</th>
                    <th className="py-1.5 pr-4">Scrap</th>
                    <th className="py-1.5 pr-4">Output lot</th>
                    <th className="py-1.5 pr-4">Posted</th>
                    <th className="py-1.5">BC / outbox</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {completions.map((c) => (
                    <tr key={c.completion_id}>
                      <td className="py-1.5 pr-4">{c.seq}</td>
                      <td className="py-1.5 pr-4">{c.qty_good}</td>
                      <td className="py-1.5 pr-4">{c.qty_scrap}</td>
                      <td className="py-1.5 pr-4 text-slate-500">{c.output_lot_no ?? "—"}</td>
                      <td className="py-1.5 pr-4 text-slate-500">{fmtDateTime(c.posted_at)}</td>
                      <td className="py-1.5 text-slate-500">
                        {c.bc_document_no
                          ? `BC ${c.bc_document_no}`
                          : c.outbox_id
                            ? `queued #${c.outbox_id}`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-400">No completions posted yet.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700">
              Cost roll-up
              <span className="ml-2 text-xs font-normal text-slate-400">
                standard vs actual · deterministic (I4)
              </span>
            </h2>
            {cost ? (
              <>
                <div className="mb-4 mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <CostTile label="Std / unit" value={fmtFjd(cost.std_cost_per_unit)} />
                  <CostTile label="Earned std" value={fmtFjd(cost.earned_standard_cost)} />
                  <CostTile label="Actual" value={fmtFjd(cost.actual_total_cost)} />
                  <CostTile
                    label="Variance"
                    value={`${cost.variance_fjd > 0 ? "+" : ""}${fmtFjd(cost.variance_fjd)}`}
                    tone={
                      cost.variance_fjd > 0.005
                        ? "bad"
                        : cost.variance_fjd < -0.005
                          ? "good"
                          : "flat"
                    }
                  />
                </div>
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    <CostRow label="Standard material / unit" value={fmtFjd(cost.std_material_per_unit)} />
                    <CostRow label="Standard labour + overhead / unit" value={fmtFjd(cost.std_conv_per_unit)} />
                    <CostRow label={`Earned standard (× ${cost.qty_completed} done + setup)`} value={fmtFjd(cost.earned_standard_cost)} />
                    <CostRow label="Actual material (at standard price)" value={fmtFjd(cost.actual_material_cost)} />
                    <CostRow label="Actual labour + overhead" value={fmtFjd(cost.actual_labour_cost)} />
                    <CostRow label="Actual total" value={fmtFjd(cost.actual_total_cost)} strong />
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-400">
                  Actual material is valued at standard price, so this variance is
                  usage/efficiency (price variance stays in BC, the costing master).
                  {cost.components_without_cost > 0 && (
                    <span className="text-amber-600">
                      {" "}
                      {cost.components_without_cost} component
                      {cost.components_without_cost === 1 ? "" : "s"} missing a cached
                      cost — figures understated until set on the Costing screen.
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-400">No cost data.</p>
            )}
          </section>
        </div>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Actions</h2>
          <POActions poId={po.production_order_id} status={po.status} components={components} />
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-700">{value}</dd>
    </div>
  );
}

function CostTile({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "flat" | "good" | "bad";
}) {
  const cls =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function CostRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td className="py-1.5 pr-4 text-slate-500">{label}</td>
      <td className={`py-1.5 text-right tabular-nums ${strong ? "font-semibold text-slate-800" : "text-slate-600"}`}>
        {value}
      </td>
    </tr>
  );
}
