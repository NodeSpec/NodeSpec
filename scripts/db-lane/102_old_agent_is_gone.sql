-- db-lane 102: the old agent's token tracking is gone (owner 2026-09-29),
-- migration 20260929120000.
--
--   Signup still works: idempotent_free_subscription makes one Free row and a
--   second call makes none; a signed-in person cannot call it.
--   The seven tables, the allowance columns, the model-choice columns and the
--   meaning-search functions are gone.
--   Deleting a project still finishes with the summaries table gone (the
--   delete skips a table that does not exist).
--   On a database that still has all of it (stand-ins here, and this Postgres
--   has no pgvector, so the vector type is text), the migration removes every
--   table, column, index and function; replaying it on the result changes
--   nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regclass('public.token_usage') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'stripe_subscriptions' AND column_name = 'token_limit') THEN
    RAISE EXCEPTION 'db-lane 102: the old agent''s tables are still here. Apply migration 20260929120000.';
  END IF;
END $$;

-- Everything of the old agent still in the database: tables, columns, the
-- meaning-search functions and index, and functions that name them in a
-- statement they would run. project_delete_step names the summaries table in
-- its list of tables to clear and skips it when it is missing (section 3
-- runs it), so it is not counted.
CREATE FUNCTION pg_temp.left_behind() RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(x ORDER BY x) FROM (
    SELECT 'table ' || t AS x FROM unnest(ARRAY[
      'token_usage', 'token_grants', 'token_addons', 'token_rollover',
      'generation_events', 'user_api_keys', 'repo_index_node_summaries']) AS t
    WHERE to_regclass('public.' || t) IS NOT NULL
    UNION ALL
    SELECT 'column ' || table_name || '.' || column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'stripe_subscriptions' AND column_name IN ('token_limit', 'is_lifetime_limit'))
        OR (table_name = 'user_settings' AND column_name IN ('ai_provider', 'ai_model', 'use_global_ai'))
        OR (table_name = 'repo_index' AND column_name IN ('embedding', 'embedding_model', 'embedded_sha')))
    UNION ALL
    SELECT 'index idx_repo_index_embedding' WHERE to_regclass('public.idx_repo_index_embedding') IS NOT NULL
    UNION ALL
    SELECT 'function ' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname <> 'project_delete_step'
      AND (p.proname IN ('repo_index_semantic_search', 'repo_index_semantics_available')
        OR p.prosrc ~ '(token_usage|token_grants|token_addons|token_rollover|generation_events|user_api_keys|repo_index_node_summaries|token_limit|is_lifetime_limit|use_global_ai)')
  ) s
$$;

-- ── 1. signup makes one Free row, and only the service can call it ────────
DO $$
DECLARE
  v_user uuid := 'db102000-0000-4000-8000-000000000001';
  v_rows int;
  v_refused boolean := false;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'db102-signup@nodespec.local');
  PERFORM public.idempotent_free_subscription(v_user, 'cus_db102');
  PERFORM public.idempotent_free_subscription(v_user, 'cus_db102');
  SELECT count(*) INTO v_rows FROM public.stripe_subscriptions
  WHERE user_id = v_user AND plan_name = 'community' AND status = 'active' AND amount_cents = 0;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'db-lane 102: signup made % Free rows, not one', v_rows; END IF;
  IF has_function_privilege('authenticated', 'public.idempotent_free_subscription(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.idempotent_free_subscription(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db-lane 102: a person can call idempotent_free_subscription';
  END IF;
END $$;

-- ── 2. nothing of the old agent is left ───────────────────────────────────
DO $$
BEGIN
  IF pg_temp.left_behind() IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 102: still present: %', pg_temp.left_behind();
  END IF;
END $$;

-- ── 3. a project still deletes to the end ─────────────────────────────────
DO $$
DECLARE
  v_owner uuid := 'db102000-0000-4000-8000-000000000002';
  v_proj uuid := 'db102000-0000-4000-8000-00000000000a';
  r jsonb;
  i int := 0;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'db102-owner@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 102', v_owner);
  LOOP
    i := i + 1;
    r := public.project_delete_step(v_proj, 500, 2000);
    EXIT WHEN COALESCE((r->>'done')::boolean, false);
    IF i > 50 THEN RAISE EXCEPTION 'db-lane 102: project delete not done after 50 steps: %', r; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_proj) THEN
    RAISE EXCEPTION 'db-lane 102: the project survived its delete';
  END IF;
