"use client";

import { useActionState } from "react";
import { setItemCostAction, type ActionState } from "../actions";

export function CostRowForm({
  itemId,
  currentCost,
}: {
  itemId: number;
  currentCost: number | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setItemCostAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="item_id" value={itemId} />
      <input
        name="std_cost"
        type="number"
        step="0.0001"
        min="0"
        defaultValue={currentCost ?? ""}
        placeholder="—"
        className="field w-28 py-1 text-right"
      />
      <button type="submit" className="btn-secondary px-2 py-1 text-xs" disabled={pending}>
        {pending ? "…" : "Save"}
      </button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </form>
  );
}
