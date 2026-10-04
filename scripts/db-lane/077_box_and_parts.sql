-- db-lane 077: a box and its parts under the lease (V3 AA.3, owner 2026-09-23).
--
--   On an exploded node the box's lease covers its parts; a part's lease is
--   refused while the box is held, and the reverse. Work inside a part waits
--   for the box's lease, and the box's lease waits for work inside its parts.
--   A person's patch to a part is refused while someone else holds the box.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db770000-0000-4000-8000-000000000001';
  v_proj uuid := 'db770000-0000-4000-8000-000000000010';
  v_br uuid := 'db770000-0000-4000-8000-000000000011';
  BOX uuid := 'db770000-0000-4000-8000-0000000000b0';
  PART uuid := 'db770000-0000-4000-8000-0000000000b1';
  OTHER uuid := 'db770000-0000-4000-8000-0000000000c0';
  T1 uuid := 'db770000-0000-4000-8000-000000000021';
  KA uuid := 'db770000-0000-4000-8000-000000000051';
  KB uuid := 'db770000-0000-4000-8000-000000000052';
  a jsonb; b jsonb; v_msg text;
BEGIN
  IF to_regprocedure('public.agent_checkout_claim(uuid, text, uuid, text, text, uuid, uuid, uuid, jsonb, integer, text, text, uuid, text[], uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'db-lane 077: agent_checkout_claim with the box-aware signature is missing. Apply migration 20260923190000.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'part-handler' AND 'part' = ANY(capability_tags)) THEN
    RAISE EXCEPTION 'db-lane 077: the part roles are missing. Apply migration 20260923160000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-077-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 077', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title) VALUES (T1, v_proj, PART, 't1', 'T1', 'Route the orders');
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix) VALUES
    (KA, v_owner, 'agent a', 'db77-hash-a', 'ns_live_a'),
    (KB, v_owner, 'agent b', 'db77-hash-b', 'ns_live_b');
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence) VALUES
    (v_proj, v_br, jsonb_build_object('id', v_br, 'schemaVersion', 8, 'version', 0, 'hash', 'db77', 'edges', '{}'::jsonb, 'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb, 'nodes', jsonb_build_object(
       BOX::text, jsonb_build_object('id', BOX, 'type', 'backend-service', 'label', 'Checkout API'),
       PART::text, jsonb_build_object('id', PART, 'type', 'part-handler', 'label', 'Routes', 'parentId', BOX),
       OTHER::text, jsonb_build_object('id', OTHER, 'type', 'frontend-app', 'label', 'Web'))), 'db77', 0);

  -- agent a holds the box
  a := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, 'key:' || KA::text, NULL, BOX, NULL, NULL, ARRAY[PART]);
  IF NOT (a->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 077: agent-a should hold the box, got %', a; END IF;

  -- a part's lease is refused while the box is held
  b := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, PART, NULL, BOX, NULL);
  IF (b->>'claimed')::boolean OR b->>'conflict' <> 'node' OR b->>'relation' <> 'box' OR b->>'heldNode' <> BOX::text OR b->>'heldBy' <> 'agent-a' THEN
    RAISE EXCEPTION 'db-lane 077: a part''s lease should wait for the box, got %', b;
  END IF;
  -- and work inside the part waits for the box's lease
  b := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, PART, ARRAY['src/routes/orders.ts'], BOX, NULL);
  IF (b->>'claimed')::boolean OR b->>'conflict' <> 'node' OR b->>'relation' <> 'box' THEN
    RAISE EXCEPTION 'db-lane 077: work inside a part should wait for the box''s lease, got %', b;
  END IF;

  -- a person's patch to the part is refused while someone else holds the box
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
    VALUES (gen_random_uuid(), v_br, 1, 'update_node', 'human', v_owner, 'rename the part',
            jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', PART, 'changes', jsonb_build_object('label', 'Handlers'))));
    RAISE EXCEPTION 'db-lane 077: a person''s change to a part of a leased box should be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%is part of node%leased by agent-a%' THEN RAISE EXCEPTION 'db-lane 077: the refusal should name the box and agent-a, got %', v_msg; END IF;
  END;
  -- a node outside the box passes
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
  VALUES (gen_random_uuid(), v_br, 1, 'update_node', 'human', v_owner, 'the web app',
          jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', OTHER, 'changes', jsonb_build_object('label', 'Web app'))));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- the reverse: with the part held, the box's lease is refused
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE id = (a->>'checkoutId')::uuid;
  b := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, PART, NULL, BOX, NULL);
  IF NOT (b->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 077: with the box free, the part''s lease should be granted, got %', b; END IF;
  a := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, 'key:' || KA::text, NULL, BOX, NULL, NULL, ARRAY[PART]);
  IF (a->>'claimed')::boolean OR a->>'relation' <> 'part' OR a->>'heldNode' <> PART::text THEN
    RAISE EXCEPTION 'db-lane 077: the box''s lease should wait for its part''s, got %', a;
  END IF;

  -- and the box's lease waits for work inside its parts
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE id = (b->>'checkoutId')::uuid;
  b := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, PART, ARRAY['src/routes/orders.ts'], BOX, NULL);
  IF NOT (b->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 077: with the box free, work inside the part should be granted, got %', b; END IF;
  a := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, 'key:' || KA::text, NULL, BOX, NULL, NULL, ARRAY[PART]);
  IF (a->>'claimed')::boolean OR a->>'conflict' <> 'work' THEN
    RAISE EXCEPTION 'db-lane 077: the box''s lease should wait for work inside its parts, got %', a;
  END IF;

  RAISE NOTICE 'db-lane 077: the box''s lease covers its parts and waits for their work; a part''s lease and work wait for the box; a person''s patch to a part of a held box is refused';
END $$;

ROLLBACK;
