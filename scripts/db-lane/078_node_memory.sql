-- db-lane 078: memory on the node (V3 AA.7, owner 2026-09-23).
--
--   node_memory reads what the project already records about one node, each
--   entry with who and which commit: a merged proposal's patch on the node
--   (its explanation, the next push as its commit), not a rejected one and
--   not another node's; a person's rename, not a layout move; a released
--   lease's hand-off note with the commit its holder reported; a criterion
--   proven by a test at a commit. Row security applies: an outsider reads
--   nothing.
--
--   Release 2026-09-28: a proven criterion whose evidence went stale is
--   read, whatever shape the staleness was written in. report_test_results
--   writes an object (at, reason), older rows carry a reason string or a
--   boolean; node_memory cast the value to boolean and failed on the
--   first two, so the rail's History failed for the node.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db780000-0000-4000-8000-000000000001';
  v_outsider uuid := 'db780000-0000-4000-8000-000000000002';
  v_proj uuid := 'db780000-0000-4000-8000-000000000010';
  v_br uuid := 'db780000-0000-4000-8000-000000000011';
  v_integ uuid := 'db780000-0000-4000-8000-000000000012';
  v_spec uuid := 'db780000-0000-4000-8000-000000000013';
  v_req uuid := 'db780000-0000-4000-8000-000000000014';
  NODE uuid := 'db780000-0000-4000-8000-0000000000a1';
  OTHER uuid := 'db780000-0000-4000-8000-0000000000a2';
  T1 uuid := 'db780000-0000-4000-8000-000000000021';
  KA uuid := 'db780000-0000-4000-8000-000000000051';
  v_snap uuid; v_run uuid; a jsonb; m jsonb;
