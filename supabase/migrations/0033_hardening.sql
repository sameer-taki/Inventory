-- ============================================================================
-- 0033_hardening.sql  ·  advisor remediation (security + performance)
-- ----------------------------------------------------------------------------
-- Security:
--   * Clear the two SECURITY DEFINER view ERRORs by switching the shadow views
--     to security_invoker and relaxing RLS on the two max_stage tables they read
--     (mrp_recommendations + extract_batches) from admin-only to member-read.
--     These hold planning-grade data (MAX suggestions + batch metadata), no more
--     sensitive than mfg.planned_orders; the other max_stage tables stay admin.
--   * Pin ops.touch_updated_at's search_path (was role-mutable).
-- Performance:
--   * Covering indexes on the foreign keys that actually appear in the module's
--     view joins / filters (costing, planning, shadow, fleet). Audit-only FKs
--     (actor/entered_by/…) and staging batch_id FKs are left unindexed until
--     data volume warrants — indexing them now is write overhead for no gain.
-- ============================================================================

-- ── Security ────────────────────────────────────────────────────────────────
ALTER VIEW mfg.v_mrp_shadow_diff   SET (security_invoker = true);
ALTER VIEW mfg.v_mrp_shadow_status SET (security_invoker = true);

DROP POLICY IF EXISTS p_mrp_recommendations_read ON max_stage.mrp_recommendations;
CREATE POLICY p_mrp_recommendations_read ON max_stage.mrp_recommendations
    FOR SELECT USING (ops.is_member());

DROP POLICY IF EXISTS p_extract_batches_read ON max_stage.extract_batches;
CREATE POLICY p_extract_batches_read ON max_stage.extract_batches
    FOR SELECT USING (ops.is_member());

ALTER FUNCTION ops.touch_updated_at() SET search_path = pg_catalog;

-- ── Performance: covering indexes on queried FKs ─────────────────────────────
CREATE INDEX IF NOT EXISTS ix_po_item          ON mfg.production_orders (item_id);
CREATE INDEX IF NOT EXISTS ix_po_bom           ON mfg.production_orders (bom_id);
CREATE INDEX IF NOT EXISTS ix_po_routing       ON mfg.production_orders (routing_id);
CREATE INDEX IF NOT EXISTS ix_labour_po        ON mfg.labour_entries (production_order_id);
CREATE INDEX IF NOT EXISTS ix_labour_wc        ON mfg.labour_entries (work_centre_id);
CREATE INDEX IF NOT EXISTS ix_matcons_completion ON mfg.material_consumption (completion_id);
CREATE INDEX IF NOT EXISTS ix_matcons_component  ON mfg.material_consumption (component_item_id);
CREATE INDEX IF NOT EXISTS ix_planned_run      ON mfg.planned_orders (mrp_run_id);
CREATE INDEX IF NOT EXISTS ix_planned_item     ON mfg.planned_orders (item_id);
CREATE INDEX IF NOT EXISTS ix_pegging_plan     ON mfg.mrp_pegging (planned_order_id);
CREATE INDEX IF NOT EXISTS ix_bomlines_component ON mfg.bom_lines (component_item_id);
CREATE INDEX IF NOT EXISTS ix_routingops_wc    ON mfg.routing_operations (work_centre_id);
CREATE INDEX IF NOT EXISTS ix_actionmsg_run    ON mfg.action_messages (mrp_run_id);
CREATE INDEX IF NOT EXISTS ix_assignments_vehicle ON fleet.assignments (vehicle_id);
CREATE INDEX IF NOT EXISTS ix_assignments_driver  ON fleet.assignments (driver_id);
CREATE INDEX IF NOT EXISTS ix_jobcards_vehicle ON fleet.job_cards (vehicle_id);
