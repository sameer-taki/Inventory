-- ============================================================================
-- 0009_mps_genealogy.sql  ·  MPS entry RPC + lot genealogy trace (M4 demand, M6)
-- ----------------------------------------------------------------------------
-- - mfg.save_mps_entry: upsert a master-production-schedule bucket (planner).
-- - mfg.trace_backward / trace_forward: recursive lot genealogy over the
--   append-only mfg.lot_consumption edges (I8) — the basis of the recall drill.
-- ============================================================================

CREATE OR REPLACE FUNCTION mfg.save_mps_entry(
    p_item_id bigint, p_plant text, p_bucket_start date, p_qty numeric, p_kind text
) RETURNS mfg.mps_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_row mfg.mps_entries;
BEGIN
    INSERT INTO mfg.mps_entries (item_id, plant, bucket_start, qty, kind, entered_by)
    VALUES (p_item_id, p_plant, p_bucket_start, p_qty, p_kind, v_actor)
    ON CONFLICT (item_id, plant, bucket_start, kind)
        DO UPDATE SET qty = EXCLUDED.qty, entered_by = v_actor
    RETURNING * INTO v_row;
    PERFORM ops.log_event('mfg.mps_entry', v_row.mps_id, 'saved',
                          jsonb_build_object('qty', p_qty, 'kind', p_kind));
    RETURN v_row;
END;
$$;

-- Backward trace: FG output lot -> all consumed input lots, recursively.
CREATE OR REPLACE FUNCTION mfg.trace_backward(p_lot text)
RETURNS TABLE(depth int, output_lot_no text, consumed_item_id bigint, consumed_lot_no text, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mfg, ops AS $$
    WITH RECURSIVE b AS (
        SELECT 1 AS depth, lc.output_lot_no, lc.consumed_item_id, lc.consumed_lot_no, lc.qty
        FROM mfg.lot_consumption lc
        WHERE lc.output_lot_no = p_lot
        UNION ALL
        SELECT b.depth + 1, lc.output_lot_no, lc.consumed_item_id, lc.consumed_lot_no, lc.qty
        FROM b
        JOIN mfg.lot_consumption lc ON lc.output_lot_no = b.consumed_lot_no
        WHERE b.depth < 50
    )
    SELECT depth, output_lot_no, consumed_item_id, consumed_lot_no, qty FROM b ORDER BY depth;
$$;

-- Forward trace: input/raw lot -> every output lot that consumed it, recursively
-- up to finished goods (the recall direction).
CREATE OR REPLACE FUNCTION mfg.trace_forward(p_lot text)
RETURNS TABLE(depth int, output_lot_no text, consumed_item_id bigint, consumed_lot_no text, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mfg, ops AS $$
    WITH RECURSIVE f AS (
        SELECT 1 AS depth, lc.output_lot_no, lc.consumed_item_id, lc.consumed_lot_no, lc.qty
        FROM mfg.lot_consumption lc
        WHERE lc.consumed_lot_no = p_lot
        UNION ALL
        SELECT f.depth + 1, lc.output_lot_no, lc.consumed_item_id, lc.consumed_lot_no, lc.qty
        FROM f
        JOIN mfg.lot_consumption lc ON lc.consumed_lot_no = f.output_lot_no
        WHERE f.depth < 50
    )
    SELECT depth, output_lot_no, consumed_item_id, consumed_lot_no, qty FROM f ORDER BY depth;
$$;

GRANT EXECUTE ON FUNCTION mfg.save_mps_entry(bigint, text, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mfg.trace_backward(text) TO authenticated;
GRANT EXECUTE ON FUNCTION mfg.trace_forward(text) TO authenticated;
