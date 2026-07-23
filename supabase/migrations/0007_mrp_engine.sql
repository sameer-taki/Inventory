-- ============================================================================
-- 0007_mrp_engine.sql  ·  MAX plan M4 (E-MAX4) — MPS + MRP netting engine
-- ----------------------------------------------------------------------------
-- "Boring, textbook, deterministic MRP — no cleverness" (MAX plan §8). All math
-- is SQL (I4). The engine is regenerative: each run reads a stamped snapshot and
-- writes a fresh, immutable set of planned_orders + action_messages against its
-- mrp_run_id; nothing from a prior run is mutated.
--
-- Inputs:  MPS demand (mfg.mps_entries) + dependent demand from parent explosion;
--          on-hand (mfg.inventory_snapshots, BC-sourced), scheduled receipts
--          (mfg.bc_open_pos + open production orders); approved BOMs (LLC-coded);
--          per-item planning_params (lead time, safety stock, lot policy).
-- Output:  planned make orders (planner firms → production order), planned buy
--          orders (handed to procurement, D-5), and action messages.
-- ============================================================================

-- BC-sourced planning snapshots (written by the gateway sync; freshness SLA D-7).
CREATE TABLE mfg.inventory_snapshots (
    snapshot_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id      bigint NOT NULL REFERENCES ops.items (item_id),
    plant        text,
    on_hand      numeric(18,4) NOT NULL DEFAULT 0,
    snapshot_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_invsnap_item ON mfg.inventory_snapshots (item_id, snapshot_at DESC);

CREATE TABLE mfg.bc_open_pos (
    po_line_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id      bigint NOT NULL REFERENCES ops.items (item_id),
    qty          numeric(18,4) NOT NULL,
    due_date     date NOT NULL,
    bc_doc_no    text,
    snapshot_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_bcpo_item ON mfg.bc_open_pos (item_id, due_date);

ALTER TABLE mfg.inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfg.bc_open_pos ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_invsnap_read ON mfg.inventory_snapshots FOR SELECT USING (ops.is_member());
CREATE POLICY p_bcpo_read    ON mfg.bc_open_pos          FOR SELECT USING (ops.is_member());
GRANT SELECT ON mfg.inventory_snapshots, mfg.bc_open_pos TO authenticated;

-- ─── low-level codes: max BOM depth at which each item appears (I4) ─────────
CREATE OR REPLACE FUNCTION mfg.recompute_low_level_codes() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
BEGIN
    UPDATE mfg.planning_params SET low_level_code = 0;

    WITH RECURSIVE g(item_id, depth) AS (
        SELECT l.component_item_id, 1
        FROM mfg.boms b JOIN mfg.bom_lines l ON l.bom_id = b.bom_id
        WHERE b.status = 'approved'
        UNION ALL
        SELECT l.component_item_id, g.depth + 1
        FROM g
        JOIN mfg.boms b ON b.item_id = g.item_id AND b.status = 'approved'
        JOIN mfg.bom_lines l ON l.bom_id = b.bom_id
        WHERE g.depth < 50
    )
    UPDATE mfg.planning_params p
       SET low_level_code = x.llc
    FROM (SELECT item_id, max(depth) AS llc FROM g GROUP BY item_id) x
    WHERE p.item_id = x.item_id;
END;
$$;

-- ─── the engine ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mfg.run_mrp(
    p_snapshot_at timestamptz DEFAULT now(),
    p_horizon_days int DEFAULT 120,
    p_run_type text DEFAULT 'regenerative'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE
    v_actor   bigint := ops.require_roles(ARRAY['planner','admin']);
    v_run_id  bigint;
    v_llc int; v_max_llc int;
    r_item record; ev record;
    v_onhand numeric; v_balance numeric; v_short numeric; v_planqty numeric;
    v_horizon date := p_snapshot_at::date + p_horizon_days;
BEGIN
    PERFORM mfg.recompute_low_level_codes();

    INSERT INTO mfg.mrp_runs (run_type, snapshot_at, status, params_hash)
    VALUES (p_run_type, p_snapshot_at, 'running',
            md5(p_snapshot_at::text || ':' || p_horizon_days::text || ':' || p_run_type))
    RETURNING mrp_run_id INTO v_run_id;

    CREATE TEMP TABLE tmp_gr (item_id bigint, due_date date, qty numeric) ON COMMIT DROP;

    -- independent demand: MPS firm + forecast, due at bucket_start
    INSERT INTO tmp_gr (item_id, due_date, qty)
    SELECT item_id, bucket_start, qty
    FROM mfg.mps_entries
    WHERE bucket_start <= v_horizon AND qty > 0;

    SELECT COALESCE(max(low_level_code), 0) INTO v_max_llc FROM mfg.planning_params;

    -- process level by level so a parent's explosion lands as child demand
    -- BEFORE the child level is planned
    FOR v_llc IN 0..v_max_llc LOOP
        FOR r_item IN
            SELECT pp.item_id, pp.safety_stock, pp.lead_time_days, pp.lot_policy,
                   pp.fixed_or_min_qty, pp.order_multiple, pp.make_or_buy
            FROM mfg.planning_params pp
            WHERE pp.low_level_code = v_llc
              AND EXISTS (SELECT 1 FROM tmp_gr g WHERE g.item_id = pp.item_id)
        LOOP
            SELECT COALESCE((SELECT on_hand FROM mfg.inventory_snapshots s
                             WHERE s.item_id = r_item.item_id AND s.snapshot_at <= p_snapshot_at
                             ORDER BY s.snapshot_at DESC LIMIT 1), 0)
              INTO v_onhand;
            v_balance := v_onhand - r_item.safety_stock;

            -- chronological event walk: receipts (+) applied before demands (-)
            FOR ev IN
                SELECT due_date, qty, 1 AS is_receipt FROM mfg.bc_open_pos
                    WHERE item_id = r_item.item_id AND due_date <= v_horizon
                UNION ALL
                SELECT due_date, (qty_ordered - qty_completed), 1 FROM mfg.production_orders
                    WHERE item_id = r_item.item_id
                      AND status IN ('firm','released','in_progress')
                      AND due_date <= v_horizon
                UNION ALL
                SELECT due_date, qty, 0 FROM tmp_gr WHERE item_id = r_item.item_id
                ORDER BY due_date, is_receipt DESC
            LOOP
                IF ev.is_receipt = 1 THEN
                    v_balance := v_balance + ev.qty;
                ELSE
                    IF v_balance < ev.qty THEN
                        v_short := ev.qty - v_balance;
                        v_planqty := CASE r_item.lot_policy
                            WHEN 'fixed_qty' THEN
                                ceil(v_short / NULLIF(r_item.fixed_or_min_qty, 0)) * r_item.fixed_or_min_qty
                            WHEN 'min_multiple' THEN
                                GREATEST(COALESCE(r_item.fixed_or_min_qty, 0),
                                         ceil(v_short / NULLIF(r_item.order_multiple, 0)) * r_item.order_multiple)
                            ELSE v_short
                        END;

                        INSERT INTO mfg.planned_orders (mrp_run_id, item_id, kind, qty, due_date,
                                                        release_date, status, pegging)
                        VALUES (v_run_id, r_item.item_id, r_item.make_or_buy, v_planqty, ev.due_date,
                                ev.due_date - r_item.lead_time_days, 'suggested',
                                jsonb_build_object('for_demand_date', ev.due_date, 'shortage', v_short));

                        v_balance := v_balance + v_planqty;

                        -- explode make orders to component demand at release date
                        IF r_item.make_or_buy = 'make' THEN
                            INSERT INTO tmp_gr (item_id, due_date, qty)
                            SELECT l.component_item_id,
                                   (ev.due_date - r_item.lead_time_days),
                                   v_planqty * l.qty_per * (1 + l.scrap_pct / 100.0)
                            FROM mfg.boms b JOIN mfg.bom_lines l ON l.bom_id = b.bom_id
                            WHERE b.item_id = r_item.item_id AND b.status = 'approved'
                              AND COALESCE(l.is_phantom, false) = false;
                        END IF;
                    END IF;
                    v_balance := v_balance - ev.qty;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    -- action messages: an open BC PO that arrives after a shortage need-date
    INSERT INTO mfg.action_messages (mrp_run_id, kind, target_type, target_ref, detail, status)
    SELECT DISTINCT v_run_id, 'expedite', 'purchase_order',
           COALESCE(p.bc_doc_no, p.po_line_id::text),
           jsonb_build_object('item_id', po.item_id, 'need_by', po.due_date, 'po_due', p.due_date),
           'open'
    FROM mfg.planned_orders po
    JOIN mfg.bc_open_pos p ON p.item_id = po.item_id AND p.due_date > po.due_date
    WHERE po.mrp_run_id = v_run_id AND po.kind = 'buy';

    UPDATE mfg.mrp_runs SET status = 'succeeded', finished_at = now() WHERE mrp_run_id = v_run_id;
    PERFORM ops.log_event('mfg.mrp_run', v_run_id, 'succeeded',
        jsonb_build_object('planned_orders',
            (SELECT count(*) FROM mfg.planned_orders WHERE mrp_run_id = v_run_id),
            'action_messages',
            (SELECT count(*) FROM mfg.action_messages WHERE mrp_run_id = v_run_id)));
    RETURN v_run_id;
END;
$$;

-- ─── planner handoff (D-5): firm a make order → production order; buy → procurement
CREATE OR REPLACE FUNCTION mfg.firm_planned_order(p_planned_order_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE
    v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
    v_po mfg.planned_orders; v_bom_id bigint; v_routing_id bigint; v_uom text; v_plant text; v_new mfg.production_orders;
BEGIN
    SELECT * INTO v_po FROM mfg.planned_orders WHERE planned_order_id = p_planned_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'planned order % not found', p_planned_order_id; END IF;
    IF v_po.status <> 'suggested' THEN RAISE EXCEPTION 'planned order already %', v_po.status; END IF;

    IF v_po.kind = 'make' THEN
        SELECT bom_id INTO v_bom_id FROM mfg.boms
          WHERE item_id = v_po.item_id AND status = 'approved' ORDER BY version_no DESC LIMIT 1;
        IF v_bom_id IS NULL THEN RAISE EXCEPTION 'no approved BOM for item % — cannot firm', v_po.item_id; END IF;
        SELECT routing_id INTO v_routing_id FROM mfg.routings
          WHERE item_id = v_po.item_id AND status = 'approved' ORDER BY version_no DESC LIMIT 1;
        SELECT COALESCE(base_uom,'EA') INTO v_uom FROM ops.items WHERE item_id = v_po.item_id;

        v_new := mfg.create_production_order(v_po.item_id, v_bom_id, 'Molded Fibre', v_po.qty,
                    v_uom, v_po.due_date, v_routing_id, 'mrp', p_planned_order_id);
        UPDATE mfg.planned_orders SET status = 'firmed' WHERE planned_order_id = p_planned_order_id;
        PERFORM ops.log_event('mfg.planned_order', p_planned_order_id, 'firmed',
                              jsonb_build_object('production_order', v_new.order_no));
        RETURN v_new.order_no;
    ELSE
        UPDATE mfg.planned_orders SET status = 'handed_off' WHERE planned_order_id = p_planned_order_id;
        PERFORM ops.log_event('mfg.planned_order', p_planned_order_id, 'handed_off',
                              jsonb_build_object('to', 'procurement_app', 'qty', v_po.qty));
        RETURN 'handed_off_to_procurement';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION mfg.recompute_low_level_codes() TO authenticated;
GRANT EXECUTE ON FUNCTION mfg.run_mrp(timestamptz, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mfg.firm_planned_order(bigint) TO authenticated;
