-- db-lane 095: the catalog's shape (V3 AF.1, AF.2, AF.3, AG.4, AG.5, AG.7; owner 2026-09-28).
--
--   The migration runs here, twice, on a database with a project whose nodes hold values
--   typed into the old free-text fields:
--   - Unity, Godot and Unreal each have one live leaf role, Game Client, so a drop needs no
--     picker; a Mobile Device and a Desktop Device may hold a game;
--   - Desktop Application no longer asks for a framework, and its platforms are three ticks;
--   - every field on the three device hosts is a choice, an enum's default is one of its
--     options, a multiselect has no default, and none is a version;
--   - Microcontroller, Embedded Device and Embedded System are retired, no technology takes
--     them, an Edge Device still holds what it held, and no deployment target lists a
--     retired role (the rule lane 079 holds; import prints the list to the agent);
--   - the pipeline role reads "Data or ML Pipeline";
--   - the VPC products are VPCs only, with `vpc` still first, and Subnet is still a host;
--   - nothing a node stored changes, and replaying the migration changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- May a parent of role p hold a child of role c carrying technology t? The rule canContain
-- applies (core/src/container-types.ts), as in lane 094.
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

-- The live leaf roles a technology may drop as (what decides whether a drop asks).
CREATE FUNCTION pg_temp.drop_roles(t text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY ord), '[]'::jsonb)
  FROM public.technology_catalog c, jsonb_array_elements_text(c.role_affinities) WITH ORDINALITY x(r, ord)
  JOIN public.node_roles n ON n.id = x.r AND NOT n.deprecated AND NOT n.is_container
  WHERE c.id = t;
$$;

DO $$
BEGIN
  IF to_regclass('public.node_roles') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id IN ('desktop-device', 'edge-device')) THEN
    RAISE EXCEPTION 'db-lane 095: the device hosts are missing. Apply migration 20260925190000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db950000-0000-4000-8000-000000000001', 'db-lane-095-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db950000-0000-4000-8000-000000000010', 'db-lane 095', 'db950000-0000-4000-8000-000000000001');
  INSERT INTO public.branches (id, project_id, name, is_primary) VALUES
    ('db950000-0000-4000-8000-000000000011', 'db950000-0000-4000-8000-000000000010', 'main', true);
  -- values typed into the old free-text fields, and a node on a type this migration retires
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash) VALUES
    ('db950000-0000-4000-8000-000000000010', 'db950000-0000-4000-8000-000000000011',
     '{"id": "g95", "schemaVersion": 8, "version": 1, "hash": "db95-hash", "edges": {}, "contracts": {}, "artifacts": {},
       "nodes": {
         "d1": {"id": "d1", "type": "desktop-device", "metadata": {"config": {"platform": "Windows 11", "installMethod": "msi"}}},
         "a1": {"id": "a1", "type": "desktop-app", "technology": "electron", "parentId": "d1",
                "metadata": {"config": {"framework": "electron", "platforms": "windows, macos"}}},
         "m1": {"id": "m1", "type": "mobile-device", "metadata": {"config": {"osMinVersion": "16.0"}}},
         "u1": {"id": "u1", "type": "desktop-app", "technology": "unity"},
         "e1": {"id": "e1", "type": "edge-device"},
         "c1": {"id": "c1", "type": "microcontroller", "parentId": "e1"}}}'::jsonb, 'db95-hash');
END $$;

CREATE TEMP TABLE lane_095_graph AS
  SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db950000-0000-4000-8000-000000000010';

-- AG.11a (migration 20260928160000) moved PrivateLink and Private Service Connect to
-- Network Connection after this migration shipped: they go back on VPC for this
-- rolled-back transaction only, so the migration replays and verifies as it did then.
UPDATE public.technology_catalog SET role_affinities = '["vpc"]'::jsonb
WHERE id IN ('aws-privatelink', 'gcp-private-service-connect') AND role_affinities = '["network-connection"]'::jsonb;

\ir ../../supabase/migrations/20260928130000_v3_catalog_shape.sql

