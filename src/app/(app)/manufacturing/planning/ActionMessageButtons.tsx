"use client";

import { useActionState } from "react";
import { actionMessageAction, type ActionState } from "../actions";

export function ActionMessageButtons({ actionId }: { actionId: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    actionMessageAction,
    undefined,
  );
  return (
    <form action={formAction} className="mt-1 flex items-center gap-2">
      <input type="hidden" name="action_id" value={actionId} />
      <button
        type="submit"
        name="to_status"
        value="actioned"
        disabled={pending}
        className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        Action
      </button>
      <button
        type="submit"
        name="to_status"
        value="dismissed"
        disabled={pending}
        className="rounded border border-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
      >
        Dismiss
      </button>
      {state?.error && (
        <span className="text-[11px] text-red-600">{state.error}</span>
      )}
    </form>
  );
}
