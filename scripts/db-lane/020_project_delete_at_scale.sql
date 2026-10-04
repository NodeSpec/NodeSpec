-- db-lane 020: project_delete_step removes a large project completely,
-- one bounded step at a time, with every step inside the browser's cap.
--
-- Two production incidents (2026-09-06, 2026-09-17) and three unit files
-- that only read the migration's text. This file deletes a project the
-- way the app does (rpc project_delete_step until done) against rows that
-- look like a repo import left them: tens of thousands of repo index rows
-- and edges, hundreds of multi-kilobyte snapshots, a hash-chained patch
-- log, AI runs that point at snapshots across the NO ACTION foreign key,
-- proposals, candidates in a lane, artifacts, task items and git change
-- events. Then it counts what is left in every table the cascade reaches.
--
-- Asserted:
--   1. the function carries its own statement_timeout (the 2026-09-17 fix);
--   2. every step returns under 8000 ms, the cap the browser role has;
--   3. the delete finishes (done=true) within a bounded number of steps;
--   4. zero rows remain for the project or its branch in every table the
--      drain list and the final cascade cover, and the project row is gone;
--   5. calling again after it is gone answers done with 'gone', not an error;
--   6. a project with the V3 tables filled (decided outcomes filed on steps,
--      couplings between them, workflow-scoped constraints) deletes too,
--      one row a step: the step-map terminal rule holds, the V3 tables are
--      drained by steps rather than left to the final cascade, and nothing
--      is left. Release 2026-09-28: in
--      production's migration order the 13 Sep drain list replaced the
--      17 Sep one; migration 20260928100000 is the one both orders end on.
-- Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner  uuid;
  v_proj   uuid := 'db200000-0000-4000-8000-000000000010';
  v_br     uuid := 'db200000-0000-4000-8000-000000000020';
  v_job    uuid := 'db200000-0000-4000-8000-000000000030';
  v_lane   uuid := 'db200000-0000-4000-8000-000000000040';
  v_integ  uuid := 'db200000-0000-4000-8000-000000000050';
  v_snap0  uuid;
  v_run    uuid;
  r        jsonb;
  v_iter   int := 0;
  v_t      timestamptz;
  v_ms     int;
  v_max_ms int := 0;
  v_total  bigint := 0;
  v_left   bigint;
  v_leftovers text := '';
  rec      record;
  v_big    jsonb;
