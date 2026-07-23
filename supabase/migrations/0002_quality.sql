-- ============================================================================
-- 0002_quality.sql  ·  MAX plan M1 (E-MAX1) · master plan module 7
-- ----------------------------------------------------------------------------
-- Quality / NCR / CAPA — the FIRST module built (triple duty: MAX Stage 1 +
-- Platform P3 + Accura P4). Net-new, adoption-gated, no MRP dependency.
--
-- Invariants realised here:
--   I9  NCR/CAPA append-only; status transitions logged; never deleted.
--   I3  Every state change appended to an event log (quality.status_events).
--   P2  Single writer: all writes go through SECURITY DEFINER RPCs; there are
--       NO direct INSERT/UPDATE/DELETE policies on the quality tables.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS quality;

-- ─── shared document-number generator (per-prefix, per-year) ────────────────
-- Lives in ops because mfg (MFG-…) and fleet (FJC-…) reuse it.
CREATE TABLE IF NOT EXISTS ops.doc_counters (
    prefix    text   NOT NULL,
    year      int    NOT NULL,
    last_seq  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (prefix, year)
);

CREATE OR REPLACE FUNCTION ops.next_doc_no(p_prefix text, p_width int DEFAULT 4)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ops AS $$
DECLARE
    v_year int := extract(year FROM now())::int;
    v_seq  bigint;
BEGIN
    INSERT INTO ops.doc_counters (prefix, year, last_seq)
    VALUES (p_prefix, v_year, 1)
    ON CONFLICT (prefix, year)
        DO UPDATE SET last_seq = ops.doc_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;
    RETURN p_prefix || '-' || v_year::text || lpad(v_seq::text, p_width, '0');
END;
$$;

-- ─── NCR ─────────────────────────────────────────────────────────────────────
CREATE TABLE quality.ncrs (
    ncr_id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ncr_no              text NOT NULL UNIQUE,          -- NCR-YYYYNNNN
    source              text NOT NULL
                        CHECK (source IN ('production','incoming','customer_complaint','audit','print')),
    plant               text,
    item_id             bigint REFERENCES ops.items (item_id),
    lot_no              text,
    production_order_id bigint,                        -- nullable; links to mfg when applicable
    description         text NOT NULL,
    severity            text NOT NULL CHECK (severity IN ('minor','major','critical')),
    disposition         text CHECK (disposition IN
                        ('use_as_is','rework','scrap','return_to_vendor','hold')),
    status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','under_review','dispositioned','closed')),
    raised_by           bigint NOT NULL REFERENCES ops.users (user_id),
    raised_at           timestamptz NOT NULL DEFAULT now(),
    closed_at           timestamptz
);
CREATE INDEX ix_ncrs_status   ON quality.ncrs (status);
CREATE INDEX ix_ncrs_source   ON quality.ncrs (source);
CREATE INDEX ix_ncrs_severity ON quality.ncrs (severity);

-- ─── CAPA ────────────────────────────────────────────────────────────────────
CREATE TABLE quality.capas (
    capa_id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    capa_no             text NOT NULL UNIQUE,          -- CAPA-YYYYNNNN
    ncr_id              bigint REFERENCES quality.ncrs (ncr_id),
    kind                text NOT NULL CHECK (kind IN ('corrective','preventive')),
    root_cause          text,
    action_plan         text NOT NULL,
    owner_id            bigint NOT NULL REFERENCES ops.users (user_id),
    due_date            date NOT NULL,
    effectiveness_check text,
    status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','pending_verification','closed')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    closed_at           timestamptz
);
CREATE INDEX ix_capas_status ON quality.capas (status);
CREATE INDEX ix_capas_ncr    ON quality.capas (ncr_id);

