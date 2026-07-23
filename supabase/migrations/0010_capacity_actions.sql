-- ============================================================================
-- 0010_capacity_actions.sql  ·  M5 capacity (advisory) + MRP action-message flow
-- ----------------------------------------------------------------------------
-- - mfg.v_work_centre_load: advisory load per work centre = Σ (setup + run×remaining)
--   over open production orders, vs effective daily capacity (deterministic, F4/I4).
-- - mfg.action_message_transition: planner actions/dismisses an MRP action message,
--   logged (no silent mutation).
-- ============================================================================

CREATE VIEW mfg.v_work_centre_load WITH (security_invoker = true) AS
SELECT
    wc.work_centre_id,
    wc.code,
    wc.name,
    wc.plant,
    round(wc.daily_capacity * wc.efficiency_pct / 100.0, 2) AS effective_daily_capacity,
    round(COALESCE(SUM(ro.setup_minutes
                       + ro.run_minutes_per_unit * GREATEST(po.qty_ordered - po.qty_completed, 0)), 0), 2)
        AS required_minutes,
    CASE
        WHEN wc.daily_capacity * wc.efficiency_pct / 100.0 > 0 THEN
            round(COALESCE(SUM(ro.setup_minutes
                               + ro.run_minutes_per_unit * GREATEST(po.qty_ordered - po.qty_completed, 0)), 0)
                  / (wc.daily_capacity * wc.efficiency_pct / 100.0) * 100, 1)
        ELSE NULL
    END AS load_pct
FROM mfg.work_centres wc
LEFT JOIN mfg.routing_operations ro ON ro.work_centre_id = wc.work_centre_id
LEFT JOIN mfg.production_orders po
       ON po.routing_id = ro.routing_id
      AND po.status IN ('firm', 'released', 'in_progress')
WHERE wc.is_active
GROUP BY wc.work_centre_id, wc.code, wc.name, wc.plant, wc.daily_capacity, wc.efficiency_pct;

GRANT SELECT ON mfg.v_work_centre_load TO authenticated;

CREATE OR REPLACE FUNCTION mfg.action_message_transition(
    p_action_id bigint, p_to_status text
) RETURNS mfg.action_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_from text; v_row mfg.action_messages;
BEGIN
    SELECT status INTO v_from FROM mfg.action_messages WHERE action_id = p_action_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'action message % not found', p_action_id; END IF;
    IF v_from <> 'open' OR p_to_status NOT IN ('actioned','dismissed') THEN
        RAISE EXCEPTION 'illegal action-message transition % -> %', v_from, p_to_status;
    END IF;
    UPDATE mfg.action_messages SET status = p_to_status WHERE action_id = p_action_id
    RETURNING * INTO v_row;
    PERFORM ops.log_event('mfg.action_message', p_action_id, p_to_status, jsonb_build_object('from', v_from));
    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION mfg.action_message_transition(bigint, text) TO authenticated;
