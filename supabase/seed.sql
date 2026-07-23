-- ============================================================================
-- seed.sql — demo / bootstrap data (idempotent)
-- ----------------------------------------------------------------------------
-- Runs automatically on `supabase db reset` (local). For a hosted project, run
-- it once against the database after migrations (see docs/architecture.md).
--
-- It pre-provisions platform users BY EMAIL (auth_user_id NULL). When a person
-- signs up with a matching email, the auth trigger links + activates them and
-- they inherit the roles granted here — no manual RBAC step needed for these.
--
-- Re-running is safe: the whole block no-ops if the demo NCR already exists.
-- ============================================================================

DO $seed$
DECLARE
    u_admin   bigint;
    u_quality bigint;
    u_planner bigint;
    u_fleet   bigint;
    it_tray   bigint;
    it_pulp   bigint;
    it_carton bigint;
    v_ncr1    bigint;
    v_ncr2    bigint;
    v_ncr3    bigint;
    v_capa1   bigint;
    veh1      bigint;
    veh2      bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM quality.ncrs WHERE ncr_no = 'NCR-DEMO-0001') THEN
        RAISE NOTICE 'seed already applied — skipping';
        RETURN;
    END IF;

    -- ── users (pre-provisioned by email; link on first sign-up) ─────────────
    INSERT INTO ops.users (email, full_name, is_active) VALUES
        ('sameer@golden.com.fj',  'Sameer (AI & Technology Lead)', true)
        ON CONFLICT (email) DO NOTHING;
    INSERT INTO ops.users (email, full_name, is_active) VALUES
        ('quality@golden.com.fj', 'Quality Lead',  true),
        ('planner@golden.com.fj', 'Production Planner', true),
        ('fleet@golden.com.fj',   'Fleet Administrator', true)
        ON CONFLICT (email) DO NOTHING;

    SELECT user_id INTO u_admin   FROM ops.users WHERE email = 'sameer@golden.com.fj';
    SELECT user_id INTO u_quality FROM ops.users WHERE email = 'quality@golden.com.fj';
    SELECT user_id INTO u_planner FROM ops.users WHERE email = 'planner@golden.com.fj';
    SELECT user_id INTO u_fleet   FROM ops.users WHERE email = 'fleet@golden.com.fj';

    INSERT INTO ops.user_roles (user_id, role_key) VALUES
        (u_admin,   'admin'),
        (u_admin,   'quality'),
        (u_quality, 'quality'),
        (u_planner, 'planner'),
        (u_fleet,   'fleet_admin')
        ON CONFLICT DO NOTHING;

    -- ── canonical items (molded-fibre stream — D-1 expected scope) ──────────
    INSERT INTO ops.items (item_no, description, base_uom, item_category, make_or_buy) VALUES
        ('MF-TRAY-30',  'Molded fibre egg tray (30-cell)', 'EA', 'finished_good', 'make'),
        ('RM-PULP-KRA', 'Recycled kraft pulp',             'KG', 'raw_material',  'buy'),
        ('MF-CARTON-A', 'Molded fibre produce carton A',   'EA', 'finished_good', 'make')
        ON CONFLICT (item_no) DO NOTHING;

    SELECT item_id INTO it_tray   FROM ops.items WHERE item_no = 'MF-TRAY-30';
    SELECT item_id INTO it_pulp   FROM ops.items WHERE item_no = 'RM-PULP-KRA';
    SELECT item_id INTO it_carton FROM ops.items WHERE item_no = 'MF-CARTON-A';

    -- ── work centres (mfg masters) ──────────────────────────────────────────
    INSERT INTO mfg.work_centres (code, name, plant, daily_capacity, labour_rate) VALUES
        ('WC-FORM',  'Forming machine',  'Molded Fibre', 1200, 18.50),
        ('WC-DRY',   'Drying tunnel',    'Molded Fibre', 1440, 12.00),
        ('WC-PACK',  'Packing line',     'Molded Fibre',  960, 15.00)
        ON CONFLICT (code) DO NOTHING;

    -- ── Quality: NCRs + logged status timeline (I9) ─────────────────────────
    INSERT INTO quality.ncrs (ncr_no, source, plant, item_id, lot_no, description, severity, status, disposition, raised_by, raised_at)
    VALUES ('NCR-DEMO-0001', 'production', 'Molded Fibre', it_tray, 'LOT-MF-260710-014',
            'Egg trays warping after drying — cell walls collapsing on ~8% of batch.',
            'major', 'dispositioned', 'rework', u_quality, now() - interval '9 days')
    RETURNING ncr_id INTO v_ncr1;

    INSERT INTO quality.ncrs (ncr_no, source, plant, item_id, description, severity, status, raised_by, raised_at)
    VALUES ('NCR-DEMO-0002', 'incoming', 'Molded Fibre', it_pulp,
            'Incoming kraft pulp moisture above spec (14% vs 10% max) on delivery.',
            'minor', 'under_review', u_quality, now() - interval '3 days')
    RETURNING ncr_id INTO v_ncr2;

    INSERT INTO quality.ncrs (ncr_no, source, plant, item_id, description, severity, status, raised_by, raised_at)
    VALUES ('NCR-DEMO-0003', 'customer_complaint', 'Molded Fibre', it_carton,
            'Customer reports produce cartons crushing in transit — insufficient wall strength.',
            'critical', 'open', u_quality, now() - interval '1 day')
    RETURNING ncr_id INTO v_ncr3;

    INSERT INTO quality.status_events (entity_type, entity_id, from_status, to_status, actor_id, note, created_at) VALUES
        ('ncr', v_ncr1, NULL,           'open',          u_quality, 'NCR raised',                 now() - interval '9 days'),
        ('ncr', v_ncr1, 'open',         'under_review',  u_quality, 'Assigned for review',        now() - interval '8 days'),
        ('ncr', v_ncr1, 'under_review', 'dispositioned', u_quality, 'Rework — re-press affected trays', now() - interval '6 days'),
        ('ncr', v_ncr2, NULL,           'open',          u_quality, 'NCR raised',                 now() - interval '3 days'),
        ('ncr', v_ncr2, 'open',         'under_review',  u_quality, 'Checking against supplier CoA', now() - interval '2 days'),
        ('ncr', v_ncr3, NULL,           'open',          u_quality, 'NCR raised',                 now() - interval '1 day');

    -- ── Quality: a CAPA off NCR-DEMO-0001 ───────────────────────────────────
    INSERT INTO quality.capas (capa_no, ncr_id, kind, root_cause, action_plan, owner_id, due_date, status, created_at)
    VALUES ('CAPA-DEMO-0001', v_ncr1, 'corrective',
            'Drying tunnel dwell time reduced during a shift changeover, under-curing the trays.',
            'Add a dwell-time interlock + operator checklist at the drying tunnel; retrain both shifts.',
            u_quality, CURRENT_DATE + 14, 'in_progress', now() - interval '5 days')
    RETURNING capa_id INTO v_capa1;

    INSERT INTO quality.status_events (entity_type, entity_id, from_status, to_status, actor_id, note, created_at) VALUES
        ('capa', v_capa1, NULL,   'open',        u_quality, 'CAPA raised',            now() - interval '5 days'),
        ('capa', v_capa1, 'open', 'in_progress', u_quality, 'Interlock spec drafted', now() - interval '4 days');

    -- ── Fleet: a couple of vehicles + renewals + a fill ─────────────────────
    INSERT INTO fleet.vehicles (fleet_code, rego_no, make_model, year, kind, site, ownership, meter_kind, fuel_kind)
    VALUES ('FLT-001', 'GM-412', 'Isuzu NPR delivery truck', 2019, 'truck', 'Molded Fibre', 'owned', 'km', 'diesel')
    RETURNING vehicle_id INTO veh1;

    INSERT INTO fleet.vehicles (fleet_code, make_model, year, kind, site, ownership, meter_kind, fuel_kind)
    VALUES ('FLT-014', 'Toyota 2.5t forklift', 2021, 'forklift', 'Molded Fibre', 'owned', 'hours', 'lpg')
    RETURNING vehicle_id INTO veh2;

    INSERT INTO fleet.renewals (entity_type, entity_id, kind, reference_no, due_date, reminder_days, status) VALUES
        ('vehicle', veh1, 'registration', 'REG-GM412',  CURRENT_DATE + 20, 30, 'current'),
        ('vehicle', veh1, 'fitness_cof',  'COF-GM412',  CURRENT_DATE + 8,  30, 'due_soon'),
        ('vehicle', veh1, 'insurance',    'INS-2026-7', CURRENT_DATE + 120,30, 'current'),
        ('vehicle', veh2, 'plant_inspection', 'FLK-014-INSP', CURRENT_DATE - 3, 30, 'overdue');

    INSERT INTO fleet.meter_readings (vehicle_id, reading, source, entered_by, read_at) VALUES
        (veh1, 84200.0, 'manual', u_fleet, now() - interval '20 days'),
        (veh1, 85010.0, 'fuel_log', u_fleet, now() - interval '6 days');

    INSERT INTO fleet.fuel_logs (vehicle_id, filled_at, litres, cost_fjd, meter_reading, entered_by) VALUES
        (veh1, CURRENT_DATE - 20, 62.40, 174.72, 84200.0, u_fleet),
        (veh1, CURRENT_DATE - 6,  58.10, 162.68, 85010.0, u_fleet);

    RAISE NOTICE 'seed applied';
END
$seed$;
