import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { ShopfloorForm } from "./ShopfloorForm";

export const dynamic = "force-dynamic";

type PO = {
  production_order_id: number;
  order_no: string;
  item_id: number;
  bom_id: number;
  routing_id: number | null;
  plant: string;
  qty_ordered: number;
  qty_completed: number;
  uom: string;
  status: string;
};

export default async function ShopfloorCompletion({
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
    .select("production_order_id, order_no, item_id, bom_id, routing_id, plant, qty_ordered, qty_completed, uom, status")
    .eq("production_order_id", poId)
    .maybeSingle<PO>();
  if (!po) notFound();

  const [{ data: item }, { data: bomLines }, { data: routingOps }] = await Promise.all([
    supabase
      .schema("ops")
      .from("items")
      .select("item_no, description")
      .eq("item_id", po.item_id)
      .maybeSingle<{ item_no: string; description: string }>(),
    supabase
      .schema("mfg")
      .from("bom_lines")
      .select("component_item_id, qty_per, uom, scrap_pct")
      .eq("bom_id", po.bom_id)
      .order("line_no")
      .returns<{ component_item_id: number; qty_per: number; uom: string; scrap_pct: number }[]>(),
    po.routing_id
      ? supabase
          .schema("mfg")
          .from("routing_operations")
          .select("operation_seq, work_centre_id, description")
          .eq("routing_id", po.routing_id)
          .order("operation_seq")
          .returns<{ operation_seq: number; work_centre_id: number; description: string }[]>()
      : Promise.resolve({ data: [] as { operation_seq: number; work_centre_id: number; description: string }[] }),
  ]);

  const compIds = (bomLines ?? []).map((l) => l.component_item_id);
  const wcIds = (routingOps ?? []).map((o) => o.work_centre_id);
  const [{ data: comps }, { data: wcs }] = await Promise.all([
    compIds.length
      ? supabase.schema("ops").from("items").select("item_id, item_no").in("item_id", compIds)
          .returns<{ item_id: number; item_no: string }[]>()
      : Promise.resolve({ data: [] as { item_id: number; item_no: string }[] }),
    wcIds.length
      ? supabase.schema("mfg").from("work_centres").select("work_centre_id, code, name").in("work_centre_id", wcIds)
          .returns<{ work_centre_id: number; code: string; name: string }[]>()
      : Promise.resolve({ data: [] as { work_centre_id: number; code: string; name: string }[] }),
  ]);
  const compMap = new Map((comps ?? []).map((c) => [c.item_id, c.item_no]));
  const wcMap = new Map((wcs ?? []).map((w) => [w.work_centre_id, w]));

  const components = (bomLines ?? []).map((l) => ({
    component_item_id: l.component_item_id,
    item_no: compMap.get(l.component_item_id) ?? String(l.component_item_id),
    uom: l.uom,
    qty_per: Number(l.qty_per),
    scrap_pct: Number(l.scrap_pct),
  }));
  const operations = (routingOps ?? []).map((o) => ({
    operation_seq: o.operation_seq,
    work_centre_id: o.work_centre_id,
    wc_code: wcMap.get(o.work_centre_id)?.code ?? String(o.work_centre_id),
    description: o.description,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/manufacturing/shopfloor" className="text-sm text-slate-500 hover:underline">
          ← Shop floor
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">{po.order_no}</h1>
        <StatusBadge value={po.status} />
      </div>

      <div className="card mb-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-lg font-semibold text-slate-800">{item?.item_no ?? po.item_id}</div>
            <div className="text-sm text-slate-400">{item?.description}</div>
          </div>
          <div className="text-right text-sm text-slate-500">
            <div>
              {po.qty_completed} / {po.qty_ordered} {po.uom} done
            </div>
            <div className="text-slate-400">{po.plant}</div>
          </div>
        </div>
      </div>

      <ShopfloorForm
        poId={po.production_order_id}
        uom={po.uom}
        remaining={Math.max(0, Number(po.qty_ordered) - Number(po.qty_completed))}
        components={components}
        operations={operations}
      />
    </div>
  );
}
