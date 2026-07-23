"use client";

import { useActionState } from "react";
import {
  assignVehicleAction,
  endAssignmentAction,
  type ActionState,
} from "../../actions";

type DriverOption = { driver_id: number; name: string };

export function AssignForm({
  vehicleId,
  drivers,
}: {
  vehicleId: number;
  drivers: DriverOption[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    assignVehicleAction,
    undefined,
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="vehicle_id" value={vehicleId} />
      <div>
        <label className="label" htmlFor="driver_id">Driver</label>
        <select id="driver_id" name="driver_id" className="field" defaultValue="">
          <option value="">— none / pool —</option>
          {drivers.map((d) => (
            <option key={d.driver_id} value={d.driver_id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="assigned_from">From</label>
          <input id="assigned_from" name="assigned_from" type="date" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="site">Site</label>
          <input id="site" name="site" className="field" placeholder="Suva" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="note">Note</label>
        <input id="note" name="note" className="field" />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : "Assign vehicle"}
      </button>
      <p className="text-xs text-slate-400">
        Assigning closes the current open assignment automatically — one active
        holder at a time.
      </p>
    </form>
  );
}

export function EndAssignmentForm({
  assignmentId,
  vehicleId,
}: {
  assignmentId: number;
  vehicleId: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    endAssignmentAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="vehicle_id" value={vehicleId} />
      <div>
        <label className="label" htmlFor={`end-${assignmentId}`}>End date</label>
        <input
          id={`end-${assignmentId}`}
          name="assigned_to"
          type="date"
          required
          className="field py-1"
        />
      </div>
      <button type="submit" className="btn-secondary py-1.5 text-xs" disabled={pending}>
        {pending ? "…" : "End"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
