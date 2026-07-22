# Fleet Module — Build Plan

**Golden Manufacturers Group · Operations Platform Extension**

| | |
|---|---|
| Version | v1.0 — Draft for review |
| Date | 20 July 2026 |
| Prepared by | Sameer (AI & Technology Lead) |
| Approval | Aqib Razak (Managing Director) |
| Infra actions | Prasanna (IT Manager) |
| Status | Awaiting FG0 — explicitly sequenced **after** MAX Stage 1 (Quality) acceptance; not part of the MAX program (MAX plan R9) |
| Parent documents | golden-operations-platform-master · max-replacement-build-plan v1.0 |

---

## 1. Purpose and decision record

GMG's vehicle and mobile-plant fleet — trucks, vans, cars, forklifts and other unregistered plant — is currently tracked in nobody's system. Neither MAX nor BC Essentials covers it, so registrations, fitness certificates, insurance, servicing, and fuel spend live in paper files, memory, and ad-hoc spreadsheets. The exposure is concrete: a lapsed registration or fitness certificate on a delivery truck, a missed forklift statutory inspection, or fuel spend drifting with no baseline to catch it.

This plan adds a **fleet module** to the golden-operations-platform. It is deliberately small and boring: a register, a reminder engine, job cards, and fuel analytics. It is **not** a telematics platform, not a transport-management system, and not a finance system.

**Positioning decision (recorded, not re-argued):** this module has zero coupling to the MAX replacement program and must not dilute it. It enters the build queue only after MAX Stage 1 (Quality) passes its adoption acceptance. Effort is S/M in platform terms — mostly CRUD, one nightly job, and SQL views.

**Scope in one line:** know every vehicle, never miss a renewal or service, cost every job, and see fuel consumption per vehicle — with BC remaining the financial master throughout.

---

## 2. Invariants

Copy this block verbatim into the repo `CLAUDE.md`. Any change requires a decision note and Aqib's sign-off.

```
FLEET MODULE INVARIANTS — do not violate, do not "temporarily" work around

F1  BC Essentials remains the financial master. The fleet module NEVER
    posts to GL, AP, or inventory. Fuel and workshop invoices land in BC
    through AP/procurement exactly as today; the fleet module stores
    operational records that reference those documents (po_ref,
    invoice_ref), never the accounting entries themselves.

F2  golden-gateway is the single writer. The fleet schema lives in the
    existing canonical Postgres database. No side databases, no
    spreadsheets-as-master.

F3  Vehicles map to BC fixed assets via external_refs where an asset
    exists (FD-2). Every job-card and renewal status change is appended
    to the event log. No silent state mutation.

F4  All analytics (cost/km, consumption, anomaly flags) are deterministic
    SQL views. Claude may summarise and explain; it never computes a
    number that drives a decision or a transaction.

F5  Live GPS / telematics / CAN-bus capture is out of scope
    (buy-don't-build ring-fence, same class as OEE in the MAX plan I6).
    If ever wanted, it is a bought service feeding the platform via API
    — an evaluation track, never a hand-rolled ingestion layer.

F6  No route optimisation, no TMS. Trip/assignment records are a thin
    log at most (who had which vehicle, when) — nothing more.

F7  Meter readings and fuel logs are append-only. Corrections are new
    reversing/superseding rows flagged as such, never updates or deletes.

F8  Driver licence data is personal data: store only licence class and
    expiry, restrict access to the fleet_admin role, and follow the HR
    privacy boundary convention. No copies of licence documents in the
    module without FD-6 sign-off.

F9  This module does not enter the MAX program epics. Build starts only
    after MAX Stage 1 acceptance (FG0 sequencing condition).

F10 Superstore vehicles are out of scope. Superstore is a separate,
    fully isolated organisation; if it wants fleet tracking, it gets its
    own instance in its own org.
```

---

## 3. System-of-record boundary map

