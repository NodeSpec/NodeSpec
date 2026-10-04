-- db-lane 079: where installed software goes (V3 AB.4, owner 2026-09-23).
--
--   The deployment targets import stamps on software that installs on a
--   device or an operating system: os-service (a unit under systemd,
--   launchd, a Windows service ...), desktop-native (an app, a CLI or a game
--   installed on a desktop), mobile-device, embedded (firmware). Each lists
--   only live roles, each once, and the roles import gives an app from its
--   own manifest (mobile-app, desktop-app, firmware-service) are on the
--   target that manifest argues for. Replaying the migration's upsert and
--   set union changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  bad text;
  before jsonb;
BEGIN
  IF to_regclass('public.deployment_targets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.deployment_targets WHERE id = 'os-service') THEN
    RAISE EXCEPTION 'db-lane 079: the os-service target is missing. Apply migration 20260924100000.';
  END IF;
  SELECT string_agg(t.id || ':' || r.value, ', ') INTO bad
    FROM public.deployment_targets t, jsonb_array_elements_text(t.compatible_roles) r
   WHERE t.id IN ('os-service', 'desktop-native', 'mobile-device', 'embedded')
     AND NOT EXISTS (SELECT 1 FROM public.node_roles n WHERE n.id = r.value AND NOT n.deprecated);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'installed targets list roles that do not exist: %', bad; END IF;

  IF NOT (SELECT compatible_roles @> '["mobile-app"]' FROM public.deployment_targets WHERE id = 'mobile-device')
     OR NOT (SELECT compatible_roles @> '["desktop-app", "cli-tool"]' FROM public.deployment_targets WHERE id = 'desktop-native')
     OR NOT (SELECT compatible_roles @> '["firmware-service"]' FROM public.deployment_targets WHERE id = 'embedded')
     OR NOT (SELECT compatible_roles @> '["backend-service", "worker"]' FROM public.deployment_targets WHERE id = 'os-service') THEN
    RAISE EXCEPTION 'an installed target lacks the role import gives it';
  END IF;

  -- Replaying the set union adds nothing.
  SELECT jsonb_object_agg(id, compatible_roles) INTO before FROM public.deployment_targets;
  UPDATE public.deployment_targets t
     SET compatible_roles = (
       SELECT jsonb_agg(r ORDER BY first_seen)
         FROM (SELECT r, min(o) AS first_seen
                 FROM jsonb_array_elements_text(t.compatible_roles || x.add) WITH ORDINALITY AS e(r, o)
                GROUP BY r) u)
    FROM (VALUES ('desktop-native', '["cli-tool", "game-client"]'::jsonb), ('embedded', '["firmware-service"]'::jsonb)) AS x(id, add)
   WHERE t.id = x.id;
  IF (SELECT jsonb_object_agg(id, compatible_roles) FROM public.deployment_targets) IS DISTINCT FROM before THEN
    RAISE EXCEPTION 'replaying the union changed a target';
  END IF;
  RAISE NOTICE 'db-lane 079: installed targets hold';
END $$;

ROLLBACK;
