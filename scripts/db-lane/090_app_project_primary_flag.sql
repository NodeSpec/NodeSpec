-- db-lane 090: a project made in the app has its one branch flagged primary
-- (item 16, owner 2026-09-26).
--
--   A project whose only branch is an unflagged 'main' (the app's New
--   project before the fix) is flagged; so is a project whose only branch
--   has another name; a project with a flagged primary keeps it and its
--   stray unflagged 'main' stays unflagged; a project with an unflagged
--   'main' beside an unflagged feature row gets main; a legacy project with
--   two unflagged rows and no main is left alone; the second run changes
--   nothing more.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db900000-0000-4000-8000-000000000001';
BEGIN
  IF to_regclass('public.idx_branches_one_primary') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260823150000 (branches.is_primary) first';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-090-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db900000-0000-4000-8000-000000000010', 'db-lane 090 app project', v_owner),
    ('db900000-0000-4000-8000-000000000020', 'db-lane 090 single develop', v_owner),
    ('db900000-0000-4000-8000-000000000030', 'db-lane 090 flagged', v_owner),
    ('db900000-0000-4000-8000-000000000040', 'db-lane 090 main and feature', v_owner),
    ('db900000-0000-4000-8000-000000000050', 'db-lane 090 two legacy', v_owner);
  DELETE FROM public.branches WHERE project_id::text LIKE 'db900000-%';
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES
    ('db900000-0000-4000-8000-0000000000a1', 'db900000-0000-4000-8000-000000000010', 'main', v_owner, false),
    ('db900000-0000-4000-8000-0000000000b1', 'db900000-0000-4000-8000-000000000020', 'develop', v_owner, false),
    ('db900000-0000-4000-8000-0000000000c1', 'db900000-0000-4000-8000-000000000030', 'develop', v_owner, true),
    ('db900000-0000-4000-8000-0000000000c2', 'db900000-0000-4000-8000-000000000030', 'main', v_owner, false),
    ('db900000-0000-4000-8000-0000000000d1', 'db900000-0000-4000-8000-000000000040', 'main', v_owner, false),
    ('db900000-0000-4000-8000-0000000000d2', 'db900000-0000-4000-8000-000000000040', 'feature/x', v_owner, false),
    ('db900000-0000-4000-8000-0000000000e1', 'db900000-0000-4000-8000-000000000050', 'design-a', v_owner, false),
    ('db900000-0000-4000-8000-0000000000e2', 'db900000-0000-4000-8000-000000000050', 'design-b', v_owner, false);
END $$;

\ir ../../supabase/migrations/20260926130000_v3_16_primary_flag_for_app_projects.sql
\ir ../../supabase/migrations/20260926130000_v3_16_primary_flag_for_app_projects.sql

DO $$
DECLARE
  flagged text[];
BEGIN
  SELECT array_agg(right(id::text, 2) ORDER BY id) INTO flagged
    FROM public.branches WHERE project_id::text LIKE 'db900000-%' AND is_primary;
  IF flagged IS DISTINCT FROM ARRAY['a1', 'b1', 'c1', 'd1'] THEN
    RAISE EXCEPTION 'db-lane 090: expected the app main, the single develop, the kept primary and the main beside a feature flagged; got %', flagged;
  END IF;
  RAISE NOTICE 'db-lane 090: an app project''s main and a lone branch are flagged; a flagged primary is kept; main wins beside a feature; two legacy rows with no main are left; replay changes nothing';
END $$;

ROLLBACK;
