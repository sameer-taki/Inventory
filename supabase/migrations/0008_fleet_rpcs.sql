-- ============================================================================
-- 0008_fleet_rpcs.sql  ·  fleet plan F1–F3 write-paths + reminder engine
-- ----------------------------------------------------------------------------
-- Single-writer RPCs for the fleet module. Meter readings and fuel logs are
-- append-only (F7); corrections are new superseding rows. Renewals chain on
-- completion. The reminder engine is one deterministic pass (F4).
-- ============================================================================

-- ─── vehicles ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fleet.save_vehicle(
    p_fleet_code text, p_make_model text, p_kind text, p_site text,
    p_ownership text, p_meter_kind text,
    p_rego_no text DEFAULT NULL, p_year int DEFAULT NULL, p_chassis_no text DEFAULT NULL,
    p_fuel_kind text DEFAULT NULL, p_vehicle_id bigint DEFAULT NULL
) RETURNS fleet.vehicles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','workshop','admin']);
        v fleet.vehicles;
BEGIN
    IF p_vehicle_id IS NULL THEN
        INSERT INTO fleet.vehicles (fleet_code, rego_no, make_model, year, chassis_no, kind,
                                    site, ownership, meter_kind, fuel_kind)
        VALUES (p_fleet_code, p_rego_no, p_make_model, p_year, p_chassis_no, p_kind,
                p_site, p_ownership, p_meter_kind, p_fuel_kind)
        RETURNING * INTO v;
        PERFORM ops.log_event('fleet.vehicle', v.vehicle_id, 'created', jsonb_build_object('fleet_code', p_fleet_code));
    ELSE
        UPDATE fleet.vehicles
           SET fleet_code=p_fleet_code, rego_no=p_rego_no, make_model=p_make_model, year=p_year,
               chassis_no=p_chassis_no, kind=p_kind, site=p_site, ownership=p_ownership,
               meter_kind=p_meter_kind, fuel_kind=p_fuel_kind
         WHERE vehicle_id = p_vehicle_id RETURNING * INTO v;
        IF NOT FOUND THEN RAISE EXCEPTION 'vehicle % not found', p_vehicle_id; END IF;
        PERFORM ops.log_event('fleet.vehicle', v.vehicle_id, 'updated', jsonb_build_object('fleet_code', p_fleet_code));
    END IF;
    RETURN v;
END;
$$;

-- ─── meter readings (append-only F7, auto-flag non-monotonic) ───────────────
CREATE OR REPLACE FUNCTION fleet.add_meter_reading(
    p_vehicle_id bigint, p_reading numeric, p_source text DEFAULT 'manual'
) RETURNS fleet.meter_readings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['driver','workshop','fleet_admin','admin']);
        v_last numeric; v_flag boolean := false; v_reason text; v_row fleet.meter_readings;
BEGIN
    SELECT reading INTO v_last FROM fleet.meter_readings
     WHERE vehicle_id = p_vehicle_id AND supersedes_id IS NULL
     ORDER BY read_at DESC LIMIT 1;
    IF v_last IS NOT NULL AND p_reading < v_last THEN
        v_flag := true; v_reason := format('below previous reading (%s < %s)', p_reading, v_last);
    END IF;
    INSERT INTO fleet.meter_readings (vehicle_id, reading, source, entered_by, is_flagged, flag_reason)
    VALUES (p_vehicle_id, p_reading, p_source, v_actor, v_flag, v_reason)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

-- ─── fuel logs (append-only; also records the meter) ────────────────────────
CREATE OR REPLACE FUNCTION fleet.log_fuel(
    p_vehicle_id bigint, p_filled_at date, p_litres numeric, p_cost_fjd numeric,
    p_meter_reading numeric DEFAULT NULL, p_is_full_fill boolean DEFAULT true,
    p_vendor text DEFAULT NULL
) RETURNS fleet.fuel_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['driver','workshop','fleet_admin','admin']);
        v_row fleet.fuel_logs;
BEGIN
    INSERT INTO fleet.fuel_logs (vehicle_id, filled_at, litres, cost_fjd, meter_reading,
                                 is_full_fill, vendor, source, entered_by)
    VALUES (p_vehicle_id, p_filled_at, p_litres, p_cost_fjd, p_meter_reading,
            p_is_full_fill, p_vendor, 'manual', v_actor)
    RETURNING * INTO v_row;

    IF p_meter_reading IS NOT NULL THEN
        PERFORM fleet.add_meter_reading(p_vehicle_id, p_meter_reading, 'fuel_log');
    END IF;
    PERFORM ops.log_event('fleet.fuel_log', v_row.fuel_log_id, 'logged',
                          jsonb_build_object('litres', p_litres, 'cost_fjd', p_cost_fjd));
    RETURN v_row;
END;
$$;

-- ─── renewals (create + chained completion) ─────────────────────────────────
CREATE OR REPLACE FUNCTION fleet.save_renewal(
    p_entity_type text, p_entity_id bigint, p_kind text, p_due_date date,
    p_reference_no text DEFAULT NULL, p_reminder_days int DEFAULT 30
) RETURNS fleet.renewals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','admin']);
        v fleet.renewals;
