-- ============================================================================
-- 0006_mfg_rpcs.sql  ·  MAX plan M3 (masters) + M2 (production execution)
-- ----------------------------------------------------------------------------
-- Write-path RPCs for manufacturing. Same single-writer discipline as quality:
-- every mutation is a SECURITY DEFINER function that also logs an event; there
-- are no direct write policies on the mfg tables.
--
--   M3  work centres, BOMs (versioned + approval), routings
--   M2  production orders (lifecycle), completions → BC outbox (D-3), genealogy
--
-- Invariants enforced here: I2 (outbox, idempotency key), I8 (append-only
-- genealogy edges), I10 (no BC posting without external_refs item mapping).
-- ============================================================================

-- generic event helper (actor resolved from the session)
CREATE OR REPLACE FUNCTION ops.log_event(
    p_entity_type text, p_entity_id bigint, p_event_type text, p_detail jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ops AS $$
    INSERT INTO ops.event_log (entity_type, entity_id, event_type, actor_id, detail)
    VALUES (p_entity_type, p_entity_id, p_event_type, ops.current_user_id(), p_detail);
$$;

CREATE OR REPLACE FUNCTION ops.require_roles(p_roles text[])
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ops AS $$
DECLARE v_actor bigint := ops.current_user_id();
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'not a provisioned platform user'; END IF;
    IF NOT ops.has_any_role(p_roles) THEN
        RAISE EXCEPTION 'insufficient role (need one of %)', array_to_string(p_roles, ', ');
    END IF;
    RETURN v_actor;
END;
$$;

-- ─── M3: work centres ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mfg.save_work_centre(
    p_code text, p_name text, p_plant text,
    p_daily_capacity numeric DEFAULT 0, p_efficiency_pct numeric DEFAULT 100,
    p_labour_rate numeric DEFAULT NULL, p_overhead_rate numeric DEFAULT NULL,
    p_work_centre_id bigint DEFAULT NULL
) RETURNS mfg.work_centres
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','supervisor','admin']);
        v_wc mfg.work_centres;
BEGIN
    IF p_work_centre_id IS NULL THEN
        INSERT INTO mfg.work_centres (code, name, plant, daily_capacity, efficiency_pct, labour_rate, overhead_rate)
        VALUES (p_code, p_name, p_plant, p_daily_capacity, p_efficiency_pct, p_labour_rate, p_overhead_rate)
        RETURNING * INTO v_wc;
        PERFORM ops.log_event('mfg.work_centre', v_wc.work_centre_id, 'created', jsonb_build_object('code', p_code));
    ELSE
        UPDATE mfg.work_centres
           SET code=p_code, name=p_name, plant=p_plant, daily_capacity=p_daily_capacity,
               efficiency_pct=p_efficiency_pct, labour_rate=p_labour_rate, overhead_rate=p_overhead_rate
         WHERE work_centre_id = p_work_centre_id
         RETURNING * INTO v_wc;
        IF NOT FOUND THEN RAISE EXCEPTION 'work centre % not found', p_work_centre_id; END IF;
        PERFORM ops.log_event('mfg.work_centre', v_wc.work_centre_id, 'updated', jsonb_build_object('code', p_code));
    END IF;
    RETURN v_wc;
END;
$$;

-- ─── M3: BOMs (versioned, approval, ECO-lite) ───────────────────────────────
-- p_lines: jsonb array of {component_item_id, qty_per, uom, scrap_pct?, is_phantom?, operation_seq?}
CREATE OR REPLACE FUNCTION mfg.create_bom(
    p_item_id bigint, p_effective_from date, p_lines jsonb, p_effective_to date DEFAULT NULL
) RETURNS mfg.boms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_bom mfg.boms;
        v_ver int;
BEGIN
    SELECT COALESCE(max(version_no), 0) + 1 INTO v_ver FROM mfg.boms WHERE item_id = p_item_id;
    INSERT INTO mfg.boms (item_id, version_no, status, effective_from, effective_to, source)
    VALUES (p_item_id, v_ver, 'draft', p_effective_from, p_effective_to, 'manual')
    RETURNING * INTO v_bom;

    INSERT INTO mfg.bom_lines (bom_id, line_no, component_item_id, qty_per, uom, scrap_pct, is_phantom, operation_seq)
    SELECT v_bom.bom_id,
           row_number() OVER ()::int,
           (e->>'component_item_id')::bigint,
           (e->>'qty_per')::numeric,
           e->>'uom',
           COALESCE((e->>'scrap_pct')::numeric, 0),
           COALESCE((e->>'is_phantom')::boolean, false),
           NULLIF(e->>'operation_seq', '')::int
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) e;

    PERFORM ops.log_event('mfg.bom', v_bom.bom_id, 'created',
                          jsonb_build_object('item_id', p_item_id, 'version', v_ver));
    RETURN v_bom;
