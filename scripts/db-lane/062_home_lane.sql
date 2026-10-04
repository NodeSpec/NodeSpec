-- db-lane 062: every candidate has a home lane, and only in its own project.
--
--   trg_requirement_candidates_home_lane (v3v, V3 6.6): a row inserted
--   without a workflow_id gets one: import-born kinds (api, data, behavior)
--   go to the project's imported lane (kind 'imported', named Imported),
--   created once; an outcome goes to the project's first WORKFLOW lane, or a
--   Workflow lane created once when there is none, and never to the imported
--   lane (V3 6.6: the app does not draw that lane as a workflow). A lane
--   from another project is refused with 23514. The column is NOT NULL, and
--   a lane that still homes a candidate cannot be deleted (RESTRICT).
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_p1 uuid := 'db620000-0000-4000-8000-000000000010';
  v_b1 uuid := 'db620000-0000-4000-8000-000000000011';
  v_p2 uuid := 'db620000-0000-4000-8000-000000000020';
  v_b2 uuid := 'db620000-0000-4000-8000-000000000021';
  v_lane uuid; v_name text; v_kind text; v_n int; v_refused boolean;
  v_api1 uuid := 'db620000-0000-4000-8000-000000000101';
  v_api2 uuid := 'db620000-0000-4000-8000-000000000102';
  v_out1 uuid := 'db620000-0000-4000-8000-000000000103';
  v_out2 uuid := 'db620000-0000-4000-8000-000000000201';
BEGIN
  IF to_regprocedure('public.requirement_candidates_home_lane_guard()') IS NULL
     OR to_regprocedure('public.candidate_home_lane(uuid, uuid, text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_requirement_candidates_home_lane') THEN
    RAISE EXCEPTION 'db-lane 062: the home-lane trigger is missing. Apply migration 20260916110000.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requirement_candidates' AND column_name = 'workflow_id' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'db-lane 062: workflow_id is nullable; v3v closed the column';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 062: no auth.users row to own the fixture. Run supabase db reset.'; END IF;

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_p1, 'db-lane 062 a', v_owner), (v_p2, 'db-lane 062 b', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_b1, v_p1, 'main', v_owner), (v_b2, v_p2, 'main', v_owner);

  -- ── 1. an import-born candidate on a project with no lanes: Imported is created once ──
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES (v_api1, v_p1, v_b1, NULL, 'api:one', 'api', 'One endpoint');
  SELECT w.name, w.id INTO v_name, v_lane FROM public.requirement_candidates c JOIN public.workflows w ON w.id = c.workflow_id WHERE c.id = v_api1;
  IF v_name IS DISTINCT FROM 'Imported' THEN RAISE EXCEPTION 'db-lane 062: an api candidate should be homed in Imported, got %', v_name; END IF;
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES (v_api2, v_p1, v_b1, NULL, 'data:two', 'data', 'A model');
  SELECT count(*) INTO v_n FROM public.workflows WHERE project_id = v_p1 AND name = 'Imported';
  IF v_n <> 1 THEN RAISE EXCEPTION 'db-lane 062: Imported must be created once, found %', v_n; END IF;
  IF (SELECT workflow_id FROM public.requirement_candidates WHERE id = v_api2) <> v_lane THEN RAISE EXCEPTION 'db-lane 062: the second import-born row should share the Imported lane'; END IF;

  IF (SELECT kind FROM public.workflows WHERE id = v_lane) IS DISTINCT FROM 'imported' THEN RAISE EXCEPTION 'db-lane 062: the Imported lane should be kind imported (V3 6.6). Apply migration 20260921100000.'; END IF;

  -- ── 2. an outcome never takes the imported lane: with no workflow lane yet, Workflow is created ──
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES (v_out1, v_p1, v_b1, NULL, 'outcome:one', 'outcome', 'A reader can trust the list');
  IF (SELECT workflow_id FROM public.requirement_candidates WHERE id = v_out1) = v_lane THEN RAISE EXCEPTION 'db-lane 062: an outcome must not be homed in the imported lane'; END IF;
  SELECT w.name, w.kind INTO v_name, v_kind FROM public.requirement_candidates c JOIN public.workflows w ON w.id = c.workflow_id WHERE c.id = v_out1;
  IF v_name IS DISTINCT FROM 'Workflow' OR v_kind IS DISTINCT FROM 'workflow' THEN RAISE EXCEPTION 'db-lane 062: an outcome beside only an imported lane should create Workflow (kind workflow), got % (%)', v_name, v_kind; END IF;

  -- ── 3. an outcome on a project with no lanes at all: a Workflow lane is created ──
  INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name)
    VALUES (v_out2, v_p2, v_b2, NULL, 'outcome:two', 'outcome', 'Something the product promises');
  SELECT w.name INTO v_name FROM public.requirement_candidates c JOIN public.workflows w ON w.id = c.workflow_id WHERE c.id = v_out2;
  IF v_name IS DISTINCT FROM 'Workflow' THEN RAISE EXCEPTION 'db-lane 062: an outcome on a lane-less project should create Workflow, got %', v_name; END IF;

  -- ── 4. a lane from another project is refused, on insert and on update ──
  v_refused := false;
  BEGIN
    INSERT INTO public.requirement_candidates (id, project_id, branch_id, node_id, key, kind, name, workflow_id)
      VALUES ('db620000-0000-4000-8000-000000000301', v_p2, v_b2, NULL, 'outcome:x', 'outcome', 'Wrong lane', v_lane);
  EXCEPTION WHEN SQLSTATE '23514' THEN v_refused := SQLERRM LIKE '%must belong to its own project%';
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 062: a lane from another project should be refused with 23514'; END IF;
  v_refused := false;
  BEGIN
    UPDATE public.requirement_candidates SET workflow_id = v_lane WHERE id = v_out2;
  EXCEPTION WHEN SQLSTATE '23514' THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 062: re-homing into another project''s lane should be refused'; END IF;

  -- ── 5. a lane that homes a candidate cannot be deleted; move the rows first ──
  v_refused := false;
  BEGIN
    DELETE FROM public.workflows WHERE id = v_lane;
  EXCEPTION WHEN SQLSTATE '23503' THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 062: deleting a lane with homed candidates should be refused (RESTRICT)'; END IF;

  RAISE NOTICE 'db-lane 062: Imported once for import-born rows (kind imported), the first workflow lane for outcomes and never the imported one, Workflow when there is none, a foreign lane refused, a homing lane undeletable';
END $$;
ROLLBACK;
