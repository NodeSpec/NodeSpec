-- db-lane 030: the dead table is gone, and nothing beside it went with it.
--
-- V3 1.3 dropped integration_connections (never read, never written, five
-- days old). The first pass of the board also listed audit_log; it turned
-- out to be template text inside a GCP artifact's content string, not a
-- table, and the text grep that listed it is exactly the kind of pin this
-- lane replaces. So this file asserts three things on a real database: the
-- dropped table answers no regclass, the phantom never existed, and the
-- four work-plan tables that shared the dropped table's migration still
-- exist and still answer through their owner-read RLS. A CASCADE mistake
-- or a lost policy shows here, not in a text pin.
\set ON_ERROR_STOP on
BEGIN;

-- Seeding runs as the MCP server does: the service role. Both claim
-- spellings, so the file reads the same on a Supabase stack and on the
-- replay shim.
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj  uuid := 'db300000-0000-4000-8000-000000000010';
  v_br    uuid := 'db300000-0000-4000-8000-000000000020';
  t text;
BEGIN
  IF to_regclass('public.integration_connections') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 030: integration_connections is still on this stack. Apply migration 20260919120000.';
  END IF;
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 030: audit_log exists here, but no migration creates it (the only CREATE is template text). Find who made it.';
  END IF;
  FOREACH t IN ARRAY ARRAY['work_plans', 'work_plan_items', 'work_plan_edges', 'work_exports'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'db-lane 030: % is missing; the drop took more than its table', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT') THEN
      RAISE EXCEPTION 'db-lane 030: % has no SELECT policy', t;
    END IF;
  END LOOP;

  -- Any existing user owns the fixture; the seeded bench user when present.
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'db-lane 030: no auth.users row to own the fixture. Run supabase db reset (the seed creates bench@nodespec.local).';
  END IF;
  PERFORM set_config('lane.owner', v_owner::text, true);

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 030', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);
  INSERT INTO public.work_plans (project_id, branch_id, source_hash, summary) VALUES (v_proj, v_br, md5('030'), 'db-lane 030 fixture');

  RAISE NOTICE 'db-lane 030: integration_connections gone, audit_log never existed, the four work-plan tables and their SELECT policies intact';
END $$;

-- The owner reads the plan through RLS the way the app does: as the
-- authenticated role with their own sub.
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.work_plans WHERE project_id = 'db300000-0000-4000-8000-000000000010';
  IF n <> 1 THEN
    RAISE EXCEPTION 'db-lane 030: the owner should read 1 work plan through RLS, got %', n;
  END IF;
END $$;
RESET ROLE;

-- A stranger (authenticated, another sub) reads nothing.
SET LOCAL request.jwt.claim.sub = 'db300000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db300000-0000-4000-8000-000000000099"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.work_plans WHERE project_id = 'db300000-0000-4000-8000-000000000010';
  IF n <> 0 THEN
    RAISE EXCEPTION 'db-lane 030: a stranger should read 0 work plans through RLS, got %', n;
  END IF;
  RAISE NOTICE 'db-lane 030: RLS on the survivors still answers: owner 1, stranger 0';
END $$;
RESET ROLE;

ROLLBACK;
