-- db-lane 107: the example project is a business (V3 AJ.6b; owner 2026-10-01: "For the
-- example project seed sql, change this to a specific business or individual use-case
-- (not the game example)").
--
--   Under migration 20260930150000 three accounts meet the game example: Ada has it, Cy
--   had it and deleted it, Dee never signed in. Then 20261001120000 runs, twice, and:
--   - Ada's game example is gone, her own project stays, and her next call makes the
--     Harbor Lane Bakery example under the same id, whole, with Team mode, naming her and
--     none of the seed's ids;
--   - every task row of the bakery is a task line in its node's doc the way the server
--     reads one (the generator's em dash), where the game example's were not;
--   - Cy, who deleted the game example, is not given the bakery: deleted stays deleted;
--   - Eve, who already holds a bakery example when the migration runs, keeps it;
--   - Dee gets her own bakery, distinct ids, on her first call;
--   - replaying the migration leaves the bakery examples and the functions as they were.
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
    'owners', (SELECT jsonb_agg(owner_label ORDER BY owner_label) FROM public.workflows WHERE project_id = p AND owner_label IS NOT NULL),
    'team', (SELECT jsonb_agg(m->>'role' ORDER BY m->>'role') FROM public.projects, jsonb_array_elements(metadata->'exampleTeam') m WHERE id = p),
    'teammate', (SELECT count(*) FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
                  WHERE ap.status = 'pending' AND ap.metadata->>'authMethod' = 'jwt' AND ap.metadata->>'externalAgent' = 'rosa.delgado@harborlanebakery.example'));
$$;
-- Task rows (not orphaned) whose node's task doc carries their line the way the server's
-- parser reads it (task-deltas.ts TASK_LINE): "**Tn <em dash> title** <!-- t:key -->".
CREATE FUNCTION pg_temp.parsed_tasks(p uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.task_items t
   WHERE t.project_id = p AND NOT t.orphaned
     AND EXISTS (SELECT 1 FROM public.graph_snapshots s, jsonb_each(s.graph_data->'artifacts') a
                  WHERE s.project_id = p AND a.value->>'kind' = 'task' AND (a.value->>'nodeId')::uuid = t.node_id
                    AND position('**' || t.display_id || ' ' || chr(8212) || ' ' || t.title || '** <!-- t:' || t.task_key || ' -->' IN a.value->>'content') > 0);
$$;
CREATE TEMP TABLE lane_ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON lane_ids TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.ensure_example_project()') IS NULL OR to_regprocedure('public.example_project_sql()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 107: the example project functions are missing. Apply migration 20260930150000 and the chain before it.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db107000-0000-4000-8000-000000000001', 'db-lane-107-ada@nodespec.local'),
    ('db107000-0000-4000-8000-000000000002', 'db-lane-107-cy@nodespec.local'),
    ('db107000-0000-4000-8000-000000000003', 'db-lane-107-dee@nodespec.local'),
    ('db107000-0000-4000-8000-000000000004', 'db-lane-107-eve@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db107000-0000-4000-8000-000000000011', 'Ada''s shop', 'db107000-0000-4000-8000-000000000001');
  -- Eve already has the bakery, marked by the server, with her grant
  INSERT INTO public.projects (id, name, owner_id, metadata) VALUES
    ('db107000-0000-4000-8000-000000000041', 'Harbor Lane Bakery (example)', 'db107000-0000-4000-8000-000000000004', '{"example": "harbor-lane-bakery"}');
  INSERT INTO public.user_settings (user_id, preferences) VALUES
    ('db107000-0000-4000-8000-000000000004', '{"exampleProject": {"id": "db107000-0000-4000-8000-000000000041"}}');
END $$;

-- ── 1. under the game example ──
\ir ../../supabase/migrations/20260930150000_v3_example_project.sql
SELECT pg_temp.act_as('db107000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO lane_ids VALUES ('ada-game', public.ensure_example_project()); END $$;
RESET ROLE;
SELECT pg_temp.act_as('db107000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid := public.ensure_example_project();
BEGIN
  DELETE FROM public.projects WHERE id = v;
END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
DECLARE g uuid := (SELECT id FROM lane_ids WHERE k = 'ada-game');
BEGIN
  IF (SELECT metadata->>'example' FROM public.projects WHERE id = g) IS DISTINCT FROM 'living-cascade' THEN
    RAISE EXCEPTION 'db-lane 107: under 20260930150000 Ada should hold the game example';
  END IF;
  -- the bug this replaces: the game example's task lines carry a colon, not the em dash
  IF pg_temp.parsed_tasks(g) <> 0 THEN
    RAISE EXCEPTION 'db-lane 107: the game example''s task lines were expected not to parse, % did', pg_temp.parsed_tasks(g);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = 'db107000-0000-4000-8000-000000000002' AND preferences ? 'exampleProject')
     OR EXISTS (SELECT 1 FROM public.projects WHERE owner_id = 'db107000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'db-lane 107: Cy should hold the grant and no project';
  END IF;
END $$;

-- ── 2. the bakery replaces it ──
\ir ../../supabase/migrations/20261001120000_v3_example_bakery.sql
CREATE TEMP TABLE lane_107_once AS
  SELECT (SELECT jsonb_agg(jsonb_build_array(p.proname, md5(p.prosrc), p.prosecdef, p.proconfig) ORDER BY p.proname)
            FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('example_project_sql', 'ensure_example_project', 'is_example_project')) AS fns;
\ir ../../supabase/migrations/20261001120000_v3_example_bakery.sql
DO $$
BEGIN
  IF (SELECT jsonb_agg(jsonb_build_array(p.proname, md5(p.prosrc), p.prosecdef, p.proconfig) ORDER BY p.proname)
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('example_project_sql', 'ensure_example_project', 'is_example_project'))
       IS DISTINCT FROM (SELECT fns FROM lane_107_once) THEN
    RAISE EXCEPTION 'db-lane 107: replaying the migration changed the example functions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE metadata->>'example' = 'living-cascade') THEN
    RAISE EXCEPTION 'db-lane 107: a game example survived the migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = 'db107000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'db-lane 107: the migration removed Ada''s own project';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = 'db107000-0000-4000-8000-000000000001' AND preferences ? 'exampleProject') THEN
    RAISE EXCEPTION 'db-lane 107: Ada''s grant should be cleared with her game example';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = 'db107000-0000-4000-8000-000000000002' AND preferences ? 'exampleProject') THEN
    RAISE EXCEPTION 'db-lane 107: Cy deleted his example; his grant should stay';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = 'db107000-0000-4000-8000-000000000041')
     OR NOT EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = 'db107000-0000-4000-8000-000000000004' AND preferences ? 'exampleProject') THEN
    RAISE EXCEPTION 'db-lane 107: Eve''s bakery and her grant should be untouched by the migration';
  END IF;