| Capability | System of record | Disposition |
|---|---|---|
| Vehicle & plant register (rego, chassis, type, site, ownership, meter) | **fleet module** | **BUILD** (F1 phase) |
| Meter readings (odometer / hour-meter) | **fleet module** | **BUILD** (F1) |
| Compliance renewals: LTA registration, wheel tax, fitness (CoF), insurance, statutory plant inspections (forklifts) | **fleet module** | **BUILD** (F1) |
| Driver licence class + expiry (reminder only) | **fleet module** (thin, F8 privacy) | **BUILD-lite** (F1) |
| Service plans (by date / km / hours) | **fleet module** | **BUILD** (F2) |
| Job cards (scheduled + breakdown), downtime, cost capture | **fleet module** | **BUILD** (F2) |
| Parts purchasing for jobs | Procurement app (KAN-37–42) → BC | Keep — job card stores `po_ref` only |
| Workshop parts stock (if internally stocked) | BC Essentials inventory | Keep (FD-4 decides internal vs external-only model) |
| Invoices, payments, GL, depreciation | BC Essentials | Keep — untouched (F1 invariant) |
| Fixed-asset register | BC Essentials | Keep — mapped via `external_refs` (FD-2) |
| Fuel fill log + statement import | **fleet module** | **BUILD** (F3) |
| Fuel/cost analytics (cost/km, l/100km, l/hr, anomalies) | **fleet module** (SQL views) | **BUILD** (F3) |
| Vehicle assignment log (vehicle ↔ driver/site over time) | **fleet module** (thin, F6) | **BUILD-lite** (F2) |
| Live GPS / telematics | — | Out of scope (F5) — optional future eval track |
| Route planning / dispatch optimisation | — | Out of scope (F6) |
| HR employee master | HR systems | Keep — drivers reference platform users; HR stays master |

---

## 4. Architecture

Same shape as every platform module — nothing new to operate:

- **Schema:** `fleet` in the canonical Postgres database, alongside `ops`, `mfg`, `quality`.
- **API:** golden-gateway routes (`/fleet/...`), single writer (F2), RBAC roles: `fleet_admin` (full, sees driver data), `workshop` (job cards, meters), `driver` (submit fill-ups and meter readings for assigned vehicle), `viewer` (dashboards, no personal data).
- **Reminder engine:** one nightly job — computes renewals due within their `reminder_days`, services due by date/km/hours against latest meter reading, and overdue escalations. Output lands in an in-app queue and email via the platform's existing no-reply mailbox (Graph sendMail) — channel confirmed at FD-5.
- **Fuel statement import:** CSV/statement upload → `fleet.import_batches` staging → parsed rows into a **human verification queue** → accepted rows become `fuel_logs` (`source='statement_import'`). Same verification-queue discipline as the Superstore PO app: no imported financial figure enters analytics unverified.
- **Mobile-first forms** for the two high-frequency entries (meter reading, fuel fill) — if entry takes more than 30 seconds on a phone, discipline dies and R1 fires.
- **UI:** platform-standard web app; dashboards are SQL views only (F4).
- **No new infrastructure.** One schema, one nightly job, existing mail path.

---

## 5. Phase map and build order

| # | Phase | Contents | Depends on | Effort | Acceptance style |
|---|---|---|---|---|---|
| **F0** | Foundations & census | Schema migration · RBAC · vehicle census walkaround per site · seed renewals from documents · BC fixed-asset mapping (FD-2) | FG0 | S | Census signed by site managers |
| **F1** | Register & compliance | Vehicle CRUD · meter readings · renewals + reminder engine · driver licence expiry (F8) | F0 | S/M | Zero lapsed renewals, one full quarter |
| **F2** | Maintenance | Service plans · job cards (scheduled + breakdown) · downtime + cost capture · procurement `po_ref` link · assignment log | F1 | M | All workshop jobs via job cards, 4 consecutive weeks |
| **F3** | Fuel & analytics | Fill log · statement import + verification queue · consumption/cost views · anomaly flags | F1 | M | All fills logged for one month; baseline dashboard reviewed with Aqib |
| **F4** | *(optional, unscheduled)* Telematics evaluation track | Buy-side evaluation only (F5) — vendor feed into `meter_readings`/positions | F3 live | — | Separate decision paper if ever raised |

