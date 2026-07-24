-- ============================================================================
-- discover_max_schema.sql  ·  MAX schema discovery (plan D-1, E-MAX0)
-- ----------------------------------------------------------------------------
-- The FIRST on-site step. Read-only inventory of the MAX SQL Server so the real
-- table/column names can be pinned into entity-mapping.md, extract.mjs (SOURCES)
-- and the loaders. Run as max_ro (or sysadmin) against the MAX database; save
-- each result set. Touches only catalog views — it never reads or writes data.
-- ============================================================================

USE [MAX];  -- confirm the real MAX database name
GO

-- 1) every user table with an approximate row count (find the in-scope tables)
SELECT  s.name  AS [schema],
        t.name  AS [table],
        SUM(p.rows) AS approx_rows
FROM    sys.tables t
JOIN    sys.schemas s      ON s.schema_id = t.schema_id
JOIN    sys.partitions p   ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY s.name, t.name
ORDER BY approx_rows DESC, s.name, t.name;
GO

-- 2) columns for every table (name, type, length, nullability) — the raw
--    material for the column → payload-key mapping
SELECT  c.TABLE_SCHEMA AS [schema],
        c.TABLE_NAME   AS [table],
        c.ORDINAL_POSITION AS pos,
        c.COLUMN_NAME  AS [column],
        c.DATA_TYPE    AS type,
        c.CHARACTER_MAXIMUM_LENGTH AS max_len,
        c.IS_NULLABLE  AS nullable
FROM    INFORMATION_SCHEMA.COLUMNS c
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
GO

-- 3) primary / unique keys — the natural-key candidates per table
SELECT  tc.TABLE_SCHEMA AS [schema],
        tc.TABLE_NAME   AS [table],
        tc.CONSTRAINT_TYPE AS key_type,
        kcu.COLUMN_NAME AS [column],
        kcu.ORDINAL_POSITION AS key_pos
FROM    INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
JOIN    INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       AND kcu.TABLE_NAME = tc.TABLE_NAME
WHERE   tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_TYPE, kcu.ORDINAL_POSITION;
GO

-- 4) foreign keys — how the tables relate (e.g. BOM header ↔ component,
--    routing ↔ operation, order ↔ WIP)
SELECT  fk.name AS fk_name,
        sch.name + '.' + tp.name AS parent_table,
        cp.name AS parent_column,
        schr.name + '.' + tr.name AS referenced_table,
        cr.name AS referenced_column
FROM    sys.foreign_keys fk
JOIN    sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN    sys.tables tp   ON tp.object_id = fk.parent_object_id
JOIN    sys.schemas sch ON sch.schema_id = tp.schema_id
JOIN    sys.columns cp  ON cp.object_id = tp.object_id AND cp.column_id = fkc.parent_column_id
JOIN    sys.tables tr   ON tr.object_id = fk.referenced_object_id
JOIN    sys.schemas schr ON schr.schema_id = tr.schema_id
JOIN    sys.columns cr  ON cr.object_id = tr.object_id AND cr.column_id = fkc.referenced_column_id
ORDER BY parent_table, fk_name;
GO

-- 5) OPTIONAL sanity peeks once the in-scope tables are identified (read-only;
--    replace names with the real ones found above, keep TOP small):
-- SELECT TOP 20 * FROM dbo.Parts;
-- SELECT TOP 20 * FROM dbo.BOM;
-- SELECT TOP 20 * FROM dbo.Routing;
GO
