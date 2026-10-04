-- db-lane 113: production's drift is repaired before the release checks it (AL.17,
-- owner 2026-10-02; the read-only drift check against production).
--
--   Undrifted  on whatever the chain left, the file changes nothing: the GCP
--              template and the three containers stand as they were.
--   Drifted    production's two edits planted (Cloud Run Service retyped
--              Serverless Function; Webhook Handler added to what Docker
--              Compose, Kubernetes Namespace and VPC hold): the node is Docker
--              Container again, Webhook Handler is off the three lists, and
--              everything else they hold is as it was.
--   Replay     the second run changes nothing.
--   Refused    a Cloud Run Service on a type the file does not repair and
--              Google Cloud Run does not take: the file stops, saying so.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.run113() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'node', (SELECT graph_data -> 'nodes' -> 'b1000000-0000-4000-8000-000000000014' FROM public.project_templates WHERE slug = 'gcp-fullstack-webapp'),
    'graph', (SELECT graph_data FROM public.project_templates WHERE slug = 'gcp-fullstack-webapp'),
    'stamp', (SELECT updated_at FROM public.project_templates WHERE slug = 'gcp-fullstack-webapp'),
    'holds', (SELECT jsonb_object_agg(id, can_contain) FROM public.node_roles WHERE id IN ('docker-compose', 'k8s-namespace', 'vpc')));
$$;

DO $$
BEGIN
  IF to_regclass('public.project_templates') IS NULL OR to_regclass('public.node_roles') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260220230921 (project_templates) first';
  END IF;
  IF (SELECT graph_data #>> '{nodes,b1000000-0000-4000-8000-000000000014,type}' FROM public.project_templates WHERE slug = 'gcp-fullstack-webapp')
     IS DISTINCT FROM 'docker-container' THEN
    RAISE EXCEPTION 'db-lane 113: the GCP template''s Cloud Run Service must be a Docker Container (apply migration 20260319203351 first)';
  END IF;
END $$;

-- undrifted: nothing changes
CREATE TEMP TABLE lane113_before AS SELECT pg_temp.run113() AS s;
\ir ../../supabase/migrations/20260928116000_v3_release_production_drift.sql
DO $$
BEGIN
  IF pg_temp.run113() IS DISTINCT FROM (SELECT s FROM lane113_before) THEN
    RAISE EXCEPTION 'db-lane 113: the file changed a chain that never drifted';
  END IF;
END $$;

-- production's drift, planted
UPDATE public.project_templates
SET graph_data = jsonb_set(graph_data, '{nodes,b1000000-0000-4000-8000-000000000014,type}', '"serverless-function"')
WHERE slug = 'gcp-fullstack-webapp';
UPDATE public.node_roles SET can_contain = can_contain || '["webhook-handler"]'::jsonb
WHERE id IN ('docker-compose', 'k8s-namespace', 'vpc') AND NOT can_contain ? 'webhook-handler';

\ir ../../supabase/migrations/20260928116000_v3_release_production_drift.sql

DO $$
DECLARE
  b jsonb := (SELECT s FROM lane113_before);
  a jsonb := pg_temp.run113();
BEGIN
  IF a -> 'node' IS DISTINCT FROM b -> 'node' THEN
    RAISE EXCEPTION 'db-lane 113: Cloud Run Service reads % after the repair', a -> 'node';
  END IF;
  IF a -> 'holds' IS DISTINCT FROM b -> 'holds' THEN
    RAISE EXCEPTION 'db-lane 113: the three containers hold % after the repair, held %', a -> 'holds', b -> 'holds';
  END IF;
END $$;

CREATE TEMP TABLE lane113_first AS SELECT pg_temp.run113() AS s;
\ir ../../supabase/migrations/20260928116000_v3_release_production_drift.sql
DO $$
BEGIN
  IF pg_temp.run113() IS DISTINCT FROM (SELECT s FROM lane113_first) THEN
    RAISE EXCEPTION 'db-lane 113: the replay changed something';
  END IF;
END $$;

-- a type the file does not repair, and Google Cloud Run does not take
SAVEPOINT unrepaired;
UPDATE public.project_templates
SET graph_data = jsonb_set(graph_data, '{nodes,b1000000-0000-4000-8000-000000000014,type}', '"cdn"')
WHERE slug = 'gcp-fullstack-webapp';
\set ON_ERROR_STOP off
\set VERBOSITY terse
\ir ../../supabase/migrations/20260928116000_v3_release_production_drift.sql
\set ON_ERROR_STOP on
\set VERBOSITY default
ROLLBACK TO SAVEPOINT unrepaired;
SELECT (:'LAST_ERROR_MESSAGE' LIKE '%Cloud Run Service is on a type Google Cloud Run does not take%') AS refused \gset
\if :refused
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-lane 113: a Cloud Run Service on a type Cloud Run does not take was not refused'; END $$;
\endif

DO $$ BEGIN RAISE NOTICE 'db-lane 113: an undrifted chain is untouched, production''s two edits are repaired and nothing else moves, the replay changes nothing, and an unrepaired Cloud Run type is refused'; END $$;

ROLLBACK;
