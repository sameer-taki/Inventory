-- ============================================================================
-- 0001_ops_foundation.sql  ·  MAX plan M0 · master plan schema map
-- ----------------------------------------------------------------------------
-- The canonical "ops" schema: the workflow spine shared by every module.
--   - users / roles / user_roles  (platform SSO + RBAC)
--   - items                        (canonical item master cache; BC is master, P1/I1)
--   - external_refs                (every cross-system id lives here, P3/I3/F3)
--   - integration_outbox           (single-writer queue to systems of record, P2/I2/F2)
--   - event_log                    (generic material-state-change log, P3)
-- Plus the helper functions that enforce single-writer + RBAC in RLS.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ops;

-- ─── shared trigger: keep updated_at honest ────────────────────────────────
CREATE OR REPLACE FUNCTION ops.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─── users ─────────────────────────────────────────────────────────────────
-- Canonical bigint user id (referenced by every module as *_by / owner_id),
-- linked 1:1 to a Supabase auth user. HR / IdP remain the people master.
CREATE TABLE ops.users (
    user_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth_user_id  uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
    email         text NOT NULL UNIQUE,
    full_name     text,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON ops.users
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- ─── roles / user_roles ─────────────────────────────────────────────────────
CREATE TABLE ops.roles (
    role_key     text PRIMARY KEY,
    description  text NOT NULL
);

CREATE TABLE ops.user_roles (
    user_id      bigint NOT NULL REFERENCES ops.users (user_id) ON DELETE CASCADE,
    role_key     text   NOT NULL REFERENCES ops.roles (role_key) ON DELETE CASCADE,
    granted_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_key)
);
CREATE INDEX ix_user_roles_role ON ops.user_roles (role_key);

INSERT INTO ops.roles (role_key, description) VALUES
    ('admin',       'Platform administrator — full access'),
    ('viewer',      'Read-only dashboards, no personal data'),
    -- manufacturing / quality RBAC (MAX plan §4)
    ('planner',     'Manufacturing planner — MPS/MRP, planned orders'),
    ('supervisor',  'Production supervisor — release/close production orders'),
    ('operator',    'Shop-floor operator — completions, labour, meter entry'),
    ('quality',     'Quality — raise/disposition NCRs, own CAPAs'),
    -- fleet RBAC (fleet plan §4)
    ('fleet_admin', 'Fleet administrator — full fleet incl. driver data (F8)'),
    ('workshop',    'Workshop — job cards, meter readings'),
    ('driver',      'Driver — submit fuel fills + meter readings for own vehicle')
ON CONFLICT DO NOTHING;

