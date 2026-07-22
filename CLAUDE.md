# CLAUDE.md — Golden Operations Platform

Golden Manufacturers Group · operations platform. This repo is the
**golden-operations-platform** build described in `docs/gmg-full-system-master-plan.md`.
The MAX ERP replacement (manufacturing + quality) and the fleet module are built
here as modules of this one platform.

**Tech stack for this build:** Next.js (App Router) on **Vercel** + **Supabase**
(Postgres, Auth, RLS, Edge Functions). Supabase plays the role of the canonical
Postgres database; server-side code + Postgres `SECURITY DEFINER` functions play
the role of `golden-gateway` (the single writer). See `docs/architecture.md` for
how this stack maps onto the architecture in the plans.

---

## Invariants — do not violate, do not "temporarily" work around

Any change to an invariant requires a decision note and Aqib's sign-off.

### Platform invariants (apply to every module)

```
P1  BC Essentials is the financial and inventory master. No module ever
    becomes a second master or posts GL directly.
P2  golden-gateway is the single writer to every system of record. All
    external writes go through integration_outbox with idempotency keys.
    (On this stack: writes flow through server-side code / SECURITY DEFINER
    RPCs, never direct client mutation of external-facing state.)
P3  Every cross-system entity is mapped in external_refs; every material
    state change is appended to an event log. No silent mutation anywhere.
P4  All numbers that drive decisions or transactions are deterministic
    SQL/Python. Claude drafts, explains, summarises — it never computes
    a quantity of record.
P5  Kiwiplan owns corrugated. The kit BOM stays materials-only and never
    mirrors Kiwiplan's production BOM.
P6  Accura is augmented, never replaced.
P7  Ring-fenced buy-don't-build: real-time OEE/OT capture, GPS/telematics,
    route optimisation/TMS. Evaluation tracks only, fed via bought APIs.
P8  No big-bang cutovers, ever. A legacy system stays authoritative for a
    domain until that domain passes written parallel-run acceptance.
P9  Department agents are read-only over the canonical API, with the
    [VERIFY]/[FILL] convention. Any agent write action requires an
    Aqib-signed decision note.
P10 Superstore is a separate, isolated organisation. Nothing in this
    platform reads or writes Superstore data.
```

### Manufacturing module invariants (MAX replacement)

```
I1  BC Essentials is the sole master for: item master, inventory balances,
    lot/serial master, purchasing, costing, finance. The mfg module NEVER
    becomes an inventory master. If a quantity disagrees with BC, BC is right.
I2  golden-gateway is the single writer to BC. Every mfg posting to BC goes
    through integration_outbox with an idempotency key. No direct OData
    writes from app code, jobs, or scripts.
I3  Every cross-system entity is mapped in external_refs. Every state
    change on a production order, NCR, or CAPA is appended to the event log.
    No silent state mutation.
I4  All planning and costing math (MRP netting, projected inventory, BOM
    explosion, variance calcs) is deterministic SQL/Python. Never
    LLM-generated numbers.
I5  Corrugated stays in Kiwiplan. The kit BOM remains materials-only and
    the mfg BOM NEVER mirrors Kiwiplan's production BOM.
I6  Real-time OEE / machine-level OT capture is out of scope (ring-fenced).
I7  MAX remains running and authoritative for a domain until that domain
    passes its parallel-run acceptance criteria. No big-bang cutover.
    Cutover order: Quality → Production execution → MRP/planning.
I8  Lot genealogy edges (lot_consumption) are append-only and immutable.
    Corrections are new reversing rows, never updates or deletes.
I9  Quality records (NCR/CAPA) are append-only with logged status
    transitions. An NCR is never deleted, only dispositioned.
I10 A production order can only post to BC if its material and output
    lines carry valid BC item numbers resolved via external_refs.
```

### Fleet module invariants

```
F1  BC Essentials remains the financial master. The fleet module NEVER
    posts to GL, AP, or inventory. It stores operational records that
    reference BC documents (po_ref, invoice_ref), never the accounting
    entries themselves.
F2  golden-gateway is the single writer. The fleet schema lives in the
    canonical database. No side databases, no spreadsheets-as-master.
F3  Vehicles map to BC fixed assets via external_refs where an asset
    exists. Every job-card and renewal status change is appended to the
    event log. No silent state mutation.
F4  All analytics (cost/km, consumption, anomaly flags) are deterministic
    SQL views.
F5  Live GPS / telematics / CAN-bus capture is out of scope (buy-don't-build).
F6  No route optimisation, no TMS. Trip/assignment records are a thin log.
F7  Meter readings and fuel logs are append-only. Corrections are new
    reversing/superseding rows, never updates or deletes.
F8  Driver licence data is personal data: store only licence class and
    expiry, restrict to the fleet_admin role, follow the HR privacy boundary.
F9  This module does not enter the MAX program epics. Build starts only
    after MAX Stage 1 acceptance (FG0 sequencing condition).
F10 Superstore vehicles are out of scope.
```

---

## How the invariants land in code (this stack)

- **Single writer (P2/I2/F2).** No table that represents external-system state
  or an auditable transition is mutated directly by the browser. Clients read
  through RLS; every write goes through a Next.js server action or a Postgres
  `SECURITY DEFINER` function that performs the mutation **and** appends the
  event/outbox row in the same transaction.
- **No silent mutation (P3/I3/I9/F3).** Status transitions on NCR, CAPA,
  production orders, job cards, and renewals are done only via the `*_transition`
  RPCs, which insert a `status_events` / `*_events` row atomically. There is no
  code path that updates a `status` column without logging.
- **Append-only (I8/I9/F7).** Genealogy edges, quality records, meter readings,
  and fuel logs are never updated or deleted; corrections are new reversing /
  superseding rows.
- **Deterministic numbers (P4/I4/F4).** All quantities of record (MRP netting,
  BOM explosion, consumption analytics) are SQL/Python. The LLM layer never
  computes a number that drives a transaction.
- **BC is master (P1/I1/F1).** Nothing here posts GL or becomes an inventory
  master. External writes queue in `ops.integration_outbox` for the gateway
  bridge to deliver; they are never written to BC from app code directly.

## Build sequence (locked until Aqib changes it)

Per `docs/max-replacement-build-plan.md` §5 and the master plan §6:

1. **M0** Foundations & discovery (schemas, RBAC, external_refs, outbox, events) — DONE (migrations `0001`).
2. **M1** Quality / NCR / CAPA — **first module built** (migrations `0002`, app under `/quality`).
3. **M3** BOMs / routings / work centres — schema laid (`0003`), UI pending.
4. **M2** Production orders + BC write-back — schema laid (`0003`), spike D-3 first.
5. **M4** MRP / MPS netting engine — schema laid (`0003`), golden-dataset harness first.
6. **M5** Capacity, **M6** genealogy — schema laid (`0003`).
7. **Fleet** F0–F3 — schema laid (`0004`), gated after MAX Stage 1 (FG0).

`max_stage` (migration `0005`) is the temporary MAX migration landing schema;
it and the `max_ro` login are dropped after decommission.

## Conventions

- PKs: `bigint GENERATED ALWAYS AS IDENTITY`. Audit: `created_at/updated_at timestamptz`.
- Status: `text` + `CHECK`, never a bare enum type (keeps migrations reversible).
- All cross-system IDs live in `ops.external_refs`, never as loose columns.
- Migrations are forward-only, idempotent where possible, and live in `supabase/migrations`.
- Money is `numeric`, in FJD. Never float.
