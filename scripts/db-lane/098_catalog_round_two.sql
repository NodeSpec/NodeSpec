-- db-lane 098: the catalog's shape, round two (V3 AG.10, AG.11a, AG.11b, AG.11c's layers;
-- owner 2026-09-28).
--
--   The migration runs here, twice, on a database with a project whose nodes sit on the
--   types it retires and hold values typed into the fields it removes:
--   - the fourteen retired and folded types are deprecated, no technology and no
--     deployment target names them, every container still holds them where it did, and a
--     container or target that listed a folded type also lists what took it;
--   - every technology keeps a live type, and the moved rows drop as the type they fit
--     with no picker (RabbitMQ a Message Queue, Kafka an Event Stream or Pub/Sub, Neo4j a
--     Database, LangChain an AI Agent Service, GitHub Actions a CI/CD Pipeline);
--   - import places the backing services where the board says (RabbitMQ, Amazon MQ and
--     Service Bus on Message Queue; Neo4j, Neptune, InfluxDB and Timestream on Database);
--   - no type field asks a deployment detail, and the four choices are choices whose
--     default is one of their options;
--   - Network Connection is a live leaf that a VPC and a subnet may hold, and the eight
--     network links drop as it alone;
--   - the managed runtimes are hosts on the Container or App Runtime, which may hold what
--     they run;
--   - a container that runs what it holds is on runtime or orchestration, one that places
--     it is on infrastructure (the networks and the cloud accounts), one that groups it is
--     logical;
--   - every template node is on a live type its technology takes;
--   - the labels and the guidance say what each type now is;
--   - nothing a node stored changes, and replaying the migration changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- May a parent of role p hold a child of role c? The rule canContain applies
-- (core/src/container-types.ts), as in lanes 094 and 095.
CREATE FUNCTION pg_temp.may_hold(p text, c text) RETURNS boolean LANGUAGE sql AS $$
  SELECT CASE jsonb_typeof(pr.can_contain)
    WHEN 'array' THEN pr.can_contain ? c
    ELSE coalesce(pr.can_contain -> 'roleIds', '[]') ? c
      OR coalesce(pr.can_contain -> 'natures', '[]') ? cr.nature
      OR coalesce(pr.can_contain -> 'interfaceKinds', '[]') ? cr.interface_kind
    END
  FROM public.node_roles pr, public.node_roles cr WHERE pr.id = p AND cr.id = c;
$$;

-- The live leaf roles a technology may drop as (what decides whether a drop asks).
CREATE FUNCTION pg_temp.drop_roles(t text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY ord), '[]'::jsonb)
  FROM public.technology_catalog c, jsonb_array_elements_text(c.role_affinities) WITH ORDINALITY x(r, ord)
  JOIN public.node_roles n ON n.id = x.r AND NOT n.deprecated AND NOT n.is_container
  WHERE c.id = t;
$$;

DO $$
BEGIN
  IF to_regclass('public.node_roles') IS NULL OR to_regprocedure('public.assert_role_affinities_resolve()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 098: the catalog tables or their affinity trigger are missing. Apply migration 20260731190000 and the catalog migrations before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'ml-pipeline' AND label = 'Data or ML Pipeline') THEN
    RAISE EXCEPTION 'db-lane 098: the first catalog shape pass is missing. Apply migration 20260928130000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db980000-0000-4000-8000-000000000001', 'db-lane-098-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db980000-0000-4000-8000-000000000010', 'db-lane 098', 'db980000-0000-4000-8000-000000000001');
  INSERT INTO public.branches (id, project_id, name, is_primary) VALUES
    ('db980000-0000-4000-8000-000000000011', 'db980000-0000-4000-8000-000000000010', 'main', true);
  -- nodes on the types this migration retires, and values in the fields it removes
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash) VALUES
    ('db980000-0000-4000-8000-000000000010', 'db980000-0000-4000-8000-000000000011',
     '{"id": "g98", "schemaVersion": 8, "version": 1, "hash": "db98-hash", "edges": {}, "contracts": {}, "artifacts": {},
       "nodes": {
         "v1": {"id": "v1", "type": "virtual-machine", "metadata": {}},
         "b1": {"id": "b1", "type": "message-broker", "technology": "rabbitmq"},
         "g1": {"id": "g1", "type": "graph-db", "technology": "neo4j", "metadata": {"config": {"host": "graph.internal", "port": 7687}}},
         "d1": {"id": "d1", "type": "database", "technology": "postgresql",
                "metadata": {"config": {"host": "db.internal", "port": 5432, "engine": "PostgreSQL 16", "replication": "primary-replica"}}},
         "f1": {"id": "f1", "type": "serverless-function", "technology": "aws-lambda",
                "metadata": {"config": {"runtime": "nodejs20.x", "handler": "index.handler", "timeout": 30}}},
         "w1": {"id": "w1", "type": "webhook-handler", "technology": "nodejs"}}}'::jsonb, 'db98-hash');
