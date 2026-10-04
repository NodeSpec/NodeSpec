-- db-lane 084: the Team popup's two doors (V3 AE.4), project_roster and
-- seat_project_member, run as the people the app signs in.
--
--   A Team owner seats an account by its exact email (case and space
--   blind), reads the roster with themselves first and marked, changes the
--   role in place (one row, not two), and removes the seat. A maintainer
--   reads the roster and is refused a seat. A stranger reads nothing and is
--   refused with the same sentence whether or not the address exists, so
--   nothing can be enumerated. The owner is refused an unknown address by
--   name, their own address, and a role outside the ladder. A Free owner
--   is refused by the plan. anon cannot call either door. The migration
--   replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

\ir ../../supabase/migrations/20260925160000_v3_ae4_team_seats.sql
\ir ../../supabase/migrations/20260925160000_v3_ae4_team_seats.sql

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
  v_owner uuid := 'db840000-0000-4000-8000-000000000001';
  v_alice uuid := 'db840000-0000-4000-8000-000000000002';
  v_bob uuid := 'db840000-0000-4000-8000-000000000003';
  v_stranger uuid := 'db840000-0000-4000-8000-000000000004';
  v_free uuid := 'db840000-0000-4000-8000-000000000005';
BEGIN
  IF to_regprocedure('public.seat_project_member(uuid, text, text)') IS NULL OR to_regprocedure('public.project_roster(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 084: the AE.4 doors are missing. Apply migration 20260925160000.';
  END IF;
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'db-lane-084-owner@nodespec.local'),
    (v_alice, 'db-lane-084-alice@nodespec.local'),
    (v_bob, 'db-lane-084-bob@nodespec.local'),
    (v_stranger, 'db-lane-084-stranger@nodespec.local'),
    (v_free, 'db-lane-084-free@nodespec.local');
  PERFORM pg_temp.plan(v_owner, 'team');
  PERFORM pg_temp.plan(v_free, 'community');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db840000-0000-4000-8000-000000000010', 'db-lane 084 team', v_owner),
    ('db840000-0000-4000-8000-000000000020', 'db-lane 084 free', v_free);
END $$;

