-- ============================================================================
-- 0027_where_used_shortage.sql  ·  MAX parity — where-used + shortage inquiries
-- ----------------------------------------------------------------------------
-- Two standard MAX inquiries, both deterministic SQL (I4), security_invoker:
--   mfg.v_where_used         inverse BOM — every parent/assembly a component
--                            feeds, direct and indirect, with level (the recall
--                            direction for engineering / obsolescence).
--   mfg.v_component_shortage required component qty across released/in-progress
--                            production orders vs latest on-hand snapshot, with
--                            the shortfall. BC stays the inventory master (I1);
--                            on-hand is the BC-sourced snapshot.
-- ============================================================================

CREATE OR REPLACE VIEW mfg.v_where_used WITH (security_invoker = true) AS
WITH RECURSIVE wu AS (
    SELECT l.component_item_id AS item_id,
           b.item_id           AS parent_item_id,
           1                   AS level,
           l.qty_per
    FROM mfg.boms b
    JOIN mfg.bom_lines l ON l.bom_id = b.bom_id
    WHERE b.status = 'approved'
    UNION ALL
    SELECT wu.item_id,
           b.item_id,
           wu.level + 1,
           l.qty_per
    FROM wu
    JOIN mfg.boms b      ON b.status = 'approved'
    JOIN mfg.bom_lines l ON l.bom_id = b.bom_id AND l.component_item_id = wu.parent_item_id
    WHERE wu.level < 50
)
SELECT item_id, parent_item_id, level, qty_per FROM wu;

CREATE OR REPLACE VIEW mfg.v_component_shortage WITH (security_invoker = true) AS
WITH req AS (
    SELECT bl.component_item_id AS item_id,
           sum((po.qty_ordered - po.qty_completed) * bl.qty_per * (1 + bl.scrap_pct / 100.0)) AS required_qty,
           count(DISTINCT po.production_order_id) AS open_orders
    FROM mfg.production_orders po
    JOIN mfg.bom_lines bl ON bl.bom_id = po.bom_id
    WHERE po.status IN ('released','in_progress')
      AND (po.qty_ordered - po.qty_completed) > 0
    GROUP BY bl.component_item_id
),
oh AS (
    SELECT DISTINCT ON (item_id) item_id, on_hand
    FROM mfg.inventory_snapshots
    ORDER BY item_id, snapshot_at DESC
)
SELECT r.item_id,
       round(r.required_qty, 4)                                          AS required_qty,
       COALESCE(oh.on_hand, 0)                                           AS on_hand,
       round(GREATEST(0, r.required_qty - COALESCE(oh.on_hand, 0)), 4)   AS short_qty,
       r.open_orders
FROM req r
LEFT JOIN oh ON oh.item_id = r.item_id;

GRANT SELECT ON mfg.v_where_used TO authenticated;
GRANT SELECT ON mfg.v_component_shortage TO authenticated;
