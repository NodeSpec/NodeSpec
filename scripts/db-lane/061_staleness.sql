-- db-lane 061: the three staleness triggers mark a test case stale for the
-- right reason, and never for evidence landing on a criterion.
--
--   trg_mark_tests_stale_on_mapping_change   a mapping added or removed
--   trg_mark_tests_stale_on_req_change       the criteria THEMSELVES or the
--                                            description changed; evidence
--                                            keys (met, testId, provenance,
--                                            evidenceStale) never count
--   trg_mark_tests_stale_on_artifact_change  a SOURCE artifact's content_hash
--                                            moved, for the cases bound to it
--
-- Behaviour, not text (V3 5.1). No vitest pin stood in for these three; the
-- 2026-08-23 self-stale fix (evidence writes must not stale their own proof)
-- had only its migration's comment. Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj uuid := 'db610000-0000-4000-8000-000000000010';
  v_br   uuid := 'db610000-0000-4000-8000-000000000011';
  v_spec uuid := 'db610000-0000-4000-8000-000000000020';
  v_req  uuid := 'db610000-0000-4000-8000-000000000030';
  v_tc   uuid := 'db610000-0000-4000-8000-000000000040';
  v_node uuid := 'db610000-0000-4000-8000-000000000050';
  v_map  uuid := 'db610000-0000-4000-8000-000000000060';
  v_src  uuid := 'db610000-0000-4000-8000-000000000070';
  v_schema uuid := 'db610000-0000-4000-8000-000000000071';
  v_stale boolean; v_reason text;
