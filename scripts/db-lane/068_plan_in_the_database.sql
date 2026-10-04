-- db-lane 068: the plan in the database (V3 Q, owner 2026-09-22).
--
--   "Free and Community must not expose or use Indie and above features at
--   all." The app writes these tables through PostgREST with the person's
--   session, so the database asks which plan the writer's PROJECT is on:
--
--   Community owner   no workflow, step or step map is written; an outcome
--                     that names a lane is filed on the home lane; an
--                     outcome is not moved between lanes; no seat is added;
--                     no mark is set (clearing is allowed); the third
--                     project is refused. Reads of what exists still work.
--   Indie owner       workflows, steps, step maps and moves land; the third
--                     project lands; a seat is still refused (Team).
--   Team owner        a seat lands; a clearance is refused (Government).
--   Government owner  on the managed site a Government plan_name is Team
--                     (audit, owner 2026-09-27): no clearance, no mark. A
--                     mark is the Government install's alone (lane 093).
--   A seat            a Community contributor on a Team owner's project
--                     writes workflows: the owner's plan decides. Below
--                     Team a project is its owner's alone (decision 1,
--                     owner 2026-09-26): on an Indie owner's project the
--                     seat reaches nothing.
--   Self-hosted       the database defers to the licence the functions
--                     check: a Community owner writes a workflow.
--   The server        no auth.uid() (service role, definer triggers) is
--                     never refused here; it gates itself.
--   Clients           cannot call account_plan_tier; plan_allows answers
--                     false for a project the caller is not on.
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

DO $$
DECLARE
  v_owner uuid := 'db680000-0000-4000-8000-000000000001';
  v_seat uuid := 'db680000-0000-4000-8000-000000000002';
  v_proj uuid := 'db680000-0000-4000-8000-000000000010';
  v_br uuid := 'db680000-0000-4000-8000-000000000011';
BEGIN
  IF to_regprocedure('public.plan_allows(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 068: plan_allows is missing. Apply migration 20260922110000.';
  END IF;
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-068-owner@nodespec.local'), (v_seat, 'db-lane-068-seat@nodespec.local');
  PERFORM pg_temp.plan(v_owner, 'community');
  PERFORM pg_temp.plan(v_seat, 'community');
  -- a project and two lanes made by the server (as on a paid period)
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 068', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);
  INSERT INTO public.workflows (id, project_id, name, sort_order) VALUES
    ('db680000-0000-4000-8000-0000000000a1', v_proj, 'Checkout', 0),
    ('db680000-0000-4000-8000-0000000000a2', v_proj, 'Returns', 1);
  INSERT INTO public.workflow_steps (id, workflow_id, name, sort_order) VALUES
    ('db680000-0000-4000-8000-0000000000b1', 'db680000-0000-4000-8000-0000000000a1', 'Pay', 0);
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, workflow_id, key, kind, name)
    VALUES ('db680000-0000-4000-8000-0000000000c1', v_proj, v_br, 'db680000-0000-4000-8000-0000000000a1', 'outcome:c1', 'outcome', 'Pay in one tap');
END $$;

