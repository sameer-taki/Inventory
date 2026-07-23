"use client";

import { useActionState } from "react";
import {
  retryOutboxAction,
  markDeadOutboxAction,
  type ActionState,
} from "../actions";

export function OutboxRowActions({
  outboxId,
  status,
}: {
  outboxId: number;
  status: string;
}) {
  const [rState, retry, rPending] = useActionState<ActionState, FormData>(
    retryOutboxAction,
    undefined,
  );
  const [dState, markDead, dPending] = useActionState<ActionState, FormData>(
    markDeadOutboxAction,
    undefined,
  );
  const err = rState?.error || dState?.error;
  const canRetry = ["failed", "dead", "pending"].includes(status);
  const canKill = ["pending", "failed"].includes(status);
  if (!canRetry && !canKill)
    return <span className="text-xs text-slate-400">—</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canRetry && (
          <form action={retry}>
            <input type="hidden" name="outbox_id" value={outboxId} />
            <button
              type="submit"
              disabled={rPending}
              className="rounded bg-gold-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-gold-700 disabled:opacity-40"
            >
              {rPending ? "…" : "Retry"}
            </button>
          </form>
        )}
        {canKill && (
          <form action={markDead}>
            <input type="hidden" name="outbox_id" value={outboxId} />
            <button
              type="submit"
              disabled={dPending}
              className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Mark dead
            </button>
          </form>
        )}
      </div>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </div>
  );
}
