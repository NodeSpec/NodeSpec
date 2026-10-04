-- db-lane 073: a leased node is locked, in the database too (V3 AA.5b, owner 2026-09-23).
--
--   While an agent holds a node, a person's graph patch that changes it (its
--   role or technology, an edge to it) is refused naming the holder. Moving
--   the node is layout and passes; so does an agent's patch (checked at
--   propose and accept), a person's own lease, and a lease gone stale. The
--   lease board is in the realtime publication.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db730000-0000-4000-8000-000000000001';
  v_proj uuid := 'db730000-0000-4000-8000-000000000010';
  v_br uuid := 'db730000-0000-4000-8000-000000000011';
  NODE uuid := 'db730000-0000-4000-8000-0000000000a1';
  OTHER uuid := 'db730000-0000-4000-8000-0000000000a2';
  KB uuid := 'db730000-0000-4000-8000-000000000052';
  v jsonb; v_seq int := 0; v_msg text;
BEGIN
  IF to_regprocedure('public.graph_patches_respect_leases()') IS NULL OR to_regprocedure('public.patch_changed_nodes(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 073: the leased-node lock is missing. Apply migration 20260923140000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-073-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 073', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix) VALUES (KB, v_owner, 'agent b', 'db73-hash-b', 'ns_live_b');

  v := public.agent_checkout_claim(v_proj, 'node', NULL, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL, NODE, NULL);
  IF NOT (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 073: agent-b should hold the node, got %', v; END IF;

  -- a person, signed in
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- a structure change: refused, naming the holder
  BEGIN
    v_seq := v_seq + 1;
    INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
    VALUES (gen_random_uuid(), v_br, v_seq, 'update_node', 'human', v_owner, 'swap the tech',
            jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('technology', 'fastify'))));
    RAISE EXCEPTION 'db-lane 073: a person''s structure change on a leased node should be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%is leased by agent-b%' THEN RAISE EXCEPTION 'db-lane 073: the refusal should name agent-b, got %', v_msg; END IF;
    v_seq := v_seq - 1;
  END;

  -- an edge to the leased node is its structure too
  BEGIN
    v_seq := v_seq + 1;
    INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
    VALUES (gen_random_uuid(), v_br, v_seq, 'add_edge', 'human', v_owner, 'connect',
            jsonb_build_object('type', 'add_edge', 'payload', jsonb_build_object('id', gen_random_uuid(), 'source', OTHER, 'target', NODE)));
    RAISE EXCEPTION 'db-lane 073: an edge to a leased node should be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    v_seq := v_seq - 1;
  END;

  -- moving it is layout: passes
  v_seq := v_seq + 1;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
  VALUES (gen_random_uuid(), v_br, v_seq, 'update_node', 'human', v_owner, 'move',
          jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('position', jsonb_build_object('x', 10, 'y', 20)))));

  -- an agent's patch passes (checked at propose and accept, where its author is known)
  v_seq := v_seq + 1;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
  VALUES (gen_random_uuid(), v_br, v_seq, 'update_node', 'ai', NULL, 'agent change',
          jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('technology', 'fastify'))));

  -- a node nobody holds: passes
  v_seq := v_seq + 1;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
  VALUES (gen_random_uuid(), v_br, v_seq, 'update_node', 'human', v_owner, 'free node',
          jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', OTHER, 'changes', jsonb_build_object('technology', 'express'))));

  -- a lease gone stale locks nothing
  UPDATE public.agent_checkouts SET heartbeat_at = now() - interval '2 hours' WHERE id = (v->>'checkoutId')::uuid;
  v_seq := v_seq + 1;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
  VALUES (gen_random_uuid(), v_br, v_seq, 'update_node', 'human', v_owner, 'after the lease went stale',
          jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('technology', 'hono'))));

  -- a person's own lease never locks them out
  UPDATE public.agent_checkouts SET heartbeat_at = now(), holder_delegate = 'user:' || v_owner::text WHERE id = (v->>'checkoutId')::uuid;
  v_seq := v_seq + 1;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload)
  VALUES (gen_random_uuid(), v_br, v_seq, 'update_node', 'human', v_owner, 'my own lease',
          jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('technology', 'koa'))));

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'agent_checkouts') THEN
    RAISE EXCEPTION 'db-lane 073: agent_checkouts should be in the realtime publication';
  END IF;
  RAISE NOTICE 'db-lane 073: a person''s change to a leased node is refused naming its holder; moves, agent patches, free nodes, stale leases and your own lease pass; the lease board is live';
END $$;

ROLLBACK;