BEGIN
  IF to_regprocedure('public.mark_tests_stale_on_mapping_change()') IS NULL
     OR to_regprocedure('public.mark_tests_stale_on_requirement_change()') IS NULL
     OR to_regprocedure('public.mark_tests_stale_on_artifact_change()') IS NULL
     OR (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_mark_tests_stale_on_mapping_change', 'trg_mark_tests_stale_on_req_change', 'trg_mark_tests_stale_on_artifact_change')) <> 3 THEN
    RAISE EXCEPTION 'db-lane 061: one of the three staleness triggers is missing. Apply migration 20260823120000 (and 20260327150225, 20260422015955 before it).';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 061: no auth.users row to own the fixture. Run supabase db reset.'; END IF;

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 061', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.project_specifications (id, project_id, vision, created_by) VALUES (v_spec, v_proj, 'db-lane 061', v_owner);
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, description, source, confirmed, locked, acceptance_criteria)
    VALUES (v_req, v_spec, 'REQ-001', 'Store tasks', 'Tasks persist', 'manual', true, false,
            jsonb_build_array(jsonb_build_object('id', 'c1', 'text', 'Tasks persist across sessions', 'verification', 'automated', 'met', false, 'testId', v_tc::text)));
  INSERT INTO public.artifacts (id, project_id, branch_id, node_id, type, kind, path, content_hash) VALUES
    (v_src, v_proj, v_br, v_node, 'source', 'source', 'src/tasks.ts', 'h1'),
    (v_schema, v_proj, v_br, v_node, 'schema', 'schema', 'db/tasks.sql', 's1');
  INSERT INTO public.test_cases (id, requirement_id, test_id, name, status, stale, source_artifact_ids)
    VALUES (v_tc, v_req, 'TC-001', 'persist.spec', 'passed', false, ARRAY[v_src]);

  -- ── 1. a mapping added, then removed ──
  INSERT INTO public.specification_mappings (id, specification_id, requirement_id, node_id) VALUES (v_map, v_spec, v_req, v_node);
  SELECT stale, staleness_reason INTO v_stale, v_reason FROM public.test_cases WHERE id = v_tc;
  IF NOT v_stale OR v_reason <> 'Architecture mappings changed' THEN RAISE EXCEPTION 'db-lane 061: a new mapping should stale the case with its reason, got % / %', v_stale, v_reason; END IF;
  UPDATE public.test_cases SET stale = false, staleness_reason = NULL WHERE id = v_tc;
  DELETE FROM public.specification_mappings WHERE id = v_map;
  SELECT stale INTO v_stale FROM public.test_cases WHERE id = v_tc;
  IF NOT v_stale THEN RAISE EXCEPTION 'db-lane 061: a removed mapping should stale the case'; END IF;
  UPDATE public.test_cases SET stale = false, staleness_reason = NULL WHERE id = v_tc;

  -- ── 2. the requirement: evidence never stales its own proof; the criteria and the description do ──
  PERFORM public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"c1","value":true},{"op":"stamp","criterion_id":"c1","value":{"source":"test"}}]'::jsonb, NULL);
  SELECT stale INTO v_stale FROM public.test_cases WHERE id = v_tc;
  IF v_stale THEN RAISE EXCEPTION 'db-lane 061: evidence landing on a criterion staled its own proof (the 2026-08-23 self-stale bug)'; END IF;
  UPDATE public.specification_requirements SET name = 'Store tasks durably' WHERE id = v_req;
  SELECT stale INTO v_stale FROM public.test_cases WHERE id = v_tc;
  IF v_stale THEN RAISE EXCEPTION 'db-lane 061: a rename is not a change to what is tested'; END IF;
  UPDATE public.specification_requirements
     SET acceptance_criteria = jsonb_set(acceptance_criteria, '{0,text}', '"Tasks persist across sessions and restarts"')
   WHERE id = v_req;
  SELECT stale, staleness_reason INTO v_stale, v_reason FROM public.test_cases WHERE id = v_tc;
  IF NOT v_stale OR v_reason <> 'Acceptance criteria changed' THEN RAISE EXCEPTION 'db-lane 061: a reworded criterion should stale the case, got % / %', v_stale, v_reason; END IF;
  UPDATE public.test_cases SET stale = false, staleness_reason = NULL WHERE id = v_tc;
  UPDATE public.specification_requirements SET description = 'Tasks persist, even across a restart' WHERE id = v_req;
  SELECT stale, staleness_reason INTO v_stale, v_reason FROM public.test_cases WHERE id = v_tc;
  IF NOT v_stale OR v_reason <> 'Requirement description changed' THEN RAISE EXCEPTION 'db-lane 061: a description change should stale the case with its own reason, got % / %', v_stale, v_reason; END IF;
  UPDATE public.test_cases SET stale = false, staleness_reason = NULL WHERE id = v_tc;
  -- an already-stale case keeps its FIRST reason
  UPDATE public.test_cases SET stale = true, staleness_reason = 'kept' WHERE id = v_tc;
  UPDATE public.specification_requirements SET description = 'Tasks persist, always' WHERE id = v_req;
  SELECT staleness_reason INTO v_reason FROM public.test_cases WHERE id = v_tc;
  IF v_reason <> 'kept' THEN RAISE EXCEPTION 'db-lane 061: a stale case must keep its first reason, got %', v_reason; END IF;
  UPDATE public.test_cases SET stale = false, staleness_reason = NULL WHERE id = v_tc;

  -- ── 3. the artifact: a SOURCE hash move stales the bound case; metadata and other kinds do not ──
  UPDATE public.artifacts SET metadata = '{"note":"touched"}'::jsonb WHERE id = v_src;
  SELECT stale INTO v_stale FROM public.test_cases WHERE id = v_tc;
  IF v_stale THEN RAISE EXCEPTION 'db-lane 061: a metadata-only artifact update must not stale'; END IF;
  UPDATE public.artifacts SET content_hash = 's2' WHERE id = v_schema;
  SELECT stale INTO v_stale FROM public.test_cases WHERE id = v_tc;
  IF v_stale THEN RAISE EXCEPTION 'db-lane 061: a schema artifact is not source; its hash must not stale the case'; END IF;
  UPDATE public.artifacts SET content_hash = 'h2' WHERE id = v_src;
  SELECT stale, staleness_reason INTO v_stale, v_reason FROM public.test_cases WHERE id = v_tc;
  IF NOT v_stale OR v_reason <> 'Source code changed' THEN RAISE EXCEPTION 'db-lane 061: a source hash move should stale the bound case, got % / %', v_stale, v_reason; END IF;

  RAISE NOTICE 'db-lane 061: mappings, criteria text, the description and a source hash each stale a case with their own reason; evidence, a rename, metadata and a schema hash never do';
END $$;
ROLLBACK;
