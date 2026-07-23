"use client";

import { useActionState, useState } from "react";
import {
  openJobCardAction,
  transitionJobCardAction,
  type ActionState,
} from "../actions";

type Vehicle = { vehicle_id: number; fleet_code: string };

const NEXT: Record<string, string[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["awaiting_parts", "done", "cancelled"],
  awaiting_parts: ["in_progress"],
  done: [],
  cancelled: [],
};

export function OpenJobCardForm({ vehicles }: { vehicles: Vehicle[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    openJobCardAction,
    undefined,
  );
  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-700">Open job card</h2>
      <div>
        <label className="label" htmlFor="vehicle_id">Vehicle *</label>
        <select id="vehicle_id" name="vehicle_id" required className="field" defaultValue="">
          <option value="" disabled>— select vehicle —</option>
          {vehicles.map((v) => (
            <option key={v.vehicle_id} value={v.vehicle_id}>{v.fleet_code}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="kind">Kind *</label>
          <select id="kind" name="kind" required className="field" defaultValue="scheduled">
            {["scheduled", "breakdown", "inspection", "tyres", "other"].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="workshop">Workshop *</label>
          <select id="workshop" name="workshop" required className="field" defaultValue="internal">
            <option value="internal">internal</option>
            <option value="external">external</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="vendor_name">Vendor (if external)</label>
        <input id="vendor_name" name="vendor_name" className="field" />
      </div>
      <div>
        <label className="label" htmlFor="description">Description *</label>
        <textarea id="description" name="description" required rows={2} className="field" />
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Opening…" : "Open job card"}
      </button>
    </form>
  );
}

export function JobCardTransition({
  jobId,
  status,
}: {
  jobId: number;
  status: string;
}) {
  const options = NEXT[status] ?? [];
  const [target, setTarget] = useState(options[0] ?? "");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    transitionJobCardAction,
    undefined,
  );
  if (options.length === 0)
    return <span className="text-xs text-slate-400">—</span>;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="job_id" value={jobId} />
      <div className="flex items-center gap-2">
        <select
          name="to_status"
          className="field py-1 text-xs"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary px-2 py-1 text-xs" disabled={pending}>
          {pending ? "…" : "Go"}
        </button>
      </div>
      {target === "done" && (
        <div className="grid grid-cols-2 gap-1">
          <input name="parts_cost" type="number" step="0.01" placeholder="parts FJD" className="field py-1 text-xs" />
          <input name="labour_cost" type="number" step="0.01" placeholder="labour FJD" className="field py-1 text-xs" />
          <input name="downtime_hours" type="number" step="0.1" placeholder="downtime hrs" className="field py-1 text-xs" />
          <input name="invoice_ref" placeholder="BC invoice ref" className="field py-1 text-xs" />
        </div>
      )}
      {state?.error && (
        <span className="text-[11px] text-red-600">{state.error}</span>
      )}
    </form>
  );
}
