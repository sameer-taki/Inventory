"use client";

import { useActionState } from "react";
import { approveBomAction, type ActionState } from "../actions";

export function ApproveBomButton({ bomId }: { bomId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    approveBomAction,
    undefined,
  );
  return (
    <form action={formAction} className="inline-flex flex-col items-end">
      <input type="hidden" name="bom_id" value={bomId} />
      <button type="submit" className="btn-secondary px-2 py-1 text-xs" disabled={pending}>
        {pending ? "…" : "Approve"}
      </button>
      {state?.error && (
        <span className="mt-1 text-[11px] text-red-600">{state.error}</span>
      )}
    </form>
  );
}
