-- db-lane 072: a lease is a lock; work inside a node runs in parallel (V3 AA.5, owner 2026-09-23).
--
--   Two task leases on one node whose reaches do not overlap are both
--   granted. A third whose reach overlaps is refused with the holder, what it
--   holds and the file that couples them. A node lease waits for the work
--   inside the node; once it is held, no one else's work starts there. A
--   lease with no recorded reach reaches the whole node, and a stale work
--   lease never blocks.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db720000-0000-4000-8000-000000000001';
  v_proj uuid := 'db720000-0000-4000-8000-000000000010';
  NODE uuid := 'db720000-0000-4000-8000-0000000000a1';
  T1 uuid := 'db720000-0000-4000-8000-000000000021';
  T2 uuid := 'db720000-0000-4000-8000-000000000022';
  T3 uuid := 'db720000-0000-4000-8000-000000000023';
  KA uuid := 'db720000-0000-4000-8000-000000000051';
  KB uuid := 'db720000-0000-4000-8000-000000000052';
  KC uuid := 'db720000-0000-4000-8000-000000000053';
  a jsonb; b jsonb; c jsonb; n int;
BEGIN
  IF to_regprocedure('public.agent_checkout_claim(uuid, text, uuid, text, text, uuid, uuid, uuid, jsonb, integer, text, text, uuid, text[], uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'db-lane 072: agent_checkout_claim with the box-aware signature is missing. Apply migration 20260923190000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-072-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 072', v_owner);
  INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title) VALUES
    (T1, v_proj, NODE, 't1', 'T1', 'Price the cart'),
    (T2, v_proj, NODE, 't2', 'T2', 'Send the receipt'),
    (T3, v_proj, NODE, 't3', 'T3', 'Round the tax');
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix) VALUES
    (KA, v_owner, 'agent a', 'db72-hash-a', 'ns_live_a'),
    (KB, v_owner, 'agent b', 'db72-hash-b', 'ns_live_b'),
    (KC, v_owner, 'agent c', 'db72-hash-c', 'ns_live_c');

  -- disjoint reaches inside one node: both granted, each records its node
  a := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, 'key:' || KA::text, NULL, NULL, ARRAY['src/cart.ts', 'src/price.ts']);
  b := public.agent_checkout_claim(v_proj, 'task', T2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, NULL, ARRAY['src/receipt.ts']);
  IF NOT (a->>'claimed')::boolean OR NOT (b->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 072: disjoint reaches should both be granted, got % and %', a, b; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE node_id = NODE AND released_at IS NULL AND meta ? 'reach';
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 072: both leases should record the node and their reach, found %', n; END IF;

  -- an overlapping reach: refused with the holder, what it holds and the coupling file
  c := public.agent_checkout_claim(v_proj, 'task', T3, 'agent', 'agent-c', KC, NULL, NULL, '{}'::jsonb, 30, 'key:' || KC::text, NULL, NULL, ARRAY['src/tax.ts', 'src/price.ts']);
  IF (c->>'claimed')::boolean OR c->>'conflict' <> 'reach' OR c->>'heldBy' <> 'agent-a' OR c->>'coupling' <> 'src/price.ts' THEN
    RAISE EXCEPTION 'db-lane 072: an overlapping reach should be refused naming agent-a and src/price.ts, got %', c;
  END IF;

  -- the node lease waits for the work inside the node
  c := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-c', KC, NULL, NULL, '{}'::jsonb, 30, 'key:' || KC::text, NULL, NODE, NULL);
  IF (c->>'claimed')::boolean OR c->>'conflict' <> 'work' THEN RAISE EXCEPTION 'db-lane 072: the node lease should wait for the work inside it, got %', c; END IF;

  -- a stale work lease never blocks; a fresh one released clears the way
  UPDATE public.agent_checkouts SET heartbeat_at = now() - interval '2 hours' WHERE id = (a->>'checkoutId')::uuid;
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE id = (b->>'checkoutId')::uuid;
  c := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-c', KC, NULL, NULL, '{}'::jsonb, 30, 'key:' || KC::text, NULL, NODE, NULL);
  IF NOT (c->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 072: with only stale work inside, the node lease should be granted, got %', c; END IF;
  IF (SELECT task_item_id IS NULL AND node_id = NODE FROM public.agent_checkouts WHERE id = (c->>'checkoutId')::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'db-lane 072: a node lease carries the node and no row reference';
  END IF;

  -- while the node is leased, no one else's work starts there
  b := public.agent_checkout_claim(v_proj, 'task', T2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, NULL, ARRAY['src/receipt.ts']);
  IF (b->>'claimed')::boolean OR b->>'conflict' <> 'node' OR b->>'heldBy' <> 'agent-c' THEN RAISE EXCEPTION 'db-lane 072: work should wait for the node lease, got %', b; END IF;
  -- and a second node lease reads the holder
  b := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, NODE, NULL);
  IF (b->>'claimed')::boolean OR b->>'heldBy' <> 'agent-c' THEN RAISE EXCEPTION 'db-lane 072: one node lease per node, got %', b; END IF;

  -- a lease with no reach declared reaches the whole node
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE id = (c->>'checkoutId')::uuid;
  a := public.agent_checkout_claim(v_proj, 'task', T2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, NULL, NULL);
  c := public.agent_checkout_claim(v_proj, 'task', T3, 'agent', 'agent-c', KC, NULL, NULL, '{}'::jsonb, 30, 'key:' || KC::text, NULL, NULL, ARRAY['src/tax.ts']);
  IF NOT (a->>'claimed')::boolean OR (c->>'claimed')::boolean OR c->>'coupling' <> '*' THEN
    RAISE EXCEPTION 'db-lane 072: an undeclared scope covers the whole node, got % then %', a, c;
  END IF;
  RAISE NOTICE 'db-lane 072: disjoint reaches run in parallel; an overlap names its holder and coupling file; the node lease waits for the work and then locks it; no scope means the whole node';
END $$;

ROLLBACK;
