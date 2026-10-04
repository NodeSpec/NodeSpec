-- db-lane 065: the plan's connection allowance is counted by the database.
--
--   The MCP server compares agent_connection_count (migration
--   20260921130000) with the plan's allowance before it mints a key or an
--   OAuth authorization code. Every Deno test scripts that number; this
--   file runs the function on real rows: live keys count, revoked and
--   expired keys do not; each OAuth client with a live token family counts
--   once however many rows the rotation left, a client whose access token
--   expired but whose refresh is still ahead still counts, revoked and
--   fully expired clients do not; the client that is renewing is left out
--   by name; another person's rows never count; a session cannot call it.
--   Then the identity rule: one live key per name per person, case
--   blind, and a revoked key frees its name.
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
  IF to_regprocedure('public.agent_connection_count(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 065: agent_connection_count(uuid, text) is missing. Apply migration 20260921130000.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_mcp_api_keys_active_name') THEN
    RAISE EXCEPTION 'db-lane 065: idx_mcp_api_keys_active_name is missing. Apply migration 20260921130000.';
  END IF;
  -- The owner is the fixture's own: the counts are absolute, and a seeded
  -- stack's bench user already holds a key (supabase/seed.sql).
  v_owner := 'db650000-0000-4000-8000-000000000001';
  PERFORM set_config('lane.owner', v_owner::text, true);

  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'db-lane-065-owner@nodespec.local'),
    ('db650000-0000-4000-8000-000000000002', 'db-lane-065-other@nodespec.local');

  -- keys: two live, one revoked, one expired (owner); one live (other)
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at, revoked_at) VALUES
    ('db650000-0000-4000-8000-000000000101', v_owner, 'hermes',      'db65-hash-hermes',  'ns_live_h', ARRAY['read', 'write', 'propose'], NULL, NULL),
    ('db650000-0000-4000-8000-000000000102', v_owner, 'claude code', 'db65-hash-claude',  'ns_live_c', ARRAY['read', 'write', 'propose'], now() + interval '30 days', NULL),
    ('db650000-0000-4000-8000-000000000103', v_owner, 'old runner',  'db65-hash-old',     'ns_live_o', ARRAY['read'], NULL, now() - interval '1 day'),
    ('db650000-0000-4000-8000-000000000104', v_owner, 'expired',     'db65-hash-expired', 'ns_live_e', ARRAY['read'], now() - interval '1 hour', NULL),
    ('db650000-0000-4000-8000-000000000105', 'db650000-0000-4000-8000-000000000002', 'hermes', 'db65-hash-other', 'ns_live_x', ARRAY['read'], NULL, NULL);

  -- OAuth: client X rotated once (old row revoked, new row live); client W
  -- with an expired access token and a live refresh; client Y revoked;
  -- client Z fully expired; the other person's client V live
  INSERT INTO public.mcp_oauth_tokens (id, access_token_hash, refresh_token_hash, user_id, client_id, scopes, expires_at, refresh_expires_at, revoked_at) VALUES
    ('db650000-0000-4000-8000-000000000201', 'db65-x-old', 'db65-x-old-r', v_owner, 'client-x', ARRAY['read', 'write', 'propose'], now() + interval '1 day', now() + interval '10 days', now() - interval '1 hour'),
    ('db650000-0000-4000-8000-000000000202', 'db65-x-new', 'db65-x-new-r', v_owner, 'client-x', ARRAY['read', 'write', 'propose'], now() + interval '7 days', now() + interval '60 days', NULL),
    ('db650000-0000-4000-8000-000000000203', 'db65-w',     'db65-w-r',     v_owner, 'client-w', ARRAY['read', 'write', 'propose'], now() - interval '1 day', now() + interval '20 days', NULL),
    ('db650000-0000-4000-8000-000000000204', 'db65-y',     'db65-y-r',     v_owner, 'client-y', ARRAY['read'], now() + interval '7 days', now() + interval '60 days', now() - interval '1 day'),
    ('db650000-0000-4000-8000-000000000205', 'db65-z',     NULL,           v_owner, 'client-z', ARRAY['read'], now() - interval '1 day', NULL, NULL),
    ('db650000-0000-4000-8000-000000000206', 'db65-v',     'db65-v-r',     'db650000-0000-4000-8000-000000000002', 'client-v', ARRAY['read'], now() + interval '7 days', now() + interval '60 days', NULL);
  UPDATE public.mcp_oauth_tokens SET rotated_to = 'db650000-0000-4000-8000-000000000202' WHERE id = 'db650000-0000-4000-8000-000000000201';
