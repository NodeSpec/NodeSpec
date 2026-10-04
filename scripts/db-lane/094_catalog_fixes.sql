-- db-lane 094: wrong and leaking catalog rows (V3 AG.6, AG.8, AF.5; owner 2026-09-28).
--
--   The migration runs here, twice, on a database with planted rows:
--   - every node of every shipped template sits on a live role that its technology takes,
--     names a technology the catalog has, and sits in a parent whose role may contain it
--     (the rule canContain applies: listed roles, natures, interfaces, providers by id
--     prefix);
--   - a custom row with no project is deleted unless a graph uses it;
--   - the technology search returns a custom row only to the people of its project:
--     not to a stranger, not signed out, not to the service role;
--   - SQLite classifies as code, the C row names no future work, and every role a
--     deployment target lists exists;
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
CREATE FUNCTION pg_temp.act_as_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'anon', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
CREATE FUNCTION pg_temp.act_as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
-- May a parent of role p hold a child of role c carrying technology t? The rule canContain
-- applies (core/src/container-types.ts): a plain list names roles; a rule object admits by
-- role, nature, interface, the child role's provider or the technology's id prefix.
CREATE FUNCTION pg_temp.may_hold(p text, c text, t text) RETURNS boolean LANGUAGE sql AS $$
  SELECT CASE jsonb_typeof(pr.can_contain)
    WHEN 'array' THEN pr.can_contain ? c
    ELSE coalesce(pr.can_contain -> 'roleIds', '[]') ? c
      OR coalesce(pr.can_contain -> 'natures', '[]') ? cr.nature
      OR coalesce(pr.can_contain -> 'interfaceKinds', '[]') ? cr.interface_kind
      OR (cr.provider IS NOT NULL AND coalesce(pr.can_contain -> 'providers', '[]') ? cr.provider)
      OR (t IS NOT NULL AND coalesce(pr.can_contain -> 'providers', '[]') ? split_part(t, '-', 1))
    END
  FROM public.node_roles pr, public.node_roles cr WHERE pr.id = p AND cr.id = c;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.search_relevant_technologies(text, integer)') IS NULL OR to_regprocedure('public.member_project_ids(text)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 094: the search or the membership function is missing. Apply migration 20260928120000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db940000-0000-4000-8000-000000000001', 'db-lane-094-owner@nodespec.local'),
    ('db940000-0000-4000-8000-000000000002', 'db-lane-094-stranger@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db940000-0000-4000-8000-000000000010', 'db-lane 094', 'db940000-0000-4000-8000-000000000001');
  INSERT INTO public.branches (id, project_id, name, is_primary) VALUES
    ('db940000-0000-4000-8000-000000000011', 'db940000-0000-4000-8000-000000000010', 'main', true);
  -- a custom row in the project, and two with no project: one a graph uses, one nobody uses
  INSERT INTO public.technology_catalog (id, name, brand_color, role_affinities, ai_context, is_user_contributed, project_id) VALUES
    ('db94-custom-owned', 'Quokkaflux', '#123456', '["backend-service"]'::jsonb,
     '{"purpose": "A quokkaflux custom technology for db-lane 094."}'::jsonb, true, 'db940000-0000-4000-8000-000000000010'),
    ('db94-orphan-used', 'Quokkaflux Orphan Used', '#123456', '["backend-service"]'::jsonb,
     '{"purpose": "A quokkaflux orphan a graph still names."}'::jsonb, true, NULL),
    ('db94-orphan-unused', 'Quokkaflux Orphan Unused', '#123456', '["backend-service"]'::jsonb,
     '{"purpose": "A quokkaflux orphan nothing names."}'::jsonb, true, NULL);
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash) VALUES
    ('db940000-0000-4000-8000-000000000010', 'db940000-0000-4000-8000-000000000011',
     '{"id": "g94", "schemaVersion": 8, "version": 1, "hash": "db94-hash", "edges": {}, "contracts": {}, "artifacts": {},
       "nodes": {"n1": {"id": "n1", "type": "backend-service", "technology": "db94-orphan-used"}}}'::jsonb, 'db94-hash');
