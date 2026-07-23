-- ============================================================================
-- 0020_renewals_cron.sql  ·  Fleet — scheduled renewal-status sweep (pg_cron)
-- ----------------------------------------------------------------------------
-- The renewal reminder engine (F3) rolls 'current' → 'due_soon' → 'overdue' as
-- due dates approach/pass. It was manual-only (a button on /fleet/renewals,
-- gated to fleet_admin). This wires a nightly automatic sweep.
--
-- run_reminders() is role-gated (ops.require_roles), which needs an authed
-- user — a pg_cron job runs as `postgres` with no auth.uid(), so it can't call
-- it. The fix: extract the work into fleet._sweep_renewals(), keep the gated
-- run_reminders() for the UI, and add fleet.run_reminders_system() for cron.
-- Both system functions are REVOKEd from PUBLIC so the browser/API can never
-- reach the ungated path — single-writer discipline (P2) is preserved; every
-- status change is still logged (P3/I3), with actor 'system' under cron.
-- ============================================================================

-- Internal worker — the actual status transitions + logging. Not client-callable.
CREATE OR REPLACE FUNCTION fleet._sweep_renewals(p_source text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_changed int := 0; v_n int;
BEGIN
    UPDATE fleet.renewals
       SET status = 'overdue'
     WHERE status IN ('current','due_soon') AND due_date < CURRENT_DATE;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;

    UPDATE fleet.renewals
       SET status = 'due_soon'
     WHERE status = 'current'
       AND due_date >= CURRENT_DATE
       AND due_date - reminder_days <= CURRENT_DATE;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;

    PERFORM ops.log_event('fleet.reminders', 0, 'run',
                          jsonb_build_object('statuses_changed', v_changed, 'source', p_source));
    RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION fleet._sweep_renewals(text) FROM PUBLIC;

-- UI entrypoint (unchanged contract): role-gated, keeps its grant to authenticated.
CREATE OR REPLACE FUNCTION fleet.run_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
DECLARE v_actor bigint := ops.require_roles(ARRAY['fleet_admin','admin']);
BEGIN
    RETURN fleet._sweep_renewals('manual');
END;
$$;

-- Cron entrypoint: no role gate (runs as system), not reachable from the browser.
CREATE OR REPLACE FUNCTION fleet.run_reminders_system()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet, ops AS $$
BEGIN
    RETURN fleet._sweep_renewals('cron');
END;
$$;
REVOKE ALL ON FUNCTION fleet.run_reminders_system() FROM PUBLIC;

-- ── Schedule: pg_cron, daily 06:00 Fiji time (UTC+12) = 18:00 UTC ────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent (re)schedule by job name.
SELECT cron.unschedule('fleet-renewals-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-renewals-sweep');

SELECT cron.schedule(
    'fleet-renewals-sweep',
    '0 18 * * *',
    $cron$SELECT fleet.run_reminders_system();$cron$
);
