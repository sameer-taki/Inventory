# MAX Replacement — Manufacturing Build Plan

**Golden Manufacturers Group · Operations Platform Extension**

| | |
|---|---|
| Version | v1.0 — Draft for review |
| Date | 19 July 2026 |
| Prepared by | Sameer (AI & Technology Lead) |
| Approval | Aqib Razak (Managing Director) |
| Infra actions | Prasanna (IT Manager) |
| Status | Awaiting G0 sign-off — no build starts before gate decisions below are locked |
| Parent document | golden-operations-platform-master (architecture, canonical DDL, gateway REST contract) |

---

## 1. Purpose and decision record

GMG will retire MAX ERP and eliminate its licensing, without upgrading Business Central to the Premium manufacturing tier. The manufacturing layer MAX currently provides will be built in-house as an extension of the golden-operations-platform.

**Decision already made (recorded here, not re-argued):** the goal is to be off all vendor manufacturing licensing — both the MAX fee and the BC Premium delta. BC **Essentials** is retained as the master system of record. The alternatives (stay on MAX; migrate to BC Premium manufacturing) were evaluated and consciously set aside.

**What this shrinks the build to.** Because BC Essentials already provides the item master, multi-location inventory with lot/serial tracking, purchasing and requisition worksheets, and standard/FIFO/average costing, the in-house build is *not* "all of MAX". It is the Premium-only manufacturing slice plus quality:

1. Production orders and shop-floor execution (consumption, output, labour)
2. Manufacturing BOMs and routings / work centres
3. MRP/MPS netting engine (the hard one — built last, validated hardest)
4. Capacity scheduling
5. Quality / NCR / CAPA (BC lacks this at any tier; also the Phase 3 priority in the Accura augmentation plan — one build serves both)
6. Lot/serial genealogy **through production** (lot master stays in BC; the consumption→output graph is ours)

**What this plan contains:** system-of-record boundary map, architecture, module map and build order, BC write-back contract, Postgres DDL, MRP engine specification, MAX data-migration plan, domain-by-domain parallel-run and cutover strategy, risk register, proposed Jira breakdown, and the decision gates that must be closed before code.

---

## 2. Invariants

Copy this block verbatim into the repo `CLAUDE.md`. Any change to an invariant requires a decision note and Aqib's sign-off.

```
MFG MODULE INVARIANTS — do not violate, do not "temporarily" work around

I1  BC Essentials is the sole master for: item master, inventory balances,
    lot/serial master, purchasing, costing, finance. The mfg module NEVER
    becomes an inventory master. If a quantity disagrees with BC, BC is right.

I2  golden-gateway is the single writer to BC. Every mfg posting to BC goes
    through integration_outbox with an idempotency key. No direct OData
    writes from app code, jobs, or scripts.

I3  Every cross-system entity is mapped in external_refs. Every state
    change on a production order, NCR, or CAPA is appended to the event log.
    No silent state mutation.

I4  All planning and costing math (MRP netting, projected inventory, BOM
    explosion, variance calcs) is deterministic SQL/Python. Never
    LLM-generated numbers. Claude may draft, explain, and summarise; it
    never computes a quantity that drives a transaction.

I5  Corrugated stays in Kiwiplan. The kit BOM remains materials-only and
    the mfg BOM NEVER mirrors Kiwiplan's production BOM. This module plans
    and executes only the plants/products currently in MAX (see D-1).

I6  Real-time OEE / machine-level OT capture is out of scope
    (ring-fenced do-not-hand-build, per platform master reference).

I7  MAX remains running and authoritative for a domain until that domain
    passes its parallel-run acceptance criteria. No big-bang cutover.
    Cutover order: Quality → Production execution → MRP/planning.

I8  Lot genealogy edges (lot_consumption) are append-only and immutable.
    Corrections are new reversing rows, never updates or deletes.

I9  Quality records (NCR/CAPA) are append-only with logged status
    transitions. An NCR is never deleted, only dispositioned.

I10 A production order can only post to BC if its material and output
    lines carry valid BC item numbers resolved via external_refs.
```

---

## 3. System-of-record boundary map

This table is the scope. Anything not marked **BUILD** is either already owned by an existing system or explicitly out of scope.

