-- db-lane 050: the lease primitive under two agents, on real rows.
--
--   Every checkout behaviour that matters lives in SQL: agent_checkout_claim
--   (migration 20260916100000, the third signature) decides who holds a
--   task, a file or a criterion, refuses a second agent while the first is
--   fresh, and reclaims a hold that has gone silent; the partial unique
--   indexes make the exclusivity the table's, not the function's; the CHECK
--   constraints keep the vocabulary closed; RLS decides which seats see the
--   board. The Deno tests script the RPC's answer. This file runs it: agent A
--   and agent B contend for one task, the silent hold is reclaimed with its
--   audit row, the threshold parameter is honoured, the server's heartbeat,
--   release, bind, resolve and revoke UPDATEs are replayed with their exact
--   filters against the rows they must and must not touch, a direct duplicate
--   insert is refused by the index, advisory holds coexist, criterion holds
--   are exclusive per (requirement, criterion), and the owner, a
--   contributor, a viewer and a stranger each see what their seat allows.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj uuid := 'db500000-0000-4000-8000-000000000010';
  v_br uuid := 'db500000-0000-4000-8000-000000000011';
BEGIN
  IF to_regclass('public.agent_checkouts') IS NULL THEN
    RAISE EXCEPTION 'db-lane 050: public.agent_checkouts is missing. Apply migration 20260913240000.';
  END IF;
  IF to_regprocedure('public.agent_checkout_claim(uuid, text, uuid, text, text, uuid, uuid, uuid, jsonb, integer, text, text, uuid, text[], uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'db-lane 050: agent_checkout_claim with the box-aware signature is missing. Apply migration 20260923190000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 050: no auth.users row to own the fixture. Run supabase db reset.'; END IF;
  PERFORM set_config('lane.owner', v_owner::text, true);

  -- the seats: a contributor and a viewer on the project; the stranger is nobody
  INSERT INTO auth.users (id, email) VALUES
    ('db500000-0000-4000-8000-000000000002', 'db-lane-050-contributor@nodespec.local'),
    ('db500000-0000-4000-8000-000000000003', 'db-lane-050-viewer@nodespec.local');
  -- seats are Team and above (decision 1): the owner is on Team
  DELETE FROM public.stripe_subscriptions WHERE user_id = v_owner;
  INSERT INTO public.stripe_subscriptions (user_id, plan_name, status) VALUES (v_owner, 'team', 'active');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 050', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by, is_primary) VALUES (v_br, v_proj, 'main', v_owner, true);
  INSERT INTO public.project_members (project_id, user_id, role, invited_by) VALUES
    (v_proj, 'db500000-0000-4000-8000-000000000002', 'contributor', v_owner),
    (v_proj, 'db500000-0000-4000-8000-000000000003', 'viewer', v_owner);

  -- what can be held: two tasks, a file, two requirements (one for criteria)
  INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title) VALUES
    ('db500000-0000-4000-8000-000000000021', v_proj, 'db500000-0000-4000-8000-0000000000a1', 't1', 'T1', 'Pour the pool'),
    ('db500000-0000-4000-8000-000000000022', v_proj, 'db500000-0000-4000-8000-0000000000a2', 't2', 'T2', 'Cut the bank exit');
  INSERT INTO public.artifacts (id, project_id, type, kind, path, node_id) VALUES
    ('db500000-0000-4000-8000-000000000031', v_proj, 'code', 'source', 'src/pool.ts', 'db500000-0000-4000-8000-0000000000a1');
  INSERT INTO public.project_specifications (id, project_id, vision, created_by) VALUES
    ('db500000-0000-4000-8000-000000000040', v_proj, 'db-lane 050', v_owner);
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, source) VALUES
    ('db500000-0000-4000-8000-000000000041', 'db500000-0000-4000-8000-000000000040', 'REQ-001', 'The pool holds water', 'manual'),
    ('db500000-0000-4000-8000-000000000042', 'db500000-0000-4000-8000-000000000040', 'REQ-002', 'The exit is the only way out', 'manual');

  -- two agents: two keys under the owner's account
  INSERT INTO public.mcp_api_keys (id, user_id, name, key_hash, key_prefix) VALUES
    ('db500000-0000-4000-8000-000000000051', v_owner, 'agent a', 'db50-hash-a', 'ns_live_a'),
    ('db500000-0000-4000-8000-000000000052', v_owner, 'agent b', 'db50-hash-b', 'ns_live_b');

  -- a proposal to bind a drafting hold to
  INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status) VALUES
    ('db500000-0000-4000-8000-000000000060', v_proj, v_br, 'db-lane', 'db50', 'completed');
  INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches) VALUES
    ('db500000-0000-4000-8000-000000000061', 'db500000-0000-4000-8000-000000000060', v_br, v_br, 'pending', '[]'::jsonb);
END $$;

