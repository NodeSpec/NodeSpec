-- db-lane 076: the repo index follows an explode (V3 AA.3, owner 2026-09-23).
--
--   An accepted proposal's metadata.repoIndexMoves rebinds repo_index rows:
--   a file moves to its part; a move to a part whose add_node was rejected
--   stays put; a row whose node changed since filing is left alone; a
--   proposal that is only reviewed (not accepted) moves nothing; a collapse
--   whose remove_node was rejected keeps the part's files.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db760000-0000-4000-8000-000000000001';
  v_proj uuid := 'db760000-0000-4000-8000-000000000010';
  v_br uuid := 'db760000-0000-4000-8000-000000000011';
  v_run uuid := 'db760000-0000-4000-8000-000000000020';
  v_prop uuid := 'db760000-0000-4000-8000-000000000021';
  v_prop2 uuid := 'db760000-0000-4000-8000-000000000022';
  v_node text := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_a text := 'aaaaaaaa-0000-4000-8000-00000000000a';
  v_b text := 'aaaaaaaa-0000-4000-8000-00000000000b';
  v_other text := 'aaaaaaaa-0000-4000-8000-0000000000ff';
  v_at text;
BEGIN
  IF to_regprocedure('public.explode_rebind_on_proposal_accept()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 076: the rebind trigger is missing. Apply migration 20260923170000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-076-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 076', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status) VALUES (v_run, v_proj, v_br, 'db-lane', 'db76', 'completed');

  INSERT INTO public.repo_index (branch_id, path, node_id) VALUES
    (v_br, 'src/routes/orders.ts', v_node),
    (v_br, 'src/db/orders.ts', v_node),
    (v_br, 'src/moved-since.ts', v_other),
    (v_br, 'src/stays.ts', v_node);

  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata) VALUES
    (v_prop, v_run, v_br, v_br, 'pending',
     jsonb_build_array(
       jsonb_build_object('status', 'approved', 'patch', jsonb_build_object('type', 'add_node', 'payload', jsonb_build_object('id', v_a, 'type', 'part-handler', 'label', 'Routes', 'parentId', v_node))),
       jsonb_build_object('status', 'rejected', 'patch', jsonb_build_object('type', 'add_node', 'payload', jsonb_build_object('id', v_b, 'type', 'part-repository', 'label', 'Data', 'parentId', v_node)))),
     jsonb_build_object('repoIndexMoves', jsonb_build_array(
       jsonb_build_object('path', 'src/routes/orders.ts', 'from', v_node, 'to', v_a),
       jsonb_build_object('path', 'src/db/orders.ts', 'from', v_node, 'to', v_b),
       jsonb_build_object('path', 'src/moved-since.ts', 'from', v_node, 'to', v_a))));

  -- reviewing is not an accept: nothing moves
  UPDATE public.ai_proposals SET status = 'reviewing' WHERE id = v_prop;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/routes/orders.ts';
  IF v_at <> v_node THEN RAISE EXCEPTION 'db-lane 076: a proposal under review moved a file to %', v_at; END IF;

  UPDATE public.ai_proposals SET status = 'partial' WHERE id = v_prop;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/routes/orders.ts';
  IF v_at <> v_a THEN RAISE EXCEPTION 'db-lane 076: the accepted part did not get its file (at %)', v_at; END IF;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/db/orders.ts';
  IF v_at <> v_node THEN RAISE EXCEPTION 'db-lane 076: a file moved to a rejected part (at %)', v_at; END IF;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/moved-since.ts';
  IF v_at <> v_other THEN RAISE EXCEPTION 'db-lane 076: a row that moved since filing was moved again (at %)', v_at; END IF;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/stays.ts';
  IF v_at <> v_node THEN RAISE EXCEPTION 'db-lane 076: a file no part named moved (at %)', v_at; END IF;

  -- a collapse whose remove_node was rejected keeps the part's files
  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata) VALUES
    (v_prop2, v_run, v_br, v_br, 'pending',
     jsonb_build_array(
       jsonb_build_object('status', 'rejected', 'patch', jsonb_build_object('type', 'remove_node', 'payload', jsonb_build_object('id', v_a)))),
     jsonb_build_object('repoIndexMoves', jsonb_build_array(
       jsonb_build_object('path', 'src/routes/orders.ts', 'from', v_a, 'to', v_node))));
  UPDATE public.ai_proposals SET status = 'merged' WHERE id = v_prop2;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/routes/orders.ts';
  IF v_at <> v_a THEN RAISE EXCEPTION 'db-lane 076: a kept part lost its file to the collapse (at %)', v_at; END IF;

  -- and an accepted collapse brings it back
  UPDATE public.ai_proposals SET status = 'pending', patches = '[]'::jsonb WHERE id = v_prop2;
  UPDATE public.ai_proposals SET status = 'merged' WHERE id = v_prop2;
  SELECT node_id INTO v_at FROM public.repo_index WHERE branch_id = v_br AND path = 'src/routes/orders.ts';
  IF v_at <> v_node THEN RAISE EXCEPTION 'db-lane 076: the collapse did not bring the file back (at %)', v_at; END IF;

  RAISE NOTICE 'db-lane 076: ok (files follow accepted parts, rejected parts keep nothing, moved rows and reviews untouched, collapse inverts)';
END $$;

ROLLBACK;