END $$;

-- ── 4. a database that still had the lane loses it; replay changes nothing ─
-- Stand-ins for everything the migration removes, as a database before it
-- had them: the seven tables, the allowance and model-choice columns, and the
-- pgvector lane (its columns, index and both functions, with text in place of
-- the vector type).
CREATE TABLE public.token_usage (id uuid PRIMARY KEY, user_id uuid, input_tokens int, output_tokens int);
CREATE TABLE public.token_grants (id uuid PRIMARY KEY, user_id uuid, amount int);
CREATE TABLE public.token_addons (id uuid PRIMARY KEY, user_id uuid, tokens int);
CREATE TABLE public.token_rollover (id uuid PRIMARY KEY, user_id uuid, rollover_tokens int);
CREATE TABLE public.generation_events (id uuid PRIMARY KEY, project_id uuid);
CREATE TABLE public.user_api_keys (id uuid PRIMARY KEY, user_id uuid, api_key_encrypted text);
CREATE TABLE public.repo_index_node_summaries (branch_id uuid, node_id text, summary text, PRIMARY KEY (branch_id, node_id));
ALTER TABLE public.stripe_subscriptions ADD COLUMN token_limit integer DEFAULT 0, ADD COLUMN is_lifetime_limit boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_settings ADD COLUMN ai_provider text, ADD COLUMN ai_model text, ADD COLUMN use_global_ai boolean;
ALTER TABLE public.repo_index ADD COLUMN embedding text, ADD COLUMN embedding_model text, ADD COLUMN embedded_sha text;
CREATE INDEX idx_repo_index_embedding ON public.repo_index (embedding);
CREATE FUNCTION public.repo_index_semantic_search(uuid, text, text, integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.repo_index_semantics_available() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
DO $$
BEGIN
  IF coalesce(array_length(pg_temp.left_behind(), 1), 0) <> 18 THEN
    RAISE EXCEPTION 'db-lane 102: the stand-ins should be 18 objects, are %', pg_temp.left_behind();
  END IF;
END $$;
\ir ../../supabase/migrations/20260929120000_v3_retire_token_usage.sql
CREATE TEMP TABLE shape_before AS
  SELECT 'col' AS k, table_name || '.' || column_name AS v FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'fn', p.oid::regprocedure::text || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL SELECT 'idx', indexname FROM pg_indexes WHERE schemaname = 'public';
CREATE TEMP TABLE subs_before AS SELECT * FROM public.stripe_subscriptions;
\ir ../../supabase/migrations/20260929120000_v3_retire_token_usage.sql
DO $$
BEGIN
  IF pg_temp.left_behind() IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 102: the migration left behind: %', pg_temp.left_behind();
  END IF;
  IF EXISTS (
    (SELECT 'col', table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'
     UNION ALL SELECT 'fn', p.oid::regprocedure::text || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     UNION ALL SELECT 'idx', indexname FROM pg_indexes WHERE schemaname = 'public')
    EXCEPT SELECT k, v FROM shape_before)
  OR EXISTS (
    SELECT k, v FROM shape_before
    EXCEPT (SELECT 'col', table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'
     UNION ALL SELECT 'fn', p.oid::regprocedure::text || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     UNION ALL SELECT 'idx', indexname FROM pg_indexes WHERE schemaname = 'public')) THEN
    RAISE EXCEPTION 'db-lane 102: replaying the migration changed the schema';
  END IF;
  IF EXISTS (SELECT * FROM public.stripe_subscriptions EXCEPT SELECT * FROM subs_before)
     OR EXISTS (SELECT * FROM subs_before EXCEPT SELECT * FROM public.stripe_subscriptions) THEN
    RAISE EXCEPTION 'db-lane 102: replaying the migration changed the subscriptions';
  END IF;
  RAISE NOTICE 'db-lane 102: signup makes one Free row (service only), the old agent''s tables, allowance, model choice and meaning-search lane are gone, a project still deletes, and replay changes nothing';
END $$;
ROLLBACK;
