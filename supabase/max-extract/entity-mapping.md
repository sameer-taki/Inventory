# MAX → max_stage entity mapping (D-1 worksheet)

Fill the **MAX source** columns during schema discovery (`discover_max_schema.sql`).
The **payload key** column is the contract the extraction runner and loaders rely
on: `extract.mjs` must emit each landed row's `payload` with these JSON keys
(alias the real MAX columns in the `SOURCES` query), and the loaders read them.
Pin these and the whole pipeline runs unchanged.

Legend: **key** = natural/business key used for `natural_key` and matching.

## 1. parts → `ops.external_refs` (system='max')  ·  loader: `load_part_xrefs` (shipped)
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `part_no` **(key)** | MAX part/item number | `________.________` |
| `bc_item_no` | BC item no if MAX stores it (else blank → match by part_no) | `________.________` |
| `description` | part description (for the unmatched list) | `________.________` |

**Gate (D-6):** `max_stage.v_unmatched_parts` must be empty (100% match).

## 2. work_centres → `mfg.work_centres`  ·  loader: #2 (write to confirmed shapes)
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `wc_code` **(key)** | work-centre code | `________.________` |
| `name` | description | `________.________` |
| `plant` | plant/site | `________.________` |
| `daily_capacity` | capacity per day (minutes) | `________.________` |
| `labour_rate` / `overhead_rate` | rates for the cost roll (FJD/hr) | `________.________` |

## 3. boms → `mfg.boms` + `mfg.bom_lines`  ·  loader: #3
One row per component line. Grouped by `parent` into a versioned BOM
(`source='max_migration'`). Parent + component resolve to items via the part
cross-ref (load #1), so **run load #1 first**.
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `parent` **(key)** | finished/assembly part_no | `________.________` |
| `component` | component part_no | `________.________` |
| `qty_per` | quantity per parent | `________.________` |
| `scrap_pct` | line scrap % | `________.________` |
| `uom` | unit of measure | `________.________` |

**Gate:** explosion-equivalence vs MAX (same components + extended qty per parent).

## 4. routings → `mfg.routings` + `mfg.routing_operations`  ·  loader: #4
One row per operation, grouped by `routing_no`/`part_no`.
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `part_no` **(key)** | item the routing is for | `________.________` |
| `op_seq` | operation sequence | `________.________` |
| `wc_code` | work-centre code (→ work_centre_id) | `________.________` |
| `setup_min` / `run_min` | setup + run-per-unit minutes | `________.________` |

**Gate:** std-hours total per work centre matches MAX.

## 5. planner_params → `mfg.planning_params`  ·  loader: #5
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `part_no` **(key)** | item | `________.________` |
| `lead_time_days` | planning lead time | `________.________` |
| `safety_stock` | safety stock | `________.________` |
| `lot_policy` / `fixed_or_min_qty` / `order_multiple` | lot sizing | `________.________` |
| `make_or_buy` | make vs buy | `________.________` |

## 6. open_production_orders / wip_balances  ·  **burn-down preferred**
Plan §10 prefers *not* migrating open orders: release no new MAX orders after M2
go-live and let existing ones burn down; migrate only long-runners. Confirm with
Aqib which (if any) migrate; land them here only if so.
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `order_no` **(key)** | production order no | `________.________` |
| `part_no` / `qty` / `qty_done` / `due_date` / `status` | order state | `________.________` |

## 7. lot_history → genealogy (`source='max_history'`)  ·  read-only context
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `output_lot` **(key)** / `consumed_lot` / `item` / `qty` | historical edges | `________.________` |

## 8. mrp_recommendations → shadow-run diff (`mfg.v_mrp_shadow_diff`) (shipped)
| payload key | meaning | MAX table.column (confirm) |
|---|---|---|
| `part_no` **(key)** / `bc_item_no` | item | `________.________` |
| `kind` (make/buy) / `qty` / `due_date` | MAX's suggestion | `________.________` |
