-- db-lane 101: time in app (owner 2026-09-29), migration 20260929110000.
--
--   A person's heartbeats make sessions:
--     the first beat opens a session with no time; a beat credits the time
--     since the last one, at most 90 seconds; a beat more than 30 minutes
--     after the last starts a new session; another person's session id
--     starts a session of the caller's own and leaves theirs alone.
--   Nobody reads or writes app_sessions directly: a signed-in person is
--   refused both, anon cannot call the heartbeat.
--   The admin read answers an admin (JWT app_metadata) and refuses anyone
--   else, counts only sessions seen in the range, and names each person's
--   email and plan.
--   Self-hosted: the heartbeat records nothing and the read refuses.
--   Deleting the account deletes its sessions; replaying the migration
--   changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.act_as(p_user text, p_admin boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims',
           format('{"role":"authenticated","sub":"%s","app_metadata":{"is_admin":%s}}', p_user,
                  CASE WHEN p_admin THEN 'true' ELSE 'false' END), true);
$$;
-- Moves a session's last beat into the past, as if that much time went by.
CREATE FUNCTION pg_temp.age(p_session uuid, p_seconds int) RETURNS void LANGUAGE sql AS $$
  UPDATE public.app_sessions SET last_seen_at = clock_timestamp() - make_interval(secs => p_seconds) WHERE id = p_session;
$$;
CREATE TEMP TABLE lane_ids (k text PRIMARY KEY, sid uuid);
GRANT ALL ON lane_ids TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.app_session_beat(uuid)') IS NULL OR to_regprocedure('public.admin_time_in_app(integer)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 101: the time in app functions are missing. Apply migration 20260929110000.';
  END IF;
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES
    ('db101000-0000-4000-8000-000000000001', 'db-lane-101-ada@nodespec.local'),
    ('db101000-0000-4000-8000-000000000002', 'db-lane-101-bo@nodespec.local'),
    ('db101000-0000-4000-8000-000000000003', 'db-lane-101-admin@nodespec.local');
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES ('db101000-0000-4000-8000-000000000002', 'indie', 'active');
END $$;

-- ── 1. the first beat opens a session; the table is closed to the person ──
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid; v_refused boolean;
BEGIN
  v := public.app_session_beat(NULL);
  IF v IS NULL THEN RAISE EXCEPTION 'db-lane 101: the first beat on the managed service should open a session'; END IF;
  INSERT INTO lane_ids VALUES ('s1', v);
  v_refused := false;
  BEGIN PERFORM 1 FROM public.app_sessions; EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 101: a signed-in person read app_sessions directly'; END IF;
  v_refused := false;
  BEGIN
    INSERT INTO public.app_sessions (user_id, active_seconds) VALUES ('db101000-0000-4000-8000-000000000001', 99999);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 101: a signed-in person wrote app_sessions directly'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.app_sessions WHERE id = (SELECT sid FROM lane_ids WHERE k = 's1');
  IF r.user_id <> 'db101000-0000-4000-8000-000000000001' OR r.active_seconds <> 0 THEN
    RAISE EXCEPTION 'db-lane 101: the new session should be Ada''s with no time yet, is % with %', r.user_id, r.active_seconds;
  END IF;
  PERFORM pg_temp.age(r.id, 60);
END $$;

-- ── 2. a beat a minute later credits the minute; one ten minutes later, 90 s ──
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.app_session_beat((SELECT sid FROM lane_ids WHERE k = 's1')) IS DISTINCT FROM (SELECT sid FROM lane_ids WHERE k = 's1') THEN
    RAISE EXCEPTION 'db-lane 101: a beat within the session should keep the session';
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  SELECT active_seconds INTO n FROM public.app_sessions WHERE id = (SELECT sid FROM lane_ids WHERE k = 's1');
  IF n NOT BETWEEN 59 AND 61 THEN RAISE EXCEPTION 'db-lane 101: a beat a minute later should credit 60 s, credited %', n; END IF;
  PERFORM pg_temp.age((SELECT sid FROM lane_ids WHERE k = 's1'), 600);
END $$;
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT public.app_session_beat((SELECT sid FROM lane_ids WHERE k = 's1'));
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  SELECT active_seconds INTO n FROM public.app_sessions WHERE id = (SELECT sid FROM lane_ids WHERE k = 's1');
  IF n NOT BETWEEN 149 AND 151 THEN RAISE EXCEPTION 'db-lane 101: a beat ten minutes later should credit 90 s at most (60 + 90), has %', n; END IF;
  PERFORM pg_temp.age((SELECT sid FROM lane_ids WHERE k = 's1'), 2400);
END $$;

-- ── 3. forty minutes later is a new session; another person's id is not theirs ──
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid;
BEGIN
  v := public.app_session_beat((SELECT sid FROM lane_ids WHERE k = 's1'));
  IF v IS NULL OR v = (SELECT sid FROM lane_ids WHERE k = 's1') THEN
    RAISE EXCEPTION 'db-lane 101: a beat 40 minutes after the last should start a new session';
  END IF;
  INSERT INTO lane_ids VALUES ('s2', v);
END $$;
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000002');
DO $$
DECLARE v uuid;
BEGIN
  v := public.app_session_beat((SELECT sid FROM lane_ids WHERE k = 's2'));
  IF v IS NULL OR v = (SELECT sid FROM lane_ids WHERE k = 's2') THEN
    RAISE EXCEPTION 'db-lane 101: Bo sending Ada''s session id should start a session of Bo''s own';
  END IF;
  INSERT INTO lane_ids VALUES ('s3', v);
