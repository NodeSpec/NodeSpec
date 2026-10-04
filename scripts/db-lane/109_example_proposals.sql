-- db-lane 109: the example's Proposals are what real writers store (V3 AL.2; owner
-- 2026-10-01: "audit and ensure, even with our example seed project, that the data this
-- actually displays will be quality and associated to real information an agent will
-- propose or activity it undertakes").
--
--   Under migration 20261001120000 Ada holds the first bakery example. Then 20261001140000
--   runs, twice, and:
--   - Ada's first bakery is gone, her grant cleared; her next call makes version 2 under
--     the same id, and the seed's own verification passes inside that call;
--   - every proposal names who filed it as the server stamps it: the agent's OAuth client
--     (claude-code, on Ada's own account id), a teammate by email, the import as the
--     repository import; the import row is the pipeline's (source, job, summary);
--   - an auto-applied row is a routed requirement edit; the rejected row carries
--     resolve_proposal's note with every patch rejected; a canvas change waits as intents;
--     the task documents were filed by generate_task_docs and approved;
--   - nothing the product never writes: no mapping marked for review, no flagged
--     candidate, only the import's own question kinds;
--   - the holds and the proposed plan carry the same OAuth delegate;
--   - Cy, who deleted his example, is not given one; replaying leaves version 2 alone.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.act_as(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', p_user), true);
$$;
CREATE FUNCTION pg_temp.act_server() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
CREATE TEMP TABLE lane_ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON lane_ids TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.ensure_example_project()') IS NULL OR to_regprocedure('public.example_project_sql()') IS NULL THEN
    RAISE EXCEPTION 'db-lane 109: the example project functions are missing. Apply migration 20260930150000, then 20261001140000.';
  END IF;
  INSERT INTO auth.users (id, email) VALUES
    ('db109000-0000-4000-8000-000000000001', 'db-lane-109-ada@nodespec.local'),
    ('db109000-0000-4000-8000-000000000002', 'db-lane-109-cy@nodespec.local');
END $$;

-- ── 1. under the first bakery ──
\ir ../../supabase/migrations/20260930150000_v3_example_project.sql
\ir ../../supabase/migrations/20261001120000_v3_example_bakery.sql
SELECT pg_temp.act_as('db109000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO lane_ids VALUES ('ada-v1', public.ensure_example_project()); END $$;
RESET ROLE;
SELECT pg_temp.act_as('db109000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v uuid := public.ensure_example_project(); BEGIN DELETE FROM public.projects WHERE id = v; END $$;
RESET ROLE;
SELECT pg_temp.act_server();
DO $$
DECLARE v1 uuid := (SELECT id FROM lane_ids WHERE k = 'ada-v1');
BEGIN
  IF (SELECT metadata->>'example' FROM public.projects WHERE id = v1) IS DISTINCT FROM 'harbor-lane-bakery'
     OR (SELECT metadata ? 'exampleVersion' FROM public.projects WHERE id = v1) THEN
    RAISE EXCEPTION 'db-lane 109: under 20261001120000 Ada should hold the first bakery, unversioned';
  END IF;
  -- the shapes this replaces: a mapping for review and a proposal naming nobody
  IF NOT EXISTS (SELECT 1 FROM public.specification_mappings m JOIN public.project_specifications sp ON sp.id = m.specification_id AND sp.project_id = v1 WHERE m.validation_status = 'needs-review') THEN
    RAISE EXCEPTION 'db-lane 109: the first bakery was expected to carry mappings for review';
  END IF;
END $$;

-- ── 2. version 2 replaces it ──
\ir ../../supabase/migrations/20261001140000_v3_example_proposals.sql
CREATE TEMP TABLE lane_109_once AS
  SELECT md5(p.prosrc) AS src FROM pg_proc p WHERE p.oid = 'public.example_project_sql()'::regprocedure;
\ir ../../supabase/migrations/20261001140000_v3_example_proposals.sql
DO $$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.example_project_sql()'::regprocedure) IS DISTINCT FROM (SELECT src FROM lane_109_once) THEN
    RAISE EXCEPTION 'db-lane 109: replaying the migration changed the example SQL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = (SELECT id FROM lane_ids WHERE k = 'ada-v1')) THEN
    RAISE EXCEPTION 'db-lane 109: Ada''s first bakery survived the migration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = 'db109000-0000-4000-8000-000000000001' AND preferences ? 'exampleProject') THEN
    RAISE EXCEPTION 'db-lane 109: Ada''s grant should be cleared with her first bakery';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = 'db109000-0000-4000-8000-000000000002' AND preferences ? 'exampleProject') THEN
    RAISE EXCEPTION 'db-lane 109: Cy deleted his example; his grant should stay';
  END IF;
END $$;

-- ── 3. Ada's next call: version 2, on her own ids ──
SELECT pg_temp.act_as('db109000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ BEGIN INSERT INTO lane_ids VALUES ('ada-v2', public.ensure_example_project()); END $$;
RESET ROLE;
SELECT pg_temp.act_as('db109000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.ensure_example_project() IS NOT NULL THEN RAISE EXCEPTION 'db-lane 109: Cy deleted his example; none is made again'; END IF; END $$;
RESET ROLE;
SELECT pg_temp.act_server();

-- replaying now leaves version 2 in place
\ir ../../supabase/migrations/20261001140000_v3_example_proposals.sql

DO $$
DECLARE
  p uuid := (SELECT id FROM lane_ids WHERE k = 'ada-v2');
  ada text := 'db109000-0000-4000-8000-000000000001';
  delegate text;
  bad int;
  r record;
BEGIN
  IF p IS NULL OR p IS DISTINCT FROM (SELECT id FROM lane_ids WHERE k = 'ada-v1') THEN
    RAISE EXCEPTION 'db-lane 109: Ada''s version 2 should come back under the same id';
  END IF;
  IF (SELECT (metadata->>'exampleVersion')::int FROM public.projects WHERE id = p) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'db-lane 109: Ada''s example is not version 2 (or the replay removed it)';
  END IF;

  -- who filed each proposal, as the server stamps it
  SELECT count(*) INTO bad FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
   WHERE NOT (ap.metadata->>'source' = 'repo-import' OR coalesce(ap.metadata->>'credentialLabel', '') <> '');
  IF bad > 0 THEN RAISE EXCEPTION 'db-lane 109: % proposal(s) name nobody', bad; END IF;
  SELECT DISTINCT ap.metadata->>'credential' INTO delegate FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
   WHERE ap.metadata->>'authMethod' = 'oauth_token' AND ap.metadata->>'credential' IS NOT NULL;
  IF delegate IS NULL OR delegate !~ ('^oauth:' || ada || ':claude-code\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'db-lane 109: the agent''s delegate should be Ada''s OAuth client claude-code, is %', delegate;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
              WHERE ap.metadata->>'authMethod' = 'oauth_token' AND ap.metadata->>'credentialLabel' IS DISTINCT FROM 'oauth ' || chr(183) || ' claude-code') THEN
    RAISE EXCEPTION 'db-lane 109: an agent proposal is not labelled oauth, claude-code';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_checkouts WHERE project_id = p AND holder_kind = 'agent' AND holder_delegate IS DISTINCT FROM delegate)
     OR (SELECT proposed_by FROM public.work_plans WHERE project_id = p AND status = 'proposed') IS DISTINCT FROM delegate THEN
    RAISE EXCEPTION 'db-lane 109: the holds and the proposed plan should carry the same delegate';
  END IF;

  -- each row in its writer's shape
  SELECT ap.* INTO r FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
   WHERE ap.metadata->>'source' = 'repo-import';
  IF r.status <> 'merged' OR r.metadata->>'jobId' IS NULL OR coalesce(r.metadata->>'summary', '') = '' THEN
    RAISE EXCEPTION 'db-lane 109: the import row is not the pipeline''s (merged, a job, a summary)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
              WHERE (ap.metadata->>'auto')::boolean IS TRUE
                AND NOT (ap.patches->0->'patch'->>'type' = 'update_requirement' AND ap.patches->0->>'explanation' = ap.patches->0->'patch'->'metadata'->>'summary')) THEN
    RAISE EXCEPTION 'db-lane 109: an auto-applied row is not a routed requirement edit';
  END IF;
  SELECT ap.* INTO r FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p WHERE ap.status = 'rejected';
  IF coalesce(r.metadata->>'resolveNote', '') = '' OR r.metadata ? 'rejectionReason'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.patches) e WHERE e->>'status' <> 'rejected') THEN
    RAISE EXCEPTION 'db-lane 109: the rejection is not resolve_proposal''s (a note, every patch rejected)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
                  WHERE ap.status = 'pending' AND jsonb_array_length(ap.metadata->'intents') = 2
                    AND ap.patches @> '[{"patch": {"type": "add_node"}}]' AND ap.patches @> '[{"patch": {"type": "add_edge"}}]') THEN
    RAISE EXCEPTION 'db-lane 109: no canvas change waits as intents';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
                  WHERE ap.status = 'merged' AND ap.metadata->>'source' = 'mcp-task-docs' AND jsonb_array_length(ap.patches) = 10) THEN
    RAISE EXCEPTION 'db-lane 109: the task documents generate_task_docs filed are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
              WHERE ap.proposal_branch_id <> ap.source_branch_id) THEN
    RAISE EXCEPTION 'db-lane 109: a proposal points at another branch than the one it was filed on';
  END IF;

  -- nothing the product never writes
  IF EXISTS (SELECT 1 FROM public.specification_mappings m JOIN public.project_specifications sp ON sp.id = m.specification_id AND sp.project_id = p WHERE m.validation_status = 'needs-review')
     OR EXISTS (SELECT 1 FROM public.requirement_candidates WHERE project_id = p AND evidence ? 'reviewNote')
     OR EXISTS (SELECT 1 FROM public.import_jobs j, jsonb_array_elements(j.open_questions) q
                 WHERE j.project_id = p AND (q->>'kind' IN ('unresolved_edge', 'missing_contract_schema', 'ungrouped_node') OR NOT q ? 'group')) THEN
    RAISE EXCEPTION 'db-lane 109: version 2 still carries a row shape nothing in the product writes';
  END IF;

  RAISE NOTICE 'db-lane 109: version 2 replaces the first bakery, every proposal names its filer as the server stamps it, every row is its writer''s shape, and nothing unwritten remains';
END $$;

ROLLBACK;
