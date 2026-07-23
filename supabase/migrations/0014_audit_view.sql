-- ============================================================================
-- 0014_audit_view.sql  ·  unified audit trail
-- ----------------------------------------------------------------------------
-- ops.v_audit_log = the generic platform event log (ops.event_log) UNION the
-- quality NCR/CAPA status transitions (quality.status_events, I9), mapped to a
-- single shape so the audit viewer reads one source. security_invoker keeps the
-- underlying RLS (member read) in force.
-- ============================================================================

CREATE VIEW ops.v_audit_log WITH (security_invoker = true) AS
SELECT
    'ops'::text        AS source,
    e.event_id,
    e.entity_type,
    e.entity_id,
    e.event_type,
    e.actor_id,
    e.detail,
    e.created_at
FROM ops.event_log e
UNION ALL
SELECT
    'quality'::text                        AS source,
    s.event_id,
    'quality.' || s.entity_type            AS entity_type,   -- quality.ncr / quality.capa
    s.entity_id,
    s.to_status                            AS event_type,
    s.actor_id,
    jsonb_build_object('from', s.from_status, 'to', s.to_status, 'note', s.note) AS detail,
    s.created_at
FROM quality.status_events s;

GRANT SELECT ON ops.v_audit_log TO authenticated;
