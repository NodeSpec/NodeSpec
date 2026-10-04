-- db-lane 069: constraints are Indie and above, and are not read after a
-- downgrade (V3 AC, owner 2026-09-24; supersedes Z's project-wide opening).
--
--   Community owner   no constraint is filed, project-wide or scoped, and
--                     none is read; spec.json from git files none.
--   Indie owner       a constraint lands, reads, edits and moves lanes;
--                     spec.json from git files its constraints.
--   After downgrade   the rows are kept, untouched, but not read or edited;
--                     deleting the project still works.
--   Upgrade again     the same rows read again.
--   The server        no auth.uid() is never refused here; it gates itself.
--   Self-hosted       every plan files and reads constraints.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.plan(p_user uuid, p_plan text) RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.stripe_subscriptions WHERE user_id = p_user;
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (p_user, p_plan, 'active');
$$;
CREATE FUNCTION pg_temp.act_as(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', p_user), true);
$$;
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

DO $$
DECLARE
  v_owner uuid := 'db690000-0000-4000-8000-000000000001';
  v_proj uuid := 'db690000-0000-4000-8000-000000000010';
BEGIN
  IF to_regprocedure('public.project_constraints_plan_scope()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_constraints' AND policyname = 'Plan: constraints are Indie and above') THEN
    RAISE EXCEPTION 'db-lane 069: the constraints plan policy is missing. Apply migration 20260924130000.';
  END IF;
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-069-owner@nodespec.local');
  PERFORM pg_temp.plan(v_owner, 'community');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 069', v_owner);
  INSERT INTO public.workflows (id, project_id, name, sort_order) VALUES
    ('db690000-0000-4000-8000-0000000000a1', v_proj, 'Checkout', 0),
    ('db690000-0000-4000-8000-0000000000a2', v_proj, 'Returns', 1);
  -- spec.json from git on Community files nothing
  IF public.constraints_from_spec_json(v_proj, '[{"type": "cost", "description": "Under 40 dollars a month"}]'::jsonb) <> 0 THEN
    RAISE EXCEPTION 'db-lane 069: spec.json filed a constraint for a Community owner';
  END IF;
END $$;

-- ── 1. Community owner: nothing is filed, project-wide or scoped ────────
SELECT pg_temp.act_as('db690000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean;
BEGIN
  v_refused := false;
  BEGIN
    INSERT INTO public.project_constraints (project_id, ctype, description, source_hash)
      VALUES ('db690000-0000-4000-8000-000000000010', 'security', 'Sessions expire after 15 minutes idle', 'lane069-c1');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 069: a Community owner filed a project-wide constraint'; END IF;

  v_refused := false;
  BEGIN
    INSERT INTO public.project_constraints (project_id, ctype, description, source_hash, workflow_id)
      VALUES ('db690000-0000-4000-8000-000000000010', 'performance', 'Checkout answers in 300 ms', 'lane069-c2', 'db690000-0000-4000-8000-0000000000a1');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 069: a Community owner scoped a constraint to a workflow'; END IF;
END $$;
RESET ROLE;

-- ── 2. Indie owner: a constraint lands, reads, edits and moves lanes ────
SELECT pg_temp.as_server();
SELECT pg_temp.plan('db690000-0000-4000-8000-000000000001', 'indie');
DO $$
BEGIN
  IF public.constraints_from_spec_json('db690000-0000-4000-8000-000000000010', '[{"type": "cost", "description": "Under 40 dollars a month"}]'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'db-lane 069: spec.json did not file a constraint for an Indie owner';
  END IF;
END $$;
SELECT pg_temp.act_as('db690000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_lane uuid; n int;
BEGIN
  INSERT INTO public.project_constraints (id, project_id, ctype, description, source_hash)
    VALUES ('db690000-0000-4000-8000-0000000000c1', 'db690000-0000-4000-8000-000000000010', 'security', 'Sessions expire after 15 minutes idle', 'lane069-c1');
  INSERT INTO public.project_constraints (id, project_id, ctype, description, source_hash, workflow_id)
    VALUES ('db690000-0000-4000-8000-0000000000c3', 'db690000-0000-4000-8000-000000000010', 'performance', 'Checkout answers in 300 ms', 'lane069-c3', 'db690000-0000-4000-8000-0000000000a1');
  UPDATE public.project_constraints SET workflow_id = 'db690000-0000-4000-8000-0000000000a2' WHERE id = 'db690000-0000-4000-8000-0000000000c3';
  SELECT workflow_id INTO v_lane FROM public.project_constraints WHERE id = 'db690000-0000-4000-8000-0000000000c3';
  IF v_lane IS DISTINCT FROM 'db690000-0000-4000-8000-0000000000a2'::uuid THEN
    RAISE EXCEPTION 'db-lane 069: an Indie owner could not move a constraint between lanes (lane %)', v_lane;
  END IF;
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = 'db690000-0000-4000-8000-000000000010';
  IF n <> 3 THEN RAISE EXCEPTION 'db-lane 069: an Indie owner read % constraints, expected 3', n; END IF;
END $$;
RESET ROLE;

-- ── 3. After a downgrade: kept, but not read and not edited ─────────────
SELECT pg_temp.as_server();
SELECT pg_temp.plan('db690000-0000-4000-8000-000000000001', 'community');
SELECT pg_temp.act_as('db690000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = 'db690000-0000-4000-8000-000000000010';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 069: a Community owner read % constraints after a downgrade', n; END IF;
  UPDATE public.project_constraints SET title = 'Fast checkout' WHERE id = 'db690000-0000-4000-8000-0000000000c3';
  IF FOUND THEN RAISE EXCEPTION 'db-lane 069: a Community owner edited a constraint after a downgrade'; END IF;
  DELETE FROM public.project_constraints WHERE id = 'db690000-0000-4000-8000-0000000000c1';
  IF FOUND THEN RAISE EXCEPTION 'db-lane 069: a Community owner deleted a constraint they can not see'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_server();
DO $$
DECLARE r record;
BEGIN
  SELECT workflow_id, title INTO r FROM public.project_constraints WHERE id = 'db690000-0000-4000-8000-0000000000c3';
  IF r.workflow_id IS DISTINCT FROM 'db690000-0000-4000-8000-0000000000a2'::uuid OR r.title IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 069: a downgrade rewrote a constraint (% %)', r.workflow_id, r.title;
  END IF;
  IF (SELECT count(*) FROM public.project_constraints WHERE project_id = 'db690000-0000-4000-8000-000000000010') <> 3 THEN
    RAISE EXCEPTION 'db-lane 069: a downgrade removed constraints';
  END IF;
END $$;

-- ── 4. Upgrade again: the same rows read ────────────────────────────────
SELECT pg_temp.plan('db690000-0000-4000-8000-000000000001', 'indie');
SELECT pg_temp.act_as('db690000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.project_constraints WHERE project_id = 'db690000-0000-4000-8000-000000000010') <> 3 THEN
    RAISE EXCEPTION 'db-lane 069: the constraints did not come back on Indie';
  END IF;
END $$;
RESET ROLE;

-- ── 5. The server is never refused here; it gates itself ────────────────
SELECT pg_temp.as_server();
SELECT pg_temp.plan('db690000-0000-4000-8000-000000000001', 'community');
DO $$
BEGIN
  INSERT INTO public.project_constraints (project_id, ctype, description, source_hash, workflow_id)
    VALUES ('db690000-0000-4000-8000-000000000010', 'cost', 'Returns cost under a cent each', 'lane069-c4', 'db690000-0000-4000-8000-0000000000a2');
END $$;

-- ── 6. Self-hosted: every plan files and reads ──────────────────────────
INSERT INTO public.deployment_settings (mode) VALUES ('self-hosted');
SELECT pg_temp.act_as('db690000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO public.project_constraints (project_id, ctype, description, source_hash)
    VALUES ('db690000-0000-4000-8000-000000000010', 'deployment', 'Runs in eu-west-1', 'lane069-c5');
  IF (SELECT count(*) FROM public.project_constraints WHERE project_id = 'db690000-0000-4000-8000-000000000010') <> 5 THEN
    RAISE EXCEPTION 'db-lane 069: self-hosted Community did not read its constraints';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_server();
DELETE FROM public.deployment_settings;

-- ── 7. A Community owner deletes a project that carried scoped constraints
SELECT pg_temp.act_as('db690000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  DELETE FROM public.projects WHERE id = 'db690000-0000-4000-8000-000000000010';
  IF NOT FOUND THEN RAISE EXCEPTION 'db-lane 069: a Community owner could not delete the project'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_server();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.project_constraints WHERE project_id = 'db690000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 069: the project''s constraints outlived it';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'db-lane 069: Community files and reads no constraint; Indie does; a downgrade keeps the rows unread and an upgrade reads them again; the server and self-hosted pass; a Community owner still deletes the project'; END $$;
ROLLBACK;
