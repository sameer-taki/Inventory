# Live environment

## Supabase — provisioned ✅

| | |
|---|---|
| Project | `golden-operations-platform` |
| Ref | `jvthwlypnwfcpgrnxqkh` |
| Region | `ap-southeast-2` (Sydney) |
| API URL | `https://jvthwlypnwfcpgrnxqkh.supabase.co` |
| Plan cost | ~US$10/month (org `wjgywgazknunhztizhac`) |

**Applied:** migrations `0001`–`0020`, demo/bootstrap seed, and the exposed-schemas
setting (`public, graphql_public, ops, quality, mfg, fleet` on the `authenticator`
role). Verified live: 4 users, 3 items, 3 NCRs, 1 CAPA, 3 work centres, 2 vehicles,
4 renewals.

**Scheduled jobs (pg_cron):**

| Job | Schedule (UTC) | Local | Command |
|---|---|---|---|
| `fleet-renewals-sweep` | `0 18 * * *` | 06:00 Fiji | `SELECT fleet.run_reminders_system();` |
| `gateway-bridge-drain` | `*/5 * * * *` | every 5 min | `net.http_post` → `gateway-bridge` edge function |

`gateway-bridge-drain` (via `pg_net`) invokes the delivery worker to drain
`ops.integration_outbox`. It runs **keyless** (the function is deployed
`verify_jwt=false`) and, while `BC_ODATA_URL` is unset, is a **safe dry-run**
(read-only; reports what would be delivered, mutates nothing). The bridge runs
as `service_role`, which was granted `USAGE` on `ops` + `SELECT` on
`integration_outbox`/`external_refs` (migration `0023`). To enable real BC
delivery: set the `BC_ODATA_URL`/`BC_ODATA_AUTH`/`BRIDGE_SECRET` function
secrets, then re-schedule the job adding the `x-bridge-secret` header (exact SQL
is in migration `0023`'s header comment). See `docs/d3-bc-writeback.md`.

`run_reminders_system()` is `SECURITY DEFINER` and **revoked from `PUBLIC`** so the
browser/API can never reach the ungated sweep; the role-gated `fleet.run_reminders()`
(used by the "Run now" button on `/fleet/renewals`) is the only client path. Each
run appends a `fleet.reminders` event (`source: cron|manual`) — visible in the audit
log with actor `system` for cron runs.

**Admin bootstrap:** `sameer@golden.com.fj` is pre-provisioned with the `admin`
role. Sign up in the app with that email (Supabase Auth) and the trigger links +
activates the account with admin access.

## App env vars (client-safe)

```
NEXT_PUBLIC_SUPABASE_URL=https://jvthwlypnwfcpgrnxqkh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key from Supabase → Project Settings → API>
```

The app's runtime paths use only these two (client + server + middleware). The
service-role key is **not** required for the app to run (no code path uses it);
add `SUPABASE_SERVICE_ROLE_KEY` later only if you build system/service-role jobs.

## Vercel — live ✅

| | |
|---|---|
| Project | `inventory` (team `sameer-mohammed-s-projects`) |
| Production URL | `https://inventory-rust-seven.vercel.app` |
| Source | GitHub `sameer-taki/Inventory` (auto-deploys on push) |
| Env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (set) |

The project is Git-connected, so every push builds. Env values are read through
`src/lib/supabase/env.ts`, which **trims** them — a stray space in an env var can
no longer break the client.

### Pending manual toggles (Vercel/GitHub UIs — no API available)

1. **GitHub** → repo **Settings → General → Default branch** → set to `main`.
2. **Vercel** → `inventory` → **Settings → Git → Production Branch** → set to `main`.

`main` and the working branch are kept in sync, so production works either way;
these just make `main` the canonical source going forward.

## Authentication — URL configuration (required)

In **Supabase → Authentication → URL Configuration** set:

- **Site URL**: `https://inventory-rust-seven.vercel.app`
- **Redirect URLs**: add `https://inventory-rust-seven.vercel.app/**`

Without these, Supabase rejects the app's `redirectTo` and the password-reset /
email links won't return to the app. (Add your custom domain here too when you
add one.)

## Password reset flow

Self-serve reset is built into the app:

| Route | Purpose |
|---|---|
| `/forgot-password` | Request a reset email (`resetPasswordForEmail`, public page). |
| `/auth/callback` | Exchanges the PKCE recovery `code` for a session, then forwards. |
| `/reset-password` | Authenticated (recovery-session) page to set a new password (`updateUser`). |

The login page links to `/forgot-password` and surfaces callback errors. There is
**no stored/known password** for any account — Supabase keeps only a one-way hash;
the reset flow (or the dashboard) is the only way to set/change one. Recovery
emails use Supabase's built-in mailer by default; configure custom SMTP for
production volume.
