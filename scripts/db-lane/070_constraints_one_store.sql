-- db-lane 070: constraints have one store (V3 AA.0, owner 2026-09-23).
--
--   Writing the legacy spec jsonb (adopt a spec.json, load one from git)
--   copies each entry into project_constraints, project-wide: a new entry
--   lands; one the project already has (same type and description, any
--   hash family, any door) is not duplicated; an unknown type lands as
--   'other'; an entry with no description is skipped; a replay inserts
--   nothing; removing an entry from the jsonb removes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db700000-0000-4000-8000-000000000001';
  v_proj uuid := 'db700000-0000-4000-8000-000000000010';
  v_spec uuid := 'db700000-0000-4000-8000-000000000020';
  n int;
BEGIN
  IF to_regprocedure('public.constraints_from_spec_json(uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 070: constraints_from_spec_json is missing. Apply migration 20260923110000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-070-owner@nodespec.local');
  -- AC: constraints are Indie and above
  DELETE FROM public.stripe_subscriptions WHERE user_id = v_owner;
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (v_owner, 'indie', 'active');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 070', v_owner);
  -- a constraint the app recorded (its own hash family)
  INSERT INTO public.project_constraints (project_id, ctype, description, source_hash)
    VALUES (v_proj, 'security', 'Sessions expire after 15 minutes idle', 'app-sha256:lane070');

  -- 1. adopting a spec.json: the jsonb arrives on insert
  INSERT INTO public.project_specifications (id, project_id, vision, constraints, created_by)
  VALUES (v_spec, v_proj, 'v', '[
    {"type": "security", "description": "Sessions expire after 15 minutes idle"},
    {"type": "cost", "description": "Under 40 dollars a month", "title": "Cheap", "rationale": "A side project"},
    {"type": "budgetary", "description": "No paid APIs"},
    {"type": "performance", "description": "   "},
    "not an object"
  ]'::jsonb, v_owner);
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = v_proj;
  IF n <> 3 THEN RAISE EXCEPTION 'db-lane 070: expected 3 constraints after adopt (1 app + 2 new), found %', n; END IF;
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = v_proj AND description = 'Sessions expire after 15 minutes idle';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 070: the app''s constraint was duplicated by its round trip (% rows)', n; END IF;
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = v_proj AND description = 'Under 40 dollars a month' AND title = 'Cheap' AND rationale = 'A side project' AND workflow_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 070: title and rationale did not carry, or the entry was scoped'; END IF;
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = v_proj AND description = 'No paid APIs' AND ctype = 'other';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 070: an unknown type should land as other'; END IF;

  -- 2. loading from git: an update adds one, drops one; nothing is removed, nothing duplicated
  UPDATE public.project_specifications SET constraints = '[
    {"type": "security", "description": "Sessions expire after 15 minutes idle"},
    {"type": "deployment", "description": "Runs in eu-west-1"}
  ]'::jsonb WHERE id = v_spec;
  SELECT count(*) INTO n FROM public.project_constraints WHERE project_id = v_proj;
  IF n <> 4 THEN RAISE EXCEPTION 'db-lane 070: expected 4 after the load (one added, none removed), found %', n; END IF;

  -- 3. a replay inserts nothing
  IF public.constraints_from_spec_json(v_proj, (SELECT constraints FROM public.project_specifications WHERE id = v_spec)) <> 0 THEN
    RAISE EXCEPTION 'db-lane 070: a replay inserted rows';
  END IF;
  RAISE NOTICE 'db-lane 070: the spec jsonb feeds project_constraints once per constraint, project-wide, never duplicating or deleting';
END $$;

ROLLBACK;
