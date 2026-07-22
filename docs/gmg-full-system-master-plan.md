# GMG Operations — Full System Master Plan

**Golden Manufacturers Group · One platform, every module, one sequence**

| | |
|---|---|
| Version | v2.0 — Draft for review |
| Date | 20 July 2026 |
| Prepared by | Sameer (AI & Technology Lead) |
| Approval | Aqib Razak (Managing Director) |
| Infra actions | Prasanna (IT Manager) |
| Supersedes | golden-operations-platform-master v1 (June 2026) as the top-level index |
| Child documents | max-replacement-build-plan v1.0 · fleet-module-build-plan v1.0 · procurement app plan (KAN-37–42) · Accura augmentation plan · department agents suite |

---

## 1. Purpose and how to read this

Since the June master reference, two programs have landed on the platform: the **MAX ERP replacement** (a full manufacturing build) and the **fleet module**. This document is the new top of the hierarchy — the one place that shows the *entire* system: every system of record, every module (live, building, planned, or ring-fenced), one consolidated sequence, and every open decision and gate in a single register.

It deliberately does **not** duplicate detail. DDL, integration contracts, migration plans, and per-module risk registers live in the child documents. If this document and a child disagree, this document's *sequencing and boundaries* win; the child's *technical detail* wins.

**The organising idea is unchanged:** one platform, not one product. The systems of record stay (except MAX, which is being retired); golden-gateway unifies them; every module plugs into the same canonical API and database.

---

## 2. The full landscape — systems of record

**End state** (after MAX decommission):

| System | Owns | Status |
|---|---|---|
| **BC Essentials** | Item master, inventory, lot/serial master, purchasing, costing, finance (GL/AP/AR), fixed assets | Master — permanent |
| **Kiwiplan** | Corrugated production, scheduling, production BOMs | Permanent (read-only integration; never mirrored) |
| **Accura** | Label/print estimating and production stream | Permanent system of record; augmented, not replaced |
| **golden-operations-platform** | Everything else: workflow spine, procurement, quality, manufacturing (ex-MAX scope), fleet, dashboards, agents | The build — this document |
| **Azure SQL DWH (ADF)** | Analytical landing for BC + Kiwiplan + Accura | Live |
| ~~MAX ERP~~ | ~~Production orders, BOMs, routings, MRP, lot genealogy~~ | **Sunset** — retired domain-by-domain per MAX plan Stages 1–4 |

**Transition state:** MAX remains authoritative for each of its domains until that domain passes parallel-run acceptance (MAX plan invariant I7). The platform reads MAX via the read-only `max_ro` login for migration and daily reconciliation — never writes to it.

**Out of scope of this document:** Superstore (fully isolated separate organisation — its PO Analysis app is its own track) and personal/BizLMS systems.

---

## 3. Whole-system architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TIER 3 — Applications & agents                                          │
│  Procurement · Exec Dashboard · Quality/NCR/CAPA · Production ·          │
│  Planning (MPS/MRP) · Capacity · Fleet · Maintenance* · Connected        │
│  Worker* · 8 department agents (read-only chat layer)                    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ REST · platform SSO · RBAC
                 ┌──────────────▼───────────────┐
│  TIER 2        │        golden-gateway         │  single writer ·
│  Canonical     │  FastAPI · canonical API      │  external_refs ·
│  layer         │  integration_outbox · events  │  idempotency keys
                 └──┬────────────┬───────────────┘
        canonical DB│            │ integration bridge (Azure VM GML-AI · MCP Hub)
┌───────────────────▼──┐      ┌──▼────────────────────────────────────────┐
│ Postgres              │      │ TIER 1 — Systems of record                │
│  ops      (workflow)  │      │  BC Essentials  172.16.1.10 (OData/NTLM)  │
│  mfg      (MAX scope) │      │  Kiwiplan SQL   read-only (kiwiplan_ro)   │
│  quality              │      │  Accura         ODBC path (gated)         │
│  fleet                │      │  MAX SQL        read-only (max_ro) —      │
│  max_stage (temp)     │      │                 migration/shadow only     │
└───────────────────────┘      └───────────────────────────────────────────┘
        │
        └──► Azure SQL DWH (ADF, self-hosted IR) ──► Power BI / analytics

