"use client";

import { useActionState } from "react";
import { createWorkCentreAction, type ActionState } from "../actions";

export function WorkCentreForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createWorkCentreAction,
    undefined,
  );
  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-700">Add work centre</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="code">Code *</label>
          <input id="code" name="code" required className="field" placeholder="WC-FORM" />
        </div>
        <div>
          <label className="label" htmlFor="name">Name *</label>
          <input id="name" name="name" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="plant">Plant *</label>
          <input id="plant" name="plant" required className="field" defaultValue="Molded Fibre" />
        </div>
        <div>
          <label className="label" htmlFor="daily_capacity">Daily capacity (min)</label>
          <input id="daily_capacity" name="daily_capacity" type="number" step="0.01" className="field" defaultValue="0" />
        </div>
        <div>
          <label className="label" htmlFor="efficiency_pct">Efficiency %</label>
          <input id="efficiency_pct" name="efficiency_pct" type="number" step="0.01" className="field" defaultValue="100" />
        </div>
        <div>
          <label className="label" htmlFor="labour_rate">Labour rate (FJD/hr)</label>
          <input id="labour_rate" name="labour_rate" type="number" step="0.0001" className="field" />
        </div>
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save work centre"}
      </button>
    </form>
  );
}
