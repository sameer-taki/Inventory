-- ============================================================================
-- 0004_fleet.sql  ·  fleet plan F0–F3 (E-FLT0..3) · master plan module 14
-- ----------------------------------------------------------------------------
-- Vehicle & plant register, compliance renewals, maintenance job cards, and
-- fuel analytics. Transcribed from fleet-module-build-plan §6.
--   F7  meter_readings / fuel_logs append-only (correction = superseding row)
--   F8  driver licence data is personal — fleet_admin only
--   F4  analytics are deterministic SQL views
-- Build is gated after MAX Stage 1 (FG0); schema is laid now.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS fleet;

-- ─── register & compliance (F1) ──────────────────────────────────────────────
CREATE TABLE fleet.vehicles (
    vehicle_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fleet_code   text NOT NULL UNIQUE,               -- FLT-NNN, painted on the unit
    rego_no      text UNIQUE,                         -- NULL for unregistered plant
    make_model   text NOT NULL,
    year         int,
    chassis_no   text UNIQUE,
    kind         text NOT NULL
                 CHECK (kind IN ('truck','van','car','forklift','other_plant')),
    site         text NOT NULL,                       -- FD-1 site list
    ownership    text NOT NULL CHECK (ownership IN ('owned','leased')),
    lease_ref    text,
    meter_kind   text NOT NULL CHECK (meter_kind IN ('km','hours')),
    fuel_kind    text CHECK (fuel_kind IN ('diesel','petrol','lpg','electric','na')),
    acquired_on  date,
    status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','workshop','parked','disposed')),
    disposed_on  date,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_vehicles_touch BEFORE UPDATE ON fleet.vehicles
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();
-- BC fixed-asset no. lives in ops.external_refs
--   (entity_type='fleet.vehicle', system='bc_fixed_asset') per FD-2.

-- Append-only (F7). Non-monotonic readings allowed but auto-flagged.
CREATE TABLE fleet.meter_readings (
    reading_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id    bigint NOT NULL REFERENCES fleet.vehicles,
    reading       numeric(12,1) NOT NULL CHECK (reading >= 0),
    read_at       timestamptz NOT NULL DEFAULT now(),
    source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','fuel_log','job_card','import')),
    entered_by    bigint NOT NULL REFERENCES ops.users (user_id),
    supersedes_id bigint REFERENCES fleet.meter_readings,   -- correction chain (F7)
    is_flagged    boolean NOT NULL DEFAULT false,           -- set by validation, not humans
    flag_reason   text
);
CREATE INDEX ix_meter_vehicle_time ON fleet.meter_readings (vehicle_id, read_at DESC);

-- Polymorphic renewals: vehicles AND drivers (licence expiry) share the engine.
CREATE TABLE fleet.renewals (
    renewal_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type     text NOT NULL CHECK (entity_type IN ('vehicle','driver')),
    entity_id       bigint NOT NULL,
    kind            text NOT NULL CHECK (kind IN
                    ('registration','wheel_tax','fitness_cof','insurance',
                     'plant_inspection','licence','other')),
    reference_no    text,
    due_date        date NOT NULL,
    reminder_days   int NOT NULL DEFAULT 30,
    status          text NOT NULL DEFAULT 'current'
                    CHECK (status IN ('current','due_soon','overdue','renewed','lapsed','na')),
    completed_at    date,
    next_renewal_id bigint REFERENCES fleet.renewals,       -- chain: renewing creates next row
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_renewals_due ON fleet.renewals (status, due_date);
CREATE TRIGGER trg_renewals_touch BEFORE UPDATE ON fleet.renewals
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- Thin driver table (F8): class + expiry only. HR remains master for people.
CREATE TABLE fleet.drivers (
    driver_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id              bigint NOT NULL UNIQUE REFERENCES ops.users (user_id),
    licence_class        text NOT NULL,
    licence_expiry       date NOT NULL,
    forklift_certified   boolean NOT NULL DEFAULT false,
    forklift_cert_expiry date,
    is_active            boolean NOT NULL DEFAULT true
);

-- Thin assignment log (F6): who has what, when. Nothing more.
CREATE TABLE fleet.assignments (
    assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id    bigint NOT NULL REFERENCES fleet.vehicles,
    driver_id     bigint REFERENCES fleet.drivers,
    site          text,
    assigned_from date NOT NULL,
    assigned_to   date,
    note          text
);

-- ─── maintenance (F2) ─────────────────────────────────────────────────────────
CREATE TABLE fleet.service_plans (
    plan_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id        bigint NOT NULL REFERENCES fleet.vehicles,
    name              text NOT NULL,                  -- '10,000 km service'
    interval_kind     text NOT NULL CHECK (interval_kind IN ('days','km','hours')),
    interval_value    numeric(12,1) NOT NULL CHECK (interval_value > 0),
    last_done_at      date,
    last_done_reading numeric(12,1),
    is_active         boolean NOT NULL DEFAULT true,
    UNIQUE (vehicle_id, name)
);

CREATE TABLE fleet.job_cards (
    job_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_no           text NOT NULL UNIQUE,            -- FJC-YYYYNNNN
    vehicle_id       bigint NOT NULL REFERENCES fleet.vehicles,
    kind             text NOT NULL
                     CHECK (kind IN ('scheduled','breakdown','inspection','tyres','other')),
    plan_id          bigint REFERENCES fleet.service_plans,
    description      text NOT NULL,
    workshop         text NOT NULL CHECK (workshop IN ('internal','external')),
    vendor_name      text,
    po_ref           text,                            -- procurement app / BC PO (F1)
    invoice_ref      text,                            -- BC purchase invoice no.
    meter_at_service numeric(12,1),
    parts_cost_fjd   numeric(12,2) NOT NULL DEFAULT 0,
    labour_cost_fjd  numeric(12,2) NOT NULL DEFAULT 0,
    downtime_hours   numeric(8,1),
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','awaiting_parts','done','cancelled')),
    opened_at        timestamptz NOT NULL DEFAULT now(),
    closed_at        timestamptz
);

CREATE TABLE fleet.job_card_events (                  -- F3: transitions logged
    event_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id       bigint NOT NULL REFERENCES fleet.job_cards,
    from_status  text,
    to_status    text NOT NULL,
    actor_id     bigint NOT NULL REFERENCES ops.users (user_id),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── fuel & imports (F3) ─────────────────────────────────────────────────────
CREATE TABLE fleet.import_batches (
    batch_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_name  text NOT NULL,                       -- 'Total card stmt Jun-26' (FD-3)
    file_ref     text NOT NULL,
    row_count    int,
    status       text NOT NULL DEFAULT 'parsing'
                 CHECK (status IN ('parsing','awaiting_verification','accepted','rejected')),
    uploaded_by  bigint NOT NULL REFERENCES ops.users (user_id),
    uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only (F7). Consumption maths uses full-to-full fills only.
CREATE TABLE fleet.fuel_logs (
    fuel_log_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id    bigint NOT NULL REFERENCES fleet.vehicles,
    filled_at     date NOT NULL,
    litres        numeric(8,2) NOT NULL CHECK (litres > 0),
    cost_fjd      numeric(10,2) NOT NULL CHECK (cost_fjd >= 0),
    meter_reading numeric(12,1),
    is_full_fill  boolean NOT NULL DEFAULT true,
    vendor        text,
    source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','statement_import')),
    batch_id      bigint REFERENCES fleet.import_batches,
    verified_by   bigint REFERENCES ops.users (user_id),  -- required when statement_import
    supersedes_id bigint REFERENCES fleet.fuel_logs,       -- correction chain (F7)
    entered_by    bigint NOT NULL REFERENCES ops.users (user_id),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_fuel_vehicle_date ON fleet.fuel_logs (vehicle_id, filled_at);

-- ─── analytics views (F4: deterministic SQL only) ────────────────────────────
CREATE VIEW fleet.v_due_renewals WITH (security_invoker = true) AS
SELECT r.*, GREATEST(0, r.due_date - CURRENT_DATE) AS days_left
FROM   fleet.renewals r
WHERE  r.status IN ('current','due_soon','overdue')
AND    r.due_date <= CURRENT_DATE + (r.reminder_days || ' days')::interval;

CREATE VIEW fleet.v_consumption WITH (security_invoker = true) AS   -- full-to-full segments
WITH fulls AS (
  SELECT vehicle_id, filled_at, litres, cost_fjd, meter_reading,
         LAG(meter_reading) OVER (PARTITION BY vehicle_id ORDER BY meter_reading) AS prev_reading
  FROM   fleet.fuel_logs
  WHERE  is_full_fill AND meter_reading IS NOT NULL AND supersedes_id IS NULL
)
SELECT vehicle_id, filled_at,
       meter_reading - prev_reading                                      AS distance_or_hours,
       litres,
       round(litres / NULLIF(meter_reading - prev_reading, 0) * 100, 2)  AS per_100_units,
       round(cost_fjd / NULLIF(meter_reading - prev_reading, 0), 3)      AS cost_per_unit_fjd
FROM   fulls WHERE prev_reading IS NOT NULL AND meter_reading > prev_reading;

CREATE VIEW fleet.v_vehicle_monthly_cost WITH (security_invoker = true) AS
SELECT v.vehicle_id, v.fleet_code, date_trunc('month', d.on_date)::date AS month,
       sum(d.fuel_fjd)   AS fuel_fjd,
       sum(d.parts_fjd)  AS parts_fjd,
       sum(d.labour_fjd) AS labour_fjd
FROM fleet.vehicles v
JOIN LATERAL (
    SELECT filled_at AS on_date, cost_fjd AS fuel_fjd, 0 AS parts_fjd, 0 AS labour_fjd
    FROM fleet.fuel_logs WHERE vehicle_id = v.vehicle_id AND supersedes_id IS NULL
    UNION ALL
    SELECT closed_at::date, 0, parts_cost_fjd, labour_cost_fjd
    FROM fleet.job_cards WHERE vehicle_id = v.vehicle_id AND status = 'done'
) d ON true
WHERE d.on_date IS NOT NULL
GROUP BY 1, 2, 3;

-- ============================================================================
-- Grants + RLS
-- ============================================================================
GRANT USAGE ON SCHEMA fleet TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA fleet TO authenticated;

-- Non-personal tables: readable by any member. Writes via RPC / service role.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['vehicles','meter_readings','assignments','service_plans',
                        'job_cards','job_card_events','import_batches','fuel_logs'])
  LOOP
    EXECUTE format('ALTER TABLE fleet.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY p_%s_read ON fleet.%I FOR SELECT USING (ops.is_member());', t, t);
  END LOOP;
END $$;

-- Driver personal data (F8): fleet_admin only.
ALTER TABLE fleet.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_drivers_read ON fleet.drivers
    FOR SELECT USING (ops.has_role('fleet_admin'));

-- Renewals: vehicle renewals to any member; driver (licence) renewals are
-- personal data → fleet_admin only (F8).
ALTER TABLE fleet.renewals ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_renewals_read ON fleet.renewals
    FOR SELECT USING (
        (entity_type = 'vehicle' AND ops.is_member())
        OR (entity_type = 'driver' AND ops.has_role('fleet_admin'))
    );
