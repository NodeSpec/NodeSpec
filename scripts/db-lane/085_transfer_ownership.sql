-- db-lane 085: the hand-over door (V3 AE.1), transfer_project_ownership,
-- run as the people the app signs in.
--
--   The owner hands the project to a seat by exact email: owner_id moves,
--   the new owner's seat row is gone (the owner is the row), the previous
--   owner keeps a maintainer seat, and the roster reads the new owner
--   first. A maintainer is refused the hand-over. The owner is refused an
--   account without a seat, and their own address. The previous owner,
--   now a maintainer, cannot take the project back; the new owner can hand
--   it back. anon cannot call it. The migration replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

\ir ../../supabase/migrations/20260925170000_v3_ae1_transfer_ownership.sql
\ir ../../supabase/migrations/20260925170000_v3_ae1_transfer_ownership.sql

CREATE FUNCTION pg_temp.act_as(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', p_user), true);
$$;

DO $$
DECLARE
  v_owner uuid := 'db850000-0000-4000-8000-000000000001';
  v_alice uuid := 'db850000-0000-4000-8000-000000000002';
  v_bob uuid := 'db850000-0000-4000-8000-000000000003';
  v_proj uuid := 'db850000-0000-4000-8000-000000000010';
BEGIN
  IF to_regprocedure('public.transfer_project_ownership(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 085: transfer_project_ownership is missing. Apply migration 20260925170000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'db-lane-085-owner@nodespec.local'),
    (v_alice, 'db-lane-085-alice@nodespec.local'),
    (v_bob, 'db-lane-085-bob@nodespec.local');
  -- seats are Team and above (decision 1): the owner, and the account that takes the project over, are on Team
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (v_owner, 'team', 'active'), (v_alice, 'team', 'active');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 085', v_owner);
  INSERT INTO public.project_members (project_id, user_id, role, invited_by) VALUES (v_proj, v_alice, 'maintainer', v_owner);
END $$;

-- ── 1. a maintainer cannot hand the project over ─────────────────────────────
SELECT pg_temp.act_as('db850000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_project_ownership('db850000-0000-4000-8000-000000000010', 'db-lane-085-bob@nodespec.local');
    RAISE EXCEPTION 'db-lane 085: a maintainer must not hand the project over';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('owner''s to hand over' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- ── 2. the owner: refused an account without a seat and their own address; the hand-over to a seat ──
SELECT pg_temp.act_as('db850000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_proj uuid := 'db850000-0000-4000-8000-000000000010';
  r record;
  n int;
BEGIN
  BEGIN
    PERFORM public.transfer_project_ownership(v_proj, 'db-lane-085-bob@nodespec.local');
    RAISE EXCEPTION 'db-lane 085: an account without a seat cannot take the project';
  EXCEPTION WHEN no_data_found THEN
    IF position('No seat on this project for db-lane-085-bob@nodespec.local' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.transfer_project_ownership(v_proj, 'db-lane-085-owner@nodespec.local');
    RAISE EXCEPTION 'db-lane 085: the owner''s own address is not a seat';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  SELECT * INTO r FROM public.transfer_project_ownership(v_proj, ' DB-Lane-085-Alice@Nodespec.Local ');
  IF r.user_id <> 'db850000-0000-4000-8000-000000000002' OR r.role <> 'owner' THEN
    RAISE EXCEPTION 'db-lane 085: the hand-over did not answer the new owner: %', r;
  END IF;
  -- the previous owner reads the roster as a maintainer now: the new owner first, themselves a seat
  SELECT * INTO r FROM public.project_roster(v_proj) LIMIT 1;
  IF r.role <> 'owner' OR r.is_you OR r.email <> 'db-lane-085-alice@nodespec.local' THEN
    RAISE EXCEPTION 'db-lane 085: the roster should lead with the new owner: %', r;
  END IF;
  SELECT count(*) INTO n FROM public.project_roster(v_proj) x WHERE x.is_you AND x.role = 'maintainer';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 085: the previous owner should hold a maintainer seat'; END IF;
  SELECT count(*) INTO n FROM public.project_roster(v_proj);
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 085: the roster should be two people, is %', n; END IF;
  -- and cannot take it back
  BEGIN
    PERFORM public.transfer_project_ownership(v_proj, 'db-lane-085-owner@nodespec.local');
    RAISE EXCEPTION 'db-lane 085: the previous owner must not take the project back';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE v_proj uuid := 'db850000-0000-4000-8000-000000000010'; n int;
BEGIN
  IF (SELECT owner_id FROM public.projects WHERE id = v_proj) <> 'db850000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'db-lane 085: owner_id did not move';
  END IF;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj AND user_id = 'db850000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 085: the new owner must not keep a seat row'; END IF;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj AND user_id = 'db850000-0000-4000-8000-000000000001' AND role = 'maintainer';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 085: the previous owner''s maintainer seat is missing'; END IF;
END $$;

-- ── 3. the new owner hands it back ───────────────────────────────────────────
SELECT pg_temp.act_as('db850000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.transfer_project_ownership('db850000-0000-4000-8000-000000000010', 'db-lane-085-owner@nodespec.local');
  IF r.user_id <> 'db850000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'db-lane 085: the hand-back did not land: %', r; END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE v_proj uuid := 'db850000-0000-4000-8000-000000000010'; n int;
BEGIN
  IF (SELECT owner_id FROM public.projects WHERE id = v_proj) <> 'db850000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'db-lane 085: owner_id did not move back';
  END IF;
  SELECT count(*) INTO n FROM public.project_members WHERE project_id = v_proj;
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = v_proj AND user_id = 'db850000-0000-4000-8000-000000000002' AND role = 'maintainer') THEN
    RAISE EXCEPTION 'db-lane 085: after the hand-back the one seat is alice as maintainer';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.transfer_project_ownership(v_proj, 'db-lane-085-alice@nodespec.local');
      RAISE EXCEPTION 'db-lane 085: anon must not hand a project over';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE 'RESET ROLE';
  END IF;
  RAISE NOTICE 'db-lane 085: the owner hands the project to a seat by exact email and keeps a maintainer seat; a maintainer, a non-seat, the owner''s own address and anon are refused; the new owner hands it back';
END $$;

ROLLBACK;
