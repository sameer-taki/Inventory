"use client";

import { useActionState, useState } from "react";
import { transitionNcrAction, type ActionState } from "../../actions";

const NEXT: Record<string, string[]> = {
  open: ["under_review", "dispositioned"],
  under_review: ["dispositioned"],
  dispositioned: ["closed", "under_review"],
  closed: [],
};

const DISPOSITIONS = [
  "use_as_is",
  "rework",
  "scrap",
  "return_to_vendor",
  "hold",
];

export function NcrTransition({
  ncrId,
  status,
}: {
  ncrId: number;
  status: string;
}) {
  const options = NEXT[status] ?? [];
  const [target, setTarget] = useState(options[0] ?? "");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    transitionNcrAction,
    undefined,
  );

  if (options.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        This NCR is closed. No further transitions are available.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ncr_id" value={ncrId} />
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

      {target === "dispositioned" && (
        <div>
          <label className="label" htmlFor="disposition">
            Disposition *
          </label>
          <select
            id="disposition"
            name="disposition"
            className="field"
            defaultValue="rework"
          >
            {DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      )}

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
