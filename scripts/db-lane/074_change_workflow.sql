-- db-lane 074: the change is a workflow (V3 AA.2, owner 2026-09-23).
--
--   workflows.kind admits 'change' beside 'workflow' and 'imported', and
--   nothing else. An outcome filed with no lane still lands in a plain
--   workflow lane (created once), never in the change; an outcome that
--   names the change lane is homed there.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db740000-0000-4000-8000-000000000001';
  v_proj uuid := 'db740000-0000-4000-8000-000000000010';
  v_br uuid := 'db740000-0000-4000-8000-000000000011';
  v_change uuid;
  v_home uuid;
  v_kind text;
BEGIN
  IF to_regclass('public.workflows') IS NULL
     OR pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'workflows_kind_check' AND conrelid = 'public.workflows'::regclass)) NOT LIKE '%change%' THEN
    RAISE EXCEPTION 'db-lane 074: workflows.kind does not admit change. Apply migration 20260923150000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-074-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 074', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);

  INSERT INTO public.workflows (project_id, name, kind, created_by) VALUES (v_proj, 'Move onto our own infrastructure', 'change', v_owner)
  RETURNING id INTO v_change;

  BEGIN
    INSERT INTO public.workflows (project_id, name, kind, created_by) VALUES (v_proj, 'Bogus', 'bogus', v_owner);
    RAISE EXCEPTION 'db-lane 074: kind bogus should be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- an outcome with no lane: a plain workflow lane, created once, not the change
  INSERT INTO public.requirement_candidates (project_id, branch_id, key, kind, name, criteria, status)
  VALUES (v_proj, v_br, 'outcome:free', 'outcome', 'Free outcome', '[]'::jsonb, 'pending')
  RETURNING workflow_id INTO v_home;
  SELECT kind INTO v_kind FROM public.workflows WHERE id = v_home;
  IF v_home = v_change OR v_kind <> 'workflow' THEN
    RAISE EXCEPTION 'db-lane 074: an outcome with no lane landed in % (kind %)', v_home, v_kind;
  END IF;

  -- an outcome that names the change lane is homed there
  INSERT INTO public.requirement_candidates (project_id, branch_id, workflow_id, key, kind, name, criteria, status)
  VALUES (v_proj, v_br, v_change, 'outcome:baseline', 'outcome', 'Readers can sign in today', '[]'::jsonb, 'pending')
  RETURNING workflow_id INTO v_home;
  IF v_home <> v_change THEN RAISE EXCEPTION 'db-lane 074: the named change lane was not kept'; END IF;

  RAISE NOTICE 'db-lane 074: ok (change admitted, bogus refused, the resolver never picks a change)';
END $$;

ROLLBACK;
