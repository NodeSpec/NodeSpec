-- db-lane 051: the key an agent connects with is judged by the database.
--
--   The MCP server hashes the presented key and asks validate_mcp_api_key
--   (migration 20260330222120) whether it stands. Every Deno test scripts
--   that answer; this file runs the function on real rows: a live key
--   validates with its user, id and scopes and is stamped last_used_at; an
--   unknown hash, a revoked key and an expired key are refused with the
--   reason the server relays; the scopes vocabulary is closed at the table;
--   under RLS a user sees only their own keys and writes none: minting and
--   revoking are the MCP server's (V3 audit, migration 20260927110000); a key
--   revoked by the server refuses at the function on the next connection.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
BEGIN
  IF to_regclass('public.mcp_api_keys') IS NULL THEN
    RAISE EXCEPTION 'db-lane 051: public.mcp_api_keys is missing. Apply migration 20260330222120.';
  END IF;
  IF to_regprocedure('public.validate_mcp_api_key(text)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 051: validate_mcp_api_key(text) is missing. Apply migration 20260330222120 (and 20260922100000 for key_name).';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 051: no auth.users row to own the fixture. Run supabase db reset.'; END IF;
  PERFORM set_config('lane.owner', v_owner::text, true);

  -- a second person, so "someone else's key" is a real row under RLS
  INSERT INTO auth.users (id, email) VALUES ('db510000-0000-4000-8000-000000000002', 'db-lane-051-other@nodespec.local');

  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at, revoked_at) VALUES
    ('db510000-0000-4000-8000-000000000101', v_owner, 'agent a',      'db51-hash-live',    'ns_live_a', ARRAY['read', 'write', 'propose'], NULL, NULL),
    ('db510000-0000-4000-8000-000000000102', v_owner, 'revoked key',  'db51-hash-revoked', 'ns_live_r', ARRAY['read'], NULL, now() - interval '1 day'),
    ('db510000-0000-4000-8000-000000000103', v_owner, 'expired key',  'db51-hash-expired', 'ns_live_e', ARRAY['read', 'write'], now() - interval '1 hour', NULL),
    ('db510000-0000-4000-8000-000000000104', v_owner, 'read only',    'db51-hash-read',    'ns_live_o', ARRAY['read'], now() + interval '1 day', NULL),
    ('db510000-0000-4000-8000-000000000105', 'db510000-0000-4000-8000-000000000002', 'someone else', 'db51-hash-other', 'ns_live_x', ARRAY['read'], NULL, NULL);
END $$;

-- ── 1. the function judges: live, unknown, revoked, expired, not yet expired ──
DO $$
DECLARE
  r record;
  v_used timestamptz;
