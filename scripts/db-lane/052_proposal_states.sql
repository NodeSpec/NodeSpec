-- db-lane 052: a proposal settles once, and the seats that may touch it.
--
--   resolve_proposal decides in TypeScript; what the database holds is the
--   status vocabulary, the compare-and-set the handler relies on (a row
--   moves only while it is still pending, so two resolvers cannot both
--   land), the seat policy on ai_proposals, and the promote trigger that
--   an accept fires. The Deno tests script the update's answer; this file
--   replays the handler's exact UPDATE against real rows: a settled row
--   refuses, the first resolver lands, the second finds nothing, and a
--   rejected proposal never returns to pending. Then each seat: the owner
--   and a maintainer read and write, a contributor and a viewer read only
--   (V3 H, migration 20260921120000: a session writes a proposal row only
--   from the seat that may settle one), a stranger sees nothing. An accept
--   of a proposal that carries no import job leaves import_jobs alone.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj uuid := 'db520000-0000-4000-8000-000000000010';
  v_br uuid := 'db520000-0000-4000-8000-000000000011';
BEGIN
  IF to_regclass('public.ai_proposals') IS NULL THEN
    RAISE EXCEPTION 'db-lane 052: public.ai_proposals is missing. Apply migration 20251230175830.';
  END IF;
  IF to_regprocedure('public.import_promote_on_proposal_accept()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 052: import_promote_on_proposal_accept() is missing. Apply migration 20260814605000.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_proposals'
                   AND policyname = 'Proposal writes follow the approver''s seat') THEN
    RAISE EXCEPTION 'db-lane 052: the maintainer write policy on ai_proposals is missing. Apply migration 20260921120000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 052: no auth.users row to own the fixture. Run supabase db reset.'; END IF;
  PERFORM set_config('lane.owner', v_owner::text, true);

  INSERT INTO auth.users (id, email) VALUES
    ('db520000-0000-4000-8000-000000000002', 'db-lane-052-maintainer@nodespec.local'),
    ('db520000-0000-4000-8000-000000000003', 'db-lane-052-contributor@nodespec.local'),
    ('db520000-0000-4000-8000-000000000004', 'db-lane-052-viewer@nodespec.local');
  -- seats are Team and above (decision 1): the owner is on Team
  DELETE FROM public.stripe_subscriptions WHERE user_id = v_owner;
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (v_owner, 'team', 'active');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 052', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);
  INSERT INTO public.project_members (project_id, user_id, role, invited_by) VALUES
    (v_proj, 'db520000-0000-4000-8000-000000000002', 'maintainer', v_owner),
    (v_proj, 'db520000-0000-4000-8000-000000000003', 'contributor', v_owner),
    (v_proj, 'db520000-0000-4000-8000-000000000004', 'viewer', v_owner);
  INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status) VALUES
    ('db520000-0000-4000-8000-000000000060', v_proj, v_br, 'db-lane', 'db52', 'completed');
  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, metadata) VALUES
    ('db520000-0000-4000-8000-000000000061', 'db520000-0000-4000-8000-000000000060', v_br, v_br, 'pending', '[{"patch":{"type":"update_vision"},"status":"pending"}]'::jsonb, '{"plane":"spec"}'::jsonb),
    ('db520000-0000-4000-8000-000000000062', 'db520000-0000-4000-8000-000000000060', v_br, v_br, 'pending', '[]'::jsonb, '{"plane":"spec"}'::jsonb),
    ('db520000-0000-4000-8000-000000000063', 'db520000-0000-4000-8000-000000000060', v_br, v_br, 'merged',  '[]'::jsonb, '{"plane":"spec"}'::jsonb);
END $$;

-- ── 1. the vocabulary is closed ──
DO $$
BEGIN
  BEGIN
    UPDATE public.ai_proposals SET status = 'approved' WHERE id = 'db520000-0000-4000-8000-000000000061';
    RAISE EXCEPTION 'db-lane 052: a status outside the vocabulary landed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── 2. the compare-and-set: pending moves once ──
