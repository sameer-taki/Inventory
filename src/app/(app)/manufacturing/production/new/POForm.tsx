"use client";

import { useActionState, useMemo, useState } from "react";
import { createProductionOrderAction, type ActionState } from "../../actions";

type Bom = { bom_id: number; item_id: number; item_no: string; version_no: number };
type Routing = { routing_id: number; item_id: number; version_no: number };

export function POForm({ boms, routings }: { boms: Bom[]; routings: Routing[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createProductionOrderAction,
    undefined,
  );
  const [bomId, setBomId] = useState<number | "">("");

  const selectedBom = useMemo(
    () => boms.find((b) => b.bom_id === bomId),
    [boms, bomId],
  );
  const routingOptions = useMemo(
    () => routings.filter((r) => r.item_id === selectedBom?.item_id),
    [routings, selectedBom],
  );

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      <input type="hidden" name="item_id" value={selectedBom?.item_id ?? ""} />

      <div>
        <label className="label" htmlFor="bom_id">
          Approved BOM (finished good) *
        </label>
        <select
          id="bom_id"
          name="bom_id"
          required
          className="field"
          value={bomId}
          onChange={(e) => setBomId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="" disabled>
            — select a BOM —
          </option>
          {boms.map((b) => (
            <option key={b.bom_id} value={b.bom_id}>
              {b.item_no} (BOM v{b.version_no})
            </option>
          ))}
        </select>
        {boms.length === 0 && (
          <p className="mt-1 text-xs text-amber-600">
            No approved BOMs yet — create and approve one under BOMs first.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="routing_id">
          Routing (optional)
        </label>
        <select id="routing_id" name="routing_id" className="field" defaultValue="">
          <option value="">— none —</option>
          {routingOptions.map((r) => (
            <option key={r.routing_id} value={r.routing_id}>
              Routing v{r.version_no}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="qty">
            Quantity *
          </label>
          <input id="qty" name="qty" type="number" step="0.0001" min="0.0001" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="uom">
            UoM *
          </label>
          <input id="uom" name="uom" required className="field" defaultValue="EA" />
        </div>
        <div>
          <label className="label" htmlFor="plant">
            Plant *
          </label>
          <input id="plant" name="plant" required className="field" defaultValue="Molded Fibre" />
        </div>
        <div>
          <label className="label" htmlFor="due_date">
            Due date *
          </label>
          <input id="due_date" name="due_date" type="date" required className="field" />
        </div>
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create order"}
        </button>
        <a href="/manufacturing/production" className="btn-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}
