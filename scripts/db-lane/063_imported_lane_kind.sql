-- db-lane 063: the import's home lane is a system lane (V3 6.6).
--
--   workflows.kind is 'workflow' or 'imported'. The home-lane trigger homes
--   an import-born candidate (api, data, behavior) in the project's imported
--   lane: by kind when one exists; else it adopts a clean lane already named
--   Imported (no steps, no outcome homed there: the row v3v made) and stamps
--   it; else it creates one, named Imported, or "Imported (repository)" when
--   a person's own lane holds that name. A project has at most one imported
--   lane (a partial unique index). An outcome never lands in it (062 proves
--   that half).
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_p1 uuid := 'db630000-0000-4000-8000-000000000010';
  v_b1 uuid := 'db630000-0000-4000-8000-000000000011';
  v_p2 uuid := 'db630000-0000-4000-8000-000000000020';
  v_b2 uuid := 'db630000-0000-4000-8000-000000000021';
  v_p3 uuid := 'db630000-0000-4000-8000-000000000030';
  v_b3 uuid := 'db630000-0000-4000-8000-000000000031';
  v_clean uuid := 'db630000-0000-4000-8000-000000000201';
  v_used uuid := 'db630000-0000-4000-8000-000000000301';
  v_lane uuid; v_name text; v_kind text; v_n int; v_refused boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workflows' AND column_name = 'kind')
     OR to_regclass('public.uq_workflows_one_imported_lane') IS NULL THEN
    RAISE EXCEPTION 'db-lane 063: workflows.kind or its index is missing. Apply migration 20260921100000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 063: no auth.users row to own the fixture. Run supabase db reset.'; END IF;

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_p1, 'db-lane 063 a', v_owner), (v_p2, 'db-lane 063 b', v_owner), (v_p3, 'db-lane 063 c', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_b1, v_p1, 'main', v_owner), (v_b2, v_p2, 'main', v_owner), (v_b3, v_p3, 'main', v_owner);

  -- ── 1. a fresh project: the imported lane is created with its kind, once ──
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES ('db630000-0000-4000-8000-000000000101', v_p1, v_b1, NULL, 'api:one', 'api', 'One endpoint');
  SELECT w.id, w.name, w.kind INTO v_lane, v_name, v_kind FROM public.requirement_candidates c JOIN public.workflows w ON w.id = c.workflow_id WHERE c.id = 'db630000-0000-4000-8000-000000000101';
  IF v_kind IS DISTINCT FROM 'imported' OR v_name IS DISTINCT FROM 'Imported' THEN RAISE EXCEPTION 'db-lane 063: expected the imported lane (kind imported, Imported), got % (%)', v_name, v_kind; END IF;
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES ('db630000-0000-4000-8000-000000000102', v_p1, v_b1, NULL, 'behavior:two', 'behavior', 'A behaviour');
  IF (SELECT workflow_id FROM public.requirement_candidates WHERE id = 'db630000-0000-4000-8000-000000000102') <> v_lane THEN RAISE EXCEPTION 'db-lane 063: the second import-born row should share the imported lane'; END IF;
  SELECT count(*) INTO v_n FROM public.workflows WHERE project_id = v_p1 AND kind = 'imported';
  IF v_n <> 1 THEN RAISE EXCEPTION 'db-lane 063: one imported lane, found %', v_n; END IF;

  -- ── 2. a clean lane already named Imported (the row v3v made) is adopted and stamped ──
  INSERT INTO public.workflows (id, project_id, name, kind, sort_order, created_by) VALUES (v_clean, v_p2, 'Imported', 'workflow', 0, v_owner);
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES ('db630000-0000-4000-8000-000000000202', v_p2, v_b2, NULL, 'data:model', 'data', 'A model');
  IF (SELECT workflow_id FROM public.requirement_candidates WHERE id = 'db630000-0000-4000-8000-000000000202') <> v_clean THEN RAISE EXCEPTION 'db-lane 063: a clean Imported lane should be adopted, not duplicated'; END IF;
  IF (SELECT kind FROM public.workflows WHERE id = v_clean) IS DISTINCT FROM 'imported' THEN RAISE EXCEPTION 'db-lane 063: the adopted lane should be stamped kind imported'; END IF;
  SELECT count(*) INTO v_n FROM public.workflows WHERE project_id = v_p2;
  IF v_n <> 1 THEN RAISE EXCEPTION 'db-lane 063: adoption must not create a second lane, found %', v_n; END IF;

  -- ── 3. a person's lane named Imported WITH a step keeps its name and kind; the import gets its own lane ──
  INSERT INTO public.workflows (id, project_id, name, kind, sort_order, created_by) VALUES (v_used, v_p3, 'Imported', 'workflow', 0, v_owner);
  INSERT INTO public.workflow_steps (workflow_id, name, sort_order) VALUES (v_used, 'Triage', 0);
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES ('db630000-0000-4000-8000-000000000302', v_p3, v_b3, NULL, 'api:three', 'api', 'Another endpoint');
  SELECT w.id, w.name, w.kind INTO v_lane, v_name, v_kind FROM public.requirement_candidates c JOIN public.workflows w ON w.id = c.workflow_id WHERE c.id = 'db630000-0000-4000-8000-000000000302';
  IF v_lane = v_used THEN RAISE EXCEPTION 'db-lane 063: a lane a person uses must not be taken over by the import'; END IF;
  IF v_kind IS DISTINCT FROM 'imported' OR v_name IS DISTINCT FROM 'Imported (repository)' THEN RAISE EXCEPTION 'db-lane 063: expected Imported (repository), kind imported, got % (%)', v_name, v_kind; END IF;
  IF (SELECT kind FROM public.workflows WHERE id = v_used) IS DISTINCT FROM 'workflow' THEN RAISE EXCEPTION 'db-lane 063: the person''s lane should stay kind workflow'; END IF;

  -- ── 4. a second imported lane on one project is refused ──
  v_refused := false;
  BEGIN
    INSERT INTO public.workflows (project_id, name, kind, sort_order, created_by) VALUES (v_p1, 'Imported again', 'imported', 9, v_owner);
  EXCEPTION WHEN SQLSTATE '23505' THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 063: a second imported lane should be refused with 23505'; END IF;

  -- ── 5. the kind is closed ──
  v_refused := false;
  BEGIN
    INSERT INTO public.workflows (project_id, name, kind, sort_order, created_by) VALUES (v_p1, 'Odd', 'system', 9, v_owner);
  EXCEPTION WHEN SQLSTATE '23514' THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 063: an unknown kind should be refused with 23514'; END IF;

  RAISE NOTICE 'db-lane 063: the imported lane is kind imported, created once or adopted from a clean Imported row, never a person''s used lane; one per project; the kind is closed';
END $$;
ROLLBACK;