* future modules, catalogued but not scheduled
```

Hosting and auth follow current platform conventions; nothing in this document is host-specific. The Azure VM (GML-AI) remains the integration bridge to all LAN-side systems of record.

---

## 4. Consolidated invariants (platform level)

Each module carries its own CLAUDE.md block (MAX plan §2 I1–I10; fleet plan §2 F1–F10). These platform-level rules sit above all of them:

```
PLATFORM INVARIANTS — apply to every module, present and future

P1  BC Essentials is the financial and inventory master. No module ever
    becomes a second master or posts GL directly.

P2  golden-gateway is the single writer to every system of record. All
    external writes go through integration_outbox with idempotency keys.

P3  Every cross-system entity is mapped in external_refs; every material
    state change is appended to an event log. No silent mutation anywhere.

P4  All numbers that drive decisions or transactions are deterministic
    SQL/Python. Claude drafts, explains, summarises — it never computes
    a quantity of record.

P5  Kiwiplan owns corrugated. The kit BOM stays materials-only and never
    mirrors Kiwiplan's production BOM.

P6  Accura is augmented, never replaced. Rebuild a module only where it
    demonstrably outperforms Accura (per the Accura plan gates).

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

---

## 5. Complete module catalogue

| # | Module | Program / phase | Status | Detail doc |
|---|---|---|---|---|
| 1 | golden-gateway canonical layer + BC/Kiwiplan adapters | Platform P0 | **Live** (BC + Kiwiplan adapters live via MCP Hub/bridge) | Platform master v1 |
| 2 | Accura adapter (ODBC read path) | Accura plan P1 | **Blocked/gated** — £550 ODBC driver vs £4,000 XML toolkit decision with Aqib | Accura plan |
| 3 | DWH ingestion (ADF, three sources) + freshness SLA | Platform P0 | **Live** (SLA value reconfirmation = MAX D-7) | Platform master v1 |
| 4 | Procurement app (RFQ, PO lifecycle, approvals) | Platform P1 · KAN-37–42 | **Built — Phase 1 scaffold**; port/decision items pending | Procurement plan |
| 5 | Order-to-cash spine (orders, order_lines, events) | Platform P1 | **Partial** — canonical schema live, app thin | Platform master v1 |
| 6 | Executive dashboard (KAN-9) + print/quality tiles | Platform P2 · Accura P3 | **In progress** | Platform master v1 · Accura plan |
| 7 | **Quality / NCR / CAPA** | **MAX M1 · Platform P3 · Accura P4 — one build, triple duty** | **Next build** (first after G0) | MAX plan §5, §7 |
| 8 | Mfg BOMs / routings / work centres (+ ECO-lite) | MAX M3 | Planned | MAX plan §7 |
| 9 | Production orders + shop-floor execution + BC write-back | MAX M2 | Planned (D-3 spike first) | MAX plan §6 |
| 10 | MRP/MPS netting engine + action messages | MAX M4 | Planned — built last, validated hardest | MAX plan §8 |
| 11 | Capacity scheduling (advisory → finite) | MAX M5 | Planned | MAX plan §5 |
| 12 | Lot/serial genealogy through production | MAX M6 | Planned (edges captured from first M2 posting) | MAX plan §9 |
| 13 | MAX data migration + decommission | MAX M0/M7 | Planned | MAX plan §10–11 |
| 14 | **Fleet** (register, renewals, job cards, fuel analytics) | Fleet F0–F3 | Planned — **gated after MAX Stage 1** (FG0) | Fleet plan |
| 15 | Maintenance / APM (asset register, PM, work orders) | Platform P3 (future) | Catalogued, unscheduled — sits beside fleet; shares work-centre keys | Platform master v1 |
| 16 | Planning/forecasting (statistical demand off DWH) | Platform P4 (future) | Catalogued — end-state: forecast feeds MPS (module 10) | Platform master v1 |
| 17 | Connected Worker (SOPs on floor tablets) | Platform P4 (future) | Catalogued, unscheduled | Platform master v1 |
| 18 | 8 department agents (Finance…Quality) | Platform P5 | **Live** as knowledge agents (read-only); wiring to module APIs comes after each module exists | Agents suite |
| 19 | OEE / OT capture | Ring-fenced eval track | Not scheduled (P7) | Platform master v1 |
| 20 | Estimating rebuild (print) | Accura P5 | **Gated** — build-vs-buy decision with Aqib, no code before | Accura plan |

