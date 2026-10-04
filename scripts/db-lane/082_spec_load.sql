-- db-lane 082: loading requirements from git is one transaction, and keeps
-- the mappings git did not remove (V3 AD.2c, finding D21).
--
--   An adopt creates the spec, its requirements (criteria unmet) and its
--   mappings, and a second adopt changes nothing; an apply keeps a criterion's
--   evidence when its text is unchanged and brings a reworded one in unmet; a
--   mapping git still holds keeps its row (confidence, notes, validation), a
--   mapping only the project has stays, a mapping git removed goes; a locked
--   requirement is not written and is named only when git changed it;
--   requirements git does not name are kept and named; a load that fails part
--   way leaves nothing written; only the service role may call it.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db820000-0000-4000-8000-000000000001';
  v_proj  uuid := 'db820000-0000-4000-8000-000000000010';
  n_api   uuid := 'db820000-0000-4000-8000-0000000000a1';
  n_db    uuid := 'db820000-0000-4000-8000-0000000000a2';
  n_web   uuid := 'db820000-0000-4000-8000-0000000000a3';
  n_old   uuid := 'db820000-0000-4000-8000-0000000000a4';
  v_prov  jsonb := '{"origin": "spec-anchor-load", "commitSha": "c0ffee", "at": "2026-09-24T00:00:00Z"}';
  v_spec  uuid;
  v_req1  uuid;
  v_kept_map uuid;
  v_res   jsonb;
  v_before jsonb;
  refused boolean;
  r record;
