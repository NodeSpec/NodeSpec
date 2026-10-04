-- db-lane 060: apply_criteria_ops is the ONE locked writer of
-- acceptance_criteria, and the met-flip from test_cases routes through it.
--
-- Behaviour, not text (V3 5.1): a throwaway requirement is built inside this
-- transaction, every op is applied the way report_test_results, the git tick
-- and the app apply them, and the flip is driven by updating a test case's
-- status exactly as the tool does (insert at not_started, then update).
-- Everything rolls back.
--
-- What this retires (criteria-ops.test.ts, 2026-09-20): the text pins on
-- the op vocabulary, the three selectors, key preservation, the compare-and-
-- swap token, and the flip's routing, semantics and containment match. The
-- lock-before-read ordering and the grant model stay pinned as text: a
-- single session cannot prove serialization.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj uuid := 'db600000-0000-4000-8000-000000000010';
  v_spec uuid := 'db600000-0000-4000-8000-000000000020';
  v_req  uuid := 'db600000-0000-4000-8000-000000000030';
  v_other uuid := 'db600000-0000-4000-8000-000000000031';
  v_tc   uuid := 'db600000-0000-4000-8000-000000000040';
  v jsonb; v_crit jsonb; v_at timestamptz; v_refused boolean; v_state text;
BEGIN
  IF to_regprocedure('public.apply_criteria_ops(uuid, jsonb, timestamptz)') IS NULL
     OR to_regprocedure('public.on_test_case_status_change_fn()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 060: apply_criteria_ops or the met-flip trigger is missing. Apply migration 20260915120000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 060: no auth.users row to own the fixture. Run supabase db reset.'; END IF;

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 060', v_owner);
  INSERT INTO public.project_specifications (id, project_id, vision, created_by) VALUES (v_spec, v_proj, 'db-lane 060', v_owner);
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, description, source, confirmed, locked, acceptance_criteria)
    VALUES (v_req, v_spec, 'REQ-001', 'Store tasks', 'Tasks persist', 'manual', true, false,
            '[{"id":"c1","text":"Tasks persist across sessions","verification":"automated","met":false,"provenance":{"source":"draft"}},
              {"id":"c2","text":"A deleted task stays deleted","verification":"automated","met":false}]'::jsonb);
  -- a second requirement whose criterion TEXT mentions the test case id: the
  -- old LIKE scan matched it; the containment match must not
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, description, source, confirmed, locked, acceptance_criteria)
    VALUES (v_other, v_spec, 'REQ-002', 'Unrelated', 'x', 'manual', false, false,
            jsonb_build_array(jsonb_build_object('id', 'z1', 'text', 'mentions ' || v_tc::text || ' in prose', 'met', false)));

  -- ── refusals: the shape is checked before anything is touched ──
  v_refused := false;
  BEGIN PERFORM public.apply_criteria_ops(v_req, '{"op":"set_met"}'::jsonb, NULL); EXCEPTION WHEN OTHERS THEN v_refused := SQLERRM LIKE '%must be a jsonb array%'; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 060: a non-array should be refused'; END IF;
  v_refused := false;
  BEGIN PERFORM public.apply_criteria_ops(v_req, '[{"op":"explode","criterion_id":"c1"}]'::jsonb, NULL); EXCEPTION WHEN OTHERS THEN v_refused := SQLERRM LIKE '%unknown op explode%'; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 060: an unknown op should be refused by name'; END IF;
  v_refused := false;
  BEGIN PERFORM public.apply_criteria_ops(v_req, '[{"op":"set_met","value":true}]'::jsonb, NULL); EXCEPTION WHEN OTHERS THEN v_refused := SQLERRM LIKE '%has no selector%'; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 060: an op without a selector should be refused'; END IF;
  v_refused := false;
  BEGIN PERFORM public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"c1","criterion_text":"x","value":true}]'::jsonb, NULL); EXCEPTION WHEN OTHERS THEN v_refused := SQLERRM LIKE '%more than one selector%'; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 060: two selectors should be refused, never guessed'; END IF;
  SELECT acceptance_criteria INTO v_crit FROM public.specification_requirements WHERE id = v_req;
  IF v_crit->0->>'met' <> 'false' THEN RAISE EXCEPTION 'db-lane 060: a refused batch touched the row'; END IF;

  -- ── the three selectors, and every key not named survives ──
  v := public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"c1","value":true}]'::jsonb, NULL);
  IF (v->>'applied')::int <> 1 OR (v->>'changed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'db-lane 060: set_met by id should apply and change, got %', v; END IF;
  SELECT acceptance_criteria INTO v_crit FROM public.specification_requirements WHERE id = v_req;
  IF v_crit->0->>'met' <> 'true' OR v_crit->0->>'verification' <> 'automated' OR v_crit->0->'provenance'->>'source' <> 'draft' THEN
    RAISE EXCEPTION 'db-lane 060: set_met by id must flip met and keep verification and provenance, got %', v_crit->0;
  END IF;
  v := public.apply_criteria_ops(v_req, jsonb_build_array(jsonb_build_object('op', 'bind', 'criterion_text', 'A deleted task stays deleted', 'value', v_tc::text)), NULL);
  SELECT acceptance_criteria INTO v_crit FROM public.specification_requirements WHERE id = v_req;
  IF v_crit->1->>'testId' IS DISTINCT FROM v_tc::text THEN RAISE EXCEPTION 'db-lane 060: bind by text should set testId, got %', v_crit->1; END IF;
  v := public.apply_criteria_ops(v_req, jsonb_build_array(
         jsonb_build_object('op', 'stamp', 'test_id', v_tc::text, 'value', '{"source":"test","actor":"db-lane"}'::jsonb),
         jsonb_build_object('op', 'mark_stale', 'test_id', v_tc::text, 'value', '{"reason":"source changed"}'::jsonb)), NULL);
  SELECT acceptance_criteria INTO v_crit FROM public.specification_requirements WHERE id = v_req;
  IF v_crit->1->'provenance'->>'actor' <> 'db-lane' OR v_crit->1->'evidenceStale'->>'reason' <> 'source changed' THEN
    RAISE EXCEPTION 'db-lane 060: stamp and mark_stale by test_id should land on the bound criterion, got %', v_crit->1;
  END IF;
  v := public.apply_criteria_ops(v_req, jsonb_build_array(jsonb_build_object('op', 'clear_stale', 'test_id', v_tc::text)), NULL);
  SELECT acceptance_criteria INTO v_crit FROM public.specification_requirements WHERE id = v_req;
  IF v_crit->1 ? 'evidenceStale' THEN RAISE EXCEPTION 'db-lane 060: clear_stale should drop the key'; END IF;
  -- an op that matches nothing applies nothing and changes nothing
  v := public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"nope","value":true}]'::jsonb, NULL);
  IF (v->>'applied')::int <> 0 OR (v->>'changed')::boolean THEN RAISE EXCEPTION 'db-lane 060: an unmatched op should apply 0 and change nothing, got %', v; END IF;
  v := public.apply_criteria_ops('db600000-0000-4000-8000-0000000000ff', '[{"op":"set_met","criterion_id":"c1","value":true}]'::jsonb, NULL);
  IF (v->>'found')::boolean THEN RAISE EXCEPTION 'db-lane 060: an unknown requirement should answer found=false'; END IF;

  -- ── the compare-and-swap token: a stale read refuses with 40001 ──
  SELECT updated_at INTO v_at FROM public.specification_requirements WHERE id = v_req;
  v_refused := false;
  BEGIN
    PERFORM public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"c1","value":false}]'::jsonb, v_at - interval '1 second');
  EXCEPTION WHEN SQLSTATE '40001' THEN v_refused := SQLERRM LIKE '%moved since you read it%';
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 060: a stale token should refuse with 40001'; END IF;
  v := public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"c1","value":false}]'::jsonb, v_at);
  IF (v->>'changed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'db-lane 060: the current token should let the write through'; END IF;

  -- ── the flip from test_cases: AFTER UPDATE OF status, passed and failed only ──
  INSERT INTO public.test_cases (id, requirement_id, test_id, name, status) VALUES (v_tc, v_req, 'TC-001', 'deleted stays deleted', 'not_started');
  SELECT acceptance_criteria->1->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'false' THEN RAISE EXCEPTION 'db-lane 060: an INSERT must never flip met'; END IF;
  UPDATE public.test_cases SET status = 'running' WHERE id = v_tc;
  SELECT acceptance_criteria->1->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'false' THEN RAISE EXCEPTION 'db-lane 060: running must not flip met'; END IF;
  UPDATE public.test_cases SET status = 'passed' WHERE id = v_tc;
  SELECT acceptance_criteria->1->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'true' THEN RAISE EXCEPTION 'db-lane 060: passed must flip met true'; END IF;
  SELECT acceptance_criteria->1->'provenance'->>'actor' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'db-lane' THEN RAISE EXCEPTION 'db-lane 060: the flip rebuilt the criterion and lost its provenance'; END IF;
  UPDATE public.test_cases SET status = 'skipped' WHERE id = v_tc;
  SELECT acceptance_criteria->1->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'true' THEN RAISE EXCEPTION 'db-lane 060: skipped must leave met alone'; END IF;
  UPDATE public.test_cases SET status = 'failed' WHERE id = v_tc;
  SELECT acceptance_criteria->1->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'false' THEN RAISE EXCEPTION 'db-lane 060: failed must flip met false'; END IF;
  -- the other requirement only MENTIONS the id: containment, not a text scan
  SELECT acceptance_criteria->0->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_other;
  IF v_state <> 'false' THEN RAISE EXCEPTION 'db-lane 060: the flip reached a requirement that merely mentions the case id'; END IF;
  -- the unbound criterion of the same requirement is untouched by the flip
  SELECT acceptance_criteria->0->>'met' INTO v_state FROM public.specification_requirements WHERE id = v_req;
  IF v_state <> 'false' THEN RAISE EXCEPTION 'db-lane 060: the flip touched a criterion the case is not bound to'; END IF;

  RAISE NOTICE 'db-lane 060: apply_criteria_ops refuses bad shapes, selects by id, text and test_id, keeps every other key, honours the token; the flip lands on the bound criterion only, on passed and failed only';
END $$;
ROLLBACK;
