-- db-lane 064: a proposed work plan is rejected in the app, and only that (V3 6.3).
--
--   work_plans.status admits 'rejected'. One UPDATE policy lets an
--   authenticated maintainer or the owner move a PROPOSED plan to REJECTED
--   through RLS; the same policy refuses accepting from the app (WITH
--   CHECK), a stranger updates nothing, and a rejected plan does not go
--   back to proposed (USING). Accepting stays the server's (accept_work_plan).
--   Q (2026-09-22): Priority is Indie and above, so on a Community project
--   the owner rejects nothing; on Indie the rest holds as before.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj uuid := 'db640000-0000-4000-8000-000000000010';
  v_br uuid := 'db640000-0000-4000-8000-000000000011';
BEGIN
  IF to_regclass('public.work_plans') IS NULL THEN
    RAISE EXCEPTION 'db-lane 064: public.work_plans is missing. Apply migration 20260914160000.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'work_plans' AND policyname = 'Project maintainers can reject a proposed work plan') THEN
    RAISE EXCEPTION 'db-lane 064: the reject policy is missing. Apply migration 20260921110000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 064: no auth.users row to own the fixture. Run supabase db reset.'; END IF;
  PERFORM set_config('lane.owner', v_owner::text, true);
  -- the owner starts on Community (the one active row a person may hold)
  DELETE FROM public.stripe_subscriptions WHERE user_id = v_owner;
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (v_owner, 'community', 'active');

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 064', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);
  INSERT INTO public.work_plans (id, project_id, branch_id, version, status, source_hash, summary)
    VALUES ('db640000-0000-4000-8000-000000000101', v_proj, v_br, 1, 'proposed', md5('064-1'), 'the first proposal'),
           ('db640000-0000-4000-8000-000000000102', v_proj, v_br, 2, 'proposed', md5('064-2'), 'the second proposal');
END $$;

-- ── 0. Q: on Community the owner rejects nothing (Priority is Indie and above) ──
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  UPDATE public.work_plans SET status = 'rejected', updated_at = now() WHERE id = 'db640000-0000-4000-8000-000000000101' AND status = 'proposed';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 064: a Community owner should reject nothing, updated % rows', n; END IF;
END $$;
RESET ROLE;
UPDATE public.stripe_subscriptions SET plan_name = 'indie' WHERE user_id = current_setting('lane.owner')::uuid;

-- ── 1. the owner on Indie, as the app: a proposed plan becomes rejected ──
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; v_refused boolean;
BEGIN
  UPDATE public.work_plans SET status = 'rejected', updated_at = now() WHERE id = 'db640000-0000-4000-8000-000000000101' AND status = 'proposed';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 064: the owner should reject a proposed plan through RLS, updated % rows', n; END IF;

  -- ── 2. the app cannot accept: the policy admits rejected and nothing else ──
  v_refused := false;
  BEGIN
    UPDATE public.work_plans SET status = 'accepted', accepted_at = now() WHERE id = 'db640000-0000-4000-8000-000000000102';
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 064: accepting from the app should be refused by the policy''s WITH CHECK'; END IF;

  -- ── 3. a rejected plan does not go back: the USING arm sees no proposed row ──
  UPDATE public.work_plans SET status = 'proposed' WHERE id = 'db640000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 064: a rejected plan must not return to proposed, updated % rows', n; END IF;
END $$;
RESET ROLE;

-- ── 4. a stranger updates nothing ──
SET LOCAL request.jwt.claim.sub = 'db640000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db640000-0000-4000-8000-000000000099"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  UPDATE public.work_plans SET status = 'rejected' WHERE id = 'db640000-0000-4000-8000-000000000102';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 064: a stranger should update no plan, updated %', n; END IF;
END $$;
RESET ROLE;

-- ── 5. the service role still sees both, one rejected, one proposed ──
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.work_plans WHERE id = 'db640000-0000-4000-8000-000000000101';
  IF v_status <> 'rejected' THEN RAISE EXCEPTION 'db-lane 064: expected rejected, got %', v_status; END IF;
  SELECT status INTO v_status FROM public.work_plans WHERE id = 'db640000-0000-4000-8000-000000000102';
  IF v_status <> 'proposed' THEN RAISE EXCEPTION 'db-lane 064: the second plan should still be proposed, got %', v_status; END IF;
  RAISE NOTICE 'db-lane 064: on Community the owner rejects nothing; on Indie the owner rejects a proposed plan through RLS; the app cannot accept; rejected never returns; a stranger updates nothing';
END $$;
ROLLBACK;
