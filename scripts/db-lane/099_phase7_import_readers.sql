-- db-lane 099: the catalog rows import's phase 7 readers need, and Mobile Device's
-- containment fix (V3 AF.4, AG.10's ROS 2 ruling, AG.11e; owner 2026-09-28).
--
--   The migration runs here, twice, on a database with a project whose phone holds a
--   sensor:
--   - Mobile Device holds neither Sensor nor Actuator, keeps everything else it held, and
--     no container lists a retired type with no live type of its category in its place;
--     the stored phone and sensor are left as they were;
--   - Swift (macOS) and ROS 2 each drop as their one type with no picker, carry the
--     task packet's mode (code for the Mac app, unset for the ROS 2 framework), a purpose
--     that says when not to choose them, and choices whose default is one of their
--     options and none of which is a version; ROS 2's client library is a choice of
--     rclcpp and rclpy;
--   - every role and technology import's tables name is live and takes the type import
--     draws it as (the drift report, in SQL): the app manifests, the language floor,
--     the managed runtimes on the Container or App Runtime, the network links on Network
--     Connection inside a VPC, the runtime languages;
--   - the index defaults to extractor version 5, so indexed repositories are read again;
--   - replaying the migration changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- May a parent of role p hold a child of role c? The rule canContain applies
-- (core/src/container-types.ts), as in lanes 094, 095 and 098.
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
    RAISE EXCEPTION 'db-lane 099: the catalog tables or their affinity trigger are missing. Apply migration 20260731190000 and the catalog migrations before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'docker-container' AND label = 'Container or App Runtime')
     OR NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'network-connection') THEN
    RAISE EXCEPTION 'db-lane 099: the catalog round two is missing. Apply migration 20260928160000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db990000-0000-4000-8000-000000000001', 'db-lane-099-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db990000-0000-4000-8000-000000000010', 'db-lane 099', 'db990000-0000-4000-8000-000000000001');
  INSERT INTO public.branches (id, project_id, name, is_primary) VALUES
    ('db990000-0000-4000-8000-000000000011', 'db990000-0000-4000-8000-000000000010', 'main', true);
  -- a phone holding a sensor, as a project drew it before the fix
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash) VALUES
    ('db990000-0000-4000-8000-000000000010', 'db990000-0000-4000-8000-000000000011',
     '{"id": "g99", "schemaVersion": 8, "version": 1, "hash": "db99-hash", "edges": {}, "contracts": {}, "artifacts": {},
       "nodes": {
         "p1": {"id": "p1", "type": "mobile-device", "label": "Phone"},
         "s1": {"id": "s1", "type": "sensor", "label": "Step counter", "parentId": "p1", "placementKind": "hosts"}}}'::jsonb, 'db99-hash');
END $$;

CREATE TEMP TABLE lane_099_graph AS
  SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db990000-0000-4000-8000-000000000010';
CREATE TEMP TABLE lane_099_phone_before AS
  SELECT can_contain FROM public.node_roles WHERE id = 'mobile-device';

\ir ../../supabase/migrations/20260928170000_v3_phase7_import_readers.sql

CREATE TEMP TABLE lane_099_after_one AS
  SELECT (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r) AS roles,
         (SELECT jsonb_agg(jsonb_build_array(id, name, role_affinities, ai_context, metadata_schema, suggested_files, common_connections) ORDER BY id)
            FROM public.technology_catalog) AS techs;

\ir ../../supabase/migrations/20260928170000_v3_phase7_import_readers.sql

