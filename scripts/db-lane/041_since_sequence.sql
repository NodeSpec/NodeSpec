-- db-lane 041: the boundary since_sequence reads.
--
-- V3 2.2 makes get_architecture_overview answer headSequence on every call
-- and, with since_sequence, the patches appended after that read, in
-- order, with who wrote them. The handler is one query; this file proves
-- the rows are what it maps: the boundary is strict (after N, never N), the
-- order is by sequence, actor_type carries the human/ai distinction, and
-- the stored payload is the whole envelope whose type matches patch_type.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj  uuid := 'db410000-0000-4000-8000-000000000010';
  v_br    uuid := 'db410000-0000-4000-8000-000000000020';
  v_n1    uuid := 'db410000-0000-4000-8000-000000000031';
  v_seqs  bigint[]; v_actors text[]; v_head bigint; v_none int; v_shape int;
  env CONSTANT text := '{"type":"update_node","payload":{"id":"%s","changes":{"label":"%s"}},"metadata":{"id":"%s","actorType":"%s","summary":"%s","timestamp":"2026-09-19T00:00:00.000Z"}}';
BEGIN
  IF to_regclass('public.graph_patches') IS NULL OR to_regprocedure('public.get_next_patch_sequence(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 041: graph_patches or get_next_patch_sequence is missing. Apply migration 20260713200000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'db-lane 041: no auth.users row to own the fixture. Run supabase db reset (the seed creates bench@nodespec.local).';
  END IF;
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 041', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);

  -- Five patches, human and ai alternating, each through the sequence function.
  FOR i IN 1..5 LOOP
    INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, summary, payload)
      VALUES (gen_random_uuid(), v_br, public.get_next_patch_sequence(v_br), 'update_node',
              CASE WHEN i % 2 = 0 THEN 'human' ELSE 'ai' END, 'patch ' || i,
              format(env, v_n1, 'v' || i, gen_random_uuid(), CASE WHEN i % 2 = 0 THEN 'human' ELSE 'ai' END, 'patch ' || i)::jsonb);
  END LOOP;

  SELECT max(sequence) INTO v_head FROM public.graph_patches WHERE branch_id = v_br;
  IF v_head <> 5 THEN RAISE EXCEPTION 'db-lane 041: head should be 5, got %', v_head; END IF;

  -- After 3: exactly 4 and 5, in order, with their actors.
  SELECT array_agg(sequence ORDER BY sequence), array_agg(actor_type ORDER BY sequence) INTO v_seqs, v_actors
    FROM public.graph_patches WHERE branch_id = v_br AND sequence > 3;
  IF v_seqs <> ARRAY[4, 5]::bigint[] THEN RAISE EXCEPTION 'db-lane 041: after 3 should be {4,5}, got %', v_seqs; END IF;
  IF v_actors <> ARRAY['human', 'ai'] THEN RAISE EXCEPTION 'db-lane 041: actors after 3 should be {human,ai}, got %', v_actors; END IF;

  -- After the head: nothing. The boundary is strict.
  SELECT count(*) INTO v_none FROM public.graph_patches WHERE branch_id = v_br AND sequence > 5;
  IF v_none <> 0 THEN RAISE EXCEPTION 'db-lane 041: after the head there should be nothing, got %', v_none; END IF;

  -- Every row is the envelope the handlers map: payload.type = patch_type.
  SELECT count(*) INTO v_shape FROM public.graph_patches
    WHERE branch_id = v_br AND (payload->>'type' IS DISTINCT FROM patch_type OR payload->'payload'->>'id' IS NULL);
  IF v_shape <> 0 THEN RAISE EXCEPTION 'db-lane 041: % row(s) do not carry the patch envelope in payload', v_shape; END IF;

  RAISE NOTICE 'db-lane 041: head 5; after 3 reads exactly {4 human, 5 ai}; after 5 reads nothing; every payload is the envelope';
END $$;

ROLLBACK;
