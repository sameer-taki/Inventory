-- ============================================================================
-- 0003_mfg.sql  ·  MAX plan M2–M6 (E-MAX2..6) · master plan modules 8–12
-- ----------------------------------------------------------------------------
-- Manufacturing: masters (BOMs, routings, work centres), execution (production
-- orders, completions, consumption, labour, genealogy) and planning (MPS, MRP).
-- Transcribed faithfully from max-replacement-build-plan §7. Cross-system ids
-- resolve via ops.external_refs (I10); BC postings queue in ops.integration_outbox
-- (I2). Schema is laid now; module UIs land per the build sequence.
--
-- NOTE: item_id / component_item_id reference ops.items (canonical, BC-mastered,
-- P1/I1). *_by / operator_id reference ops.users.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS mfg;

-- ─── masters (M3) ───────────────────────────────────────────────────────────
CREATE TABLE mfg.work_centres (
    work_centre_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             text NOT NULL UNIQUE,
    name             text NOT NULL,
    plant            text NOT NULL,                     -- per D-1 plant list
    capacity_uom     text NOT NULL DEFAULT 'minutes',
    daily_capacity   numeric(12,2) NOT NULL DEFAULT 0,  -- per calendar day, pre-efficiency
    efficiency_pct   numeric(5,2) NOT NULL DEFAULT 100,
    labour_rate      numeric(12,4),                     -- FJD/hr, cost roll (D-3B only)
    overhead_rate    numeric(12,4),
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_wc_touch BEFORE UPDATE ON mfg.work_centres
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

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
-- Kiwiplan's production BOM (I5). Parent/child items are BC items via external_refs (I10).
CREATE TABLE mfg.boms (
    bom_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint NOT NULL REFERENCES ops.items (item_id),
    version_no       int NOT NULL DEFAULT 1,
    status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','superseded','obsolete')),
    effective_from   date NOT NULL,
    effective_to     date,
    approved_by      bigint REFERENCES ops.users (user_id),
    approved_at      timestamptz,
    source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','max_migration')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, version_no)
);
CREATE TRIGGER trg_boms_touch BEFORE UPDATE ON mfg.boms
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

CREATE TABLE mfg.bom_lines (
    bom_line_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bom_id            bigint NOT NULL REFERENCES mfg.boms,
    line_no           int NOT NULL,
    component_item_id bigint NOT NULL REFERENCES ops.items (item_id),
    qty_per           numeric(18,6) NOT NULL CHECK (qty_per > 0),
    uom               text NOT NULL,
    scrap_pct         numeric(5,2) NOT NULL DEFAULT 0,
    is_phantom        boolean NOT NULL DEFAULT false,
    operation_seq     int,                              -- optional backflush point
    UNIQUE (bom_id, line_no)
);

CREATE TABLE mfg.routings (
    routing_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint NOT NULL REFERENCES ops.items (item_id),
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
    operation_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routing_id           bigint NOT NULL REFERENCES mfg.routings,
    operation_seq        int NOT NULL,
    work_centre_id       bigint NOT NULL REFERENCES mfg.work_centres,
    description          text NOT NULL,
    setup_minutes        numeric(12,2) NOT NULL DEFAULT 0,
    run_minutes_per_unit numeric(12,4) NOT NULL DEFAULT 0,
    queue_minutes        numeric(12,2) NOT NULL DEFAULT 0,
    UNIQUE (routing_id, operation_seq)
);

-- ─── execution (M2 / M6) ─────────────────────────────────────────────────────
CREATE TABLE mfg.production_orders (
    production_order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no            text NOT NULL UNIQUE,          -- MFG-YYYYNNNNN
    item_id             bigint NOT NULL REFERENCES ops.items (item_id),
    bom_id              bigint NOT NULL REFERENCES mfg.boms,
    routing_id          bigint REFERENCES mfg.routings,
    plant               text NOT NULL,
    qty_ordered         numeric(18,4) NOT NULL CHECK (qty_ordered > 0),
    qty_completed       numeric(18,4) NOT NULL DEFAULT 0,
    qty_scrapped        numeric(18,4) NOT NULL DEFAULT 0,
    uom                 text NOT NULL,
    due_date            date NOT NULL,
    scheduled_start     date,
    scheduled_end       date,
    status              text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','firm','released','in_progress',
                                          'completed','closed','cancelled')),
    origin              text NOT NULL DEFAULT 'manual'
                        CHECK (origin IN ('manual','mrp','max_migration')),
    planned_order_id    bigint,                         -- FK added after planned_orders
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_po_touch BEFORE UPDATE ON mfg.production_orders
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

CREATE TABLE mfg.po_operations (
    po_operation_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id  bigint NOT NULL REFERENCES mfg.production_orders,
    operation_seq        int NOT NULL,
    work_centre_id       bigint NOT NULL REFERENCES mfg.work_centres,
    status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','running','done','skipped')),
    setup_minutes_actual numeric(12,2) DEFAULT 0,
    run_minutes_actual   numeric(12,2) DEFAULT 0,
    UNIQUE (production_order_id, operation_seq)
);