-- ── 1. replaying changes nothing, and nothing a project stored changes ────────
DO $$
BEGIN
  IF (SELECT roles FROM lane_099_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r)
     OR (SELECT techs FROM lane_099_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(jsonb_build_array(id, name, role_affinities, ai_context, metadata_schema, suggested_files, common_connections) ORDER BY id)
          FROM public.technology_catalog) THEN
    RAISE EXCEPTION 'db-lane 099: replaying the migration changed the catalog';
  END IF;
  IF (SELECT graph_data FROM lane_099_graph) IS DISTINCT FROM
     (SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db990000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 099: a stored node changed';
  END IF;
END $$;

-- ── 2. AG.11e: a phone holds no sensor or actuator ────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF pg_temp.may_hold('mobile-device', 'sensor') OR pg_temp.may_hold('mobile-device', 'actuator') THEN
    RAISE EXCEPTION 'db-lane 099: a Mobile Device may still hold a Sensor or an Actuator';
  END IF;
  -- everything else it held, it holds, in the same order
  IF (SELECT coalesce(jsonb_agg(x ORDER BY o), '[]') FROM lane_099_phone_before b,
        jsonb_array_elements(b.can_contain) WITH ORDINALITY e(x, o) WHERE x #>> '{}' NOT IN ('sensor', 'actuator'))
     IS DISTINCT FROM (SELECT can_contain FROM public.node_roles WHERE id = 'mobile-device') THEN
    RAISE EXCEPTION 'db-lane 099: Mobile Device lost or reordered a type it held';
  END IF;
  IF NOT (pg_temp.may_hold('mobile-device', 'mobile-app') AND pg_temp.may_hold('mobile-device', 'game-client')) THEN
    RAISE EXCEPTION 'db-lane 099: a Mobile Device no longer holds its apps';
  END IF;
  -- the containment audit's error rule: no list keeps a retired type without a live one of its category
  SELECT string_agg(DISTINCT c.id || ':' || t.id, ', ') INTO bad
  FROM public.node_roles c
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE jsonb_typeof(c.can_contain) WHEN 'array' THEN c.can_contain ELSE coalesce(c.can_contain -> 'roleIds', '[]') END) ref(v)
  JOIN public.node_roles t ON t.id = ref.v AND t.deprecated
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles live
                    WHERE NOT live.deprecated AND live.id <> t.id AND live.palette_category = t.palette_category
                      AND pg_temp.may_hold(c.id, live.id));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 099: retired type(s) listed with no live type in their place: %', bad; END IF;
END $$;

