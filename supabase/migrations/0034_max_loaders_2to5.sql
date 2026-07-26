-- ============================================================================
-- 0034_max_loaders_2to5.sql  ·  MAX migration loaders #2–#5 (plan §10)
-- ----------------------------------------------------------------------------
-- Transform the latest max_stage batch into canonical masters, reading the
-- documented payload contract (see supabase/max-extract/entity-mapping.md).
-- All admin-gated, idempotent, safe no-ops on empty staging, and they log.
--   #2 load_work_centres   → mfg.work_centres     (upsert by code)
--   #3 load_boms           → mfg.boms/bom_lines   (per parent, source max_migration)
--   #4 load_routings       → mfg.routings/ops     (per part, source max_migration)
--   #5 load_planner_params → mfg.planning_params  (upsert by item)
-- BOMs/routings resolve parts to items via the load #1 cross-ref
-- (ops.external_refs system='max') — run load_part_xrefs FIRST. Idempotency for
-- the versioned masters is "skip if a max_migration version already exists for
-- the item"; re-loading a changed master means clearing the old one first.
-- #6 open orders / WIP: burn-down (no loader) per §10 — confirm with Aqib.
-- ============================================================================

-- #2 ─ work centres ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION max_stage.load_work_centres() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = max_stage, mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']); v_batch bigint; v_n int;
BEGIN
    SELECT max(batch_id) INTO v_batch FROM max_stage.extract_batches WHERE entity='work_centres';
    IF v_batch IS NULL THEN RETURN 0; END IF;
    WITH ups AS (
        INSERT INTO mfg.work_centres (code, name, plant, capacity_uom, daily_capacity, efficiency_pct, labour_rate, overhead_rate)
        SELECT p->>'wc_code', COALESCE(p->>'name', p->>'wc_code'), COALESCE(p->>'plant','—'),
               'minutes', COALESCE((p->>'daily_capacity')::numeric, 0), COALESCE((p->>'efficiency_pct')::numeric, 100),
               NULLIF(p->>'labour_rate','')::numeric, NULLIF(p->>'overhead_rate','')::numeric
        FROM (SELECT payload p FROM max_stage.work_centres WHERE batch_id=v_batch) s
        WHERE p->>'wc_code' IS NOT NULL
        ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name, plant = EXCLUDED.plant,
            daily_capacity = EXCLUDED.daily_capacity, efficiency_pct = EXCLUDED.efficiency_pct,
            labour_rate  = COALESCE(EXCLUDED.labour_rate, work_centres.labour_rate),
            overhead_rate = COALESCE(EXCLUDED.overhead_rate, work_centres.overhead_rate)
        RETURNING 1)
    SELECT count(*) INTO v_n FROM ups;
    PERFORM max_stage.record_load('work_centres', v_n);
    PERFORM ops.log_event('max_stage.work_centres', v_batch, 'loaded', jsonb_build_object('rows', v_n));
    RETURN v_n;
END; $$;

-- #5 ─ planner params ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION max_stage.load_planner_params() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = max_stage, mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']); v_batch bigint; v_n int;
BEGIN
    SELECT max(batch_id) INTO v_batch FROM max_stage.extract_batches WHERE entity='planner_params';
    IF v_batch IS NULL THEN RETURN 0; END IF;
    WITH ups AS (
        INSERT INTO mfg.planning_params (item_id, lead_time_days, safety_stock, lot_policy,
                                         fixed_or_min_qty, order_multiple, time_fence_days, make_or_buy)
        SELECT r.entity_id,
               COALESCE((p->>'lead_time_days')::int, 0), COALESCE((p->>'safety_stock')::numeric, 0),
               COALESCE(NULLIF(p->>'lot_policy',''), 'lot_for_lot'),
               NULLIF(p->>'fixed_or_min_qty','')::numeric, NULLIF(p->>'order_multiple','')::numeric,
               COALESCE((p->>'time_fence_days')::int, 0), COALESCE(NULLIF(p->>'make_or_buy',''), 'make')
        FROM (SELECT payload p FROM max_stage.planner_params WHERE batch_id=v_batch) s
        JOIN ops.external_refs r ON r.system='max' AND r.entity_type='ops.item' AND r.external_id = p->>'part_no'
        ON CONFLICT (item_id) DO UPDATE SET
            lead_time_days=EXCLUDED.lead_time_days, safety_stock=EXCLUDED.safety_stock,
            lot_policy=EXCLUDED.lot_policy, fixed_or_min_qty=EXCLUDED.fixed_or_min_qty,
            order_multiple=EXCLUDED.order_multiple, time_fence_days=EXCLUDED.time_fence_days,
            make_or_buy=EXCLUDED.make_or_buy
        RETURNING 1)
    SELECT count(*) INTO v_n FROM ups;
    PERFORM max_stage.record_load('planner_params', v_n);
    PERFORM ops.log_event('max_stage.planner_params', v_batch, 'loaded', jsonb_build_object('rows', v_n));
    RETURN v_n;
END; $$;

-- #3 ─ BOMs ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION max_stage.load_boms() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = max_stage, mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']);
        v_batch bigint; r record; v_item bigint; v_ver int; v_bom bigint; v_loaded int := 0; v_present int;
