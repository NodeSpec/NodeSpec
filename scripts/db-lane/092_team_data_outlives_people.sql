-- db-lane 092: a team's project outlives the people who worked on it
-- (V3 audit, owner 2026-09-27).
--
--   A contributor who first saved the vision, a previous owner who handed
--   the project over, and a teammate who resolved a change card can each
--   delete their account: the specification, the branch with its snapshots,
--   and the card stay, their creator columns cleared. An owner whose project
--   holds seats cannot delete the account until the seats are gone. A signed-in
--   person cannot write agent keys; a revoked key stays revoked for every
--   writer. The provisioning helpers are the server's. The repository
--   connection is changed at maintainer, not contributor.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  A uuid := 'db920000-0000-4000-8000-00000000000a';  -- owner, then hands over
  B uuid := 'db920000-0000-4000-8000-00000000000b';  -- contributor, then new owner
  C uuid := 'db920000-0000-4000-8000-00000000000c';  -- contributor who resolves a card
  D uuid := 'db920000-0000-4000-8000-00000000000d';  -- owner of a seated project
  E uuid := 'db920000-0000-4000-8000-00000000000e';  -- the seat on D's project, who stays
  P uuid := 'db920000-0000-4000-8000-000000000100';
  Q uuid := 'db920000-0000-4000-8000-000000000200';
  BR uuid := 'db920000-0000-4000-8000-000000000101';
  SPEC uuid := 'db920000-0000-4000-8000-000000000102';
  GI uuid := 'db920000-0000-4000-8000-000000000103';
  n int; v_by uuid; v_err text;
BEGIN
  IF to_regprocedure('public.refuse_account_delete_with_seats()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refuse_account_delete_with_seats') THEN
    RAISE EXCEPTION 'db-lane 092: the account-deletion guard is missing. Apply migration 20260927110000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    (A, 'db-lane-092-a@nodespec.local'), (B, 'db-lane-092-b@nodespec.local'),
    (C, 'db-lane-092-c@nodespec.local'), (D, 'db-lane-092-d@nodespec.local'), (E, 'db-lane-092-e@nodespec.local');
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (A, 'team', 'active'), (B, 'team', 'active'), (D, 'team', 'active');
  INSERT INTO public.projects (id, name, owner_id) VALUES (P, 'db-lane 092', A), (Q, 'db-lane 092 seated', D);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (BR, P, 'main', A, true);
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence) VALUES
    (P, BR, jsonb_build_object('id', BR, 'schemaVersion', 8, 'version', 0, 'hash', 'db92', 'nodes', '{}'::jsonb, 'edges', '{}'::jsonb, 'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb), 'db92', 0);
  INSERT INTO public.project_members (project_id, user_id, role, invited_by) VALUES (P, B, 'contributor', A), (P, C, 'contributor', A), (Q, E, 'viewer', D);
  INSERT INTO public.project_specifications (id, project_id, created_by, vision) VALUES (SPEC, P, B, 'A shared vision');
  INSERT INTO public.specification_requirements (specification_id, requirement_id, name, category, acceptance_criteria) VALUES (SPEC, 'REQ-001', 'Shared', 'functional', '[]');
  INSERT INTO public.git_integrations (id, project_id, provider, repo_owner, repo_name, default_branch, created_by, access_token_encrypted)
    VALUES (GI, P, 'github', 'o', 'r', 'main', B, 'x');
  INSERT INTO public.git_change_events (project_id, integration_id, commit_sha, status, resolved_by) VALUES (P, GI, 'db92sha', 'accepted', C);

  -- the contributor who first saved the vision and connected the repo leaves
  DELETE FROM auth.users WHERE id = B;
  SELECT count(*) INTO n FROM public.specification_requirements WHERE specification_id = SPEC;
  SELECT created_by INTO v_by FROM public.project_specifications WHERE id = SPEC;
  IF n <> 1 OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 092: the vision''s first author left, the specification should stay unattributed (reqs %, created_by %)', n, v_by;
  END IF;
  SELECT created_by INTO v_by FROM public.git_integrations WHERE id = GI;
  IF NOT FOUND OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 092: the repo connection should outlive the teammate who made it';
  END IF;

  -- the teammate who resolved a card leaves
  DELETE FROM auth.users WHERE id = C;
  SELECT resolved_by INTO v_by FROM public.git_change_events WHERE project_id = P;
  IF NOT FOUND OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 092: a card resolved by a teammate who left should stay, unattributed';
  END IF;

  -- A hands P to a new owner and keeps a seat, then leaves
  INSERT INTO auth.users (id, email) VALUES (B, 'db-lane-092-b2@nodespec.local');
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (B, 'team', 'active');
  UPDATE public.projects SET owner_id = B WHERE id = P;
  INSERT INTO public.project_members (project_id, user_id, role, invited_by) VALUES (P, A, 'maintainer', B);
  DELETE FROM auth.users WHERE id = A;
  SELECT count(*) INTO n FROM public.graph_snapshots WHERE branch_id = BR;
  SELECT created_by INTO v_by FROM public.branches WHERE id = BR;
  IF n <> 1 OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 092: the previous owner left, the branch and its snapshots should stay (snapshots %, created_by %)', n, v_by;
  END IF;

  -- an owner with a seated project cannot leave until the seats are gone
  BEGIN
    DELETE FROM auth.users WHERE id = D;
    RAISE EXCEPTION 'db-lane 092: an owner with a seated project was deleted';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF position('"db-lane 092 seated"' IN v_err) = 0 OR position('Hand each one over' IN v_err) = 0 THEN
      RAISE EXCEPTION 'db-lane 092: the refusal should name the project and the way out, got %', v_err;
    END IF;
  END;
  DELETE FROM public.project_members WHERE project_id = Q;
  DELETE FROM auth.users WHERE id = D;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = Q) THEN
    RAISE EXCEPTION 'db-lane 092: once the seats are gone the owner''s account and project go';
  END IF;
  PERFORM set_config('lane.owner', B::text, true);
END $$;

-- ── agent keys: minted and revoked by the server only; a revocation is final ──
DO $$
BEGIN
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix, scopes, revoked_at)
    VALUES ('db920000-0000-4000-8000-000000000301', current_setting('lane.owner')::uuid, 'db92 key', 'db92-hash', 'ns_live_9', ARRAY['read'], now() - interval '1 hour');
  UPDATE public.mcp_api_keys SET revoked_at = NULL, expires_at = now() + interval '10 years' WHERE id = 'db920000-0000-4000-8000-000000000301';
  IF (SELECT revoked_at IS NULL OR expires_at IS NOT NULL FROM public.mcp_api_keys WHERE id = 'db920000-0000-4000-8000-000000000301') THEN
    RAISE EXCEPTION 'db-lane 092: a revoked key came back';
  END IF;
  IF (SELECT is_valid FROM public.validate_mcp_api_key('db92-hash')) THEN
    RAISE EXCEPTION 'db-lane 092: a revoked key validated after an un-revoke attempt';
  END IF;
  BEGIN
    UPDATE public.mcp_api_keys SET key_hash = 'db92-other' WHERE id = 'db920000-0000-4000-8000-000000000301';
    RAISE EXCEPTION 'db-lane 092: a key changed its secret';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    INSERT INTO public.mcp_api_keys (user_id, name, key_hash, key_prefix, scopes)
      VALUES (current_setting('lane.owner')::uuid, 'direct', 'db92-direct', 'ns_live_d', ARRAY['read']);
    RAISE EXCEPTION 'db-lane 092: a signed-in person minted a key past the server';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.mcp_api_keys SET name = 'renamed' WHERE id = 'db920000-0000-4000-8000-000000000301';
    RAISE EXCEPTION 'db-lane 092: a signed-in person wrote a key row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.mcp_api_keys WHERE id = 'db920000-0000-4000-8000-000000000301';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 092: the owner still reads their own keys'; END IF;
  BEGIN
    PERFORM public.idempotent_customer_insert(current_setting('lane.owner')::uuid, 'cus_db92');
    RAISE EXCEPTION 'db-lane 092: a signed-in person called the customer helper';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_provisioning_health();
    RAISE EXCEPTION 'db-lane 092: a non-admin read provisioning health';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- anon carries no user: clear the sub the signed-in block set, or auth.uid()