CREATE TEMP TABLE lane_095_after_one AS
  SELECT (SELECT jsonb_agg(jsonb_build_array(id, label, description, when_to_use, deprecated, can_contain, metadata_schema) ORDER BY id)
          FROM public.node_roles) AS roles,
         (SELECT jsonb_agg(jsonb_build_array(id, role_affinities, ai_context) ORDER BY id) FROM public.technology_catalog) AS techs,
         (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets) AS targets;

\ir ../../supabase/migrations/20260928130000_v3_catalog_shape.sql

-- ── 1. replaying changes nothing, and nothing a node stored changes ───────────
DO $$
BEGIN
  IF (SELECT roles FROM lane_095_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(jsonb_build_array(id, label, description, when_to_use, deprecated, can_contain, metadata_schema) ORDER BY id) FROM public.node_roles)
     OR (SELECT techs FROM lane_095_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(jsonb_build_array(id, role_affinities, ai_context) ORDER BY id) FROM public.technology_catalog)
     OR (SELECT targets FROM lane_095_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets) THEN
    RAISE EXCEPTION 'db-lane 095: replaying the migration changed something';
  END IF;
  IF (SELECT graph_data FROM lane_095_graph) IS DISTINCT FROM
     (SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db950000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 095: the migration changed a node a person made';
  END IF;
END $$;

-- ── 2. AF.1: a game engine is a game ───────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t || ' drops as ' || pg_temp.drop_roles(t)::text, '; ') INTO bad
  FROM unnest(ARRAY['unity', 'godot', 'unreal-engine']) t
  WHERE pg_temp.drop_roles(t) IS DISTINCT FROM '["game-client"]'::jsonb;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 095: a game engine is not Game Client alone: %', bad; END IF;
  IF NOT coalesce(pg_temp.may_hold('mobile-device', 'game-client', 'unity'), false) THEN
    RAISE EXCEPTION 'db-lane 095: a phone game cannot sit in its Mobile Device';
  END IF;
  IF NOT coalesce(pg_temp.may_hold('desktop-device', 'game-client', 'godot'), false) THEN
    RAISE EXCEPTION 'db-lane 095: a desktop game cannot sit in its Desktop Device';
  END IF;
  IF NOT (SELECT compatible_roles ? 'game-client' FROM public.deployment_targets WHERE id = 'mobile-device') THEN
    RAISE EXCEPTION 'db-lane 095: the mobile target no longer takes a game';
  END IF;
END $$;

