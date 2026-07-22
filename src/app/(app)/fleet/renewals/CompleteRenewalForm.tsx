"use client";

import { useActionState, useState } from "react";
import { completeRenewalAction, type ActionState } from "../actions";

export function CompleteRenewalForm({ renewalId }: { renewalId: number }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    completeRenewalAction,
    undefined,
  );

  if (!open) {
    return (
      <button
        type="button"
        className="btn-secondary px-2 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        Renew
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="renewal_id" value={renewalId} />
      <input
        type="date"
        name="next_due_date"
        required
        className="field py-1 text-xs"
        aria-label="Next due date"
      />
      <button type="submit" className="btn-primary px-2 py-1 text-xs" disabled={pending}>
        {pending ? "…" : "Save"}
      </button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </form>
  );
}
