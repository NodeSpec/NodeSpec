-- db-lane 086: the catalog learns firmware stacks and kernel-level code
-- (V3 AE.9, owner 2026-09-25, rulings 18 and 19).
--
--   After the migration: arduino, esp-idf and zephyr are technology rows on
--   firmware-service (the role the import gives a firmware project), and
--   linux-kernel-module and windows-driver are rows on the new kernel-module
--   role, a live Hardware leaf the os-service, bare-metal and embedded
--   targets list. Every affinity resolves and each row has exactly one live
--   leaf affinity (a silent drop, never a picker). firmware-service reads
--   firmware first. The catalog's own trigger accepts the rows. The
--   migration replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regclass('public.deployment_targets') IS NULL OR to_regprocedure('public.assert_role_affinities_resolve()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 086: the catalog tables or their affinity trigger are missing. Apply migration 20260731190000 and the catalog migrations before it.';
  END IF;
END $$;

-- AG.13e dropped node_roles.default_ports after this migration, and its
-- INSERT still names the column: the column comes back for this rolled-back
-- transaction only, so the migration replays as it did when it shipped.
ALTER TABLE public.node_roles ADD COLUMN IF NOT EXISTS default_ports jsonb DEFAULT '[]'::jsonb;

\ir ../../supabase/migrations/20260925180000_v3_ae9_firmware_and_drivers.sql

CREATE TEMP TABLE lane_086_before AS
  SELECT (SELECT count(*) FROM public.technology_catalog) AS techs,
         (SELECT count(*) FROM public.node_roles) AS roles,
         (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets WHERE id IN ('os-service', 'bare-metal', 'embedded')) AS targets,
         (SELECT description FROM public.node_roles WHERE id = 'firmware-service') AS fw;

\ir ../../supabase/migrations/20260925180000_v3_ae9_firmware_and_drivers.sql

DO $$
DECLARE
  b record;
  t text;
  n int;
BEGIN
  SELECT * INTO b FROM lane_086_before;
  IF b.techs <> (SELECT count(*) FROM public.technology_catalog) OR b.roles <> (SELECT count(*) FROM public.node_roles)
     OR b.targets IS DISTINCT FROM (SELECT jsonb_agg(compatible_roles ORDER BY id) FROM public.deployment_targets WHERE id IN ('os-service', 'bare-metal', 'embedded'))
     OR b.fw IS DISTINCT FROM (SELECT description FROM public.node_roles WHERE id = 'firmware-service') THEN
    RAISE EXCEPTION 'db-lane 086: replaying the migration changed something';
  END IF;

  FOREACH t IN ARRAY ARRAY['arduino', 'esp-idf', 'zephyr'] LOOP
    IF (SELECT role_affinities FROM public.technology_catalog WHERE id = t) <> '["firmware-service"]'::jsonb THEN
      RAISE EXCEPTION 'db-lane 086: % is not filed on firmware-service alone', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['linux-kernel-module', 'windows-driver'] LOOP
    IF (SELECT role_affinities FROM public.technology_catalog WHERE id = t) <> '["kernel-module"]'::jsonb THEN
      RAISE EXCEPTION 'db-lane 086: % is not filed on kernel-module alone', t;
    END IF;
  END LOOP;
  -- one live leaf affinity each, resolved through node_roles as the palette does
  SELECT count(*) INTO n
    FROM public.technology_catalog x, jsonb_array_elements_text(x.role_affinities) aff
    JOIN public.node_roles r ON r.id = aff
   WHERE x.id IN ('arduino', 'esp-idf', 'zephyr', 'linux-kernel-module', 'windows-driver')
     AND r.is_container IS NOT TRUE AND r.deprecated IS NOT TRUE;
  IF n <> 5 THEN RAISE EXCEPTION 'db-lane 086: expected five live leaf affinities, found %', n; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'kernel-module' AND nature = 'build' AND palette_category = 'Hardware' AND is_container = false) THEN
    RAISE EXCEPTION 'db-lane 086: the kernel-module role is not a build leaf in Hardware';
  END IF;
  SELECT count(*) INTO n FROM public.deployment_targets WHERE id IN ('os-service', 'bare-metal', 'embedded') AND compatible_roles @> '["kernel-module"]'::jsonb;
  IF n <> 3 THEN RAISE EXCEPTION 'db-lane 086: kernel-module should be on three targets, is on %', n; END IF;
  -- a target lists the role once, never twice after the replay
  SELECT count(*) INTO n FROM public.deployment_targets d, jsonb_array_elements_text(d.compatible_roles) r WHERE d.id = 'os-service' AND r = 'kernel-module';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 086: os-service lists kernel-module % times', n; END IF;
  IF (SELECT description FROM public.node_roles WHERE id = 'firmware-service') NOT LIKE 'Firmware: the code that runs on an embedded device%' THEN
    RAISE EXCEPTION 'db-lane 086: firmware-service does not say firmware first';
  END IF;
  -- no version numbers in any enum option (the skill's rule: models, never numbers)
  SELECT count(*) INTO n
    FROM public.technology_catalog x, jsonb_each(x.metadata_schema) f, jsonb_array_elements_text(coalesce(f.value -> 'options', '[]'::jsonb)) o
   WHERE x.id IN ('arduino', 'esp-idf', 'zephyr', 'linux-kernel-module', 'windows-driver') AND o ~ '^\d+(\.\d+)+$';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 086: an enum names a version'; END IF;
  -- the catalog's own trigger accepts a re-filing of one of the rows (affinities resolve)
  UPDATE public.technology_catalog SET updated_at = now() WHERE id = 'zephyr';
  RAISE NOTICE 'db-lane 086: five rows on two live leaves, the role on three targets, firmware first, replay changes nothing';
END $$;

ROLLBACK;
