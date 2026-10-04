-- db-lane 105: the desktop and mobile rows import needs to draw an app with its
-- technology (V3 AJ.4; owner 2026-09-30).
--
--   The migration runs here, twice, on a database with a project that drew a
--   desktop app and a phone app before the rows existed:
--   - Windows Forms, WinUI 3, Qt, GTK, Avalonia UI, JavaFX and Wails drop as a
--     Desktop App, and Capacitor and Compose Multiplatform as a Mobile App, each
--     as its one type with no picker; each carries the task packet's code mode, a
--     purpose that says when not to choose it, five or more practices and
--     pitfalls, and choices whose default is one of their options and none of
--     which is a version; the cross-platform ones say where they ship as a
--     multiselect of operating systems;
--   - every technology import names for an app takes the type it draws the app as,
--     on a host and a deployment target that take that type;
--   - Swift (macOS) draws the Swift logo Swift (iOS) draws;
--   - the index defaults to extractor version 6, so indexed repositories are read again;
--   - replaying the migration changes nothing, and nothing a project stored changes.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- May a parent of role p hold a child of role c? The rule canContain applies
-- (core/src/container-types.ts), as in lanes 094, 095, 098 and 099.
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
    RAISE EXCEPTION 'db-lane 105: the catalog tables or their affinity trigger are missing. Apply migration 20260731190000 and the catalog migrations before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'swift-macos') THEN
    RAISE EXCEPTION 'db-lane 105: Swift (macOS) is missing. Apply migration 20260928170000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db105000-0000-4000-8000-000000000001', 'db-lane-105-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db105000-0000-4000-8000-000000000010', 'db-lane 105', 'db105000-0000-4000-8000-000000000001');
  INSERT INTO public.branches (id, project_id, name, is_primary) VALUES
    ('db105000-0000-4000-8000-000000000011', 'db105000-0000-4000-8000-000000000010', 'main', true);
  -- a desktop app and a phone app as import drew them before the rows existed
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash) VALUES
    ('db105000-0000-4000-8000-000000000010', 'db105000-0000-4000-8000-000000000011',
     '{"id": "g105", "schemaVersion": 8, "version": 1, "hash": "db105-hash", "edges": {}, "contracts": {}, "artifacts": {},
       "nodes": {
         "d1": {"id": "d1", "type": "desktop-device", "label": "Desktop Device for Kiosk"},
         "k1": {"id": "k1", "type": "desktop-app", "label": "Kiosk", "parentId": "d1", "placementKind": "hosts"},
         "m1": {"id": "m1", "type": "mobile-device", "label": "Mobile Device for Shelfie"},
         "a1": {"id": "a1", "type": "mobile-app", "label": "Shelfie", "parentId": "m1", "placementKind": "hosts"}}}'::jsonb, 'db105-hash');
END $$;

CREATE TEMP TABLE lane_105_graph AS
  SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db105000-0000-4000-8000-000000000010';

\ir ../../supabase/migrations/20260930140000_v3_desktop_mobile_rows.sql

CREATE TEMP TABLE lane_105_after_one AS
  SELECT (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r) AS roles,
         (SELECT jsonb_agg(jsonb_build_array(id, name, display_name, role_affinities, ai_context, metadata_schema, suggested_files,
                                             common_connections, icon_url, brand_color) ORDER BY id)
            FROM public.technology_catalog) AS techs;

\ir ../../supabase/migrations/20260930140000_v3_desktop_mobile_rows.sql

