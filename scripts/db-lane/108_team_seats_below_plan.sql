-- db-lane 108: the Team doors after AL.3 (migration 20261001130000), run as
-- the people the app signs in.
--
--   An owner whose plan lapsed below Team still removes a seat (the rule
--   the plan migration states), and is still refused a new seat or a role
--   change by the plan. On the account's example, a Team owner is refused a
--   seat and a hand-over by name: the example's teammates are names in its
--   data, and the example stays with its account. A real project's seat
--   and hand-over are untouched (db-lane 084 and 085). The migration
--   replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

\ir ../../supabase/migrations/20261001130000_v3_al3_team_seats.sql
\ir ../../supabase/migrations/20261001130000_v3_al3_team_seats.sql

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
  v_owner uuid := 'db108000-0000-4000-8000-000000000001';
  v_alice uuid := 'db108000-0000-4000-8000-000000000002';
  v_bob uuid := 'db108000-0000-4000-8000-000000000003';
BEGIN
  IF to_regprocedure('public.seat_project_member(uuid, text, text)') IS NULL
     OR to_regprocedure('public.transfer_project_ownership(uuid, text)') IS NULL
     OR to_regprocedure('public.is_example_project(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 108: the Team doors or the example check are missing. Apply migration 20261001130000.';
  END IF;
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'db-lane-108-owner@nodespec.local'),
    (v_alice, 'db-lane-108-alice@nodespec.local'),
    (v_bob, 'db-lane-108-bob@nodespec.local');
  PERFORM pg_temp.plan(v_owner, 'team');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db108000-0000-4000-8000-000000000010', 'db-lane 108 real', v_owner);
  INSERT INTO public.projects (id, name, owner_id, metadata) VALUES
    ('db108000-0000-4000-8000-000000000020', 'db-lane 108 example', v_owner, '{"example": "harbor-lane-bakery"}'::jsonb);
  IF NOT public.is_example_project('db108000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'db-lane 108: the fixture example is not marked as one';
  END IF;
END $$;

-- ── 1. on Team: the owner seats alice on the real project; the example refuses ──
SELECT pg_temp.act_as('db108000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  n int;
BEGIN
  PERFORM public.seat_project_member('db108000-0000-4000-8000-000000000010', 'db-lane-108-alice@nodespec.local', 'contributor');
  SELECT count(*) INTO n FROM public.project_roster('db108000-0000-4000-8000-000000000010');
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 108: the Team owner should seat alice, roster holds %', n; END IF;

  BEGIN
    PERFORM public.seat_project_member('db108000-0000-4000-8000-000000000020', 'db-lane-108-alice@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 108: a seat on the example must be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('example data' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = 'db108000-0000-4000-8000-000000000020';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 108: the example must hold no real seat, holds %', n; END IF;
END $$;
RESET ROLE;

-- The example's hand-over: seat alice behind the door's back (as the
-- server could), so the refusal is the example rule and not "no seat".
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO public.project_members (project_id, user_id, role)
VALUES ('db108000-0000-4000-8000-000000000020', 'db108000-0000-4000-8000-000000000002', 'viewer');

SELECT pg_temp.act_as('db108000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_owner uuid;
BEGIN
  BEGIN
    PERFORM public.transfer_project_ownership('db108000-0000-4000-8000-000000000020', 'db-lane-108-alice@nodespec.local');
    RAISE EXCEPTION 'db-lane 108: handing the example over must be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('example stays with your account' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  SELECT owner_id INTO v_owner FROM public.projects WHERE id = 'db108000-0000-4000-8000-000000000020';
  IF v_owner <> 'db108000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'db-lane 108: the example changed hands';
  END IF;
END $$;
RESET ROLE;

-- ── 2. the plan lapses below Team: remove still works, a grant does not ─────
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT pg_temp.plan('db108000-0000-4000-8000-000000000001', 'community');

SELECT pg_temp.act_as('db108000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_proj uuid := 'db108000-0000-4000-8000-000000000010';
  n int;
BEGIN
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'db-lane-108-bob@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 108: a new seat below Team must be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('Team and above' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'db-lane-108-alice@nodespec.local', 'maintainer');
    RAISE EXCEPTION 'db-lane 108: a role change below Team must be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('Team and above' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj AND role = 'contributor';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 108: the refused role change must leave alice a contributor'; END IF;

  SELECT count(*) INTO n FROM public.seat_project_member(v_proj, 'db-lane-108-alice@nodespec.local', 'remove');
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 108: a remove answers no seat row'; END IF;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 108: the owner below Team must be able to remove the seat, % left', n; END IF;
END $$;
RESET ROLE;

-- ── 3. a seat holder still cannot remove anyone ─────────────────────────────
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('db108000-0000-4000-8000-000000000010', 'db108000-0000-4000-8000-000000000002', 'maintainer'),
  ('db108000-0000-4000-8000-000000000010', 'db108000-0000-4000-8000-000000000003', 'viewer');

SELECT pg_temp.act_as('db108000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.seat_project_member('db108000-0000-4000-8000-000000000010', 'db-lane-108-bob@nodespec.local', 'remove');
    RAISE EXCEPTION 'db-lane 108: a maintainer must not remove a seat';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('project owner' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  RAISE NOTICE 'db-lane 108: remove below Team, no grant below Team, the example refuses a seat and a hand-over, a maintainer cannot remove: all hold';
END $$;
RESET ROLE;

ROLLBACK;