BEGIN
    SELECT max(batch_id) INTO v_batch FROM max_stage.extract_batches WHERE entity='boms';
    IF v_batch IS NULL THEN RETURN 0; END IF;
    FOR r IN SELECT DISTINCT payload->>'parent' AS parent FROM max_stage.boms
             WHERE batch_id=v_batch AND payload->>'parent' IS NOT NULL LOOP
        SELECT entity_id INTO v_item FROM ops.external_refs
         WHERE system='max' AND entity_type='ops.item' AND external_id=r.parent;
        CONTINUE WHEN v_item IS NULL;                       -- unmatched parent
        CONTINUE WHEN EXISTS (SELECT 1 FROM mfg.boms WHERE item_id=v_item AND source='max_migration');
        SELECT COALESCE(max(version_no),0)+1 INTO v_ver FROM mfg.boms WHERE item_id=v_item;
        INSERT INTO mfg.boms (item_id, version_no, status, effective_from, source)
        VALUES (v_item, v_ver, 'approved', CURRENT_DATE, 'max_migration') RETURNING bom_id INTO v_bom;
        INSERT INTO mfg.bom_lines (bom_id, line_no, component_item_id, qty_per, uom, scrap_pct)
        SELECT v_bom, row_number() OVER (ORDER BY b.stage_id), c.entity_id,
               COALESCE((b.payload->>'qty_per')::numeric, 0),
               COALESCE(NULLIF(b.payload->>'uom',''), 'EA'),
               COALESCE((b.payload->>'scrap_pct')::numeric, 0)
        FROM max_stage.boms b
        JOIN ops.external_refs c ON c.system='max' AND c.entity_type='ops.item'
                                AND c.external_id = b.payload->>'component'
        WHERE b.batch_id=v_batch AND b.payload->>'parent'=r.parent;
        v_loaded := v_loaded + 1;
    END LOOP;
    -- reconciliation counts masters PRESENT (idempotent re-runs load 0 new but
    -- the master still exists), so not_loaded stays truthful across re-runs.
    SELECT count(DISTINCT er.entity_id) INTO v_present
    FROM max_stage.boms b
    JOIN ops.external_refs er ON er.system='max' AND er.entity_type='ops.item'
                             AND er.external_id = b.payload->>'parent'
    JOIN mfg.boms mb ON mb.item_id = er.entity_id AND mb.source='max_migration'
    WHERE b.batch_id=v_batch AND b.payload->>'parent' IS NOT NULL;
    PERFORM max_stage.record_load('boms', v_present);
    PERFORM ops.log_event('max_stage.boms', v_batch, 'loaded',
            jsonb_build_object('boms_present', v_present, 'boms_new', v_loaded));
    RETURN v_present;
END; $$;

-- #4 ─ routings ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION max_stage.load_routings() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = max_stage, mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']);
        v_batch bigint; r record; v_item bigint; v_ver int; v_routing bigint; v_loaded int := 0; v_present int;
BEGIN
    SELECT max(batch_id) INTO v_batch FROM max_stage.extract_batches WHERE entity='routings';
    IF v_batch IS NULL THEN RETURN 0; END IF;
    FOR r IN SELECT DISTINCT payload->>'part_no' AS part_no FROM max_stage.routings
             WHERE batch_id=v_batch AND payload->>'part_no' IS NOT NULL LOOP
        SELECT entity_id INTO v_item FROM ops.external_refs
         WHERE system='max' AND entity_type='ops.item' AND external_id=r.part_no;
        CONTINUE WHEN v_item IS NULL;
        CONTINUE WHEN EXISTS (SELECT 1 FROM mfg.routings WHERE item_id=v_item AND source='max_migration');
        SELECT COALESCE(max(version_no),0)+1 INTO v_ver FROM mfg.routings WHERE item_id=v_item;
        INSERT INTO mfg.routings (item_id, version_no, status, effective_from, source)
        VALUES (v_item, v_ver, 'approved', CURRENT_DATE, 'max_migration') RETURNING routing_id INTO v_routing;
        INSERT INTO mfg.routing_operations (routing_id, operation_seq, work_centre_id, description,
                                            setup_minutes, run_minutes_per_unit, queue_minutes)
        SELECT v_routing, COALESCE((rt.payload->>'op_seq')::int, (row_number() OVER (ORDER BY rt.stage_id))::int * 10),
               wc.work_centre_id, COALESCE(NULLIF(rt.payload->>'description',''), 'Operation'),
               COALESCE((rt.payload->>'setup_min')::numeric, 0),
               COALESCE((rt.payload->>'run_min')::numeric, 0),
               COALESCE((rt.payload->>'queue_min')::numeric, 0)
        FROM max_stage.routings rt
        JOIN mfg.work_centres wc ON wc.code = rt.payload->>'wc_code'
        WHERE rt.batch_id=v_batch AND rt.payload->>'part_no'=r.part_no;
        v_loaded := v_loaded + 1;
    END LOOP;
    SELECT count(DISTINCT er.entity_id) INTO v_present
    FROM max_stage.routings rt
    JOIN ops.external_refs er ON er.system='max' AND er.entity_type='ops.item'
                             AND er.external_id = rt.payload->>'part_no'
    JOIN mfg.routings mr ON mr.item_id = er.entity_id AND mr.source='max_migration'
    WHERE rt.batch_id=v_batch AND rt.payload->>'part_no' IS NOT NULL;
    PERFORM max_stage.record_load('routings', v_present);
    PERFORM ops.log_event('max_stage.routings', v_batch, 'loaded',
            jsonb_build_object('routings_present', v_present, 'routings_new', v_loaded));
    RETURN v_present;
END; $$;

GRANT EXECUTE ON FUNCTION max_stage.load_work_centres()   TO authenticated;
GRANT EXECUTE ON FUNCTION max_stage.load_planner_params() TO authenticated;
GRANT EXECUTE ON FUNCTION max_stage.load_boms()           TO authenticated;
GRANT EXECUTE ON FUNCTION max_stage.load_routings()       TO authenticated;
