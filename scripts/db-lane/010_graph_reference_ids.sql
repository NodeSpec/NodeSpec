-- db-lane 010: graph_reference_ids answers the id sets propose_patches
-- validates a batch against, from the branch's CURRENT snapshot.
--
-- Behaviour, not text: a throwaway project with three snapshots is built
-- inside this transaction, the function is called the way the MCP server
-- calls it (as the service role, then as a stranger), and every answer is
-- asserted. Everything rolls back.
--
-- Guards the regression that shipped on main: the function's migration was
-- deleted because a fresh reset rejected it, and no unit test noticed that
-- the RPC every propose_patches call depends on did not exist.
--
-- Found while writing it: graph_snapshots carries the CHECK
-- graph_data_has_required_keys (id, schemaVersion, version, hash and the
-- four maps as objects), so the "older schema" shape the helper guards
-- against cannot reach the table any more. The helper's guard is verified
-- directly in the migration; here every snapshot is a legal one.
\set ON_ERROR_STOP on
BEGIN;

-- The MCP server reaches this function as the service role. Both spellings
-- of the claim are set so the test reads the same on a Supabase stack
-- (request.jwt.claims) and on the replay shim (request.jwt.claim.role).
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj  uuid := 'db100000-0000-4000-8000-000000000010';
  v_br    uuid := 'db100000-0000-4000-8000-000000000020';
  v_other uuid := 'db100000-0000-4000-8000-000000000030';
  v jsonb;
  -- a legal graph_data envelope around the four maps
  g CONSTANT text := '{"id":"g","schemaVersion":1,"version":%s,"hash":"h%s","nodes":%s,"edges":%s,"contracts":%s,"artifacts":%s}';
BEGIN
  IF to_regprocedure('public.graph_reference_ids(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 010: graph_reference_ids is not on this stack. Apply migration 20260919100000.';
  END IF;

  -- Any existing user owns the fixture; the seeded bench user when present.
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'db-lane 010: no auth.users row to own the fixture. Run supabase db reset (the seed creates bench@nodespec.local).';
  END IF;

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 010', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);

  -- Three snapshots, written out of order. The newest by patch_sequence (5)
  -- is the answer; version is deliberately NOT monotonic (the app orders by
  -- patch_sequence because version is unreliable on real data).
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence) VALUES
    (v_proj, v_br, format(g, 9, 1, '{"n1":{}}', '{}', '{}', '{}')::jsonb, md5('s1'), 1),
    (v_proj, v_br, format(g, 2, 5, '{"n1":{},"n2":{}}', '{"e1":{}}', '{"c1":{}}', '{"a1":{}}')::jsonb, md5('s5'), 5),
    (v_proj, v_br, format(g, 7, 3, '{"n1":{},"nX":{}}', '{}', '{"cX":{}}', '{}')::jsonb, md5('s3'), 3);

  SELECT public.graph_reference_ids(v_br) INTO v;
  IF (v->>'found')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'db-lane 010: expected found=true, got %', v;
  END IF;
  IF (v->>'patchSequence')::int <> 5 THEN
    RAISE EXCEPTION 'db-lane 010: expected the newest snapshot by patch_sequence (5), got %', v->>'patchSequence';
  END IF;
  IF (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(v->'nodes') x) <> ARRAY['n1','n2'] THEN
    RAISE EXCEPTION 'db-lane 010: node ids wrong (a higher version must not win over a higher patch_sequence): %', v->'nodes';
  END IF;
  IF v->'contracts' <> '["c1"]'::jsonb OR v->'edges' <> '["e1"]'::jsonb OR v->'artifacts' <> '["a1"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 010: contract/edge/artifact ids wrong: %', v;
  END IF;

  -- Empty maps answer empty arrays, not null: promote the sparse snapshot.
  UPDATE public.graph_snapshots SET patch_sequence = 9 WHERE branch_id = v_br AND hash = md5('s1');
  SELECT public.graph_reference_ids(v_br) INTO v;
  IF v->'nodes' <> '["n1"]'::jsonb OR v->'contracts' <> '[]'::jsonb OR v->'edges' <> '[]'::jsonb OR v->'artifacts' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 010: an empty map must answer [], got %', v;
  END IF;

  -- An unknown branch answers found=false with empty sets.
  SELECT public.graph_reference_ids(v_other) INTO v;
  IF (v->>'found')::boolean IS DISTINCT FROM false OR v->'nodes' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 010: unknown branch should answer found=false with empty sets, got %', v;
  END IF;

  RAISE NOTICE 'db-lane 010: graph_reference_ids answers the newest snapshot by patch_sequence; empty maps read as []';
END $$;

-- A stranger (authenticated, not the owner, not the service role) gets
-- nothing: the function is SECURITY DEFINER and carries its own owner check.
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = 'db100000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db100000-0000-4000-8000-000000000099"}';
DO $$
DECLARE v jsonb;
BEGIN
  SELECT public.graph_reference_ids('db100000-0000-4000-8000-000000000020') INTO v;
  IF (v->>'found')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'db-lane 010: a stranger must not read another owner''s branch, got %', v;
  END IF;
  RAISE NOTICE 'db-lane 010: a stranger reads found=false';
END $$;

ROLLBACK;