-- ── 1. two agents, one task: the first holds, the second is told who ──
DO $$
DECLARE
  v jsonb;
  v_delegate text;
  n int;
  T1 uuid := 'db500000-0000-4000-8000-000000000021';
  T2 uuid := 'db500000-0000-4000-8000-000000000022';
  KA uuid := 'db500000-0000-4000-8000-000000000051';
  KB uuid := 'db500000-0000-4000-8000-000000000052';
BEGIN
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T1, 'agent', 'agent-a', KA, 'db500000-0000-4000-8000-000000000011', NULL, '{}'::jsonb, 30, NULL, NULL);
  IF NOT (v->>'claimed')::boolean OR (v->>'advisory')::boolean OR v->>'reclaimedFrom' IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 050: agent A should claim the free task exclusively, got %', v;
  END IF;
  PERFORM set_config('lane.a1', v->>'checkoutId', true);
  SELECT holder_delegate INTO v_delegate FROM public.agent_checkouts WHERE id = (v->>'checkoutId')::uuid;
  IF v_delegate <> 'key:' || KA::text THEN
    RAISE EXCEPTION 'db-lane 050: a key holder without a delegate is identified by its key, got %', v_delegate;
  END IF;

  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL);
  IF (v->>'claimed')::boolean OR v->>'heldBy' <> 'agent-a' OR v->>'holderKind' <> 'agent' OR (v->>'stale')::boolean THEN
    RAISE EXCEPTION 'db-lane 050: agent B should be told agent A holds the task, got %', v;
  END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE task_item_id = T1 AND released_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: a refused claim leaves one active hold, found %', n; END IF;

  -- B works something else meanwhile
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL);
  IF NOT (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 050: agent B should claim the other task, got %', v; END IF;
  PERFORM set_config('lane.b2', v->>'checkoutId', true);
END $$;

-- ── 2. a silent hold is reclaimed with its audit row; the threshold is honoured ──
DO $$
DECLARE
  v jsonb;
  v_reason text;
  n int;
  T1 uuid := 'db500000-0000-4000-8000-000000000021';
  KA uuid := 'db500000-0000-4000-8000-000000000051';
  KB uuid := 'db500000-0000-4000-8000-000000000052';
BEGIN
  UPDATE public.agent_checkouts SET heartbeat_at = now() - interval '31 minutes' WHERE id = current_setting('lane.a1')::uuid;

  -- a longer threshold still sees A holding
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 60, 'key:' || KB::text, NULL);
  IF (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 050: 31 silent minutes is fresh under a 60 minute threshold, got %', v; END IF;

  -- the default threshold reclaims
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL);
  IF NOT (v->>'claimed')::boolean OR (v->>'reclaimedFrom')::uuid <> current_setting('lane.a1')::uuid THEN
    RAISE EXCEPTION 'db-lane 050: agent B should reclaim the silent hold and be told whose it was, got %', v;
  END IF;
  PERFORM set_config('lane.b1', v->>'checkoutId', true);
  SELECT released_reason INTO v_reason FROM public.agent_checkouts WHERE id = current_setting('lane.a1')::uuid AND released_at IS NOT NULL;
  IF v_reason IS DISTINCT FROM 'reclaimed' THEN RAISE EXCEPTION 'db-lane 050: the reclaimed hold stays as audit with reason reclaimed, got %', v_reason; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE task_item_id = T1 AND released_at IS NULL AND holder_label = 'agent-b';
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: exactly one active hold on the task, agent B''s, found %', n; END IF;

  -- and A cannot take it back while B is fresh
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T1, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, NULL, NULL);
  IF (v->>'claimed')::boolean OR v->>'heldBy' <> 'agent-b' THEN RAISE EXCEPTION 'db-lane 050: agent A is told agent B holds it now, got %', v; END IF;
END $$;

-- ── 3. heartbeat and release the way the server writes them: the filters decide ──
DO $$
DECLARE
  n int;
  v_before timestamptz;
  v_after timestamptz;
