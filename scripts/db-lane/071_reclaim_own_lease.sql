-- db-lane 071: re-claiming your own lease renews it (V3 AA.0, owner 2026-09-23).
--
--   Agent A claims a task; A claims it again: the same lease comes back
--   (claimed, renewed, same id), its heartbeat moves and its meta merges;
--   there is still exactly one active lease. Agent B is still told A holds it.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db710000-0000-4000-8000-000000000001';
  v_proj uuid := 'db710000-0000-4000-8000-000000000010';
  T1 uuid := 'db710000-0000-4000-8000-000000000021';
  KA uuid := 'db710000-0000-4000-8000-000000000051';
  KB uuid := 'db710000-0000-4000-8000-000000000052';
  v jsonb; v2 jsonb; n int; v_meta jsonb; v_hb timestamptz; v_hb2 timestamptz;
BEGIN
  IF to_regprocedure('public.agent_checkout_claim(uuid, text, uuid, text, text, uuid, uuid, uuid, jsonb, integer, text, text, uuid, text[], uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'db-lane 071: agent_checkout_claim with the box-aware signature is missing. Apply migration 20260923190000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-071-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 071', v_owner);
  INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title)
    VALUES (T1, v_proj, 'db710000-0000-4000-8000-0000000000a1', 't1', 'T1', 'Pour the pool');
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix) VALUES
    (KA, v_owner, 'agent a', 'db71-hash-a', 'ns_live_a'),
    (KB, v_owner, 'agent b', 'db71-hash-b', 'ns_live_b');

  v := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-a', KA, NULL, NULL, '{"tests": ["pool"]}'::jsonb, 30, 'key:' || KA::text, NULL);
  IF NOT (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 071: A should claim, got %', v; END IF;
  UPDATE public.agent_checkouts SET heartbeat_at = now() - interval '5 minutes' WHERE id = (v->>'checkoutId')::uuid;
  SELECT heartbeat_at INTO v_hb FROM public.agent_checkouts WHERE id = (v->>'checkoutId')::uuid;

  v2 := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-a', KA, NULL, NULL, '{"touches": ["src/pool.ts"]}'::jsonb, 30, 'key:' || KA::text, NULL);
  IF NOT (v2->>'claimed')::boolean OR NOT (v2->>'renewed')::boolean OR v2->>'checkoutId' <> v->>'checkoutId' THEN
    RAISE EXCEPTION 'db-lane 071: A re-claiming its own fresh lease should renew the same one, got %', v2;
  END IF;
  SELECT heartbeat_at, meta INTO v_hb2, v_meta FROM public.agent_checkouts WHERE id = (v->>'checkoutId')::uuid;
  IF v_hb2 <= v_hb THEN RAISE EXCEPTION 'db-lane 071: the renewal should move the heartbeat'; END IF;
  IF v_meta->'tests' IS NULL OR v_meta->'touches' IS NULL THEN RAISE EXCEPTION 'db-lane 071: the renewal should merge meta, got %', v_meta; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE task_item_id = T1 AND released_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 071: exactly one active lease, found %', n; END IF;

  v := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL);
  IF (v->>'claimed')::boolean OR v->>'heldBy' <> 'agent-a' THEN RAISE EXCEPTION 'db-lane 071: B should be told A holds it, got %', v; END IF;
  RAISE NOTICE 'db-lane 071: the holder re-claiming renews its own lease (same id, heartbeat, meta merged); anyone else reads the holder';
END $$;

ROLLBACK;