| Capability | System of record | Disposition |
|---|---|---|
| Item master, UoM, item costing method | BC Essentials | Keep — read via gateway |
| Inventory balances, locations, bins | BC Essentials | Keep — snapshot via gateway (freshness SLA applies) |
| Lot/serial **master** and item ledger | BC Essentials | Keep — mfg postings carry lot/serial into BC |
| Purchasing (vendors, POs, receipts) | BC Essentials (+ procurement app front-end, KAN-37–42) | Keep |
| Purchase planning execution | BC requisition worksheet, fed by mfg MRP output | Keep + integrate (D-5) |
| Finance / GL / AP / AR | BC Essentials | Keep — untouched |
| Manufacturing BOMs (multi-level, versioned) | **mfg module** | **BUILD** (M3) |
| Routings, work centres, shift calendars | **mfg module** | **BUILD** (M3) |
| Production orders + shop-floor execution | **mfg module** | **BUILD** (M2) |
| WIP tracking and production costing roll-up | **mfg module** (posting vehicle per D-3) | **BUILD** (M2) |
| MPS (forecast + firm plan) | **mfg module** | **BUILD** (M4) |
| MRP netting engine + action messages | **mfg module** | **BUILD** (M4) |
| Capacity scheduling (finite) | **mfg module** | **BUILD** (M5) |
| Quality / NCR / CAPA | **quality module** | **BUILD** (M1 — first) |
| Lot genealogy through production | **mfg module** (graph) + BC (lot master) | **BUILD** (M6) |
| Corrugated production, scheduling, production BOM | Kiwiplan | Unchanged (I5) |
| Label/print estimating and production | Accura | Unchanged (separate augmentation plan) |
| Real-time OEE / machine monitoring | — | Out of scope (I6) |
| Engineering change orders (ECO) | mfg module (lightweight: BOM/routing versioning + approval) | BUILD-lite inside M3, not a full PLM |

**Discovery item D-1 (Phase 0, blocks everything):** confirm the exact plant/product streams and user census currently planned and executed in MAX (expected: molded-fibre and any non-corrugated, non-print streams). The MAX user list also drives the BC licence check in D-2.

---

## 4. Architecture

The mfg and quality modules are **modules of the golden-operations-platform**, not a new system. They live in the existing canonical Postgres database as new schemas (`mfg`, `quality`), are served by golden-gateway (FastAPI, single writer), and reuse the platform's `external_refs`, `integration_outbox`, and event-log conventions unchanged.

```
                    ┌──────────────────────────────────────────────┐
                    │        Operations Platform Apps (web)         │
                    │  Quality/NCR · Production · Planning (MRP)    │
                    └──────────────────────┬───────────────────────┘
                                           │ REST (platform SSO/RBAC)
                              ┌────────────▼────────────┐
                              │      golden-gateway      │
                              │  single writer · outbox  │
                              │  external_refs · events  │
                              └──┬───────────┬───────────┘
                    canonical DB │           │ integration bridge (Azure VM GML-AI / MCP Hub)
              ┌──────────────────▼──┐     ┌──▼──────────────────────────────┐
              │ Postgres             │     │ BC on-prem 172.16.1.10          │
              │  ops (existing)      │     │  OData v4 · items · inventory   │
              │  mfg (new)           │     │  lots · POs · journals/assembly │
              │  quality (new)       │     ├─────────────────────────────────┤
              │  max_stage (migr.)   │     │ Kiwiplan SQL (read-only) — I5   │
              └──────────────────────┘     ├─────────────────────────────────┤
                                           │ MAX SQL Server (read-only,      │
                                           │  `max_ro`) — migration + shadow │
                                           └─────────────────────────────────┘
```

Key points:

- **Read path from BC:** item master, inventory snapshots, open POs, sales orders — via the existing gateway BC adapter. MRP netting runs against snapshots with an explicit **freshness SLA** (platform Phase 0 decision; reconfirm value here, see D-7).
- **Write path to BC:** production consumption/output (with lot/serial) via `integration_outbox`, idempotency key per posting event (I2). The BC document vehicle is decision **D-3** (§6).
- **Read path from MAX:** a new **read-only SQL login `max_ro`** on the MAX SQL Server, mirroring the `kiwiplan_ro` pattern. Used for schema discovery, migration extraction into `max_stage`, and daily reconciliation during parallel run. Prasanna action, Phase 0. Optionally exposed as an MCP Hub connector (port 8084) for interactive discovery — same Compose/Caddy/bearer-token pattern as the existing connectors.
- **Auth/hosting:** platform-standard SSO, RBAC roles per module (planner, supervisor, operator, quality, viewer). Deployment follows current platform hosting conventions; nothing in this plan is host-specific.
- **No new infrastructure** is required beyond the `max_ro` login and two Postgres schemas.

---

## 5. Module map and build order

Sequencing is risk-driven and locked (I7): the net-new, zero-dependency module first; the BC-write-back module second; the netting engine and genealogy last, validated hardest. Effort is relative (S/M/L) per platform convention — calendar dates come after G0 when D-1/D-2 close.

