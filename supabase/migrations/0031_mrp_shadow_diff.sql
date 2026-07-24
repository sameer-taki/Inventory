-- ============================================================================
-- 0031_mrp_shadow_diff.sql  ·  MAX parity — MRP shadow-run diff (Stage 3 / G3)
-- ----------------------------------------------------------------------------
-- Parallel-run acceptance tooling (plan §8/§9). MRP runs in `shadow` mode
-- against the same live data; MAX's own recommendations are extracted into
-- max_stage.mrp_recommendations; this diffs the two per item + demand bucket and
-- lets a planner categorise every material variance (data difference / logic
-- difference / MAX bug / accepted) — the evidence the G3 gate reviews before MAX
-- planning is switched off. Deterministic SQL (I4).
--
-- Expected max_stage.mrp_recommendations payload (CONFIRM in M0):
--   { "part_no": "...", "bc_item_no": "...", "kind": "make|buy",
--     "qty": <num>, "due_date": "YYYY-MM-DD" }
-- ============================================================================

-- raw landing for MAX's MRP recommendations (same batch pattern as 0005)
CREATE TABLE IF NOT EXISTS max_stage.mrp_recommendations (
    stage_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id     bigint NOT NULL REFERENCES max_stage.extract_batches (batch_id),
    natural_key  text,
    payload      jsonb NOT NULL,
    extracted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_maxrec_batch ON max_stage.mrp_recommendations (batch_id);
ALTER TABLE max_stage.mrp_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_mrp_recommendations_read ON max_stage.mrp_recommendations;
CREATE POLICY p_mrp_recommendations_read ON max_stage.mrp_recommendations
    FOR SELECT USING (ops.has_role('admin'));
GRANT SELECT ON max_stage.mrp_recommendations TO authenticated;

-- recorded explanation/category per variance line (G3 evidence)
CREATE TABLE IF NOT EXISTS mfg.mrp_shadow_reconciliation (
    recon_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mrp_run_id  bigint NOT NULL REFERENCES mfg.mrp_runs (mrp_run_id),
    item_id     bigint NOT NULL REFERENCES ops.items (item_id),
    due_date    date NOT NULL,
    category    text NOT NULL CHECK (category IN
                ('data_difference','logic_difference','max_bug','accepted')),
    note        text,
    actor_id    bigint REFERENCES ops.users (user_id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (mrp_run_id, item_id, due_date)
);
ALTER TABLE mfg.mrp_shadow_reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_shadow_recon_read ON mfg.mrp_shadow_reconciliation;
CREATE POLICY p_shadow_recon_read ON mfg.mrp_shadow_reconciliation FOR SELECT USING (ops.is_member());
GRANT SELECT ON mfg.mrp_shadow_reconciliation TO authenticated;

-- the diff: latest succeeded shadow run vs latest recommendations batch
CREATE OR REPLACE VIEW mfg.v_mrp_shadow_diff WITH (security_invoker = true) AS
WITH latest_shadow AS (
    SELECT mrp_run_id FROM mfg.mrp_runs
    WHERE run_type = 'shadow' AND status = 'succeeded'
    ORDER BY started_at DESC LIMIT 1
),
ours AS (
    SELECT po.item_id, po.due_date, sum(po.qty) AS ours_qty
    FROM mfg.planned_orders po
    JOIN latest_shadow ls ON ls.mrp_run_id = po.mrp_run_id
    GROUP BY po.item_id, po.due_date
),
latest_rec_batch AS (
    SELECT max(batch_id) AS batch_id FROM max_stage.extract_batches WHERE entity = 'mrp_recommendations'
),
resolved_rec AS (
    SELECT COALESCE(
             (SELECT r.entity_id FROM ops.external_refs r
                WHERE r.system = 'max' AND r.entity_type = 'ops.item' AND r.external_id = m.payload->>'part_no'),
             (SELECT r.entity_id FROM ops.external_refs r
                WHERE r.system = 'bc' AND r.entity_type = 'ops.item' AND r.external_id = m.payload->>'bc_item_no'),
             (SELECT i.item_id FROM ops.items i WHERE i.item_no = m.payload->>'part_no')
           ) AS item_id,
           (m.payload->>'due_date')::date AS due_date,
           (m.payload->>'qty')::numeric   AS qty
    FROM max_stage.mrp_recommendations m
    JOIN latest_rec_batch b ON b.batch_id = m.batch_id
),
theirs AS (
    SELECT item_id, due_date, sum(qty) AS max_qty
    FROM resolved_rec
    WHERE item_id IS NOT NULL
    GROUP BY item_id, due_date
)
SELECT
    (SELECT mrp_run_id FROM latest_shadow)                    AS mrp_run_id,
    COALESCE(o.item_id, t.item_id)                            AS item_id,
    COALESCE(o.due_date, t.due_date)                          AS due_date,
    COALESCE(o.ours_qty, 0)                                   AS ours_qty,
    COALESCE(t.max_qty, 0)                                    AS max_qty,
    COALESCE(o.ours_qty, 0) - COALESCE(t.max_qty, 0)          AS variance,
    CASE
        WHEN o.item_id IS NULL THEN 'max_only'
        WHEN t.item_id IS NULL THEN 'ours_only'
        WHEN COALESCE(o.ours_qty, 0) = COALESCE(t.max_qty, 0) THEN 'match'
        ELSE 'qty_diff'
    END                                                       AS status,
    rc.category,
    rc.note
FROM ours o
FULL OUTER JOIN theirs t ON o.item_id = t.item_id AND o.due_date = t.due_date
LEFT JOIN mfg.mrp_shadow_reconciliation rc
       ON rc.mrp_run_id = (SELECT mrp_run_id FROM latest_shadow)
      AND rc.item_id = COALESCE(o.item_id, t.item_id)
      AND rc.due_date = COALESCE(o.due_date, t.due_date);

GRANT SELECT ON mfg.v_mrp_shadow_diff TO authenticated;

-- categorise a variance line against the latest shadow run (G3 sign-off)
CREATE OR REPLACE FUNCTION mfg.categorise_shadow_diff(
    p_item_id bigint, p_due_date date, p_category text, p_note text DEFAULT NULL
) RETURNS mfg.mrp_shadow_reconciliation
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_run bigint; v mfg.mrp_shadow_reconciliation;
BEGIN
    SELECT mrp_run_id INTO v_run FROM mfg.mrp_runs
     WHERE run_type = 'shadow' AND status = 'succeeded'
     ORDER BY started_at DESC LIMIT 1;
    IF v_run IS NULL THEN RAISE EXCEPTION 'no succeeded shadow run to reconcile'; END IF;

    INSERT INTO mfg.mrp_shadow_reconciliation (mrp_run_id, item_id, due_date, category, note, actor_id)
    VALUES (v_run, p_item_id, p_due_date, p_category, p_note, v_actor)
    ON CONFLICT (mrp_run_id, item_id, due_date)
        DO UPDATE SET category = EXCLUDED.category, note = EXCLUDED.note,
                      actor_id = EXCLUDED.actor_id, created_at = now()
    RETURNING * INTO v;
    PERFORM ops.log_event('mfg.shadow_reconciliation', v.recon_id, 'categorised',
                          jsonb_build_object('item_id', p_item_id, 'due_date', p_due_date, 'category', p_category));
    RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION mfg.categorise_shadow_diff(bigint, date, text, text) TO authenticated;