No parallel run anywhere — the module is net-new, so acceptance is **adoption**, exactly like MAX Stage 1. Rollout is site-by-site: start with the site from the F0 census that has the cleanest records, then extend.

---

## 6. Data model — Postgres DDL

Same conventions as the platform master and the `mfg` schema: identity PKs, `timestamptz` audit columns, status enums as `text` + CHECK, append-only where flagged, cross-system IDs via `external_refs`.

```sql
-- ============================================================
-- SCHEMA: fleet — register & compliance (F1)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS fleet;

CREATE TABLE fleet.vehicles (
    vehicle_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fleet_code       text NOT NULL UNIQUE,          -- FLT-NNN, painted/labelled on the unit
    rego_no          text UNIQUE,                   -- NULL for unregistered plant (forklifts)
    make_model       text NOT NULL,
    year             int,
    chassis_no       text UNIQUE,
    kind             text NOT NULL
                     CHECK (kind IN ('truck','van','car','forklift','other_plant')),
    site             text NOT NULL,                 -- FD-1 site list
    ownership        text NOT NULL
                     CHECK (ownership IN ('owned','leased')),
    lease_ref        text,
    meter_kind       text NOT NULL
                     CHECK (meter_kind IN ('km','hours')),
    fuel_kind        text CHECK (fuel_kind IN ('diesel','petrol','lpg','electric','na')),
    acquired_on      date,
    status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','workshop','parked','disposed')),
    disposed_on      date,
    notes            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
-- BC fixed-asset no. lives in ops.external_refs
--   (entity_type='fleet.vehicle', system='bc_fixed_asset') per FD-2.

-- Append-only (F7). Non-monotonic readings are allowed but auto-flagged.
CREATE TABLE fleet.meter_readings (
    reading_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id       bigint NOT NULL REFERENCES fleet.vehicles,
    reading          numeric(12,1) NOT NULL CHECK (reading >= 0),
    read_at          timestamptz NOT NULL DEFAULT now(),
    source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','fuel_log','job_card','import')),
    entered_by       bigint NOT NULL,
    supersedes_id    bigint REFERENCES fleet.meter_readings,  -- correction chain (F7)
    is_flagged       boolean NOT NULL DEFAULT false,          -- set by validation, not humans
    flag_reason      text
);
CREATE INDEX ix_meter_vehicle_time ON fleet.meter_readings (vehicle_id, read_at DESC);

-- Polymorphic renewals: vehicles AND drivers (licence expiry) share the engine.
CREATE TABLE fleet.renewals (
    renewal_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type      text NOT NULL CHECK (entity_type IN ('vehicle','driver')),
    entity_id        bigint NOT NULL,
    kind             text NOT NULL CHECK (kind IN
                     ('registration','wheel_tax','fitness_cof','insurance',
                      'plant_inspection','licence','other')),
    reference_no     text,                          -- policy no. / cert no.
    due_date         date NOT NULL,
    reminder_days    int NOT NULL DEFAULT 30,
    status           text NOT NULL DEFAULT 'current'
                     CHECK (status IN ('current','due_soon','overdue','renewed','lapsed','na')),
    completed_at     date,
    next_renewal_id  bigint REFERENCES fleet.renewals,  -- chain: renewing creates the next row
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_renewals_due ON fleet.renewals (status, due_date);

-- Thin driver table (F8): class + expiry only. HR remains master for people.
CREATE TABLE fleet.drivers (
    driver_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          bigint NOT NULL UNIQUE,        -- FK -> ops.users
    licence_class    text NOT NULL,
    licence_expiry   date NOT NULL,
    forklift_certified boolean NOT NULL DEFAULT false,
    forklift_cert_expiry date,
    is_active        boolean NOT NULL DEFAULT true
);

-- Thin assignment log (F6): who has what, when. Nothing more.
CREATE TABLE fleet.assignments (
    assignment_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id       bigint NOT NULL REFERENCES fleet.vehicles,
    driver_id        bigint REFERENCES fleet.drivers,
    site             text,
    assigned_from    date NOT NULL,
    assigned_to      date,
    note             text
);

-- ============================================================
-- SCHEMA: fleet — maintenance (F2)
-- ============================================================
CREATE TABLE fleet.service_plans (
    plan_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id       bigint NOT NULL REFERENCES fleet.vehicles,
    name             text NOT NULL,                 -- '10,000 km service', '250-hr service'
    interval_kind    text NOT NULL
                     CHECK (interval_kind IN ('days','km','hours')),
    interval_value   numeric(12,1) NOT NULL CHECK (interval_value > 0),
    last_done_at     date,
    last_done_reading numeric(12,1),
    is_active        boolean NOT NULL DEFAULT true,
    UNIQUE (vehicle_id, name)
);

CREATE TABLE fleet.job_cards (
    job_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_no           text NOT NULL UNIQUE,          -- FJC-YYYYNNNN
    vehicle_id       bigint NOT NULL REFERENCES fleet.vehicles,
    kind             text NOT NULL
                     CHECK (kind IN ('scheduled','breakdown','inspection','tyres','other')),
    plan_id          bigint REFERENCES fleet.service_plans,   -- set when kind='scheduled'
    description      text NOT NULL,
    workshop         text NOT NULL
                     CHECK (workshop IN ('internal','external')),
    vendor_name      text,                          -- when external
    po_ref           text,                          -- procurement app / BC PO (F1 invariant)
    invoice_ref      text,                          -- BC purchase invoice no.
    meter_at_service numeric(12,1),
    parts_cost_fjd   numeric(12,2) NOT NULL DEFAULT 0,
    labour_cost_fjd  numeric(12,2) NOT NULL DEFAULT 0,
    downtime_hours   numeric(8,1),
    status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','awaiting_parts','done','cancelled')),
    opened_at        timestamptz NOT NULL DEFAULT now(),
    closed_at        timestamptz
);

CREATE TABLE fleet.job_card_events (               -- F3 invariant: transitions logged
    event_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id           bigint NOT NULL REFERENCES fleet.job_cards,
    from_status      text,
    to_status        text NOT NULL,
    actor_id         bigint NOT NULL,
    note             text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SCHEMA: fleet — fuel & imports (F3)
-- ============================================================
CREATE TABLE fleet.import_batches (
    batch_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_name      text NOT NULL,                 -- 'Total card stmt Jun-26' etc. (FD-3)
    file_ref         text NOT NULL,
    row_count        int,
    status           text NOT NULL DEFAULT 'parsing'
                     CHECK (status IN ('parsing','awaiting_verification','accepted','rejected')),
    uploaded_by      bigint NOT NULL,
    uploaded_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only (F7). Consumption maths uses full-to-full fills only.
CREATE TABLE fleet.fuel_logs (
    fuel_log_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id       bigint NOT NULL REFERENCES fleet.vehicles,
    filled_at        date NOT NULL,
    litres           numeric(8,2) NOT NULL CHECK (litres > 0),
    cost_fjd         numeric(10,2) NOT NULL CHECK (cost_fjd >= 0),
    meter_reading    numeric(12,1),
    is_full_fill     boolean NOT NULL DEFAULT true,
    vendor           text,
    source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','statement_import')),
    batch_id         bigint REFERENCES fleet.import_batches,
    verified_by      bigint,                        -- required when source='statement_import'
    supersedes_id    bigint REFERENCES fleet.fuel_logs,       -- correction chain (F7)
    entered_by       bigint NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_fuel_vehicle_date ON fleet.fuel_logs (vehicle_id, filled_at);

-- ============================================================
-- Analytics views (F4: deterministic SQL only) — representative set
-- ============================================================
CREATE VIEW fleet.v_due_renewals AS
SELECT r.*, GREATEST(0, r.due_date - CURRENT_DATE) AS days_left
FROM   fleet.renewals r
WHERE  r.status IN ('current','due_soon','overdue')
AND    r.due_date <= CURRENT_DATE + (r.reminder_days || ' days')::interval;

CREATE VIEW fleet.v_consumption AS               -- full-to-full segments per vehicle
WITH fulls AS (
  SELECT vehicle_id, filled_at, litres, cost_fjd, meter_reading,
         LAG(meter_reading) OVER (PARTITION BY vehicle_id ORDER BY meter_reading) AS prev_reading
  FROM   fleet.fuel_logs
  WHERE  is_full_fill AND meter_reading IS NOT NULL AND supersedes_id IS NULL
)
SELECT vehicle_id, filled_at,
       meter_reading - prev_reading                    AS distance_or_hours,
       litres,
       round(litres / NULLIF(meter_reading - prev_reading,0) * 100, 2) AS per_100_units,
       round(cost_fjd / NULLIF(meter_reading - prev_reading,0), 3)     AS cost_per_unit_fjd
FROM   fulls WHERE prev_reading IS NOT NULL AND meter_reading > prev_reading;

CREATE VIEW fleet.v_vehicle_monthly_cost AS      -- fuel + workshop per vehicle per month
SELECT v.vehicle_id, v.fleet_code, date_trunc('month', d.on_date)::date AS month,
       sum(d.fuel_fjd)  AS fuel_fjd,
       sum(d.parts_fjd) AS parts_fjd,
       sum(d.labour_fjd) AS labour_fjd
FROM fleet.vehicles v
JOIN LATERAL (
    SELECT filled_at AS on_date, cost_fjd AS fuel_fjd, 0 AS parts_fjd, 0 AS labour_fjd
    FROM fleet.fuel_logs WHERE vehicle_id = v.vehicle_id AND supersedes_id IS NULL
    UNION ALL
    SELECT closed_at::date, 0, parts_cost_fjd, labour_cost_fjd
    FROM fleet.job_cards WHERE vehicle_id = v.vehicle_id AND status = 'done'
) d ON true
GROUP BY 1,2,3;
```

