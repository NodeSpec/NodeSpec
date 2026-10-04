-- db-lane 040: the sequence substrate base_sequence stands on.
--
-- V3 2.1 lets an agent say which branch head it read (base_sequence) and
-- refuses a proposal whose targets a later patch changed, at propose and
-- again at accept. That only means something if the sequence is what the
-- code believes: get_next_patch_sequence is a plain max plus one with no
-- lock, the hash-chain trigger's advisory lock serializes the HASH, and the
-- unique (branch_id, sequence) index is what stops two writers who read
-- the same head from both landing. This file proves that on real rows:
-- two writers read the same next sequence, the first lands, the second is
-- refused, the chain stays intact, and "after N" is exactly the survivor.
-- The accept-time refusal is TypeScript and is proven in vitest.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj  uuid := 'db400000-0000-4000-8000-000000000010';
  v_br    uuid := 'db400000-0000-4000-8000-000000000020';
  v_n1    uuid := 'db400000-0000-4000-8000-000000000031';
  v_next bigint; v_a bigint; v_b bigint;
  v_refused boolean := false;
  v_status text; v_head bigint; v_after int; v_gaps int;
  -- a stored patch is the whole envelope (type, payload, metadata), the
  -- shape laterPatchFromRow reads back
  env CONSTANT text := '{"type":"update_node","payload":{"id":"%s","changes":{"label":"%s"}},"metadata":{"id":"%s","actorType":"%s","summary":"%s","timestamp":"2026-09-19T00:00:00.000Z"}}';
BEGIN
  IF to_regclass('public.graph_patches') IS NULL OR to_regprocedure('public.get_next_patch_sequence(uuid)') IS NULL
     OR to_regprocedure('public.verify_patch_chain(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 040: graph_patches, get_next_patch_sequence or verify_patch_chain is missing. Apply migration 20260713200000.';
  END IF;

  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'db-lane 040: no auth.users row to own the fixture. Run supabase db reset (the seed creates bench@nodespec.local).';
  END IF;
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 040', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);

  -- An empty branch answers 1; the first patch lands through the normal lane.
  v_next := public.get_next_patch_sequence(v_br);
  IF v_next <> 1 THEN RAISE EXCEPTION 'db-lane 040: an empty branch should answer 1, got %', v_next; END IF;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, summary, payload)
    VALUES (gen_random_uuid(), v_br, v_next, 'update_node', 'human', 'first',
            format(env, v_n1, 'A', gen_random_uuid(), 'human', 'first')::jsonb);

  -- Two writers read the same head. Both are told 2.
  v_a := public.get_next_patch_sequence(v_br);
  v_b := public.get_next_patch_sequence(v_br);
  IF v_a <> 2 OR v_b <> 2 THEN
    RAISE EXCEPTION 'db-lane 040: two readers of one head should both be told 2, got % and %', v_a, v_b;
  END IF;

  -- The first lands.
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, summary, payload)
    VALUES (gen_random_uuid(), v_br, v_a, 'update_node', 'ai', 'writer A',
            format(env, v_n1, 'B', gen_random_uuid(), 'ai', 'writer A')::jsonb);

  -- The second is refused by the unique (branch_id, sequence) index, never
  -- silently interleaved: the head an agent read cannot be overtaken without
  -- the sequence moving.
  BEGIN
    INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, summary, payload)
      VALUES (gen_random_uuid(), v_br, v_b, 'update_node', 'ai', 'writer B',
              format(env, v_n1, 'C', gen_random_uuid(), 'ai', 'writer B')::jsonb);
    RAISE EXCEPTION 'db-lane 040: the second writer landed on sequence %; the unique (branch_id, sequence) index is gone', v_b;
  EXCEPTION WHEN unique_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 040: expected a unique_violation for the second writer'; END IF;

  -- The chain is intact, the head moved by exactly one, no gaps, and
  -- "after 1" is exactly the survivor with its actor.
  SELECT chain_status INTO v_status FROM public.verify_patch_chain(v_br);
  IF v_status <> 'intact' THEN RAISE EXCEPTION 'db-lane 040: chain should read intact, got %', v_status; END IF;
  SELECT max(sequence) INTO v_head FROM public.graph_patches WHERE branch_id = v_br;
  IF v_head <> 2 THEN RAISE EXCEPTION 'db-lane 040: head should be 2, got %', v_head; END IF;
  SELECT count(*) INTO v_gaps FROM generate_series(1, v_head) s
    WHERE NOT EXISTS (SELECT 1 FROM public.graph_patches WHERE branch_id = v_br AND sequence = s);
  IF v_gaps <> 0 THEN RAISE EXCEPTION 'db-lane 040: % gap(s) in the sequence', v_gaps; END IF;
  SELECT count(*) INTO v_after FROM public.graph_patches
    WHERE branch_id = v_br AND sequence > 1 AND actor_type = 'ai' AND summary = 'writer A'
      AND payload->>'type' = patch_type AND payload->'payload'->>'id' = v_n1::text;
  IF v_after <> 1 THEN RAISE EXCEPTION 'db-lane 040: after sequence 1 there should be exactly writer A, got % row(s)', v_after; END IF;

  RAISE NOTICE 'db-lane 040: two writers who read head 1 both got 2; the first landed, the second was refused; chain intact, head 2, no gaps';
END $$;

ROLLBACK;
