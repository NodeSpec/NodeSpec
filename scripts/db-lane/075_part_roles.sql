-- db-lane 075: the depth rule's catalog rows (V3 AA.3, owner 2026-09-23).
--
--   Seven part roles, each tagged 'part', not a container, holding nothing.
--   The parents list them in can_contain, each part once. A parent cannot
--   list a part that does not exist (the M5 trigger). Re-running the
--   migration's UPDATE adds nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_count int;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF to_regclass('public.node_roles') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = 'part-table-group') THEN
    RAISE EXCEPTION 'db-lane 075: the part roles are missing. Apply migration 20260923160000.';
  END IF;

  SELECT count(*) INTO v_count FROM public.node_roles
   WHERE id IN ('part-module','part-handler','part-worker','part-repository','part-page','part-component','part-table-group')
     AND 'part' = ANY(capability_tags) AND is_container IS NOT TRUE
     AND container_style IS NULL AND can_contain = '[]'::jsonb;
  IF v_count <> 7 THEN RAISE EXCEPTION 'db-lane 075: expected 7 parts that hold nothing, found %', v_count; END IF;

  IF NOT (SELECT can_contain @> '["part-handler","part-repository"]'::jsonb FROM public.node_roles WHERE id = 'backend-service')
     OR NOT (SELECT can_contain @> '["part-table-group"]'::jsonb FROM public.node_roles WHERE id = 'database')
     OR NOT (SELECT can_contain @> '["part-page","part-component"]'::jsonb FROM public.node_roles WHERE id = 'frontend-app') THEN
    RAISE EXCEPTION 'db-lane 075: a parent does not list its parts';
  END IF;

  -- each part once in every list
  SELECT count(*) INTO v_count FROM public.node_roles r
   WHERE jsonb_typeof(r.can_contain) = 'array'
     AND jsonb_array_length(r.can_contain) <> (SELECT count(DISTINCT e) FROM jsonb_array_elements_text(r.can_contain) e);
  IF v_count <> 0 THEN RAISE EXCEPTION 'db-lane 075: % role(s) list a role twice', v_count; END IF;

  -- a part that does not exist is refused
  BEGIN
    UPDATE public.node_roles SET can_contain = can_contain || '["part-nothing"]'::jsonb WHERE id = 'backend-service';
    RAISE EXCEPTION 'db-lane 075: an unknown part should be refused';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%part-nothing%' THEN RAISE; END IF;
  END;

  -- the migration's UPDATE, run again, adds nothing
  SELECT can_contain INTO v_before FROM public.node_roles WHERE id = 'worker';
  UPDATE public.node_roles AS r
  SET can_contain = COALESCE(r.can_contain, '[]'::jsonb) || (
    SELECT COALESCE(jsonb_agg(p.value ORDER BY p.ord), '[]'::jsonb)
    FROM jsonb_array_elements(v.parts) WITH ORDINALITY AS p(value, ord)
    WHERE NOT COALESCE(r.can_contain, '[]'::jsonb) @> jsonb_build_array(p.value))
  FROM (VALUES ('worker', '["part-worker","part-repository","part-module"]'::jsonb)) AS v(id, parts)
  WHERE r.id = v.id
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.parts) AS q(value)
                WHERE NOT COALESCE(r.can_contain, '[]'::jsonb) @> jsonb_build_array(q.value));
  SELECT can_contain INTO v_after FROM public.node_roles WHERE id = 'worker';
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'db-lane 075: a replay changed worker from % to %', v_before, v_after;
  END IF;

  RAISE NOTICE 'db-lane 075: ok (7 parts hold nothing, parents list them once, unknown part refused, replay adds nothing)';
END $$;

ROLLBACK;
