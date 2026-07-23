-- ============================================================================
-- 0011_fuel_import.sql  ·  Fleet F3 — fuel statement import + verification queue
-- ----------------------------------------------------------------------------
-- Uploaded statement rows land in a staging queue (fleet.fuel_import_rows) and
-- become fuel_logs only when a human accepts them — the same verification
-- discipline as the Superstore PO app: no imported financial figure enters
-- analytics unverified (fleet plan §4). fuel_logs stay append-only (F7).
-- ============================================================================

CREATE TABLE fleet.fuel_import_rows (
    row_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id      bigint NOT NULL REFERENCES fleet.import_batches (batch_id),
    fleet_code    text,                              -- as it appears in the statement
    vehicle_id    bigint REFERENCES fleet.vehicles,  -- resolved from fleet_code, NULL if unmatched
    filled_at     date,
    litres        numeric(8,2),
    cost_fjd      numeric(10,2),
    meter_reading numeric(12,1),
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected')),
    fuel_log_id   bigint REFERENCES fleet.fuel_logs,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_fuelimport_batch ON fleet.fuel_import_rows (batch_id, status);

ALTER TABLE fleet.fuel_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_fuelimport_read ON fleet.fuel_import_rows FOR SELECT USING (ops.is_member());
GRANT SELECT ON fleet.fuel_import_rows TO authenticated;

-- Create a batch + stage its parsed rows. p_rows: jsonb array of
-- {fleet_code, filled_at, litres, cost_fjd, meter_reading?}
CREATE OR REPLACE FUNCTION fleet.create_fuel_import(
    p_source_name text, p_file_ref text, p_rows jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','workshop','admin']);
        v_batch bigint; v_count int;
BEGIN
    SELECT count(*) INTO v_count FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb));
    INSERT INTO fleet.import_batches (source_name, file_ref, row_count, status, uploaded_by)
    VALUES (p_source_name, p_file_ref, v_count, 'awaiting_verification', v_actor)
    RETURNING batch_id INTO v_batch;

    INSERT INTO fleet.fuel_import_rows (batch_id, fleet_code, vehicle_id, filled_at, litres, cost_fjd, meter_reading)
    SELECT v_batch,
           e->>'fleet_code',
           (SELECT vehicle_id FROM fleet.vehicles v WHERE v.fleet_code = e->>'fleet_code'),
           NULLIF(e->>'filled_at','')::date,
           NULLIF(e->>'litres','')::numeric,
           NULLIF(e->>'cost_fjd','')::numeric,
           NULLIF(e->>'meter_reading','')::numeric
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e;

    PERFORM ops.log_event('fleet.import_batch', v_batch, 'created', jsonb_build_object('rows', v_count));
    RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION fleet.accept_fuel_import_row(p_row_id bigint)
RETURNS fleet.fuel_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','workshop','admin']);
        r fleet.fuel_import_rows; v_log fleet.fuel_logs;
BEGIN
    SELECT * INTO r FROM fleet.fuel_import_rows WHERE row_id = p_row_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'import row % not found', p_row_id; END IF;
    IF r.status <> 'pending' THEN RAISE EXCEPTION 'row already %', r.status; END IF;
    IF r.vehicle_id IS NULL THEN RAISE EXCEPTION 'row has no matched vehicle (fleet_code %)', r.fleet_code; END IF;
    IF r.litres IS NULL OR r.cost_fjd IS NULL OR r.filled_at IS NULL THEN
        RAISE EXCEPTION 'row is missing filled_at/litres/cost';
    END IF;

    INSERT INTO fleet.fuel_logs (vehicle_id, filled_at, litres, cost_fjd, meter_reading,
                                 is_full_fill, source, batch_id, verified_by, entered_by)
    VALUES (r.vehicle_id, r.filled_at, r.litres, r.cost_fjd, r.meter_reading,
            true, 'statement_import', r.batch_id, v_actor, v_actor)
    RETURNING * INTO v_log;

    IF r.meter_reading IS NOT NULL THEN
        INSERT INTO fleet.meter_readings (vehicle_id, reading, source, entered_by)
        VALUES (r.vehicle_id, r.meter_reading, 'import', v_actor);
    END IF;

    UPDATE fleet.fuel_import_rows SET status = 'accepted', fuel_log_id = v_log.fuel_log_id
    WHERE row_id = p_row_id;
    PERFORM ops.log_event('fleet.fuel_import_row', p_row_id, 'accepted',
                          jsonb_build_object('fuel_log_id', v_log.fuel_log_id));
    RETURN v_log;
END;
$$;

CREATE OR REPLACE FUNCTION fleet.reject_fuel_import_row(p_row_id bigint, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','workshop','admin']);
BEGIN
    UPDATE fleet.fuel_import_rows SET status = 'rejected', note = p_note
    WHERE row_id = p_row_id AND status = 'pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'row % not pending', p_row_id; END IF;
    PERFORM ops.log_event('fleet.fuel_import_row', p_row_id, 'rejected', jsonb_build_object('note', p_note));
END;
$$;

GRANT EXECUTE ON FUNCTION fleet.create_fuel_import(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION fleet.accept_fuel_import_row(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION fleet.reject_fuel_import_row(bigint, text) TO authenticated;
