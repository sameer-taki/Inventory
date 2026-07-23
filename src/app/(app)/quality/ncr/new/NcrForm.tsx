"use client";

import { useActionState } from "react";
import { raiseNcrAction, type ActionState } from "../../actions";

type Item = { item_id: number; item_no: string; description: string };

const SOURCES = [
  "production",
  "incoming",
  "customer_complaint",
  "audit",
  "print",
];
const SEVERITIES = ["minor", "major", "critical"];

export function NcrForm({ items }: { items: Item[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    raiseNcrAction,
    undefined,
  );

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="source">
            Source *
          </label>
          <select id="source" name="source" required className="field" defaultValue="production">
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="severity">
            Severity *
          </label>
          <select id="severity" name="severity" required className="field" defaultValue="minor">
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="plant">
            Plant
          </label>
          <input id="plant" name="plant" className="field" placeholder="Molded Fibre" />
        </div>
        <div>
          <label className="label" htmlFor="lot_no">
            Lot no.
          </label>
          <input id="lot_no" name="lot_no" className="field" placeholder="LOT-…" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="item_id">
          Item
        </label>
        <select id="item_id" name="item_id" className="field" defaultValue="">
          <option value="">— none —</option>
          {items.map((it) => (
            <option key={it.item_id} value={it.item_id}>
              {it.item_no} — {it.description}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description *
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={4}
          className="field"
          placeholder="What is non-conforming, where, and how much?"
        />
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Raising…" : "Raise NCR"}
        </button>
        <a href="/quality/ncr" className="btn-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}
