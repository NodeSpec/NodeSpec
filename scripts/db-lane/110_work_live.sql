-- db-lane 110: Work hears its tables change (AL.4, migration 20261001150000).
--
--   The seven tables Work re-reads on a change are in the supabase_realtime
--   publication after the migration, and the migration replayed adds
--   nothing twice. A table with row level security off is refused: the
--   migration will not publish what Realtime could not filter per person.
--   Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
-- the migration runs as a deploy does
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regclass('public.outcome_derivations') IS NULL OR to_regclass('public.project_constraints') IS NULL
     OR to_regclass('public.workflow_steps') IS NULL OR to_regclass('public.ai_proposals') IS NULL THEN
    RAISE EXCEPTION 'db-lane 110: a table Work listens to is missing. Apply migration 20260914130000 and those before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  -- start from a publication without them, as an install before AL.4 was
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workflows') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflows;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_proposals') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.ai_proposals;
  END IF;
END $$;

\ir ../../supabase/migrations/20261001150000_v3_al4_work_live.sql
\ir ../../supabase/migrations/20261001150000_v3_al4_work_live.sql

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('workflows', 'workflow_steps', 'requirement_candidates', 'outcome_step_maps',
                       'outcome_derivations', 'project_constraints', 'ai_proposals');
  IF n <> 7 THEN RAISE EXCEPTION 'db-lane 110: % of the seven Work tables are published, expected 7', n; END IF;
END $$;

-- a table with RLS off is refused by name: the migration itself, run with
-- one table's RLS switched off, must stop
SAVEPOINT rls_off;
ALTER TABLE public.project_constraints DISABLE ROW LEVEL SECURITY;
\set ON_ERROR_STOP off
\set VERBOSITY terse
\ir ../../supabase/migrations/20261001150000_v3_al4_work_live.sql
\set ON_ERROR_STOP on
\set VERBOSITY default
ROLLBACK TO SAVEPOINT rls_off;
SELECT (:'LAST_ERROR_MESSAGE' LIKE '%public.project_constraints has row level security off%') AS refused \gset
\if :refused
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-lane 110: the migration did not refuse a table with RLS off'; END $$;
\endif

DO $$ BEGIN RAISE NOTICE 'db-lane 110: the seven Work tables are published once, replay adds nothing, RLS off is refused: all hold'; END $$;

ROLLBACK;