END;
$$;

CREATE OR REPLACE FUNCTION mfg.approve_bom(p_bom_id bigint) RETURNS mfg.boms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_bom mfg.boms;
BEGIN
    SELECT * INTO v_bom FROM mfg.boms WHERE bom_id = p_bom_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOM % not found', p_bom_id; END IF;
    IF v_bom.status <> 'draft' THEN RAISE EXCEPTION 'only a draft BOM can be approved (is %)', v_bom.status; END IF;

    -- supersede the currently approved version of this item
    UPDATE mfg.boms
       SET status = 'superseded', effective_to = COALESCE(effective_to, CURRENT_DATE)
     WHERE item_id = v_bom.item_id AND status = 'approved' AND bom_id <> p_bom_id;

    UPDATE mfg.boms
       SET status = 'approved', approved_by = v_actor, approved_at = now()
     WHERE bom_id = p_bom_id
     RETURNING * INTO v_bom;

    PERFORM ops.log_event('mfg.bom', p_bom_id, 'approved', jsonb_build_object('version', v_bom.version_no));
    RETURN v_bom;
END;
$$;

-- ─── M3: routings ────────────────────────────────────────────────────────────
-- p_operations: jsonb array of {work_centre_id, description, setup_minutes?, run_minutes_per_unit?, queue_minutes?}
CREATE OR REPLACE FUNCTION mfg.create_routing(
    p_item_id bigint, p_effective_from date, p_operations jsonb, p_effective_to date DEFAULT NULL
) RETURNS mfg.routings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_r mfg.routings; v_ver int;
BEGIN
    SELECT COALESCE(max(version_no), 0) + 1 INTO v_ver FROM mfg.routings WHERE item_id = p_item_id;
    INSERT INTO mfg.routings (item_id, version_no, status, effective_from, effective_to, source)
    VALUES (p_item_id, v_ver, 'draft', p_effective_from, p_effective_to, 'manual')
    RETURNING * INTO v_r;

    INSERT INTO mfg.routing_operations (routing_id, operation_seq, work_centre_id, description,
                                        setup_minutes, run_minutes_per_unit, queue_minutes)
    SELECT v_r.routing_id,
           (row_number() OVER ())::int * 10,
           (e->>'work_centre_id')::bigint,
           e->>'description',
           COALESCE((e->>'setup_minutes')::numeric, 0),
           COALESCE((e->>'run_minutes_per_unit')::numeric, 0),
           COALESCE((e->>'queue_minutes')::numeric, 0)
    FROM jsonb_array_elements(COALESCE(p_operations, '[]'::jsonb)) e;

    PERFORM ops.log_event('mfg.routing', v_r.routing_id, 'created',
                          jsonb_build_object('item_id', p_item_id, 'version', v_ver));
    RETURN v_r;
END;
$$;

CREATE OR REPLACE FUNCTION mfg.approve_routing(p_routing_id bigint) RETURNS mfg.routings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','admin']);
        v_r mfg.routings;