| # | Module | Depends on | Effort | Parallel-run? |
|---|---|---|---|---|
| **M0** | Foundations & discovery (max_ro, plant census, item cross-ref audit, D-3 spike, schemas) | — | M | n/a |
| **M1** | Quality / NCR / CAPA | M0 | M | No — net-new, adoption-gated |
| **M2** | Production management: production orders, shop-floor consumption/output/labour, BC write-back | M0, M3 masters loaded | L | **Yes** — 2–4 weeks vs MAX |
| **M3** | Manufacturing BOMs, routings, work centres (+ lightweight ECO/versioning) | M0 | M | Explosion-equivalence test vs MAX |
| **M4** | MPS + MRP netting engine + action messages | M2 live, M3 migrated | L | **Yes** — shadow-run ≥ 2 planning cycles |
| **M5** | Capacity scheduling (finite) | M2, M3 | M | No — advisory at first |
| **M6** | Lot/serial genealogy through production | M2 | M | Trace-equivalence vs MAX history |

Notes:

- **M1 first** is deliberate: highest standalone value, no MRP dependency, proves the module pattern, and satisfies the Accura plan's Phase 3 priority in the same build. It ships while M0 discovery and M3 data loading proceed.
- **M3 before M2 goes live:** production orders can't execute without BOMs/routings in place; M3 is mostly data migration plus maintenance UI, so it overlaps M1.
- **M5 ships advisory-only** (load view, no hard finite constraints) until M2/M4 are stable — BC's own planning assumes infinite capacity, so this is already better than the Premium baseline it replaces.
- **M6 genealogy** starts capturing edges from the first M2 posting; the module itself (trace UI, recall drill, MAX history import) completes last.

---

## 6. BC write-back contract — Decision D-3

The single most important integration decision: **which BC document carries production consumption and output into the master**. Two candidates, one spike to decide (M0, one week, timeboxed):

**Option A — BC Assembly Orders (recommended starting hypothesis).** Essentials includes Assembly Management. Each mfg completion event posts an assembly order: output item + quantity on the header, consumed materials (with lot/serial tracking) as lines, labour as resource lines. BC computes the cost roll natively (materials + resources), keeps the item ledger, lot ledger, and value entries linked in one document, and costing stays entirely BC-owned (I1).
*Constraints to validate in the spike:* single-level only (fine — multi-level structure lives in mfg; each completion posts one level); behaviour under partial completions (likely one assembly order per completion event, not per production order); OData exposure of assembly orders + item tracking lines on our BC version; posting performance under NTLM.

**Option B — Item journals (fallback).** Negative adjustment (consumption) + positive adjustment (output) journal lines with lot/serial tracking, optionally through a WIP location. Simpler API surface, proven pattern. Cost of goods produced must then be computed by the mfg module and stamped on the output line (standard cost or rolled actual) — weaker native cost linkage, more of I4 resting on our code.

**Contract (either option):**

- One outbox row per completion event; idempotency key = `mfg:po:{production_order_id}:completion:{seq}`.
- Posting payload always carries: BC item no. (via `external_refs`), location, quantity, UoM, lot/serial assignments, posting date, and the mfg production order no. in the document's external reference field.
- On BC success: BC document no. written back to `external_refs`; event appended. On failure: outbox retry with backoff; poison rows surface in an ops queue — never silently dropped.
- **Purchase side (D-5):** MRP planned purchases are handed to the existing procurement app queue (KAN-37–42) which already owns BC PO creation — not written to BC directly by the mfg module. One writer per document type.

---

## 7. Data model — Postgres DDL (core)

New schemas in the existing canonical database. Conventions follow the platform master: `bigint identity` PKs, `created_at/updated_at timestamptz`, soft status enums as `text` + CHECK, all cross-system IDs via `external_refs`, event rows for every state change. DDL below is the reviewable core; column-complete migration files are an M0 ticket.

