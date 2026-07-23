-- ============================================================================
-- 0022_shopfloor.sql  ·  MAX parity — shop-floor labour capture (E-MAX3)
-- ----------------------------------------------------------------------------
-- Adds the missing labour-capture path (the cost roll-up reads mfg.labour_entries
-- but nothing populated it yet) and a combined operator action that posts a
-- completion and its labour in one transaction.
--
--   mfg.log_labour()                stand-alone labour entry (operator/supervisor/admin)
--   mfg.post_shopfloor_completion() delegates output+consumption to the audited
--                                   single-writer mfg.post_completion() (which
--                                   keeps the I10/I2/genealogy/outbox guarantees),
--                                   then appends labour entries in the SAME tx.
-- Nothing bypasses post_completion — the single-writer path (I2) is preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION mfg.log_labour(
    p_po_id bigint, p_work_centre_id bigint, p_minutes numeric,
    p_operation_seq int DEFAULT NULL, p_entry_date date DEFAULT NULL
) RETURNS mfg.labour_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['operator','supervisor','admin']);
        v mfg.labour_entries;
BEGIN
    IF p_minutes IS NULL OR p_minutes <= 0 THEN RAISE EXCEPTION 'minutes must be > 0'; END IF;
    INSERT INTO mfg.labour_entries (production_order_id, operation_seq, operator_id,
                                    work_centre_id, minutes, entry_date)
    VALUES (p_po_id, p_operation_seq, v_actor, p_work_centre_id, p_minutes,
            COALESCE(p_entry_date, CURRENT_DATE))
    RETURNING * INTO v;
    PERFORM ops.log_event('mfg.labour', v.labour_entry_id, 'logged',
                          jsonb_build_object('po', p_po_id, 'work_centre_id', p_work_centre_id,
                                             'minutes', p_minutes, 'operation_seq', p_operation_seq));
    RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION mfg.log_labour(bigint, bigint, numeric, int, date) TO authenticated;

-- p_labour: jsonb array of {work_centre_id, minutes, operation_seq?}
CREATE OR REPLACE FUNCTION mfg.post_shopfloor_completion(
    p_po_id bigint, p_qty_good numeric, p_qty_scrap numeric,
    p_consumption jsonb, p_bc_location text,
    p_output_lot_no text DEFAULT NULL, p_labour jsonb DEFAULT '[]'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_completion mfg.completions;
        v_actor bigint := ops.current_user_id();
BEGIN
    -- output + consumption + BC outbox + genealogy, fully audited (I2/I10/I8)
    v_completion := mfg.post_completion(p_po_id, p_qty_good, p_qty_scrap,
                                        p_consumption, p_bc_location, p_output_lot_no);

    -- labour, same transaction
    INSERT INTO mfg.labour_entries (production_order_id, operation_seq, operator_id,
                                    work_centre_id, minutes, entry_date)
    SELECT p_po_id, NULLIF(e->>'operation_seq','')::int, v_actor,
           (e->>'work_centre_id')::bigint, (e->>'minutes')::numeric, CURRENT_DATE
    FROM jsonb_array_elements(COALESCE(p_labour, '[]'::jsonb)) e
    WHERE COALESCE((e->>'minutes')::numeric, 0) > 0;

    RETURN v_completion.completion_id;
END;
$$;
GRANT EXECUTE ON FUNCTION mfg.post_shopfloor_completion(bigint, numeric, numeric, jsonb, text, text, jsonb) TO authenticated;
