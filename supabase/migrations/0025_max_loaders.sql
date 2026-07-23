-- ============================================================================
-- 0025_max_loaders.sql  ·  MAX migration loaders + reconciliation (plan §10)
-- ----------------------------------------------------------------------------
-- Idempotent, re-runnable transforms from the raw max_stage landing tables into
-- the canonical schema. NO transformation lives in max_stage itself (§10) — it
-- happens here, reading the raw jsonb payloads. These run against the LATEST
-- extract batch per entity and are safe no-ops on empty staging.
--
-- Load order (§10):  1 part cross-ref → 2 work centres → 3 BOMs → 4 routings →
-- 5 planner params → 6 open orders/WIP (burn-down preferred). This migration
-- ships load #1 (the biggest data risk, D-6: 100% part↔item match is a blocking
-- gate) plus the reconciliation harness; loads #2–#6 are added once the exact
-- MAX column shapes are pinned in M0 (see docs/max-migration.md).
--
-- Expected max_stage.parts payload keys (CONFIRM against real MAX in M0):
--   { "part_no": "...", "bc_item_no": "...", "description": "..." }
-- Gated to admin; the whole schema is dropped after decommission (Stage 4).
-- ============================================================================

-- Record how many rows a loader wrote, on the latest batch for the entity.
CREATE OR REPLACE FUNCTION max_stage.record_load(p_entity text, p_loaded int)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = max_stage AS $$
    UPDATE max_stage.extract_batches
       SET loaded_rowcount = p_loaded
     WHERE batch_id = (SELECT max(batch_id) FROM max_stage.extract_batches WHERE entity = p_entity);
$$;

-- Load #1 — MAX part ↔ canonical item cross-reference into ops.external_refs
-- (system='max'). Resolves each MAX part to a canonical item by its BC item no
-- (via the existing system='bc' mapping) or, failing that, by matching part_no
-- to ops.items.item_no. Unmatched parts are the D-6 cleanup list (see the view).
CREATE OR REPLACE FUNCTION max_stage.load_part_xrefs()
RETURNS TABLE(matched int, unmatched int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = max_stage, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']);
        v_batch bigint; v_matched int; v_unmatched int;
BEGIN
    SELECT max(batch_id) INTO v_batch FROM max_stage.extract_batches WHERE entity = 'parts';
    IF v_batch IS NULL THEN
        RETURN QUERY SELECT 0, 0; RETURN;
    END IF;

    WITH src AS (
        SELECT p.payload->>'part_no' AS part_no, p.payload->>'bc_item_no' AS bc_item_no
        FROM max_stage.parts p WHERE p.batch_id = v_batch AND p.payload->>'part_no' IS NOT NULL
    ),
    resolved AS (
        SELECT s.part_no,
               COALESCE(
                 (SELECT r.entity_id FROM ops.external_refs r
                    WHERE r.system = 'bc' AND r.entity_type = 'ops.item'
                      AND r.external_id = s.bc_item_no),
                 (SELECT i.item_id FROM ops.items i WHERE i.item_no = s.part_no)
               ) AS item_id
        FROM src s
    ),
    ins AS (
        INSERT INTO ops.external_refs (entity_type, entity_id, system, external_id)
        SELECT 'ops.item', item_id, 'max', part_no FROM resolved WHERE item_id IS NOT NULL
        ON CONFLICT (entity_type, entity_id, system) DO UPDATE SET external_id = EXCLUDED.external_id
        RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM ins),
           (SELECT count(*)::int FROM resolved WHERE item_id IS NULL)
      INTO v_matched, v_unmatched;

    PERFORM max_stage.record_load('parts', v_matched);
    PERFORM ops.log_event('max_stage.parts', v_batch, 'loaded',
                          jsonb_build_object('matched', v_matched, 'unmatched', v_unmatched));
    RETURN QUERY SELECT v_matched, v_unmatched;
END;
$$;

-- ── Reconciliation harness ──────────────────────────────────────────────────
-- Per-entity latest-batch source vs loaded rowcounts (the §10 "count match"
-- validation). not_loaded > 0 is a blocking gate.
CREATE OR REPLACE VIEW max_stage.v_load_reconciliation WITH (security_invoker = true) AS
SELECT b.entity, b.batch_id, b.extracted_at, b.source_rowcount, b.loaded_rowcount,
       COALESCE(b.source_rowcount, 0) - COALESCE(b.loaded_rowcount, 0) AS not_loaded
FROM max_stage.extract_batches b
JOIN (SELECT entity, max(batch_id) AS mb FROM max_stage.extract_batches GROUP BY entity) latest
  ON latest.entity = b.entity AND latest.mb = b.batch_id;

-- D-6 cleanup list: MAX parts (latest batch) that resolve to no canonical item.
-- Must be empty before the part cross-ref gate passes (100% match required).
CREATE OR REPLACE VIEW max_stage.v_unmatched_parts WITH (security_invoker = true) AS
WITH latest AS (SELECT max(batch_id) AS mb FROM max_stage.extract_batches WHERE entity = 'parts')
SELECT p.stage_id,
       p.payload->>'part_no'     AS part_no,
       p.payload->>'bc_item_no'  AS bc_item_no,
       p.payload->>'description' AS description
FROM max_stage.parts p, latest
WHERE p.batch_id = latest.mb
  AND NOT EXISTS (SELECT 1 FROM ops.external_refs r
                    WHERE r.system = 'bc' AND r.entity_type = 'ops.item'
                      AND r.external_id = p.payload->>'bc_item_no')
  AND NOT EXISTS (SELECT 1 FROM ops.items i WHERE i.item_no = p.payload->>'part_no');

-- Loaders are admin-gated internally; grant execute + view select to authenticated.
GRANT EXECUTE ON FUNCTION max_stage.load_part_xrefs() TO authenticated;
GRANT SELECT ON max_stage.v_load_reconciliation TO authenticated;
GRANT SELECT ON max_stage.v_unmatched_parts TO authenticated;