END $$;

CREATE TEMP TABLE lane_098_graph AS
  SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db980000-0000-4000-8000-000000000010';
CREATE TEMP TABLE lane_098_before AS
  SELECT id, can_contain FROM public.node_roles;
CREATE TEMP TABLE lane_098_targets_before AS
  SELECT id, compatible_roles FROM public.deployment_targets;

\ir ../../supabase/migrations/20260928160000_v3_catalog_round_two.sql

CREATE TEMP TABLE lane_098_after_one AS
  SELECT (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r) AS roles,
         (SELECT jsonb_agg(jsonb_build_array(id, role_affinities, ai_context, metadata_schema) ORDER BY id) FROM public.technology_catalog) AS techs,
         (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets) AS targets,
         (SELECT jsonb_agg(graph_data ORDER BY slug) FROM public.project_templates) AS templates;

\ir ../../supabase/migrations/20260928160000_v3_catalog_round_two.sql

-- ── 1. replaying changes nothing, and nothing a node stored changes ───────────
DO $$
BEGIN
  IF (SELECT roles FROM lane_098_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r)
     OR (SELECT techs FROM lane_098_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(jsonb_build_array(id, role_affinities, ai_context, metadata_schema) ORDER BY id) FROM public.technology_catalog)
     OR (SELECT targets FROM lane_098_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets)
     OR (SELECT templates FROM lane_098_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(graph_data ORDER BY slug) FROM public.project_templates) THEN
    RAISE EXCEPTION 'db-lane 098: replaying the migration changed the catalog or a template';
  END IF;
  IF (SELECT graph_data FROM lane_098_graph) IS DISTINCT FROM
     (SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db980000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 098: a node''s stored type or values changed';
  END IF;
END $$;

-- ── 2. AG.10: retired and folded types ────────────────────────────────────────
DO $$
DECLARE
  bad text;
  gone text[] := ARRAY['webhook-handler', 'model-registry', 'external-data', 'sensor', 'actuator',
                       'graph-db', 'time-series-db', 'event-store', 'feature-store', 'logging',
                       'message-broker', 'key-management', 'certificate-manager', 'network-firewall'];
BEGIN
  SELECT string_agg(g, ', ') INTO bad FROM unnest(gone) g
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = g AND deprecated);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: not retired: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM public.technology_catalog WHERE role_affinities ?| gone;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: technolog(ies) still take a retired type: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM public.deployment_targets WHERE compatible_roles ?| gone;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: deployment target(s) still list a retired type: %', bad; END IF;

  -- every container still holds what it held (existing nesting stays valid)
  SELECT string_agg(b.id, ', ') INTO bad FROM lane_098_before b JOIN public.node_roles r USING (id)
  WHERE jsonb_typeof(b.can_contain) = 'array' AND NOT r.can_contain @> b.can_contain;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: container(s) that stopped holding something: %', bad; END IF;

  -- a container or target that listed a folded type lists what took it
  SELECT string_agg(r.id || ':' || s.succ, ', ') INTO bad
  FROM lane_098_before b JOIN public.node_roles r USING (id),
       (VALUES ('graph-db', 'database'), ('time-series-db', 'database'), ('event-store', 'database'),
               ('feature-store', 'ml-pipeline'), ('logging', 'monitoring'), ('message-broker', 'queue'),
               ('message-broker', 'event-stream'), ('key-management', 'secret-manager'),
               ('certificate-manager', 'secret-manager'), ('network-firewall', 'waf')) s(folded, succ)
  WHERE jsonb_typeof(b.can_contain) = 'array' AND b.can_contain ? s.folded AND NOT r.can_contain ? s.succ;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: a folded type''s successor is missing: %', bad; END IF;
  SELECT string_agg(t.id, ', ') INTO bad
  FROM lane_098_targets_before b JOIN public.deployment_targets t USING (id)
  WHERE b.compatible_roles ? 'message-broker' AND NOT t.compatible_roles ?& ARRAY['queue', 'event-stream'];
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: target(s) that ran a broker now run no queue or stream: %', bad; END IF;

  -- no technology is left without a live type
  SELECT string_agg(t.id, ', ') INTO bad FROM public.technology_catalog t
  WHERE jsonb_array_length(coalesce(t.role_affinities, '[]'::jsonb)) > 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.role_affinities) x(r)
                    JOIN public.node_roles n ON n.id = x.r AND NOT n.deprecated);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: technolog(ies) with no live type: %', bad; END IF;

  -- the moved rows drop as the type they fit, with no picker
  SELECT string_agg(v.t || ' drops as ' || pg_temp.drop_roles(v.t)::text, ', ') INTO bad
  FROM (VALUES ('rabbitmq', '["queue"]'), ('aws-amazon-mq', '["queue"]'), ('azure-service-bus', '["queue"]'),
               ('kafka', '["event-stream"]'), ('aws-sns', '["event-stream"]'), ('azure-event-grid', '["event-stream"]'),
               ('neo4j', '["database"]'), ('influxdb', '["database"]'), ('eventstoredb', '["database"]'),
               ('feast', '["ml-pipeline"]'), ('mlflow', '["ml-pipeline"]'),
               ('langchain', '["ai-agent-service"]'), ('langgraph', '["ai-agent-service"]'),
               ('github-actions', '["ci-cd-pipeline"]'), ('apache-airflow', '["ml-pipeline"]'),
               ('trivy', '["ci-cd-pipeline"]'), ('crossplane', '["iac-workflow"]'),
               ('kong', '["api-gateway"]'), ('posthog', '["external-service"]'),
               ('aws-cloudtrail', '["monitoring"]'), ('aws-cloudwatch', '["monitoring"]'),
               ('aws-kms', '["secret-manager"]'), ('aws-certificate-manager', '["secret-manager"]'),
               ('aws-network-firewall', '["waf"]'), ('gcp-filestore', '["file-share"]'),
               ('aws-fargate', '[]')) v(t, want)
  WHERE pg_temp.drop_roles(v.t) IS DISTINCT FROM v.want::jsonb;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: %', bad; END IF;
  -- a timer is still a Scheduled Trigger
  IF NOT (SELECT role_affinities ? 'scheduled-trigger' FROM public.technology_catalog WHERE id = 'k8s-cronjob') THEN
    RAISE EXCEPTION 'db-lane 098: a timer left Scheduled Trigger';
  END IF;

  -- import places the backing services where the board says: by the first affinity
  SELECT string_agg(v.t || ' places on ' || coalesce(c.role_affinities ->> 0, 'nothing'), ', ') INTO bad
  FROM (VALUES ('rabbitmq', 'queue'), ('aws-amazon-mq', 'queue'), ('azure-service-bus', 'queue'),
               ('neo4j', 'database'), ('aws-neptune', 'database'), ('influxdb', 'database'),
               ('aws-timestream', 'database'), ('kafka', 'event-stream'), ('redis', 'cache')) v(t, want)
  LEFT JOIN public.technology_catalog c ON c.id = v.t
  WHERE c.role_affinities ->> 0 IS DISTINCT FROM v.want;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: %', bad; END IF;
