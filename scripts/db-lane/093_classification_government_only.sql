-- db-lane 093: classification is the Government install's alone
-- (V3 audit, owner 2026-09-27: "Government classification should not be
-- present in any builds other than our future government build").
--
--   A plan_name naming Government or Enterprise is Team on the managed site.
--   No mark and no clearance is set outside a Government install: not on the
--   managed site, not on a self-hosted (open source or Enterprise) database,
--   not by the server. Clearing a mark, and an empty clearance, are allowed
--   everywhere. A Government install (nodespec.edition = government on the
--   database) sets them, on the Government plan.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  A uuid := 'db930000-0000-4000-8000-00000000000a';
  B uuid := 'db930000-0000-4000-8000-00000000000b';
  P uuid := 'db930000-0000-4000-8000-000000000100';
  K uuid := 'db930000-0000-4000-8000-000000000101';
  v_refused boolean;
  v_msg text;
  n int;
BEGIN
  IF to_regprocedure('public.plan_guard_mark()') IS NULL
     OR position('nodespec.edition' IN pg_get_functiondef('public.plan_guard_mark()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db-lane 093: marks are not yet the Government install''s alone. Apply migration 20260927120000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES (A, 'db093-a@nodespec.local'), (B, 'db093-b@nodespec.local');

  -- the hosted ceiling
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (A, 'Government Annual', 'active');
  IF public.account_plan_tier(A) <> 'team' THEN RAISE EXCEPTION 'db-lane 093: a hosted Government plan is %', public.account_plan_tier(A); END IF;
  UPDATE public.stripe_subscriptions SET plan_name = 'enterprise' WHERE user_id = A;
  IF public.account_plan_tier(A) <> 'team' THEN RAISE EXCEPTION 'db-lane 093: a hosted Enterprise plan is %', public.account_plan_tier(A); END IF;
  UPDATE public.stripe_subscriptions SET plan_name = 'indie' WHERE user_id = A;
  IF public.account_plan_tier(A) <> 'indie' THEN RAISE EXCEPTION 'db-lane 093: an Indie plan is %', public.account_plan_tier(A); END IF;
  UPDATE public.stripe_subscriptions SET plan_name = 'government' WHERE user_id = A;

  INSERT INTO public.projects (id, name, owner_id) VALUES (P, 'db-lane 093', A);
  INSERT INTO public.project_constraints (id, project_id, description, source_hash) VALUES (K, P, 'Keep it on shore', 'db093-k');

  -- the managed site: the server itself sets no mark
  v_refused := false;
  BEGIN
    UPDATE public.project_constraints SET mark = 'CUI' WHERE id = K;
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; v_msg := SQLERRM;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 093: a mark was set on the managed site'; END IF;
  IF v_msg <> 'Classification marks are part of NodeSpec for Government only; this database is not a Government install.' THEN
    RAISE EXCEPTION 'db-lane 093: the refusal reads %', v_msg;
  END IF;
  v_refused := false;
  BEGIN
    INSERT INTO public.project_members (project_id, user_id, role, clearance) VALUES (P, B, 'viewer', ARRAY['CUI']);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 093: a clearance was granted on the managed site'; END IF;
  INSERT INTO public.project_members (project_id, user_id, role, clearance) VALUES (P, B, 'viewer', '{}');

  -- a self-hosted database (open source or Enterprise) sets none either
  INSERT INTO public.deployment_settings (mode) VALUES ('self-hosted');
  v_refused := false;
  BEGIN
    UPDATE public.project_constraints SET mark = 'CUI' WHERE id = K;
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 093: a mark was set on a self-hosted database'; END IF;
  v_refused := false;
  BEGIN
    UPDATE public.project_members SET clearance = ARRAY['CUI'] WHERE project_id = P AND user_id = B;
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 093: a clearance was granted on a self-hosted database'; END IF;
END $$;

-- a Government install: marks and clearances land
SET LOCAL nodespec.edition = 'government';
DO $$
DECLARE n int;
BEGIN
  UPDATE public.project_constraints SET mark = 'CUI' WHERE id = 'db930000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 093: a Government install should set a mark'; END IF;
  UPDATE public.project_members SET clearance = ARRAY['CUI'] WHERE project_id = 'db930000-0000-4000-8000-000000000100' AND user_id = 'db930000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 093: a Government install should grant a clearance'; END IF;
END $$;
RESET nodespec.edition;

-- elsewhere again: clearing is allowed, setting is not
DELETE FROM public.deployment_settings;
DO $$
DECLARE n int;
BEGIN
  UPDATE public.project_constraints SET mark = NULL WHERE id = 'db930000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 093: clearing a mark should be allowed everywhere'; END IF;
  UPDATE public.project_members SET clearance = '{}' WHERE project_id = 'db930000-0000-4000-8000-000000000100' AND user_id = 'db930000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 093: emptying a clearance should be allowed everywhere'; END IF;
  RAISE NOTICE 'db-lane 093: a hosted Government or Enterprise plan is Team; no mark or clearance is set on the managed site, a self-hosted database or by the server; a Government install sets them; clearing is allowed everywhere';
END $$;
ROLLBACK;