**Anomaly flags (F3, all SQL):** a fill's `per_100_units` more than a configurable % above the vehicle's rolling 6-fill median → flag; meter reading lower than the previous reading → auto-flag on insert (`is_flagged`); fill litres exceeding tank capacity (optional per-vehicle field, can add at F3) → flag. Flags go to the same review queue as renewals — they prompt a human, they never auto-correct (F4).

---

## 7. Reminder engine (F1 nightly job)

1. Renewals: `status='current'` with `due_date - reminder_days <= today` → `due_soon` + queue entry; past due → `overdue` + escalation entry. Renewing writes `completed_at`, creates the chained next-cycle row (`next_renewal_id`), status `renewed`.
2. Services: for each active plan, due when `days` elapsed or `latest meter − last_done_reading ≥ interval_value`. Due → suggested draft job card (kind `scheduled`) in the workshop queue — created as *draft*, a human releases it.
3. Driver licences and forklift certs run through the same renewals engine (`entity_type='driver'`), visible to `fleet_admin` only (F8).
4. Delivery: in-app queue always; email digest via the existing no-reply mailbox per FD-5. Every notification and its acknowledgement is event-logged (F3).

---

## 8. Data load (F0 — no legacy system, so a census, not a migration)

1. **Vehicle census:** physical walkaround per FD-1 site — rego, chassis, meter photo, condition note. Seeds `vehicles` + first `meter_readings`. Signed off by each site manager.
2. **Renewals seed:** from LTA papers, insurance schedules, inspection certificates. Every vehicle must end the census with a complete renewal set or an explicit `na` row — unknown expiry dates are recorded as *overdue-unknown* and chased, not left blank.
3. **BC fixed-asset mapping (FD-2):** finance provides the FA register extract; match to census; unmatched vehicles go on a finance action list. Mapping lands in `external_refs`.
4. **Fuel baseline (optional, FD-3):** backfill 6–12 months of card statements through the import queue to give F3 analytics an immediate baseline.

