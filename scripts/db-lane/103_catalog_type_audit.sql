-- db-lane 103: the catalog type audit (owner 2026-09-29: "External Service is showing
-- an assortment of AWS services... Audit and ensure 100% quality here").
--
--   The migration runs here on a catalog put back the way the audit found it (the
--   twenty-one rows on their old types, no Notification Service, External Service's old
--   wording), with a project that drew SendGrid as an External Service and a custom row
--   of its own on External Service. Then:
--   - expanding External Service lists no cloud provider's service but the two maps APIs
--     the owner kept, and still lists the third-party APIs it is for;
--   - email, SMS and push providers drop as Notification Service with no picker, and
--     the type is a Messaging service you call, so it nests in AWS, Azure and Google
--     Cloud as External Service does and the palette shows it;
--   - each re-filed row drops as the type that describes it, primary first, and a
--     row with two uses still asks which;
--   - the project's stored node and its custom row are left as they were;
--   - replaying the migration changes nothing.
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

-- The live leaf roles a technology may drop as, primary first (what decides whether a
-- drop asks).
CREATE FUNCTION pg_temp.drop_roles(t text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY ord), '[]'::jsonb)
  FROM public.technology_catalog c, jsonb_array_elements_text(c.role_affinities) WITH ORDINALITY x(r, ord)
  JOIN public.node_roles n ON n.id = x.r AND NOT n.deprecated AND NOT n.is_container
  WHERE c.id = t;
$$;

DO $$
BEGIN
  IF to_regclass('public.node_roles') IS NULL OR to_regprocedure('public.assert_role_affinities_resolve()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 103: the catalog tables or their affinity trigger are missing. Apply migration 20260731190000 and the catalog migrations before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'sendgrid')
     OR NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'aws' AND jsonb_typeof(can_contain) = 'object') THEN
    RAISE EXCEPTION 'db-lane 103: the catalog rows the audit moves, or the platforms'' containment rules, are missing. Apply the catalog migrations through 20260928170000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db103000-0000-4000-8000-000000000001', 'db-lane-103-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db103000-0000-4000-8000-000000000010', 'db-lane 103', 'db103000-0000-4000-8000-000000000001');
  INSERT INTO public.branches (id, project_id, name, is_primary) VALUES
    ('db103000-0000-4000-8000-000000000011', 'db103000-0000-4000-8000-000000000010', 'main', true);
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash) VALUES
    ('db103000-0000-4000-8000-000000000010', 'db103000-0000-4000-8000-000000000011',
     '{"id": "g103", "schemaVersion": 8, "version": 1, "hash": "db103-hash", "edges": {}, "contracts": {}, "artifacts": {},
       "nodes": {"m1": {"id": "m1", "type": "external-service", "label": "Mail", "technology": "sendgrid"}}}'::jsonb, 'db103-hash');
  INSERT INTO public.technology_catalog (id, name, role_affinities, is_user_contributed, project_id) VALUES
    ('aws-our-mailer', 'Our mailer on AWS', '["external-service"]', true, 'db103000-0000-4000-8000-000000000010');

  -- The catalog the audit found.
  UPDATE public.technology_catalog SET role_affinities = '["external-service"]'
  WHERE id IN ('aws-ses', 'azure-communication-services', 'azure-notification-hubs', 'sendgrid', 'resend', 'loops', 'twilio',
               'aws-macie', 'gcp-cloud-dlp', 'azure-bastion', 'aws-lake-formation', 'gcp-dataplex');
  UPDATE public.technology_catalog SET role_affinities = '["database", "data-warehouse"]' WHERE id = 'aws-redshift';
  UPDATE public.technology_catalog SET role_affinities = '["worker", "backend-service"]' WHERE id = 'dotnet-worker';
  UPDATE public.technology_catalog SET role_affinities = '["worker", "ml-pipeline"]' WHERE id = 'aws-emr';
  UPDATE public.technology_catalog SET role_affinities = '["ml-pipeline", "worker"]' WHERE id = 'aws-glue';
  UPDATE public.technology_catalog SET role_affinities = '["backend-service"]' WHERE id = 'aws-appsync';
  UPDATE public.technology_catalog SET role_affinities = '["external-service", "ml-pipeline", "monitoring"]' WHERE id = 'langsmith';
  UPDATE public.technology_catalog SET role_affinities = '["external-service", "search-engine"]' WHERE id = 'algolia';
  UPDATE public.technology_catalog SET role_affinities = '["realtime-service", "backend-service"]' WHERE id = 'phoenix-elixir';
  UPDATE public.technology_catalog SET role_affinities = '["desktop-app"]' WHERE id = 'dotnet-maui';
  DELETE FROM public.node_roles WHERE id = 'notification-service';
  UPDATE public.node_roles SET description = 'Third-party API or SaaS', when_to_use = 'Choose for a third-party API or SaaS.'
  WHERE id = 'external-service';
END $$;

CREATE TEMP TABLE lane_103_graph AS
  SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db103000-0000-4000-8000-000000000010';

\ir ../../supabase/migrations/20260930100000_v3_catalog_type_audit.sql

CREATE TEMP TABLE lane_103_after_one AS
  SELECT (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r) AS roles,
         (SELECT jsonb_agg(jsonb_build_array(id, name, role_affinities, ai_context, metadata_schema, is_user_contributed, project_id) ORDER BY id)
            FROM public.technology_catalog) AS techs;

\ir ../../supabase/migrations/20260930100000_v3_catalog_type_audit.sql