BEGIN
  -- checkout_heartbeat: .eq(id).eq(project_id).is(released_at, null); a reclaimed hold cannot be heartbeated back
  UPDATE public.agent_checkouts SET heartbeat_at = now()
   WHERE id = current_setting('lane.a1')::uuid AND project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 050: a reclaimed hold must not accept a heartbeat, updated %', n; END IF;

  SELECT heartbeat_at INTO v_before FROM public.agent_checkouts WHERE id = current_setting('lane.b1')::uuid;
  UPDATE public.agent_checkouts SET heartbeat_at = clock_timestamp()
   WHERE id = current_setting('lane.b1')::uuid AND project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT heartbeat_at INTO v_after FROM public.agent_checkouts WHERE id = current_setting('lane.b1')::uuid;
  IF n <> 1 OR v_after <= v_before THEN RAISE EXCEPTION 'db-lane 050: a live hold takes the heartbeat, updated % (% -> %)', n, v_before, v_after; END IF;

  -- release_checkout from another project cannot land
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released'
   WHERE id = current_setting('lane.b1')::uuid AND project_id = 'db500000-0000-4000-8000-0000000000ff' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 050: a release scoped to another project must touch nothing, updated %', n; END IF;

  -- the holder releases; a second release finds nothing
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released'
   WHERE id = current_setting('lane.b1')::uuid AND project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: the holder releases its live hold, updated %', n; END IF;
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released'
   WHERE id = current_setting('lane.b1')::uuid AND project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 050: a released hold is not released twice, updated %', n; END IF;

  -- the release vocabulary and the pairing are the table's
  BEGIN
    UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'done' WHERE id = current_setting('lane.b2')::uuid;
    RAISE EXCEPTION 'db-lane 050: an unknown release reason landed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.agent_checkouts SET released_at = now() WHERE id = current_setting('lane.b2')::uuid;
    RAISE EXCEPTION 'db-lane 050: a release without a reason landed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── 4. exclusivity is the index's, and the vocabulary is the table's ──
DO $$
DECLARE
  v_owner uuid := current_setting('lane.owner')::uuid;
BEGIN
  -- B still holds T2 (lane.b2): a second active task hold on it, written around the RPC, is refused
  BEGIN
    INSERT INTO public.agent_checkouts (project_id, level, holder_kind, holder_label, task_item_id)
      VALUES ('db500000-0000-4000-8000-000000000010', 'task', 'agent', 'agent-c', 'db500000-0000-4000-8000-000000000022');
    RAISE EXCEPTION 'db-lane 050: a second active hold on one task landed around the RPC';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.agent_checkouts (project_id, level, holder_kind, holder_label, artifact_id)
      VALUES ('db500000-0000-4000-8000-000000000010', 'task', 'agent', 'agent-c', 'db500000-0000-4000-8000-000000000031');
    RAISE EXCEPTION 'db-lane 050: a task hold on a file landed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.agent_checkouts (project_id, level, holder_kind, holder_label, requirement_id)
      VALUES ('db500000-0000-4000-8000-000000000010', 'criterion', 'agent', 'agent-c', 'db500000-0000-4000-8000-000000000041');
    RAISE EXCEPTION 'db-lane 050: a criterion hold without a criterion landed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.agent_checkouts (project_id, level, holder_kind, holder_label, task_item_id)
      VALUES ('db500000-0000-4000-8000-000000000010', 'task', 'robot', 'agent-c', 'db500000-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'db-lane 050: a holder kind outside agent/human landed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── 5. a file is exclusive, a requirement is advisory, a criterion is exclusive per pair ──
DO $$
DECLARE
  v jsonb;
  n int;
  A1 uuid := 'db500000-0000-4000-8000-000000000031';
  R1 uuid := 'db500000-0000-4000-8000-000000000041';
  R2 uuid := 'db500000-0000-4000-8000-000000000042';
  KA uuid := 'db500000-0000-4000-8000-000000000051';
  KB uuid := 'db500000-0000-4000-8000-000000000052';
BEGIN
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'code', A1, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, NULL, NULL);
  IF NOT (v->>'claimed')::boolean OR (v->>'advisory')::boolean THEN RAISE EXCEPTION 'db-lane 050: a file is claimed exclusively, got %', v; END IF;
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'code', A1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, NULL, NULL);
  IF (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 050: a held file refuses the second agent, got %', v; END IF;

  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'requirement', R1, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, NULL, NULL);
  IF NOT (v->>'claimed')::boolean OR NOT (v->>'advisory')::boolean THEN RAISE EXCEPTION 'db-lane 050: a requirement hold is advisory, got %', v; END IF;
  PERFORM set_config('lane.ar1', v->>'checkoutId', true);
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'requirement', R1, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, NULL);
  IF NOT (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 050: two agents may draft on one requirement, got %', v; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE requirement_id = R1 AND level = 'requirement' AND released_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 050: both advisory holds are active, found %', n; END IF;

  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'criterion', R2, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, NULL, 'c1');
  IF NOT (v->>'claimed')::boolean OR (v->>'advisory')::boolean THEN RAISE EXCEPTION 'db-lane 050: a criterion is claimed exclusively, got %', v; END IF;
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'criterion', R2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, 'c1');
  IF (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 050: the same criterion refuses the second agent, got %', v; END IF;
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'criterion', R2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, 'key:' || KB::text, 'c2');
  IF NOT (v->>'claimed')::boolean THEN RAISE EXCEPTION 'db-lane 050: another criterion of the same requirement is free, got %', v; END IF;
  BEGIN
    v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'criterion', R2, 'agent', 'agent-b', KB, NULL, NULL, '{}'::jsonb, 30, NULL, NULL);
    RAISE EXCEPTION 'db-lane 050: a criterion claim without criterion_id was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%criterion level needs criterion_id%' THEN RAISE; END IF;
  END;
