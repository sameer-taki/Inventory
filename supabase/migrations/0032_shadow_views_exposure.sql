-- ============================================================================
-- 0032_shadow_views_exposure.sql  ·  expose shadow-diff safely to the app
-- ----------------------------------------------------------------------------
-- max_stage is admin-only and NOT exposed to the Data API, so the app can't read
-- it directly and a security_invoker view would hide the MAX side from non-admin
-- planners. Recreate the shadow views WITHOUT security_invoker — owner-privileged
-- (postgres) so they are a controlled mfg-schema window over the admin-only
-- staging — and add a single-row status view for the page header. Access is
-- gated at the page level (planner/admin). Numbers stay deterministic (I4).
-- ============================================================================

CREATE OR REPLACE VIEW mfg.v_mrp_shadow_diff AS
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

CREATE OR REPLACE VIEW mfg.v_mrp_shadow_status AS
SELECT
    (SELECT mrp_run_id  FROM mfg.mrp_runs WHERE run_type='shadow' AND status='succeeded' ORDER BY started_at DESC LIMIT 1) AS shadow_run_id,
    (SELECT snapshot_at FROM mfg.mrp_runs WHERE run_type='shadow' AND status='succeeded' ORDER BY started_at DESC LIMIT 1) AS shadow_snapshot_at,
    (SELECT batch_id        FROM max_stage.extract_batches WHERE entity='mrp_recommendations' ORDER BY batch_id DESC LIMIT 1) AS rec_batch_id,
    (SELECT source_rowcount FROM max_stage.extract_batches WHERE entity='mrp_recommendations' ORDER BY batch_id DESC LIMIT 1) AS rec_rowcount,
    (SELECT extracted_at    FROM max_stage.extract_batches WHERE entity='mrp_recommendations' ORDER BY batch_id DESC LIMIT 1) AS rec_extracted_at;

GRANT SELECT ON mfg.v_mrp_shadow_status TO authenticated;