BEGIN
  IF to_regprocedure('public.apply_spec_load(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 082: apply_spec_load is missing. Apply migration 20260924140000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-082-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 082', v_owner);

  -- 1. adopt: the spec, its requirements with criteria unmet, its mappings
  v_res := public.apply_spec_load(v_proj, 'adopt', v_owner,
    '{"vision": "Take orders", "constraints": [], "preferences": {}, "specHash": "h1"}',
    jsonb_build_array(
      jsonb_build_object('requirementId', 'REQ-001', 'name', 'Place an order', 'category', 'functional',
                         'acceptanceCriteria', jsonb_build_array('An order is saved', 'The buyer gets an email')),
      jsonb_build_object('requirementId', 'REQ-002', 'name', 'Fast', 'category', 'non-functional',
                         'acceptanceCriteria', jsonb_build_array('p95 under 200ms'))),
    jsonb_build_array(
      jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_api, 'mappingType', 'implements'),
      jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_db, 'mappingType', 'depends_on'),
      jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_old, 'mappingType', 'implements'),
      jsonb_build_object('requirementId', 'REQ-404', 'nodeId', n_api, 'mappingType', 'implements')),
    '[]', '{"origin": "spec-anchor-adopt", "at": "2026-09-24T00:00:00Z"}');
  IF NOT (v_res->>'ok')::boolean OR (v_res->>'added')::int <> 2 OR (v_res->>'mappingsAdded')::int <> 3 OR (v_res->>'skippedMappings')::int <> 1 THEN
    RAISE EXCEPTION 'db-lane 082: adopt should add 2 requirements and 3 mappings and skip the one to an unknown requirement, got %', v_res;
  END IF;
  v_spec := (v_res->>'specId')::uuid;
  IF (SELECT created_by FROM public.project_specifications WHERE id = v_spec) IS DISTINCT FROM v_owner
     OR (SELECT metadata->>'specHash' FROM public.project_specifications WHERE id = v_spec) IS DISTINCT FROM 'h1' THEN
    RAISE EXCEPTION 'db-lane 082: the adopted spec should belong to the owner and carry its hash';
  END IF;
  SELECT id INTO v_req1 FROM public.specification_requirements WHERE specification_id = v_spec AND requirement_id = 'REQ-001';
  IF (SELECT acceptance_criteria FROM public.specification_requirements WHERE id = v_req1)
     IS DISTINCT FROM '[{"text": "An order is saved", "met": false}, {"text": "The buyer gets an email", "met": false}]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 082: adopted criteria should arrive unmet in git''s order';
  END IF;

  v_res := public.apply_spec_load(v_proj, 'adopt', v_owner, '{"vision": "Other"}', '[]', '[]', '[]', v_prov);
  IF (v_res->>'reason') IS DISTINCT FROM 'already-has-spec' OR (SELECT vision FROM public.project_specifications WHERE id = v_spec) <> 'Take orders' THEN
    RAISE EXCEPTION 'db-lane 082: a second adopt should refuse and change nothing, got %', v_res;
  END IF;

  -- The project's own work since: a tick with its evidence, a mapping
  -- validated by hand, a mapping only the project has, a requirement only
  -- the project has.
  UPDATE public.specification_requirements
     SET acceptance_criteria = '[{"text": "An order is saved", "met": true, "provenance": {"source": "test", "commitSha": "abc"}}, {"text": "The buyer gets an email", "met": true}]'
   WHERE id = v_req1;
  UPDATE public.specification_mappings SET confidence = 0.4, notes = 'checked by hand', validation_status = 'valid'
   WHERE requirement_id = v_req1 AND node_id = n_api
   RETURNING id INTO v_kept_map;
  INSERT INTO public.specification_mappings (specification_id, requirement_id, node_id, mapping_type)
    VALUES (v_spec, v_req1, n_web, 'supports');
  INSERT INTO public.specification_requirements (specification_id, requirement_id, name, category)
    VALUES (v_spec, 'REQ-100', 'Only here', 'business');

  -- 2. apply: git reworded one criterion, dropped the n_old mapping since the
  --    last sync, added a requirement and a mapping.
  v_res := public.apply_spec_load(v_proj, 'apply', v_owner,
    '{"vision": "Take and track orders", "constraints": [], "preferences": {}}',
    jsonb_build_array(
      jsonb_build_object('requirementId', 'REQ-001', 'name', 'Place an order', 'category', 'functional',
                         'acceptanceCriteria', jsonb_build_array('An order is saved', 'The buyer gets a receipt')),
      jsonb_build_object('requirementId', 'REQ-003', 'name', 'Track an order',
                         'acceptanceCriteria', jsonb_build_array('The buyer sees the status'))),
    jsonb_build_array(
      jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_api, 'mappingType', 'implements'),
      jsonb_build_object('requirementId', 'REQ-003', 'nodeId', n_web)),
    jsonb_build_array(
      jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_old, 'mappingType', 'implements')),
    v_prov);
  IF NOT (v_res->>'ok')::boolean OR (v_res->>'added')::int <> 1 OR (v_res->>'updated')::int <> 1
     OR (v_res->>'criteriaPreserved')::int <> 1 OR (v_res->>'mappingsAdded')::int <> 1 OR (v_res->>'mappingsRemoved')::int <> 1 THEN
    RAISE EXCEPTION 'db-lane 082: apply counts are wrong, got %', v_res;
  END IF;
  IF v_res->'keptLocal' IS DISTINCT FROM '["REQ-002", "REQ-100"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 082: requirements git does not name should be kept and named, got %', v_res->'keptLocal';
  END IF;
  IF (SELECT acceptance_criteria FROM public.specification_requirements WHERE id = v_req1)
     IS DISTINCT FROM '[{"text": "An order is saved", "met": true, "provenance": {"source": "test", "commitSha": "abc"}}, {"text": "The buyer gets a receipt", "met": false}]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 082: the unchanged criterion should keep its evidence and the reworded one arrive unmet, got %',
      (SELECT acceptance_criteria FROM public.specification_requirements WHERE id = v_req1);
  END IF;
  IF (SELECT metadata->'provenance'->>'commitSha' FROM public.specification_requirements WHERE id = v_req1) IS DISTINCT FROM 'c0ffee' THEN
    RAISE EXCEPTION 'db-lane 082: an updated requirement should record the commit it came from';
  END IF;
  SELECT id, confidence, notes, validation_status INTO r FROM public.specification_mappings WHERE requirement_id = v_req1 AND node_id = n_api;
  IF r.id IS DISTINCT FROM v_kept_map OR r.confidence <> 0.4 OR r.notes IS DISTINCT FROM 'checked by hand' OR r.validation_status <> 'valid' THEN
    RAISE EXCEPTION 'db-lane 082: a mapping git still holds should keep its row as it was, got %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.specification_mappings WHERE requirement_id = v_req1 AND node_id = n_web AND mapping_type = 'supports') THEN
    RAISE EXCEPTION 'db-lane 082: a mapping only the project has should stay';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.specification_mappings WHERE requirement_id = v_req1 AND node_id = n_db AND mapping_type = 'depends_on') THEN
    RAISE EXCEPTION 'db-lane 082: a mapping the plan does not remove should stay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.specification_mappings WHERE requirement_id = v_req1 AND node_id = n_old) THEN
    RAISE EXCEPTION 'db-lane 082: a mapping git removed since the last sync should go';
  END IF;
  IF (SELECT category FROM public.specification_requirements WHERE specification_id = v_spec AND requirement_id = 'REQ-003') <> 'functional' THEN
    RAISE EXCEPTION 'db-lane 082: a requirement without a category comes in functional';
  END IF;

  -- 3. locked means locked: nothing written, named only when git changed it
  UPDATE public.specification_requirements SET locked = true WHERE specification_id = v_spec AND requirement_id IN ('REQ-001', 'REQ-003');
  v_before := (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.specification_mappings m WHERE m.specification_id = v_spec);
  v_res := public.apply_spec_load(v_proj, 'apply', v_owner,
    '{"vision": "Take and track orders"}',
    jsonb_build_array(
      jsonb_build_object('requirementId', 'REQ-001', 'name', 'Place an order, renamed', 'category', 'functional',
                         'acceptanceCriteria', jsonb_build_array('An order is saved', 'The buyer gets a receipt')),
      jsonb_build_object('requirementId', 'REQ-003', 'name', 'Track an order', 'category', 'functional',
                         'acceptanceCriteria', jsonb_build_array('The buyer sees the status'))),
    jsonb_build_array(jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_old, 'mappingType', 'implements')),
    jsonb_build_array(jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_api, 'mappingType', 'implements')),
    v_prov);
  IF v_res->'locked' IS DISTINCT FROM '["REQ-001"]'::jsonb OR (v_res->>'updated')::int <> 0 THEN
    RAISE EXCEPTION 'db-lane 082: only the locked requirement git changed should be named, and nothing written, got %', v_res;
  END IF;
  IF (SELECT name FROM public.specification_requirements WHERE id = v_req1) <> 'Place an order' THEN
    RAISE EXCEPTION 'db-lane 082: a locked requirement was written';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.specification_mappings m WHERE m.specification_id = v_spec) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'db-lane 082: a locked requirement''s mappings were written';
  END IF;
  UPDATE public.specification_requirements SET locked = false WHERE specification_id = v_spec;

  -- 4. one transaction: a bad row part way leaves nothing written
  v_before := jsonb_build_object(
    'spec', (SELECT to_jsonb(s) - 'updated_at' FROM public.project_specifications s WHERE s.id = v_spec),
    'reqs', (SELECT jsonb_agg(to_jsonb(q) - 'updated_at' ORDER BY q.id) FROM public.specification_requirements q WHERE q.specification_id = v_spec),
    'maps', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.specification_mappings m WHERE m.specification_id = v_spec));
  refused := false;
  BEGIN
    PERFORM public.apply_spec_load(v_proj, 'apply', v_owner,
      '{"vision": "Half written"}',
      jsonb_build_array(
        jsonb_build_object('requirementId', 'REQ-001', 'name', 'Changed first', 'category', 'functional', 'acceptanceCriteria', '[]'::jsonb),
        jsonb_build_object('requirementId', 'REQ-200', 'name', 'Bad', 'category', 'nonsense', 'acceptanceCriteria', '[]'::jsonb)),
      '[]', jsonb_build_array(jsonb_build_object('requirementId', 'REQ-001', 'nodeId', n_db, 'mappingType', 'depends_on')),
      v_prov);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'db-lane 082: a category outside the list should fail the load'; END IF;
  IF jsonb_build_object(
       'spec', (SELECT to_jsonb(s) - 'updated_at' FROM public.project_specifications s WHERE s.id = v_spec),
       'reqs', (SELECT jsonb_agg(to_jsonb(q) - 'updated_at' ORDER BY q.id) FROM public.specification_requirements q WHERE q.specification_id = v_spec),
       'maps', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.specification_mappings m WHERE m.specification_id = v_spec))
     IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'db-lane 082: a failed load left something written';
  END IF;

  -- 5. apply needs a spec; only the service role may call
  v_res := public.apply_spec_load('db820000-0000-4000-8000-0000000000ff', 'apply', v_owner, '{}', '[]', '[]', '[]', v_prov);
  IF (v_res->>'reason') IS DISTINCT FROM 'no-spec' THEN
    RAISE EXCEPTION 'db-lane 082: apply on a project without a spec should refuse, got %', v_res;
  END IF;
  IF has_function_privilege('authenticated', 'public.apply_spec_load(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.apply_spec_load(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_spec_load(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db-lane 082: only the service role may load a spec';
  END IF;

  RAISE NOTICE 'db-lane 082: ok';
END;
$$;

ROLLBACK;
