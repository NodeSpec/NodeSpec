-- db-lane 083: every project's primary branch carries its flag (V3 AD.4,
-- finding D15).
--
--   A template project whose one branch 'main' was created without the flag
--   gets it; a project whose primary was renamed (develop, flagged) keeps its
--   one primary and its unflagged 'main' row stays unflagged; the backfill
--   run twice changes nothing more.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db830000-0000-4000-8000-000000000001';
BEGIN
  IF to_regclass('public.idx_branches_one_primary') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260823150000 (branches.is_primary) first';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-083-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db830000-0000-4000-8000-000000000010', 'db-lane 083 template', v_owner),
    ('db830000-0000-4000-8000-000000000020', 'db-lane 083 renamed', v_owner);
  DELETE FROM public.branches WHERE project_id IN ('db830000-0000-4000-8000-000000000010', 'db830000-0000-4000-8000-000000000020');
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES
    ('db830000-0000-4000-8000-0000000000b1', 'db830000-0000-4000-8000-000000000010', 'main', v_owner, false),
    ('db830000-0000-4000-8000-0000000000b2', 'db830000-0000-4000-8000-000000000020', 'develop', v_owner, true),
    ('db830000-0000-4000-8000-0000000000b3', 'db830000-0000-4000-8000-000000000020', 'main', v_owner, false);
END $$;

\ir ../../supabase/migrations/20260925120000_v3_ad4_primary_flag_backfill.sql
\ir ../../supabase/migrations/20260925120000_v3_ad4_primary_flag_backfill.sql

DO $$
BEGIN
  IF NOT (SELECT is_primary FROM public.branches WHERE id = 'db830000-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION 'the template project''s main branch was not flagged';
  END IF;
  IF (SELECT is_primary FROM public.branches WHERE id = 'db830000-0000-4000-8000-0000000000b3') THEN
    RAISE EXCEPTION 'a renamed primary''s stray main row was flagged';
  END IF;
  IF (SELECT count(*) FROM public.branches WHERE project_id = 'db830000-0000-4000-8000-000000000020' AND is_primary) <> 1 THEN
    RAISE EXCEPTION 'the renamed project no longer has exactly one primary';
  END IF;
  RAISE NOTICE 'db-lane 083: template main flagged, renamed primary kept, replay changes nothing';
END $$;

ROLLBACK;
