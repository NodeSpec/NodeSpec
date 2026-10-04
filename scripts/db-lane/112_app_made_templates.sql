-- db-lane 112: templates made in the app hold through the release (AL.17, owner
-- 2026-10-02: the release stopped in production on a template the repository
-- does not ship; "it's okay if it makes the godot changes necessary as well").
--
--   Planted   on top of whatever the chain left, a community template and an
--             official one the repository does not ship, one node per rule:
--             Message Broker under RabbitMQ and under Kafka, Godot on Shared
--             Library, LiteLLM on the gone LLM Gateway type, Logging with no
--             technology, "aws" on an ECS Cluster; beside them a sound node and
--             one whose technology the catalog has never heard of.
--   After     each retired type takes the successor its technology takes
--             (Queue, Event Stream, Monitoring), the gone type takes LiteLLM's
--             live one, "aws" becomes "aws-ecs", Godot leaves the Shared
--             Library node and its type stays; the sound node and the unknown
--             technology are as they were; the shipped templates are untouched.
--   Replay    the second run changes nothing: graph and updated_at stand.
--   Refused   a node on a type with no live successor and no technology, and an
--             edge that ends on a container: the migration stops, naming the
--             template.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.g112(p_nodes jsonb, p_edges jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', 'g112', 'schemaVersion', 8, 'nodes', p_nodes, 'edges', p_edges,
                            'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb);
$$;
CREATE FUNCTION pg_temp.n112(p_slug text, p_node text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT graph_data -> 'nodes' -> p_node FROM public.project_templates WHERE slug = p_slug;
$$;

DO $$
BEGIN
  IF to_regclass('public.project_templates') IS NULL OR to_regclass('public.node_roles') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260220230921 (project_templates) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'aws-ecs' AND role_affinities ? 'ecs-cluster') THEN
    RAISE EXCEPTION 'db-lane 112: aws-ecs must take ECS Cluster (apply the catalog migrations first)';
  END IF;
END $$;

CREATE TEMP TABLE lane112_shipped AS
  SELECT slug, graph_data, updated_at FROM public.project_templates
  WHERE slug IN ('aws-fullstack-webapp', 'gcp-fullstack-webapp', 'supabase-gitops-pipeline',
                 'nextjs-supabase-stripe-saas', 'unity-ai-platformer');

INSERT INTO public.project_templates (slug, name, author_type, graph_data) VALUES
  ('db112-community', 'db-lane 112 community', 'community', pg_temp.g112('{
     "mq":    {"id": "mq",    "type": "message-broker",  "label": "Orders",       "technology": "rabbitmq"},
     "kq":    {"id": "kq",    "type": "message-broker",  "label": "Clickstream",  "technology": "kafka"},
     "lib":   {"id": "lib",   "type": "shared-library",  "label": "Save System",  "technology": "godot"},
     "llm":   {"id": "llm",   "type": "llm-gateway",     "label": "Gateway",      "technology": "litellm"},
     "log":   {"id": "log",   "type": "logging",         "label": "Logs"},
     "ok":    {"id": "ok",    "type": "backend-service", "label": "API",          "technology": "nodejs"},
     "other": {"id": "other", "type": "backend-service", "label": "Their own",    "technology": "db112-not-in-catalog"}
   }'::jsonb)),
  ('db112-official', 'db-lane 112 official', 'official', pg_temp.g112('{
     "cloud": {"id": "cloud", "type": "aws",             "label": "AWS",          "technology": "aws"},
     "ecs":   {"id": "ecs",   "type": "ecs-cluster",     "label": "ECS Cluster",  "technology": "aws", "parentId": "cloud"},
     "svc":   {"id": "svc",   "type": "backend-service", "label": "Orders",       "technology": "nodejs", "parentId": "ecs"}
   }'::jsonb, '{"e1": {"id": "e1", "source": "svc", "target": "svc"}}'::jsonb));

\ir ../../supabase/migrations/20260928115000_v3_release_app_made_templates.sql

DO $$
DECLARE
  bad text;
BEGIN
  IF pg_temp.n112('db112-community', 'mq') IS DISTINCT FROM '{"id": "mq", "type": "queue", "label": "Orders", "technology": "rabbitmq"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: Message Broker under RabbitMQ reads %', pg_temp.n112('db112-community', 'mq');
  END IF;
  IF pg_temp.n112('db112-community', 'kq') IS DISTINCT FROM '{"id": "kq", "type": "event-stream", "label": "Clickstream", "technology": "kafka"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: Message Broker under Kafka reads %', pg_temp.n112('db112-community', 'kq');
  END IF;
  IF pg_temp.n112('db112-community', 'lib') IS DISTINCT FROM '{"id": "lib", "type": "shared-library", "label": "Save System"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: Godot on Shared Library reads %', pg_temp.n112('db112-community', 'lib');
  END IF;
  IF pg_temp.n112('db112-community', 'llm') IS DISTINCT FROM '{"id": "llm", "type": "inference-service", "label": "Gateway", "technology": "litellm"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: the gone LLM Gateway type reads %', pg_temp.n112('db112-community', 'llm');
  END IF;
  IF pg_temp.n112('db112-community', 'log') IS DISTINCT FROM '{"id": "log", "type": "monitoring", "label": "Logs"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: Logging with no technology reads %', pg_temp.n112('db112-community', 'log');
  END IF;
  IF pg_temp.n112('db112-community', 'ok') IS DISTINCT FROM '{"id": "ok", "type": "backend-service", "label": "API", "technology": "nodejs"}'::jsonb
     OR pg_temp.n112('db112-community', 'other') IS DISTINCT FROM '{"id": "other", "type": "backend-service", "label": "Their own", "technology": "db112-not-in-catalog"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: a sound node or one with a technology the catalog lacks changed';
  END IF;
  IF pg_temp.n112('db112-official', 'ecs') IS DISTINCT FROM '{"id": "ecs", "type": "ecs-cluster", "label": "ECS Cluster", "technology": "aws-ecs", "parentId": "cloud"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: "aws" on an ECS Cluster reads %', pg_temp.n112('db112-official', 'ecs');
  END IF;
  IF pg_temp.n112('db112-official', 'cloud') IS DISTINCT FROM '{"id": "cloud", "type": "aws", "label": "AWS", "technology": "aws"}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 112: the AWS container changed';
  END IF;

  SELECT string_agg(s.slug, ', ') INTO bad
  FROM lane112_shipped s JOIN public.project_templates t USING (slug)
  WHERE t.graph_data IS DISTINCT FROM s.graph_data OR t.updated_at IS DISTINCT FROM s.updated_at;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 112: a shipped template changed: %', bad; END IF;
END $$;

CREATE TEMP TABLE lane112_first AS
  SELECT slug, graph_data, updated_at FROM public.project_templates WHERE slug LIKE 'db112-%';
\ir ../../supabase/migrations/20260928115000_v3_release_app_made_templates.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM lane112_first f JOIN public.project_templates t USING (slug)
             WHERE t.graph_data IS DISTINCT FROM f.graph_data OR t.updated_at IS DISTINCT FROM f.updated_at) THEN
    RAISE EXCEPTION 'db-lane 112: the replay changed a template';
  END IF;
END $$;

-- a node on a type with no live successor and no technology to find one by
SAVEPOINT no_successor;
INSERT INTO public.project_templates (slug, name, author_type, graph_data) VALUES
  ('db112-no-successor', 'db-lane 112 no successor', 'community',
   pg_temp.g112('{"x": {"id": "x", "type": "db112-no-such-type", "label": "Mystery"}}'::jsonb));
\set ON_ERROR_STOP off
\set VERBOSITY terse
\ir ../../supabase/migrations/20260928115000_v3_release_app_made_templates.sql
\set ON_ERROR_STOP on
\set VERBOSITY default
ROLLBACK TO SAVEPOINT no_successor;
SELECT (:'LAST_ERROR_MESSAGE' LIKE '%no live successor: db112-no-successor: Mystery (db112-no-such-type)%') AS refused \gset
\if :refused
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-lane 112: a node with no live successor was not refused'; END $$;
\endif

-- an edge that ends on a container
SAVEPOINT on_container;
INSERT INTO public.project_templates (slug, name, author_type, graph_data) VALUES
  ('db112-on-container', 'db-lane 112 on container', 'community', pg_temp.g112('{
     "cloud": {"id": "cloud", "type": "aws",             "label": "AWS",    "technology": "aws"},
     "svc":   {"id": "svc",   "type": "backend-service", "label": "Orders", "technology": "nodejs"}
   }'::jsonb, '{"to-box": {"id": "to-box", "source": "svc", "target": "cloud"}}'::jsonb));
\set ON_ERROR_STOP off
\set VERBOSITY terse
\ir ../../supabase/migrations/20260928115000_v3_release_app_made_templates.sql
\set ON_ERROR_STOP on
\set VERBOSITY default
ROLLBACK TO SAVEPOINT on_container;
SELECT (:'LAST_ERROR_MESSAGE' LIKE '%end on a container: db112-on-container: to-box%') AS refused \gset
\if :refused
\else
  DO $$ BEGIN RAISE EXCEPTION 'db-lane 112: an edge ending on a container was not refused'; END $$;
\endif

DO $$ BEGIN RAISE NOTICE 'db-lane 112: retired types take the successor their technology takes, a gone type takes its technology''s live one, aws becomes aws-ecs, Godot leaves Shared Library, sound and unknown nodes and the shipped templates stand, the replay changes nothing, and a node with no successor or an edge on a container is refused by name'; END $$;

ROLLBACK;