END $$;

-- ── 1. the count: keys and clients, live only, per person ──────────────────────
DO $$
DECLARE
  v_owner uuid := current_setting('lane.owner')::uuid;
  n integer;
BEGIN
  n := public.agent_connection_count(v_owner);
  IF n <> 4 THEN
    RAISE EXCEPTION 'db-lane 065: two live keys and two live clients (x rotated, w refreshable) should count 4, got %', n;
  END IF;

  n := public.agent_connection_count(v_owner, 'client-x');
  IF n <> 3 THEN
    RAISE EXCEPTION 'db-lane 065: the client renewing its own connection is left out, expected 3, got %', n;
  END IF;

  n := public.agent_connection_count(v_owner, 'client-nobody');
  IF n <> 4 THEN
    RAISE EXCEPTION 'db-lane 065: leaving out an unknown client changes nothing, expected 4, got %', n;
  END IF;

  n := public.agent_connection_count('db650000-0000-4000-8000-000000000002');
  IF n <> 2 THEN
    RAISE EXCEPTION 'db-lane 065: the other person counts only their own key and client, expected 2, got %', n;
  END IF;

  n := public.agent_connection_count('db650000-0000-4000-8000-000000000009');
  IF n <> 0 THEN
    RAISE EXCEPTION 'db-lane 065: nobody has nothing, expected 0, got %', n;
  END IF;

  -- revoking the live client-x row and the hermes key drops both
  UPDATE public.mcp_oauth_tokens SET revoked_at = now() WHERE id = 'db650000-0000-4000-8000-000000000202';
  UPDATE public.mcp_api_keys SET revoked_at = now() WHERE id = 'db650000-0000-4000-8000-000000000101';
  n := public.agent_connection_count(v_owner);
  IF n <> 2 THEN
    RAISE EXCEPTION 'db-lane 065: a revoke drops the count at once, expected 2, got %', n;
  END IF;
END $$;

-- ── 2. a session cannot count anyone, itself included ─────────────────────────
DO $$
DECLARE
  v_owner uuid := current_setting('lane.owner')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.agent_connection_count(v_owner);
    RAISE EXCEPTION 'db-lane 065: a session must not execute agent_connection_count';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
END $$;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- ── 3. one live name per person, case blind; a revoked key frees its name ─────
DO $$
DECLARE
  v_owner uuid := current_setting('lane.owner')::uuid;
BEGIN
  BEGIN
    INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix, scopes)
    VALUES (v_owner, 'Claude Code', 'db65-hash-dup', 'ns_live_d', ARRAY['read']);
    RAISE EXCEPTION 'db-lane 065: a second live key named "Claude Code" (the live one is "claude code") must be refused';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- the other person may use the same name (they already do: "hermes")
  INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix, scopes)
  VALUES ('db650000-0000-4000-8000-000000000002', 'claude code', 'db65-hash-other-cc', 'ns_live_y', ARRAY['read']);

  -- hermes was revoked in step 1: the name is free again for its owner
  INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix, scopes)
  VALUES (v_owner, 'hermes', 'db65-hash-hermes-2', 'ns_live_h2', ARRAY['read', 'write', 'propose']);

  -- and a revoked duplicate never blocks: the index is partial
  IF (SELECT count(*) FROM public.mcp_api_keys WHERE user_id = v_owner AND lower(name) = 'hermes') <> 2 THEN
    RAISE EXCEPTION 'db-lane 065: expected the revoked hermes and the new hermes side by side';
  END IF;

  RAISE NOTICE 'db-lane 065: live keys and live OAuth clients count once each per person, the renewing client is left out, revoked and expired count nothing, a session cannot count; one live key per name, case blind, and a revoke frees the name';
END $$;

ROLLBACK;
