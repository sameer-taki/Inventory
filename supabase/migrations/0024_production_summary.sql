-- ============================================================================
-- 0024_production_summary.sql  ·  MAX parity — live production overview roll-up
-- ----------------------------------------------------------------------------
-- mfg.v_production_summary: single-row headline for the manufacturing overview —
-- order counts by state, WIP cost booked on open orders, and total cost variance
-- across orders with output. Deterministic SQL (I4) over mfg.v_po_cost; money is
-- management-view only (BC stays the financial master, I1). security_invoker
-- keeps member RLS.
-- ============================================================================

CREATE OR REPLACE VIEW mfg.v_production_summary WITH (security_invoker = true) AS
SELECT
    count(*) FILTER (WHERE po.status IN ('planned','firm','released','in_progress')) AS open_orders,
    count(*) FILTER (WHERE po.status = 'released')                                   AS released_orders,
    count(*) FILTER (WHERE po.status = 'in_progress')                                AS in_progress_orders,
    count(*) FILTER (WHERE po.status IN ('completed','closed'))                       AS completed_orders,
    coalesce(sum(c.actual_total_cost)
             FILTER (WHERE po.status IN ('released','in_progress')), 0)               AS wip_actual_cost,
    coalesce(sum(c.variance_fjd) FILTER (WHERE po.qty_completed > 0), 0)              AS total_variance_fjd
FROM mfg.production_orders po
LEFT JOIN mfg.v_po_cost c ON c.production_order_id = po.production_order_id;

GRANT SELECT ON mfg.v_production_summary TO authenticated;
