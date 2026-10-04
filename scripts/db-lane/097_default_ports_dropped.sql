-- db-lane 097: node_roles.default_ports is gone (V3 AG.13e, release 3,
-- owner 2026-09-28).
--
--   After the migration: node_roles has no default_ports column, every
--   role is still there with every other column as it was, the table
--   comment names no ports, and a role inserted the way the catalog
--   migrations now write one (no port list) is accepted. The migration
--   replayed changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regclass('public.node_roles') IS NULL OR to_regprocedure('public.assert_role_affinities_resolve()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 097: the catalog tables or their affinity trigger are missing. Apply migration 20260731190000 and the catalog migrations before it.';
  END IF;
END $$;

-- Every role as it stands, less the column that goes.
CREATE TEMP TABLE lane_097_before AS
  SELECT id, to_jsonb(r) - 'default_ports' - 'updated_at' AS row FROM public.node_roles r;

\ir ../../supabase/migrations/20260928150000_v3_ag13_drop_default_ports.sql

CREATE TEMP TABLE lane_097_after AS
  SELECT id, to_jsonb(r) AS row, obj_description('public.node_roles'::regclass, 'pg_class') AS note
  FROM public.node_roles r;

\ir ../../supabase/migrations/20260928150000_v3_ag13_drop_default_ports.sql

DO $$
DECLARE
  n int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'node_roles' AND column_name = 'default_ports') THEN
    RAISE EXCEPTION 'db-lane 097: node_roles still has default_ports';
  END IF;

  -- every role kept, every other column as it was
  SELECT count(*) INTO n FROM lane_097_before b
  LEFT JOIN public.node_roles r USING (id)
  WHERE r.id IS NULL OR (to_jsonb(r) - 'updated_at') IS DISTINCT FROM b.row;
  IF n > 0 THEN RAISE EXCEPTION 'db-lane 097: % role(s) lost or changed beyond the column', n; END IF;
  IF (SELECT count(*) FROM public.node_roles) <> (SELECT count(*) FROM lane_097_before) THEN
    RAISE EXCEPTION 'db-lane 097: the role count changed';
  END IF;

  -- replay changes nothing
  IF EXISTS (SELECT 1 FROM public.node_roles r JOIN lane_097_after a USING (id) WHERE to_jsonb(r) IS DISTINCT FROM a.row)
     OR obj_description('public.node_roles'::regclass, 'pg_class') IS DISTINCT FROM (SELECT max(note) FROM lane_097_after) THEN
    RAISE EXCEPTION 'db-lane 097: replaying the migration changed node_roles';
  END IF;
  IF obj_description('public.node_roles'::regclass, 'pg_class') ILIKE '%port%' THEN
    RAISE EXCEPTION 'db-lane 097: the node_roles comment still names ports';
  END IF;
END $$;

-- A new role written as the catalog migrations now write one is accepted.
INSERT INTO public.node_roles
  (id, label, description, icon_name, color, rf_visual_type, palette_category, nature,
   interface_kind, is_container, can_contain, metadata_schema, suggested_contracts,
   sort_order, capability_tags, deprecated, when_to_use)
VALUES
  ('lane-097-role', 'Lane Role', 'A role for this lane only.', 'Box', '#64748b', 'service', 'Services',
   'build', 'service', false, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 999, '{}', false, 'Never.');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'lane-097-role') THEN
    RAISE EXCEPTION 'db-lane 097: a role with no port list was not stored';
  END IF;
  RAISE NOTICE 'db-lane 097: default_ports is gone, every role kept as it was, the comment names no ports, a portless role inserts, replay changes nothing';
END $$;

ROLLBACK;
