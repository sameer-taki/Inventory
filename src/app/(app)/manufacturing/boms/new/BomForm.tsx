"use client";

import { useActionState, useState } from "react";
import { createBomAction, type ActionState } from "../../actions";

type Item = { item_id: number; item_no: string; description: string };
type Line = { component_item_id: string; qty_per: string; uom: string; scrap_pct: string };

const emptyLine = (): Line => ({ component_item_id: "", qty_per: "", uom: "EA", scrap_pct: "0" });

export function BomForm({ items }: { items: Item[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createBomAction,
    undefined,
  );
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const linesJson = JSON.stringify(
    lines
      .filter((l) => l.component_item_id && l.qty_per)
      .map((l) => ({
        component_item_id: Number(l.component_item_id),
        qty_per: Number(l.qty_per),
        uom: l.uom,
        scrap_pct: Number(l.scrap_pct || 0),
      })),
  );

  function update(i: number, field: keyof Line, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  return (
    <form action={formAction} className="card max-w-3xl space-y-5 p-6">
      <input type="hidden" name="lines" value={linesJson} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="item_id">Finished good *</label>
          <select id="item_id" name="item_id" required className="field" defaultValue="">
            <option value="" disabled>— select item —</option>
            {items.map((it) => (
              <option key={it.item_id} value={it.item_id}>
                {it.item_no} — {it.description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="effective_from">Effective from *</label>
          <input id="effective_from" name="effective_from" type="date" required className="field" />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Component lines</span>
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => setLines((p) => [...p, emptyLine()])}
          >
            + Add line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <select
                className="field col-span-5"
                value={l.component_item_id}
                onChange={(e) => update(i, "component_item_id", e.target.value)}
              >
                <option value="">— component —</option>
                {items.map((it) => (
                  <option key={it.item_id} value={it.item_id}>
                    {it.item_no}
                  </option>
                ))}
              </select>
              <input
                className="field col-span-3"
                type="number"
                step="0.000001"
                placeholder="qty per"
                value={l.qty_per}
                onChange={(e) => update(i, "qty_per", e.target.value)}
              />
              <input
                className="field col-span-2"
                placeholder="UoM"
                value={l.uom}
                onChange={(e) => update(i, "uom", e.target.value)}
              />
              <input
                className="field col-span-2"
                type="number"
                step="0.01"
                placeholder="scrap %"
                value={l.scrap_pct}
                onChange={(e) => update(i, "scrap_pct", e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create draft BOM"}
        </button>
        <a href="/manufacturing/boms" className="btn-secondary">Cancel</a>
      </div>
      <p className="text-xs text-slate-400">
        Creates a draft. Approve it on the BOMs list to make it effective (any
        prior approved version of the same item is superseded).
      </p>
    </form>
  );
}