BEGIN
  IF to_regprocedure('public.node_memory(uuid, uuid, uuid, integer)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 078: node_memory is missing. Apply migration 20260923210000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-078-owner@nodespec.local'), (v_outsider, 'db-lane-078-outsider@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 078', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence) VALUES
    (v_proj, v_br, jsonb_build_object('id', v_br, 'schemaVersion', 8, 'version', 0, 'hash', 'db78', 'edges', '{}'::jsonb, 'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb,
       'nodes', jsonb_build_object(NODE::text, jsonb_build_object('id', NODE, 'type', 'backend-service', 'label', 'Checkout API'),
                                   OTHER::text, jsonb_build_object('id', OTHER, 'type', 'frontend-app', 'label', 'Web'))), 'db78', 0)
    RETURNING id INTO v_snap;
  INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status, input_snapshot_id)
    VALUES (gen_random_uuid(), v_proj, v_br, 'db-lane', md5('db78'), 'completed', v_snap) RETURNING id INTO v_run;

  -- A merged decision on the node (one patch rejected), one on another node, one still pending.
  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata, merged_at) VALUES
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(
       jsonb_build_object('status', 'accepted', 'explanation', 'Idempotency keys: retries must not charge twice',
         'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('label', 'Checkout API'))))),
       jsonb_build_object('credentialLabel', 'claude · lead', 'intents', jsonb_build_array(jsonb_build_object('kind', 'set_technology', 'summary', 'Checkout API runs on Express'))),
       '2026-09-20T10:00:00Z'),
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(
       jsonb_build_object('status', 'rejected', 'explanation', 'Rejected idea',
         'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('label', 'Pay'))))),
       '{"credentialLabel":"claude · lead"}'::jsonb, '2026-09-20T11:00:00Z'),
    (gen_random_uuid(), v_run, v_br, v_br, 'merged', jsonb_build_array(
       jsonb_build_object('status', 'accepted', 'explanation', 'The web app',
         'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', OTHER, 'changes', jsonb_build_object('label', 'Web app'))))),
       '{"credentialLabel":"claude · web"}'::jsonb, '2026-09-20T12:00:00Z'),
    (gen_random_uuid(), v_run, v_br, v_br, 'pending', jsonb_build_array(
       jsonb_build_object('status', 'pending', 'explanation', 'Not decided yet',
         'patch', jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('label', 'Later'))))),
       '{"credentialLabel":"claude · lead"}'::jsonb, NULL);

  -- The next push after the decision is its commit.
  INSERT INTO public.git_integrations (id, project_id, provider, repo_owner, repo_name, access_token_encrypted, created_by)
    VALUES (v_integ, v_proj, 'github', 'bench', 'db-lane', 'not-a-token', v_owner);
  INSERT INTO public.git_sync_log (integration_id, project_id, branch_id, direction, commit_sha, status, completed_at) VALUES
    (v_integ, v_proj, v_br, 'push', 'aaaaaaa0000000000000000000000000000000aa', 'success', '2026-09-19T10:00:00Z'),
    (v_integ, v_proj, v_br, 'push', 'bbbbbbb0000000000000000000000000000000bb', 'success', '2026-09-21T09:00:00Z'),
    (v_integ, v_proj, v_br, 'push', 'ccccccc0000000000000000000000000000000cc', 'failed', '2026-09-20T10:30:00Z');

  -- A person renames the node, then drags it.
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, actor_id, summary, payload, created_at) VALUES
    (gen_random_uuid(), v_br, 1, 'update_node', 'human', v_owner, 'Rename to Checkout',
     jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('label', 'Checkout'))), '2026-09-21T08:00:00Z'),
    (gen_random_uuid(), v_br, 2, 'update_node', 'human', v_owner, 'Move',
     jsonb_build_object('type', 'update_node', 'payload', jsonb_build_object('id', NODE, 'changes', jsonb_build_object('position', jsonb_build_object('x', 1, 'y', 2)))), '2026-09-21T08:05:00Z');

  -- A lease on work inside the node, released with a hand-off note and the commit it worked at.
  INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title) VALUES (T1, v_proj, NODE, 't1', 'T1', 'Charge the card');
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix) VALUES (KA, v_owner, 'agent a', 'db78-hash-a', 'ns_live_a');
  a := public.agent_checkout_claim(v_proj, 'task', T1, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, 'key:' || KA::text, NULL, NULL, ARRAY['src/charge.ts']);
  IF NOT (a->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 078: the claim should be granted, got %', a; END IF;
  UPDATE public.agent_checkouts SET released_at = '2026-09-22T09:00:00Z', released_reason = 'released',
         meta = meta || jsonb_build_object('commitSha', 'ddddddd0000000000000000000000000000000dd', 'handoff', jsonb_build_object('note', 'Charging works; refunds are next', 'at', '2026-09-22T09:00:00Z'))
   WHERE id = (a->>'checkoutId')::uuid;

  -- A criterion proven by a test at a commit; another met without evidence.
  INSERT INTO public.project_specifications (id, project_id, vision, created_by) VALUES (v_spec, v_proj, 'db-lane 078', v_owner);
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, description, source, confirmed, locked, acceptance_criteria)
    VALUES (v_req, v_spec, 'REQ-001', 'Charge once', 'x', 'manual', true, false, jsonb_build_array(
      jsonb_build_object('id', 'c1', 'text', 'A retried charge is charged once', 'met', true,
        'provenance', jsonb_build_object('source', 'test', 'testCaseId', 'tc-1', 'at', '2026-09-22T10:00:00Z', 'commitSha', 'eeeeeee0000000000000000000000000000000ee')),
      jsonb_build_object('id', 'c2', 'text', 'Said to be done', 'met', true)));
  INSERT INTO public.specification_mappings (specification_id, requirement_id, node_id, mapping_type) VALUES (v_spec, v_req, NODE, 'implements');

  m := public.node_memory(v_proj, v_br, NODE, 20);
  IF jsonb_array_length(m->'decisions') <> 1 THEN RAISE EXCEPTION 'db-lane 078: one decision (not the rejected patch, not another node, not a pending one), got %', m->'decisions'; END IF;
  IF m->'decisions'->0->>'who' <> 'claude · lead'
     OR m->'decisions'->0->'explanations' <> '["Idempotency keys: retries must not charge twice"]'::jsonb
     OR m->'decisions'->0->'intents'->0->>'summary' <> 'Checkout API runs on Express'
     OR m->'decisions'->0->>'commit' <> 'bbbbbbb0000000000000000000000000000000bb' THEN
    RAISE EXCEPTION 'db-lane 078: the decision carries who, why and the next successful push, got %', m->'decisions'->0;
  END IF;
  IF jsonb_array_length(m->'changes') <> 1 OR m->'changes'->0->>'summary' <> 'Rename to Checkout' OR m->'changes'->0->>'commit' <> 'bbbbbbb0000000000000000000000000000000bb' THEN
    RAISE EXCEPTION 'db-lane 078: the rename is a change and the move is not, got %', m->'changes';
  END IF;
  IF jsonb_array_length(m->'handoffs') <> 1 OR m->'handoffs'->0->>'note' <> 'Charging works; refunds are next'
     OR m->'handoffs'->0->>'who' <> 'agent-a' OR m->'handoffs'->0->>'commit' <> 'ddddddd0000000000000000000000000000000dd' THEN
    RAISE EXCEPTION 'db-lane 078: the hand-off carries its note, holder and commit, got %', m->'handoffs';
  END IF;
  IF jsonb_array_length(m->'proven') <> 1 OR m->'proven'->0->>'testCaseId' <> 'tc-1' OR m->'proven'->0->>'commit' <> 'eeeeeee0000000000000000000000000000000ee' THEN
    RAISE EXCEPTION 'db-lane 078: only the criterion proven by a test is memory, got %', m->'proven';
  END IF;
  m := public.node_memory(v_proj, v_br, OTHER, 20);
  IF jsonb_array_length(m->'decisions') <> 1 OR jsonb_array_length(m->'handoffs') <> 0 OR jsonb_array_length(m->'proven') <> 0 THEN
    RAISE EXCEPTION 'db-lane 078: another node has only its own memory, got %', m;
  END IF;

  -- Row security: an outsider reads nothing.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  m := public.node_memory(v_proj, v_br, NODE, 20);
  IF jsonb_array_length(m->'decisions') + jsonb_array_length(m->'changes') + jsonb_array_length(m->'handoffs') + jsonb_array_length(m->'proven') <> 0 THEN
    RAISE EXCEPTION 'db-lane 078: an outsider should read no memory, got %', m;
  END IF;
  -- The owner reads it all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  m := public.node_memory(v_proj, v_br, NODE, 20);
  IF jsonb_array_length(m->'decisions') <> 1 OR jsonb_array_length(m->'handoffs') <> 1 THEN
    RAISE EXCEPTION 'db-lane 078: the owner should read the node''s memory, got %', m;
  END IF;
  PERFORM set_config('role', 'postgres', true);

  RAISE NOTICE 'db-lane 078: decisions, a person''s changes, hand-offs and proven criteria, each with who and which commit; layout, rejected, pending and other nodes left out; row security holds';