BEGIN
    INSERT INTO fleet.renewals (entity_type, entity_id, kind, reference_no, due_date, reminder_days, status)
    VALUES (p_entity_type, p_entity_id, p_kind, p_reference_no, p_due_date, p_reminder_days, 'current')
    RETURNING * INTO v;
    PERFORM ops.log_event('fleet.renewal', v.renewal_id, 'created',
                          jsonb_build_object('kind', p_kind, 'due', p_due_date));
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION fleet.complete_renewal(
    p_renewal_id bigint, p_next_due_date date, p_completed_at date DEFAULT NULL, p_reference_no text DEFAULT NULL
) RETURNS fleet.renewals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','admin']);
        v_old fleet.renewals; v_new fleet.renewals;
BEGIN
    SELECT * INTO v_old FROM fleet.renewals WHERE renewal_id = p_renewal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'renewal % not found', p_renewal_id; END IF;

    INSERT INTO fleet.renewals (entity_type, entity_id, kind, reference_no, due_date, reminder_days, status)
    VALUES (v_old.entity_type, v_old.entity_id, v_old.kind,
            COALESCE(p_reference_no, v_old.reference_no), p_next_due_date, v_old.reminder_days, 'current')
    RETURNING * INTO v_new;

    UPDATE fleet.renewals
       SET status = 'renewed', completed_at = COALESCE(p_completed_at, CURRENT_DATE),
           next_renewal_id = v_new.renewal_id
     WHERE renewal_id = p_renewal_id RETURNING * INTO v_old;

    PERFORM ops.log_event('fleet.renewal', p_renewal_id, 'renewed',
                          jsonb_build_object('next_due', p_next_due_date, 'next_renewal_id', v_new.renewal_id));
    RETURN v_new;
END;
$$;

-- ─── job cards ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fleet.open_job_card(
    p_vehicle_id bigint, p_kind text, p_description text, p_workshop text,
    p_vendor_name text DEFAULT NULL, p_plan_id bigint DEFAULT NULL
) RETURNS fleet.job_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['workshop','fleet_admin','admin']);
        v fleet.job_cards;
BEGIN
    INSERT INTO fleet.job_cards (job_no, vehicle_id, kind, plan_id, description, workshop, vendor_name, status)
    VALUES (ops.next_doc_no('FJC'), p_vehicle_id, p_kind, p_plan_id, p_description, p_workshop, p_vendor_name, 'open')
    RETURNING * INTO v;
    INSERT INTO fleet.job_card_events (job_id, from_status, to_status, actor_id, note)
    VALUES (v.job_id, NULL, 'open', v_actor, 'job card opened');
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION fleet.transition_job_card(
    p_job_id bigint, p_to_status text, p_note text DEFAULT NULL,
    p_parts_cost numeric DEFAULT NULL, p_labour_cost numeric DEFAULT NULL,
    p_downtime_hours numeric DEFAULT NULL, p_po_ref text DEFAULT NULL, p_invoice_ref text DEFAULT NULL
) RETURNS fleet.job_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['workshop','fleet_admin','admin']);
        v_from text; v fleet.job_cards;
BEGIN
    SELECT status INTO v_from FROM fleet.job_cards WHERE job_id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'job card % not found', p_job_id; END IF;
    IF NOT ((v_from, p_to_status) IN (
            ('open','in_progress'),('in_progress','awaiting_parts'),('awaiting_parts','in_progress'),
            ('in_progress','done'),('open','cancelled'),('in_progress','cancelled'))) THEN
        RAISE EXCEPTION 'illegal job card transition % -> %', v_from, p_to_status;
    END IF;

    UPDATE fleet.job_cards
       SET status = p_to_status,
           parts_cost_fjd = COALESCE(p_parts_cost, parts_cost_fjd),
           labour_cost_fjd = COALESCE(p_labour_cost, labour_cost_fjd),
           downtime_hours = COALESCE(p_downtime_hours, downtime_hours),
           po_ref = COALESCE(p_po_ref, po_ref),
           invoice_ref = COALESCE(p_invoice_ref, invoice_ref),
           closed_at = CASE WHEN p_to_status = 'done' THEN now() ELSE closed_at END
     WHERE job_id = p_job_id RETURNING * INTO v;

    INSERT INTO fleet.job_card_events (job_id, from_status, to_status, actor_id, note)
    VALUES (p_job_id, v_from, p_to_status, v_actor, p_note);
    RETURN v;
END;
$$;

-- ─── reminder engine (F1 nightly job) ────────────────────────────────────────
-- Deterministic single pass: current → due_soon within reminder window;
-- anything past due → overdue. Returns the number of statuses changed.
CREATE OR REPLACE FUNCTION fleet.run_reminders() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','admin']);
        v_changed int := 0; v_n int;
BEGIN
    UPDATE fleet.renewals
       SET status = 'overdue'
     WHERE status IN ('current','due_soon') AND due_date < CURRENT_DATE;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;

    UPDATE fleet.renewals
       SET status = 'due_soon'
     WHERE status = 'current'
       AND due_date >= CURRENT_DATE
       AND due_date - reminder_days <= CURRENT_DATE;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;

    PERFORM ops.log_event('fleet.reminders', 0, 'run', jsonb_build_object('statuses_changed', v_changed));
    RETURN v_changed;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fleet TO authenticated;
