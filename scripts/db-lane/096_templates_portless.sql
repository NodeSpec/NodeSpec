-- db-lane 096: the shipped templates carry no ports, and no template edge
-- ends on a container (V3 AG.13f and AG.14d, owner 2026-09-28).
--
--   After the migration: no template node carries `ports`, no template edge
--   carries a port id, no template edge ends on a node whose role is a
--   container, and the four supabase-gitops-pipeline edges that ended on a
--   host box end on the node inside it. Every other key of every row is as it
--   was. The migration replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regclass('public.project_templates') IS NULL THEN
    RAISE EXCEPTION 'db-lane 096: there is no template table. Apply migration 20260814600000 and the migrations before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_templates WHERE slug = 'supabase-gitops-pipeline') THEN
    RAISE EXCEPTION 'db-lane 096: the supabase-gitops-pipeline template is missing. Apply migration 20260814600000 and the template migrations after it.';
  END IF;
END $$;

-- The rows before, with their ports and port ids taken out by hand: the
-- migration must change nothing else, apart from the four edges below.
CREATE TEMP TABLE lane_096_before AS
  SELECT t.slug,
         t.graph_data - 'nodes' - 'edges' AS rest,
         (SELECT jsonb_object_agg(k, n - 'ports') FROM jsonb_each(t.graph_data -> 'nodes') x(k, n)) AS nodes,
         (SELECT jsonb_object_agg(k, e - 'sourcePortId' - 'targetPortId') FROM jsonb_each(COALESCE(t.graph_data -> 'edges', '{}'::jsonb)) y(k, e)) AS edges,
         t.template_specification AS spec
  FROM public.project_templates t;

\ir ../../supabase/migrations/20260928140000_v3_ag13_ag14_templates.sql

CREATE TEMP TABLE lane_096_after AS
  SELECT slug, graph_data, updated_at FROM public.project_templates;

\ir ../../supabase/migrations/20260928140000_v3_ag13_ag14_templates.sql

DO $$
DECLARE
  bad text;
  g jsonb;
  mv record;
BEGIN
  -- replay changes nothing
  IF EXISTS (SELECT 1 FROM public.project_templates t JOIN lane_096_after a USING (slug)
             WHERE t.graph_data IS DISTINCT FROM a.graph_data OR t.updated_at IS DISTINCT FROM a.updated_at) THEN
    RAISE EXCEPTION 'db-lane 096: replaying the migration changed a template';
  END IF;

  -- no ports and no port ids anywhere
  IF EXISTS (SELECT 1 FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') n WHERE n.value ? 'ports') THEN
    RAISE EXCEPTION 'db-lane 096: a template node still carries ports';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_templates t, jsonb_each(COALESCE(t.graph_data -> 'edges', '{}'::jsonb)) e
             WHERE e.value ? 'sourcePortId' OR e.value ? 'targetPortId') THEN
    RAISE EXCEPTION 'db-lane 096: a template edge still carries a port id';
  END IF;

  -- AG.0d / AG.14d: no template edge ends on a container
  SELECT string_agg(t.slug || ':' || e.key, ', ') INTO bad
  FROM public.project_templates t, jsonb_each(COALESCE(t.graph_data -> 'edges', '{}'::jsonb)) e
  WHERE EXISTS (SELECT 1 FROM public.node_roles r WHERE r.is_container
                AND r.id IN (t.graph_data -> 'nodes' -> (e.value ->> 'source') ->> 'type',
                             t.graph_data -> 'nodes' -> (e.value ->> 'target') ->> 'type'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 096: template edge(s) end on a container: %', bad; END IF;

  -- the four edges end on the node inside, each still from the same node
  SELECT graph_data INTO g FROM public.project_templates WHERE slug = 'supabase-gitops-pipeline';
  FOR mv IN SELECT * FROM (VALUES
      ('b4000000-0000-4000-8000-000000000005', 'Delivery Pipeline', 'React SPA'),
      ('b4000000-0000-4000-8000-000000000016', 'Environment Provisioning', 'React SPA'),
      ('b4000000-0000-4000-8000-000000000014', 'Environment Provisioning', 'Staging Database'),
      ('b4000000-0000-4000-8000-000000000015', 'Environment Provisioning', 'Production Database')) v(edge_id, source_label, target_label)
  LOOP
    IF g -> 'nodes' -> (g #>> ARRAY['edges', mv.edge_id, 'source']) ->> 'label' IS DISTINCT FROM mv.source_label
       OR g -> 'nodes' -> (g #>> ARRAY['edges', mv.edge_id, 'target']) ->> 'label' IS DISTINCT FROM mv.target_label THEN
      RAISE EXCEPTION 'db-lane 096: edge % does not run from % to %', mv.edge_id, mv.source_label, mv.target_label;
    END IF;
  END LOOP;

  -- nothing else changed: nodes, the other edges, the rest of the graph and the spec
  IF EXISTS (
    SELECT 1 FROM public.project_templates t JOIN lane_096_before b USING (slug)
    WHERE (t.graph_data - 'nodes' - 'edges') IS DISTINCT FROM b.rest
       OR t.graph_data -> 'nodes' IS DISTINCT FROM b.nodes
       OR t.template_specification IS DISTINCT FROM b.spec
       OR (SELECT jsonb_object_agg(k, e) FROM jsonb_each(t.graph_data -> 'edges') x(k, e)
           WHERE NOT (t.slug = 'supabase-gitops-pipeline' AND k IN (
             'b4000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000016',
             'b4000000-0000-4000-8000-000000000014', 'b4000000-0000-4000-8000-000000000015')))
          IS DISTINCT FROM
          (SELECT jsonb_object_agg(k, e) FROM jsonb_each(b.edges) y(k, e)
           WHERE NOT (b.slug = 'supabase-gitops-pipeline' AND k IN (
             'b4000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000016',
             'b4000000-0000-4000-8000-000000000014', 'b4000000-0000-4000-8000-000000000015')))
  ) THEN
    RAISE EXCEPTION 'db-lane 096: the migration changed more than ports and the four edges';
  END IF;

  RAISE NOTICE 'db-lane 096: no template carries a port, no template edge ends on a container, the four gitops edges end on the node inside, nothing else changed, replay changes nothing';
END $$;

ROLLBACK;
