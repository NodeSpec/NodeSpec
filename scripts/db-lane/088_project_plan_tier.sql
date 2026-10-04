-- db-lane 088: the project owner's plan governs (V3 decision 1, owner ruling
-- 2026-09-26), and below Team a project is its owner's alone (owner, the same
-- day: "anything below Team is just individual with no shared awareness in
-- the project with other accounts").
--
--   A Free person seated on a Team owner's project reads 'team', sees the
--   project and the roster, and the database takes their workflow. A seat
--   held on a Free owner's project reaches nothing: the plan answer is NULL,
--   the project row, the roster and every write are closed to it, as to a
--   stranger, whatever the seat's own plan. The owner reads their own plan.
--   A Team owner's lapse closes the project to its seats at once and keeps
--   the seat rows; back on Team, the seats reach it again. A stranger reads
--   NULL; anon cannot call it; the server (no auth.uid()) reads the owner's
--   plan; self-hosted answers NULL and keeps its seats (the licence decides
--   there, at the server). For every feature and every person, the answer
--   and plan_allows agree. Both migrations replayed change nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regprocedure('public.plan_allows(text, uuid)') IS NULL OR to_regprocedure('public.is_project_member(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 088: plan_allows or is_project_member is missing. Apply migration 20260922110000 and 20260914170000.';
  END IF;
END $$;

\ir ../../supabase/migrations/20260926100000_v3_d1_project_plan_tier.sql
\ir ../../supabase/migrations/20260926100000_v3_d1_project_plan_tier.sql
\ir ../../supabase/migrations/20260926110000_v3_d1_seats_need_team.sql
\ir ../../supabase/migrations/20260926110000_v3_d1_seats_need_team.sql

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
-- what a person reaches on a project, as the app and the policies see it
CREATE FUNCTION pg_temp.reach(p_project uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_rows int;
  v_roster int := 0;
BEGIN
  SELECT count(*) INTO v_rows FROM public.projects WHERE id = p_project;
  BEGIN
    SELECT count(*) INTO v_roster FROM public.project_roster(p_project);
  EXCEPTION WHEN insufficient_privilege THEN v_roster := 0;
  END;
  RETURN format('plan=%s row=%s roster=%s member=%s listed=%s',
    coalesce(public.project_plan_tier(p_project), 'none'), v_rows, v_roster,
    public.is_project_member(p_project, 'viewer')::text,
    (p_project IN (SELECT public.member_project_ids('viewer')))::text);
END $$;

-- team owner T with Free seat F; free owner O with a held seat I (Indie); stranger S
DO $$
BEGIN
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES
    ('db880000-0000-4000-8000-000000000001', 'db-lane-088-team-owner@nodespec.local'),
    ('db880000-0000-4000-8000-000000000002', 'db-lane-088-free-seat@nodespec.local'),
    ('db880000-0000-4000-8000-000000000003', 'db-lane-088-free-owner@nodespec.local'),
    ('db880000-0000-4000-8000-000000000004', 'db-lane-088-indie-seat@nodespec.local'),
    ('db880000-0000-4000-8000-000000000005', 'db-lane-088-stranger@nodespec.local');
  PERFORM pg_temp.plan('db880000-0000-4000-8000-000000000001', 'team');
  PERFORM pg_temp.plan('db880000-0000-4000-8000-000000000003', 'community');
  PERFORM pg_temp.plan('db880000-0000-4000-8000-000000000004', 'indie');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db880000-0000-4000-8000-0000000000a0', 'db-lane 088 team project', 'db880000-0000-4000-8000-000000000001'),
    ('db880000-0000-4000-8000-0000000000b0', 'db-lane 088 free project', 'db880000-0000-4000-8000-000000000003');
  -- the Free project's seat was granted while its owner was on Team (a lapse keeps the row)
  INSERT INTO public.project_members (project_id, user_id, role) VALUES
    ('db880000-0000-4000-8000-0000000000a0', 'db880000-0000-4000-8000-000000000002', 'contributor'),
    ('db880000-0000-4000-8000-0000000000b0', 'db880000-0000-4000-8000-000000000004', 'contributor');
END $$;

-- ── a Free seat on a Team project works under Team ──
SELECT pg_temp.act_as('db880000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF pg_temp.reach('db880000-0000-4000-8000-0000000000a0') <> 'plan=team row=1 roster=2 member=true listed=true' THEN
    RAISE EXCEPTION 'db-lane 088: the Free seat on the Team project should reach it under Team, got %', pg_temp.reach('db880000-0000-4000-8000-0000000000a0');
  END IF;
  INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db880000-0000-4000-8000-0000000000a0', 'Seat lane', 0);
END $$;
RESET ROLE;

-- ── a seat held on a Free project reaches nothing, whatever its own plan ──
SELECT pg_temp.act_as('db880000-0000-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  IF pg_temp.reach('db880000-0000-4000-8000-0000000000b0') <> 'plan=none row=0 roster=0 member=false listed=false' THEN
    RAISE EXCEPTION 'db-lane 088: a seat on a Free project should reach nothing, got %', pg_temp.reach('db880000-0000-4000-8000-0000000000b0');
  END IF;
  BEGIN
    INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db880000-0000-4000-8000-0000000000b0', 'Not theirs', 0);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 088: a seat on a Free project wrote to it'; END IF;
  IF public.project_plan_tier('db880000-0000-4000-8000-0000000000a0') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 088: a person answered for a project they are not on';
  END IF;
END $$;
RESET ROLE;

-- ── the Free owner has their project to themselves, on their own plan ──
SELECT pg_temp.act_as('db880000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.project_plan_tier('db880000-0000-4000-8000-0000000000b0') IS DISTINCT FROM 'community'
     OR NOT public.is_project_member('db880000-0000-4000-8000-0000000000b0', 'owner') THEN
    RAISE EXCEPTION 'db-lane 088: the Free owner should read their own project on Community';
  END IF;
END $$;
RESET ROLE;

-- ── a Team owner's lapse closes the project to its seats; Team again opens it ──
SELECT pg_temp.plan('db880000-0000-4000-8000-000000000001', 'community');
SELECT pg_temp.act_as('db880000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  IF pg_temp.reach('db880000-0000-4000-8000-0000000000a0') <> 'plan=none row=0 roster=0 member=false listed=false' THEN
    RAISE EXCEPTION 'db-lane 088: after the lapse the seat should reach nothing, got %', pg_temp.reach('db880000-0000-4000-8000-0000000000a0');
  END IF;
  BEGIN
    INSERT INTO public.workflows (project_id, name, sort_order) VALUES ('db880000-0000-4000-8000-0000000000a0', 'After the lapse', 1);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 088: the seat wrote after the owner went Free'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.project_members WHERE project_id = 'db880000-0000-4000-8000-0000000000a0') <> 1 THEN
    RAISE EXCEPTION 'db-lane 088: the lapse should keep the seat row';
  END IF;
END $$;
SELECT pg_temp.plan('db880000-0000-4000-8000-000000000001', 'team');
SELECT pg_temp.act_as('db880000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF pg_temp.reach('db880000-0000-4000-8000-0000000000a0') <> 'plan=team row=1 roster=2 member=true listed=true' THEN
    RAISE EXCEPTION 'db-lane 088: back on Team the seat should reach the project again, got %', pg_temp.reach('db880000-0000-4000-8000-0000000000a0');
  END IF;
END $$;
RESET ROLE;

-- ── for every feature and every seat, the answer and the enforcement agree ──
DO $$
DECLARE
  f text;
  pair record;
  v_tier text;
  v_rank int;
  v_need int;
BEGIN
  FOR pair IN SELECT * FROM (VALUES
      ('db880000-0000-4000-8000-000000000002'::uuid, 'db880000-0000-4000-8000-0000000000a0'::uuid),
      ('db880000-0000-4000-8000-000000000004'::uuid, 'db880000-0000-4000-8000-0000000000b0'::uuid),
      ('db880000-0000-4000-8000-000000000003'::uuid, 'db880000-0000-4000-8000-0000000000b0'::uuid),
      ('db880000-0000-4000-8000-000000000001'::uuid, 'db880000-0000-4000-8000-0000000000a0'::uuid)) AS t(person, project) LOOP
    PERFORM pg_temp.act_as(pair.person::text);
    v_tier := public.project_plan_tier(pair.project);
    -- not on the project (a held seat below Team): no answer, and nothing allowed
    v_rank := CASE v_tier WHEN 'community' THEN 0 WHEN 'indie' THEN 1 WHEN 'team' THEN 2 WHEN 'enterprise' THEN 3 WHEN 'government' THEN 4 ELSE -1 END;
    FOREACH f IN ARRAY ARRAY['workflow_space', 'priority_board', 'team_lanes', 'classification'] LOOP
      v_need := CASE f WHEN 'workflow_space' THEN 1 WHEN 'priority_board' THEN 1 WHEN 'team_lanes' THEN 2 WHEN 'classification' THEN 4 END;
      IF (v_rank >= v_need) IS DISTINCT FROM public.plan_allows(f, pair.project) THEN
        RAISE EXCEPTION 'db-lane 088: % on % reads % but plan_allows says %', pair.person, f, v_tier, public.plan_allows(f, pair.project);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.as_server();
END $$;

-- ── a stranger learns nothing; anon cannot ask ──
SELECT pg_temp.act_as('db880000-0000-4000-8000-000000000005');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.project_plan_tier('db880000-0000-4000-8000-0000000000a0') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 088: a stranger read a project''s plan';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.project_plan_tier('db880000-0000-4000-8000-0000000000a0');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 088: anon called project_plan_tier'; END IF;
END $$;
RESET ROLE;

-- ── the server reads the owner's plan; self-hosted defers to the licence ──
SELECT pg_temp.as_server();
DO $$
BEGIN
  IF public.project_plan_tier('db880000-0000-4000-8000-0000000000a0') IS DISTINCT FROM 'team' THEN
    RAISE EXCEPTION 'db-lane 088: the server should read the owner''s plan';
  END IF;
  INSERT INTO public.deployment_settings (id, mode) VALUES (true, 'self-hosted');
  IF public.project_plan_tier('db880000-0000-4000-8000-0000000000a0') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 088: self-hosted should answer NULL (the licence decides)';
  END IF;
  IF public.project_role('db880000-0000-4000-8000-0000000000b0', 'db880000-0000-4000-8000-000000000004') IS DISTINCT FROM 'contributor' THEN
    RAISE EXCEPTION 'db-lane 088: self-hosted keeps its seats (the server applies the licence)';
  END IF;
  DELETE FROM public.deployment_settings;
  RAISE NOTICE 'db-lane 088: a Free seat on Team reaches it under Team; a seat on a Free project reaches nothing; a lapse closes the project to its seats and Team reopens it; the answer agrees with plan_allows; strangers, anon and self-hosted learn nothing';
END $$;

ROLLBACK;
