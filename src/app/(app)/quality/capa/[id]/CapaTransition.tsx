"use client";

import { useActionState, useState } from "react";
import { transitionCapaAction, type ActionState } from "../../actions";

const NEXT: Record<string, string[]> = {
  open: ["in_progress"],
  in_progress: ["pending_verification"],
  pending_verification: ["closed", "in_progress"],
  closed: [],
};

export function CapaTransition({
  capaId,
  status,
}: {
  capaId: number;
  status: string;
}) {
  const options = NEXT[status] ?? [];
  const [target, setTarget] = useState(options[0] ?? "");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    transitionCapaAction,
    undefined,
  );

  if (options.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        This CAPA is closed. No further transitions are available.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="capa_id" value={capaId} />
      <div>
        <label className="label" htmlFor="to_status">
          Move to
        </label>
        <select
          id="to_status"
          name="to_status"
          className="field"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {target === "closed" && (
        <div>
          <label className="label" htmlFor="effectiveness_check">
            Effectiveness check *
          </label>
          <textarea
            id="effectiveness_check"
            name="effectiveness_check"
            rows={2}
            className="field"
            placeholder="How was effectiveness verified? Required to close."
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor="root_cause">
          Root cause (update)
        </label>
        <textarea id="root_cause" name="root_cause" rows={2} className="field" />
      </div>

      <div>
        <label className="label" htmlFor="note">
          Note
        </label>
        <textarea id="note" name="note" rows={2} className="field" />
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Apply transition"}
      </button>
    </form>
  );
}