-- ─── canonical item master (read cache; BC Essentials is master, P1/I1) ─────
CREATE TABLE ops.items (
    item_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_no       text NOT NULL UNIQUE,          -- BC item no. (also mapped in external_refs)
    description   text NOT NULL,
    base_uom      text NOT NULL DEFAULT 'EA',
    item_category text,
    make_or_buy   text CHECK (make_or_buy IN ('make','buy')),
    is_active     boolean NOT NULL DEFAULT true,
    source        text NOT NULL DEFAULT 'bc' CHECK (source IN ('bc','manual','max_migration')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_items_touch BEFORE UPDATE ON ops.items
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- ─── external_refs (P3/I3/F3) ───────────────────────────────────────────────
-- Every canonical entity that also lives in a system of record is mapped here.
--   entity_type e.g. 'ops.item', 'mfg.completion', 'quality.ncr', 'fleet.vehicle'
--   system      e.g. 'bc', 'bc_fixed_asset', 'kiwiplan', 'max'
CREATE TABLE ops.external_refs (
    ref_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type   text NOT NULL,
    entity_id     bigint NOT NULL,
    system        text NOT NULL,
    external_id   text NOT NULL,
    extra         jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id, system),
    UNIQUE (system, external_id, entity_type)
);
CREATE INDEX ix_external_refs_lookup ON ops.external_refs (entity_type, entity_id);

-- ─── integration_outbox (P2/I2/F2 — single writer to systems of record) ─────
-- Nothing writes to BC (or any SoR) directly. A write is enqueued here with an
-- idempotency key; the gateway bridge delivers it and marks the row sent.
CREATE TABLE ops.integration_outbox (
    outbox_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type  text NOT NULL,                 -- e.g. 'mfg.completion'
    aggregate_id    bigint NOT NULL,
    event_type      text NOT NULL,                 -- e.g. 'post_assembly_order'
    target_system   text NOT NULL DEFAULT 'bc',
    idempotency_key text NOT NULL UNIQUE,          -- e.g. 'mfg:po:123:completion:1'
    payload         jsonb NOT NULL,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','dead')),
    attempts        int NOT NULL DEFAULT 0,
    last_error      text,
    external_ref_no text,                          -- doc no. written back on success
    created_at      timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz
);
CREATE INDEX ix_outbox_pending ON ops.integration_outbox (status, created_at)
    WHERE status IN ('pending','failed');

-- ─── event_log (P3 — generic material-state-change log) ─────────────────────
-- Quality keeps its own quality.status_events (I9); mfg/fleet cross-cutting
-- transitions that don't have a dedicated events table land here.
CREATE TABLE ops.event_log (
    event_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type  text NOT NULL,
    entity_id    bigint NOT NULL,
    event_type   text NOT NULL,
    actor_id     bigint REFERENCES ops.users (user_id),
    detail       jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_event_log_entity ON ops.event_log (entity_type, entity_id, created_at);

-- ============================================================================
-- Identity + RBAC helpers (used by every module's RLS policies)
-- ============================================================================

-- Resolve the ops.users.user_id for the current Supabase auth session.
CREATE OR REPLACE FUNCTION ops.current_user_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ops AS $$
    SELECT user_id FROM ops.users WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION ops.has_role(p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ops AS $$
    SELECT EXISTS (
        SELECT 1
        FROM ops.user_roles ur
        JOIN ops.users u ON u.user_id = ur.user_id
        WHERE u.auth_user_id = auth.uid()
          AND ur.role_key = p_role
    );
$$;

CREATE OR REPLACE FUNCTION ops.has_any_role(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ops AS $$
    SELECT EXISTS (
        SELECT 1
        FROM ops.user_roles ur
        JOIN ops.users u ON u.user_id = ur.user_id
        WHERE u.auth_user_id = auth.uid()
          AND ur.role_key = ANY (p_roles)
    );
$$;

-- Any authenticated user that has been provisioned into ops.users.
CREATE OR REPLACE FUNCTION ops.is_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ops AS $$
    SELECT EXISTS (SELECT 1 FROM ops.users WHERE auth_user_id = auth.uid() AND is_active);
$$;

-- ─── provision / link an ops.users row for each new auth user ───────────────
-- If an admin pre-provisioned a row by email (auth_user_id still NULL), the
-- new auth user is LINKED to it and activated, keeping any roles already
-- granted. Otherwise a brand-new sign-up lands as an inactive 'viewer' until
-- an admin activates and roles them.
CREATE OR REPLACE FUNCTION ops.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ops AS $$
DECLARE
    v_user_id bigint;
BEGIN
    -- 1) link a pre-provisioned, unlinked row by email
    UPDATE ops.users
       SET auth_user_id = NEW.id,
           is_active     = true
     WHERE email = NEW.email
       AND auth_user_id IS NULL
    RETURNING user_id INTO v_user_id;

    -- 2) otherwise create a fresh, inactive viewer
    IF v_user_id IS NULL THEN
        INSERT INTO ops.users (auth_user_id, email, full_name, is_active)
        VALUES (NEW.id, NEW.email,
                COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
                false)
        ON CONFLICT (auth_user_id) DO NOTHING
        RETURNING user_id INTO v_user_id;

        IF v_user_id IS NOT NULL THEN
            INSERT INTO ops.user_roles (user_id, role_key)
            VALUES (v_user_id, 'viewer')
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION ops.handle_new_auth_user();

-- ============================================================================
-- Grants + RLS
-- ============================================================================
GRANT USAGE ON SCHEMA ops TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA ops TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ops TO authenticated;

ALTER TABLE ops.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.external_refs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.event_log        ENABLE ROW LEVEL SECURITY;

-- Directory-style reads are open to any provisioned member; the sensitive
-- integration tables are admin-only. NO write policies exist anywhere in ops:
-- every write goes through a SECURITY DEFINER RPC or the service role
-- (single-writer, P2/I2/F2).
CREATE POLICY p_users_read      ON ops.users        FOR SELECT USING (ops.is_member());
CREATE POLICY p_roles_read      ON ops.roles        FOR SELECT USING (ops.is_member());
CREATE POLICY p_user_roles_read ON ops.user_roles   FOR SELECT USING (ops.is_member());
CREATE POLICY p_items_read      ON ops.items        FOR SELECT USING (ops.is_member());
CREATE POLICY p_extref_read     ON ops.external_refs FOR SELECT USING (ops.is_member());
CREATE POLICY p_outbox_read     ON ops.integration_outbox FOR SELECT USING (ops.has_role('admin'));
CREATE POLICY p_eventlog_read   ON ops.event_log    FOR SELECT USING (ops.is_member());
