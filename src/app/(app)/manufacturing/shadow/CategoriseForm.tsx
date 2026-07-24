"use client";

import { useActionState } from "react";
import { categoriseShadowDiffAction, type ActionState } from "../actions";

const CATEGORIES = [
  { value: "data_difference", label: "Data difference" },
  { value: "logic_difference", label: "Logic difference" },
  { value: "max_bug", label: "MAX bug" },
  { value: "accepted", label: "Accepted" },
];

export function CategoriseForm({
  itemId,
  dueDate,
  category,
  note,
}: {
  itemId: number;
  dueDate: string;
  category: string | null;
  note: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    categoriseShadowDiffAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="due_date" value={dueDate} />
      <select name="category" defaultValue={category ?? ""} required className="field py-1 text-xs">
        <option value="" disabled>categorise…</option>
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <input
        name="note"
        defaultValue={note ?? ""}
        placeholder="explanation"
        className="field w-44 py-1 text-xs"
      />
      <button type="submit" className="btn-secondary px-2 py-1 text-xs" disabled={pending}>
        {pending ? "…" : "Save"}
      </button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </form>
  );
}
