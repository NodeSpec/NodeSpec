-- db-lane 081: a constraint is guidance or a check, for a scope, and it
-- counts its use (V3 R.2b and R.2c, owner 2026-09-24).
--
--   A row filed the old way (a workflow only) is workflow-scoped, and turns
--   project-wide when its workflow is deleted; a check names one predicate
--   of the closed vocabulary and a severity, guidance names none; a scope
--   other than the project names what it holds for; constraints_count adds
--   to one project's rows only and moves lastFiredAt only when something
--   fired; a spec.json entry keeps its check and scope when it comes in, and
--   one the vocabulary does not know comes in as guidance.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid := 'db810000-0000-4000-8000-000000000001';
  v_proj  uuid := 'db810000-0000-4000-8000-000000000010';
  v_other uuid := 'db810000-0000-4000-8000-000000000011';
  v_wf    uuid := 'db810000-0000-4000-8000-0000000000a1';
  v_guide uuid := 'db810000-0000-4000-8000-0000000000c1';
  v_check uuid := 'db810000-0000-4000-8000-0000000000c2';
  v_far   uuid := 'db810000-0000-4000-8000-0000000000c3';
  refused boolean;
  r record;
  n int;
BEGIN
  IF to_regprocedure('public.constraints_count(uuid, jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_constraints' AND column_name = 'check_spec') THEN
    RAISE EXCEPTION 'db-lane 081: the rule columns are missing. Apply migration 20260924120000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db-lane-081-owner@nodespec.local');
  -- AC: constraints are Indie and above
  DELETE FROM public.stripe_subscriptions WHERE user_id = v_owner;
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (v_owner, 'indie', 'active');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 081', v_owner), (v_other, 'db-lane 081 other', v_owner);
  INSERT INTO public.workflows (id, project_id, name, sort_order) VALUES (v_wf, v_proj, 'Checkout', 0);

  -- 1. filed the old way: a workflow only
  INSERT INTO public.project_constraints (id, project_id, ctype, description, source_hash, workflow_id)
    VALUES (v_guide, v_proj, 'security', 'Card data never leaves the payment service', 'lane081-1', v_wf);
  SELECT kind, scope_kind, scope_value INTO r FROM public.project_constraints WHERE id = v_guide;
  IF (r.kind, r.scope_kind) IS DISTINCT FROM ('guide'::text, 'workflow'::text) OR r.scope_value IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 081: a row filed with a workflow should be workflow-scoped guidance, got % % %', r.kind, r.scope_kind, r.scope_value;
  END IF;
  DELETE FROM public.workflows WHERE id = v_wf;
  IF (SELECT scope_kind FROM public.project_constraints WHERE id = v_guide) IS DISTINCT FROM 'project' THEN
    RAISE EXCEPTION 'db-lane 081: deleting the workflow should leave the constraint project-wide';
  END IF;

  -- 2. a check: one predicate of the vocabulary, a severity, a scope
  INSERT INTO public.project_constraints (id, project_id, ctype, description, source_hash, kind, scope_kind, scope_value, check_spec)
    VALUES (v_check, v_proj, 'architecture', 'The web app never talks to the database', 'lane081-2', 'check', 'role', 'frontend',
            '{"predicate": "no_calls_between_roles", "severity": "refuse", "params": {"from": "frontend", "to": "database"}}');

  refused := false;
  BEGIN
    INSERT INTO public.project_constraints (project_id, ctype, description, source_hash, kind, check_spec)
      VALUES (v_proj, 'other', 'Be good', 'lane081-3', 'check', '{"predicate": "be_good", "severity": "warn"}');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'db-lane 081: a predicate outside the vocabulary was stored'; END IF;

  refused := false;
  BEGIN
    INSERT INTO public.project_constraints (project_id, ctype, description, source_hash, kind, check_spec)
      VALUES (v_proj, 'other', 'Schemas everywhere', 'lane081-4', 'guide', '{"predicate": "contract_has_schema", "severity": "warn"}');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'db-lane 081: guidance carried a check'; END IF;

  refused := false;
  BEGIN
    INSERT INTO public.project_constraints (project_id, ctype, description, source_hash, scope_kind)
      VALUES (v_proj, 'other', 'Every worker is idempotent', 'lane081-5', 'role');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'db-lane 081: a role scope was stored without the role'; END IF;

  -- 3. counts: this project's rows only; lastFiredAt moves only on a fire
  INSERT INTO public.project_constraints (id, project_id, ctype, description, source_hash)
    VALUES (v_far, v_other, 'cost', 'Under 40 dollars a month', 'lane081-6');
  n := public.constraints_count(v_proj, jsonb_build_object(
    v_check::text, '{"fired": 1, "violated": 2, "waived": 1}'::jsonb,
    v_far::text, '{"fired": 5}'::jsonb,
    'db810000-0000-4000-8000-0000000000ff', '{"fired": 1}'::jsonb));
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 081: constraints_count moved % rows, expected 1', n; END IF;
  SELECT stats INTO r FROM public.project_constraints WHERE id = v_check;
  IF (r.stats->>'fired')::int <> 1 OR (r.stats->>'violated')::int <> 2 OR (r.stats->>'waived')::int <> 1 OR r.stats->>'lastFiredAt' IS NULL THEN
    RAISE EXCEPTION 'db-lane 081: the counts did not land: %', r.stats;
  END IF;
  IF (SELECT stats FROM public.project_constraints WHERE id = v_far) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'db-lane 081: another project''s constraint was counted';
  END IF;
  PERFORM public.constraints_count(v_proj, jsonb_build_object(v_check::text, '{"violated": 1}'::jsonb));
  IF (SELECT stats->>'lastFiredAt' FROM public.project_constraints WHERE id = v_check) IS DISTINCT FROM r.stats->>'lastFiredAt'
     OR (SELECT (stats->>'violated')::int FROM public.project_constraints WHERE id = v_check) <> 3 THEN
    RAISE EXCEPTION 'db-lane 081: a count without a fire moved lastFiredAt, or did not add';
  END IF;

  -- 4. spec.json in: a check and its scope come in; an unknown check is guidance
  n := public.constraints_from_spec_json(v_proj, '[
    {"type": "performance", "description": "At most two synchronous calls out of the API", "kind": "check",
     "check": {"predicate": "sync_calls_at_most", "severity": "warn", "params": {"max": 2}},
     "scope": {"kind": "role", "value": "backend-service"}},
    {"type": "other", "description": "Be good", "kind": "check", "check": {"predicate": "be_good", "severity": "warn"}}
  ]'::jsonb);
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 081: expected 2 rows in from spec.json, got %', n; END IF;
  SELECT kind, scope_kind, scope_value, check_spec INTO r FROM public.project_constraints
   WHERE project_id = v_proj AND description = 'At most two synchronous calls out of the API';
  IF (r.kind, r.scope_kind, r.scope_value) IS DISTINCT FROM ('check'::text, 'role'::text, 'backend-service'::text) OR r.check_spec->'params'->>'max' <> '2' THEN
    RAISE EXCEPTION 'db-lane 081: the check or its scope did not come in: % % % %', r.kind, r.scope_kind, r.scope_value, r.check_spec;
  END IF;
  IF (SELECT kind FROM public.project_constraints WHERE project_id = v_proj AND description = 'Be good') IS DISTINCT FROM 'guide' THEN
    RAISE EXCEPTION 'db-lane 081: an unknown check should come in as guidance';
  END IF;

  RAISE NOTICE 'db-lane 081: constraints carry a kind, a scope, waivers and counts';
END $$;

ROLLBACK;