-- ── 3. AF.2 and AF.3: the forms ask with choices ───────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF (SELECT metadata_schema ? 'framework' FROM public.node_roles WHERE id = 'desktop-app') THEN
    RAISE EXCEPTION 'db-lane 095: Desktop Application still asks for a framework';
  END IF;
  IF (SELECT metadata_schema -> 'platforms' ? 'default' FROM public.node_roles WHERE id = 'desktop-app')
     OR (SELECT metadata_schema #>> '{platforms,type}' FROM public.node_roles WHERE id = 'desktop-app') IS DISTINCT FROM 'multiselect'
     OR (SELECT metadata_schema #> '{platforms,options}' FROM public.node_roles WHERE id = 'desktop-app')
        IS DISTINCT FROM '["windows", "macos", "linux"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 095: Desktop Application''s platforms are not three ticks with none preset';
  END IF;

  SELECT string_agg(r.id || '.' || f.key || ' (' || coalesce(f.value ->> 'type', '?') || ')', '; ') INTO bad
  FROM public.node_roles r, jsonb_each(r.metadata_schema) f
  WHERE r.id IN ('desktop-device', 'mobile-device', 'edge-device')
    AND (f.value ->> 'type' NOT IN ('enum', 'multiselect', 'boolean')
      OR f.key ~* 'version'
      OR (f.value ->> 'type' IN ('enum', 'multiselect') AND jsonb_array_length(coalesce(f.value -> 'options', '[]')) = 0)
      OR (f.value ->> 'type' = 'enum' AND f.value ? 'default' AND NOT (f.value -> 'options') ? (f.value ->> 'default'))
      OR (f.value ->> 'type' = 'multiselect' AND f.value ? 'default'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 095: device host field(s) that are not a choice: %', bad; END IF;

  -- the three hosts still ask what the plan names
  IF (SELECT count(*) FROM public.node_roles r, jsonb_each(r.metadata_schema) f
      WHERE (r.id, f.key) IN (('desktop-device', 'platform'), ('desktop-device', 'installMethod'),
                              ('mobile-device', 'platform'), ('mobile-device', 'deviceCategory'),
                              ('edge-device', 'deviceClass'), ('edge-device', 'connectivity'))
        AND f.value ->> 'type' IN ('enum', 'multiselect')) <> 6 THEN
    RAISE EXCEPTION 'db-lane 095: a device host lost one of its six choices';
  END IF;
  IF (SELECT metadata_schema #> '{connectivity,options}' FROM public.node_roles WHERE id = 'edge-device')
     IS DISTINCT FROM '["wifi", "ethernet", "cellular", "lora", "ble"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 095: Edge Device connectivity is not the five links';
  END IF;
END $$;

-- ── 4. AG.4: three overlapping types are retired, and what held them still does ─
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id, ', ') INTO bad FROM public.node_roles
  WHERE id IN ('microcontroller', 'embedded-device', 'embedded-system') AND NOT deprecated;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 095: still offered for new work: %', bad; END IF;
  SELECT string_agg(id, ', ') INTO bad FROM public.node_roles
  WHERE id IN ('microcontroller', 'embedded-device', 'embedded-system')
    AND NOT (description LIKE 'Deprecated: %Edge Device%' AND when_to_use LIKE 'Not for new work.%Edge Device%');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 095: a retired type does not point to Edge Device: %', bad; END IF;
  IF EXISTS (SELECT 1 FROM public.technology_catalog
             WHERE role_affinities ?| ARRAY['microcontroller', 'embedded-device', 'embedded-system']) THEN
    RAISE EXCEPTION 'db-lane 095: a technology drops onto a retired type';
  END IF;
  IF NOT coalesce(pg_temp.may_hold('edge-device', 'microcontroller', NULL), false)
     OR NOT coalesce(pg_temp.may_hold('edge-device', 'embedded-device', NULL), false)
     OR NOT coalesce(pg_temp.may_hold('embedded-system', 'firmware-service', NULL), false) THEN
    RAISE EXCEPTION 'db-lane 095: an existing nesting of a retired type is no longer valid';
  END IF;
  SELECT string_agg(d.id || ':' || r, ', ') INTO bad
  FROM public.deployment_targets d, jsonb_array_elements_text(d.compatible_roles) r
  JOIN public.node_roles n ON n.id = r AND n.deprecated;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 095: a deployment target offers a retired type: %', bad; END IF;
  IF NOT (SELECT compatible_roles ? 'firmware-service' FROM public.deployment_targets WHERE id = 'embedded') THEN
    RAISE EXCEPTION 'db-lane 095: the embedded target no longer takes firmware';
  END IF;
  -- the device and its firmware, the way to draw it now
  IF NOT coalesce(pg_temp.may_hold('edge-device', 'firmware-service', NULL), false) THEN
    RAISE EXCEPTION 'db-lane 095: an Edge Device cannot hold its Firmware Service';
  END IF;
END $$;

-- ── 5. AG.5 and AG.7 ──────────────────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF (SELECT label FROM public.node_roles WHERE id = 'ml-pipeline') IS DISTINCT FROM 'Data or ML Pipeline' THEN
    RAISE EXCEPTION 'db-lane 095: the pipeline role does not say it holds data pipelines';
  END IF;
  SELECT string_agg(t || ' takes ' || (SELECT role_affinities::text FROM public.technology_catalog WHERE id = t), '; ') INTO bad
  FROM unnest(ARRAY['aws-vpc', 'aws-privatelink', 'azure-vnet', 'gcp-vpc', 'gcp-private-service-connect']) t
  WHERE (SELECT role_affinities FROM public.technology_catalog WHERE id = t) IS DISTINCT FROM '["vpc"]'::jsonb;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 095: a VPC product still asks VPC or Subnet: %', bad; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'subnet' AND is_container AND container_style = 'hosting' AND NOT deprecated) THEN
    RAISE EXCEPTION 'db-lane 095: Subnet is no longer a host';
  END IF;

  RAISE NOTICE 'db-lane 095: the engines are games, the forms ask with choices, three device types are retired and still hold, the pipeline and the VPCs read true; stored values and replay unchanged';
END $$;

ROLLBACK;
