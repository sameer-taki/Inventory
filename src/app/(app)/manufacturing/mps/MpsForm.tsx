"use client";

import { useActionState } from "react";
import { saveMpsEntryAction, type ActionState } from "../actions";

type Item = { item_id: number; item_no: string; description: string };

export function MpsForm({ items }: { items: Item[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveMpsEntryAction,
    undefined,
  );
  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-700">Add / update MPS entry</h2>
      <div>
        <label className="label" htmlFor="item_id">Item *</label>
        <select id="item_id" name="item_id" required className="field" defaultValue="">
          <option value="" disabled>— select item —</option>
          {items.map((it) => (
            <option key={it.item_id} value={it.item_id}>
              {it.item_no} — {it.description}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="bucket_start">Bucket start *</label>
          <input id="bucket_start" name="bucket_start" type="date" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="qty">Quantity *</label>
          <input id="qty" name="qty" type="number" step="0.0001" min="0" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="kind">Kind *</label>
          <select id="kind" name="kind" required className="field" defaultValue="firm">
            <option value="firm">firm</option>
            <option value="forecast">forecast</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="plant">Plant *</label>
          <input id="plant" name="plant" required className="field" defaultValue="Molded Fibre" />
        </div>
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save entry"}
      </button>
      <p className="text-xs text-slate-400">
        Demand for MRP. Re-saving the same item/plant/bucket/kind updates the quantity.
      </p>
    </form>
  );
}