```sql
-- ============================================================
-- SCHEMA: mfg — masters
-- ============================================================
CREATE SCHEMA IF NOT EXISTS mfg;
CREATE SCHEMA IF NOT EXISTS quality;

CREATE TABLE mfg.work_centres (
    work_centre_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             text NOT NULL UNIQUE,
    name             text NOT NULL,
    plant            text NOT NULL,                -- per D-1 plant list
    capacity_uom     text NOT NULL DEFAULT 'minutes',
    daily_capacity   numeric(12,2) NOT NULL DEFAULT 0,   -- per calendar day, pre-efficiency
    efficiency_pct   numeric(5,2) NOT NULL DEFAULT 100,
    labour_rate      numeric(12,4),                -- FJD/hr, used in cost roll (D-3B only)
    overhead_rate    numeric(12,4),
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfg.shift_calendars (
    calendar_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_centre_id   bigint NOT NULL REFERENCES mfg.work_centres,
    day_of_week      smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    shift_start      time NOT NULL,
    shift_end        time NOT NULL,
    effective_from   date NOT NULL,
    effective_to     date
);

-- Manufacturing BOM: versioned header, effectivity-dated. NEVER mirrors
-- Kiwiplan's production BOM (I5). Parent/child items are BC item numbers
-- resolved via external_refs at posting time (I10).
CREATE TABLE mfg.boms (
    bom_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint NOT NULL,              -- FK -> ops.items (canonical, BC-mastered)
    version_no       int NOT NULL DEFAULT 1,
    status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','superseded','obsolete')),
    effective_from   date NOT NULL,
    effective_to     date,
    approved_by      bigint,                       -- FK -> ops.users
    approved_at      timestamptz,
    source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','max_migration')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, version_no)
);

CREATE TABLE mfg.bom_lines (
    bom_line_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bom_id           bigint NOT NULL REFERENCES mfg.boms,
    line_no          int NOT NULL,
    component_item_id bigint NOT NULL,             -- FK -> ops.items
    qty_per          numeric(18,6) NOT NULL CHECK (qty_per > 0),
    uom              text NOT NULL,
    scrap_pct        numeric(5,2) NOT NULL DEFAULT 0,
    is_phantom       boolean NOT NULL DEFAULT false,
    operation_seq    int,                          -- optional link to routing op for backflush point
    UNIQUE (bom_id, line_no)
);

CREATE TABLE mfg.routings (
    routing_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint NOT NULL,
    version_no       int NOT NULL DEFAULT 1,
    status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','superseded','obsolete')),
    effective_from   date NOT NULL,
    effective_to     date,
    source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','max_migration')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, version_no)
);

CREATE TABLE mfg.routing_operations (
    operation_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routing_id       bigint NOT NULL REFERENCES mfg.routings,
    operation_seq    int NOT NULL,
    work_centre_id   bigint NOT NULL REFERENCES mfg.work_centres,
    description      text NOT NULL,
    setup_minutes    numeric(12,2) NOT NULL DEFAULT 0,
    run_minutes_per_unit numeric(12,4) NOT NULL DEFAULT 0,
    queue_minutes    numeric(12,2) NOT NULL DEFAULT 0,
    UNIQUE (routing_id, operation_seq)
);

-- ============================================================
-- SCHEMA: mfg — execution
-- ============================================================
CREATE TABLE mfg.production_orders (
    production_order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no         text NOT NULL UNIQUE,         -- MFG-YYYYNNNNN sequence
    item_id          bigint NOT NULL,
    bom_id           bigint NOT NULL REFERENCES mfg.boms,
    routing_id       bigint REFERENCES mfg.routings,
    plant            text NOT NULL,
    qty_ordered      numeric(18,4) NOT NULL CHECK (qty_ordered > 0),
    qty_completed    numeric(18,4) NOT NULL DEFAULT 0,
    qty_scrapped     numeric(18,4) NOT NULL DEFAULT 0,
    uom              text NOT NULL,
    due_date         date NOT NULL,
    scheduled_start  date,
    scheduled_end    date,
    status           text NOT NULL DEFAULT 'planned'
                     CHECK (status IN ('planned','firm','released','in_progress',
                                       'completed','closed','cancelled')),
    origin           text NOT NULL DEFAULT 'manual'
                     CHECK (origin IN ('manual','mrp','max_migration')),
    planned_order_id bigint,                       -- FK -> mfg.planned_orders when MRP-firmed
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfg.po_operations (
    po_operation_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES mfg.production_orders,
    operation_seq    int NOT NULL,
    work_centre_id   bigint NOT NULL REFERENCES mfg.work_centres,
    status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','done','skipped')),
    setup_minutes_actual numeric(12,2) DEFAULT 0,
    run_minutes_actual   numeric(12,2) DEFAULT 0,
    UNIQUE (production_order_id, operation_seq)
);

-- Completion event: the unit of BC posting (one outbox row each, I2/D-3)
CREATE TABLE mfg.completions (
    completion_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES mfg.production_orders,
    seq              int NOT NULL,                 -- per-order completion sequence
    qty_good         numeric(18,4) NOT NULL DEFAULT 0,
    qty_scrap        numeric(18,4) NOT NULL DEFAULT 0,
    output_lot_no    text,                         -- minted per D-4, registered in BC
    posted_by        bigint NOT NULL,
    posted_at        timestamptz NOT NULL DEFAULT now(),
    bc_document_no   text,                         -- written back after BC posting succeeds
    outbox_id        bigint,                       -- FK -> ops.integration_outbox
    UNIQUE (production_order_id, seq)
);

CREATE TABLE mfg.material_consumption (
    consumption_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    completion_id    bigint NOT NULL REFERENCES mfg.completions,
    component_item_id bigint NOT NULL,
    qty              numeric(18,6) NOT NULL,       -- negative rows = reversal (I8 style)
    uom              text NOT NULL,
    lot_no           text,                         -- BC lot consumed
    method           text NOT NULL DEFAULT 'backflush'
                     CHECK (method IN ('backflush','manual_issue'))
);

CREATE TABLE mfg.labour_entries (
    labour_entry_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES mfg.production_orders,
    operation_seq    int,
    operator_id      bigint NOT NULL,
    work_centre_id   bigint NOT NULL REFERENCES mfg.work_centres,
    minutes          numeric(12,2) NOT NULL CHECK (minutes >= 0),
    entry_date       date NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Genealogy: append-only edge list (I8). Forward + backward trace by recursion.
CREATE TABLE mfg.lot_consumption (
    edge_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    completion_id    bigint NOT NULL REFERENCES mfg.completions,
    output_lot_no    text NOT NULL,
    consumed_item_id bigint NOT NULL,
    consumed_lot_no  text NOT NULL,
    qty              numeric(18,6) NOT NULL,
    source           text NOT NULL DEFAULT 'mfg'
                     CHECK (source IN ('mfg','max_history')),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_lotcons_output  ON mfg.lot_consumption (output_lot_no);
CREATE INDEX ix_lotcons_consumed ON mfg.lot_consumption (consumed_lot_no);

-- ============================================================
-- SCHEMA: mfg — planning
-- ============================================================
CREATE TABLE mfg.mps_entries (
    mps_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint NOT NULL,
    plant            text NOT NULL,
    bucket_start     date NOT NULL,                -- weekly buckets initially
    qty              numeric(18,4) NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('forecast','firm')),
    entered_by       bigint NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, plant, bucket_start, kind)
);

CREATE TABLE mfg.planning_params (
    item_id          bigint PRIMARY KEY,
    lead_time_days   int NOT NULL DEFAULT 0,
    safety_stock     numeric(18,4) NOT NULL DEFAULT 0,
    lot_policy       text NOT NULL DEFAULT 'lot_for_lot'
                     CHECK (lot_policy IN ('lot_for_lot','fixed_qty','min_multiple')),
    fixed_or_min_qty numeric(18,4),
    order_multiple   numeric(18,4),
    time_fence_days  int NOT NULL DEFAULT 0,
    make_or_buy      text NOT NULL CHECK (make_or_buy IN ('make','buy')),
    low_level_code   int NOT NULL DEFAULT 0        -- maintained by LLC job on BOM change
);

CREATE TABLE mfg.mrp_runs (
    mrp_run_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_type         text NOT NULL DEFAULT 'regenerative'
                     CHECK (run_type IN ('regenerative','net_change','shadow')),
    snapshot_at      timestamptz NOT NULL,         -- BC stock/PO snapshot used (freshness SLA, D-7)
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    status           text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','succeeded','failed')),
    params_hash      text NOT NULL                 -- determinism audit (I4)
);

CREATE TABLE mfg.planned_orders (
    planned_order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mrp_run_id       bigint NOT NULL REFERENCES mfg.mrp_runs,
    item_id          bigint NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('make','buy')),
    qty              numeric(18,4) NOT NULL,
    due_date         date NOT NULL,
    release_date     date NOT NULL,
    status           text NOT NULL DEFAULT 'suggested'
                     CHECK (status IN ('suggested','firmed','handed_off','dismissed')),
    pegging          jsonb                         -- demand sources this order covers
);

CREATE TABLE mfg.action_messages (
    action_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mrp_run_id       bigint NOT NULL REFERENCES mfg.mrp_runs,
    kind             text NOT NULL
                     CHECK (kind IN ('expedite','defer','cancel','increase','decrease')),
    target_type      text NOT NULL CHECK (target_type IN ('purchase_order','production_order')),
    target_ref       text NOT NULL,
    detail           jsonb NOT NULL,
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','actioned','dismissed'))
);

-- ============================================================
-- SCHEMA: quality — NCR / CAPA (M1; shared with Accura plan)
-- ============================================================
CREATE TABLE quality.ncrs (
    ncr_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ncr_no           text NOT NULL UNIQUE,         -- NCR-YYYYNNNN
    source           text NOT NULL
                     CHECK (source IN ('production','incoming','customer_complaint','audit','print')),
    plant            text,
    item_id          bigint,
    lot_no           text,
    production_order_id bigint,                    -- nullable; links to mfg when applicable
    description      text NOT NULL,
    severity         text NOT NULL CHECK (severity IN ('minor','major','critical')),
    disposition      text CHECK (disposition IN
                     ('use_as_is','rework','scrap','return_to_vendor','hold')),
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','under_review','dispositioned','closed')),
    raised_by        bigint NOT NULL,
    raised_at        timestamptz NOT NULL DEFAULT now(),
    closed_at        timestamptz
);

CREATE TABLE quality.capas (
    capa_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    capa_no          text NOT NULL UNIQUE,
    ncr_id           bigint REFERENCES quality.ncrs,
    kind             text NOT NULL CHECK (kind IN ('corrective','preventive')),
    root_cause       text,
    action_plan      text NOT NULL,
    owner_id         bigint NOT NULL,
    due_date         date NOT NULL,
    effectiveness_check text,
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','pending_verification','closed')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    closed_at        timestamptz
);

CREATE TABLE quality.status_events (               -- I9: every transition logged
    event_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type      text NOT NULL CHECK (entity_type IN ('ncr','capa')),
    entity_id        bigint NOT NULL,
    from_status      text,
    to_status        text NOT NULL,
    actor_id         bigint NOT NULL,
    note             text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SCHEMA: max_stage — migration landing (dropped after decommission)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS max_stage;
-- 1:1 raw copies of the MAX tables in scope (structure discovered in M0):
-- parts, boms, routings, work_centres, open_production_orders, wip_balances,
-- lot_history, planner_params. Each row carries extracted_at + source_rowcount
-- batch metadata for validation. No transformation in this schema.
```