BEGIN
    SELECT * INTO v_r FROM mfg.routings WHERE routing_id = p_routing_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'routing % not found', p_routing_id; END IF;
    IF v_r.status <> 'draft' THEN RAISE EXCEPTION 'only a draft routing can be approved (is %)', v_r.status; END IF;

    UPDATE mfg.routings SET status='superseded', effective_to = COALESCE(effective_to, CURRENT_DATE)
     WHERE item_id = v_r.item_id AND status='approved' AND routing_id <> p_routing_id;
    UPDATE mfg.routings SET status='approved' WHERE routing_id = p_routing_id RETURNING * INTO v_r;

    PERFORM ops.log_event('mfg.routing', p_routing_id, 'approved', jsonb_build_object('version', v_r.version_no));
    RETURN v_r;
END;
$$;

-- ─── M2: production orders ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mfg.create_production_order(
    p_item_id bigint, p_bom_id bigint, p_plant text, p_qty numeric, p_uom text,
    p_due_date date, p_routing_id bigint DEFAULT NULL, p_origin text DEFAULT 'manual',
    p_planned_order_id bigint DEFAULT NULL
) RETURNS mfg.production_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','supervisor','admin']);
        v_po mfg.production_orders;
BEGIN
    INSERT INTO mfg.production_orders (order_no, item_id, bom_id, routing_id, plant, qty_ordered,
                                       uom, due_date, status, origin, planned_order_id)
    VALUES (ops.next_doc_no('MFG', 5), p_item_id, p_bom_id, p_routing_id, p_plant, p_qty,
            p_uom, p_due_date, 'planned', p_origin, p_planned_order_id)
    RETURNING * INTO v_po;

    IF p_routing_id IS NOT NULL THEN
        INSERT INTO mfg.po_operations (production_order_id, operation_seq, work_centre_id)
        SELECT v_po.production_order_id, ro.operation_seq, ro.work_centre_id
        FROM mfg.routing_operations ro WHERE ro.routing_id = p_routing_id;
    END IF;

    PERFORM ops.log_event('mfg.production_order', v_po.production_order_id, 'created',
                          jsonb_build_object('order_no', v_po.order_no, 'qty', p_qty, 'origin', p_origin));
    RETURN v_po;
END;
$$;

CREATE OR REPLACE FUNCTION mfg.transition_production_order(
    p_po_id bigint, p_to_status text
) RETURNS mfg.production_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['planner','supervisor','admin']);
        v_from text; v_po mfg.production_orders;
BEGIN
    SELECT status INTO v_from FROM mfg.production_orders WHERE production_order_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'production order % not found', p_po_id; END IF;

    IF NOT ((v_from, p_to_status) IN (
            ('planned','firm'), ('firm','released'), ('released','in_progress'),
            ('in_progress','completed'), ('completed','closed'),
            ('planned','cancelled'), ('firm','cancelled'), ('released','cancelled'))) THEN
        RAISE EXCEPTION 'illegal production order transition % -> %', v_from, p_to_status;
    END IF;

    UPDATE mfg.production_orders SET status = p_to_status
     WHERE production_order_id = p_po_id RETURNING * INTO v_po;
    PERFORM ops.log_event('mfg.production_order', p_po_id, 'status_change',
                          jsonb_build_object('from', v_from, 'to', p_to_status));
    RETURN v_po;
END;
$$;

-- The BC write-back (D-3). Records a completion, its consumption, genealogy
-- edges (I8), advances the order, and ENQUEUES the BC posting in the outbox
-- with an idempotency key (I2). Nothing is written to BC directly.
-- p_consumption: jsonb array of {component_item_id, qty, uom, lot_no?, method?}
CREATE OR REPLACE FUNCTION mfg.post_completion(
    p_po_id bigint, p_qty_good numeric, p_qty_scrap numeric,
    p_consumption jsonb, p_bc_location text, p_output_lot_no text DEFAULT NULL
) RETURNS mfg.completions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mfg, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['operator','supervisor','admin']);
        v_po mfg.production_orders;
        v_seq int;
        v_completion mfg.completions;
        v_outbox_id bigint;
        v_idem text;
