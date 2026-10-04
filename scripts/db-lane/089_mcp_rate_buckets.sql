-- db-lane 089: the MCP rate limit every isolate shares (V3 AE.5, owner
-- 2026-09-26: "go with the table").
--
--   The migration applies twice. A credential gets a burst of 60, the 61st
--   is refused with a wait of 1 second, and another credential is not held
--   back. A second of rest lets 4 more through and no fifth; a long rest
--   gives a full burst again and never more. Bad arguments are refused.
--   The app cannot reach the table or the function: as a signed-in person
--   and as anon, reading, writing and calling are refused, and were a grant
--   ever restored, RLS alone still shows and takes nothing. Deleting the
--   account deletes its buckets and no one else's.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

\ir ../../supabase/migrations/20260926120000_v3_ae5_mcp_rate_buckets.sql
\ir ../../supabase/migrations/20260926120000_v3_ae5_mcp_rate_buckets.sql

DO $$
BEGIN
  IF to_regprocedure('public.mcp_rate_take(text, uuid, integer, numeric)') IS NULL OR to_regclass('public.mcp_rate_buckets') IS NULL THEN
    RAISE EXCEPTION 'db-lane 089: mcp_rate_take or mcp_rate_buckets is missing. Apply migration 20260926120000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db890000-0000-4000-8000-000000000001', 'db-lane-089-a@nodespec.local'),
    ('db890000-0000-4000-8000-000000000002', 'db-lane-089-b@nodespec.local');
END $$;

-- ── 1. the burst, the refusal, and the other credential ──────────────────────
DO $$
DECLARE
  v_a uuid := 'db890000-0000-4000-8000-000000000001';
  n integer;
BEGIN
  FOR i IN 1..60 LOOP
    n := public.mcp_rate_take('key:db89-a', v_a, 60, 4);
    IF n <> 0 THEN RAISE EXCEPTION 'db-lane 089: call % of the burst should pass, got a wait of %', i, n; END IF;
  END LOOP;
  n := public.mcp_rate_take('key:db89-a', v_a, 60, 4);
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 089: the 61st call should wait 1 second, got %', n; END IF;
  n := public.mcp_rate_take('key:db89-a', v_a, 60, 4);
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 089: a refused call takes nothing, the next still waits 1, got %', n; END IF;
  n := public.mcp_rate_take('oauth:db89-a:client', v_a, 60, 4);
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 089: another credential of the same person is not held back, got %', n; END IF;
  IF (SELECT count(*) FROM public.mcp_rate_buckets WHERE user_id = v_a) <> 2 THEN
    RAISE EXCEPTION 'db-lane 089: one row per credential expected';
  END IF;
END $$;

-- ── 2. the window lifts at the rate, and a rest never gives more than the burst ─
DO $$
DECLARE
  v_a uuid := 'db890000-0000-4000-8000-000000000001';
  passed integer := 0;
  n integer;
BEGIN
  -- one second of rest, four a second: four pass, the fifth waits
  UPDATE public.mcp_rate_buckets SET tat = tat - interval '1 second' WHERE holder = 'key:db89-a';
  FOR i IN 1..5 LOOP
    IF public.mcp_rate_take('key:db89-a', v_a, 60, 4) = 0 THEN passed := passed + 1; END IF;
  END LOOP;
  IF passed <> 4 THEN RAISE EXCEPTION 'db-lane 089: a second of rest lets 4 through, got %', passed; END IF;

  -- an hour of rest: the burst again, and not one call more
  UPDATE public.mcp_rate_buckets SET tat = clock_timestamp() - interval '1 hour' WHERE holder = 'key:db89-a';
  passed := 0;
  FOR i IN 1..61 LOOP
    IF public.mcp_rate_take('key:db89-a', v_a, 60, 4) = 0 THEN passed := passed + 1; END IF;
  END LOOP;
  IF passed <> 60 THEN RAISE EXCEPTION 'db-lane 089: after a long rest the burst is 60, got %', passed; END IF;

  -- a smaller rule, a longer wait: a burst of 2 at one every 5 seconds waits 5
  n := public.mcp_rate_take('user:db89-slow', v_a, 2, 0.2);
  n := public.mcp_rate_take('user:db89-slow', v_a, 2, 0.2);
  n := public.mcp_rate_take('user:db89-slow', v_a, 2, 0.2);
  IF n <> 5 THEN RAISE EXCEPTION 'db-lane 089: a burst of 2 at 0.2 a second waits 5 seconds, got %', n; END IF;

  BEGIN
    PERFORM public.mcp_rate_take('key:db89-a', v_a, 0, 4);
    RAISE EXCEPTION 'db-lane 089: a capacity of 0 should be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.mcp_rate_take('key:db89-a', NULL, 60, 4);
    RAISE EXCEPTION 'db-lane 089: a bucket with no user should be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    INSERT INTO public.mcp_rate_buckets (holder, user_id, tat) VALUES ('anything', v_a, now());
    RAISE EXCEPTION 'db-lane 089: a holder that is not key:, oauth: or user: should be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── 3. the app cannot reach it: a signed-in person, then anon ─────────────────
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = 'db890000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db890000-0000-4000-8000-000000000001"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_refused boolean;
BEGIN
  v_refused := false;
  BEGIN PERFORM 1 FROM public.mcp_rate_buckets LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 089: a signed-in person read the rate buckets'; END IF;

  v_refused := false;
  BEGIN DELETE FROM public.mcp_rate_buckets WHERE user_id = auth.uid();
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 089: a signed-in person emptied their own bucket'; END IF;

  v_refused := false;
  BEGIN PERFORM public.mcp_rate_take('key:db89-a', auth.uid(), 1000000, 1000);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 089: a signed-in person called mcp_rate_take'; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.role = 'anon';
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;
DO $$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN INSERT INTO public.mcp_rate_buckets (holder, user_id, tat) VALUES ('key:x', 'db890000-0000-4000-8000-000000000001', now());
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 089: anon wrote a rate bucket'; END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- ── 3b. were a grant ever restored, RLS alone still shows and takes nothing ───
GRANT SELECT, INSERT ON public.mcp_rate_buckets TO authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db890000-0000-4000-8000-000000000001"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_refused boolean := false;
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.mcp_rate_buckets;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 089: with a grant restored, RLS let a signed-in person see % bucket(s)', n; END IF;
  BEGIN INSERT INTO public.mcp_rate_buckets (holder, user_id, tat) VALUES ('key:forged', auth.uid(), now() - interval '1 hour');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 089: with a grant restored, RLS let a signed-in person write a bucket'; END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- ── 4. the rows go with the account, and only that account's ─────────────────
DO $$
DECLARE
  v_a uuid := 'db890000-0000-4000-8000-000000000001';
  v_b uuid := 'db890000-0000-4000-8000-000000000002';
BEGIN
  PERFORM public.mcp_rate_take('key:db89-b', v_b, 60, 4);
  DELETE FROM auth.users WHERE id = v_a;
  IF EXISTS (SELECT 1 FROM public.mcp_rate_buckets WHERE user_id = v_a) THEN
    RAISE EXCEPTION 'db-lane 089: a deleted account left rate buckets behind';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_rate_buckets WHERE holder = 'key:db89-b' AND user_id = v_b) THEN
    RAISE EXCEPTION 'db-lane 089: deleting one account removed another''s bucket';
  END IF;
  RAISE NOTICE 'db-lane 089: a burst of 60 then the 61st waits 1 second, per credential; a second of rest lets 4 through, a long rest the burst and no more; the app and anon cannot read, write or call it; the rows go with the account';
END $$;

ROLLBACK;
