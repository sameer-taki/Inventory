-- ============================================================================
-- 0012_outbox_rpcs.sql  ·  integration_outbox operator controls (admin)
-- ----------------------------------------------------------------------------
-- The gateway bridge is the writer that delivers ops.integration_outbox rows to
-- BC. These RPCs let a platform admin re-queue a failed/poison row or mark one
-- dead from the monitor UI. Both are logged; neither marks a row 'sent' (only
-- the bridge does that, on real delivery).
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.outbox_retry(p_outbox_id bigint)
RETURNS ops.integration_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']);
        v_from text; v_row ops.integration_outbox;
BEGIN
    SELECT status INTO v_from FROM ops.integration_outbox WHERE outbox_id = p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'outbox row % not found', p_outbox_id; END IF;
    IF v_from NOT IN ('failed','dead','pending') THEN
        RAISE EXCEPTION 'cannot retry a % row', v_from;
    END IF;
    UPDATE ops.integration_outbox
       SET status = 'pending', last_error = NULL
     WHERE outbox_id = p_outbox_id
     RETURNING * INTO v_row;
    PERFORM ops.log_event('ops.integration_outbox', p_outbox_id, 'retry_requested',
                          jsonb_build_object('from', v_from));
    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION ops.outbox_mark_dead(p_outbox_id bigint, p_note text DEFAULT NULL)
RETURNS ops.integration_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['admin']);
        v_from text; v_row ops.integration_outbox;
BEGIN
    SELECT status INTO v_from FROM ops.integration_outbox WHERE outbox_id = p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'outbox row % not found', p_outbox_id; END IF;
    IF v_from NOT IN ('pending','failed') THEN
        RAISE EXCEPTION 'cannot mark a % row dead', v_from;
    END IF;
    UPDATE ops.integration_outbox
       SET status = 'dead', last_error = COALESCE(p_note, last_error)
     WHERE outbox_id = p_outbox_id
     RETURNING * INTO v_row;
    PERFORM ops.log_event('ops.integration_outbox', p_outbox_id, 'marked_dead',
                          jsonb_build_object('from', v_from, 'note', p_note));
    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION ops.outbox_retry(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION ops.outbox_mark_dead(bigint, text) TO authenticated;
