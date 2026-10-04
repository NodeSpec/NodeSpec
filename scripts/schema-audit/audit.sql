-- Schema audit — the CATALOG half. Run against a database that has the
-- migration chain applied (the local Supabase stack after `supabase db
-- reset`, or the stock-Postgres replay in this directory). Emits ONE jsonb
-- document; scripts/schema-audit/run.mjs classifies it and adds the static
-- half (migration ledger ↔ code). Runs as-is in psql or the SQL editor.
--
-- Classes the runner treats as HARD (exit 1):
--   functions_missing_relations  a public function whose body names a table
--                                or view that does not exist (dropped-table
--                                debris, it raises the day it is called); a
--                                function whose comment says it "returns SQL
--                                as text" holds a text constant, not reads
--   duplicate_trigger_functions  identical trigger-function bodies under
--                                different names
--   unindexed_fks                a foreign-key column with no index (cascades
--                                table-scan)
--   rls_no_policy_uncommented    RLS on with zero policies and no comment
--                                saying that posture is intentional
-- Everything else is inventory the runner prints for the reader.

WITH tables AS (
  SELECT c.oid, c.relname,
         c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
         obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
relations AS (
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
),
fks AS (
  SELECT con.oid, con.conrelid::regclass::text AS from_table,
         a.attname AS from_col, con.confrelid::regclass::text AS to_table,
         con.conkey, con.conrelid
  FROM pg_constraint con
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
),
functions AS (
  SELECT p.oid, p.proname,
         -- comments stripped: prose says "from the tree" too
         regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') AS body,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
         coalesce(obj_description(p.oid, 'pg_proc'), '') AS comment
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
),
-- Relation names a function body reads or writes: the identifier after
-- FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM (never IS DISTINCT FROM),
-- unqualified or public., not followed by "(" or "." (set-returning
-- functions, qualified columns), and not one of the function's own CTEs,
-- temp tables or declared variables.
function_refs AS (
  SELECT f.proname, f.signature,
         lower(regexp_replace(m[1], '^public\.', '')) AS rel
  FROM functions f,
       LATERAL regexp_matches(f.body,
         '(?<!DISTINCT\s)(?:\mFROM|\mJOIN|\mUPDATE|\mINSERT\s+INTO|\mDELETE\s+FROM)\s+((?:public\.)?[a-z_][a-z0-9_]*)(?![a-z0-9_(.])', 'gi') AS m
),
function_ctes AS (
  SELECT f.proname, lower(m[1]) AS cte
  FROM functions f,
       LATERAL regexp_matches(f.body, '\m([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*(?:(?:NOT\s+)?MATERIALIZED\s+)?\(', 'gi') AS m
),
function_temp_tables AS (
  SELECT f.proname, lower(m[1]) AS tmp
  FROM functions f,
       LATERAL regexp_matches(f.body, '\mCREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)', 'gi') AS m
),
function_vars AS (
  SELECT f.proname, lower(m[1]) AS var
  FROM functions f,
       LATERAL regexp_matches(coalesce(substring(f.body FROM '(?i)\mDECLARE\M(.*?)\mBEGIN\M'), ''),
                              '^\s*([a-z_][a-z0-9_]*)\s+[a-z]', 'gin') AS m
),
functions_missing_relations AS (
  SELECT DISTINCT r.signature, r.rel
  FROM function_refs r
  WHERE r.rel NOT IN (SELECT relname FROM relations)
    -- the posture made legible (as "service role only" is on a table): a
    -- function that returns SQL as text holds prose, not reads
    AND NOT EXISTS (SELECT 1 FROM functions f WHERE f.proname = r.proname AND f.comment ~* 'returns sql as text')
    AND r.rel NOT IN (SELECT cte FROM function_ctes c WHERE c.proname = r.proname)
    AND r.rel NOT IN (SELECT tmp FROM function_temp_tables t WHERE t.proname = r.proname)
    AND r.rel NOT IN (SELECT var FROM function_vars v WHERE v.proname = r.proname)
    AND r.rel !~ '^(v_|p_|_)'
    AND r.rel !~ '^pg_' AND r.rel <> 'information_schema'
    AND r.rel NOT IN ('only', 'select', 'lateral', 'unnest', 'generate_series', 'jsonb_array_elements',
                      'jsonb_each', 'json_each', 'regexp_matches', 'now', 'true', 'false', 'null',
                      'new', 'old', 'excluded', 'dual', 'values', 'set')
),
trigger_functions AS (
  SELECT DISTINCT f.proname, md5(regexp_replace(f.body, '\s+', ' ', 'g')) AS body_hash
  FROM pg_trigger t JOIN functions f ON f.oid = t.tgfoid
  WHERE NOT t.tgisinternal
),
duplicate_trigger_functions AS (
  SELECT body_hash, array_agg(proname ORDER BY proname) AS functions
  FROM trigger_functions GROUP BY body_hash HAVING count(*) > 1
),
unindexed_fks AS (
  SELECT from_table, from_col, to_table FROM fks
  WHERE array_length(conkey, 1) = 1
    AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = fks.conrelid AND i.indkey[0] = fks.conkey[1])
),
islands AS (
  SELECT t.relname, t.comment FROM tables t
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.contype = 'f' AND (x.conrelid = t.oid OR x.confrelid = t.oid))
),
soft_id_columns AS (
  SELECT c.table_name, c.column_name, c.data_type,
         col_description(('public.' || c.table_name)::regclass, c.ordinal_position) AS comment
  FROM information_schema.columns c
  JOIN tables t ON t.relname = c.table_name
  WHERE c.table_schema = 'public' AND c.column_name ~ '_ids?$' AND c.column_name <> 'id'
    AND NOT EXISTS (SELECT 1 FROM fks WHERE fks.conrelid = t.oid AND fks.from_col = c.column_name)
)
SELECT jsonb_build_object(
  'tables', (SELECT count(*) FROM tables),
  'functions', (SELECT count(*) FROM functions),
  'triggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal),
  'db_tables', (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM tables),
  'functions_missing_relations', (SELECT coalesce(jsonb_agg(jsonb_build_object('function', signature, 'relation', rel)
                                   ORDER BY signature, rel), '[]') FROM functions_missing_relations),
  'duplicate_trigger_functions', (SELECT coalesce(jsonb_agg(to_jsonb(functions)), '[]') FROM duplicate_trigger_functions),
  'unindexed_fks', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', from_table, 'column', from_col, 'references', to_table)
                     ORDER BY from_table, from_col), '[]') FROM unindexed_fks),
  'rls_no_policy_uncommented', (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM tables
                                WHERE rls AND policies = 0 AND coalesce(comment, '') !~* 'service.role|no policies on purpose'),
  'rls_disabled', (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM tables WHERE NOT rls),
  'uncommented_tables', (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM tables WHERE comment IS NULL),
  'islands', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', relname, 'commented', comment IS NOT NULL) ORDER BY relname), '[]') FROM islands),
  'soft_id_columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type,
                       'commented', comment IS NOT NULL) ORDER BY table_name, column_name), '[]') FROM soft_id_columns)
);
