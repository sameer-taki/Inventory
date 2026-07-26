-- ============================================================================
-- supabase/seed/pilot_seed.sql  ·  Golden Operations Platform — live pilot seed
-- ----------------------------------------------------------------------------
-- A ONE-SHOT, non-idempotent seed that gives every module screen coherent,
-- invariant-clean content for the Molded Fibre pilot. Applied to the live
-- project (jvthwlypnwfcpgrnxqkh) on 2026-07-26; kept here for reproducibility.
--
-- How it honours the invariants:
--   • Single writer (P2/I2): every masters/production/fleet mutation goes through
--     the SECURITY DEFINER RPCs (create_bom, approve_bom, create_routing,
--     save_mps_entry, run_mrp, firm_planned_order, transition_*, post_shopfloor_
--     completion, save_driver, assign_vehicle, log_fuel, open/transition_job_card),
--     each of which logs an event. It does NOT touch status columns directly.
--   • BC-sourced planning inputs (I1): mfg.inventory_snapshots and mfg.bc_open_pos
--     are the read-only snapshots the gateway sync owns; they have no RPC, so the
--     seed writes them directly as the service role (simulating that sync) — never
--     from app/browser code.
--   • The completion enqueues a BC posting in ops.integration_outbox with an
--     idempotency key; the gateway-bridge stays dry-run (no BC_ODATA_URL), so it
--     is delivered to nothing — it waits for real BC connectivity (P2).
--
-- Impersonation: runs as admin user 1 (sameer@golden.com.fj) by setting the
-- request.jwt.claims GUC so auth.uid()/ops.current_user_id() resolve inside the
-- RPCs. The whole thing is ONE transaction — all-or-nothing.
--
-- WARNING — do not re-run against a DB that already has it: append-only fuel/
-- meter rows (F7) and the UNIQUE fleet.drivers.user_id make a second run fail /
-- duplicate. Re-seed only into a fresh DB. Item ids (1 MF-TRAY-30, 2 RM-PULP-KRA,
-- 3 MF-CARTON-A) and the admin auth_user_id below are specific to this project.
-- ============================================================================
DO $seed$
DECLARE
  v_uid    bigint;
  v_bom    mfg.boms;
  v_rt     mfg.routings;
  v_run    bigint;
  v_pid    bigint;
  v_po     bigint;
  v_job    fleet.job_cards;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"59e0f24c-04b7-4705-a040-af03aa192d2e"}', true);
  v_uid := ops.current_user_id();
  IF v_uid IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'impersonation guard failed: current_user_id()=%', v_uid;
  END IF;

  -- ── A. BOMs (supersede the broken self-referential MF-TRAY-30 v1) ───────────
  v_bom := mfg.create_bom(1, DATE '2026-07-01',
    '[{"component_item_id":2,"qty_per":2.0,"uom":"KG","scrap_pct":5}]'::jsonb);
  PERFORM mfg.approve_bom(v_bom.bom_id);                    -- MF-TRAY-30 v2 (pulp only)
  v_bom := mfg.create_bom(3, DATE '2026-07-01',
    '[{"component_item_id":2,"qty_per":1.5,"uom":"KG","scrap_pct":5}]'::jsonb);
  PERFORM mfg.approve_bom(v_bom.bom_id);                    -- MF-CARTON-A v1

  -- ── B. Routings (Form → Dry → Pack) ─────────────────────────────────────────
  v_rt := mfg.create_routing(1, DATE '2026-07-01',
    '[{"work_centre_id":1,"description":"Forming","setup_minutes":15,"run_minutes_per_unit":0.4},
      {"work_centre_id":2,"description":"Drying","setup_minutes":5,"run_minutes_per_unit":0.8},
      {"work_centre_id":3,"description":"Packing","setup_minutes":5,"run_minutes_per_unit":0.2}]'::jsonb);
  PERFORM mfg.approve_routing(v_rt.routing_id);
  v_rt := mfg.create_routing(3, DATE '2026-07-01',
    '[{"work_centre_id":1,"description":"Forming","setup_minutes":15,"run_minutes_per_unit":0.5},
      {"work_centre_id":2,"description":"Drying","setup_minutes":5,"run_minutes_per_unit":1.0},
      {"work_centre_id":3,"description":"Packing","setup_minutes":5,"run_minutes_per_unit":0.25}]'::jsonb);
  PERFORM mfg.approve_routing(v_rt.routing_id);

  -- ── C. Standard costs (cached BC std cost, FJD/base UoM) ─────────────────────
  PERFORM mfg.set_item_cost(2, 0.85, 'bc_cache');          -- pulp / KG
  PERFORM mfg.set_item_cost(1, 3.20, 'bc_cache');          -- tray
  PERFORM mfg.set_item_cost(3, 4.10, 'bc_cache');          -- carton

  -- ── D. Inventory snapshots (BC-sourced planning input) ───────────────────────
  INSERT INTO mfg.inventory_snapshots (item_id, plant, on_hand, snapshot_at) VALUES
    (2, 'Molded Fibre', 2500, now()),
    (1, 'Molded Fibre',  120, now()),
    (3, 'Molded Fibre',   30, now());

  -- ── E. Scheduled receipt (open BC purchase order for pulp) ───────────────────
  INSERT INTO mfg.bc_open_pos (item_id, qty, due_date, bc_doc_no) VALUES
    (2, 1000, DATE '2026-08-20', 'PO-BC-10231');

  -- ── F. MPS demand ────────────────────────────────────────────────────────────
  PERFORM mfg.save_mps_entry(1, 'Molded Fibre', DATE '2026-08-10', 500, 'firm');
  PERFORM mfg.save_mps_entry(1, 'Molded Fibre', DATE '2026-08-24', 400, 'forecast');
  PERFORM mfg.save_mps_entry(3, 'Molded Fibre', DATE '2026-08-15', 300, 'firm');
  PERFORM mfg.save_mps_entry(3, 'Molded Fibre', DATE '2026-08-29', 250, 'forecast');

  -- ── G. Run MRP (regenerative) ────────────────────────────────────────────────
  v_run := mfg.run_mrp(now(), 120, 'regenerative');

  -- ── H. Firm a tray order → release → partial shop-floor completion ───────────
  SELECT planned_order_id INTO v_pid FROM mfg.planned_orders
   WHERE mrp_run_id=v_run AND item_id=1 AND kind='make' AND status='suggested'
   ORDER BY due_date, planned_order_id LIMIT 1;
  IF v_pid IS NOT NULL THEN
    PERFORM mfg.firm_planned_order(v_pid);
    SELECT production_order_id INTO v_po FROM mfg.production_orders WHERE planned_order_id=v_pid;
    PERFORM mfg.transition_production_order(v_po, 'firm');
    PERFORM mfg.transition_production_order(v_po, 'released');
    PERFORM mfg.post_shopfloor_completion(
      v_po, 200, 5,
      '[{"component_item_id":2,"qty":420,"uom":"KG","lot_no":"PULP-2026-07","method":"backflush"}]'::jsonb,
      'MF-FG-STORE', 'LOT-TRAY-0001',
      '[{"work_centre_id":1,"minutes":95,"operation_seq":10},
        {"work_centre_id":2,"minutes":180,"operation_seq":20},
        {"work_centre_id":3,"minutes":48,"operation_seq":30}]'::jsonb);
  END IF;

  -- ── H2. Firm a carton order → release (awaiting work) ────────────────────────
  SELECT planned_order_id INTO v_pid FROM mfg.planned_orders
   WHERE mrp_run_id=v_run AND item_id=3 AND kind='make' AND status='suggested'
   ORDER BY due_date, planned_order_id LIMIT 1;
  IF v_pid IS NOT NULL THEN
    PERFORM mfg.firm_planned_order(v_pid);
    SELECT production_order_id INTO v_po FROM mfg.production_orders WHERE planned_order_id=v_pid;
    PERFORM mfg.transition_production_order(v_po, 'firm');
    PERFORM mfg.transition_production_order(v_po, 'released');
  END IF;

  -- ── I. Fleet: drivers, assignments, fuel, job card ──────────────────────────
  PERFORM fleet.save_driver(4, 'HR', DATE '2027-03-31', false, NULL);              -- truck driver
  PERFORM fleet.save_driver(3, 'C',  DATE '2026-10-15', true,  DATE '2027-01-31'); -- forklift-certified
  PERFORM fleet.assign_vehicle(1, DATE '2026-07-01',
          (SELECT driver_id FROM fleet.drivers WHERE user_id=4), 'Molded Fibre', 'Primary delivery run');
  PERFORM fleet.assign_vehicle(2, DATE '2026-07-10',
          (SELECT driver_id FROM fleet.drivers WHERE user_id=3), 'Molded Fibre', 'Warehouse forklift');

  -- truck (vehicle 1, km): extend fills → 4 segments, last one anomalous (~13.8 L/100)
  PERFORM fleet.log_fuel(1, DATE '2026-07-20', 60.5, 169.40, 85720, true, 'BP Walu Bay');
  PERFORM fleet.log_fuel(1, DATE '2026-07-23', 56.0, 156.80, 86500, true, 'BP Walu Bay');
  PERFORM fleet.log_fuel(1, DATE '2026-07-25', 55.0, 154.00, 86900, true, 'Total Nabua');
  -- forklift (vehicle 2, hours): LPG fills
  PERFORM fleet.log_fuel(2, DATE '2026-07-05', 40.0, 96.00, 1200, true, 'Fiji Gas');
  PERFORM fleet.log_fuel(2, DATE '2026-07-19', 38.5, 92.40, 1360, true, 'Fiji Gas');
  PERFORM fleet.log_fuel(2, DATE '2026-07-25', 41.0, 98.40, 1520, true, 'Fiji Gas');

  -- a completed scheduled service on the forklift
  v_job := fleet.open_job_card(2, 'scheduled', '250-hour service + hydraulic check', 'internal', NULL, NULL);
  PERFORM fleet.transition_job_card(v_job.job_id, 'in_progress', 'started service');
  PERFORM fleet.transition_job_card(v_job.job_id, 'done', 'service complete', 220.00, 150.00, 3.5, NULL, 'INV-FG-8842');

  RAISE NOTICE 'pilot seed complete (mrp_run=%)', v_run;
END
$seed$;