---

## 8. MRP/MPS engine specification (M4 — the hard one)

This is the module that earns the "validated hardest" label. A planning bug here causes stockouts or over-purchasing silently. The design principle: **boring, textbook, deterministic MRP** — no cleverness.

**Inputs (all snapshot-stamped per run):**

1. Demand: BC sales orders (via gateway), MPS entries (`forecast` consumed by actual orders within the fence, `firm` always counted)
2. Supply: BC on-hand by location (snapshot within freshness SLA, D-7), open BC purchase orders, open mfg production orders, firmed planned orders
3. Structure: approved effective mfg BOMs (low-level coded), routings (for lead-time offsetting of operations later; day-level offset initially)
4. Policy: `planning_params` per item — lead time, safety stock, lot policy, time fence

**Algorithm (regenerative, nightly + on-demand):**

1. Refresh low-level codes if any BOM changed since last run
2. For each item in LLC order: gross requirements ← independent demand + parent planned-order explosions; net = gross − (on-hand − safety stock) − scheduled receipts, time-phased in daily buckets
3. Lot-size per policy; offset by lead time to get release dates; releases inside the time fence generate **action messages**, never auto-orders
4. Explode planned make orders through BOM (scrap-adjusted `qty_per × (1 + scrap_pct)`) to next level
5. Persist planned orders + action messages against the `mrp_run_id`; nothing from a previous run is mutated

