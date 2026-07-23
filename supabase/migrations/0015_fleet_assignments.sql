-- ============================================================================
-- 0015_fleet_assignments.sql  ·  Fleet F6 assignment log + F8 driver records
-- ----------------------------------------------------------------------------
-- - fleet.save_driver: thin driver record (class + expiry only, F8) — fleet_admin.
-- - fleet.assign_vehicle: open a new assignment, auto-closing the current open
--   one for that vehicle (one active assignment at a time). Thin log only (F6).
-- - fleet.end_assignment: close an open assignment.
-- All logged; writes only via these RPCs.
-- ============================================================================

CREATE OR REPLACE FUNCTION fleet.save_driver(
    p_user_id bigint, p_licence_class text, p_licence_expiry date,
    p_forklift_certified boolean DEFAULT false, p_forklift_cert_expiry date DEFAULT NULL,
    p_driver_id bigint DEFAULT NULL
) RETURNS fleet.drivers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','admin']);
        v fleet.drivers;
BEGIN
    IF p_driver_id IS NULL THEN
        INSERT INTO fleet.drivers (user_id, licence_class, licence_expiry, forklift_certified, forklift_cert_expiry)
        VALUES (p_user_id, p_licence_class, p_licence_expiry, p_forklift_certified, p_forklift_cert_expiry)
        RETURNING * INTO v;
        PERFORM ops.log_event('fleet.driver', v.driver_id, 'created', jsonb_build_object('user_id', p_user_id));
    ELSE
        UPDATE fleet.drivers
           SET licence_class = p_licence_class, licence_expiry = p_licence_expiry,
               forklift_certified = p_forklift_certified, forklift_cert_expiry = p_forklift_cert_expiry
         WHERE driver_id = p_driver_id RETURNING * INTO v;
        IF NOT FOUND THEN RAISE EXCEPTION 'driver % not found', p_driver_id; END IF;
        PERFORM ops.log_event('fleet.driver', v.driver_id, 'updated', NULL);
    END IF;
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION fleet.assign_vehicle(
    p_vehicle_id bigint, p_assigned_from date,
    p_driver_id bigint DEFAULT NULL, p_site text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS fleet.assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','workshop','admin']);
        v fleet.assignments;
BEGIN
    -- one active assignment per vehicle: close the current open one
    UPDATE fleet.assignments SET assigned_to = p_assigned_from
     WHERE vehicle_id = p_vehicle_id AND assigned_to IS NULL;

    INSERT INTO fleet.assignments (vehicle_id, driver_id, site, assigned_from, note)
    VALUES (p_vehicle_id, p_driver_id, p_site, p_assigned_from, p_note)
    RETURNING * INTO v;

    PERFORM ops.log_event('fleet.assignment', v.assignment_id, 'assigned',
                          jsonb_build_object('vehicle_id', p_vehicle_id, 'driver_id', p_driver_id, 'site', p_site));
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION fleet.end_assignment(p_assignment_id bigint, p_assigned_to date)
RETURNS fleet.assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','workshop','admin']);
        v fleet.assignments;
BEGIN
    UPDATE fleet.assignments SET assigned_to = p_assigned_to
     WHERE assignment_id = p_assignment_id AND assigned_to IS NULL
    RETURNING * INTO v;
    IF NOT FOUND THEN RAISE EXCEPTION 'assignment % not found or already ended', p_assignment_id; END IF;
    PERFORM ops.log_event('fleet.assignment', p_assignment_id, 'ended', jsonb_build_object('assigned_to', p_assigned_to));
    RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION fleet.save_driver(bigint, text, date, boolean, date, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION fleet.assign_vehicle(bigint, date, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fleet.end_assignment(bigint, date) TO authenticated;
