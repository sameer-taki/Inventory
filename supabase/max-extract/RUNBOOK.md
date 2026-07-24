# On-site MAX cutover runbook (read path)

Ordered steps for whoever has access to the on-prem MAX SQL Server (Prasanna for
provisioning; planner + Aqib for the acceptance gates). Every MAX interaction is
read-only. Do the steps in order — each gate blocks the next.

## Pre-req — network
The platform reaches MAX only through the Azure bridge host (GML-AI / MCP Hub).
Add a firewall rule: that host → MAX SQL Server :1433. MAX is never public.

## Step 1 — Provision `max_ro`
Run `provision_max_ro.sql` on the MAX SQL Server as sysadmin. Set a strong
password from the vault (not the placeholder).

**Read-only proof — this MUST print "OK: writes denied" (run as max_ro):**
```sql
BEGIN TRY
    -- pick any in-scope table; the insert must be rejected
    INSERT INTO dbo.Parts (PartNo) VALUES ('__ro_probe__');
    PRINT 'FAIL: max_ro was able to write — fix the grants before continuing';
END TRY
BEGIN CATCH
    PRINT 'OK: writes denied (' + ERROR_MESSAGE() + ')';
END CATCH
```
**Gate:** writes denied, and a `SELECT TOP 1` on an in-scope table succeeds.

## Step 2 — Discover the schema (D-1)
Run `discover_max_schema.sql` as max_ro. Save the four result sets. Using them,
fill `entity-mapping.md` (real table.column per payload key) and update the
`SOURCES` queries + `key` functions in `extract.mjs` to alias the real columns to
the documented payload keys.
**Gate:** every in-scope entity has a confirmed source table + key columns; the
entity-mapping worksheet has no blanks for entities in scope.

## Step 3 — Dry-run the pipeline (no MAX)
Before touching MAX data, prove the toolchain on your DB target:
```bash
cd supabase/max-extract && npm i pg mssql
export SUPABASE_DB_URL='postgresql://…'      # a NON-prod branch DB is ideal
node extract.mjs --sample
psql "$SUPABASE_DB_URL" -c "select * from max_stage.load_part_xrefs();"
psql "$SUPABASE_DB_URL" -c "select * from max_stage.v_load_reconciliation;"
```
**Gate:** batches land; `load_part_xrefs` matches the sample parts; reconciliation
reads back. (This is exactly what was verified in the repo.)

## Step 4 — Real extraction
```bash
export MAX_MSSQL_URL='Server=…;Database=MAX;User Id=max_ro;Password=…;Encrypt=true'
node extract.mjs                 # all entities → one batch each
```
**Gate:** `max_stage.v_load_reconciliation.source_rowcount` per entity matches the
MAX row counts from discovery (step 2).

## Step 5 — Load #1 + part cross-ref audit (D-6)
```sql
select * from max_stage.load_part_xrefs();
select * from max_stage.v_unmatched_parts;   -- work this to EMPTY
```
**Gate (D-6):** `v_unmatched_parts` empty — 100% MAX part ↔ canonical item match.
Unmatched parts are a data-cleanup task; do not proceed until zero.

## Step 6 — Loads #2–#6
Once step 2 pins the shapes, the loaders for work centres / BOMs / routings /
planner params are written to those confirmed columns and added to the loader
migration, then:
```sql
-- (added post-discovery)
select mfg.load_work_centres(); select mfg.load_boms();
select mfg.load_routings();     select mfg.load_planner_params();
select * from max_stage.v_load_reconciliation;   -- not_loaded = 0 for each
```
Open orders/WIP: prefer burn-down (migrate none). **Gates:** count match;
explosion-equivalence (BOMs); std-hours per work centre (routings).

## Step 7 — Parallel run + acceptance
- **Stage 2 (production):** run mfg production orders alongside MAX; the daily
  reconciliation compares output/consumption/WIP to `mfg.completions`. Finance
  signs one clean week → MAX read-only for execution (G2).
- **Stage 3 (planning):** `node extract.mjs --entity=mrp_recommendations` each
  cycle, run MRP in shadow mode, and clear `/manufacturing/shadow` until every
  variance is categorised. Planner + Aqib sign the variance report (G3) → MAX
  planning off.
- **Stage 4:** 30-day quiet period → archive MAX read-only → drop `max_ro` and
  `max_stage` (tails of `provision_max_ro.sql` and the schema).
