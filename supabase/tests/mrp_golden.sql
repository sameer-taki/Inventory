-- ============================================================================
-- mrp_golden.sql — MRP correctness harness (MAX plan §8)
-- ----------------------------------------------------------------------------
-- A hand-computed multi-level scenario. Run against a database with migrations
-- 0001–0007 applied. It sets up its own items/BOMs/demand, runs the engine, and
-- asserts the EXACT expected planned-order set. Any diff raises an exception —
-- this is the "CI fails on any diff" gate. Re-runnable (cleans its own items).
--
-- Scenario
--   FG  A (make, lead 2, ss 0,  lot_for_lot)     demand: 100 due 2026-08-31
--   B   (buy,  lead 5, ss 10, lot_for_lot)       on-hand 5      A uses 2×B
--   C   (make, lead 1, ss 0,  fixed_qty 100)                    A uses 1×C @10% scrap
--   D   (buy,  lead 3, ss 0,  min_multiple 50/25)              C uses 3×D
--
-- Expected planned orders
--   A make 100  due 2026-08-31 release 2026-08-29
--   B buy  205  due 2026-08-29 release 2026-08-24   (gross 200, avail 5-10=-5 → short 205)
--   C make 200  due 2026-08-29 release 2026-08-28   (gross 110, fixed_qty 100 → 200)
--   D buy  600  due 2026-08-28 release 2026-08-25   (gross 200×3=600, min_multiple → 600)
-- ============================================================================
\set ON_ERROR_STOP on

-- clean any prior run of this harness
DELETE FROM ops.items WHERE item_no IN ('GTEST-A','GTEST-B','GTEST-C','GTEST-D');

DO $golden$
DECLARE
    a bigint; b bigint; c bigint; d bigint;
    bom_a bigint; bom_c bigint;
    planner_uid uuid;
    run_id bigint;
    n int;
BEGIN
    -- items
    INSERT INTO ops.items (item_no, description, base_uom, make_or_buy) VALUES
        ('GTEST-A','Golden test FG A','EA','make') RETURNING item_id INTO a;
    INSERT INTO ops.items (item_no, description, base_uom, make_or_buy) VALUES
        ('GTEST-B','Golden test comp B','EA','buy')  RETURNING item_id INTO b;
    INSERT INTO ops.items (item_no, description, base_uom, make_or_buy) VALUES
        ('GTEST-C','Golden test comp C','EA','make') RETURNING item_id INTO c;
    INSERT INTO ops.items (item_no, description, base_uom, make_or_buy) VALUES
        ('GTEST-D','Golden test comp D','EA','buy')  RETURNING item_id INTO d;

    -- planning params
    INSERT INTO mfg.planning_params (item_id, lead_time_days, safety_stock, lot_policy, fixed_or_min_qty, order_multiple, make_or_buy) VALUES
        (a, 2, 0,  'lot_for_lot',  NULL, NULL, 'make'),
        (b, 5, 10, 'lot_for_lot',  NULL, NULL, 'buy'),
        (c, 1, 0,  'fixed_qty',    100,  NULL, 'make'),
        (d, 3, 0,  'min_multiple', 50,   25,   'buy');

    -- approved BOMs (inserted directly to isolate the engine from the masters RPCs)
    INSERT INTO mfg.boms (item_id, version_no, status, effective_from, source) VALUES
        (a, 1, 'approved', DATE '2026-01-01', 'manual') RETURNING bom_id INTO bom_a;
    INSERT INTO mfg.bom_lines (bom_id, line_no, component_item_id, qty_per, uom, scrap_pct) VALUES
        (bom_a, 1, b, 2, 'EA', 0),
        (bom_a, 2, c, 1, 'EA', 10);
    INSERT INTO mfg.boms (item_id, version_no, status, effective_from, source) VALUES
        (c, 1, 'approved', DATE '2026-01-01', 'manual') RETURNING bom_id INTO bom_c;
    INSERT INTO mfg.bom_lines (bom_id, line_no, component_item_id, qty_per, uom, scrap_pct) VALUES
        (bom_c, 1, d, 3, 'EA', 0);

    -- demand + on-hand
    INSERT INTO ops.users (email, full_name, is_active) VALUES ('goldenplanner@golden.com.fj','GT Planner',true)
        ON CONFLICT (email) DO NOTHING;
    INSERT INTO mfg.mps_entries (item_id, plant, bucket_start, qty, kind, entered_by)
        SELECT a, 'Molded Fibre', DATE '2026-08-31', 100, 'firm', user_id
        FROM ops.users WHERE email = 'goldenplanner@golden.com.fj';
    INSERT INTO mfg.inventory_snapshots (item_id, on_hand, snapshot_at) VALUES (b, 5, TIMESTAMPTZ '2026-07-01');

    -- run as a planner
    INSERT INTO auth.users (email) VALUES ('goldenplanner@golden.com.fj') RETURNING id INTO planner_uid;
    INSERT INTO ops.user_roles (user_id, role_key)
        SELECT user_id, 'planner' FROM ops.users WHERE email='goldenplanner@golden.com.fj'
        ON CONFLICT DO NOTHING;
    PERFORM set_config('app.current_uid', planner_uid::text, false);

    run_id := mfg.run_mrp(TIMESTAMPTZ '2026-08-01', 120, 'regenerative');

    -- ── assertions ──────────────────────────────────────────────────────────
    PERFORM 1 FROM mfg.planned_orders WHERE mrp_run_id=run_id AND item_id=a
            AND kind='make' AND qty=100 AND due_date=DATE '2026-08-31' AND release_date=DATE '2026-08-29';
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL A: expected make 100 due 08-31 rel 08-29'; END IF;

    PERFORM 1 FROM mfg.planned_orders WHERE mrp_run_id=run_id AND item_id=b
            AND kind='buy' AND qty=205 AND due_date=DATE '2026-08-29' AND release_date=DATE '2026-08-24';
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL B: expected buy 205 due 08-29 rel 08-24'; END IF;

    PERFORM 1 FROM mfg.planned_orders WHERE mrp_run_id=run_id AND item_id=c
            AND kind='make' AND qty=200 AND due_date=DATE '2026-08-29' AND release_date=DATE '2026-08-28';
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL C: expected make 200 due 08-29 rel 08-28'; END IF;

    PERFORM 1 FROM mfg.planned_orders WHERE mrp_run_id=run_id AND item_id=d
            AND kind='buy' AND qty=600 AND due_date=DATE '2026-08-28' AND release_date=DATE '2026-08-25';
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL D: expected buy 600 due 08-28 rel 08-25'; END IF;

    SELECT count(*) INTO n FROM mfg.planned_orders WHERE mrp_run_id=run_id;
    IF n <> 4 THEN RAISE EXCEPTION 'FAIL: expected exactly 4 planned orders, got %', n; END IF;

    -- determinism: identical inputs ⇒ identical params_hash
    PERFORM 1 FROM mfg.mrp_runs r1 JOIN mfg.mrp_runs r2 ON r1.params_hash = r2.params_hash
            WHERE r1.mrp_run_id = run_id AND r2.mrp_run_id = run_id;

    RAISE NOTICE 'MRP GOLDEN: PASS (4 planned orders, all exact)';
END
$golden$;
