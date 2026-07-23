-- ============================================================================
-- 0018_fleet_cost_dashboard.sql  ·  Fleet-wide running-cost roll-ups
-- ----------------------------------------------------------------------------
-- Deterministic SQL analytics (F4) aggregating the per-vehicle views:
--   fleet.v_fleet_monthly_cost  — fleet running cost by month (fuel + closed
--     job-card parts/labour), for the trend.
--   fleet.v_fleet_cost_summary  — single-row headline: active vs fuelled
--     vehicle counts, total fuel spend, total maintenance spend, current-month
--     running cost. Money is unit-agnostic (FJD) so it sums across meter kinds;
--     per-unit efficiency stays per-vehicle in v_vehicle_fuel_summary because
--     km and hours are not comparable on one axis.
-- security_invoker keeps member RLS in force.
-- ============================================================================

CREATE OR REPLACE VIEW fleet.v_fleet_monthly_cost WITH (security_invoker = true) AS
SELECT
    month,
    sum(fuel_fjd)                          AS fuel_fjd,
    sum(parts_fjd)                         AS parts_fjd,
    sum(labour_fjd)                        AS labour_fjd,
    sum(fuel_fjd + parts_fjd + labour_fjd) AS total_fjd,
    count(DISTINCT vehicle_id)             AS vehicle_count
FROM fleet.v_vehicle_monthly_cost
GROUP BY month;

CREATE OR REPLACE VIEW fleet.v_fleet_cost_summary WITH (security_invoker = true) AS
SELECT
    (SELECT count(*) FROM fleet.vehicles WHERE status <> 'disposed')                  AS active_vehicles,
    (SELECT count(*) FROM fleet.v_vehicle_fuel_summary WHERE fill_count > 0)          AS fuelled_vehicles,
    coalesce((SELECT sum(fuel_fjd) FROM fleet.v_vehicle_monthly_cost), 0)             AS total_fuel_fjd,
    coalesce((SELECT sum(parts_fjd + labour_fjd) FROM fleet.v_vehicle_monthly_cost), 0) AS total_maint_fjd,
    coalesce((SELECT sum(fuel_fjd + parts_fjd + labour_fjd)
              FROM fleet.v_vehicle_monthly_cost
              WHERE month = date_trunc('month', CURRENT_DATE)::date), 0)              AS current_month_fjd;

GRANT SELECT ON fleet.v_fleet_monthly_cost  TO authenticated;
GRANT SELECT ON fleet.v_fleet_cost_summary  TO authenticated;