BEGIN
    SELECT * INTO v_po FROM mfg.production_orders WHERE production_order_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'production order % not found', p_po_id; END IF;
    IF v_po.status NOT IN ('released','in_progress') THEN
        RAISE EXCEPTION 'production order must be released/in_progress to post (is %)', v_po.status;
    END IF;

    -- I10: output + every consumed component must map to a BC item via external_refs
    IF NOT EXISTS (SELECT 1 FROM ops.external_refs
                   WHERE entity_type='ops.item' AND entity_id=v_po.item_id AND system='bc') THEN
        RAISE EXCEPTION 'output item lacks a BC item mapping in external_refs (I10)';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_consumption,'[]'::jsonb)) e
               WHERE NOT EXISTS (SELECT 1 FROM ops.external_refs r
                                 WHERE r.entity_type='ops.item'
                                   AND r.entity_id=(e->>'component_item_id')::bigint
                                   AND r.system='bc')) THEN
        RAISE EXCEPTION 'a consumed component lacks a BC item mapping in external_refs (I10)';
    END IF;

    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM mfg.completions WHERE production_order_id = p_po_id;
    v_idem := format('mfg:po:%s:completion:%s', p_po_id, v_seq);

    INSERT INTO mfg.completions (production_order_id, seq, qty_good, qty_scrap, output_lot_no, posted_by)
    VALUES (p_po_id, v_seq, p_qty_good, p_qty_scrap, p_output_lot_no, v_actor)
    RETURNING * INTO v_completion;

    INSERT INTO mfg.material_consumption (completion_id, component_item_id, qty, uom, lot_no, method)
    SELECT v_completion.completion_id, (e->>'component_item_id')::bigint,
           (e->>'qty')::numeric, e->>'uom', NULLIF(e->>'lot_no',''),
           COALESCE(NULLIF(e->>'method',''), 'backflush')
    FROM jsonb_array_elements(COALESCE(p_consumption,'[]'::jsonb)) e;

    -- genealogy edges (I8, append-only) for lot-tracked consumption
    IF p_output_lot_no IS NOT NULL THEN
        INSERT INTO mfg.lot_consumption (completion_id, output_lot_no, consumed_item_id, consumed_lot_no, qty)
        SELECT v_completion.completion_id, p_output_lot_no,
               (e->>'component_item_id')::bigint, e->>'lot_no', (e->>'qty')::numeric
        FROM jsonb_array_elements(COALESCE(p_consumption,'[]'::jsonb)) e
        WHERE NULLIF(e->>'lot_no','') IS NOT NULL;
    END IF;

    -- advance the order
    UPDATE mfg.production_orders
       SET qty_completed = qty_completed + p_qty_good,
           qty_scrapped  = qty_scrapped + p_qty_scrap,
           status = CASE WHEN qty_completed + p_qty_good >= qty_ordered THEN 'completed'
                         WHEN status = 'released' THEN 'in_progress' ELSE status END
     WHERE production_order_id = p_po_id RETURNING * INTO v_po;

    -- enqueue BC posting (I2) — single writer; the bridge delivers it
    INSERT INTO ops.integration_outbox (aggregate_type, aggregate_id, event_type, target_system,
                                        idempotency_key, payload)
    VALUES ('mfg.completion', v_completion.completion_id, 'post_assembly_order', 'bc', v_idem,
            jsonb_build_object(
                'production_order_no', v_po.order_no,
                'output_item_id', v_po.item_id,
                'qty_good', p_qty_good, 'qty_scrap', p_qty_scrap,
                'output_lot_no', p_output_lot_no,
                'location', p_bc_location,
                'posting_date', CURRENT_DATE,
                'consumption', p_consumption))
    RETURNING outbox_id INTO v_outbox_id;

    UPDATE mfg.completions SET outbox_id = v_outbox_id WHERE completion_id = v_completion.completion_id
    RETURNING * INTO v_completion;

    PERFORM ops.log_event('mfg.completion', v_completion.completion_id, 'posted',
                          jsonb_build_object('seq', v_seq, 'qty_good', p_qty_good, 'idempotency_key', v_idem));
    RETURN v_completion;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mfg TO authenticated;
GRANT EXECUTE ON FUNCTION ops.log_event(text, bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION ops.require_roles(text[]) TO authenticated;