**Schema map:** `ops` (workflow spine, external_refs, outbox, events, users/roles) · `mfg` (modules 8–12) · `quality` (module 7) · `fleet` (module 14) · `max_stage` (module 13, temporary). One database, one gateway.

---

## 6. Unified roadmap — the one sequence

The honest constraint first: this is largely a **one-builder-plus-Claude** program. Three programs cannot run at full width simultaneously, so the priority stack is explicit and everything else yields to it:

**Priority stack (locked until Aqib changes it):**

1. **MAX program** — it retires licence cost and carries the only hard external dependency (contract notice with Srini). Quality ships first and does triple duty (MAX Stage 1 + Platform P3 + Accura P4).
2. **Platform spine continuation** — only where it unblocks MAX (e.g. procurement app owns the MRP planned-purchase handoff, D-5).
3. **Accura augmentation** — dashboard tiles ride along cheaply; the ODBC driver decision and estimating gate wait for Aqib.
4. **Fleet** — enters build only at FG0 (after MAX Stage 1 acceptance).
5. **Agents / Connected Worker / forecasting** — after the data they sit on exists.

**Sequence with gates:**

```
NOW ──► G0 (MAX plan signed; D-1..D-8 dispositioned)
  │
  ├─ M0 Foundations: max_ro · census D-1 · cross-ref audit D-6 · D-3 spike
  │
  ├─ M1 QUALITY build ───────────► Stage 1 acceptance (adoption)
  │        (triple duty)                    │
  │                                         ├──► G1: E-MAX3 production build
  │                                         └──► FG0: FLEET F0 census may start
  ├─ M3 BOM/routing migration (overlaps M1)
  │
  ├─ M2 Production + BC write-back ──► Stage 2 parallel run (2–4 wks)
  │                                         │  + mock-recall drill (M6)
  │                                         ▼
  │                                   G2: MAX execution OFF
  ├─ M4 MRP/MPS (harness first) ─────► Stage 3 shadow-run (≥2 cycles)
  │                                         ▼
  │                                   G3: MAX planning OFF ─► M7 decommission
  │
  └─ FLEET F1→F2→F3 proceed in the gaps after FG0 (S/M effort, never
     blocking a MAX stage) ──► FG1, FG2
```

Calendar dates are deliberately absent, per the platform convention: the sequence and dependencies are fixed; dates get laid on at G0 once D-1 (plant/user census) sizes the parallel-run effort and capacity is confirmed.

---

## 7. Consolidated decision & gate register

Every open decision across all programs, one table. Owner = who closes it.

| Ref | Decision | Program | Owner | Status |
|---|---|---|---|---|
| PD-1 | Kiwiplan KMC inject mechanism + auth | Platform P0 | Sameer | Open (read path live; inject unproven) |
| PD-2 | Accura ODBC driver (£550) vs XML toolkit (£4,000) | Accura P1 | **Aqib** | Open — blocks Accura read path |
| PD-3 | Snapshot cadence + freshness SLA value | Platform P0 / MAX D-7 | Sameer | Reconfirm at G0 (MRP aborts on stale) |
| PD-4 | Canonical status enums per domain | Platform P0 | Sameer | Mostly closed; extend for mfg/fleet |
| D-1 | MAX plant/product streams + user census | MAX | Sameer | Open — blocks everything |
| D-2 | BC licence check (Team Member for shop floor) | MAX | Sameer→Aqib | Open |
| D-3 | BC write-back vehicle (assembly order vs item journal) | MAX | Spike | Open — 1-wk timebox in M0 |
| D-4 | Lot numbering scheme + serial custody | MAX | Sameer | Open |
| D-5 | Planned-purchase handoff via procurement app | MAX | Sameer | Recommended; confirm at G0 |
| D-6 | Part↔item cross-ref audit (100% gate) | MAX | Sameer | Open — biggest data risk |
| D-8 | MAX DB archive retention (suggest 7 yrs) | MAX | **Aqib** | Open |
| — | MAX contract notice + post-termination data access (Srini) | MAX | **Aqib** + Sameer | Open — before Stage 2 dates |
| FD-1..7 | Fleet decisions (census scope, FA mapping, fuel source, workshop model, notifications, driver-data custody, OHS frequencies) | Fleet | Sameer (+HR/finance) | Open — close at FG0 |
| PD-5 | Estimating build-vs-buy | Accura P5 | **Aqib** | Gated — no code before decision |

