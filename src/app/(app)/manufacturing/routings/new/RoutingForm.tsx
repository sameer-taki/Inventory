"use client";

import { useActionState, useState } from "react";
import { createRoutingAction, type ActionState } from "../../actions";

type Item = { item_id: number; item_no: string; description: string };
type WC = { work_centre_id: number; code: string; name: string };
type Op = {
  work_centre_id: string;
  description: string;
  setup_minutes: string;
  run_minutes_per_unit: string;
  queue_minutes: string;
};

const emptyOp = (): Op => ({
  work_centre_id: "",
  description: "",
  setup_minutes: "0",
  run_minutes_per_unit: "0",
  queue_minutes: "0",
});

export function RoutingForm({ items, workCentres }: { items: Item[]; workCentres: WC[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createRoutingAction,
    undefined,
  );
  const [ops, setOps] = useState<Op[]>([emptyOp()]);

  const opsJson = JSON.stringify(
    ops
      .filter((o) => o.work_centre_id && o.description)
      .map((o) => ({
        work_centre_id: Number(o.work_centre_id),
        description: o.description,
        setup_minutes: Number(o.setup_minutes || 0),
        run_minutes_per_unit: Number(o.run_minutes_per_unit || 0),
        queue_minutes: Number(o.queue_minutes || 0),
      })),
  );

  function update(i: number, field: keyof Op, value: string) {
    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  }

  return (
    <form action={formAction} className="card max-w-4xl space-y-5 p-6">
      <input type="hidden" name="operations" value={opsJson} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="item_id">Finished good *</label>
          <select id="item_id" name="item_id" required className="field" defaultValue="">
            <option value="" disabled>— select item —</option>
            {items.map((it) => (
              <option key={it.item_id} value={it.item_id}>
                {it.item_no} — {it.description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="effective_from">Effective from *</label>
          <input id="effective_from" name="effective_from" type="date" required className="field" />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Operations (in sequence)</span>
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => setOps((p) => [...p, emptyOp()])}
          >
            + Add operation
          </button>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-[11px] uppercase text-slate-400">
            <span className="col-span-3">Work centre</span>
            <span className="col-span-4">Description</span>
            <span className="col-span-2">Setup min</span>
            <span className="col-span-2">Run min/unit</span>
            <span className="col-span-1">Queue</span>
          </div>
          {ops.map((o, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <select
                className="field col-span-3"
                value={o.work_centre_id}
                onChange={(e) => update(i, "work_centre_id", e.target.value)}
              >
                <option value="">— WC —</option>
                {workCentres.map((w) => (
                  <option key={w.work_centre_id} value={w.work_centre_id}>
                    {w.code}
                  </option>
                ))}
              </select>
              <input
                className="field col-span-4"
                placeholder="operation"
                value={o.description}
                onChange={(e) => update(i, "description", e.target.value)}
              />
              <input
                className="field col-span-2"
                type="number"
                step="0.01"
                value={o.setup_minutes}
                onChange={(e) => update(i, "setup_minutes", e.target.value)}
              />
              <input
                className="field col-span-2"
                type="number"
                step="0.0001"
                value={o.run_minutes_per_unit}
                onChange={(e) => update(i, "run_minutes_per_unit", e.target.value)}
              />
              <input
                className="field col-span-1"
                type="number"
                step="0.01"
                value={o.queue_minutes}
                onChange={(e) => update(i, "queue_minutes", e.target.value)}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Operations are numbered ×10 (10, 20, 30…) in the order shown.
        </p>
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create draft routing"}
        </button>
        <a href="/manufacturing/routings" className="btn-secondary">Cancel</a>
      </div>
    </form>
  );
}
