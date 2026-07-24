# MAX extraction (max_ro → max_stage)

The read path from MAX during the parallel run (plan §10, E-MAX0/E-MAX7).
**Everything here is gated on on-prem access** — it runs the moment the `max_ro`
login exists and the MAX SQL Server is reachable from the Azure bridge host.

## Steps

### 1. Provision `max_ro` (on-site, sysadmin — Prasanna)
Run `provision_max_ro.sql` on the MAX SQL Server. It creates a least-privilege,
**read-only** login (`db_datareader` + explicit `DENY` on all writes), mirroring
`kiwiplan_ro`. Set a real password from the vault; add the firewall rule so only
the Azure bridge host reaches MAX:1433. MAX is never exposed publicly.

### 2. Confirm the MAX shapes (M0 / D-1)
The `SELECT`s in `extract.mjs` (`SOURCES`) and the payload keys the loaders read
(`part_no`, `bc_item_no`, `qty`, `due_date`, …) are **placeholders**. Point them
at the real MAX table/column names discovered during schema discovery. Nothing
downstream changes — only these query strings and key mappings.

### 3. Run the extraction
```bash
cd supabase/max-extract
npm i pg mssql          # ops-only deps, not in the app bundle

export SUPABASE_DB_URL='postgresql://…'   # canonical DB (service connection)
export MAX_MSSQL_URL='Server=…;Database=MAX;User Id=max_ro;Password=…;Encrypt=true'

node extract.mjs                 # every in-scope entity → one batch each
node extract.mjs --entity=parts  # a single entity
node extract.mjs --sample        # no MAX: land representative fixtures to
                                 # exercise the whole pipeline first
```
Each run lands raw MAX rows as `jsonb` into `max_stage.<entity>` with an
`extract_batches` row recording the source rowcount. Re-runnable — the loaders
always read the latest batch per entity.

### 4. Transform + reconcile
```sql
select * from max_stage.load_part_xrefs();     -- load #1 (D-6, 100% match gate)
select * from max_stage.v_unmatched_parts;      -- must be empty to pass
select * from max_stage.v_load_reconciliation;  -- source vs loaded per entity
```
Loads #2–#6 (work centres, BOMs, routings, planner params, open orders/WIP) are
added to the loader migration once step 2 pins the shapes.

### 5. Parallel-run reconciliation (Stage 2/3)
- **Production (Stage 2):** the daily job compares MAX output/consumption/WIP to
  `mfg.completions`; every variance explained before finance sign-off.
- **Planning (Stage 3):** land MAX's suggestions via
  `node extract.mjs --entity=mrp_recommendations`, run MRP in shadow mode, and
  work `/manufacturing/shadow` until every variance is categorised (G3).

## In-scope entities

| max_stage table | MAX source (confirm) | canonical loader |
|---|---|---|
| `parts` | item/part master | `load_part_xrefs` → `ops.external_refs` (system='max') |
| `work_centres` | work centres | pending #2 → `mfg.work_centres` |
| `boms` | BOM header+lines | pending #3 → `mfg.boms`/`bom_lines` |
| `routings` | routing + operations | pending #4 → `mfg.routings`/`routing_operations` |
| `planner_params` | planning parameters | pending #5 → `mfg.planning_params` |
| `open_production_orders` / `wip_balances` | open orders + WIP | pending #6 (burn-down preferred) |
| `lot_history` | lot genealogy history | append to genealogy with `source='max_history'` |
| `mrp_recommendations` | MRP suggestions | shadow-run diff (`mfg.v_mrp_shadow_diff`) |

## Decommission (Stage 4)
After the quiet period: drop `max_ro` (tail of `provision_max_ro.sql`), drop the
`max_stage` schema, archive the MAX DB read-only (retention D-8).