**Gates:** G0→G1→G2→G3 (MAX plan §14) · FG0→FG1→FG2 (fleet plan §12, FG0 compound with MAX Stage 1) · Accura gates per its plan.

**Platform hygiene (standing, not gated — Prasanna + Sameer):** rotate the BC integration credential from domain admin to a dedicated service account; NSG/SSH hardening on the bridge VM; close the off-box backup gap for platform Postgres. These predate both new programs and should not wait for them.

---

## 8. Consolidated risk register (program level)

Top risks across the whole system; module-level registers live in the child docs.

| # | Risk | L×I | Held by |
|---|---|---|---|
| S1 | **MRP correctness** — silent planning errors in live plant | M×H | MAX R1: harness + shadow-run + planner review |
| S2 | **Lot genealogy break** — recall capability gap across cutover | M×H | MAX R2: append-only edges + history import + recall drill at G2 |
| S3 | **MAX migration quality** (BOMs/routings/cross-ref) | H×H | MAX R3 + D-6 100% gate |
| S4 | **Program fragmentation** — three programs, one builder | H×H | §6 priority stack; FG0 compound gate; anything new needs an Aqib decision note |
| S5 | Parallel-run fatigue | H×M | MAX R4: timeboxed, automated reconciliation |
| S6 | BC posting integrity under retry | M×H | P2 outbox/idempotency + finance reconciliation in Stage 2 |
| S7 | Key-person concentration | M×H | Everything-as-code, CLAUDE.md invariants, runbooks, Prasanna briefed, as-built re-issues |
| S8 | Scope creep across ring-fences (OEE, telematics, TMS, Accura rebuild) | M×M | P6/P7 invariants; Aqib-signed note to breach |
| S9 | Integration credential exposure (domain-admin BC account) | M×H | Hygiene item in §7 — do not defer past G0 |
| S10 | Adoption failure on shop floor / workshop | M×M | Adoption-style acceptance gates everywhere; users in UI design; pilot-first rollouts |

---

## 9. Jira map (KAN board)

| Epic(s) | Program | Status |
|---|---|---|
| KAN-9 | Exec dashboard (Platform P2) | In progress |
| KAN-37–42 | Procurement app (Platform P1) | Built/iterating |
| E-MAX0–7 | MAX program | **Raise after G0** (MAX plan §13) |
| E-FLT0–3 | Fleet | **Raise after FG0** (fleet plan §11) |
| Accura epics | Accura augmentation | Raise after PD-2/PD-5 close |

Convention unchanged: every ticket carries acceptance criteria; epics map 1:1 to the module catalogue rows; nothing is raised before its gate.

---

## 10. Operating rhythm and document hierarchy

- **Monthly review with Aqib:** this document's §6 sequence + §7 register, updated. Gate sign-offs are recorded as decision notes attached to the relevant child doc.
- **Versioning:** child docs re-issue as as-built at their final gates (MAX v2.0 at decommission; fleet v2.0 at FG2); this master increments whenever the catalogue, sequence, or an invariant changes.
- **Hierarchy:**

```
gmg-full-system-master-plan (this doc, v2.0)
 ├── max-replacement-build-plan v1.0        (modules 7–13)
 ├── fleet-module-build-plan v1.0           (module 14)
 ├── procurement app plan · KAN-37–42       (module 4)
 ├── Accura augmentation plan               (modules 2, 6, 20)
 ├── platform master v1 (Jun 2026)          (modules 1, 3, 5, 15–19 detail)
 └── department agents suite                (module 18)
```

---

## 11. Document control

| Version | Date | Change |
|---|---|---|
| v2.0-draft | 20 Jul 2026 | New top-level index: incorporates MAX program + fleet module; consolidated invariants, catalogue, sequence, decision and risk registers |
| v2.1 | — | Post-G0: dates laid onto §6, decisions dispositioned |
| v2.x | — | Increment at each gate / catalogue change |

*This document supersedes golden-operations-platform-master v1 as the index; v1 remains the detail reference for modules it owns. Invariants: §4 here, plus each module's CLAUDE.md block.*
