-- ============================================================================
-- 0030_yield_lot_status.sql  ·  MAX parity — scrap/yield + lot-status inquiries
-- ----------------------------------------------------------------------------
-- Both deterministic SQL (I4), security_invoker:
--   mfg.v_yield_by_order  per production order: good, scrap, yield %.
--   mfg.v_yield_by_item   aggregate per finished item.
--   mfg.v_lot_status      produced-lot register (from completions) with the
--                         producing order and downstream consumed qty (over the
--                         append-only genealogy edges, I8).
-- ============================================================================

CREATE OR REPLACE VIEW mfg.v_yield_by_order WITH (security_invoker = true) AS
SELECT po.production_order_id,
       po.order_no,
       po.item_id,
       sum(c.qty_good)  AS qty_good,
       sum(c.qty_scrap) AS qty_scrap,
       round(sum(c.qty_good) / NULLIF(sum(c.qty_good) + sum(c.qty_scrap), 0) * 100, 2) AS yield_pct,
       max(c.posted_at) AS last_posted
FROM mfg.production_orders po
JOIN mfg.completions c ON c.production_order_id = po.production_order_id
GROUP BY po.production_order_id, po.order_no, po.item_id;

CREATE OR REPLACE VIEW mfg.v_yield_by_item WITH (security_invoker = true) AS
SELECT po.item_id,
       count(DISTINCT po.production_order_id) AS orders,
       sum(c.qty_good)  AS qty_good,
       sum(c.qty_scrap) AS qty_scrap,
       round(sum(c.qty_good) / NULLIF(sum(c.qty_good) + sum(c.qty_scrap), 0) * 100, 2) AS yield_pct
FROM mfg.production_orders po
JOIN mfg.completions c ON c.production_order_id = po.production_order_id
GROUP BY po.item_id;

CREATE OR REPLACE VIEW mfg.v_lot_status WITH (security_invoker = true) AS
SELECT c.output_lot_no AS lot_no,
       po.item_id,
       po.order_no      AS produced_by,
       c.qty_good       AS produced_qty,
       c.posted_at      AS produced_at,
       COALESCE((SELECT sum(lc.qty) FROM mfg.lot_consumption lc
                 WHERE lc.consumed_lot_no = c.output_lot_no), 0) AS consumed_qty
FROM mfg.completions c
JOIN mfg.production_orders po ON po.production_order_id = c.production_order_id
WHERE c.output_lot_no IS NOT NULL;

GRANT SELECT ON mfg.v_yield_by_order TO authenticated;
GRANT SELECT ON mfg.v_yield_by_item  TO authenticated;
GRANT SELECT ON mfg.v_lot_status     TO authenticated;