END $$;

-- ── 3. AG.10: type fields ask architecture questions ─────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(r.id || '.' || f, ', ') INTO bad
  FROM public.node_roles r, unnest(ARRAY['host', 'port', 'engine', 'tables', 'runtime', 'handler',
                                         'environment', 'implementation', 'region']) f
  WHERE r.id IN ('database', 'cache', 'search-engine', 'vector-database', 'serverless-function',
                 'service-mesh', 'object-storage') AND r.metadata_schema ? f;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: field(s) still asked: %', bad; END IF;

  SELECT string_agg(v.id || '.' || v.f, ', ') INTO bad
  FROM (VALUES ('database', 'replication'), ('cache', 'evictionPolicy'),
               ('vector-database', 'distanceMetric'), ('service-mesh', 'loadBalancing')) v(id, f)
  JOIN public.node_roles r ON r.id = v.id
  WHERE r.metadata_schema #>> ARRAY[v.f, 'type'] IS DISTINCT FROM 'enum'
     OR NOT (r.metadata_schema #> ARRAY[v.f, 'options']) ? (r.metadata_schema #>> ARRAY[v.f, 'default']);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: not a choice with a valid default: %', bad; END IF;

  -- what the fields were for is still asked: timeout and memory, triggers, buckets, the dimension
  SELECT string_agg(v.id || '.' || v.f, ', ') INTO bad
  FROM (VALUES ('serverless-function', 'timeout'), ('serverless-function', 'memorySize'),
               ('serverless-function', 'triggers'), ('object-storage', 'buckets'),
               ('vector-database', 'embeddingDimension'), ('cache', 'persistence')) v(id, f)
  JOIN public.node_roles r ON r.id = v.id
  WHERE NOT r.metadata_schema ? v.f;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: an architecture field went: %', bad; END IF;
  IF (SELECT metadata_schema #>> '{embeddingDimension,description}' FROM public.node_roles WHERE id = 'vector-database') ILIKE '%ada%' THEN
    RAISE EXCEPTION 'db-lane 098: the dimension example still names a retired model';
  END IF;
END $$;

-- ── 4. AG.11a and AG.11b ─────────────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF NOT pg_temp.may_hold('vpc', 'network-connection') OR NOT pg_temp.may_hold('subnet', 'network-connection') THEN
    RAISE EXCEPTION 'db-lane 098: a VPC or a subnet may not hold a Network Connection';
  END IF;
  -- a cloud account admits it by its nature and interface, as it admits any leaf
  IF NOT pg_temp.may_hold('aws', 'network-connection') THEN
    RAISE EXCEPTION 'db-lane 098: the AWS account may not hold a Network Connection';
  END IF;
  SELECT string_agg(t || ' drops as ' || pg_temp.drop_roles(t)::text, ', ') INTO bad
  FROM unnest(ARRAY['aws-direct-connect', 'aws-site-to-site-vpn', 'aws-transit-gateway', 'aws-privatelink',
                    'gcp-cloud-interconnect', 'gcp-cloud-nat', 'gcp-cloud-vpn', 'gcp-private-service-connect']) t
  WHERE pg_temp.drop_roles(t) IS DISTINCT FROM '["network-connection"]'::jsonb;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM public.technology_catalog
  WHERE id IN ('gcp-app-engine', 'aws-elastic-beanstalk', 'azure-app-service', 'aws-amplify-hosting',
               'azure-static-web-apps', 'aws-gamelift', 'aws-batch', 'azure-batch', 'gcp-batch', 'aws-app-runner')
    AND role_affinities IS DISTINCT FROM '["docker-container"]'::jsonb;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: runtime(s) not a host: %', bad; END IF;
  SELECT string_agg(c, ', ') INTO bad
  FROM unnest(ARRAY['backend-service', 'frontend-app', 'worker', 'game-server']) c
  WHERE NOT pg_temp.may_hold('docker-container', c);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: the runtime may not hold %', bad; END IF;
  IF (SELECT label FROM public.node_roles WHERE id = 'docker-container') IS DISTINCT FROM 'Container or App Runtime' THEN
    RAISE EXCEPTION 'db-lane 098: the runtime is not labelled Container or App Runtime';
  END IF;
END $$;

-- ── 5. AG.11c: the layer says how a container holds ──────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id || ' on ' || coalesce(container_layer, 'nothing'), ', ') INTO bad FROM public.node_roles
  WHERE id IN ('virtual-machine', 'hypervisor', 'robot', 'gateway-device', 'docker-container', 'desktop-device',
               'mobile-device', 'edge-device', 'fly-io', 'netlify', 'railway', 'render', 'vercel')
    AND container_layer IS DISTINCT FROM 'runtime';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: container(s) that run what they hold: %', bad; END IF;
  SELECT string_agg(id, ', ' ORDER BY id) INTO bad FROM public.node_roles
  WHERE is_container AND NOT deprecated AND container_layer = 'infrastructure'
    AND id <> ALL (ARRAY['vpc', 'subnet', 'aws', 'azure', 'gcp', 'cloudflare', 'supabase']);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: container(s) that run what they hold, left on infrastructure: %', bad; END IF;
  SELECT string_agg(id, ', ' ORDER BY id) INTO bad FROM public.node_roles
  WHERE is_container AND NOT deprecated AND container_layer IS DISTINCT FROM 'orchestration'
    AND id IN ('docker-compose', 'docker-swarm', 'ecs-cluster', 'k8s-cluster', 'k8s-namespace');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: orchestrator(s) moved: %', bad; END IF;
END $$;

-- ── 6. templates and text ─────────────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.slug || ':' || (v ->> 'label'), ', ') INTO bad
  FROM public.project_templates t, jsonb_each(t.graph_data -> 'nodes') e(k, v)
  LEFT JOIN public.node_roles r ON r.id = v ->> 'type'
  LEFT JOIN public.technology_catalog c ON c.id = v ->> 'technology'
  WHERE r.id IS NULL OR r.deprecated OR (v ->> 'technology' IS NOT NULL AND NOT coalesce(c.role_affinities ? (v ->> 'type'), false));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: template node(s) on no live type their technology takes: %', bad; END IF;
  IF (SELECT graph_data #>> '{nodes,b1000000-0000-4000-8000-000000000003,type}' FROM public.project_templates
      WHERE slug = 'supabase-gitops-pipeline') IS DISTINCT FROM 'ci-cd-pipeline' THEN
    RAISE EXCEPTION 'db-lane 098: the nightly drift workflow is not a CI/CD Pipeline';
  END IF;

  SELECT string_agg(id, ', ') INTO bad FROM public.node_roles
  WHERE (id, label) IN (('monitoring', 'Monitoring'), ('event-stream', 'Event Stream'), ('waf', 'WAF'), ('docker-container', 'Docker Container'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: old label(s) on %', bad; END IF;
  IF (SELECT when_to_use FROM public.node_roles WHERE id = 'auth-provider') NOT ILIKE '%signing your users in%'
     OR (SELECT when_to_use FROM public.node_roles WHERE id = 'auth-provider') NOT ILIKE '%IAM%' THEN
    RAISE EXCEPTION 'db-lane 098: Auth Provider does not name both jobs';
  END IF;
  IF (SELECT when_to_use FROM public.node_roles WHERE id = 'iac-workflow') ~* 'flyway|liquibase' THEN
    RAISE EXCEPTION 'db-lane 098: IaC Workflow still offers itself for schema migrations';
  END IF;
  IF (SELECT split_part(description, '.', 1) FROM public.node_roles WHERE id = 'event-stream') NOT ILIKE '%topic%' THEN
    RAISE EXCEPTION 'db-lane 098: Event Stream''s first sentence does not cover topics';
  END IF;
  SELECT string_agg(id, ', ') INTO bad FROM public.node_roles
  WHERE id IN ('webhook-handler', 'message-broker', 'logging', 'sensor') AND when_to_use NOT LIKE 'Not for new work:%';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 098: retired type(s) that do not say so: %', bad; END IF;

  RAISE NOTICE 'db-lane 098: fourteen types retired with their work taken, every technology on a live type and dropping without a picker where named, backing services placed as planned, fields are architecture, Network Connection and the runtime hosts in place, layers say how a container holds, templates resolve, nothing a node stored changes, replay changes nothing';
END $$;

ROLLBACK;
