-- db-lane 080: an Electron app is a node (V3 AB.5, owner 2026-09-24).
--
--   desktop-app is a leaf drawn as a service, like mobile-app, and keeps the
--   parts an explode gives it; no leaf is drawn as a container; and the
--   catalog refuses a row that would draw a leaf as a container again.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  refused boolean := false;
BEGIN
  IF to_regclass('public.node_roles') IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'node_roles_container_visual_check') THEN
    RAISE EXCEPTION 'db-lane 080: the container drawing check is missing. Apply migration 20260924110000.';
  END IF;

  IF (SELECT (rf_visual_type, is_container) FROM public.node_roles WHERE id = 'desktop-app')
       IS DISTINCT FROM ROW('service'::text, false) THEN
    RAISE EXCEPTION 'desktop-app should be a leaf drawn as a service';
  END IF;
  IF NOT (SELECT can_contain @> '["part-page", "part-component", "part-module"]' FROM public.node_roles WHERE id = 'desktop-app') THEN
    RAISE EXCEPTION 'desktop-app should keep its parts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.node_roles WHERE rf_visual_type = 'container' AND is_container IS NOT TRUE) THEN
    RAISE EXCEPTION 'a leaf is drawn as a container';
  END IF;

  BEGIN
    UPDATE public.node_roles SET rf_visual_type = 'container' WHERE id = 'desktop-app';
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'the catalog let a leaf be drawn as a container'; END IF;

  RAISE NOTICE 'db-lane 080: an Electron app is a node';
END $$;

ROLLBACK;
