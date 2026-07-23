# Golden Operations Platform

Golden Manufacturers Group's operations platform — the **MAX ERP replacement**
(manufacturing + quality) and the **fleet module**, built as one platform on
**Supabase** (Postgres, Auth, RLS) and **Vercel** (Next.js App Router).

This repo implements the plans in [`docs/`](docs/):

- [`gmg-full-system-master-plan.md`](docs/gmg-full-system-master-plan.md) — the top-level index (every module, one sequence).
- [`max-replacement-build-plan.md`](docs/max-replacement-build-plan.md) — the manufacturing + quality build (modules 7–13).
- [`fleet-module-build-plan.md`](docs/fleet-module-build-plan.md) — the fleet module (module 14).
- [`architecture.md`](docs/architecture.md) — how Supabase + Vercel map onto those plans, and how to deploy.

The authoritative invariants live in [`CLAUDE.md`](CLAUDE.md).

## Status

Following the plan's own locked build order (M0 foundations → **M1 Quality
first**), this build ships:

| | Scope | State |
|---|---|---|
| **M0** | Foundations: `ops` schema (users/RBAC, `external_refs`, `integration_outbox`, event log), RLS + single-writer helpers | ✅ done |
| **M1** | **Quality / NCR / CAPA** — raise, review, disposition, CAPA lifecycle, logged timelines (I9), dashboards | ✅ built end-to-end |
| M2–M6 | Manufacturing: BOMs, routings, work centres, production orders + BC write-back, MRP/MPS, genealogy | 🧱 full schema laid (`0003`); UIs follow the sequence |
| F0–F3 | Fleet: register, renewals, job cards, fuel analytics | 🧱 full schema + views laid (`0004`); gated after MAX Stage 1 (FG0) |
| M13 | `max_stage` MAX-migration landing | 🧱 staging schema laid (`0005`) |

## Tech stack

- **Next.js 15** (App Router, server components + server actions), TypeScript, Tailwind.
- **Supabase**: Postgres + Auth + Row-Level Security. Schemas: `ops`, `quality`, `mfg`, `fleet`, `max_stage`.
- **Vercel** hosting.

## Local development

```bash
npm install

# 1. Bring up Supabase locally (requires the Supabase CLI + Docker):
supabase start           # applies supabase/migrations and supabase/seed.sql

# 2. Point the app at it — copy .env.example to .env.local and fill in the
#    URL + anon key that `supabase start` prints:
cp .env.example .env.local

# 3. Run the app:
npm run dev              # http://localhost:3000
```

Sign up with `sameer@golden.com.fj` (pre-provisioned as `admin` by the seed) to
get full access immediately.

Useful scripts:

```bash
npm run build       # production build (type-checked)
npm run typecheck   # tsc --noEmit
```

## Deploying to Supabase + Vercel

See [`docs/architecture.md`](docs/architecture.md#deploying) for the full,
step-by-step deploy (apply migrations, expose schemas, set Vercel env vars,
bootstrap an admin).

## How the invariants are enforced in code

- **Single writer / no silent mutation** (P2/P3/I2/I3/I9/F3): RLS grants reads
  only; every write is a `SECURITY DEFINER` RPC that mutates and appends its
  event row in one transaction. There is no client-reachable path that changes a
  status without logging it.
- **BC is master** (P1/I1/F1): nothing posts to BC directly; postings queue in
  `ops.integration_outbox` with idempotency keys for the on-prem bridge to deliver.
- **Deterministic numbers** (P4/I4/F4): all quantities of record are SQL/Python.
- **Append-only** (I8/I9/F7): genealogy edges, quality records, meter/fuel logs
  are never updated or deleted — corrections are new reversing/superseding rows.

## Repository layout

```
supabase/
  migrations/            0001 ops · 0002 quality · 0003 mfg · 0004 fleet · 0005 max_stage
  seed.sql               idempotent demo/bootstrap data
  config.toml            local project config (exposed schemas, auth)
src/
  app/
    login/               auth
    (app)/               authenticated shell (sidebar, guard)
      dashboard/         cross-module overview
      quality/           M1 — NCR + CAPA (list, detail, create, transitions)
      manufacturing/     read-only overview (schema-backed)
      fleet/             read-only overview (schema-backed)
  components/            Sidebar, StatusBadge, StatTile, PageHeader
  lib/
    supabase/            browser / server / service clients + middleware
    auth.ts              session + RBAC resolution
docs/                    the three plans + architecture
CLAUDE.md                authoritative invariants
```
