-- ============================================================================
-- 0023_gateway_bridge_schedule.sql  ·  schedule the gateway-bridge drain
-- ----------------------------------------------------------------------------
-- Wires the single-writer delivery worker (edge function `gateway-bridge`) onto
-- pg_cron via pg_net, so ops.integration_outbox is drained automatically.
--
-- Two things had to be true for the bridge (which runs as service_role) to read
-- the outbox at all — both fixed here:
--   1. service_role needs access to the custom `ops` schema (it only had the
--      outbox delivery RPCs granted, not schema USAGE / SELECT).
--   2. pg_net provides net.http_post for the scheduled invocation.
--
-- The function is currently dry-run (BC_ODATA_URL unset) so this schedule is a
-- SAFE read-only drain — it reports what would be delivered and mutates nothing.
-- It is invoked keyless (the function is deployed verify_jwt=false).
--
-- To ENABLE real delivery later (D-3 open items, see docs/d3-bc-writeback.md):
--   a) set the function secrets BC_ODATA_URL, BC_ODATA_AUTH, BRIDGE_SECRET
--      (Supabase dashboard / CLI), optionally BC_POSTING_MODE;
--   b) re-schedule this job adding the secret header, e.g.:
--        select cron.unschedule('gateway-bridge-drain');
--        select cron.schedule('gateway-bridge-drain','*/5 * * * *', $cmd$
--          select net.http_post(
--            url := 'https://jvthwlypnwfcpgrnxqkh.supabase.co/functions/v1/gateway-bridge',
--            headers := jsonb_build_object('Content-Type','application/json',
--                                          'x-bridge-secret','<BRIDGE_SECRET>'),
--            body := '{}'::jsonb, timeout_milliseconds := 10000);
--        $cmd$);
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- (1) let the bridge's service_role read the outbox + item cross-refs
GRANT USAGE  ON SCHEMA ops                 TO service_role;
GRANT SELECT ON ops.integration_outbox     TO service_role;
GRANT SELECT ON ops.external_refs          TO service_role;
-- (the delivery RPCs ops.outbox_mark_sent / _mark_failed are already granted)

-- (2) schedule the drain every 5 minutes (idempotent re-schedule by name)
SELECT cron.unschedule('gateway-bridge-drain')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gateway-bridge-drain');

SELECT cron.schedule(
    'gateway-bridge-drain',
    '*/5 * * * *',
    $cmd$
    SELECT net.http_post(
        url := 'https://jvthwlypnwfcpgrnxqkh.supabase.co/functions/v1/gateway-bridge',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
    );
    $cmd$
);
