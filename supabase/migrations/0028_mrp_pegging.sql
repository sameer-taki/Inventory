-- ============================================================================
-- 0028_mrp_pegging.sql  ·  MAX parity — MRP pegging (M4)
-- ----------------------------------------------------------------------------
-- Pegging answers "why does this planned order exist?" — it links each planned
-- order to the demand that triggered it: an MPS entry (independent demand) or a
-- parent planned order's component explosion (dependent demand). Chained, that
-- reconstructs the full MPS → make-order → component-order tree MAX shows.
--
-- The engine already knew the source at explosion time; this threads it through
-- the gross-requirement working set into mfg.mrp_pegging. Netting math is
-- unchanged (I4) — only source bookkeeping is added.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mfg.mrp_pegging (
    pegging_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mrp_run_id       bigint NOT NULL REFERENCES mfg.mrp_runs (mrp_run_id),
    planned_order_id bigint NOT NULL REFERENCES mfg.planned_orders (planned_order_id),
    demand_date      date NOT NULL,
    demand_qty       numeric(18,4) NOT NULL,
    source_type      text NOT NULL CHECK (source_type IN ('mps','planned_order')),
    source_ref       bigint                       -- mps_id, or the parent planned_order_id
);
CREATE INDEX IF NOT EXISTS ix_mrp_pegging_run ON mfg.mrp_pegging (mrp_run_id, planned_order_id);
ALTER TABLE mfg.mrp_pegging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_mrp_pegging_read ON mfg.mrp_pegging;
CREATE POLICY p_mrp_pegging_read ON mfg.mrp_pegging FOR SELECT USING (ops.is_member());
GRANT SELECT ON mfg.mrp_pegging TO authenticated;

-- resolved pegging: adds the parent item for planned-order sources
CREATE OR REPLACE VIEW mfg.v_pegging WITH (security_invoker = true) AS
SELECT pg.mrp_run_id,
       pg.planned_order_id,
       pg.demand_date,
       pg.demand_qty,
       pg.source_type,
       pg.source_ref,
       parent.item_id AS parent_item_id
FROM mfg.mrp_pegging pg
LEFT JOIN mfg.planned_orders parent
       ON pg.source_type = 'planned_order' AND parent.planned_order_id = pg.source_ref;

-- ─── engine, re-created with pegging bookkeeping ─────────────────────────────
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
    v_seq int; v_plan_id bigint;
    v_horizon date := p_snapshot_at::date + p_horizon_days;
BEGIN
    PERFORM mfg.recompute_low_level_codes();

    INSERT INTO mfg.mrp_runs (run_type, snapshot_at, status, params_hash)
    VALUES (p_run_type, p_snapshot_at, 'running',
            md5(p_snapshot_at::text || ':' || p_horizon_days::text || ':' || p_run_type))
    RETURNING mrp_run_id INTO v_run_id;

    -- gross requirements working set now carries its demand source (for pegging)
    CREATE TEMP TABLE tmp_gr (item_id bigint, due_date date, qty numeric,
                              source_type text, source_ref bigint) ON COMMIT DROP;

    INSERT INTO tmp_gr (item_id, due_date, qty, source_type, source_ref)
    SELECT item_id, bucket_start, qty, 'mps', mps_id
    FROM mfg.mps_entries
    WHERE bucket_start <= v_horizon AND qty > 0;

    SELECT COALESCE(max(low_level_code), 0) INTO v_max_llc FROM mfg.planning_params;

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

            v_seq := 1;
            INSERT INTO mfg.mrp_projection (mrp_run_id, item_id, seq, bucket_date, event_type, qty, projected_available)
            VALUES (v_run_id, r_item.item_id, v_seq, p_snapshot_at::date, 'opening', v_balance, v_balance);

            FOR ev IN
                SELECT due_date, qty, 1 AS is_receipt, NULL::text AS source_type, NULL::bigint AS source_ref
                    FROM mfg.bc_open_pos
                    WHERE item_id = r_item.item_id AND due_date <= v_horizon
                UNION ALL
                SELECT due_date, (qty_ordered - qty_completed), 1, NULL::text, NULL::bigint
                    FROM mfg.production_orders
                    WHERE item_id = r_item.item_id
                      AND status IN ('firm','released','in_progress')
                      AND due_date <= v_horizon
                UNION ALL
                SELECT due_date, qty, 0, source_type, source_ref FROM tmp_gr WHERE item_id = r_item.item_id
                ORDER BY due_date, is_receipt DESC
            LOOP
                IF ev.is_receipt = 1 THEN
                    v_balance := v_balance + ev.qty;
                    v_seq := v_seq + 1;
                    INSERT INTO mfg.mrp_projection (mrp_run_id, item_id, seq, bucket_date, event_type, qty, projected_available)
                    VALUES (v_run_id, r_item.item_id, v_seq, ev.due_date, 'scheduled_receipt', ev.qty, v_balance);
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
                                jsonb_build_object('for_demand_date', ev.due_date, 'shortage', v_short))
                        RETURNING planned_order_id INTO v_plan_id;

                        -- peg this planned order to the demand that triggered it
                        INSERT INTO mfg.mrp_pegging (mrp_run_id, planned_order_id, demand_date, demand_qty,
                                                     source_type, source_ref)
                        VALUES (v_run_id, v_plan_id, ev.due_date, ev.qty,
                                COALESCE(ev.source_type, 'mps'), ev.source_ref);

                        v_balance := v_balance + v_planqty;
                        v_seq := v_seq + 1;
                        INSERT INTO mfg.mrp_projection (mrp_run_id, item_id, seq, bucket_date, event_type, qty, projected_available)
                        VALUES (v_run_id, r_item.item_id, v_seq, ev.due_date, 'planned_receipt', v_planqty, v_balance);

                        -- explode make orders to component demand, pegged to THIS planned order
                        IF r_item.make_or_buy = 'make' THEN
                            INSERT INTO tmp_gr (item_id, due_date, qty, source_type, source_ref)
                            SELECT l.component_item_id,
                                   (ev.due_date - r_item.lead_time_days),
                                   v_planqty * l.qty_per * (1 + l.scrap_pct / 100.0),
                                   'planned_order', v_plan_id
                            FROM mfg.boms b JOIN mfg.bom_lines l ON l.bom_id = b.bom_id
                            WHERE b.item_id = r_item.item_id AND b.status = 'approved'
                              AND COALESCE(l.is_phantom, false) = false;
                        END IF;
                    END IF;
                    v_balance := v_balance - ev.qty;
                    v_seq := v_seq + 1;
                    INSERT INTO mfg.mrp_projection (mrp_run_id, item_id, seq, bucket_date, event_type, qty, projected_available)
                    VALUES (v_run_id, r_item.item_id, v_seq, ev.due_date, 'gross_req', -ev.qty, v_balance);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

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