---

## 9. Rollout and acceptance

Net-new module → adoption gates, mirroring MAX Stage 1:

- **F1 accepted** when one full quarter passes with zero lapsed renewals and every register change made in-app.
- **F2 accepted** when all workshop work (internal and external) runs through job cards for 4 consecutive weeks, each closed job carrying costs and `po_ref`/`invoice_ref` where applicable.
- **F3 accepted** when one month of fills is fully logged (manual + verified imports) and the consumption/cost dashboard is reviewed with Aqib as the baseline.

Rollback at any point = stop using the module (paper continues to exist); there is no cutover risk anywhere in this plan.

---

## 10. Risk register

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| FR1 | Entry discipline dies (meters/fuel not logged) → analytics worthless | H×M | Mobile-first 30-second forms; statement import does the bulk of fuel rows; site-by-site rollout; adoption gates before claiming success |
| FR2 | Incomplete renewal data at seed → false sense of coverage | M×H | Census rule: no blank expiry — unknown = overdue-unknown and chased; F1 acceptance requires a clean quarter |
| FR3 | Scope creep into telematics/TMS | M×M | F5/F6 invariants; any breach needs an Aqib-signed decision note |
| FR4 | Focus theft from the MAX program | M×H | F9 + FG0 sequencing gate; S/M effort cap; if MAX slips, fleet waits |
| FR5 | Driver-data privacy breach | L×H | F8: class + expiry only, `fleet_admin`-restricted, HR privacy convention; FD-6 confirms custody |
| FR6 | Anomaly false positives erode trust | M×L | Flags prompt review, never auto-correct; thresholds tuned on the FD-3 baseline before alerting anyone |
| FR7 | Duplicate cost capture (job card FJD vs BC invoice) | M×M | F1 invariant: fleet stores references + operational figures; finance figures reconciled to BC via `invoice_ref` spot checks at F2 acceptance |
| FR8 | Key-person concentration | M×M | Same pattern as MAX R8: everything in repo, CLAUDE.md invariants, runbook, Prasanna briefed |

