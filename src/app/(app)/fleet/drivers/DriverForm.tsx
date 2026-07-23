"use client";

import { useActionState } from "react";
import { saveDriverAction, type ActionState } from "../actions";

type User = { user_id: number; full_name: string | null; email: string };

export function DriverForm({ users }: { users: User[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveDriverAction,
    undefined,
  );
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="label" htmlFor="user_id">Person</label>
        <select id="user_id" name="user_id" required className="field" defaultValue="">
          <option value="" disabled>
            Select a person…
          </option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.full_name || u.email}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="licence_class">Licence class</label>
          <input id="licence_class" name="licence_class" required className="field" placeholder="HR" />
        </div>
        <div>
          <label className="label" htmlFor="licence_expiry">Licence expiry</label>
          <input id="licence_expiry" name="licence_expiry" type="date" required className="field" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="forklift_certified" /> Forklift certified
      </label>
      <div>
        <label className="label" htmlFor="forklift_cert_expiry">Forklift cert expiry</label>
        <input id="forklift_cert_expiry" name="forklift_cert_expiry" type="date" className="field" />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : "Add driver"}
      </button>
    </form>
  );
}