END $$;
RESET ROLE;
DO $$
DECLARE r record; n int;
BEGIN
  SELECT * INTO r FROM public.app_sessions WHERE id = (SELECT sid FROM lane_ids WHERE k = 's1');
  IF r.active_seconds NOT BETWEEN 149 AND 151 THEN RAISE EXCEPTION 'db-lane 101: the old session should keep its time, has %', r.active_seconds; END IF;
  SELECT count(*) INTO n FROM public.app_sessions WHERE id = (SELECT sid FROM lane_ids WHERE k = 's2') AND user_id = 'db101000-0000-4000-8000-000000000001' AND active_seconds = 0;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 101: Ada''s new session should be hers, untouched by Bo'; END IF;
  SELECT count(*) INTO n FROM public.app_sessions WHERE id = (SELECT sid FROM lane_ids WHERE k = 's3') AND user_id = 'db101000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 101: Bo''s session should be Bo''s'; END IF;
END $$;

-- ── 4. anon cannot beat; a caller with no person cannot either ──
SET LOCAL ROLE anon;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN PERFORM public.app_session_beat(NULL); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 101: anon called the heartbeat'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true), set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN PERFORM public.app_session_beat(NULL); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 101: a beat with no person behind it was recorded'; END IF;
END $$;
RESET ROLE;

-- ── 5. the admin read: admins only, the range, email and plan ──
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN PERFORM * FROM public.admin_time_in_app(30); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 101: a person who is not an admin read time in app'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.age((SELECT sid FROM lane_ids WHERE k = 's1'), 40 * 86400);
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record; n int;
BEGIN
  SELECT * INTO r FROM public.admin_time_in_app(30) WHERE user_id = 'db101000-0000-4000-8000-000000000001';
  IF r.email <> 'db-lane-101-ada@nodespec.local' OR r.plan <> 'community' OR r.sessions <> 1 OR r.active_seconds <> 0 THEN
    RAISE EXCEPTION 'db-lane 101: over 30 days Ada has one session with no time, on Free; read % % % %', r.email, r.plan, r.sessions, r.active_seconds;
  END IF;
  SELECT * INTO r FROM public.admin_time_in_app(90) WHERE user_id = 'db101000-0000-4000-8000-000000000001';
  IF r.sessions <> 2 OR r.active_seconds NOT BETWEEN 149 AND 151 THEN
    RAISE EXCEPTION 'db-lane 101: over 90 days Ada has both sessions and their time, read % %', r.sessions, r.active_seconds;
  END IF;
  SELECT * INTO r FROM public.admin_time_in_app(30) WHERE user_id = 'db101000-0000-4000-8000-000000000002';
  IF r.plan <> 'indie' OR r.sessions <> 1 THEN RAISE EXCEPTION 'db-lane 101: Bo is on Indie with one session, read % %', r.plan, r.sessions; END IF;
  SELECT count(*) INTO n FROM public.admin_time_in_app(30) WHERE user_id = 'db101000-0000-4000-8000-000000000003';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 101: someone with no sessions should not be listed'; END IF;
END $$;
RESET ROLE;

-- ── 6. self-hosted: nothing is recorded and the read refuses ──
INSERT INTO public.deployment_settings (id, mode) VALUES (true, 'self-hosted');
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE n0 int; n1 int;
BEGIN
  IF public.app_session_beat(NULL) IS NOT NULL THEN RAISE EXCEPTION 'db-lane 101: a self-hosted database recorded a session'; END IF;
END $$;
SELECT pg_temp.act_as('db101000-0000-4000-8000-000000000003', true);
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN PERFORM * FROM public.admin_time_in_app(30); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 101: a self-hosted database answered the time in app read'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.app_sessions WHERE user_id = 'db101000-0000-4000-8000-000000000001';
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 101: Ada should still have exactly her two sessions, has %', n; END IF;
  DELETE FROM public.deployment_settings;
END $$;

-- ── 7. deleting the account deletes its sessions; replay changes nothing ──
DO $$
DECLARE n int;
BEGIN
  DELETE FROM auth.users WHERE id = 'db101000-0000-4000-8000-000000000002';
  SELECT count(*) INTO n FROM public.app_sessions WHERE user_id = 'db101000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 101: a deleted account left % sessions', n; END IF;
END $$;
CREATE TEMP TABLE before_replay AS SELECT id, user_id, active_seconds FROM public.app_sessions;
\ir ../../supabase/migrations/20260929110000_v3_time_in_app.sql
DO $$
BEGIN
  IF EXISTS (SELECT id, user_id, active_seconds FROM public.app_sessions EXCEPT SELECT * FROM before_replay)
     OR EXISTS (SELECT * FROM before_replay EXCEPT SELECT id, user_id, active_seconds FROM public.app_sessions) THEN
    RAISE EXCEPTION 'db-lane 101: replaying the migration changed the sessions';
  END IF;
  RAISE NOTICE 'db-lane 101: sessions from heartbeats (60 s credited, 90 s at most, a new session after 30 minutes, only the caller''s own), no direct access, admins only with email and plan over the range, nothing on self-hosted, sessions go with the account, replay changes nothing';
END $$;
ROLLBACK;