BEGIN
  SELECT last_used_at INTO v_used FROM public.mcp_api_keys WHERE id = 'db510000-0000-4000-8000-000000000101';
  IF v_used IS NOT NULL THEN RAISE EXCEPTION 'db-lane 051: fixture key already used'; END IF;

  SELECT * INTO r FROM public.validate_mcp_api_key('db51-hash-live');
  IF NOT r.is_valid OR r.rejection_reason IS NOT NULL
     OR r.user_id <> current_setting('lane.owner')::uuid
     OR r.key_id <> 'db510000-0000-4000-8000-000000000101'
     OR r.scopes <> ARRAY['read', 'write', 'propose'] THEN
    RAISE EXCEPTION 'db-lane 051: a live key should validate with its user, id and scopes, got %', row_to_json(r);
  END IF;
  -- O.2 (migration 20260922100000): the answer names the key, so the server
  -- can label what the key does without a second read.
  IF r.key_name IS DISTINCT FROM 'agent a' THEN
    RAISE EXCEPTION 'db-lane 051: a live key should answer with its name, got %', r.key_name;
  END IF;
  SELECT last_used_at INTO v_used FROM public.mcp_api_keys WHERE id = 'db510000-0000-4000-8000-000000000101';
  IF v_used IS NULL THEN RAISE EXCEPTION 'db-lane 051: a validated key is stamped last_used_at'; END IF;

  SELECT * INTO r FROM public.validate_mcp_api_key('db51-hash-nobody');
  IF r.is_valid OR r.rejection_reason <> 'Invalid API key' OR r.user_id IS NOT NULL OR r.key_id IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 051: an unknown hash should be refused as invalid with no user, got %', row_to_json(r);
  END IF;

  SELECT * INTO r FROM public.validate_mcp_api_key('db51-hash-revoked');
  IF r.is_valid OR r.rejection_reason <> 'API key has been revoked' THEN
    RAISE EXCEPTION 'db-lane 051: a revoked key should be refused as revoked, got %', row_to_json(r);
  END IF;

  SELECT * INTO r FROM public.validate_mcp_api_key('db51-hash-expired');
  IF r.is_valid OR r.rejection_reason <> 'API key has expired' THEN
    RAISE EXCEPTION 'db-lane 051: an expired key should be refused as expired, got %', row_to_json(r);
  END IF;
  SELECT last_used_at INTO v_used FROM public.mcp_api_keys WHERE id = 'db510000-0000-4000-8000-000000000103';
  IF v_used IS NOT NULL THEN RAISE EXCEPTION 'db-lane 051: a refused key is not stamped as used'; END IF;

  SELECT * INTO r FROM public.validate_mcp_api_key('db51-hash-read');
  IF NOT r.is_valid OR r.scopes <> ARRAY['read'] THEN
    RAISE EXCEPTION 'db-lane 051: a key expiring tomorrow validates today with its own scopes, got %', row_to_json(r);
  END IF;
END $$;

-- ── 2. the scopes vocabulary is closed at the table ──
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix, scopes)
      VALUES (current_setting('lane.owner')::uuid, 'too wide', 'db51-hash-wide', 'ns_live_w', ARRAY['read', 'admin']);
    RAISE EXCEPTION 'db-lane 051: a scope outside read/write/propose landed';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- ── 3. under RLS a person sees only their own keys and writes none ──
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.mcp_api_keys WHERE key_hash LIKE 'db51-hash-%';
  IF n <> 4 THEN RAISE EXCEPTION 'db-lane 051: the owner should see their own 4 fixture keys, saw %', n; END IF;
  SELECT count(*) INTO n FROM public.mcp_api_keys WHERE id = 'db510000-0000-4000-8000-000000000105';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 051: someone else''s key is visible'; END IF;

  BEGIN
    INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix)
      VALUES ('db510000-0000-4000-8000-000000000002', 'forged', 'db51-hash-forged', 'ns_live_f');
    RAISE EXCEPTION 'db-lane 051: a key minted for another user landed under RLS';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix)
      VALUES (current_setting('lane.owner')::uuid, 'own, direct', 'db51-hash-own', 'ns_live_n');
    RAISE EXCEPTION 'db-lane 051: a person minted their own key past the server (and its connection cap)';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE public.mcp_api_keys SET revoked_at = NULL WHERE id = 'db510000-0000-4000-8000-000000000102';
    RAISE EXCEPTION 'db-lane 051: a person wrote their own key row';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

-- ── 4. the server revokes (revoke_api_key); the key refuses on the next connection ──
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.mcp_api_keys SET revoked_at = now() WHERE id = 'db510000-0000-4000-8000-000000000104';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.validate_mcp_api_key('db51-hash-read');
  IF r.is_valid OR r.rejection_reason <> 'API key has been revoked' THEN
    RAISE EXCEPTION 'db-lane 051: a key the server revoked should refuse the next connection, got %', row_to_json(r);
  END IF;
  RAISE NOTICE 'db-lane 051: a live key validates and is stamped; unknown, revoked and expired keys refuse with their reason; scopes are closed; a person reads their own keys and writes none; a server revoke refuses the next connection';
END $$;
ROLLBACK;
