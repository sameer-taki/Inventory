#!/usr/bin/env node
// ============================================================================
// extract.mjs  ·  MAX → max_stage extraction runner (plan §10, E-MAX0/E-MAX7)
// ----------------------------------------------------------------------------
// Reads the in-scope MAX tables over the read-only `max_ro` login and lands each
// as a raw jsonb batch in max_stage (NO transformation — §10). Writes to the
// canonical Postgres DIRECTLY (max_stage is admin-only and not exposed to the
// Data API), so this runs as a backend job, never from the browser.
//
//   node extract.mjs                 # extract every in-scope entity from MAX
//   node extract.mjs --entity=parts  # just one entity
//   node extract.mjs --sample        # no MAX needed: land representative
//                                     # fixtures so the pipeline can be exercised
//
// Env:
//   SUPABASE_DB_URL   postgres connection string to the canonical DB (service).
//   MAX_MSSQL_URL     mssql connection string for MAX via max_ro (real runs).
//
// Deps (ops-only, not in the app bundle):  npm i pg mssql
// After landing, transform with the loaders (mfg/max_stage) and check
// max_stage.v_load_reconciliation. See README.md.
// ============================================================================

import pg from "pg";

// ── in-scope sources. `query` is the MAX SELECT (CONFIRM real columns in M0);
//    `key` derives the natural (business) key from a landed row for indexing.
const SOURCES = [
  { entity: "parts",                  query: "SELECT * FROM dbo.Parts",         key: (r) => r.part_no ?? r.PartNo },
  { entity: "work_centres",           query: "SELECT * FROM dbo.WorkCentre",    key: (r) => r.wc_code ?? r.Code },
  { entity: "boms",                   query: "SELECT * FROM dbo.BOM",           key: (r) => r.bom_no ?? r.BomNo },
  { entity: "routings",               query: "SELECT * FROM dbo.Routing",       key: (r) => r.routing_no ?? r.RoutingNo },
  { entity: "open_production_orders", query: "SELECT * FROM dbo.ProdOrder WHERE Status IN ('R','I')", key: (r) => r.order_no ?? r.OrderNo },
  { entity: "wip_balances",           query: "SELECT * FROM dbo.WIP",           key: (r) => r.order_no ?? r.OrderNo },
  { entity: "lot_history",            query: "SELECT * FROM dbo.LotHistory",    key: (r) => r.lot_no ?? r.LotNo },
  { entity: "planner_params",         query: "SELECT * FROM dbo.PlannerParm",   key: (r) => r.part_no ?? r.PartNo },
  { entity: "mrp_recommendations",    query: "SELECT * FROM dbo.MrpRecommend",  key: (r) => r.part_no ?? r.PartNo },
];
const ENTITIES = new Set(SOURCES.map((s) => s.entity)); // allowlist for the table name

// representative fixtures for --sample (shapes match the loaders' expectations)
const SAMPLE = {
  parts: [
    { part_no: "MF-TRAY-30", bc_item_no: "BC-MF-TRAY-30", description: "Moulded fibre tray 30" },
    { part_no: "MAXPULP", bc_item_no: "BC-RM-PULP-KRA", description: "Kraft pulp" },
    { part_no: "OBSOLETE-XYZ", description: "Discontinued part (no BC match)" },
  ],
  work_centres: [
    { wc_code: "WC-FORM", name: "Forming", plant: "Fibre Plant" },
    { wc_code: "WC-DRY", name: "Drying", plant: "Fibre Plant" },
  ],
  boms: [{ bom_no: "B-TRAY-30", parent: "MF-TRAY-30", component: "MAXPULP", qty_per: 2.0, scrap_pct: 5 }],
  routings: [{ routing_no: "R-TRAY-30", part_no: "MF-TRAY-30", op_seq: 10, wc_code: "WC-FORM", run_min: 0.5 }],
  mrp_recommendations: [
    { part_no: "MF-TRAY-30", kind: "make", qty: 90, due_date: "2026-08-15" },
    { part_no: "MAXPULP", bc_item_no: "BC-RM-PULP-KRA", kind: "buy", qty: 150, due_date: "2026-08-10" },
    { part_no: "MF-CARTON-A", kind: "make", qty: 25, due_date: "2026-08-20" },
  ],
};

const args = process.argv.slice(2);
const sample = args.includes("--sample");
const only = args.find((a) => a.startsWith("--entity="))?.split("=")[1];

async function rowsFor(src) {
  if (sample) return SAMPLE[src.entity] ?? [];
  const mssql = (await import("mssql")).default; // lazy: only needed for real runs
  const pool = await mssql.connect(process.env.MAX_MSSQL_URL);
  try {
    const res = await pool.request().query(src.query);
    return res.recordset;
  } finally {
    await pool.close();
  }
}

async function land(client, src, rows) {
  if (!ENTITIES.has(src.entity)) throw new Error(`unknown entity ${src.entity}`);
  const { rows: [batch] } = await client.query(
    `INSERT INTO max_stage.extract_batches (entity, source_rowcount, note)
     VALUES ($1, $2, $3) RETURNING batch_id`,
    [src.entity, rows.length, sample ? "sample extract" : "max_ro extract"],
  );
  for (const r of rows) {
    await client.query(
      // entity is validated against the allowlist above, so the identifier is safe
      `INSERT INTO max_stage.${src.entity} (batch_id, natural_key, payload) VALUES ($1, $2, $3)`,
      [batch.batch_id, src.key(r) ?? null, JSON.stringify(r)],
    );
  }
  return { entity: src.entity, batch_id: batch.batch_id, rows: rows.length };
}

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required");
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  try {
    const targets = SOURCES.filter((s) => !only || s.entity === only);
    for (const src of targets) {
      const rows = await rowsFor(src);
      const out = await land(client, src, rows);
      console.log(`landed ${out.entity}: ${out.rows} row(s) in batch #${out.batch_id}`);
    }
    console.log("done. Next: run the loaders and check max_stage.v_load_reconciliation.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