DO $$
DECLARE n int; v_status text;
BEGIN
  -- the handler's reject: .eq(id).eq(status, pending) on a settled row
  UPDATE public.ai_proposals SET status = 'rejected', reviewed_at = now()
   WHERE id = 'db520000-0000-4000-8000-000000000063' AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: a merged proposal must not be re-resolved, updated %', n; END IF;

  -- the first resolver lands
  UPDATE public.ai_proposals SET status = 'rejected', reviewed_at = now()
   WHERE id = 'db520000-0000-4000-8000-000000000061' AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: the first resolver settles the pending proposal, updated %', n; END IF;

  -- the second resolver, an accept racing the reject, finds nothing
  UPDATE public.ai_proposals SET status = 'merged', merged_at = now(), reviewed_at = now()
   WHERE id = 'db520000-0000-4000-8000-000000000061' AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: the second resolver must find nothing, updated %', n; END IF;
  SELECT status INTO v_status FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000061';
  IF v_status <> 'rejected' THEN RAISE EXCEPTION 'db-lane 052: the settled outcome is the first resolver''s, got %', v_status; END IF;
END $$;

-- ── 3. seats: owner and maintainer read and write; a viewer reads; a stranger sees nothing ──
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000062';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: the owner reads the pending proposal, saw %', n; END IF;
  UPDATE public.ai_proposals SET metadata = metadata || '{"seenBy":"owner"}'::jsonb WHERE id = 'db520000-0000-4000-8000-000000000062';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: the owner writes the proposal, updated %', n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db520000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db520000-0000-4000-8000-000000000002"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000062';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: a maintainer reads the pending proposal, saw %', n; END IF;
  UPDATE public.ai_proposals SET metadata = metadata || '{"seenBy":"maintainer"}'::jsonb WHERE id = 'db520000-0000-4000-8000-000000000062';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: a maintainer writes the proposal, updated %', n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db520000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db520000-0000-4000-8000-000000000003"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000062';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: a contributor reads the pending proposal, saw %', n; END IF;
  -- V3 H (owner's ruling 2026-09-21): the ladder says a contributor never
  -- settles a proposal, and the table now agrees: a contributor's own
  -- session updates, inserts and deletes nothing here.
  UPDATE public.ai_proposals SET metadata = metadata || '{"seenBy":"contributor"}'::jsonb WHERE id = 'db520000-0000-4000-8000-000000000062';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: a contributor''s session must write no proposal row, updated %', n; END IF;
  BEGIN
    INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches)
      VALUES ('db520000-0000-4000-8000-000000000064', 'db520000-0000-4000-8000-000000000060', 'db520000-0000-4000-8000-000000000011', 'db520000-0000-4000-8000-000000000011', 'pending', '[]'::jsonb);
    RAISE EXCEPTION 'db-lane 052: a contributor''s session inserted a proposal row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000062';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: a contributor''s session must delete no proposal row, deleted %', n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db520000-0000-4000-8000-000000000004';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db520000-0000-4000-8000-000000000004"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000062';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: a viewer reads the pending proposal, saw %', n; END IF;
  UPDATE public.ai_proposals SET status = 'rejected' WHERE id = 'db520000-0000-4000-8000-000000000062' AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: a viewer settles nothing, updated %', n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db520000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db520000-0000-4000-8000-000000000099"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ai_proposals WHERE source_branch_id = 'db520000-0000-4000-8000-000000000011';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: a stranger sees no proposal, saw %', n; END IF;
  UPDATE public.ai_proposals SET status = 'rejected' WHERE id = 'db520000-0000-4000-8000-000000000062' AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 052: a stranger settles nothing, updated %', n; END IF;
END $$;
RESET ROLE;

-- ── 4. an accept of a proposal without an import job leaves import_jobs alone ──
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE n int; v_jobs bigint; v_status text;
BEGIN
  SELECT count(*) INTO v_jobs FROM public.import_jobs;
  UPDATE public.ai_proposals SET status = 'merged', merged_at = now(), reviewed_at = now()
   WHERE id = 'db520000-0000-4000-8000-000000000062' AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 052: the service role accepts the pending proposal, updated %', n; END IF;
  IF (SELECT count(*) FROM public.import_jobs) <> v_jobs THEN RAISE EXCEPTION 'db-lane 052: an accept without a jobId must not touch import_jobs'; END IF;
  SELECT status INTO v_status FROM public.ai_proposals WHERE id = 'db520000-0000-4000-8000-000000000062';
  IF v_status <> 'merged' THEN RAISE EXCEPTION 'db-lane 052: the accepted proposal reads merged, got %', v_status; END IF;
  RAISE NOTICE 'db-lane 052: the vocabulary is closed; a proposal settles once and the second resolver finds nothing; owner and maintainer write, a contributor and a viewer read only, a stranger sees nothing; an accept without an import job leaves import_jobs alone';
END $$;
ROLLBACK;