END $$;

-- ── 6. binding a drafting hold to a proposal, and releasing on resolve, the server's way ──
DO $$
DECLARE
  n int;
  v_reason text;
  KA uuid := 'db500000-0000-4000-8000-000000000051';
  P uuid := 'db500000-0000-4000-8000-000000000061';
  R1 uuid := 'db500000-0000-4000-8000-000000000041';
BEGIN
  -- bindHoldsToProposal (requirement arm): the filing credential's unbound holds on the requirements named, nobody else's
  UPDATE public.agent_checkouts SET proposal_id = P
   WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND level = 'requirement' AND holder_delegate = 'key:' || KA::text
     AND released_at IS NULL AND proposal_id IS NULL AND requirement_id IN (R1);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: filing binds the filer''s one unbound hold, bound %', n; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE requirement_id = R1 AND level = 'requirement' AND released_at IS NULL AND proposal_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: agent B''s drafting hold stays unbound, found % unbound', n; END IF;

  -- releaseHoldsForProposal: only what is bound to it, as resolved
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'resolved' WHERE proposal_id = P AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: resolving releases the one bound hold, released %', n; END IF;
  SELECT released_reason INTO v_reason FROM public.agent_checkouts WHERE id = current_setting('lane.ar1')::uuid;
  IF v_reason <> 'resolved' THEN RAISE EXCEPTION 'db-lane 050: the bound hold ends as resolved, got %', v_reason; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE requirement_id = R1 AND level = 'requirement' AND released_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 050: agent B''s hold survives another agent''s resolve, active %', n; END IF;
END $$;

-- ── 7. revoking a key releases that key's live holds and nobody else's; the task is free again ──
DO $$
DECLARE
  n int;
  v jsonb;
  KA uuid := 'db500000-0000-4000-8000-000000000051';
  KB uuid := 'db500000-0000-4000-8000-000000000052';
  T2 uuid := 'db500000-0000-4000-8000-000000000022';
BEGIN
  -- B holds: T2 (task), REQ-001 (advisory), REQ-002 c2 (criterion)
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE holder_key_id = KB AND released_at IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'db-lane 050: agent B holds three things before the revoke, found %', n; END IF;
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE holder_key_id = KB AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 3 THEN RAISE EXCEPTION 'db-lane 050: the revoke releases agent B''s three holds, released %', n; END IF;
  -- A holds: the file, REQ-002 c1
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE holder_key_id = KA AND released_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 050: agent A''s holds survive agent B''s revoke, found %', n; END IF;
  v := public.agent_checkout_claim('db500000-0000-4000-8000-000000000010', 'task', T2, 'agent', 'agent-a', KA, NULL, NULL, '{}'::jsonb, 30, NULL, NULL);
  IF NOT (v->>'claimed')::boolean OR v->>'reclaimedFrom' IS NOT NULL THEN RAISE EXCEPTION 'db-lane 050: the task the revoke freed is claimable without a reclaim, got %', v; END IF;
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  PERFORM set_config('lane.active', n::text, true);
END $$;

-- ── 8. the board by seat: owner, contributor and viewer see it; a viewer cannot write; a stranger sees nothing ──
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  IF n <> current_setting('lane.active')::int THEN RAISE EXCEPTION 'db-lane 050: the owner sees the whole live board (%), saw %', current_setting('lane.active'), n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db500000-0000-4000-8000-000000000002"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  IF n <> current_setting('lane.active')::int THEN RAISE EXCEPTION 'db-lane 050: a contributor sees the live board (%), saw %', current_setting('lane.active'), n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db500000-0000-4000-8000-000000000003"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  IF n <> current_setting('lane.active')::int THEN RAISE EXCEPTION 'db-lane 050: a viewer sees the live board (%), saw %', current_setting('lane.active'), n; END IF;
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 050: a viewer releases nothing, released %', n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db500000-0000-4000-8000-000000000099"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.agent_checkouts WHERE project_id = 'db500000-0000-4000-8000-000000000010';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 050: a stranger sees no hold, saw %', n; END IF;
  UPDATE public.agent_checkouts SET released_at = now(), released_reason = 'released' WHERE project_id = 'db500000-0000-4000-8000-000000000010' AND released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 050: a stranger releases nothing, released %', n; END IF;
END $$;
RESET ROLE;

SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
BEGIN
  RAISE NOTICE 'db-lane 050: two agents contend and the first holds; a silent hold is reclaimed with its audit row under the threshold given; heartbeat, release, bind, resolve and revoke touch exactly their rows; the index and the checks close the table; owner, contributor and viewer see the board, a viewer and a stranger write nothing';
END $$;
ROLLBACK;