-- Completion event: the unit of BC posting (one outbox row each, I2/D-3)
CREATE TABLE mfg.completions (
    completion_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES mfg.production_orders,
    seq                 int NOT NULL,
    qty_good            numeric(18,4) NOT NULL DEFAULT 0,
    qty_scrap           numeric(18,4) NOT NULL DEFAULT 0,
    output_lot_no       text,                           -- minted per D-4, registered in BC
    posted_by           bigint NOT NULL REFERENCES ops.users (user_id),
    posted_at           timestamptz NOT NULL DEFAULT now(),
    bc_document_no      text,                           -- written back after BC posting
    outbox_id           bigint REFERENCES ops.integration_outbox (outbox_id),
    UNIQUE (production_order_id, seq)
);

CREATE TABLE mfg.material_consumption (
    consumption_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    completion_id     bigint NOT NULL REFERENCES mfg.completions,
    component_item_id bigint NOT NULL REFERENCES ops.items (item_id),
    qty               numeric(18,6) NOT NULL,           -- negative rows = reversal (I8 style)
    uom               text NOT NULL,
    lot_no            text,                             -- BC lot consumed
    method            text NOT NULL DEFAULT 'backflush'
                      CHECK (method IN ('backflush','manual_issue'))
);

CREATE TABLE mfg.labour_entries (
    labour_entry_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES mfg.production_orders,
    operation_seq       int,
    operator_id         bigint NOT NULL REFERENCES ops.users (user_id),
    work_centre_id      bigint NOT NULL REFERENCES mfg.work_centres,
    minutes             numeric(12,2) NOT NULL CHECK (minutes >= 0),
    entry_date          date NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Genealogy: append-only edge list (I8). Forward + backward trace by recursion.
CREATE TABLE mfg.lot_consumption (
    edge_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    completion_id    bigint NOT NULL REFERENCES mfg.completions,
    output_lot_no    text NOT NULL,
    consumed_item_id bigint NOT NULL REFERENCES ops.items (item_id),
    consumed_lot_no  text NOT NULL,
    qty              numeric(18,6) NOT NULL,
    source           text NOT NULL DEFAULT 'mfg'
                     CHECK (source IN ('mfg','max_history')),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_lotcons_output   ON mfg.lot_consumption (output_lot_no);
CREATE INDEX ix_lotcons_consumed ON mfg.lot_consumption (consumed_lot_no);

-- ─── planning (M4) ────────────────────────────────────────────────────────────
CREATE TABLE mfg.mps_entries (
    mps_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint NOT NULL REFERENCES ops.items (item_id),
    plant            text NOT NULL,
    bucket_start     date NOT NULL,                     -- weekly buckets initially
    qty              numeric(18,4) NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('forecast','firm')),
    entered_by       bigint NOT NULL REFERENCES ops.users (user_id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, plant, bucket_start, kind)
);

CREATE TABLE mfg.planning_params (
    item_id          bigint PRIMARY KEY REFERENCES ops.items (item_id),
    lead_time_days   int NOT NULL DEFAULT 0,
    safety_stock     numeric(18,4) NOT NULL DEFAULT 0,
    lot_policy       text NOT NULL DEFAULT 'lot_for_lot'
                     CHECK (lot_policy IN ('lot_for_lot','fixed_qty','min_multiple')),
    fixed_or_min_qty numeric(18,4),
    order_multiple   numeric(18,4),
    time_fence_days  int NOT NULL DEFAULT 0,
    make_or_buy      text NOT NULL CHECK (make_or_buy IN ('make','buy')),
    low_level_code   int NOT NULL DEFAULT 0             -- maintained by LLC job on BOM change
);

CREATE TABLE mfg.mrp_runs (
    mrp_run_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_type         text NOT NULL DEFAULT 'regenerative'
                     CHECK (run_type IN ('regenerative','net_change','shadow')),
    snapshot_at      timestamptz NOT NULL,              -- BC snapshot used (freshness SLA, D-7)
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    status           text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','succeeded','failed')),
    params_hash      text NOT NULL                      -- determinism audit (I4)
);

CREATE TABLE mfg.planned_orders (
    planned_order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mrp_run_id       bigint NOT NULL REFERENCES mfg.mrp_runs,
    item_id          bigint NOT NULL REFERENCES ops.items (item_id),
    kind             text NOT NULL CHECK (kind IN ('make','buy')),
    qty              numeric(18,4) NOT NULL,
    due_date         date NOT NULL,
    release_date     date NOT NULL,
    status           text NOT NULL DEFAULT 'suggested'
                     CHECK (status IN ('suggested','firmed','handed_off','dismissed')),
    pegging          jsonb                              -- demand sources this order covers
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

-- deferred FK now that planned_orders exists
ALTER TABLE mfg.production_orders
    ADD CONSTRAINT fk_po_planned_order
    FOREIGN KEY (planned_order_id) REFERENCES mfg.planned_orders (planned_order_id);

-- ============================================================================
-- Grants + RLS  (reads: any member. writes: RPC / service role only.)
-- ============================================================================
GRANT USAGE ON SCHEMA mfg TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA mfg TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'mfg'
  LOOP
    EXECUTE format('ALTER TABLE mfg.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY p_%s_read ON mfg.%I FOR SELECT USING (ops.is_member());', t, t);
  END LOOP;
END $$;