-- would still answer that person and the admin check would mask a grant
SELECT set_config('request.jwt.claim.role', 'anon', true),
       set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'db-lane 092: the anon block still carries a user'; END IF;
  BEGIN
    PERFORM public.idempotent_free_subscription('db920000-0000-4000-8000-00000000000b', 'cus_db92');
    RAISE EXCEPTION 'db-lane 092: anon called the subscription helper';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_provisioning_health();
    RAISE EXCEPTION 'db-lane 092: anon read provisioning health';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ── the admin list of pending accounts works again (it failed for everyone) ──
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
-- An admin is one by token (app_metadata), not by a settings row (the RLS audit).
SELECT set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s","app_metadata":{"is_admin":true}}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.get_users_pending_provisioning();
  IF n IS NULL THEN RAISE EXCEPTION 'db-lane 092: the pending list should answer an admin'; END IF;
END $$;
RESET ROLE;

-- ── the repository connection: a contributor uses it, a maintainer changes it ──
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('db920000-0000-4000-8000-0000000000e1', 'db-lane-092-contrib@nodespec.local'),
    ('db920000-0000-4000-8000-0000000000e2', 'db-lane-092-maint@nodespec.local');
  INSERT INTO public.project_members (project_id, user_id, role, invited_by) VALUES
    ('db920000-0000-4000-8000-000000000100', 'db920000-0000-4000-8000-0000000000e1', 'contributor', current_setting('lane.owner')::uuid),
    ('db920000-0000-4000-8000-000000000100', 'db920000-0000-4000-8000-0000000000e2', 'maintainer', current_setting('lane.owner')::uuid);
END $$;
SELECT set_config('request.jwt.claim.sub', 'db920000-0000-4000-8000-0000000000e1', true),
       set_config('request.jwt.claims', '{"role":"authenticated","sub":"db920000-0000-4000-8000-0000000000e1"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.git_integrations WHERE id = 'db920000-0000-4000-8000-000000000103';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 092: a contributor still sees the repo connection'; END IF;
  UPDATE public.git_integrations SET commit_mode = 'pull-request' WHERE id = 'db920000-0000-4000-8000-000000000103';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 092: a contributor changed the repo connection'; END IF;
  DELETE FROM public.git_integrations WHERE id = 'db920000-0000-4000-8000-000000000103';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 092: a contributor removed the repo connection'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'db920000-0000-4000-8000-0000000000e2', true),
       set_config('request.jwt.claims', '{"role":"authenticated","sub":"db920000-0000-4000-8000-0000000000e2"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  UPDATE public.git_integrations SET commit_mode = 'pull-request' WHERE id = 'db920000-0000-4000-8000-000000000103';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 092: a maintainer should change the repo connection, updated %', n; END IF;
  RAISE NOTICE 'db-lane 092: shared data outlives its creators, a seated owner waits for the hand-over, agent keys and provisioning helpers are the server''s, the repo connection is the maintainer''s';
END $$;
RESET ROLE;
ROLLBACK;
