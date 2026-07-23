-- ============================================================================
-- 0017_fuel_summary.sql  ·  Fleet — per-vehicle fuel & running-cost summary
-- ----------------------------------------------------------------------------
-- fleet.v_vehicle_fuel_summary: headline running-cost figures per vehicle, all
-- deterministic SQL (F4). Efficiency and cost-per-unit use the full-to-full
-- segment basis (same as fleet.v_consumption — litres of the ending fill over
-- distance since the previous full fill); total spend/volume count every
-- non-superseded fill (F7 — corrections are superseding rows, excluded here).
-- security_invoker keeps member RLS in force.
-- ============================================================================

CREATE OR REPLACE VIEW fleet.v_vehicle_fuel_summary WITH (security_invoker = true) AS
WITH segs AS (
    SELECT
        vehicle_id,
        litres,
        cost_fjd,
        meter_reading - LAG(meter_reading) OVER (
            PARTITION BY vehicle_id ORDER BY meter_reading
        ) AS units
    FROM fleet.fuel_logs
    WHERE is_full_fill AND meter_reading IS NOT NULL AND supersedes_id IS NULL
),
seg_agg AS (
    SELECT
        vehicle_id,
        sum(units)    FILTER (WHERE units > 0) AS units_measured,
        sum(litres)   FILTER (WHERE units > 0) AS seg_litres,
        sum(cost_fjd) FILTER (WHERE units > 0) AS seg_cost
    FROM segs
    WHERE units IS NOT NULL
    GROUP BY vehicle_id
),
fuel_agg AS (
    SELECT
        vehicle_id,
        count(*)       AS fill_count,
        sum(litres)    AS total_litres,
        sum(cost_fjd)  AS total_fuel_fjd,
        min(filled_at) AS first_fill,
        max(filled_at) AS last_fill
    FROM fleet.fuel_logs
    WHERE supersedes_id IS NULL
    GROUP BY vehicle_id
)
SELECT
    v.vehicle_id,
    v.fleet_code,
    v.meter_kind,
    coalesce(fa.fill_count, 0)      AS fill_count,
    coalesce(fa.total_litres, 0)    AS total_litres,
    coalesce(fa.total_fuel_fjd, 0)  AS total_fuel_fjd,
    fa.first_fill,
    fa.last_fill,
    coalesce(sa.units_measured, 0)  AS units_measured,
    round(sa.seg_litres / NULLIF(sa.units_measured, 0) * 100, 2) AS avg_per_100_units,
    round(sa.seg_cost   / NULLIF(sa.units_measured, 0), 3)       AS avg_cost_per_unit_fjd
FROM fleet.vehicles v
LEFT JOIN fuel_agg fa ON fa.vehicle_id = v.vehicle_id
LEFT JOIN seg_agg  sa ON sa.vehicle_id = v.vehicle_id;

GRANT SELECT ON fleet.v_vehicle_fuel_summary TO authenticated;