-- ── 1. Community owner: nothing structural is written, reads still work ──
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; v_refused boolean; v_lane uuid;
BEGIN
  SELECT count(*) INTO n FROM public.workflows WHERE project_id = 'db680000-0000-4000-8000-000000000010';
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 068: a Community owner should still read both lanes, read %', n; END IF;

  v_refused := false;
  BEGIN
    INSERT INTO public.workflows (project_id, name) VALUES ('db680000-0000-4000-8000-000000000010', 'Onboarding');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Community owner added a workflow'; END IF;

  UPDATE public.workflows SET name = 'Renamed' WHERE id = 'db680000-0000-4000-8000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 068: a Community owner renamed a workflow'; END IF;
  DELETE FROM public.workflows WHERE id = 'db680000-0000-4000-8000-0000000000a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 068: a Community owner removed a workflow'; END IF;

  v_refused := false;
  BEGIN
    INSERT INTO public.workflow_steps (workflow_id, name) VALUES ('db680000-0000-4000-8000-0000000000a1', 'Ship');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Community owner added a step'; END IF;

  v_refused := false;
  BEGIN
    INSERT INTO public.outcome_step_maps (branch_id, candidate_id, step_id)
      VALUES ('db680000-0000-4000-8000-000000000011', 'db680000-0000-4000-8000-0000000000c1', 'db680000-0000-4000-8000-0000000000b1');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Community owner placed an outcome on a step'; END IF;

  -- an outcome that names the second lane is filed on the home lane (the first)
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, workflow_id, key, kind, name)
    VALUES ('db680000-0000-4000-8000-0000000000c2', 'db680000-0000-4000-8000-000000000010', 'db680000-0000-4000-8000-000000000011',
            'db680000-0000-4000-8000-0000000000a2', 'outcome:c2', 'outcome', 'Refund in a day');
  SELECT workflow_id INTO v_lane FROM public.requirement_candidates WHERE id = 'db680000-0000-4000-8000-0000000000c2';
  IF v_lane IS DISTINCT FROM 'db680000-0000-4000-8000-0000000000a1'::uuid THEN
    RAISE EXCEPTION 'db-lane 068: a Community outcome should land on the home lane, landed on %', v_lane;
  END IF;

  v_refused := false;
  BEGIN
    UPDATE public.requirement_candidates SET workflow_id = 'db680000-0000-4000-8000-0000000000a2' WHERE id = 'db680000-0000-4000-8000-0000000000c1';
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Community owner moved an outcome to another lane'; END IF;
  -- an edit that leaves the lane alone is untouched by the guard
  UPDATE public.requirement_candidates SET name = 'Pay in one tap, always', workflow_id = 'db680000-0000-4000-8000-0000000000a1'
   WHERE id = 'db680000-0000-4000-8000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 068: an ordinary edit was refused'; END IF;

  v_refused := false;
  BEGIN
    INSERT INTO public.project_members (project_id, user_id, role)
      VALUES ('db680000-0000-4000-8000-000000000010', 'db680000-0000-4000-8000-000000000002', 'contributor');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Community owner added a seat'; END IF;

  v_refused := false;
  BEGIN
    UPDATE public.requirement_candidates SET mark = 'CUI' WHERE id = 'db680000-0000-4000-8000-0000000000c1';
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Community owner set a classification mark'; END IF;

  -- the second project lands, the third does not
  INSERT INTO public.projects (id, name, owner_id) VALUES ('db680000-0000-4000-8000-000000000020', 'second', 'db680000-0000-4000-8000-000000000001');
  v_refused := false;
  BEGIN
    INSERT INTO public.projects (id, name, owner_id) VALUES ('db680000-0000-4000-8000-000000000030', 'third', 'db680000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Free account made a third project'; END IF;

  -- clients: no account_plan_tier, and plan_allows says nothing about a stranger's project
  v_refused := false;
  BEGIN
    PERFORM public.account_plan_tier('db680000-0000-4000-8000-000000000002');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a client read another account''s plan'; END IF;
  IF public.plan_allows('workflow_space') THEN RAISE EXCEPTION 'db-lane 068: Community allows workflow_space'; END IF;
  IF public.plan_allows('no_such_feature') THEN RAISE EXCEPTION 'db-lane 068: an unknown feature is allowed'; END IF;
END $$;
RESET ROLE;

-- ── 2. Indie owner: Workflows land, the cap lifts, seats still wait for Team ──
SELECT pg_temp.plan('db680000-0000-4000-8000-000000000001', 'Indie Monthly');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; v_refused boolean; v_lane uuid;
BEGIN
  INSERT INTO public.workflows (id, project_id, name, sort_order)
    VALUES ('db680000-0000-4000-8000-0000000000a3', 'db680000-0000-4000-8000-000000000010', 'Onboarding', 2);
  INSERT INTO public.workflow_steps (workflow_id, name) VALUES ('db680000-0000-4000-8000-0000000000a3', 'Sign up');
  INSERT INTO public.outcome_step_maps (branch_id, candidate_id, step_id)
    VALUES ('db680000-0000-4000-8000-000000000011', 'db680000-0000-4000-8000-0000000000c1', 'db680000-0000-4000-8000-0000000000b1');
  UPDATE public.requirement_candidates SET workflow_id = 'db680000-0000-4000-8000-0000000000a2' WHERE id = 'db680000-0000-4000-8000-0000000000c2';
  SELECT workflow_id INTO v_lane FROM public.requirement_candidates WHERE id = 'db680000-0000-4000-8000-0000000000c2';
  IF v_lane IS DISTINCT FROM 'db680000-0000-4000-8000-0000000000a2'::uuid THEN RAISE EXCEPTION 'db-lane 068: an Indie move did not land'; END IF;
  INSERT INTO public.projects (id, name, owner_id) VALUES ('db680000-0000-4000-8000-000000000030', 'third', 'db680000-0000-4000-8000-000000000001');

  v_refused := false;
  BEGIN
    INSERT INTO public.project_members (project_id, user_id, role)
      VALUES ('db680000-0000-4000-8000-000000000010', 'db680000-0000-4000-8000-000000000002', 'contributor');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: an Indie owner added a seat'; END IF;
END $$;
RESET ROLE;

-- ── 2b. a stranger learns nothing about the paid project's plan ──
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.plan_allows('workflow_space', 'db680000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 068: plan_allows answered for a project the caller is not on';
  END IF;
END $$;
RESET ROLE;

-- ── 3. Team owner: a seat lands, a clearance waits for Government ──
SELECT pg_temp.plan('db680000-0000-4000-8000-000000000001', 'team');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean;
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role)
    VALUES ('db680000-0000-4000-8000-000000000010', 'db680000-0000-4000-8000-000000000002', 'contributor');
  v_refused := false;
  BEGIN
    UPDATE public.project_members SET clearance = ARRAY['CUI'] WHERE user_id = 'db680000-0000-4000-8000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a Team owner granted a clearance'; END IF;
END $$;
RESET ROLE;

-- ── 4. a seat: a Community contributor on the Team owner's project writes workflows ──
SELECT pg_temp.plan('db680000-0000-4000-8000-000000000001', 'team');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT public.plan_allows('workflow_space', 'db680000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 068: a seat on a Team project should see the owner''s plan';
  END IF;
  INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db680000-0000-4000-8000-000000000010', 'Seat lane', 3);
END $$;
RESET ROLE;
-- below Team the project is its owner's alone: the same seat reaches nothing
SELECT pg_temp.plan('db680000-0000-4000-8000-000000000001', 'indie');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  IF public.plan_allows('workflow_space', 'db680000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 068: a seat on an Indie project should reach nothing';
  END IF;
  BEGIN
    INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db680000-0000-4000-8000-000000000010', 'Not theirs', 4);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a seat wrote a workflow on an Indie project'; END IF;
END $$;
RESET ROLE;

-- ── 5. a Government plan_name on the managed site is Team (the hosted
--       ceiling, audit 2026-09-27): no clearance and no mark land; clearing
--       is allowed on every plan ──
DO $$
BEGIN
  IF position('nodespec.edition' IN pg_get_functiondef('public.plan_guard_mark()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db-lane 068: marks are not yet the Government install''s alone. Apply migration 20260927120000.';
  END IF;
END $$;
SELECT pg_temp.plan('db680000-0000-4000-8000-000000000001', 'government');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  IF public.plan_allows('team_lanes', 'db680000-0000-4000-8000-000000000010') IS NOT TRUE THEN
    RAISE EXCEPTION 'db-lane 068: a Government plan_name should still carry Team';
  END IF;
  BEGIN
    UPDATE public.project_members SET clearance = ARRAY['CUI'] WHERE user_id = 'db680000-0000-4000-8000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a clearance was granted on the managed site'; END IF;
  v_refused := false;
  BEGIN
    UPDATE public.requirement_candidates SET mark = 'CUI' WHERE id = 'db680000-0000-4000-8000-0000000000c1';
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 068: a mark was set on the managed site'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.plan('db680000-0000-4000-8000-000000000001', 'community');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  UPDATE public.requirement_candidates SET mark = NULL WHERE id = 'db680000-0000-4000-8000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 068: clearing a mark should be allowed on every plan'; END IF;
  -- removing a seat is allowed on every plan
  DELETE FROM public.project_members WHERE user_id = 'db680000-0000-4000-8000-000000000002' AND project_id = 'db680000-0000-4000-8000-000000000010';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 068: removing a seat should be allowed on every plan'; END IF;
END $$;
RESET ROLE;

-- ── 6. self-hosted: the database defers to the licence the functions check ──
INSERT INTO public.deployment_settings (mode) VALUES ('self-hosted');
SELECT pg_temp.act_as('db680000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db680000-0000-4000-8000-000000000010', 'Self-hosted lane', 4);
  INSERT INTO public.projects (name, owner_id) VALUES ('uncapped', 'db680000-0000-4000-8000-000000000001');
END $$;
RESET ROLE;
DELETE FROM public.deployment_settings;

-- ── 7. the server is never refused here ──
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE n int;
BEGIN
  INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db680000-0000-4000-8000-000000000010', 'Server lane', 5);
  INSERT INTO public.projects (name, owner_id) VALUES ('server-made', 'db680000-0000-4000-8000-000000000001');
  SELECT count(*) INTO n FROM public.workflows WHERE project_id = 'db680000-0000-4000-8000-000000000010';
  IF n <> 6 THEN RAISE EXCEPTION 'db-lane 068: expected six lanes after every section, found %', n; END IF;
  RAISE NOTICE 'db-lane 068: Community writes no workflow, step, map, move, seat or mark and stops at two projects, and still reads; Indie writes workflows and lifts the cap; Team adds seats; a Government plan_name is Team here and marks nothing; a seat on a paid project writes; self-hosted and the server pass';
END $$;
ROLLBACK;
