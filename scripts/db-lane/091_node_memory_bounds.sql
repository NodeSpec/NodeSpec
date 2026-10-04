-- db-lane 091: a node's memory stays small however much the node holds
-- (V3 item 27, owner 2026-09-27).
--
--   A decision carries its first three reasons on the node, in the
--   proposal's own order and each once, and how many there were; a reason
--   on another node or a rejected patch is not counted. A proposal that
--   names the node only in an edge's end is still found; one that names the
--   node's id only in a sentence is not a decision on it. A file's own edits
--   and removals, by a proposal or by a person, never reach the node's
--   memory. Each kind keeps its newest, up to the limit.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db910000-0000-4000-8000-000000000001';
  v_proj uuid := 'db910000-0000-4000-8000-000000000010';
  v_br uuid := 'db910000-0000-4000-8000-000000000011';
  NODE uuid := 'db910000-0000-4000-8000-0000000000a1';
  OTHER uuid := 'db910000-0000-4000-8000-0000000000a2';
  FILE uuid := 'db910000-0000-4000-8000-0000000000f1';
  v_snap uuid; v_run uuid; m jsonb; d jsonb; files jsonb := '[]'::jsonb; i int;
BEGIN
  IF to_regprocedure('public.node_memory(uuid, uuid, uuid, integer)') IS NULL
     OR position('explanationCount' IN pg_get_functiondef('public.node_memory(uuid, uuid, uuid, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db-lane 091: node_memory is not bounded. Apply migration 20260927100000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-091-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 091', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence) VALUES
    (v_proj, v_br, jsonb_build_object('id', v_br, 'schemaVersion', 8, 'version', 0, 'hash', 'db91', 'edges', '{}'::jsonb, 'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb,
       'nodes', jsonb_build_object(NODE::text, jsonb_build_object('id', NODE, 'type', 'backend-service', 'label', 'Orders API'),
                                   OTHER::text, jsonb_build_object('id', OTHER, 'type', 'frontend-app', 'label', 'Web'))), 'db91', 0)
    RETURNING id INTO v_snap;
  INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status, input_snapshot_id)
    VALUES (gen_random_uuid(), v_proj, v_br, 'db-lane', md5('db91'), 'completed', v_snap) RETURNING id INTO v_run;

  -- 1. A proposal binding thirty files to the node, one file bound twice for
  --    the same reason, a rejected file, and a file for another node. The
  --    reasons are not in alphabetical order, so the proposal's order shows.
  files := files || jsonb_build_object('status', 'accepted', 'explanation', 'Zeta: the entry point',
    'patch', jsonb_build_object('type', 'add_artifact', 'payload', jsonb_build_object('id', gen_random_uuid(), 'nodeId', NODE, 'path', 'src/main.ts', 'kind', 'source')));
  files := files || jsonb_build_object('status', 'accepted', 'explanation', 'Alpha: the router',
    'patch', jsonb_build_object('type', 'add_artifact', 'payload', jsonb_build_object('id', gen_random_uuid(), 'nodeId', NODE, 'path', 'src/router.ts', 'kind', 'source')));
  files := files || jsonb_build_object('status', 'accepted', 'explanation', 'Zeta: the entry point',
    'patch', jsonb_build_object('type', 'add_artifact', 'payload', jsonb_build_object('id', gen_random_uuid(), 'nodeId', NODE, 'path', 'src/main.test.ts', 'kind', 'test')));
  FOR i IN 1..28 LOOP
    files := files || jsonb_build_object('status', 'accepted', 'explanation', format('Bind src/f%s.ts', lpad(i::text, 2, '0')),
      'patch', jsonb_build_object('type', 'add_artifact', 'payload', jsonb_build_object('id', gen_random_uuid(), 'nodeId', NODE, 'path', format('src/f%s.ts', i), 'kind', 'source')));
  END LOOP;
  files := files || jsonb_build_object('status', 'rejected', 'explanation', 'Rejected: the old client',
    'patch', jsonb_build_object('type', 'add_artifact', 'payload', jsonb_build_object('id', gen_random_uuid(), 'nodeId', NODE, 'path', 'src/old.ts', 'kind', 'source')));
  files := files || jsonb_build_object('status', 'accepted', 'explanation', 'The web app''s page',
    'patch', jsonb_build_object('type', 'add_artifact', 'payload', jsonb_build_object('id', gen_random_uuid(), 'nodeId', OTHER, 'path', 'web/page.tsx', 'kind', 'source')));
  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata, merged_at)
    VALUES (gen_random_uuid(), v_run, v_br, v_br, 'merged', files, '{"credentialLabel":"claude · lead"}'::jsonb, '2026-09-20T10:00:00Z');

  m := public.node_memory(v_proj, v_br, NODE, 20);
  d := m->'decisions'->0;
  IF jsonb_array_length(m->'decisions') <> 1 THEN RAISE EXCEPTION 'db-lane 091: one decision, got %', m->'decisions'; END IF;
  IF d->'explanations' <> '["Zeta: the entry point", "Alpha: the router", "Bind src/f01.ts"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 091: the first three reasons, each once, in the proposal''s order, got %', d->'explanations';
  END IF;
  IF (d->>'explanationCount')::int <> 30 THEN
    RAISE EXCEPTION 'db-lane 091: thirty reasons on the node (two distinct, twenty-eight binds; not the rejected, not the web app''s), got %', d->>'explanationCount';
  END IF;

  -- 2. A proposal naming the node only as an edge's end is a decision on it;
  --    one naming the node's id only in a sentence, about another node, is not.
  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata, merged_at) VALUES
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(jsonb_build_object('status', 'accepted', 'explanation', 'The web app calls the API',
       'patch', jsonb_build_object('type', 'add_edge', 'payload', jsonb_build_object('id', gen_random_uuid(), 'source', OTHER, 'target', NODE, 'contractId', 'c1')))),
     '{"credentialLabel":"claude · web"}'::jsonb, '2026-09-21T10:00:00Z'),
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(jsonb_build_object('status', 'accepted', 'explanation', format('Rename the web app (it calls %s)', NODE),
       'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', OTHER, 'changes', jsonb_build_object('label', 'Web app'))))),
     '{"credentialLabel":"claude · web"}'::jsonb, '2026-09-21T11:00:00Z'),
  -- 3. A proposal editing a file on the node names the file, not the node.
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(jsonb_build_object('status', 'accepted', 'explanation', 'Tighten the router',
       'patch', jsonb_build_object('type', 'update_artifact', 'payload', jsonb_build_object('id', FILE, 'changes', jsonb_build_object('content', 'export {}'))))),
     '{"credentialLabel":"claude · lead"}'::jsonb, '2026-09-21T12:00:00Z'),
  -- A decision on the node that gave no reason: no reasons, counted as none.
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(jsonb_build_object('status', 'accepted', 'explanation', 'No explanation provided',
       'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('description', 'Orders'))))),
     '{"credentialLabel":"claude · lead"}'::jsonb, '2026-09-21T13:00:00Z');
  m := public.node_memory(v_proj, v_br, NODE, 20);
  IF jsonb_array_length(m->'decisions') <> 3
     OR m->'decisions'->1->'explanations' <> '["The web app calls the API"]'::jsonb OR (m->'decisions'->1->>'explanationCount')::int <> 1 THEN
    RAISE EXCEPTION 'db-lane 091: the edge is a decision on the node, the sentence and the file edit are not, got %', m->'decisions';
  END IF;
  IF m->'decisions'->0->'explanations' <> '[]'::jsonb OR (m->'decisions'->0->>'explanationCount')::int <> 0 THEN
    RAISE EXCEPTION 'db-lane 091: a decision with no reason carries none and counts none, got %', m->'decisions'->0;
  END IF;

  -- 4. A person's own edits: a rename is memory; a file's edits and its removal are not.
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload, created_at) VALUES
    (gen_random_uuid(), v_br, 1, 'update_node', 'human', v_owner, 'Rename to Orders',
     jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('label', 'Orders'))), '2026-09-22T08:00:00Z');
  FOR i IN 1..40 LOOP
    INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload, created_at) VALUES
      (gen_random_uuid(), v_br, 1 + i, 'update_artifact', 'human', v_owner, format('Edit the router, pass %s', i),
       jsonb_build_object('type', 'update_artifact', 'payload', jsonb_build_object('id', FILE, 'changes', jsonb_build_object('content', format('// %s', i)))), '2026-09-22T09:00:00Z'::timestamptz + make_interval(mins => i));
  END LOOP;
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload, created_at) VALUES
    (gen_random_uuid(), v_br, 60, 'remove_artifact', 'human', v_owner, 'Remove the router',
     jsonb_build_object('type', 'remove_artifact', 'payload', jsonb_build_object('id', FILE)), '2026-09-22T12:00:00Z'),
  -- A file moved onto the node names the node, but as the file's own edit.
    (gen_random_uuid(), v_br, 61, 'update_artifact', 'human', v_owner, 'Move the router onto Orders',
     jsonb_build_object('type', 'update_artifact', 'payload', jsonb_build_object('id', FILE, 'changes', jsonb_build_object('nodeId', NODE))), '2026-09-22T12:30:00Z');
  m := public.node_memory(v_proj, v_br, NODE, 20);
  IF jsonb_array_length(m->'changes') <> 1 OR m->'changes'->0->>'summary' <> 'Rename to Orders' THEN
    RAISE EXCEPTION 'db-lane 091: forty file edits, a removal and a move are not the node''s memory; the rename is, got %', m->'changes';
  END IF;

  -- 5. Each kind keeps its newest, up to the limit.
  FOR i IN 1..25 LOOP
    INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata, merged_at)
      VALUES (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(jsonb_build_object('status', 'accepted', 'explanation', format('Decision %s', i),
        'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('description', format('v%s', i)))))),
        '{"credentialLabel":"claude · lead"}'::jsonb, '2026-09-23T00:00:00Z'::timestamptz + make_interval(mins => i));
  END LOOP;
  m := public.node_memory(v_proj, v_br, NODE, 20);
  IF jsonb_array_length(m->'decisions') <> 20 OR m->'decisions'->0->'explanations'->>0 <> 'Decision 25' OR m->'decisions'->19->'explanations'->>0 <> 'Decision 6' THEN
    RAISE EXCEPTION 'db-lane 091: the twenty newest decisions, newest first, got % entries from % to %',
      jsonb_array_length(m->'decisions'), m->'decisions'->0->'explanations'->>0, m->'decisions'->-1->'explanations'->>0;
  END IF;

  RAISE NOTICE 'db-lane 091: a decision carries its first three reasons and their count; an edge end is found, a sentence and a file''s edits are not; the newest of each kind';
END $$;

ROLLBACK;
