"use client";

import { useActionState } from "react";
import {
  addMeterReadingAction,
  logFuelAction,
  saveRenewalAction,
  type ActionState,
} from "../../actions";

export function MeterForm({ vehicleId }: { vehicleId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addMeterReadingAction,
    undefined,
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="vehicle_id" value={vehicleId} />
      <div>
        <label className="label" htmlFor="reading">Meter reading</label>
        <input id="reading" name="reading" type="number" step="0.1" required className="field" />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : "Record meter"}
      </button>
    </form>
  );
}

export function FuelForm({ vehicleId }: { vehicleId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    logFuelAction,
    undefined,
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="vehicle_id" value={vehicleId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="filled_at">Date</label>
          <input id="filled_at" name="filled_at" type="date" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="meter_reading">Meter</label>
          <input id="meter_reading" name="meter_reading" type="number" step="0.1" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="litres">Litres</label>
          <input id="litres" name="litres" type="number" step="0.01" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="cost_fjd">Cost (FJD)</label>
          <input id="cost_fjd" name="cost_fjd" type="number" step="0.01" required className="field" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="is_full_fill" defaultChecked /> Full fill
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : "Log fill"}
      </button>
    </form>
  );
}

export function RenewalForm({ vehicleId }: { vehicleId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveRenewalAction,
    undefined,
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="entity_id" value={vehicleId} />
      <div>
        <label className="label" htmlFor="kind">Kind</label>
        <select id="kind" name="kind" className="field" defaultValue="registration">
          {["registration", "wheel_tax", "fitness_cof", "insurance", "plant_inspection", "other"].map((k) => (
            <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="due_date">Due date</label>
          <input id="due_date" name="due_date" type="date" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="reminder_days">Reminder days</label>
          <input id="reminder_days" name="reminder_days" type="number" className="field" defaultValue="30" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="reference_no">Reference no.</label>
        <input id="reference_no" name="reference_no" className="field" />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : "Add renewal"}
      </button>
    </form>
  );
}