END $$;

-- Stale evidence, in each shape it is written in.
DO $$
DECLARE
  v_owner uuid := 'db780000-0000-4000-8000-000000000101';
  v_proj uuid := 'db780000-0000-4000-8000-000000000110';
  v_br uuid := 'db780000-0000-4000-8000-000000000111';
  v_spec uuid := 'db780000-0000-4000-8000-000000000113';
  v_req uuid := 'db780000-0000-4000-8000-000000000114';
  NODE uuid := 'db780000-0000-4000-8000-0000000001a1';
  m jsonb;
  proven jsonb := '{}'::jsonb;
  e jsonb;
  proof jsonb := jsonb_build_object('source', 'test', 'testCaseId', 'tc-9', 'at', '2026-09-22T10:00:00Z', 'commitSha', 'fffffff0000000000000000000000000000000ff');
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-078-stale@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 078 stale evidence', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.project_specifications (id, project_id, vision, created_by) VALUES (v_spec, v_proj, 'db-lane 078 stale', v_owner);
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, description, source, confirmed, locked, acceptance_criteria)
    VALUES (v_req, v_spec, 'REQ-001', 'Stale evidence', 'x', 'manual', true, false, jsonb_build_array(
      jsonb_build_object('id', 's1', 'text', 'as report_test_results writes it', 'met', true, 'provenance', proof,
        'evidenceStale', jsonb_build_object('at', '2026-09-23T10:00:00Z', 'reason', 'the file changed')),
      jsonb_build_object('id', 's2', 'text', 'a reason string', 'met', true, 'provenance', proof, 'evidenceStale', 'the mesh moved'),
      jsonb_build_object('id', 's3', 'text', 'a boolean true', 'met', true, 'provenance', proof, 'evidenceStale', true),
      jsonb_build_object('id', 's4', 'text', 'a boolean false', 'met', true, 'provenance', proof, 'evidenceStale', false),
      jsonb_build_object('id', 's5', 'text', 'never stale', 'met', true, 'provenance', proof)));
  INSERT INTO public.specification_mappings (specification_id, requirement_id, node_id, mapping_type) VALUES (v_spec, v_req, NODE, 'implements');

  m := public.node_memory(v_proj, v_br, NODE, 20);
  FOR e IN SELECT value FROM jsonb_array_elements(m->'proven') LOOP
    proven := proven || jsonb_build_object(e->>'text', e->'evidenceStale');
  END LOOP;
  IF proven IS DISTINCT FROM jsonb_build_object(
       'as report_test_results writes it', true, 'a reason string', true, 'a boolean true', true,
       'a boolean false', false, 'never stale', false) THEN
    RAISE EXCEPTION 'db-lane 078: stale evidence is read in every shape, got %', proven;
  END IF;
  RAISE NOTICE 'db-lane 078: stale evidence read as an object, a reason or a boolean';
END $$;

ROLLBACK;
