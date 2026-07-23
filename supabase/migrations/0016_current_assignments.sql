-- ============================================================================
-- 0016_current_assignments.sql  ·  Fleet — current vehicle assignments view
-- ----------------------------------------------------------------------------
-- fleet.v_current_assignments: the one open (assigned_to IS NULL) assignment
-- per vehicle, joined to the register, with a deterministic days-assigned
-- figure (F4 — analytics are SQL, never LLM numbers). security_invoker keeps
-- member RLS in force: assignments and vehicles are member-readable; driver
-- identity stays personal (F8) and is resolved by the caller for fleet_admin
-- only, so this view exposes driver_id but no driver name.
-- ============================================================================

CREATE OR REPLACE VIEW fleet.v_current_assignments WITH (security_invoker = true) AS
SELECT
    a.assignment_id,
    a.vehicle_id,
    v.fleet_code,
    v.make_model,
    v.kind                              AS vehicle_kind,
    v.site                             AS vehicle_site,
    v.status                           AS vehicle_status,
    a.driver_id,
    a.site                             AS assignment_site,
    a.assigned_from,
    a.note,
    GREATEST(0, CURRENT_DATE - a.assigned_from)::int AS days_assigned
FROM fleet.assignments a
JOIN fleet.vehicles v ON v.vehicle_id = a.vehicle_id
WHERE a.assigned_to IS NULL;

GRANT SELECT ON fleet.v_current_assignments TO authenticated;
