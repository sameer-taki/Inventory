# D-3 — BC write-back contract (production posting)

**Status:** contract firmed; deliver mode gated on on-prem BC connectivity.
**Owners:** Aqib (sign-off), Sameer. Relates to invariants P1/P2/I1/I2/I10.

The mfg module never writes to Business Central directly. Every production
posting is **enqueued** by `mfg.post_completion` into `ops.integration_outbox`
with an idempotency key, and the **gateway-bridge** edge function is the single
writer that delivers it to BC and finalises via `ops.outbox_mark_sent` /
`ops.outbox_mark_failed`. This note fixes *what* the bridge sends.

## Decision

**Primary vehicle: BC Assembly Order (Option A).** Chosen over item journals
because BC natively values the consumed components and rolls the produced
output's cost, keeping BC the costing master (I1) with the least of I4 resting
on our code. The mfg cost roll-up (`mfg.v_po_cost`) is then a *management*
view; BC remains the financial record.

**Fallback: Item Journal (Option B).** If the Assembly Order OData surface is
unavailable or too constrained on the Essentials tier, the bridge can post a
positive-adjustment output line + negative-adjustment consumption lines. Cost of
goods produced must then be stamped by us (standard cost from `mfg.item_cost`),
which is weaker cost linkage — hence the fallback ranking.

The vehicle is selected at runtime by `BC_POSTING_MODE` (`assembly_order` |
`item_journal`) — a config flip, not a code change. Both builders live in
`supabase/functions/gateway-bridge/index.ts`.

## Contract — payload shapes

Source: `ops.integration_outbox` row, `aggregate_type = 'mfg.completion'`,
`event_type = 'post_assembly_order'`. Canonical `item_id`s are resolved to BC
item numbers via `ops.external_refs (entity_type='ops.item', system='bc')` (I10);
a completion cannot be posted at all unless every item maps (enforced in
`mfg.post_completion`).

### Option A — Assembly Order
```jsonc
{
  "Item_No": "<BC output item no>",
  "Quantity": <qty_good>,
  "Location_Code": "<BC location>",
  "Posting_Date": "<YYYY-MM-DD>",
  "External_Document_No": "<production order no>",
  "Lot_No": "<output lot | null>",
  "Components": [
    { "Item_No": "<BC comp no>", "Quantity": <qty>, "Unit_of_Measure": "<uom>", "Lot_No": "<lot | null>" }
  ]
}
```

### Option B — Item Journal
```jsonc
{
  "Journal_Template_Name": "ITEM",
  "Journal_Batch_Name": "PRODUCTION",
  "Lines": [
    { "Entry_Type": "Positive Adjmt.", "Item_No": "<output>", "Quantity": <qty_good>, "Location_Code": "...", "Posting_Date": "...", "Document_No": "<PO no>", "Lot_No": "..." },
    { "Entry_Type": "Negative Adjmt.", "Item_No": "<comp>",  "Quantity": <qty>,      "Unit_of_Measure_Code": "<uom>", "Location_Code": "...", "Document_No": "<PO no>", "Lot_No": "..." }
  ]
}
```

> Field names are the contract **stub**. Confirm against the live BC OData
> `$metadata` before enabling deliver mode; only the two builder functions change.

## Delivery semantics

- **Idempotency.** Key `mfg:po:<po_id>:completion:<seq>` is sent as
  `x-idempotency-key`; BC (or the bridge's pre-check) must treat a repeat as the
  same document. `ops.integration_outbox.idempotency_key` is unique.
- **Success** → `ops.outbox_mark_sent(outbox_id, bc_document_no)`: stamps the
  ref, writes `mfg.completions.bc_document_no`, maps the completion in
  `external_refs`, and logs `bc_posted` (actor `system`). *(Validated locally.)*
- **Failure** → `ops.outbox_mark_failed(outbox_id, error, dead)`: increments
  attempts; after `BRIDGE_MAX_ATTEMPTS` the row is `dead` and surfaces on the
  admin outbox monitor for retry/mark-dead.
- **Batching / retry** are the bridge's; app code only ever enqueues (P2/I2).

## Testing without on-prem BC

`supabase/functions/bc-mock` emulates the BC OData create (returns a synthetic
`Document_No`; `?fail=true` exercises the retry path). To run the full loop in
staging: deploy `bc-mock`, set `BC_ODATA_URL` to its URL + `BRIDGE_SECRET`, and
invoke the bridge in deliver mode. **Never point production at `bc-mock`.** The
DB-side finalisation (`outbox_mark_sent`) is already validated against seeded
outbox rows.

## Open items (need on-prem BC — Prasanna/Srini)

1. Real BC OData endpoint URL + auth (`BC_ODATA_URL`, `BC_ODATA_AUTH`).
2. Confirm Assembly Order OData availability on the Essentials tier; if absent,
   set `BC_POSTING_MODE=item_journal` and confirm the `PRODUCTION` batch exists.
3. Exact `$metadata` field names + whether idempotency is honoured natively or
   needs a pre-check query.
4. Location codes + posting-date policy with finance.
5. Parallel-run reconciliation (Stage 2): daily diff of BC postings vs
   `mfg.completions` for one week before finance sign-off.
