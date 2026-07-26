-- ============================================================================
-- supabase/seed/shadow_sample.sql  ·  MRP shadow-run diff — sample data (demo)
-- ----------------------------------------------------------------------------
-- Companion to pilot_seed.sql. Populates mfg.v_mrp_shadow_diff so the shadow-run
-- screen shows content BEFORE any real on-site MAX extraction exists. Run it
-- AFTER pilot_seed.sql (it depends on the seeded masters/MPS/inventory and the
-- open production orders).
--
-- What it does, all under admin impersonation, in one transaction:
--   1. Runs MRP in `shadow` mode (run_type='shadow') against the live data — the
--      "ours" side of the diff. Deterministic, so quantities are stable.
--   2. Lands a clearly-labelled SAMPLE max_stage.mrp_recommendations batch — the
--      "theirs" side. These are FABRICATED for the demo (note says so); a real
--      pull replaces them via extract.mjs. Parts resolve to items by item_no
--      (no system='max' external_refs exist until the migration loaders run).
--   3. Categorises three variance lines as G3 parallel-run evidence, leaving the
--      match (nothing to explain) and one ours_only line for planner review.
--
-- The sample quantities below are tuned to the deterministic shadow output on the
-- pilot dataset (tray 200@08-10, tray 400@08-24, carton 250@08-29) to produce one
-- of each diff status: match / qty_diff / ours_only / max_only.
-- Applied live 2026-07-26. Re-run only on a fresh DB (adds a new batch each run).
-- ============================================================================
DO $shadow$
DECLARE v_run bigint; v_batch bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"59e0f24c-04b7-4705-a040-af03aa192d2e"}', true);
  IF ops.current_user_id() IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'impersonation guard failed'; END IF;

  -- 1. shadow MRP (the "ours" side)
  v_run := mfg.run_mrp(now(), 120, 'shadow');

  -- 2. sample MAX recommendations (the "theirs" side) — fabricated demo data
  INSERT INTO max_stage.extract_batches (entity, source_rowcount, note)
  VALUES ('mrp_recommendations', 4, 'sample extract (pilot demo — not a real MAX pull)')
  RETURNING batch_id INTO v_batch;

  INSERT INTO max_stage.mrp_recommendations (batch_id, natural_key, payload) VALUES
    (v_batch, 'MF-TRAY-30',  '{"part_no":"MF-TRAY-30","kind":"make","qty":200,"due_date":"2026-08-10"}'::jsonb),  -- match
    (v_batch, 'MF-TRAY-30',  '{"part_no":"MF-TRAY-30","kind":"make","qty":450,"due_date":"2026-08-24"}'::jsonb),  -- qty_diff (ours 400)
    (v_batch, 'MF-CARTON-A', '{"part_no":"MF-CARTON-A","kind":"make","qty":300,"due_date":"2026-08-15"}'::jsonb), -- max_only (ours plans 08-29)
    (v_batch, 'RM-PULP-KRA', '{"part_no":"RM-PULP-KRA","bc_item_no":"RM-PULP-KRA","kind":"buy","qty":1600,"due_date":"2026-08-08"}'::jsonb); -- max_only (ours nets on-hand)

  -- 3. G3 sign-off evidence on three lines
  PERFORM mfg.categorise_shadow_diff(2, DATE '2026-08-08', 'data_difference',
    'MAX ignores the 2,500 kg on-hand snapshot + open BC PO (1,000 kg); our netting consumes them first (I1/I4).');
  PERFORM mfg.categorise_shadow_diff(1, DATE '2026-08-24', 'logic_difference',
    'MAX applies a 50-unit minimum lot; ours is lot-for-lot on net demand 400.');
  PERFORM mfg.categorise_shadow_diff(3, DATE '2026-08-15', 'logic_difference',
    'MAX plans to the demand bucket (8/15); ours nets the in-progress order first and defers the make to 8/29.');

  RAISE NOTICE 'shadow diff sample ready (shadow run=%, rec batch=%)', v_run, v_batch;
END $shadow$;
