"use client";

import { useActionState } from "react";
import { raiseCapaAction, type ActionState } from "../../actions";

type User = { user_id: number; full_name: string | null; email: string };

export function CapaForm({
  users,
  ncrId,
}: {
  users: User[];
  ncrId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    raiseCapaAction,
    undefined,
  );

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      {ncrId && <input type="hidden" name="ncr_id" value={ncrId} />}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="kind">
            Kind *
          </label>
          <select id="kind" name="kind" required className="field" defaultValue="corrective">
            <option value="corrective">corrective</option>
            <option value="preventive">preventive</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="due_date">
            Due date *
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            required
            className="field"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="owner_id">
          Owner *
        </label>
        <select id="owner_id" name="owner_id" required className="field" defaultValue="">
          <option value="" disabled>
            — select owner —
          </option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.full_name || u.email}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="root_cause">
          Root cause
        </label>
        <textarea
          id="root_cause"
          name="root_cause"
          rows={2}
          className="field"
          placeholder="Optional at raise; can be added during investigation."
        />
      </div>

      <div>
        <label className="label" htmlFor="action_plan">
          Action plan *
        </label>
        <textarea
          id="action_plan"
          name="action_plan"
          required
          rows={4}
          className="field"
        />
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Raising…" : "Raise CAPA"}
        </button>
        <a href="/quality/capa" className="btn-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}
