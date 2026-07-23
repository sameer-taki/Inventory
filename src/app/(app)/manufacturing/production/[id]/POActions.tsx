"use client";

import { useActionState, useState } from "react";
import {
  transitionProductionOrderAction,
  postCompletionAction,
  type ActionState,
} from "../../actions";

type Component = {
  component_item_id: number;
  item_no: string;
  uom: string;
  qty_per: number;
};

const NEXT: Record<string, string[]> = {
  planned: ["firm", "cancelled"],
  firm: ["released", "cancelled"],
  released: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: ["closed"],
  closed: [],
  cancelled: [],
};

export function POActions({
  poId,
  status,
  components,
}: {
  poId: number;
  status: string;
  components: Component[];
}) {
  const canComplete = status === "released" || status === "in_progress";
  return (
    <div className="space-y-6">
      <Transition poId={poId} status={status} />
      {canComplete && <Completion poId={poId} components={components} />}
    </div>
  );
}

function Transition({ poId, status }: { poId: number; status: string }) {
  const options = NEXT[status] ?? [];
  const [target, setTarget] = useState(options[0] ?? "");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    transitionProductionOrderAction,
    undefined,
  );
  if (options.length === 0)
    return (
      <p className="text-sm text-slate-500">No further transitions available.</p>
    );
  return (
    <form action={formAction} className="flex items-end gap-3">
      <input type="hidden" name="po_id" value={poId} />
      <div className="flex-1">
        <label className="label" htmlFor="to_status">
          Advance order
        </label>
        <select
          id="to_status"
          name="to_status"
          className="field"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "…" : "Apply"}
      </button>
      {state?.error && (
        <p className="w-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}

function Completion({
  poId,
  components,
}: {
  poId: number;
  components: Component[];
}) {
  const [lines, setLines] = useState(
    components.map((c) => ({
      component_item_id: c.component_item_id,
      item_no: c.item_no,
      uom: c.uom,
      qty: "",
      lot_no: "",
    })),
  );
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    postCompletionAction,
    undefined,
  );

  const consumptionJson = JSON.stringify(
    lines
      .filter((l) => l.qty !== "" && Number(l.qty) > 0)
      .map((l) => ({
        component_item_id: l.component_item_id,
        qty: Number(l.qty),
        uom: l.uom,
        lot_no: l.lot_no || null,
      })),
  );

  function update(i: number, field: "qty" | "lot_no", value: string) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)),
    );
  }

  return (
    <form action={formAction} className="border-t border-slate-100 pt-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        Post completion → BC (outbox)
      </h3>
      <input type="hidden" name="po_id" value={poId} />
      <input type="hidden" name="consumption" value={consumptionJson} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="qty_good">
            Good qty *
          </label>
          <input id="qty_good" name="qty_good" type="number" step="0.0001" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="qty_scrap">
            Scrap qty
          </label>
          <input id="qty_scrap" name="qty_scrap" type="number" step="0.0001" className="field" defaultValue="0" />
        </div>
        <div>
          <label className="label" htmlFor="output_lot_no">
            Output lot no.
          </label>
          <input id="output_lot_no" name="output_lot_no" className="field" placeholder="LOT-…" />
        </div>
        <div>
          <label className="label" htmlFor="bc_location">
            BC location *
          </label>
          <input id="bc_location" name="bc_location" required className="field" defaultValue="MAIN" />
        </div>
      </div>

      {components.length > 0 && (
        <div className="mt-4">
          <p className="label">Material consumption</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.component_item_id} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-sm text-slate-600">
                  {l.item_no}
                </span>
                <input
                  className="field"
                  type="number"
                  step="0.000001"
                  placeholder={`qty (${l.uom})`}
                  value={l.qty}
                  onChange={(e) => update(i, "qty", e.target.value)}
                />
                <input
                  className="field"
                  placeholder="lot no."
                  value={l.lot_no}
                  onChange={(e) => update(i, "lot_no", e.target.value)}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Lot numbers here become genealogy edges (I8) linking the output lot
            to its inputs.
          </p>
        </div>
      )}

      {state?.error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn-primary mt-4" disabled={pending}>
        {pending ? "Posting…" : "Post completion"}
      </button>
    </form>
  );
}