-- ── 3. AF.4a and the ROS 2 ruling: two rows, each on its one type ─────────────
DO $$
DECLARE r record; bad text;
BEGIN
  IF pg_temp.drop_roles('swift-macos') <> '["desktop-app"]' OR pg_temp.drop_roles('ros2') <> '["ros2-node"]' THEN
    RAISE EXCEPTION 'db-lane 099: a new row does not drop as its one type with no picker (%, %)', pg_temp.drop_roles('swift-macos'), pg_temp.drop_roles('ros2');
  END IF;
  IF (SELECT name FROM public.technology_catalog WHERE id = 'swift-macos') <> 'Swift (macOS)' THEN
    RAISE EXCEPTION 'db-lane 099: the Mac row is not named Swift (macOS)';
  END IF;
  IF (SELECT ai_context ->> 'configMode' FROM public.technology_catalog WHERE id = 'swift-macos') IS DISTINCT FROM 'code'
     OR (SELECT ai_context ? 'configMode' FROM public.technology_catalog WHERE id = 'ros2') THEN
    RAISE EXCEPTION 'db-lane 099: the packet mode is code for the Mac app and unset for the ROS 2 framework';
  END IF;
  FOR r IN SELECT id, ai_context, metadata_schema FROM public.technology_catalog WHERE id IN ('swift-macos', 'ros2') LOOP
    IF r.ai_context ->> 'purpose' NOT LIKE '%Do not choose%' THEN RAISE EXCEPTION 'db-lane 099: % gives no reason not to choose it', r.id; END IF;
    IF r.ai_context #>> '{provenance,method}' NOT IN ('model-knowledge', 'live-docs') THEN RAISE EXCEPTION 'db-lane 099: % has no provenance', r.id; END IF;
    SELECT string_agg(f.key, ', ') INTO bad FROM jsonb_each(r.metadata_schema) f(key, v)
    WHERE f.v ->> 'type' NOT IN ('enum', 'multiselect', 'boolean')
       OR (f.v ->> 'type' = 'enum' AND NOT (f.v -> 'options') ? (f.v ->> 'default'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(f.v -> 'options', '[]')) o WHERE o ~ '\d');
    IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 099: % field(s) % are not choices, default off their options, or name a version', r.id, bad; END IF;
  END LOOP;
  IF (SELECT metadata_schema #> '{clientLibrary,options}' FROM public.technology_catalog WHERE id = 'ros2') IS DISTINCT FROM '["rclcpp", "rclpy"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 099: ROS 2''s client library is not a choice of rclcpp and rclpy';
  END IF;
END $$;

-- ── 4. what import names is live and takes the type import draws (the drift report) ──
DO $$
DECLARE bad text;
BEGIN
  -- roles by family and host family
  SELECT string_agg(x.id, ', ') INTO bad FROM (VALUES
    ('desktop-app', false), ('mobile-app', false), ('firmware-service', false), ('ros2-node', false), ('network-connection', false),
    ('desktop-device', true), ('mobile-device', true), ('edge-device', true), ('docker-container', true), ('vpc', true)) x(id, host)
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles r WHERE r.id = x.id AND NOT r.deprecated AND r.is_container = x.host
                      AND (NOT x.host OR r.container_style = 'hosting'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 099: import family type(s) missing, retired or of the wrong kind: %', bad; END IF;
  -- each host may hold what import puts in it
  SELECT string_agg(p || '>' || c, ', ') INTO bad FROM (VALUES
    ('desktop-device', 'desktop-app'), ('mobile-device', 'mobile-app'), ('edge-device', 'ros2-node'), ('edge-device', 'firmware-service'),
    ('docker-container', 'backend-service'), ('docker-container', 'worker'), ('docker-container', 'frontend-app'), ('vpc', 'network-connection')) x(p, c)
  WHERE NOT pg_temp.may_hold(p, c);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 099: a host may not hold what import puts in it: %', bad; END IF;
  -- each technology import names takes the type it names it for
  SELECT string_agg(t || ' on ' || r, ', ') INTO bad FROM (VALUES
    ('swift-macos', 'desktop-app'), ('swift-ios', 'mobile-app'), ('wpf', 'desktop-app'), ('dotnet-maui', 'desktop-app'), ('ros2', 'ros2-node'),
    ('c-systems', 'shared-library'), ('cpp-backend', 'backend-service'), ('go-backend', 'backend-service'), ('rust-backend', 'backend-service'),
    ('nodejs', 'backend-service'), ('python-backend', 'backend-service'), ('java-backend', 'backend-service'), ('php-backend', 'backend-service'),
    ('ruby-backend', 'backend-service'),
    ('gcp-app-engine', 'docker-container'), ('aws-app-runner', 'docker-container'), ('aws-elastic-beanstalk', 'docker-container'),
    ('gcp-cloud-run', 'docker-container'), ('azure-app-service', 'docker-container'), ('azure-static-web-apps', 'docker-container'),
    ('aws-amplify-hosting', 'docker-container'),
    ('aws-site-to-site-vpn', 'network-connection'), ('aws-direct-connect', 'network-connection'), ('aws-transit-gateway', 'network-connection'),
    ('aws-privatelink', 'network-connection'), ('gcp-cloud-vpn', 'network-connection'), ('gcp-cloud-nat', 'network-connection'),
    ('gcp-cloud-interconnect', 'network-connection'), ('gcp-private-service-connect', 'network-connection'),
    ('aws-vpc', 'vpc'), ('gcp-vpc', 'vpc'), ('azure-vnet', 'vpc')) x(t, r)
  WHERE NOT EXISTS (SELECT 1 FROM public.technology_catalog c WHERE c.id = x.t AND NOT c.is_user_contributed AND c.role_affinities ? x.r);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 099: technolog(ies) import names that the catalog lacks or files elsewhere: %', bad; END IF;
  -- the deployment targets import sets take the types it sets them on
  SELECT string_agg(t || ':' || r, ', ') INTO bad FROM (VALUES
    ('embedded', 'ros2-node'), ('desktop-native', 'desktop-app'), ('mobile-device', 'mobile-app'), ('container', 'backend-service'),
    ('static-hosting', 'frontend-app')) x(t, r)
  WHERE NOT EXISTS (SELECT 1 FROM public.deployment_targets d WHERE d.id = x.t AND d.compatible_roles ? x.r);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 099: deployment target(s) that do not take what import sets: %', bad; END IF;
END $$;

-- ── 5. AF.4: indexed repositories are read again ───────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(table_name || '=' || coalesce(column_default, 'none'), ', ') INTO bad FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'extractor_version' AND table_name IN ('repo_index', 'import_job_files')
    AND column_default IS DISTINCT FROM '5';
  IF bad IS NOT NULL OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
                           AND column_name = 'extractor_version' AND table_name IN ('repo_index', 'import_job_files')) <> 2 THEN
    RAISE EXCEPTION 'db-lane 099: the index does not default to extractor version 5 (%)', bad;
  END IF;

  RAISE NOTICE 'db-lane 099: a phone holds no sensor or actuator and keeps its apps, Swift (macOS) and ROS 2 drop as their one type with the right packet mode and choices, every type and technology import names is live where import draws it, the index reads again at version 5, replay changes nothing';
END $$;

ROLLBACK;
