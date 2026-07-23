# Architecture — Supabase + Vercel

This document explains how the golden-operations-platform architecture in
`gmg-full-system-master-plan.md` and `max-replacement-build-plan.md` maps onto
this **Supabase + Vercel** build. The plans are host-agnostic on purpose
("nothing in this document is host-specific"); this is the concrete hosting
choice for the platform.

## Mapping the plan onto the stack

| Plan concept | Plan's reference implementation | This build |
|---|---|---|
| Canonical Postgres database (`ops`, `mfg`, `quality`, `fleet`, `max_stage`) | Self-managed Postgres | **Supabase Postgres** — same schemas, same DDL, in `supabase/migrations` |
| golden-gateway — the single writer (FastAPI) | FastAPI service | **Server-side code + `SECURITY DEFINER` RPCs.** All writes go through Next.js server actions and Postgres functions that mutate **and** log in one transaction. Browsers never write module state directly. |
| Platform SSO + RBAC | Platform auth | **Supabase Auth** + `ops.users` / `ops.roles` / `ops.user_roles`, enforced by **RLS** and by role checks inside the RPCs |
| `external_refs`, `integration_outbox`, event log | Platform tables | `ops.external_refs`, `ops.integration_outbox`, `ops.event_log` + `quality.status_events` |
| Web apps (Quality, Production, Planning) | Platform web app | **Next.js (App Router) on Vercel** |
| Integration bridge to BC / Kiwiplan / MAX (Azure VM GML-AI, MCP Hub) | Azure VM | **Unchanged.** The on-prem bridge still owns the actual OData/SQL connections. This platform only enqueues work in `ops.integration_outbox`; a bridge worker (Supabase Edge Function or the existing Azure bridge) delivers it. |

### Why RPCs are the "single writer"

Platform invariant **P2** (and **I2**/**F2**) says the gateway is the single
writer and there is **no silent mutation** (**P3/I3/I9/F3**). On this stack that
is enforced structurally:

- RLS grants **SELECT** to members but grants **no** direct INSERT/UPDATE/DELETE
  on the module tables. There is simply no client-reachable write path.
- Every write is a `SECURITY DEFINER` function (e.g. `quality.transition_ncr`)
  that updates the row **and** appends the `status_events` row atomically. You
  cannot change a status without logging it — the two happen in one function.
- BC-facing writes are never sent from app code. They are enqueued in
  `ops.integration_outbox` with an idempotency key; delivery is the bridge's job.

### Deterministic numbers (P4/I4/F4)

Every quantity of record is SQL: MRP netting, BOM explosion, fuel consumption
(`fleet.v_consumption`), monthly cost roll-ups. The LLM/agent layer may draft
and summarise but never computes a number that drives a transaction.

## Schema exposure

Supabase's API only serves schemas listed as **exposed**. This build exposes
`ops`, `quality`, `mfg`, `fleet` (see `supabase/config.toml` for local, and
Dashboard → Project Settings → API → *Exposed schemas* for a hosted project).
`max_stage` is intentionally **not** exposed to the API — it is read only by
migration jobs, and RLS restricts it to `admin`.

## RBAC roles

Seeded in `0001`: `admin`, `viewer`, `planner`, `supervisor`, `operator`,
`quality` (mfg/quality); `fleet_admin`, `workshop`, `driver` (fleet). A new
sign-up lands **inactive** with `viewer` until an admin activates it — unless an
admin **pre-provisioned** the person by email (see below), in which case the
sign-up links to that row and inherits its roles.

## Deploying

### 1. Database (Supabase)

**Option A — Supabase CLI (recommended):**

```bash
supabase link --project-ref <your-ref>
supabase db push                 # applies supabase/migrations in order
# optional demo data:
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

**Option B — SQL editor / MCP:** run each file in `supabase/migrations` in
order (`0001` → `0005`), then `supabase/seed.sql` if you want demo data.

Then in **Dashboard → Project Settings → API**, set *Exposed schemas* to
`public, graphql_public, ops, quality, mfg, fleet`.

### 2. App (Vercel)

Set the environment variables (from `.env.example`) in the Vercel project:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

Deploy. Set the Supabase Auth **Site URL** and redirect URLs to the deployed
Vercel domain (`supabase/config.toml [auth]`, or the hosted Auth settings).

### 3. Bootstrap an admin

Pre-provision yourself before first login so you land as `admin`:

```sql
-- if not already seeded:
insert into ops.users (email, full_name, is_active)
values ('you@golden.com.fj', 'Your Name', true)
on conflict (email) do nothing;

insert into ops.user_roles (user_id, role_key)
select user_id, 'admin' from ops.users where email = 'you@golden.com.fj'
on conflict do nothing;
```

Sign up with that email — the auth trigger links you to the row and activates
you with the `admin` role. (`seed.sql` already does this for
`sameer@golden.com.fj`.)

## What's built vs. laid down

- **Built end-to-end:** M0 foundation, M1 Quality (NCR + CAPA, transitions,
  timelines, dashboards), the app shell, auth + RBAC.
- **Schema laid, UI to follow the locked sequence:** mfg masters/execution/
  planning (M2–M6), fleet (F0–F3), `max_stage` migration landing.
