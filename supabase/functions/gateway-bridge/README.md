# gateway-bridge

The single-writer delivery worker (Platform **P2** / MFG **I2**). It drains
`ops.integration_outbox` and posts each row to Business Central over OData, then
finalises via the service-role RPCs `ops.outbox_mark_sent` / `ops.outbox_mark_failed`
(migration `0013`). **No other code writes to BC** — application code only
enqueues rows (e.g. `mfg.post_completion`).

## Modes
- **dry-run** (default; also whenever `BC_ODATA_URL` is unset or `?dryRun=true`):
  read-only. Reports what *would* be delivered, mutates nothing. Safe to expose,
  so you can wire scheduling before BC connectivity exists.
- **deliver** (`BC_ODATA_URL` set): posts each row to BC and marks it sent/failed.
  Requires the `x-bridge-secret` request header to equal `BRIDGE_SECRET`.

## Environment
| var | notes |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto-injected by the Edge runtime |
| `BC_ODATA_URL` | BC OData endpoint that creates the posting document; unset ⇒ dry-run |
| `BC_ODATA_AUTH` | value for the `Authorization` header to BC (e.g. `Basic …`) |
| `BRIDGE_SECRET` | shared secret required for deliver mode |
| `BRIDGE_BATCH` | rows per invocation (default 20) |
| `BRIDGE_MAX_ATTEMPTS` | attempts before a row is marked `dead` (default 5) |

## Deploy & schedule
```bash
supabase functions deploy gateway-bridge

# secrets (only needed for deliver mode)
supabase secrets set BC_ODATA_URL="https://<bridge-host>/odata/...\" \
  BC_ODATA_AUTH="Basic ..." BRIDGE_SECRET="$(openssl rand -hex 24)"

# invoke (dry-run)
curl -s "$SUPABASE_URL/functions/v1/gateway-bridge?dryRun=true" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"

# schedule every minute via pg_cron (run once, in SQL):
#   select cron.schedule('gateway-bridge','* * * * *', $$
#     select net.http_post(
#       url:='https://<ref>.functions.supabase.co/gateway-bridge',
#       headers:='{"x-bridge-secret":"<secret>"}'::jsonb) $$);
```

## BC contract (D-3, stub)
`buildBcDocument()` maps an `mfg.completion` outbox payload to a BC **Assembly
Order** (output item + quantity + lot on the header, consumed materials as
component lines). Item numbers are resolved to BC item nos via
`ops.external_refs` (**I10**) at delivery time. The BC field names are a stub —
confirm them against the real BC OData metadata before enabling deliver mode;
the mapping is isolated to this one function so nothing else changes.

## Isolation to the LAN
BC lives on-prem (172.16.1.10). Supabase Edge egress must be able to reach the
BC OData endpoint — in practice `BC_ODATA_URL` points at the existing Azure
bridge VM (GML-AI / MCP Hub) that fronts BC, not BC directly.
