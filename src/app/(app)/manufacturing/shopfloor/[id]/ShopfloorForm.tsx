"use client";

import { useActionState, useState } from "react";
import { postShopfloorCompletionAction, type ActionState } from "../../actions";

type Component = {
  component_item_id: number;
  item_no: string;
  uom: string;
  qty_per: number;
  scrap_pct: number;
};
type Operation = {
  operation_seq: number;
  work_centre_id: number;
  wc_code: string;
  description: string;
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function ShopfloorForm({
  poId,
  uom,
  remaining,
  components,
  operations,
}: {
  poId: number;
  uom: string;
  remaining: number;
  components: Component[];
  operations: Operation[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    postShopfloorCompletionAction,
    undefined,
  );
  const [qtyGood, setQtyGood] = useState<string>(remaining > 0 ? String(remaining) : "");
  const [qtyScrap, setQtyScrap] = useState<string>("0");
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [labour, setLabour] = useState<Record<number, string>>({});

  const good = Number(qtyGood || 0);
  const suggested = (c: Component) => round4(c.qty_per * (1 + c.scrap_pct / 100) * good);
  const effectiveQty = (c: Component) =>
    overrides[c.component_item_id] !== undefined
      ? Number(overrides[c.component_item_id] || 0)
      : suggested(c);

  const consumptionJson = JSON.stringify(
    components
      .map((c) => ({
        component_item_id: c.component_item_id,
        qty: effectiveQty(c),
        uom: c.uom,
        method: "backflush",
      }))
      .filter((l) => l.qty > 0),
  );
  const labourJson = JSON.stringify(
    operations
      .map((o) => ({
        work_centre_id: o.work_centre_id,
        operation_seq: o.operation_seq,
        minutes: Number(labour[o.operation_seq] || 0),
      }))
      .filter((l) => l.minutes > 0),
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="po_id" value={poId} />
      <input type="hidden" name="consumption" value={consumptionJson} />
      <input type="hidden" name="labour" value={labourJson} />

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Output</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="qty_good">Good ({uom})</label>
            <input
              id="qty_good"
              name="qty_good"
              type="number"
              step="0.0001"
              min="0"
              required
              value={qtyGood}
              onChange={(e) => setQtyGood(e.target.value)}
              className="field py-3 text-lg"
            />
          </div>
          <div>
            <label className="label" htmlFor="qty_scrap">Scrap ({uom})</label>
            <input
              id="qty_scrap"
              name="qty_scrap"
              type="number"
              step="0.0001"
              min="0"
              value={qtyScrap}
              onChange={(e) => setQtyScrap(e.target.value)}
              className="field py-3 text-lg"
            />
          </div>
          <div>
            <label className="label" htmlFor="output_lot_no">Output lot</label>
            <input id="output_lot_no" name="output_lot_no" className="field py-3" placeholder="e.g. LOT-0723-A" />
          </div>
          <div>
            <label className="label" htmlFor="bc_location">BC location *</label>
            <input id="bc_location" name="bc_location" required className="field py-3" placeholder="FIBRE-FG" />
          </div>
        </div>
      </section>

      {components.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Materials (backflush)</h2>
          <p className="mb-3 text-xs text-slate-400">
            Suggested from the BOM scaled to good quantity (incl. planned scrap).
            Adjust any line to record actual consumption.
          </p>
          <div className="space-y-2">
            {components.map((c) => (
              <div key={c.component_item_id} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate font-medium text-slate-700" title={c.item_no}>
                  {c.item_no}
                </span>
                <input
                  type="number"
                  step="0.000001"
                  min="0"
                  value={
                    overrides[c.component_item_id] !== undefined
                      ? overrides[c.component_item_id]
                      : String(suggested(c))
                  }
                  onChange={(e) =>
                    setOverrides((prev) => ({ ...prev, [c.component_item_id]: e.target.value }))
                  }
                  className="field w-40 py-2 text-right"
                />
                <span className="text-sm text-slate-400">{c.uom}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {operations.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Labour</h2>
          <p className="mb-3 text-xs text-slate-400">
            Minutes worked at each operation — feeds the actual cost roll-up. Leave
            blank to skip.
          </p>
          <div className="space-y-2">
            {operations.map((o) => (
              <div key={o.operation_seq} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-slate-400">#{o.operation_seq}</span>
                <span className="w-44 shrink-0 truncate text-slate-700">
                  <span className="font-medium">{o.wc_code}</span>{" "}
                  <span className="text-slate-400">{o.description}</span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="min"
                  value={labour[o.operation_seq] ?? ""}
                  onChange={(e) =>
                    setLabour((prev) => ({ ...prev, [o.operation_seq]: e.target.value }))
                  }
                  className="field w-32 py-2 text-right"
                />
                <span className="text-sm text-slate-400">min</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary px-6 py-3 text-base" disabled={pending}>
          {pending ? "Posting…" : "Post completion"}
        </button>
        <a href={`/manufacturing/production/${poId}`} className="btn-secondary px-6 py-3 text-base">
          Cancel
        </a>
      </div>
      <p className="text-xs text-slate-400">
        Posts output + backflush consumption through the audited single writer
        (queues the BC assembly-order posting, I2) and records labour in the same
        transaction.
      </p>
    </form>
  );
}