-- ── 1. replaying changes nothing, and nothing a project stored changes ────────
DO $$
BEGIN
  IF (SELECT roles FROM lane_103_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r)
     OR (SELECT techs FROM lane_103_after_one) IS DISTINCT FROM
       (SELECT jsonb_agg(jsonb_build_array(id, name, role_affinities, ai_context, metadata_schema, is_user_contributed, project_id) ORDER BY id)
          FROM public.technology_catalog) THEN
    RAISE EXCEPTION 'db-lane 103: replaying the migration changed the catalog';
  END IF;
  IF (SELECT graph_data FROM lane_103_graph) IS DISTINCT FROM
     (SELECT graph_data FROM public.graph_snapshots WHERE project_id = 'db103000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'db-lane 103: a stored node changed';
  END IF;
  IF (SELECT role_affinities FROM public.technology_catalog WHERE id = 'aws-our-mailer') IS DISTINCT FROM '["external-service"]'::jsonb THEN
    RAISE EXCEPTION 'db-lane 103: a project''s own technology row was moved';
  END IF;
END $$;

-- ── 2. External Service lists what it is for ──────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.id, ', ' ORDER BY t.id) INTO bad
  FROM public.technology_catalog t
  WHERE NOT t.is_user_contributed AND pg_temp.drop_roles(t.id) ? 'external-service'
    AND t.id ~ '^(aws|azure|gcp|firebase|cloudflare|supabase)-'
    AND t.id NOT IN ('aws-location-service', 'gcp-google-maps-platform');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 103: External Service still lists a cloud provider''s service: %', bad; END IF;
  SELECT string_agg(x, ', ') INTO bad FROM unnest(ARRAY['aws-location-service', 'gcp-google-maps-platform', 'stripe', 'github', 'notion']) x
  WHERE pg_temp.drop_roles(x) <> '["external-service"]';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 103: External Service lost a row it is for: %', bad; END IF;
  IF (SELECT description FROM public.node_roles WHERE id = 'external-service') NOT LIKE '%cloud provider%'
     OR (SELECT when_to_use FROM public.node_roles WHERE id = 'external-service') NOT LIKE '%Notification Service%' THEN
    RAISE EXCEPTION 'db-lane 103: External Service does not say it covers a cloud provider''s API, or where email goes';
  END IF;
END $$;

-- ── 3. email, SMS and push are a Notification Service ─────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(x, ', ') INTO bad
  FROM unnest(ARRAY['aws-ses', 'azure-communication-services', 'azure-notification-hubs', 'sendgrid', 'resend', 'loops', 'twilio']) x
  WHERE pg_temp.drop_roles(x) <> '["notification-service"]';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 103: provider(s) that do not drop as Notification Service with no picker: %', bad; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'notification-service' AND label = 'Notification Service'
                   AND nature = 'call' AND interface_kind = 'service' AND palette_category = 'Messaging'
                   AND NOT is_container AND NOT deprecated AND can_contain = '[]'::jsonb) THEN
    RAISE EXCEPTION 'db-lane 103: Notification Service is not a Messaging service you call';
  END IF;
  -- it nests where External Service does
  SELECT string_agg(p, ', ') INTO bad FROM unnest(ARRAY['aws', 'azure', 'gcp']) p
  WHERE NOT (pg_temp.may_hold(p, 'notification-service') AND pg_temp.may_hold(p, 'external-service'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 103: platform(s) that do not hold a Notification Service: %', bad; END IF;
  -- the palette hides a type whose technologies all carry a provider's name
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE NOT is_user_contributed AND role_affinities ? 'notification-service'
                   AND id !~ '^(aws|azure|gcp|firebase|cloudflare|supabase)-') THEN
    RAISE EXCEPTION 'db-lane 103: every Notification Service row carries a provider name, so the palette hides it';
  END IF;
END $$;

-- ── 4. each re-filed row drops as the type that describes it ─────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(x.t || '=' || pg_temp.drop_roles(x.t)::text, ', ') INTO bad FROM (VALUES
    ('aws-macie', '["monitoring"]'), ('gcp-cloud-dlp', '["monitoring"]'), ('azure-bastion', '["auth-provider"]'),
    ('aws-lake-formation', '["data-warehouse"]'), ('gcp-dataplex', '["data-warehouse"]'), ('aws-redshift', '["data-warehouse"]'),
    ('dotnet-worker', '["worker"]'), ('aws-emr', '["ml-pipeline"]'), ('aws-glue', '["ml-pipeline"]'), ('aws-appsync', '["api-gateway"]'),
    ('langsmith', '["monitoring", "external-service"]'), ('algolia', '["search-engine", "external-service"]'),
    ('phoenix-elixir', '["backend-service", "realtime-service"]'), ('dotnet-maui', '["desktop-app", "mobile-app"]')) x(t, want)
  WHERE pg_temp.drop_roles(x.t) IS DISTINCT FROM x.want::jsonb;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 103: row(s) that do not drop as their type, primary first: %', bad; END IF;

  -- nothing is left pointing at a type that is gone or retired
  SELECT string_agg(DISTINCT t.id, ', ') INTO bad FROM public.technology_catalog t
  WHERE NOT t.is_user_contributed AND pg_temp.drop_roles(t.id) = '[]'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.role_affinities) a JOIN public.node_roles r ON r.id = a AND NOT r.deprecated);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 103: technolog(ies) with no live type: %', bad; END IF;

  RAISE NOTICE 'db-lane 103: External Service lists no cloud provider''s service but the maps APIs, email, SMS and push drop as Notification Service inside their platform, each re-filed row drops as its type primary first, stored nodes and custom rows stay, replay changes nothing';
END $$;

ROLLBACK;