**Outputs and handoff:**

- Planned **make** orders → planner reviews in-app → firm → becomes `mfg.production_orders` (origin `mrp`)
- Planned **buy** orders → handed to the procurement app queue (D-5); procurement app owns BC PO creation
- Action messages → planner queue with one-click dismiss/action, all logged

**Correctness harness (non-negotiable, built before the engine):**

- **Golden datasets:** ≥ 10 hand-computed scenarios (single-level, multi-level, phantom, scrap, safety stock, lot policies, time fence, past-due demand) with exact expected planned-order sets. CI fails on any diff.
- **Property tests:** projected on-hand never below safety stock without an action message; every demand pegged; explosion conservation (child requirements = Σ parent × qty_per × scrap factor); identical inputs ⇒ identical outputs (`params_hash` + input snapshot hash).
- **Shadow-run vs MAX (I7):** run in `shadow` mode against the same live data for **≥ 2 full planning cycles**. Diff our planned orders vs MAX's recommendations; every material variance explained and categorised (data difference vs logic difference vs MAX bug). G3 gate reviews this evidence.

---

## 9. Lot/serial genealogy (M6)

- **Lot master stays in BC** (I1). The mfg module mints output lot numbers per D-4 and registers them on the BC posting document; consumed lots are picked from BC lot availability at issue/backflush time.
- **The graph is ours:** `mfg.lot_consumption` edges, append-only (I8). Forward trace (supplier lot → every affected FG lot/shipment) and backward trace (FG lot → all inputs) are recursive SQL views.
- **Acceptance test:** a full mock-recall drill — given one raw-material lot number, produce the complete affected-FG list with quantities and BC shipment references in **under 5 minutes**, demonstrated to Aqib before G2 closes.
- **MAX history:** lot history imported into the same edge table with `source = 'max_history'` so traces spanning the cutover are continuous. Historical edges are read-only context — they never drive transactions.

---

## 10. MAX data migration plan (M0 + M7 workstream)

**Access:** `max_ro` read-only login on the MAX SQL Server (Prasanna, Phase 0). Extraction jobs land raw rows in `max_stage` with batch metadata. Optional MCP Hub connector (:8084) for interactive schema discovery.

**Entities, in migration order:**

