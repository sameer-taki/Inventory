-- ============================================================================
-- 0005_max_stage.sql  ·  MAX plan §7 / §10 (E-MAX0, E-MAX7) · master module 13
-- ----------------------------------------------------------------------------
-- Temporary landing schema for the MAX migration. Raw 1:1 copies of the MAX
-- tables in scope, read via the read-only `max_ro` login into re-runnable,
-- idempotent staging. NO transformation happens in this schema (MAX plan §10).
-- The exact MAX column shapes are discovered in M0; until then each entity
-- lands its source row as jsonb plus batch metadata, which keeps the loader
-- re-runnable before the discovered columns are pinned.
--
-- This schema and the `max_ro` login are DROPPED after decommission (Stage 4).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS max_stage;

-- One row per extraction batch (per entity), for validation + rowcount checks.
CREATE TABLE max_stage.extract_batches (
    batch_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity          text NOT NULL,
    extracted_at    timestamptz NOT NULL DEFAULT now(),
    source_rowcount int,
    loaded_rowcount int,
    note            text
);

-- Raw landing tables for the in-scope MAX entities (MAX plan §7 comment):
--   parts · boms · routings · work_centres · open_production_orders ·
--   wip_balances · lot_history · planner_params
DO $$
DECLARE e text;
BEGIN
  FOR e IN
    SELECT unnest(ARRAY['parts','boms','routings','work_centres',
                        'open_production_orders','wip_balances',
                        'lot_history','planner_params'])
  LOOP
    EXECUTE format($f$
      CREATE TABLE max_stage.%I (
        stage_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        batch_id     bigint NOT NULL REFERENCES max_stage.extract_batches (batch_id),
        natural_key  text,            -- MAX primary/business key, once discovered
        payload      jsonb NOT NULL,  -- the raw MAX row, verbatim (no transformation)
        extracted_at timestamptz NOT NULL DEFAULT now()
      );$f$, e);
    EXECUTE format('CREATE INDEX ix_%s_natkey ON max_stage.%I (natural_key);', e, e);
  END LOOP;
END $$;

-- ─── Grants + RLS (admin only — migration data is sensitive) ────────────────
GRANT USAGE ON SCHEMA max_stage TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA max_stage TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'max_stage'
  LOOP
    EXECUTE format('ALTER TABLE max_stage.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY p_%s_read ON max_stage.%I FOR SELECT USING (ops.has_role(''admin''));', t, t);
  END LOOP;
END $$;