BEGIN
  IF to_regprocedure('public.project_delete_step(uuid,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 020: project_delete_step(uuid,integer,integer) is not on this stack. Apply migration 20260917100000.';
  END IF;

  -- 1. the 2026-09-17 fix: a function-local statement_timeout, like search_path.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
     WHERE p.proname = 'project_delete_step' AND c LIKE 'statement_timeout=%'
  ) THEN
    RAISE EXCEPTION 'db-lane 020: project_delete_step does not carry its own statement_timeout; the browser role''s 8 s cap applies to it';
  END IF;

  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'db-lane 020: no auth.users row to own the fixture. Run supabase db reset.';
  END IF;

  -- ── the fixture: what a repo import leaves behind ────────────────────
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 020 large import', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.workflows (id, project_id, name) VALUES (v_lane, v_proj, 'Imported');
  INSERT INTO public.import_jobs (id, project_id) VALUES (v_job, v_proj);
  INSERT INTO public.git_integrations (id, project_id, provider, repo_owner, repo_name, access_token_encrypted, created_by)
    VALUES (v_integ, v_proj, 'github', 'bench', 'db-lane', 'not-a-token', v_owner);

  -- 20 000 indexed files and 20 000 resolved imports.
  INSERT INTO public.repo_index (branch_id, path, blob_sha)
    SELECT v_br, 'src/module' || (i / 100) || '/file' || i || '.ts', md5(i::text)
      FROM generate_series(1, 20000) i;
  INSERT INTO public.repo_index_edges (branch_id, from_path, to_path, kind)
    SELECT v_br, 'src/module' || (i / 100) || '/file' || i || '.ts', 'src/module' || ((i + 1) / 100) || '/file' || (i + 1) || '.ts', 'import'
      FROM generate_series(1, 20000) i;
  -- 2 000 staged import files.
  INSERT INTO public.import_job_files (job_id, path)
    SELECT v_job, 'src/module' || (i / 100) || '/file' || i || '.ts' FROM generate_series(1, 2000) i;

  -- 300 snapshots of ~60 kB each: the byte-sized batching case.
  -- graph_data must satisfy graph_data_has_required_keys: the envelope keys
  -- plus the four maps as objects.
  SELECT jsonb_build_object('id', 'db-lane-020', 'schemaVersion', 1, 'version', 1, 'hash', 'h',
                            'nodes', (SELECT jsonb_object_agg('n' || j, jsonb_build_object('label', repeat('x', 400))) FROM generate_series(1, 120) j),
                            'edges', '{}'::jsonb, 'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb)
    INTO v_big;
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence)
    SELECT v_proj, v_br, v_big, md5('snap' || i), i FROM generate_series(1, 300) i;
  SELECT id INTO v_snap0 FROM public.graph_snapshots WHERE branch_id = v_br ORDER BY patch_sequence DESC LIMIT 1;

  -- 3 000 hash-chained patches (the trigger derives every hash).
  INSERT INTO public.graph_patches (id, branch_id, sequence, patch_type, actor_type, summary, payload)
    SELECT gen_random_uuid(), v_br, i, 'update_node', 'ai', 'db-lane patch ' || i, jsonb_build_object('id', 'n' || (i % 120 + 1))
      FROM generate_series(1, 3000) i;

  -- 50 AI runs, every one pointing at a snapshot across the NO ACTION FK,
  -- each with a proposal. The old drain order (snapshots before runs)
  -- raised a foreign-key violation here.
  FOR i IN 1..50 LOOP
    INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status, input_snapshot_id)
      VALUES (gen_random_uuid(), v_proj, v_br, 'db-lane', md5('run' || i), 'completed', v_snap0)
      RETURNING id INTO v_run;
    INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches)
      VALUES (gen_random_uuid(), v_run, v_br, v_br, 'pending', '[]'::jsonb);
  END LOOP;

  -- 500 candidates in the lane, 500 artifacts, 200 task items, 50 change events.
  INSERT INTO public.requirement_candidates (project_id, branch_id, workflow_id, key, kind, name)
    SELECT v_proj, v_br, v_lane, 'outcome:db' || i, 'outcome', 'db-lane outcome ' || i FROM generate_series(1, 500) i;
  INSERT INTO public.artifacts (id, project_id, type)
    SELECT gen_random_uuid(), v_proj, 'file' FROM generate_series(1, 500) i;
  INSERT INTO public.task_items (project_id, node_id, task_key)
    SELECT v_proj, gen_random_uuid(), 'task-' || i FROM generate_series(1, 200) i;
  INSERT INTO public.git_change_events (integration_id, project_id, commit_sha)
    SELECT v_integ, v_proj, md5('commit' || i) FROM generate_series(1, 50) i;

  -- ── delete it the way the app does ────────────────────────────────────
  LOOP
    v_iter := v_iter + 1;
    v_t := clock_timestamp();
    SELECT public.project_delete_step(v_proj, 20000, 2500) INTO r;
    v_ms := (extract(epoch FROM (clock_timestamp() - v_t)) * 1000)::int;
    v_max_ms := GREATEST(v_max_ms, v_ms);
    v_total := v_total + COALESCE((r->>'deleted')::bigint, 0);
    IF v_ms > 8000 THEN
      RAISE EXCEPTION 'db-lane 020: step % took % ms, over the 8 s browser cap (answer %)', v_iter, v_ms, r;
    END IF;
    EXIT WHEN COALESCE((r->>'done')::boolean, false);
    IF v_iter > 400 THEN
      RAISE EXCEPTION 'db-lane 020: not done after 400 steps; last answer %', r;
    END IF;
  END LOOP;

  -- ── nothing left ──────────────────────────────────────────────────────
  FOR rec IN
    SELECT * FROM (VALUES
      ('repo_index_edges', 'branch_id'), ('node_dependencies', 'branch_id'), ('repo_index_freshness', 'branch_id'),
      ('repo_index_node_summaries', 'branch_id'), ('repo_index', 'branch_id'), ('requirement_candidates', 'branch_id'),
      ('graph_patches', 'branch_id'), ('graph_snapshots', 'branch_id'), ('ai_proposals', 'source_branch_id'),
      ('import_jobs', 'project_id'), ('ai_runs', 'project_id'), ('artifacts', 'project_id'),
      ('git_change_events', 'project_id'), ('task_items', 'project_id'), ('workflows', 'project_id'),
      ('git_integrations', 'project_id'), ('branches', 'project_id'), ('project_specifications', 'project_id'),
      ('specification_requirements', 'project_id'), ('project_constraints', 'project_id'), ('agent_checkouts', 'project_id'),
      ('work_plans', 'project_id')
    ) AS t(tbl, col)
  LOOP
    CONTINUE WHEN to_regclass('public.' || rec.tbl) IS NULL;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = rec.tbl AND column_name = rec.col);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', rec.tbl, rec.col)
      INTO v_left USING CASE WHEN rec.col LIKE '%branch_id' THEN v_br ELSE v_proj END;
    IF v_left > 0 THEN v_leftovers := v_leftovers || format(' %s=%s', rec.tbl, v_left); END IF;
  END LOOP;
  -- the job's own children
  FOR rec IN SELECT * FROM (VALUES ('import_job_files'), ('import_job_edges'), ('import_job_groups'), ('import_job_group_edges'), ('import_job_rank'), ('import_job_waves')) AS t(tbl) LOOP
    CONTINUE WHEN to_regclass('public.' || rec.tbl) IS NULL;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE job_id = $1', rec.tbl) INTO v_left USING v_job;
    IF v_left > 0 THEN v_leftovers := v_leftovers || format(' %s=%s', rec.tbl, v_left); END IF;
  END LOOP;
  IF v_leftovers <> '' THEN
    RAISE EXCEPTION 'db-lane 020: rows left behind after done:%', v_leftovers;
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_proj) THEN
    RAISE EXCEPTION 'db-lane 020: the project row survived the delete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner) THEN
    RAISE EXCEPTION 'db-lane 020: the delete reached auth.users';
  END IF;

  -- 5. idempotent: a project that is already gone answers done.
  SELECT public.project_delete_step(v_proj, 20000, 2500) INTO r;
  IF COALESCE((r->>'done')::boolean, false) IS DISTINCT FROM true OR r->>'project' IS DISTINCT FROM 'gone' THEN
    RAISE EXCEPTION 'db-lane 020: a second call on a gone project should answer done/gone, got %', r;
  END IF;

  RAISE NOTICE 'db-lane 020: % steps, % rows deleted, slowest step % ms, nothing left behind', v_iter, v_total, v_max_ms;