END $$;

-- ── 3. Ada's next sign-in makes the bakery ──
SELECT pg_temp.act_as('db107000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid;
BEGIN
  v := public.ensure_example_project();
  IF v IS DISTINCT FROM (SELECT id FROM lane_ids WHERE k = 'ada-game') THEN
    RAISE EXCEPTION 'db-lane 107: Ada''s bakery should take her example''s id, read %', v;
  END IF;
  INSERT INTO lane_ids VALUES ('ada', v);
  IF (SELECT name FROM public.projects WHERE id = v) <> 'Harbor Lane Bakery (example)'
     OR (SELECT metadata->>'example' FROM public.projects WHERE id = v) IS DISTINCT FROM 'harbor-lane-bakery' THEN
    RAISE EXCEPTION 'db-lane 107: Ada should own the marked bakery example';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
DECLARE v uuid := (SELECT id FROM lane_ids WHERE k = 'ada'); s jsonb; rows text;
BEGIN
  s := pg_temp.shape_of(v);
  IF s <> jsonb_build_object('nodes', 11, 'requirements', 10, 'tests', 23, 'tasks', 57, 'outcomes', 11, 'steps', 13, 'pending', 4,
                             'owners', '["Rosa Delgado", "Sam Okafor"]'::jsonb,
                             'team', '["contributor", "maintainer", "viewer"]'::jsonb, 'teammate', 1) THEN
    RAISE EXCEPTION 'db-lane 107: the bakery should carry the whole demo with Team mode, read %', s;
  END IF;
  IF pg_temp.parsed_tasks(v) <> 56 OR (SELECT count(*) FROM public.task_items WHERE project_id = v AND orphaned) <> 1 THEN
    RAISE EXCEPTION 'db-lane 107: every task row but the orphan should be a task line the server reads, read % of 56', pg_temp.parsed_tasks(v);
  END IF;
  rows := pg_temp.project_rows(v);
  IF position('dc000000-0000-4000-8000-' IN rows) > 0 OR position('ba000000-0000-4000-8000-' IN rows) > 0
     OR position('b0000000-0000-4000-8000-000000000001' IN rows) > 0 OR position('bench@nodespec.local' IN rows) > 0 THEN
    RAISE EXCEPTION 'db-lane 107: the bakery names the seed''s ids or the bench user';
  END IF;
  IF position('db-lane-107-ada@nodespec.local' IN rows) = 0 OR position('user:db107000-0000-4000-8000-000000000001' IN rows) = 0 THEN
    RAISE EXCEPTION 'db-lane 107: the bakery should name Ada where the seed names the bench user';
  END IF;
  IF position('Living Cascade' IN rows) > 0 OR position('coralcove' IN rows) > 0 THEN
    RAISE EXCEPTION 'db-lane 107: nothing of the game example should remain in Ada''s example';
  END IF;
END $$;

-- ── 4. Cy deleted his; Dee gets her own ──
SELECT pg_temp.act_as('db107000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid := public.ensure_example_project();
BEGIN
  IF v IS NOT NULL THEN RAISE EXCEPTION 'db-lane 107: Cy deleted his example; he should not be given the bakery, read %', v; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_as('db107000-0000-4000-8000-000000000003');
SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO lane_ids VALUES ('dee', public.ensure_example_project()); END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
DECLARE a uuid := (SELECT id FROM lane_ids WHERE k = 'ada'); d uuid := (SELECT id FROM lane_ids WHERE k = 'dee');
BEGIN
  IF d IS NULL OR d = a OR pg_temp.shape_of(d) <> pg_temp.shape_of(a) THEN
    RAISE EXCEPTION 'db-lane 107: Dee should get her own bakery, as whole as Ada''s, read %', d;
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_items WHERE project_id = d AND id IN (SELECT id FROM public.task_items WHERE project_id = a)) THEN
    RAISE EXCEPTION 'db-lane 107: the two bakeries share row ids';
  END IF;
END $$;

-- ── 5. a replay leaves the bakeries alone ──
\ir ../../supabase/migrations/20261001120000_v3_example_bakery.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM public.projects WHERE id IN (SELECT id FROM lane_ids WHERE k IN ('ada', 'dee')) AND metadata->>'example' = 'harbor-lane-bakery') <> 2 THEN
    RAISE EXCEPTION 'db-lane 107: replaying the migration should leave the bakery examples in place';
  END IF;
  RAISE NOTICE 'db-lane 107: the game example makes way for the bakery under the same id; its task lines parse where the game''s did not; deleted stays deleted; a new account gets its own; replay changes nothing';
END $$;

ROLLBACK;
