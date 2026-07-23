"use client";

import { useActionState } from "react";
import {
  acceptFuelImportRowAction,
  rejectFuelImportRowAction,
  type ActionState,
} from "../actions";

export function ImportRowButtons({
  rowId,
  matched,
}: {
  rowId: number;
  matched: boolean;
}) {
  const [aState, acceptAction, aPending] = useActionState<ActionState, FormData>(
    acceptFuelImportRowAction,
    undefined,
  );
  const [rState, rejectAction, rPending] = useActionState<ActionState, FormData>(
    rejectFuelImportRowAction,
    undefined,
  );
  const err = aState?.error || rState?.error;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <form action={acceptAction}>
          <input type="hidden" name="row_id" value={rowId} />
          <button
            type="submit"
            disabled={aPending || !matched}
            title={matched ? "" : "No matching vehicle — can't accept"}
            className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {aPending ? "…" : "Accept"}
          </button>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="row_id" value={rowId} />
          <button
            type="submit"
            disabled={rPending}
            className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Reject
          </button>
        </form>
      </div>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </div>
  );
}
