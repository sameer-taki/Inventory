-- ============================================================================
-- 0019_consumption_anomaly.sql  ·  Fleet — fuel-efficiency anomaly flag (F4)
-- ----------------------------------------------------------------------------
-- fleet.v_consumption_anomaly: one row per full-to-full segment (the recall
-- basis of fleet.v_consumption), with each segment's L/100-unit compared to
-- that vehicle's own baseline. Baseline is a LEAVE-ONE-OUT mean — the average
-- of the vehicle's OTHER segments — so a single bad fill stands out instead of
-- diluting its own comparison. A segment is flagged when the vehicle has enough
-- history (>= 3 segments) and its efficiency deviates from baseline by at least
-- the threshold (25%), in either direction (a high reading = possible leak /
-- hard use; a low reading = likely a mis-read or mislabelled partial fill).
-- Purely deterministic SQL (F4); security_invoker keeps member RLS.
-- ============================================================================

CREATE OR REPLACE VIEW fleet.v_consumption_anomaly WITH (security_invoker = true) AS
WITH segs AS (
    SELECT
        f.fuel_log_id,
        f.vehicle_id,
        f.filled_at,
        f.litres,
        f.cost_fjd,
        f.meter_reading - LAG(f.meter_reading) OVER (
            PARTITION BY f.vehicle_id ORDER BY f.meter_reading
        ) AS units
    FROM fleet.fuel_logs f
    WHERE f.is_full_fill AND f.meter_reading IS NOT NULL AND f.supersedes_id IS NULL
),
per_seg AS (
    SELECT
        fuel_log_id, vehicle_id, filled_at, litres, units,
        round(litres / units * 100, 2) AS per_100_units,
        round(cost_fjd / units, 3)      AS cost_per_unit_fjd
    FROM segs
    WHERE units IS NOT NULL AND units > 0
),
stats AS (
    SELECT
        p.*,
        count(*)           OVER w AS seg_count,
        avg(per_100_units) OVER w AS veh_avg,
        CASE WHEN count(*) OVER w > 1
             THEN (sum(per_100_units) OVER w - per_100_units)
                  / (count(*) OVER w - 1)
        END AS baseline
    FROM per_seg p
    WINDOW w AS (PARTITION BY vehicle_id)
)
SELECT
    fuel_log_id,
    vehicle_id,
    filled_at,
    units AS distance_or_hours,
    litres,
    per_100_units,
    cost_per_unit_fjd,
    seg_count,
    round(veh_avg, 2)  AS veh_avg_per_100_units,
    round(baseline, 2) AS baseline_per_100_units,
    round((per_100_units - baseline) / NULLIF(baseline, 0) * 100, 1) AS deviation_pct,
    (seg_count >= 3
     AND baseline IS NOT NULL
     AND abs((per_100_units - baseline) / NULLIF(baseline, 0) * 100) >= 25) AS is_anomaly
FROM stats;

GRANT SELECT ON fleet.v_consumption_anomaly TO authenticated;