END $$;

-- 6. the V3 tables, one row a step.
DO $$
DECLARE
  v_owner uuid;
  v_proj  uuid := 'db200000-0000-4000-8000-000000000110';
  v_br    uuid := 'db200000-0000-4000-8000-000000000120';
  v_wf    uuid := 'db200000-0000-4000-8000-000000000130';
  v_step  uuid := 'db200000-0000-4000-8000-000000000140';
  v_snap  uuid;
  v_run   uuid;
  r       jsonb;
  v_iter  int := 0;
  v_named text[] := '{}';
  v_left  bigint;
  v_leftovers text := '';
  v_tbl   text;
  rec     record;
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;

  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 020 V3 tables', v_owner);
  INSERT INTO public.branches (id, project_id, name, created_by) VALUES (v_br, v_proj, 'main', v_owner);
  INSERT INTO public.workflows (id, project_id, name) VALUES (v_wf, v_proj, 'Checkout');
  INSERT INTO public.workflow_steps (id, workflow_id, name) VALUES (v_step, v_wf, 'Pay');

  -- 30 outcomes filed on the step, then decided: the terminal rule now
  -- refuses to delete their maps while the outcomes stand.
  INSERT INTO public.requirement_candidates (project_id, branch_id, workflow_id, key, kind, name)
    SELECT v_proj, v_br, v_wf, 'outcome:v3-' || i, 'outcome', 'db-lane decided outcome ' || i FROM generate_series(1, 30) i;
  INSERT INTO public.outcome_step_maps (branch_id, candidate_id, step_id)
    SELECT v_br, c.id, v_step FROM public.requirement_candidates c WHERE c.branch_id = v_br;
  UPDATE public.requirement_candidates SET status = 'accepted' WHERE branch_id = v_br;

  -- each outcome waits on the next
  INSERT INTO public.couplings (branch_id, scope, coupling_type, from_candidate_id, to_candidate_id)
    SELECT v_br, 'intra', 'waits_on', a.id, b.id
      FROM (SELECT id, row_number() OVER (ORDER BY key) n FROM public.requirement_candidates WHERE branch_id = v_br) a
      JOIN (SELECT id, row_number() OVER (ORDER BY key) n FROM public.requirement_candidates WHERE branch_id = v_br) b ON b.n = a.n + 1;

  -- 10 constraints scoped to the workflow: each must keep its workflow.
  INSERT INTO public.project_constraints (project_id, description, source_hash, scope_kind, workflow_id)
    SELECT v_proj, 'db-lane workflow rule ' || i, md5('rule' || i), 'workflow', v_wf FROM generate_series(1, 10) i;

  -- a run on a snapshot, across the NO ACTION foreign key
  INSERT INTO public.graph_snapshots (project_id, branch_id, graph_data, hash, patch_sequence)
    VALUES (v_proj, v_br, jsonb_build_object('id', 'db-lane-020-v3', 'schemaVersion', 1, 'version', 1, 'hash', 'h',
            'nodes', '{}'::jsonb, 'edges', '{}'::jsonb, 'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb), md5('v3snap'), 1)
    RETURNING id INTO v_snap;
  INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status, input_snapshot_id)
    VALUES (gen_random_uuid(), v_proj, v_br, 'db-lane', md5('v3run'), 'completed', v_snap)
    RETURNING id INTO v_run;

  LOOP
    v_iter := v_iter + 1;
    SELECT public.project_delete_step(v_proj, 1, 2500) INTO r;
    EXIT WHEN COALESCE((r->>'done')::boolean, false);
    IF r->>'table' IS NOT NULL AND NOT (r->>'table' = ANY (v_named)) THEN
      v_named := v_named || (r->>'table');
    END IF;
    IF v_iter > 1000 THEN
      RAISE EXCEPTION 'db-lane 020 (6): not done after 1000 steps; last answer %', r;
    END IF;
  END LOOP;

  FOREACH v_tbl IN ARRAY ARRAY['couplings', 'project_constraints', 'workflows'] LOOP
    IF NOT (v_tbl = ANY (v_named)) THEN
      RAISE EXCEPTION 'db-lane 020 (6): % was never drained by a step (left to the final cascade); steps named %', v_tbl, v_named;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT * FROM (VALUES
      ('requirement_candidates', 'branch_id', v_br), ('outcome_step_maps', 'branch_id', v_br), ('couplings', 'branch_id', v_br),
      ('project_constraints', 'project_id', v_proj), ('workflows', 'project_id', v_proj), ('workflow_steps', 'workflow_id', v_wf),
      ('ai_runs', 'project_id', v_proj), ('graph_snapshots', 'branch_id', v_br), ('branches', 'project_id', v_proj)
    ) AS t(tbl, col, val)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', rec.tbl, rec.col) INTO v_left USING rec.val;
    IF v_left > 0 THEN v_leftovers := v_leftovers || format(' %s=%s', rec.tbl, v_left); END IF;
  END LOOP;
  IF v_leftovers <> '' OR EXISTS (SELECT 1 FROM public.projects WHERE id = v_proj) THEN
    RAISE EXCEPTION 'db-lane 020 (6): left behind after done:%', v_leftovers;
  END IF;

  RAISE NOTICE 'db-lane 020 (6): % steps, drained by step: %', v_iter, v_named;
END $$;

ROLLBACK;