---

## 11. Proposed Jira breakdown (KAN project)

Raised only after FG0 — listed for review:

- **E-FLT0 — Foundations & census:** schema migration · RBAC roles · census walkaround + seed loads · FA mapping (FD-2) · renewal seed with no-blank rule
- **E-FLT1 — Register & compliance:** vehicle CRUD · meter capture (mobile) · renewals + chained renewal flow · reminder engine + queue/email · driver licence records (F8)
- **E-FLT2 — Maintenance:** service plans · draft-job-card generation · job card lifecycle + events · cost/`po_ref` capture · assignment log · downtime reporting
- **E-FLT3 — Fuel & analytics:** fill form · statement import + verification queue · consumption/cost views · anomaly flags · Aqib baseline dashboard

---

## 12. Decision gates and open items

| Gate | Closes when | Owner |
|---|---|---|
| **FG0** | This plan approved **and** MAX Stage 1 acceptance signed — whichever is later | Aqib |
| **FG1** | F1 adoption acceptance (clean quarter) → F2 proceeds | Sameer |
| **FG2** | F3 baseline reviewed → module declared steady-state; v2.0 as-built issued | Aqib |

**Decisions to close at FG0:**

- **FD-1** Site and entity scope: which GMG sites/plants; confirm vehicle count from census (Superstore excluded per F10)
- **FD-2** Fixed-asset mapping: FA extract from finance; policy for vehicles not on the FA register
- **FD-3** Fuel data source: which fuel-card vendor statements exist (format/frequency), or manual-only to start
- **FD-4** Workshop model: internal workshop with BC-stocked parts vs external-only (drives whether job cards ever reference BC item numbers)
- **FD-5** Notification channel: in-app queue + email digest via no-reply mailbox — confirm recipients and cadence
- **FD-6** Driver licence data custody: confirm with HR that class/expiry can live in the module under F8, or reminders only with HR holding the data
- **FD-7** Statutory inspection requirements: confirm forklift/plant inspection types and frequencies with the OHS/compliance owner so `renewals.kind` and default `reminder_days` are right on day one

---

## 13. Document control

| Version | Date | Change |
|---|---|---|
| v1.0-draft | 20 Jul 2026 | Initial plan for Aqib/Prasanna review |
| v1.1 | — | Post-FG0: FD-1..FD-7 recorded, census scheduled, Jira epics raised |
| v2.0-as-built | — | At FG2: re-issued as the as-built record |

*Extension of `golden-operations-platform-master`; sequenced per `max-replacement-build-plan` R9/F9. Invariants in §2 are the authoritative copy for the repo CLAUDE.md.*
