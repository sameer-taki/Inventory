"use client";

import { useActionState } from "react";
import { saveVehicleAction, type ActionState } from "../actions";

export function AddVehicleForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveVehicleAction,
    undefined,
  );
  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-700">Add vehicle / plant</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fleet_code">Fleet code *</label>
          <input id="fleet_code" name="fleet_code" required className="field" placeholder="FLT-001" />
        </div>
        <div>
          <label className="label" htmlFor="rego_no">Rego (blank for plant)</label>
          <input id="rego_no" name="rego_no" className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="make_model">Make / model *</label>
          <input id="make_model" name="make_model" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="kind">Kind *</label>
          <select id="kind" name="kind" required className="field" defaultValue="truck">
            {["truck", "van", "car", "forklift", "other_plant"].map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="meter_kind">Meter *</label>
          <select id="meter_kind" name="meter_kind" required className="field" defaultValue="km">
            <option value="km">km</option>
            <option value="hours">hours</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="site">Site *</label>
          <input id="site" name="site" required className="field" defaultValue="Molded Fibre" />
        </div>
        <div>
          <label className="label" htmlFor="ownership">Ownership *</label>
          <select id="ownership" name="ownership" required className="field" defaultValue="owned">
            <option value="owned">owned</option>
            <option value="leased">leased</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fuel_kind">Fuel</label>
          <select id="fuel_kind" name="fuel_kind" className="field" defaultValue="diesel">
            {["diesel", "petrol", "lpg", "electric", "na"].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="year">Year</label>
          <input id="year" name="year" type="number" className="field" />
        </div>
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save vehicle"}
      </button>
    </form>
  );
}
