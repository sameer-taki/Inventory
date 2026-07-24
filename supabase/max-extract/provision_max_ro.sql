-- ============================================================================
-- provision_max_ro.sql  ·  read-only login on the MAX SQL Server (plan E-MAX0)
-- ----------------------------------------------------------------------------
-- Run ON THE ON-PREM MAX SQL SERVER as a sysadmin (Prasanna, Phase 0). Mirrors
-- the existing `kiwiplan_ro` pattern: a least-privilege, READ-ONLY login used
-- only for schema discovery, migration extraction into max_stage, and the
-- daily parallel-run reconciliation. It can never write to MAX.
--
-- After decommission (Stage 4) drop this login (see the tail of this file).
-- ============================================================================

-- 1) server-level login. Use a strong secret from the password vault, NOT this
--    placeholder, and rotate per Golden's policy.
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'max_ro')
    CREATE LOGIN [max_ro] WITH PASSWORD = '<SET-FROM-VAULT>', CHECK_POLICY = ON;
GO

-- 2) database user in the MAX database (confirm the real DB name in M0).
USE [MAX];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'max_ro')
    CREATE USER [max_ro] FOR LOGIN [max_ro];
GO

-- 3) read-only across the database, then explicitly deny every write path
--    (defense in depth — db_datareader already excludes writes).
ALTER ROLE [db_datareader] ADD MEMBER [max_ro];
GO
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, CONTROL TO [max_ro];
GO
-- keep it out of anything that could mutate or read beyond the in-scope data
DENY VIEW ANY DATABASE TO [max_ro];
GO

-- 4) OPTIONAL least-privilege tightening: instead of db_datareader across the
--    whole DB, grant SELECT only on the in-scope objects. Uncomment + list the
--    real MAX object names once discovered in M0 (D-1), then remove the
--    db_datareader membership above.
-- GRANT SELECT ON OBJECT::dbo.Parts        TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.BOM          TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.BOMComponent TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.Routing      TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.RoutingOper  TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.WorkCentre   TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.ProdOrder    TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.WIP          TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.LotHistory   TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.PlannerParm  TO [max_ro];
-- GRANT SELECT ON OBJECT::dbo.MrpRecommend TO [max_ro];  -- shadow-run diff source

-- 5) NETWORK PATH: the platform reaches MAX only through the existing Azure
--    bridge VM (GML-AI / MCP Hub), never directly. Add a firewall rule allowing
--    that host to reach the MAX SQL Server on 1433; do NOT expose MAX publicly.

-- ── Decommission (Stage 4) — run after the 30-day quiet period ──────────────
-- USE [MAX];      DROP USER  IF EXISTS [max_ro]; GO
-- USE [master];   DROP LOGIN IF EXISTS [max_ro]; GO
