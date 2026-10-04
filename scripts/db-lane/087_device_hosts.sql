-- db-lane 087: the device an app installs on is a host (V3 AE.8, owner
-- 2026-09-25, ruling 17), and the extractor version the index defaults to
-- follows the readers (AE.10, AE.11).
--
--   After the migration: desktop-device and edge-device are live runtime
--   hosting containers beside mobile-device, each naming only roles the
--   catalog has (the can_contain trigger accepts them), desktop-device
--   hosting desktop-app and edge-device hosting firmware-service and
--   kernel-module; the extractor default is 4 on both index tables. The
--   migration replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regclass('public.repo_index') IS NULL OR to_regprocedure('public.assert_role_affinities_resolve()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 087: the repo index or the catalog trigger is missing. Apply migration 20260902100000 and the catalog migrations before it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'kernel-module') THEN
    RAISE EXCEPTION 'db-lane 087: kernel-module is missing. Apply migration 20260925180000.';
  END IF;
END $$;

-- AG.13e dropped node_roles.default_ports after this migration, and its
-- INSERT still names the column: the column comes back for this rolled-back
-- transaction only, so the migration replays as it did when it shipped.
ALTER TABLE public.node_roles ADD COLUMN IF NOT EXISTS default_ports jsonb DEFAULT '[]'::jsonb;

\ir ../../supabase/migrations/20260925190000_v3_ae8_device_hosts.sql

CREATE TEMP TABLE lane_087_before AS
  SELECT (SELECT count(*) FROM public.node_roles) AS roles,
         (SELECT jsonb_agg(to_jsonb(r) - 'updated_at' ORDER BY id) FROM public.node_roles r WHERE id IN ('desktop-device', 'edge-device', 'mobile-device')) AS hosts;

\ir ../../supabase/migrations/20260925190000_v3_ae8_device_hosts.sql

DO $$
DECLARE
  b record;
  r record;
BEGIN
  SELECT * INTO b FROM lane_087_before;
  IF b.roles <> (SELECT count(*) FROM public.node_roles)
     OR b.hosts IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) - 'updated_at' ORDER BY x.id) FROM public.node_roles x WHERE x.id IN ('desktop-device', 'edge-device', 'mobile-device')) THEN
    RAISE EXCEPTION 'db-lane 087: replaying the migration changed something';
  END IF;
  -- the three device hosts are live runtime hosting containers
  FOR r IN SELECT * FROM public.node_roles WHERE id IN ('desktop-device', 'edge-device', 'mobile-device') LOOP
    IF r.is_container IS NOT TRUE OR r.container_style <> 'hosting' OR r.container_layer <> 'runtime' OR r.deprecated IS TRUE OR r.rf_visual_type <> 'container' THEN
      RAISE EXCEPTION 'db-lane 087: % is not a live runtime hosting container', r.id;
    END IF;
  END LOOP;
  -- each hosts the functional node the import gives that device family
  IF NOT (SELECT can_contain @> '["mobile-app"]'::jsonb FROM public.node_roles WHERE id = 'mobile-device')
     OR NOT (SELECT can_contain @> '["desktop-app"]'::jsonb FROM public.node_roles WHERE id = 'desktop-device')
     OR NOT (SELECT can_contain @> '["firmware-service", "kernel-module"]'::jsonb FROM public.node_roles WHERE id = 'edge-device') THEN
    RAISE EXCEPTION 'db-lane 087: a device host does not host its family''s node';
  END IF;
  -- the catalog's own trigger accepts a re-filing (every child id resolves)
  UPDATE public.node_roles SET updated_at = now() WHERE id = 'edge-device';
  -- and refuses a child the catalog lacks
  BEGIN
    UPDATE public.node_roles SET can_contain = can_contain || '["no-such-role"]'::jsonb WHERE id = 'edge-device';
    RAISE EXCEPTION 'db-lane 087: the trigger accepted a child role the catalog lacks';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'db-lane 087:%' THEN RAISE; END IF;
  END;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'repo_index' AND column_name = 'extractor_version') IS DISTINCT FROM '4'
     OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_job_files' AND column_name = 'extractor_version') IS DISTINCT FROM '4' THEN
    RAISE EXCEPTION 'db-lane 087: the extractor default is not 4';
  END IF;
  RAISE NOTICE 'db-lane 087: three device hosts live, each hosting its family, the trigger holds, extractor default 4, replay changes nothing';
END $$;

ROLLBACK;
