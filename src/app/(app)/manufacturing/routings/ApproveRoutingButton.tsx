"use client";

import { useActionState } from "react";
import { approveRoutingAction, type ActionState } from "../actions";

export function ApproveRoutingButton({ routingId }: { routingId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    approveRoutingAction,
    undefined,
  );
  return (
    <form action={formAction} className="inline-flex flex-col items-end">
      <input type="hidden" name="routing_id" value={routingId} />
      <button type="submit" className="btn-secondary px-2 py-1 text-xs" disabled={pending}>
        {pending ? "…" : "Approve"}
      </button>
      {state?.error && (
        <span className="mt-1 text-[11px] text-red-600">{state.error}</span>
      )}
    </form>
  );
}