-- ── 1. the Team owner: seat by exact email, the roster, the role changed in place, the refusals by name ──
SELECT pg_temp.act_as('db840000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_proj uuid := 'db840000-0000-4000-8000-000000000010';
  r record;
  n int;
BEGIN
  SELECT * INTO r FROM public.seat_project_member(v_proj, '  Db-Lane-084-Alice@Nodespec.Local ', 'viewer');
  IF r.user_id <> 'db840000-0000-4000-8000-000000000002' OR r.role <> 'viewer' OR r.email <> 'db-lane-084-alice@nodespec.local' THEN
    RAISE EXCEPTION 'db-lane 084: the seat by a mixed-case, padded email did not land as expected: %', r;
  END IF;
  SELECT count(*) INTO n FROM public.project_roster(v_proj);
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 084: the roster should hold the owner and one seat, holds %', n; END IF;
  SELECT * INTO r FROM public.project_roster(v_proj) LIMIT 1;
  IF r.role <> 'owner' OR NOT r.is_you OR r.email <> 'db-lane-084-owner@nodespec.local' THEN
    RAISE EXCEPTION 'db-lane 084: the roster should lead with the owner, marked you: %', r;
  END IF;
  SELECT * INTO r FROM public.seat_project_member(v_proj, 'db-lane-084-alice@nodespec.local', 'maintainer');
  IF r.role <> 'maintainer' THEN RAISE EXCEPTION 'db-lane 084: the role change did not answer maintainer: %', r; END IF;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 084: a role change must update the one seat, found % rows', n; END IF;
  SELECT count(*) INTO n FROM public.project_roster(v_proj) x WHERE x.role = 'maintainer' AND NOT x.is_you;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 084: the roster should read the seat as maintainer'; END IF;

  BEGIN
    PERFORM public.seat_project_member(v_proj, 'nobody-084@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 084: an unknown address must be refused';
  EXCEPTION WHEN no_data_found THEN
    IF position('No NodeSpec account for nobody-084@nodespec.local' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'db-lane-084-owner@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 084: the owner''s own address must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF position('That is you' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'db-lane-084-bob@nodespec.local', 'owner');
    RAISE EXCEPTION 'db-lane 084: owner is not a grantable role';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF position('role must be maintainer, contributor, viewer or remove' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'not-an-address', 'viewer');
    RAISE EXCEPTION 'db-lane 084: an address without @ must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF position('email is required' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- ── 2. a maintainer reads the roster and is refused a seat ──────────────────
SELECT pg_temp.act_as('db840000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_proj uuid := 'db840000-0000-4000-8000-000000000010';
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.project_roster(v_proj) x WHERE x.is_you AND x.role = 'maintainer';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 084: the maintainer should read the roster with their own seat marked'; END IF;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'db-lane-084-bob@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 084: a maintainer must not seat anyone';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('project owner' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- ── 3. a stranger reads nothing; the refusal is one sentence, address or not ──
SELECT pg_temp.act_as('db840000-0000-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_proj uuid := 'db840000-0000-4000-8000-000000000010';
  n int;
  v_known text;
  v_unknown text;
BEGIN
  SELECT count(*) INTO n FROM public.project_roster(v_proj);
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 084: a stranger must read no roster row, read %', n; END IF;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'db-lane-084-alice@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 084: a stranger must be refused';
  EXCEPTION WHEN insufficient_privilege THEN v_known := SQLERRM;
  END;
  BEGIN
    PERFORM public.seat_project_member(v_proj, 'nobody-084@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 084: a stranger must be refused';
  EXCEPTION WHEN insufficient_privilege THEN v_unknown := SQLERRM;
  END;
  IF v_known IS NULL OR v_known <> v_unknown THEN
    RAISE EXCEPTION 'db-lane 084: the refusal must not tell an existing address from a missing one (% / %)', v_known, v_unknown;
  END IF;
END $$;
RESET ROLE;

-- ── 4. a Free owner is refused by the plan ───────────────────────────────────
SELECT pg_temp.act_as('db840000-0000-4000-8000-000000000005');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.seat_project_member('db840000-0000-4000-8000-000000000020', 'db-lane-084-alice@nodespec.local', 'viewer');
    RAISE EXCEPTION 'db-lane 084: a Free owner must be refused a seat';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('Team and above' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- ── 5. the owner removes the seat; a second remove is a quiet no-op ──────────
SELECT pg_temp.act_as('db840000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_proj uuid := 'db840000-0000-4000-8000-000000000010';
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.seat_project_member(v_proj, 'db-lane-084-alice@nodespec.local', 'remove');
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 084: a remove answers no seat row'; END IF;
  SELECT count(*) INTO n FROM public.project_roster(v_proj);
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 084: after the remove the roster is the owner alone, holds %', n; END IF;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 084: the seat row should be gone'; END IF;
  PERFORM public.seat_project_member(v_proj, 'db-lane-084-alice@nodespec.local', 'remove');
END $$;
RESET ROLE;

-- ── 6. anon cannot call either door ──────────────────────────────────────────
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.project_roster('db840000-0000-4000-8000-000000000010');
      RAISE EXCEPTION 'db-lane 084: anon must not read a roster';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.seat_project_member('db840000-0000-4000-8000-000000000010', 'db-lane-084-alice@nodespec.local', 'viewer');
      RAISE EXCEPTION 'db-lane 084: anon must not seat anyone';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE 'RESET ROLE';
  END IF;
  RAISE NOTICE 'db-lane 084: the owner seats by exact email and reads the roster; a maintainer reads and is refused; a stranger reads nothing and learns nothing; Free is refused by the plan; anon is refused';
END $$;

ROLLBACK;
