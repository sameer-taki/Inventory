-- ============================================================================
-- 0021_production_costing.sql  ·  MAX parity — production cost roll-up (M2)
-- ----------------------------------------------------------------------------
-- BC Essentials is the costing master (I1); the mfg module does NOT master cost.
-- But the plan requires the module to COMPUTE cost of goods produced (§7 Option
-- B: "standard cost or rolled actual ... stamped on the output line"). To do that
-- deterministically (I4) it needs a standard unit cost per item — a read-only
-- MIRROR of BC's standard cost, cached here and (eventually) refreshed by the
-- gateway. It is never authoritative: if it disagrees with BC, BC is right.
--
--   mfg.item_cost        cached BC standard cost per item (source bc_cache|manual)
--   mfg.set_item_cost()  planner/admin upsert, logged (stopgap until gateway sync)
--   mfg.v_po_cost        per-order standard vs actual roll-up + variance
--
-- Costing method: standard-cost with quantity variance. Actual material is
-- valued at STANDARD price (real consumed qty x cached std cost) so price
-- variance stays in BC (I1); usage/efficiency variance surfaces here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mfg.item_cost (
    item_id    bigint PRIMARY KEY REFERENCES ops.items (item_id),
    std_cost   numeric(18,4) NOT NULL CHECK (std_cost >= 0),   -- per base UoM, FJD
    currency   text NOT NULL DEFAULT 'FJD',
    source     text NOT NULL DEFAULT 'bc_cache' CHECK (source IN ('bc_cache','manual')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mfg.item_cost ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_item_cost_read ON mfg.item_cost;
CREATE POLICY p_item_cost_read ON mfg.item_cost FOR SELECT USING (ops.is_member());
GRANT SELECT ON mfg.item_cost TO authenticated;

CREATE OR REPLACE FUNCTION mfg.set_item_cost(
    p_item_id bigint, p_std_cost numeric, p_source text DEFAULT 'manual'
) RETURNS mfg.item_cost
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v mfg.item_cost;
BEGIN
    INSERT INTO mfg.item_cost (item_id, std_cost, source)
    VALUES (p_item_id, p_std_cost, COALESCE(p_source, 'manual'))
    ON CONFLICT (item_id) DO UPDATE
        SET std_cost = EXCLUDED.std_cost, source = EXCLUDED.source, updated_at = now()
    RETURNING * INTO v;
    PERFORM ops.log_event('mfg.item_cost', p_item_id, 'set',
                          jsonb_build_object('std_cost', p_std_cost, 'source', COALESCE(p_source,'manual')));
    RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION mfg.set_item_cost(bigint, numeric, text) TO authenticated;

-- ── Per-order cost roll-up ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW mfg.v_po_cost WITH (security_invoker = true) AS
WITH bom_std AS (
    SELECT po.production_order_id,
           sum(bl.qty_per * (1 + bl.scrap_pct / 100.0) * COALESCE(ic.std_cost, 0)) AS std_material_per_unit,
           count(*) FILTER (WHERE ic.item_id IS NULL) AS components_without_cost
    FROM mfg.production_orders po
    JOIN mfg.bom_lines bl ON bl.bom_id = po.bom_id
    LEFT JOIN mfg.item_cost ic ON ic.item_id = bl.component_item_id
    GROUP BY po.production_order_id
),
route_std AS (
    SELECT po.production_order_id,
           sum(ro.run_minutes_per_unit * (COALESCE(wc.labour_rate,0) + COALESCE(wc.overhead_rate,0)) / 60.0) AS std_conv_per_unit,
           sum(ro.setup_minutes        * (COALESCE(wc.labour_rate,0) + COALESCE(wc.overhead_rate,0)) / 60.0) AS std_setup_cost
    FROM mfg.production_orders po
    JOIN mfg.routing_operations ro ON ro.routing_id = po.routing_id
    JOIN mfg.work_centres wc ON wc.work_centre_id = ro.work_centre_id
    GROUP BY po.production_order_id
),
act_mat AS (
    SELECT c.production_order_id,
           sum(mc.qty * COALESCE(ic.std_cost, 0)) AS actual_material_cost
    FROM mfg.completions c
    JOIN mfg.material_consumption mc ON mc.completion_id = c.completion_id
    LEFT JOIN mfg.item_cost ic ON ic.item_id = mc.component_item_id
    GROUP BY c.production_order_id
),
act_lab AS (
    SELECT le.production_order_id,
           sum(le.minutes * (COALESCE(wc.labour_rate,0) + COALESCE(wc.overhead_rate,0)) / 60.0) AS actual_labour_cost
    FROM mfg.labour_entries le
    JOIN mfg.work_centres wc ON wc.work_centre_id = le.work_centre_id
    GROUP BY le.production_order_id
)
SELECT
    po.production_order_id,
    po.order_no,
    po.item_id,
    po.status,
    po.qty_ordered,
    po.qty_completed,
    COALESCE(bs.components_without_cost, 0)                                          AS components_without_cost,
    round(COALESCE(bs.std_material_per_unit, 0), 4)                                  AS std_material_per_unit,
    round(COALESCE(rs.std_conv_per_unit, 0), 4)                                      AS std_conv_per_unit,
    round(COALESCE(bs.std_material_per_unit, 0) + COALESCE(rs.std_conv_per_unit, 0), 4) AS std_cost_per_unit,
    round((COALESCE(bs.std_material_per_unit, 0) + COALESCE(rs.std_conv_per_unit, 0)) * po.qty_completed
          + COALESCE(rs.std_setup_cost, 0), 2)                                       AS earned_standard_cost,
    round(COALESCE(am.actual_material_cost, 0), 2)                                   AS actual_material_cost,
    round(COALESCE(al.actual_labour_cost, 0), 2)                                     AS actual_labour_cost,
    round(COALESCE(am.actual_material_cost, 0) + COALESCE(al.actual_labour_cost, 0), 2) AS actual_total_cost,
    round(COALESCE(am.actual_material_cost, 0) + COALESCE(al.actual_labour_cost, 0)
          - ((COALESCE(bs.std_material_per_unit, 0) + COALESCE(rs.std_conv_per_unit, 0)) * po.qty_completed
             + COALESCE(rs.std_setup_cost, 0)), 2)                                   AS variance_fjd
FROM mfg.production_orders po
LEFT JOIN bom_std   bs ON bs.production_order_id = po.production_order_id
LEFT JOIN route_std rs ON rs.production_order_id = po.production_order_id
LEFT JOIN act_mat   am ON am.production_order_id = po.production_order_id
LEFT JOIN act_lab   al ON al.production_order_id = po.production_order_id;

GRANT SELECT ON mfg.v_po_cost TO authenticated;
