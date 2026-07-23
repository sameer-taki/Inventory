-- ============================================================================
-- 0013_outbox_delivery.sql  ·  gateway-bridge finalize RPCs (system / service_role)
-- ----------------------------------------------------------------------------
-- The gateway-bridge worker (supabase/functions/gateway-bridge) delivers
-- ops.integration_outbox rows to BC and calls these to finalize atomically.
-- They are granted ONLY to service_role (the worker), not to app users:
--   - outbox_mark_sent: mark sent, stamp the BC ref, map it in external_refs,
--     write back the BC document no. onto the aggregate (P3/I3), log the event.
--   - outbox_mark_failed: increment attempts, record the error, optionally dead.
-- Neither is reachable from the browser; app users only get retry/mark_dead
-- (0012), which never mark a row 'sent'.
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.outbox_mark_sent(p_outbox_id bigint, p_external_ref_no text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ops AS $$
DECLARE r ops.integration_outbox;
BEGIN
    SELECT * INTO r FROM ops.integration_outbox WHERE outbox_id = p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'outbox row % not found', p_outbox_id; END IF;

    UPDATE ops.integration_outbox
       SET status = 'sent', external_ref_no = p_external_ref_no, sent_at = now(), last_error = NULL
     WHERE outbox_id = p_outbox_id;

    -- aggregate-specific write-back of the BC document number
    IF r.aggregate_type = 'mfg.completion' THEN
        UPDATE mfg.completions SET bc_document_no = p_external_ref_no WHERE completion_id = r.aggregate_id;
    END IF;

    -- map the canonical aggregate to its BC document (I3)
    INSERT INTO ops.external_refs (entity_type, entity_id, system, external_id)
    VALUES (r.aggregate_type, r.aggregate_id, r.target_system, p_external_ref_no)
    ON CONFLICT (entity_type, entity_id, system) DO UPDATE SET external_id = EXCLUDED.external_id;

    INSERT INTO ops.event_log (entity_type, entity_id, event_type, actor_id, detail)
    VALUES (r.aggregate_type, r.aggregate_id, 'bc_posted', NULL,
            jsonb_build_object('external_ref_no', p_external_ref_no, 'outbox_id', p_outbox_id));
END;
$$;

CREATE OR REPLACE FUNCTION ops.outbox_mark_failed(p_outbox_id bigint, p_error text, p_dead boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ops AS $$
DECLARE r ops.integration_outbox;
BEGIN
    SELECT * INTO r FROM ops.integration_outbox WHERE outbox_id = p_outbox_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'outbox row % not found', p_outbox_id; END IF;

    UPDATE ops.integration_outbox
       SET status = CASE WHEN p_dead THEN 'dead' ELSE 'failed' END,
           attempts = attempts + 1,
           last_error = p_error
     WHERE outbox_id = p_outbox_id;

    INSERT INTO ops.event_log (entity_type, entity_id, event_type, actor_id, detail)
    VALUES (r.aggregate_type, r.aggregate_id, 'bc_post_failed', NULL,
            jsonb_build_object('outbox_id', p_outbox_id, 'error', p_error, 'dead', p_dead));
END;
$$;

-- worker-only: reachable by the service role, never by app users
REVOKE ALL ON FUNCTION ops.outbox_mark_sent(bigint, text) FROM public;
REVOKE ALL ON FUNCTION ops.outbox_mark_failed(bigint, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION ops.outbox_mark_sent(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION ops.outbox_mark_failed(bigint, text, boolean) TO service_role;
