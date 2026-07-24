-- ============================================================================
-- 0029_inventory_inquiry.sql  ·  MAX parity — inventory status inquiry
-- ----------------------------------------------------------------------------
-- mfg.v_inventory: per-item stock status — on-hand (latest BC snapshot),
-- on-order (scheduled receipts: open production orders + BC open POs), allocated
-- (component demand from released/in-progress orders) and available
-- (on-hand − allocated). BC stays the inventory master (I1); this is a read-only
-- planning snapshot, not a balance of record. Deterministic SQL (I4).
-- ============================================================================

CREATE OR REPLACE VIEW mfg.v_inventory WITH (security_invoker = true) AS
WITH oh AS (
    SELECT DISTINCT ON (item_id) item_id, on_hand, snapshot_at
    FROM mfg.inventory_snapshots
    ORDER BY item_id, snapshot_at DESC
),
on_order AS (
    SELECT item_id, sum(rem) AS on_order FROM (
        SELECT item_id, (qty_ordered - qty_completed) AS rem
        FROM mfg.production_orders
        WHERE status IN ('firm','released','in_progress') AND (qty_ordered - qty_completed) > 0
        UNION ALL
        SELECT item_id, qty FROM mfg.bc_open_pos
    ) x GROUP BY item_id
),
alloc AS (
    SELECT bl.component_item_id AS item_id,
           sum((po.qty_ordered - po.qty_completed) * bl.qty_per * (1 + bl.scrap_pct / 100.0)) AS allocated
    FROM mfg.production_orders po
    JOIN mfg.bom_lines bl ON bl.bom_id = po.bom_id
    WHERE po.status IN ('released','in_progress') AND (po.qty_ordered - po.qty_completed) > 0
    GROUP BY bl.component_item_id
)
SELECT
    i.item_id,
    i.item_no,
    i.description,
    COALESCE(oh.on_hand, 0)                                  AS on_hand,
    COALESCE(oo.on_order, 0)                                 AS on_order,
    round(COALESCE(a.allocated, 0), 4)                       AS allocated,
    round(COALESCE(oh.on_hand, 0) - COALESCE(a.allocated, 0), 4) AS available,
    oh.snapshot_at
FROM ops.items i
LEFT JOIN oh       ON oh.item_id = i.item_id
LEFT JOIN on_order oo ON oo.item_id = i.item_id
LEFT JOIN alloc    a  ON a.item_id = i.item_id
WHERE i.is_active;

GRANT SELECT ON mfg.v_inventory TO authenticated;
