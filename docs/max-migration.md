# MAX data migration (plan §10, E-MAX0 / E-MAX7)

How historical MAX data lands in the platform and is reconciled during the
parallel run. **Gated on on-prem access** (the `max_ro` login — Prasanna,
Phase 0); the schema, loaders, and reconciliation harness below are ready now so
that the moment `max_ro` exists it's an extract-and-run.

## Pipeline

```
MAX SQL Server ──(max_ro, read-only)──▶ max_stage.<entity> (raw jsonb, per batch)
                                              │  idempotent loaders (SQL, this repo)
                                              ▼
                              canonical schema (ops / mfg)  +  reconciliation views
```

- **Landing** (`max_stage`, migration `0005`): one raw table per in-scope entity
  (`parts, boms, routings, work_centres, open_production_orders, wip_balances,
  lot_history, planner_params`), each row = the verbatim MAX row as `jsonb` +
  `natural_key` + `batch_id`. **No transformation in `max_stage`** (§10).
  `extract_batches` records source rowcounts per extract for validation.
- **Loaders** (migration `0025`): transform the LATEST batch per entity into the
  canonical schema. Idempotent (re-runnable), admin-gated, safe no-ops on empty
  staging. Every load records `loaded_rowcount` and logs an event.

## Load order (§10) and status

| # | Load | Target | Status | Acceptance gate |
|---|------|--------|--------|-----------------|
| 1 | Part cross-reference | `ops.external_refs (system='max')` | **shipped** (`load_part_xrefs`) | **100% match** — `v_unmatched_parts` empty (D-6) |
| 2 | Work centres | `mfg.work_centres` | pending M0 shapes | count match |
| 3 | BOMs | `mfg.boms` / `bom_lines` | pending M0 shapes | explosion-equivalence vs MAX |
| 4 | Routings | `mfg.routings` / `routing_operations` | pending M0 shapes | count + std-hours per work centre |
| 5 | Planner params | `mfg.planning_params` | pending M0 shapes | spot-check |
| 6 | Open orders + WIP | prefer **burn-down**; only long-runners migrate | pending M0 shapes | zero orphaned WIP; finance reconciles |

Loaders 2–6 are deliberately not written against guessed columns — they land
once M0 pins the real MAX shapes (see "expected payload" notes in each loader).

## Expected `max_stage.parts` payload (CONFIRM in M0)

```json
{ "part_no": "MAX part/business key", "bc_item_no": "BC item no (if MAX stores it)", "description": "..." }
```

`load_part_xrefs()` resolves each part to a canonical `ops.item` by `bc_item_no`
(via the existing `system='bc'` mapping) or, failing that, by `part_no =
ops.items.item_no`, and writes a `system='max'` external ref. Anything it can't
resolve appears in `max_stage.v_unmatched_parts` — the D-6 cleanup list that
must be emptied before the gate passes.

## Running a load (once `max_ro` + an extract exist)

```sql
-- 1. an extraction job (CI, using max_ro) lands raw rows + a batch:
--    insert into max_stage.extract_batches(entity, source_rowcount) ...
--    insert into max_stage.parts(batch_id, natural_key, payload) ...
-- 2. transform + reconcile (admin session):
select * from max_stage.load_part_xrefs();          -- => (matched, unmatched)
select * from max_stage.v_unmatched_parts;           -- must be empty to pass D-6
select * from max_stage.v_load_reconciliation;       -- not_loaded must be 0
```

Loads run via **CI, not by hand** (§10); every load is re-runnable and leaves
`external_refs` idempotent. Verified locally end-to-end: 3 parts → 2 matched
(by item_no and by bc_item_no) + 1 unmatched surfaced, reconciliation
source 3 / loaded 2, re-run produced no duplicate refs.

## Decommission (Stage 4)

After the 30-day quiet period, `max_stage` and the `max_ro` login are dropped
and the MAX SQL database is archived read-only (retention D-8, suggest 7 years).
Lot history imported with `source='max_history'` stays as read-only genealogy
context — it never drives transactions.