| # | Entity | Target | Validation |
|---|---|---|---|
| 1 | Part master cross-reference | `external_refs` (MAX part ↔ BC item) | **100% match required.** Unmatched parts are a blocking data-cleanup task — likely the single biggest data risk (D-6) |
| 2 | Work centres + calendars | `mfg.work_centres`, `shift_calendars` | Count + spot review with production supervisors |
| 3 | BOMs (+ effectivity) | `mfg.boms/bom_lines`, `source='max_migration'`, status `approved` | Row counts, checksums, and the **explosion-equivalence test**: explode every top-level FG in both systems, requirement sets must match exactly |
| 4 | Routings | `mfg.routings/routing_operations` | Count + std-hours totals per work centre vs MAX |
| 5 | Planner parameters | `mfg.planning_params` | Field-by-field diff report, planner signs off |
| 6 | Open production orders + WIP | Prefer **burn-down**: release no new MAX orders after M2 go-live; only long-running orders migrate | Zero orphaned WIP at cutover; WIP value reconciled with finance |
| 7 | Lot history | `mfg.lot_consumption (source='max_history')` | Trace-equivalence: 20 sampled historical lots trace identically in both systems |

**Rules:** no transformation inside `max_stage`; every load is re-runnable and idempotent; migration scripts live in the repo and run via CI, not by hand; `max_stage` and the `max_ro` login are dropped after decommission, with the MAX SQL database archived read-only (retention period — D-8, suggest 7 years, confirm with Aqib/compliance).

---

## 11. Parallel run and cutover (I7)

Domain-by-domain, in this order, each with written acceptance criteria signed before the next starts:

**Stage 1 — Quality (M1).** Net-new; no parallel run. Acceptance = adoption: all new NCRs raised in the app for 4 consecutive weeks, zero raised on paper/MAX; first CAPA closed end-to-end in-app.

**Stage 2 — Production execution (M2/M3/M6 capture).** Run mfg production orders **alongside** MAX on the D-1 plant(s) for 2–4 weeks. Daily reconciliation job (reading `max_ro`) compares output qty, consumption qty, and WIP per order. Acceptance: variance within agreed tolerance with every exception explained; zero unexplained lot breaks; BC postings reconciled by finance for one full week. Then MAX becomes **read-only for execution** — no new MAX production orders.

**Stage 3 — Planning (M4).** Shadow-run per §8 for ≥ 2 planning cycles. Acceptance: variance report reviewed and signed by the planner and Aqib (G3). Then MAX planning is switched off entirely.

**Stage 4 — Decommission.** 30-day quiet period with MAX read-only and untouched → final archive of the MAX SQL database → licence termination per contract notice terms (**action: Aqib/Sameer to check the MAX contract notice period and any data-access clauses with Srini before Stage 2 dates are set**) → `max_ro` and `max_stage` removed. Re-issue this document as the as-built record.

**Rollback:** at any stage before its acceptance sign-off, rollback = keep using MAX (it is still authoritative, I7). After Stage 2 sign-off, rollback windows close per stage — which is exactly why the acceptance criteria are written down first.

---

## 12. Risk register

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R1 | **MRP correctness** — silent planning errors → stockouts/over-buying | M×**H** | Boring textbook algorithm; golden-dataset CI harness; property tests; ≥2-cycle shadow-run vs MAX; planner review of every suggested order initially (I4) |
| R2 | **Lot genealogy breaks** — trace gap ends recall capability | M×**H** | Append-only edges from first M2 posting; MAX history import; mock-recall drill as a hard G2 acceptance test |
| R3 | **MAX data migration quality** — bad BOMs/routings poison everything downstream | H×H | `max_stage` raw landing; explosion-equivalence + checksum validation; part cross-ref 100% match gate (D-6); burn-down for open orders |
| R4 | **Parallel-run fatigue** — double entry erodes discipline, reconciliation slips | H×M | Timebox 2–4 weeks per domain; daily automated reconciliation (not manual); supervisor ownership per plant; Aqib visibility on the variance dashboard |
| R5 | BC posting integrity — double-posts or drops under retry/NTLM flakiness | M×H | Outbox + idempotency keys (I2); poison queue with alerting; finance reconciliation in Stage 2 acceptance |
| R6 | Master-data drift — MAX parts not 1:1 with BC items | H×M | D-6 cross-ref audit in M0, **before** any module build depends on it |
| R7 | Costing gaps in Essentials without a production module | M×M | D-3 spike decides the vehicle; finance validates cost roll on pilot orders before Stage 2 sign-off |
| R8 | Key-person concentration (single builder/maintainer) | M×H | Everything as code in the repo; CLAUDE.md invariants; runbooks; Prasanna briefed on ops/infra; documentation re-issued as-built |
| R9 | Scope creep into MES/OEE or Kiwiplan territory | M×M | I5 + I6 are invariants; any breach needs an Aqib-signed decision note |
| R10 | Snapshot staleness → netting on wrong stock picture | M×M | Freshness SLA enforced in `mrp_runs.snapshot_at`; run aborts if snapshot older than SLA (D-7) |
| R11 | Shop-floor adoption/change management | M×M | Operators involved in M2 UI design; pilot line first; training before parallel run, not during |
| R12 | MAX contract exposure (notice period, data access post-termination) | L×H | Contract review with Srini/Aqib before Stage 2 dates committed |