END $$;

\ir ../../supabase/migrations/20260928120000_v3_ag6_catalog_fixes.sql

CREATE TEMP TABLE lane_094_after_one AS
  SELECT (SELECT jsonb_agg(id ORDER BY id) FROM public.technology_catalog) AS techs,
         (SELECT jsonb_agg(graph_data ORDER BY slug) FROM public.project_templates) AS templates,
         (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets) AS targets,
         (SELECT ai_context FROM public.technology_catalog WHERE id = 'sqlite') AS sqlite,
         (SELECT ai_context FROM public.technology_catalog WHERE id = 'c-systems') AS c_row;

\ir ../../supabase/migrations/20260928120000_v3_ag6_catalog_fixes.sql

-- ── 1. replaying changes nothing ──────────────────────────────────────────────
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM lane_094_after_one;
  IF b.techs IS DISTINCT FROM (SELECT jsonb_agg(id ORDER BY id) FROM public.technology_catalog)
     OR b.templates IS DISTINCT FROM (SELECT jsonb_agg(graph_data ORDER BY slug) FROM public.project_templates)
     OR b.targets IS DISTINCT FROM (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets)
     OR b.sqlite IS DISTINCT FROM (SELECT ai_context FROM public.technology_catalog WHERE id = 'sqlite')
     OR b.c_row IS DISTINCT FROM (SELECT ai_context FROM public.technology_catalog WHERE id = 'c-systems') THEN
    RAISE EXCEPTION 'db-lane 094: replaying the migration changed something';
  END IF;
END $$;