-- ─── status_events (I9 — every transition logged) ──────────────────────────
CREATE TABLE quality.status_events (
    event_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type  text NOT NULL CHECK (entity_type IN ('ncr','capa')),
    entity_id    bigint NOT NULL,
    from_status  text,
    to_status    text NOT NULL,
    actor_id     bigint NOT NULL REFERENCES ops.users (user_id),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_qstatus_entity ON quality.status_events (entity_type, entity_id, created_at);

-- ============================================================================
-- Write RPCs (single writer). No direct table writes are permitted by RLS.
-- ============================================================================

CREATE OR REPLACE FUNCTION quality.raise_ncr(
    p_source              text,
    p_description         text,
    p_severity            text,
    p_plant               text   DEFAULT NULL,
    p_item_id             bigint DEFAULT NULL,
    p_lot_no              text   DEFAULT NULL,
    p_production_order_id bigint DEFAULT NULL
) RETURNS quality.ncrs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = quality, ops AS $$
DECLARE
    v_actor bigint := ops.current_user_id();
    v_ncr   quality.ncrs;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'not a provisioned platform user';
    END IF;
    IF NOT ops.has_any_role(ARRAY['quality','supervisor','admin']) THEN
        RAISE EXCEPTION 'insufficient role to raise an NCR';
    END IF;

    INSERT INTO quality.ncrs (ncr_no, source, plant, item_id, lot_no,
                              production_order_id, description, severity,
                              status, raised_by)
    VALUES (ops.next_doc_no('NCR'), p_source, p_plant, p_item_id, p_lot_no,
            p_production_order_id, p_description, p_severity, 'open', v_actor)
    RETURNING * INTO v_ncr;

    INSERT INTO quality.status_events (entity_type, entity_id, from_status,
                                       to_status, actor_id, note)
    VALUES ('ncr', v_ncr.ncr_id, NULL, 'open', v_actor, 'NCR raised');

    RETURN v_ncr;
END;
$$;

CREATE OR REPLACE FUNCTION quality.transition_ncr(
    p_ncr_id      bigint,
    p_to_status   text,
    p_disposition text DEFAULT NULL,
    p_note        text DEFAULT NULL
) RETURNS quality.ncrs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = quality, ops AS $$
DECLARE
    v_actor bigint := ops.current_user_id();
    v_from  text;
    v_ncr   quality.ncrs;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'not a provisioned platform user';
    END IF;
    IF NOT ops.has_any_role(ARRAY['quality','supervisor','admin']) THEN
        RAISE EXCEPTION 'insufficient role to transition an NCR';
    END IF;

    SELECT status INTO v_from FROM quality.ncrs WHERE ncr_id = p_ncr_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NCR % not found', p_ncr_id;
    END IF;

    -- allowed transitions (I7-style tight state machine)
    IF NOT ( (v_from, p_to_status) IN (
                ('open','under_review'),
                ('open','dispositioned'),
                ('under_review','dispositioned'),
                ('dispositioned','closed'),
                ('dispositioned','under_review') ) ) THEN
        RAISE EXCEPTION 'illegal NCR transition % -> %', v_from, p_to_status;
    END IF;

    IF p_to_status = 'dispositioned' AND p_disposition IS NULL THEN
        RAISE EXCEPTION 'a disposition is required to disposition an NCR';
    END IF;

    UPDATE quality.ncrs
       SET status      = p_to_status,
           disposition = COALESCE(p_disposition, disposition),
           closed_at   = CASE WHEN p_to_status = 'closed' THEN now() ELSE closed_at END
     WHERE ncr_id = p_ncr_id
     RETURNING * INTO v_ncr;

    INSERT INTO quality.status_events (entity_type, entity_id, from_status,
                                       to_status, actor_id, note)
    VALUES ('ncr', p_ncr_id, v_from, p_to_status, v_actor, p_note);

    RETURN v_ncr;
END;
$$;

CREATE OR REPLACE FUNCTION quality.raise_capa(
    p_kind        text,
    p_action_plan text,
    p_owner_id    bigint,
    p_due_date    date,
    p_ncr_id      bigint DEFAULT NULL,
    p_root_cause  text   DEFAULT NULL
) RETURNS quality.capas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = quality, ops AS $$
DECLARE
    v_actor bigint := ops.current_user_id();
    v_capa  quality.capas;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'not a provisioned platform user';
    END IF;
    IF NOT ops.has_any_role(ARRAY['quality','admin']) THEN
        RAISE EXCEPTION 'insufficient role to raise a CAPA';
    END IF;

    INSERT INTO quality.capas (capa_no, ncr_id, kind, root_cause, action_plan,
                               owner_id, due_date, status)
    VALUES (ops.next_doc_no('CAPA'), p_ncr_id, p_kind, p_root_cause,
            p_action_plan, p_owner_id, p_due_date, 'open')
    RETURNING * INTO v_capa;

    INSERT INTO quality.status_events (entity_type, entity_id, from_status,
                                       to_status, actor_id, note)
    VALUES ('capa', v_capa.capa_id, NULL, 'open', v_actor, 'CAPA raised');

    RETURN v_capa;
END;
$$;

CREATE OR REPLACE FUNCTION quality.transition_capa(
    p_capa_id             bigint,
    p_to_status           text,
    p_note                text DEFAULT NULL,
    p_root_cause          text DEFAULT NULL,
    p_effectiveness_check text DEFAULT NULL
) RETURNS quality.capas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = quality, ops AS $$
DECLARE
    v_actor bigint := ops.current_user_id();
    v_from  text;
    v_capa  quality.capas;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'not a provisioned platform user';
    END IF;
    IF NOT ops.has_any_role(ARRAY['quality','admin']) THEN
        RAISE EXCEPTION 'insufficient role to transition a CAPA';
    END IF;

    SELECT status INTO v_from FROM quality.capas WHERE capa_id = p_capa_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CAPA % not found', p_capa_id;
    END IF;

    IF NOT ( (v_from, p_to_status) IN (
                ('open','in_progress'),
                ('in_progress','pending_verification'),
                ('pending_verification','closed'),
                ('pending_verification','in_progress') ) ) THEN
        RAISE EXCEPTION 'illegal CAPA transition % -> %', v_from, p_to_status;
    END IF;

    IF p_to_status = 'closed' AND
       COALESCE(p_effectiveness_check,
                (SELECT effectiveness_check FROM quality.capas WHERE capa_id = p_capa_id)) IS NULL THEN
        RAISE EXCEPTION 'an effectiveness check is required to close a CAPA';
    END IF;

    UPDATE quality.capas
       SET status              = p_to_status,
           root_cause          = COALESCE(p_root_cause, root_cause),
           effectiveness_check = COALESCE(p_effectiveness_check, effectiveness_check),
           closed_at           = CASE WHEN p_to_status = 'closed' THEN now() ELSE closed_at END
     WHERE capa_id = p_capa_id
     RETURNING * INTO v_capa;

    INSERT INTO quality.status_events (entity_type, entity_id, from_status,
                                       to_status, actor_id, note)
    VALUES ('capa', p_capa_id, v_from, p_to_status, v_actor, p_note);

    RETURN v_capa;
END;
$$;

-- ============================================================================
-- Dashboard views (deterministic SQL only, P4/I4). security_invoker so RLS
-- on the base tables still applies to the caller.
-- ============================================================================
CREATE VIEW quality.v_ncr_ageing WITH (security_invoker = true) AS
SELECT n.ncr_id, n.ncr_no, n.source, n.severity, n.status, n.plant,
       n.raised_at,
       (CURRENT_DATE - n.raised_at::date) AS age_days
FROM   quality.ncrs n
WHERE  n.status <> 'closed';

CREATE VIEW quality.v_ncr_by_source WITH (security_invoker = true) AS
SELECT source, count(*) AS ncr_count
FROM   quality.ncrs
GROUP  BY source
ORDER  BY ncr_count DESC;

CREATE VIEW quality.v_ncr_by_severity WITH (security_invoker = true) AS
SELECT severity, count(*) AS ncr_count
FROM   quality.ncrs
GROUP  BY severity;

CREATE VIEW quality.v_capa_open WITH (security_invoker = true) AS
SELECT c.capa_id, c.capa_no, c.kind, c.status, c.due_date, c.owner_id,
       (c.due_date - CURRENT_DATE) AS days_to_due,
       (c.status <> 'closed' AND c.due_date < CURRENT_DATE) AS is_overdue
FROM   quality.capas c
WHERE  c.status <> 'closed';

CREATE VIEW quality.v_dashboard_stats WITH (security_invoker = true) AS
SELECT
    (SELECT count(*) FROM quality.ncrs  WHERE status <> 'closed')                              AS open_ncrs,
    (SELECT count(*) FROM quality.ncrs  WHERE status <> 'closed' AND severity = 'critical')    AS open_critical_ncrs,
    (SELECT count(*) FROM quality.ncrs  WHERE status = 'under_review')                         AS ncrs_under_review,
    (SELECT count(*) FROM quality.capas WHERE status <> 'closed')                              AS open_capas,
    (SELECT count(*) FROM quality.capas WHERE status <> 'closed' AND due_date < CURRENT_DATE)  AS overdue_capas;

-- ============================================================================
-- Grants + RLS
-- ============================================================================
GRANT USAGE ON SCHEMA quality TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA quality TO authenticated;   -- includes views
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA quality TO authenticated;

ALTER TABLE quality.ncrs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality.capas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality.status_events ENABLE ROW LEVEL SECURITY;

-- Reads: any provisioned member. Writes: none direct — RPCs only.
CREATE POLICY p_ncrs_read   ON quality.ncrs          FOR SELECT USING (ops.is_member());
CREATE POLICY p_capas_read  ON quality.capas         FOR SELECT USING (ops.is_member());
CREATE POLICY p_qevents_read ON quality.status_events FOR SELECT USING (ops.is_member());