-- ── 1. replaying changes nothing, and nothing a project stored changes ────────
DO $$
BEGIN
  IF (SELECT roles FROM lane_105_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r)
     OR (SELECT techs FROM lane_105_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(jsonb_build_array(id, name, display_name, role_affinities, ai_context, metadata_schema, suggested_files,
                                           common_connections, icon_url, brand_color) ORDER BY id)
          FROM public.technology_catalog) THEN
    RAISE EXCEPTION 'db-lane 105: replaying the migration changed the catalog';
  END IF;
  IF (SELECT graph_data FROM lane_105_graph) IS DISTINCT FROM
     (SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db105000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 105: a stored node changed';
  END IF;
END $$;

-- ── 2. nine rows, each on its one type, authored to the bar ───────────────────
DO $$
DECLARE r record; bad text;
BEGIN
  SELECT string_agg(x.id || '=' || pg_temp.drop_roles(x.id)::text, ', ') INTO bad FROM (VALUES
    ('winforms', 'desktop-app'), ('winui', 'desktop-app'), ('qt', 'desktop-app'), ('gtk', 'desktop-app'), ('avalonia', 'desktop-app'),
    ('javafx', 'desktop-app'), ('wails', 'desktop-app'), ('capacitor', 'mobile-app'), ('compose-multiplatform', 'mobile-app')) x(id, role)
  WHERE pg_temp.drop_roles(x.id) <> jsonb_build_array(x.role);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 105: a new row does not drop as its one type with no picker: %', bad; END IF;

  FOR r IN SELECT id, ai_context, metadata_schema, is_user_contributed, brand_color FROM public.technology_catalog
           WHERE id IN ('winforms', 'winui', 'qt', 'gtk', 'avalonia', 'javafx', 'wails', 'capacitor', 'compose-multiplatform') LOOP
    IF r.is_user_contributed THEN RAISE EXCEPTION 'db-lane 105: % is filed as a custom row', r.id; END IF;
    IF r.ai_context ->> 'configMode' IS DISTINCT FROM 'code' THEN RAISE EXCEPTION 'db-lane 105: % does not hand the agent a code packet', r.id; END IF;
    IF r.ai_context ->> 'purpose' NOT LIKE '%Do not choose%' THEN RAISE EXCEPTION 'db-lane 105: % gives no reason not to choose it', r.id; END IF;
    IF jsonb_array_length(r.ai_context -> 'bestPractices') < 5 OR jsonb_array_length(r.ai_context -> 'antiPatterns') < 5 THEN
      RAISE EXCEPTION 'db-lane 105: % has fewer than five practices or pitfalls', r.id;
    END IF;
    IF r.ai_context #>> '{provenance,method}' NOT IN ('model-knowledge', 'live-docs') THEN RAISE EXCEPTION 'db-lane 105: % has no provenance', r.id; END IF;
    IF r.brand_color !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'db-lane 105: % has no brand colour to draw', r.id; END IF;
    SELECT string_agg(f.key, ', ') INTO bad FROM jsonb_each(r.metadata_schema) f(key, v)
    WHERE f.v ->> 'type' NOT IN ('enum', 'multiselect', 'boolean')
       OR (f.v ->> 'type' = 'enum' AND NOT (f.v -> 'options') ? (f.v ->> 'default'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(f.v -> 'options', '[]')) o WHERE o ~ '^[0-9.]+$');
    IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 105: % field(s) % are not choices, default off their options, or name a version', r.id, bad; END IF;
  END LOOP;

  -- A cross-platform framework says where it ships (the 4d-2 rule), as operating systems import can fill.
  SELECT string_agg(t.id, ', ') INTO bad FROM public.technology_catalog t
  WHERE t.id IN ('qt', 'avalonia', 'wails', 'capacitor', 'compose-multiplatform')
    AND NOT (t.metadata_schema #>> '{targets,type}' = 'multiselect'
             AND (t.metadata_schema #> '{targets,options}') ?| ARRAY['windows', 'macos', 'linux', 'ios', 'android']);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 105: % do not say where they ship', bad; END IF;
END $$;

-- ── 3. what import names for an app takes the type, host and target it draws ──
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t || ' on ' || r, ', ') INTO bad FROM (VALUES
    ('winforms', 'desktop-app'), ('winui', 'desktop-app'), ('qt', 'desktop-app'), ('gtk', 'desktop-app'), ('avalonia', 'desktop-app'),
    ('javafx', 'desktop-app'), ('wails', 'desktop-app'), ('electron', 'desktop-app'), ('tauri', 'desktop-app'), ('wpf', 'desktop-app'),
    ('dotnet-maui', 'desktop-app'), ('dotnet-maui', 'mobile-app'), ('swift-macos', 'desktop-app'),
    ('react-native', 'mobile-app'), ('flutter', 'mobile-app'), ('capacitor', 'mobile-app'), ('compose-multiplatform', 'mobile-app'),
    ('swift-ios', 'mobile-app'), ('kotlin-android', 'mobile-app')) x(t, r)
  WHERE NOT EXISTS (SELECT 1 FROM public.technology_catalog c WHERE c.id = x.t AND NOT c.is_user_contributed AND c.role_affinities ? x.r);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 105: technolog(ies) import names that the catalog lacks or files elsewhere: %', bad; END IF;

  SELECT string_agg(p || '>' || c, ', ') INTO bad FROM (VALUES ('desktop-device', 'desktop-app'), ('mobile-device', 'mobile-app')) x(p, c)
  WHERE NOT pg_temp.may_hold(p, c);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 105: a device may not hold the app import puts in it: %', bad; END IF;

  SELECT string_agg(t || ':' || r, ', ') INTO bad FROM (VALUES ('desktop-native', 'desktop-app'), ('mobile-device', 'mobile-app')) x(t, r)
  WHERE NOT EXISTS (SELECT 1 FROM public.deployment_targets d WHERE d.id = x.t AND d.compatible_roles ? x.r);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 105: deployment target(s) that do not take the app: %', bad; END IF;
END $$;

-- ── 4. logos and the index ─────────────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  IF (SELECT icon_url FROM public.technology_catalog WHERE id = 'swift-macos') IS DISTINCT FROM
     (SELECT icon_url FROM public.technology_catalog WHERE id = 'swift-ios') THEN
    RAISE EXCEPTION 'db-lane 105: Swift (macOS) does not draw the Swift logo';
  END IF;
  IF (SELECT icon_url FROM public.technology_catalog WHERE id = 'javafx') IS DISTINCT FROM
     (SELECT icon_url FROM public.technology_catalog WHERE id = 'java-backend') THEN
    RAISE EXCEPTION 'db-lane 105: JavaFX does not draw the Java logo';
  END IF;

  SELECT string_agg(table_name || '=' || coalesce(column_default, 'none'), ', ') INTO bad FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'extractor_version' AND table_name IN ('repo_index', 'import_job_files')
    AND column_default IS DISTINCT FROM '6';
  IF bad IS NOT NULL OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
                           AND column_name = 'extractor_version' AND table_name IN ('repo_index', 'import_job_files')) <> 2 THEN
    RAISE EXCEPTION 'db-lane 105: the index does not default to extractor version 6 (%)', bad;
  END IF;

  RAISE NOTICE 'db-lane 105: nine desktop and mobile rows drop as their one type with a code packet, the cross-platform ones say where they ship, every app technology import names is live where import draws it, the Swift and Java logos carry over, the index reads again at version 6, replay changes nothing';
END $$;

ROLLBACK;