-- ── 2. every template node resolves, and sits where its parent may hold it ─────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.slug || ': ' || (v ->> 'label') || ' (' || (v ->> 'type') || ')', '; ') INTO bad
  FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') e(k, v)
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles r WHERE r.id = v ->> 'type' AND NOT r.deprecated);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 094: template node(s) on no live role: %', bad; END IF;

  SELECT string_agg(t.slug || ': ' || (v ->> 'label') || ' names ' || (v ->> 'technology'), '; ') INTO bad
  FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') e(k, v)
  WHERE v ->> 'technology' IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.technology_catalog c WHERE c.id = v ->> 'technology');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 094: template node(s) naming a technology the catalog lacks: %', bad; END IF;

  -- a node's role is one its technology takes (the rule that found the GCP template's three)
  SELECT string_agg(t.slug || ': ' || (v ->> 'label') || ' (' || (v ->> 'type') || ', ' || (v ->> 'technology') || ')', '; ') INTO bad
  FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') e(k, v)
  JOIN public.technology_catalog c ON c.id = v ->> 'technology'
  WHERE NOT (c.role_affinities ? (v ->> 'type'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 094: template node(s) on a role their technology does not take: %', bad; END IF;

  SELECT string_agg(t.slug || ': ' || (v ->> 'label') || ' in ' || (t.graph_data #>> ARRAY['nodes', v ->> 'parentId', 'label']), '; ') INTO bad
  FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') e(k, v)
  WHERE v ->> 'parentId' IS NOT NULL
    AND NOT coalesce(pg_temp.may_hold(t.graph_data #>> ARRAY['nodes', v ->> 'parentId', 'type'], v ->> 'type', v ->> 'technology'), false);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 094: template node(s) in a parent that may not hold them: %', bad; END IF;

  -- the Next.js template's two platforms are containers now, and hold their six nodes,
  -- while it ships: AL.15 (20261002120000) retires it, and names the AWS template the
  -- Starter Project in the same migration, so a chain past AL.15 has no Next.js template
  IF EXISTS (SELECT 1 FROM public.project_templates WHERE slug = 'nextjs-supabase-stripe-saas') THEN
    IF (SELECT count(*) FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') e(k, v)
        WHERE t.slug = 'nextjs-supabase-stripe-saas'
          AND t.graph_data #>> ARRAY['nodes', v ->> 'parentId', 'type'] IN ('vercel', 'supabase')) <> 6 THEN
      RAISE EXCEPTION 'db-lane 094: the Next.js template''s six hosted nodes are not inside Vercel and Supabase';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.project_templates WHERE slug = 'aws-fullstack-webapp' AND name = 'AWS Starter Project') THEN
    RAISE EXCEPTION 'db-lane 094: the Next.js template is missing and AL.15 has not retired it';
  END IF;
END $$;

-- ── 3. a custom row with no project goes, unless a graph uses it ───────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'db94-orphan-unused') THEN
    RAISE EXCEPTION 'db-lane 094: a custom row with no project that nothing uses was kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'db94-orphan-used') THEN
    RAISE EXCEPTION 'db-lane 094: a custom row a graph still names was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'db94-custom-owned') THEN
    RAISE EXCEPTION 'db-lane 094: a custom row with a project was deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.technology_catalog WHERE id IN ('containerd', 'gate-annie')) THEN
    RAISE EXCEPTION 'db-lane 094: the two rows the production sync copied in are still here';
  END IF;
END $$;

-- ── 4. the search returns a custom row only to its project's people ────────────
SELECT pg_temp.act_as('db940000-0000-4000-8000-000000000001');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.search_relevant_technologies('quokkaflux', 20) WHERE tech_id = 'db94-custom-owned') THEN
    RAISE EXCEPTION 'db-lane 094: the project''s owner no longer finds their own custom technology';
  END IF;
  IF EXISTS (SELECT 1 FROM public.search_relevant_technologies('quokkaflux', 20) WHERE tech_id = 'db94-orphan-used') THEN
    RAISE EXCEPTION 'db-lane 094: a custom row with no project reached the owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search_relevant_technologies('postgresql', 5) WHERE tech_id = 'postgresql') THEN
    RAISE EXCEPTION 'db-lane 094: catalog rows no longer reach a signed-in person';
  END IF;
END $$;
SELECT pg_temp.act_as('db940000-0000-4000-8000-000000000002');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.search_relevant_technologies('quokkaflux', 20)) THEN
    RAISE EXCEPTION 'db-lane 094: a stranger reads another project''s custom technology';
  END IF;
END $$;
SELECT pg_temp.act_as_anon();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.search_relevant_technologies('quokkaflux', 20)) THEN
    RAISE EXCEPTION 'db-lane 094: a signed-out caller reads a project''s custom technology';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search_relevant_technologies('postgresql', 5) WHERE tech_id = 'postgresql') THEN
    RAISE EXCEPTION 'db-lane 094: catalog rows no longer reach a signed-out caller';
  END IF;
END $$;
SELECT pg_temp.act_as_service();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.search_relevant_technologies('quokkaflux', 20)) THEN
    RAISE EXCEPTION 'db-lane 094: the service role (the MCP server) reads a project''s custom technology';
  END IF;
END $$;

-- ── 5. SQLite, the C row, the deployment targets ───────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF (SELECT ai_context ? 'configMode' FROM public.technology_catalog WHERE id = 'sqlite') THEN
    RAISE EXCEPTION 'db-lane 094: SQLite still carries a configMode, so its packet asks for provisioning';
  END IF;
  IF (SELECT ai_context ->> 'purpose' FROM public.technology_catalog WHERE id = 'c-systems') NOT LIKE '%Firmware Service%Kernel Module%' THEN
    RAISE EXCEPTION 'db-lane 094: the C row does not say where firmware and kernel C live';
  END IF;
  SELECT string_agg(d.id || ':' || r, ', ') INTO bad
  FROM public.deployment_targets d, jsonb_array_elements_text(d.compatible_roles) r
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles n WHERE n.id = r);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 094: a deployment target lists roles that do not exist: %', bad; END IF;
  -- the live roles a target listed are kept, in order
  IF (SELECT compatible_roles FROM public.deployment_targets WHERE id = 'serverless') <> '["backend-service", "worker"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 094: the serverless target lost a live role or its order';
  END IF;
  RAISE NOTICE 'db-lane 094: every template node resolves and fits its parent; an unused orphan goes, a used one stays; a custom row reaches only its project; SQLite is code; the C row and the targets are current; replay changes nothing';
END $$;

ROLLBACK;
