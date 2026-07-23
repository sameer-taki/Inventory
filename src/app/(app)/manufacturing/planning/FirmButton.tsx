"use client";

import { useActionState } from "react";
import { firmPlannedOrderAction, type ActionState } from "../actions";

export function FirmButton({ plannedOrderId }: { plannedOrderId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    firmPlannedOrderAction,
    undefined,
  );
  return (
    <form action={formAction} className="inline-flex flex-col items-end">
      <input type="hidden" name="planned_order_id" value={plannedOrderId} />
      <button
        type="submit"
        className="btn-secondary px-2 py-1 text-xs"
        disabled={pending}
      >
        {pending ? "…" : "Firm"}
      </button>
      {state?.error && (
        <span className="mt-1 text-[11px] text-red-600">{state.error}</span>
      )}
    </form>
  );
}