---

## 13. Proposed Jira breakdown (KAN project)

To be created **after G0 sign-off** — listed here for review, not yet raised. Program epic plus one epic per module; ticket granularity matches the procurement-app convention (KAN-37–42 style, acceptance criteria on every ticket).

- **E-MAX0 — Foundations & discovery:** `max_ro` login + firewall path (Prasanna) · MAX schema discovery + entity mapping doc · D-1 plant/user census · D-6 part↔item cross-ref audit + cleanup list · D-3 BC write-back spike (assembly order vs item journal, timeboxed 1 wk) · `mfg`/`quality`/`max_stage` schema migrations · RBAC roles
- **E-MAX1 — Quality/NCR/CAPA:** NCR raise/disposition flow · CAPA lifecycle + verification · status-event log (I9) · lot/production-order linkage · dashboards (open NCRs, ageing, Pareto by cause) · Stage 1 adoption acceptance
- **E-MAX2 — BOMs/routings/work centres:** maintenance UI + approval/versioning (ECO-lite) · LLC job · migration loads 2–5 (§10) · explosion-equivalence harness
- **E-MAX3 — Production management:** production order lifecycle · shop-floor completion UI (tablet-friendly) · backflush + manual issue · labour capture · outbox posting per D-3 contract · genealogy edge capture · daily MAX reconciliation job · Stage 2 parallel run
- **E-MAX4 — MRP/MPS:** MPS maintenance · golden-dataset harness (**first ticket in the epic**) · netting engine · action messages · planned-order firm/handoff (D-5) · shadow-run diff tooling · Stage 3 acceptance
- **E-MAX5 — Capacity (advisory):** work-centre load view from routings × open orders · overload flags on planned orders
- **E-MAX6 — Genealogy & traceability:** trace views + UI · MAX lot-history import · mock-recall drill
- **E-MAX7 — Migration & cutover:** open-order burn-down plan · WIP/finance reconciliation · decommission runbook · contract termination checklist · as-built re-issue

---

## 14. Decision gates and open items

**Gates:**

| Gate | Closes when | Owner |
|---|---|---|
| **G0** | This plan reviewed; D-1..D-8 dispositioned; Aqib signs; Prasanna acknowledges infra items | Aqib |
| **G1** | Stage 1 (Quality) acceptance met → E-MAX3 build proceeds to pilot | Sameer |
| **G2** | Stage 2 (Production) acceptance + mock-recall drill passed → MAX execution off | Aqib |
| **G3** | Stage 3 shadow-run variance report signed → MAX planning off, decommission starts | Aqib + planner |

**Decisions to close at G0:**

- **D-1** Plant/product streams and user census currently in MAX (blocks scope + licence check)
- **D-2** BC licence check: shop-floor users on Team Member licences; confirm Essentials seat counts cover M2 posting users
- **D-3** BC write-back vehicle — spike outcome (assembly orders recommended hypothesis, §6)
- **D-4** Lot numbering: mfg-minted format (proposed `LOT-{plant}-{yymmdd}-{seq}`) vs BC number series — and who assigns serials if any items are serial-tracked
- **D-5** Planned-purchase handoff: procurement app queue (recommended) vs direct BC requisition-worksheet write
- **D-6** Part↔item cross-reference audit result: proceed only at 100% match or with a signed cleanup plan
- **D-7** Reconfirm the inventory-snapshot freshness SLA value for netting (platform Phase 0 decision; MRP aborts on stale snapshots)
- **D-8** MAX database archive retention period post-decommission (suggest 7 years; confirm against customer/regulatory trace obligations)
- **Contract:** MAX notice period + post-termination data access — Aqib/Sameer with Srini, before Stage 2 dates

---

## 15. Document control

| Version | Date | Change |
|---|---|---|
| v1.0-draft | 19 Jul 2026 | Initial plan for Aqib/Prasanna review |
| v1.1 | — | Post-G0: decisions D-1..D-8 recorded, dates added, Jira epics raised |
| v2.0-as-built | — | At decommission: re-issued as the as-built record |

*Extension of `golden-operations-platform-master`. Invariants in §2 are the authoritative copy for the repo CLAUDE.md.*
