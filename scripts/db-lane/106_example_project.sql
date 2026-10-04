-- db-lane 106: the example project every account gets (V3 AJ.6; owner 2026-09-30: "an
-- example project that ships with each account ... that doesn't count against project
-- count and shows all the functionalities as part of the tour (include Team type
-- features and call this out as Team mode)").
--
--   The migration runs here, twice, and then, acting as the people involved:
--   - a Free account asking for its example gets the whole Living Cascade project under
--     its own ids, named as the example, marked, with the Team mode roster, the named
--     workflow owners and the teammate's proposal; no row it carries names the seed's
--     ids or the bench user; asking again gives the same project;
--   - a second account (whose email has an apostrophe, and who already holds the two
--     projects Free allows) gets its own copy with distinct ids and its own email;
--   - the call leaves the caller signed in as they were; signed out it is refused; anon
--     cannot call it and nobody signed in can read the SQL it runs;
--   - the cap does not count the example: a Free account with one still makes two
--     projects and is refused a third;
--   - a person cannot mark a project as an example, nor change or remove the mark;
--   - a Free owner reads the example's constraints and not their own project's, and
--     the example's workflows stay refused to their writes;
--   - deleted, the example is not made again;
--   - replaying the migration changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.act_as(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', p_user), true);
$$;
CREATE FUNCTION pg_temp.act_server() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
-- The rows of a project in every table that names one, as text.
CREATE FUNCTION pg_temp.project_rows(p uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t record; acc text := ''; part text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
            JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.column_name = 'project_id' ORDER BY 1 LOOP
    EXECUTE format('SELECT string_agg(to_jsonb(x)::text, '' '') FROM public.%I x WHERE project_id = $1', t.table_name) INTO part USING p;
    acc := acc || coalesce(part, '');
  END LOOP;
  RETURN acc || (SELECT to_jsonb(x)::text FROM public.projects x WHERE id = p);
END $$;
-- What the example carries, counted as the seed counts it.
CREATE FUNCTION pg_temp.shape_of(p uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'nodes', (SELECT count(*) FROM public.graph_snapshots s, jsonb_object_keys(s.graph_data->'nodes') WHERE s.project_id = p),
    'requirements', (SELECT count(*) FROM public.specification_requirements r JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = p),
    'tests', (SELECT count(*) FROM public.test_cases tc JOIN public.specification_requirements r ON r.id = tc.requirement_id
                JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = p),
    'tasks', (SELECT count(*) FROM public.task_items WHERE project_id = p),
    'outcomes', (SELECT count(*) FROM public.requirement_candidates WHERE project_id = p AND kind = 'outcome'),
    'steps', (SELECT count(*) FROM public.workflow_steps ws JOIN public.workflows w ON w.id = ws.workflow_id AND w.project_id = p),
    'pending', (SELECT count(*) FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p WHERE ap.status = 'pending'),
    'constraints', (SELECT count(*) FROM public.project_constraints WHERE project_id = p),
    'owners', (SELECT jsonb_agg(owner_label ORDER BY owner_label) FROM public.workflows WHERE project_id = p AND owner_label IS NOT NULL),
    'team', (SELECT jsonb_agg(m->>'role' ORDER BY m->>'role') FROM public.projects, jsonb_array_elements(metadata->'exampleTeam') m WHERE id = p),
    'teammate', (SELECT count(*) FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
                  WHERE ap.status = 'pending' AND ap.metadata->>'authMethod' = 'jwt' AND ap.metadata->>'externalAgent' = 'maya.chen@coralcove.example'));
$$;
CREATE TEMP TABLE lane_ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON lane_ids TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.plan_allows(text,uuid)') IS NULL OR to_regclass('public.project_constraints') IS NULL THEN
    RAISE EXCEPTION 'db-lane 106: the plan checks or the constraints table are missing. Apply migration 20260922110000 and the chain before it.';
  END IF;
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email) VALUES
    ('db106000-0000-4000-8000-000000000001', 'db-lane-106-ada@nodespec.local'),
    ('db106000-0000-4000-8000-000000000002', 'db-lane-106-o''bo@nodespec.local');
  DELETE FROM public.stripe_subscriptions WHERE user_id IN ('db106000-0000-4000-8000-000000000001', 'db106000-0000-4000-8000-000000000002');
  -- Bo already holds the two projects Free allows
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db106000-0000-4000-8000-000000000021', 'Bo one', 'db106000-0000-4000-8000-000000000002'),
    ('db106000-0000-4000-8000-000000000022', 'Bo two', 'db106000-0000-4000-8000-000000000002');
END $$;

\ir ../../supabase/migrations/20260930150000_v3_example_project.sql
CREATE TEMP TABLE lane_106_once AS
  SELECT (SELECT jsonb_agg(jsonb_build_array(p.proname, md5(p.prosrc), p.prosecdef, p.proconfig) ORDER BY p.proname)
            FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('example_project_sql', 'is_example_project', 'projects_example_guard', 'projects_plan_cap', 'ensure_example_project')) AS fns,
         (SELECT jsonb_agg(jsonb_build_array(policyname, cmd, permissive, qual) ORDER BY policyname) FROM pg_policies WHERE tablename = 'project_constraints') AS pols,
         (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal) AS triggers;
\ir ../../supabase/migrations/20260930150000_v3_example_project.sql
DO $$
BEGIN
  IF (SELECT jsonb_agg(jsonb_build_array(p.proname, md5(p.prosrc), p.prosecdef, p.proconfig) ORDER BY p.proname)
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('example_project_sql', 'is_example_project', 'projects_example_guard', 'projects_plan_cap', 'ensure_example_project'))
       IS DISTINCT FROM (SELECT fns FROM lane_106_once)
     OR (SELECT jsonb_agg(jsonb_build_array(policyname, cmd, permissive, qual) ORDER BY policyname) FROM pg_policies WHERE tablename = 'project_constraints')
       IS DISTINCT FROM (SELECT pols FROM lane_106_once)
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal) <> (SELECT triggers FROM lane_106_once) THEN
    RAISE EXCEPTION 'db-lane 106: replaying the migration changed its functions, the constraints policies or the project triggers';
  END IF;
  IF has_function_privilege('anon', 'public.ensure_example_project()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.example_project_sql()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.example_project_sql()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ensure_example_project()', 'EXECUTE') THEN
    RAISE EXCEPTION 'db-lane 106: a signed-in person calls ensure_example_project, and nobody else calls it or reads the SQL it runs';
  END IF;
END $$;

-- ── 1. Ada, on Free, asks for her example ──
SELECT pg_temp.act_as('db106000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid; again uuid;
BEGIN
  v := public.ensure_example_project();
  IF v IS NULL THEN RAISE EXCEPTION 'db-lane 106: a new account''s first call should make its example'; END IF;
  INSERT INTO lane_ids VALUES ('ada', v);
  IF current_setting('request.jwt.claim.sub', true) <> 'db106000-0000-4000-8000-000000000001'
     OR current_setting('request.jwt.claims', true)::jsonb->>'sub' <> 'db106000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'db-lane 106: the call should leave Ada signed in as she was, read % and %',
      current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true);
  END IF;
  again := public.ensure_example_project();
  IF again IS DISTINCT FROM v THEN RAISE EXCEPTION 'db-lane 106: asking again should give the same example, read % then %', v, again; END IF;
  -- she sees it as its owner
  IF (SELECT count(*) FROM public.projects WHERE owner_id = 'db106000-0000-4000-8000-000000000001') <> 1
     OR (SELECT name FROM public.projects WHERE id = v) <> 'Living Cascade (example)'
     OR (SELECT metadata->>'example' FROM public.projects WHERE id = v) IS DISTINCT FROM 'living-cascade' THEN
    RAISE EXCEPTION 'db-lane 106: Ada should own one project, the marked example';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
DECLARE v uuid := (SELECT id FROM lane_ids WHERE k = 'ada'); s jsonb; rows text;
BEGIN
  s := pg_temp.shape_of(v);
  IF s <> jsonb_build_object('nodes', 11, 'requirements', 10, 'tests', 23, 'tasks', 71, 'outcomes', 11, 'steps', 13, 'pending', 4,
                             'constraints', (s->'constraints')::int, 'owners', '["Maya Chen", "Theo Park"]'::jsonb,
                             'team', '["contributor", "maintainer", "viewer"]'::jsonb, 'teammate', 1)
     OR (s->>'constraints')::int < 1 THEN
    RAISE EXCEPTION 'db-lane 106: the example should carry the whole demo with Team mode, read %', s;
  END IF;
  rows := pg_temp.project_rows(v);
  IF position('dc000000-0000-4000-8000-' IN rows) > 0 OR position('b0000000-0000-4000-8000-000000000001' IN rows) > 0
     OR position('bench@nodespec.local' IN rows) > 0 THEN
    RAISE EXCEPTION 'db-lane 106: the example names the seed''s ids or the bench user';
  END IF;
  IF position('db-lane-106-ada@nodespec.local' IN rows) = 0 OR position('user:db106000-0000-4000-8000-000000000001' IN rows) = 0 THEN
    RAISE EXCEPTION 'db-lane 106: the example should name Ada where the seed names the bench user';
  END IF;
  IF (SELECT preferences->'exampleProject'->>'id' FROM public.user_settings WHERE user_id = 'db106000-0000-4000-8000-000000000001') IS DISTINCT FROM v::text THEN
    RAISE EXCEPTION 'db-lane 106: the grant should be recorded on Ada''s settings';
  END IF;
END $$;

-- ── 2. Bo, apostrophe in his email and two projects already, gets his own copy ──
SELECT pg_temp.act_as('db106000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid;
BEGIN
  v := public.ensure_example_project();
  IF v IS NULL OR v = (SELECT id FROM lane_ids WHERE k = 'ada') THEN
    RAISE EXCEPTION 'db-lane 106: Bo should get his own example, read %', v;
  END IF;
  INSERT INTO lane_ids VALUES ('bo', v);
END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
DECLARE a uuid := (SELECT id FROM lane_ids WHERE k = 'ada'); b uuid := (SELECT id FROM lane_ids WHERE k = 'bo'); rows text;
BEGIN
  IF pg_temp.shape_of(b) <> pg_temp.shape_of(a) THEN
    RAISE EXCEPTION 'db-lane 106: Bo''s example should carry what Ada''s does, read % and %', pg_temp.shape_of(b), pg_temp.shape_of(a);
  END IF;
  IF EXISTS (SELECT 1 FROM public.workflows x JOIN public.workflows y ON x.id = y.id WHERE x.project_id = a AND y.project_id = b)
     OR EXISTS (SELECT 1 FROM public.task_items WHERE project_id = b AND id IN (SELECT id FROM public.task_items WHERE project_id = a)) THEN
    RAISE EXCEPTION 'db-lane 106: the two examples share row ids';
  END IF;
  rows := pg_temp.project_rows(b);
  IF position('db-lane-106-o''bo@nodespec.local' IN rows) = 0 OR position(a::text IN rows) > 0 THEN
    RAISE EXCEPTION 'db-lane 106: Bo''s example should name Bo, apostrophe and all, and nothing of Ada''s';
  END IF;
  IF (SELECT count(*) FROM public.projects WHERE owner_id = 'db106000-0000-4000-8000-000000000002') <> 3 THEN
    RAISE EXCEPTION 'db-lane 106: Bo should hold his two projects and the example';
  END IF;
END $$;

-- ── 3. signed out, the call is refused ──
SELECT pg_temp.act_server();
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN PERFORM public.ensure_example_project(); EXCEPTION WHEN SQLSTATE '28000' THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 106: with nobody signed in there is no account to give an example to'; END IF;
END $$;

-- ── 4. the cap does not count the example; the mark is not a person's to set ──
SELECT pg_temp.act_as('db106000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false; ex uuid := (SELECT id FROM lane_ids WHERE k = 'ada');
BEGIN
  INSERT INTO public.projects (id, name, owner_id, metadata) VALUES
    ('db106000-0000-4000-8000-000000000011', 'Ada one', 'db106000-0000-4000-8000-000000000001',
     '{"example": "living-cascade", "exampleTeam": [{"email": "x@y.z", "role": "maintainer"}], "kept": 1}');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db106000-0000-4000-8000-000000000012', 'Ada two', 'db106000-0000-4000-8000-000000000001');
  BEGIN
    INSERT INTO public.projects (id, name, owner_id) VALUES
      ('db106000-0000-4000-8000-000000000013', 'Ada three', 'db106000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 106: Free holds two projects of her own beside the example, not three'; END IF;

  IF (SELECT metadata FROM public.projects WHERE id = 'db106000-0000-4000-8000-000000000011') <> '{"kept": 1}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 106: a new project should lose the mark a person wrote, read %',
      (SELECT metadata FROM public.projects WHERE id = 'db106000-0000-4000-8000-000000000011');
  END IF;
  UPDATE public.projects SET metadata = metadata || '{"example": "mine"}' WHERE id = 'db106000-0000-4000-8000-000000000012';
  IF (SELECT metadata ? 'example' FROM public.projects WHERE id = 'db106000-0000-4000-8000-000000000012') THEN
    RAISE EXCEPTION 'db-lane 106: a person should not mark their own project as an example';
  END IF;
  UPDATE public.projects SET metadata = '{"note": 1}', name = 'Ada''s tour' WHERE id = ex;
  IF (SELECT metadata->>'example' FROM public.projects WHERE id = ex) IS DISTINCT FROM 'living-cascade'
     OR jsonb_array_length((SELECT metadata->'exampleTeam' FROM public.projects WHERE id = ex)) <> 3
     OR (SELECT metadata->>'note' FROM public.projects WHERE id = ex) IS DISTINCT FROM '1'
     OR (SELECT name FROM public.projects WHERE id = ex) <> 'Ada''s tour' THEN
    RAISE EXCEPTION 'db-lane 106: renaming the example keeps its mark and roster, read %', (SELECT metadata FROM public.projects WHERE id = ex);
  END IF;
  UPDATE public.projects SET metadata = jsonb_set(metadata, '{example}', '"other"') WHERE id = ex;
  IF (SELECT metadata->>'example' FROM public.projects WHERE id = ex) IS DISTINCT FROM 'living-cascade' THEN
    RAISE EXCEPTION 'db-lane 106: a person should not change the mark';
  END IF;
END $$;
RESET ROLE;
-- the server writes the mark
SELECT pg_temp.act_server();
UPDATE public.projects SET metadata = metadata || '{"example": "server"}' WHERE id = 'db106000-0000-4000-8000-000000000012';
DO $$
BEGIN
  IF (SELECT metadata->>'example' FROM public.projects WHERE id = 'db106000-0000-4000-8000-000000000012') IS DISTINCT FROM 'server' THEN
    RAISE EXCEPTION 'db-lane 106: the server should be able to write the mark';
  END IF;
END $$;
UPDATE public.projects SET metadata = metadata - 'example' WHERE id = 'db106000-0000-4000-8000-000000000012';
-- a constraint on Ada's own project, written by the server
INSERT INTO public.project_constraints (project_id, ctype, title, description, author, source_hash)
  SELECT 'db106000-0000-4000-8000-000000000011', ctype, title, description, author, source_hash FROM public.project_constraints
   WHERE project_id = (SELECT id FROM lane_ids WHERE k = 'ada') LIMIT 1;

-- ── 5. Free reads the example's constraints, not her own; the example's workflows refuse her writes ──
SELECT pg_temp.act_as('db106000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE ex uuid := (SELECT id FROM lane_ids WHERE k = 'ada'); n int; v_refused boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.project_constraints WHERE project_id = ex) < 1 THEN
    RAISE EXCEPTION 'db-lane 106: Free should read the example''s constraints';
  END IF;
  IF (SELECT count(*) FROM public.project_constraints WHERE project_id = 'db106000-0000-4000-8000-000000000011') <> 0 THEN
    RAISE EXCEPTION 'db-lane 106: Free should not read her own project''s constraints';
  END IF;
  IF (SELECT count(*) FROM public.project_constraints WHERE project_id = (SELECT id FROM lane_ids WHERE k = 'bo')) <> 0 THEN
    RAISE EXCEPTION 'db-lane 106: Ada should not read Bo''s example';
  END IF;
  IF (SELECT count(*) FROM public.workflows WHERE project_id = ex) < 2 THEN
    RAISE EXCEPTION 'db-lane 106: Free should read the example''s workflows';
  END IF;
  UPDATE public.workflows SET color = '#000000' WHERE project_id = ex;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 106: Free should not change the example''s workflows, % changed', n; END IF;
  BEGIN
    INSERT INTO public.workflows (project_id, name) VALUES (ex, 'mine');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 106: Free should not add a workflow to the example'; END IF;
  v_refused := false;
  BEGIN
    INSERT INTO public.project_constraints (project_id, description, source_hash) VALUES (ex, 'mine', 'db106');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 106: Free should not add a constraint to the example'; END IF;
END $$;

-- ── 6. deleted, it stays deleted ──
DO $$
DECLARE ex uuid := (SELECT id FROM lane_ids WHERE k = 'ada'); again uuid;
BEGIN
  DELETE FROM public.projects WHERE id = ex;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = ex) THEN RAISE EXCEPTION 'db-lane 106: Ada should delete her example'; END IF;
  again := public.ensure_example_project();
  IF again IS NOT NULL THEN RAISE EXCEPTION 'db-lane 106: a deleted example should not be made again, read %', again; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE owner_id = 'db106000-0000-4000-8000-000000000001' AND metadata ? 'example') THEN
    RAISE EXCEPTION 'db-lane 106: Ada should have no example after deleting it';
  END IF;
  RAISE NOTICE 'db-lane 106: each account gets the whole example under its own ids with Team mode, once; the cap does not count it; the mark is the server''s; Free reads its constraints and writes none of its workflows; deleted it stays deleted; replay changes nothing';
END $$;

ROLLBACK;
