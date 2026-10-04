


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."account_plan_tier"("p_user" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v text;
BEGIN
  SELECT lower(trim(coalesce(plan_name, ''))) INTO v
    FROM public.stripe_subscriptions
   WHERE user_id = p_user AND status IN ('active', 'trialing')
   ORDER BY current_period_end DESC
   LIMIT 1;
  IF v IS NULL OR v = '' THEN RETURN 'community'; END IF;
  IF v IN ('community', 'indie', 'team') THEN RETURN v; END IF;
  -- the hosted ceiling: an Enterprise or Government plan_name is Team here
  IF v IN ('enterprise', 'government') THEN RETURN 'team'; END IF;
  IF v = 'free' THEN RETURN 'community'; END IF;
  IF v IN ('starter', 'architect', 'pro') THEN RETURN 'team'; END IF;
  IF v LIKE '%government%' THEN RETURN 'team'; END IF;
  IF v LIKE '%enterprise%' THEN RETURN 'team'; END IF;
  IF v LIKE '%team%' THEN RETURN 'team'; END IF;
  IF v LIKE '%pro%' OR v LIKE '%architect%' OR v LIKE '%starter%' THEN RETURN 'team'; END IF;
  IF v LIKE '%indie%' THEN RETURN 'indie'; END IF;
  RETURN 'community';
END;
$$;


ALTER FUNCTION "public"."account_plan_tier"("p_user" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."account_plan_tier"("p_user" "uuid") IS 'Q: the account plan from stripe_subscriptions, canonicalized as _shared/tiers.ts canonicalizeTier and capped at Team as hostedTier (audit 2026-09-27: the managed site sells Free, Indie and Team). Not granted to clients.';



CREATE OR REPLACE FUNCTION "public"."admin_time_in_app"("p_days" integer DEFAULT 30) RETURNS TABLE("user_id" "uuid", "email" "text", "plan" "text", "sessions" bigint, "active_seconds" bigint, "first_seen_at" timestamp with time zone, "last_seen_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'admin_time_in_app: admins only' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deployment_settings d WHERE d.id AND d.mode = 'self-hosted') THEN
    RAISE EXCEPTION 'admin_time_in_app: the managed service only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.user_id,
         u.email::text,
         public.account_plan_tier(s.user_id),
         count(*)::bigint,
         sum(s.active_seconds)::bigint,
         min(s.started_at),
         max(s.last_seen_at)
  FROM public.app_sessions s
  JOIN auth.users u ON u.id = s.user_id
  WHERE s.last_seen_at >= now() - make_interval(days => GREATEST(LEAST(coalesce(p_days, 30), 366), 1))
  GROUP BY s.user_id, u.email
  ORDER BY sum(s.active_seconds) DESC, max(s.last_seen_at) DESC;
END;
$$;


ALTER FUNCTION "public"."admin_time_in_app"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_checkout_claim"("p_project_id" "uuid", "p_level" "text", "p_ref_id" "uuid", "p_holder_kind" "text", "p_holder_label" "text", "p_holder_key_id" "uuid" DEFAULT NULL::"uuid", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_proposal_id" "uuid" DEFAULT NULL::"uuid", "p_meta" "jsonb" DEFAULT '{}'::"jsonb", "p_stale_after_minutes" integer DEFAULT 30, "p_holder_delegate" "text" DEFAULT NULL::"text", "p_criterion_id" "text" DEFAULT NULL::"text", "p_node_id" "uuid" DEFAULT NULL::"uuid", "p_reach" "text"[] DEFAULT NULL::"text"[], "p_box" "uuid" DEFAULT NULL::"uuid", "p_parts" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing public.agent_checkouts%ROWTYPE;
  v_other public.agent_checkouts%ROWTYPE;
  v_stale boolean;
  v_new_id uuid;
  v_reclaimed uuid := NULL;
  v_delegate text := COALESCE(p_holder_delegate, CASE WHEN p_holder_key_id IS NOT NULL THEN 'key:' || p_holder_key_id::text END);
  v_node uuid := p_node_id;
  v_fresh timestamptz := now() - make_interval(mins => GREATEST(p_stale_after_minutes, 1));
  v_reach text[] := CASE WHEN p_reach IS NULL OR cardinality(p_reach) = 0 THEN ARRAY['*'] ELSE p_reach END;
  v_other_reach text[];
  v_coupling text;
  v_meta jsonb := COALESCE(p_meta, '{}'::jsonb);
  -- AA.3: the box this node is a part of, and the parts it holds (the caller reads the graph).
  v_parts uuid[] := COALESCE(p_parts, ARRAY[]::uuid[]);
BEGIN
  IF p_level NOT IN ('task', 'code', 'requirement', 'outcome', 'criterion', 'node') THEN
    RAISE EXCEPTION 'agent_checkout_claim: unknown level %', p_level;
  END IF;
  IF p_project_id IS NULL OR (p_level <> 'node' AND p_ref_id IS NULL) THEN
    RAISE EXCEPTION 'agent_checkout_claim: project and ref are required';
  END IF;
  IF p_level = 'criterion' AND (p_criterion_id IS NULL OR btrim(p_criterion_id) = '') THEN
    RAISE EXCEPTION 'agent_checkout_claim: criterion level needs criterion_id';
  END IF;

  -- The node a work lease sits in: the task's own node when not given.
  IF p_level = 'task' AND v_node IS NULL THEN
    SELECT node_id INTO v_node FROM public.task_items WHERE id = p_ref_id;
  END IF;
  IF p_level = 'code' AND v_node IS NULL THEN
    SELECT node_id INTO v_node FROM public.artifacts WHERE id = p_ref_id;
  END IF;
  IF p_level = 'node' AND v_node IS NULL THEN
    RAISE EXCEPTION 'agent_checkout_claim: node level needs node_id';
  END IF;

  -- Serialize claims per project (the import_wave_claim pattern: one
  -- parent row lock makes "who claimed first" unique).
  PERFORM 1 FROM public.projects WHERE id = p_project_id FOR UPDATE;

  -- ── the same ref: renew your own, read someone else's, reclaim a stale one
  IF p_level IN ('task', 'code', 'criterion', 'node') THEN
    SELECT * INTO v_existing
      FROM public.agent_checkouts
     WHERE released_at IS NULL AND level = p_level
       AND ((p_level = 'task'      AND task_item_id   = p_ref_id)
         OR (p_level = 'code'      AND artifact_id    = p_ref_id)
         OR (p_level = 'criterion' AND requirement_id = p_ref_id AND criterion_id = p_criterion_id)
         OR (p_level = 'node'      AND project_id     = p_project_id AND node_id = v_node))
     LIMIT 1;

    IF FOUND THEN
      -- AA.0: the caller already holds it. Claiming again renews the same
      -- lease (heartbeat, meta merged) instead of refusing its own holder.
      IF v_delegate IS NOT NULL AND v_existing.holder_delegate = v_delegate THEN
        UPDATE public.agent_checkouts
           SET heartbeat_at = now(),
               meta = COALESCE(meta, '{}'::jsonb) || v_meta
         WHERE id = v_existing.id;
        RETURN jsonb_build_object(
          'claimed', true,
          'checkoutId', v_existing.id,
          'advisory', false,
          'renewed', true,
          'reclaimedFrom', NULL);
      END IF;
      v_stale := v_existing.heartbeat_at < v_fresh;
      IF NOT v_stale THEN
        -- Held and fresh: not an error; the caller renders the holder.
        RETURN jsonb_build_object(
          'claimed', false,
          'heldBy', v_existing.holder_label,
          'holderKind', v_existing.holder_kind,
          'since', v_existing.since,
          'heartbeatAt', v_existing.heartbeat_at,
          'stale', false);
      END IF;
      -- Stale-held: reclaim. The old row stays as audit.
      UPDATE public.agent_checkouts
         SET released_at = now(), released_reason = 'reclaimed'
       WHERE id = v_existing.id;
      v_reclaimed := v_existing.id;
    END IF;
  END IF;

  -- ── AA.3: the box's lease covers its parts; a part's waits for the box ────
  IF p_level = 'node' AND (p_box IS NOT NULL OR cardinality(v_parts) > 0) THEN
    SELECT * INTO v_other
      FROM public.agent_checkouts
     WHERE released_at IS NULL AND project_id = p_project_id AND level = 'node'
       AND (node_id = p_box OR node_id = ANY(v_parts))
       AND heartbeat_at >= v_fresh
       AND holder_delegate IS DISTINCT FROM v_delegate
     ORDER BY since
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'conflict', 'node',
        'heldBy', v_other.holder_label,
        'holderKind', v_other.holder_kind,
        'heldLevel', 'node',
        'heldNode', v_other.node_id,
        'relation', CASE WHEN v_other.node_id = p_box THEN 'box' ELSE 'part' END,
        'since', v_other.since,
        'heartbeatAt', v_other.heartbeat_at,
        'stale', false);
    END IF;
  END IF;

  -- ── AA.5: a node lease waits for the work inside the node (AA.3: and its parts)
  IF p_level = 'node' THEN
    SELECT * INTO v_other
      FROM public.agent_checkouts
     WHERE released_at IS NULL AND project_id = p_project_id AND (node_id = v_node OR node_id = ANY(v_parts))
       AND level IN ('task', 'code') AND heartbeat_at >= v_fresh
       AND holder_delegate IS DISTINCT FROM v_delegate
     ORDER BY since
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'conflict', 'work',
        'heldBy', v_other.holder_label,
        'holderKind', v_other.holder_kind,
        'heldLevel', v_other.level,
        'since', v_other.since,
        'heartbeatAt', v_other.heartbeat_at,
        'heldReach', COALESCE(v_other.meta->'reach', '["*"]'::jsonb),
        'stale', false);
    END IF;
  END IF;

  -- ── AA.5: work inside a node: the node lease (AA.3: or its box's), then the reaches
  IF p_level IN ('task', 'code') AND v_node IS NOT NULL THEN
    SELECT * INTO v_other
      FROM public.agent_checkouts
     WHERE released_at IS NULL AND project_id = p_project_id AND (node_id = v_node OR node_id = p_box)
       AND level = 'node' AND heartbeat_at >= v_fresh
       AND holder_delegate IS DISTINCT FROM v_delegate
     ORDER BY (node_id = v_node) DESC
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'conflict', 'node',
        'heldBy', v_other.holder_label,
        'holderKind', v_other.holder_kind,
        'heldLevel', 'node',
        'heldNode', v_other.node_id,
        'relation', CASE WHEN v_other.node_id = v_node THEN 'self' ELSE 'box' END,
        'since', v_other.since,
        'heartbeatAt', v_other.heartbeat_at,
        'stale', false);
    END IF;

    FOR v_other IN
      SELECT *
        FROM public.agent_checkouts
       WHERE released_at IS NULL AND project_id = p_project_id AND node_id = v_node
         AND level IN ('task', 'code') AND heartbeat_at >= v_fresh
         AND holder_delegate IS DISTINCT FROM v_delegate
       ORDER BY since
    LOOP
      v_other_reach := CASE
        WHEN jsonb_typeof(v_other.meta->'reach') = 'array' AND jsonb_array_length(v_other.meta->'reach') > 0
          THEN ARRAY(SELECT jsonb_array_elements_text(v_other.meta->'reach'))
        ELSE ARRAY['*'] END;
      v_coupling := CASE
        WHEN '*' = ANY(v_reach) OR '*' = ANY(v_other_reach) THEN '*'
        ELSE (SELECT x FROM unnest(v_reach) AS x WHERE x = ANY(v_other_reach) ORDER BY x LIMIT 1) END;
      IF v_coupling IS NOT NULL THEN
        RETURN jsonb_build_object(
          'claimed', false,
          'conflict', 'reach',
          'heldBy', v_other.holder_label,
          'holderKind', v_other.holder_kind,
          'heldLevel', v_other.level,
          'since', v_other.since,
          'heartbeatAt', v_other.heartbeat_at,
          'heldReach', to_jsonb(v_other_reach),
          'coupling', v_coupling,
          'stale', false);
      END IF;
    END LOOP;
    v_meta := v_meta || jsonb_build_object('reach', to_jsonb(v_reach));
  END IF;

  INSERT INTO public.agent_checkouts
    (project_id, branch_id, level, holder_kind, holder_label, holder_key_id, holder_delegate,
     task_item_id, artifact_id, requirement_id, candidate_id, criterion_id, node_id, proposal_id, meta)
  VALUES
    (p_project_id, p_branch_id, p_level, p_holder_kind, p_holder_label, p_holder_key_id, v_delegate,
     CASE WHEN p_level = 'task'                          THEN p_ref_id END,
     CASE WHEN p_level = 'code'                          THEN p_ref_id END,
     CASE WHEN p_level IN ('requirement', 'criterion')   THEN p_ref_id END,
     CASE WHEN p_level = 'outcome'                       THEN p_ref_id END,
     CASE WHEN p_level = 'criterion'                     THEN p_criterion_id END,
     CASE WHEN p_level IN ('task', 'code', 'node')       THEN v_node END,
     p_proposal_id, v_meta)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'checkoutId', v_new_id,
    'advisory', p_level IN ('requirement', 'outcome'),
    'reclaimedFrom', v_reclaimed);
END;
$$;


ALTER FUNCTION "public"."agent_checkout_claim"("p_project_id" "uuid", "p_level" "text", "p_ref_id" "uuid", "p_holder_kind" "text", "p_holder_label" "text", "p_holder_key_id" "uuid", "p_branch_id" "uuid", "p_proposal_id" "uuid", "p_meta" "jsonb", "p_stale_after_minutes" integer, "p_holder_delegate" "text", "p_criterion_id" "text", "p_node_id" "uuid", "p_reach" "text"[], "p_box" "uuid", "p_parts" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."agent_checkout_claim"("p_project_id" "uuid", "p_level" "text", "p_ref_id" "uuid", "p_holder_kind" "text", "p_holder_label" "text", "p_holder_key_id" "uuid", "p_branch_id" "uuid", "p_proposal_id" "uuid", "p_meta" "jsonb", "p_stale_after_minutes" integer, "p_holder_delegate" "text", "p_criterion_id" "text", "p_node_id" "uuid", "p_reach" "text"[], "p_box" "uuid", "p_parts" "uuid"[]) IS 'Atomic claim under the project row lock (import_wave_claim pattern). Exclusive levels (task/code/criterion/node) return claimed:false with the holder when fresh-held; stale holds are reclaimed; the holder re-claiming renews (AA.0). AA.5: a node lease (level node, node_id) locks the node''s structure and waits for the work inside it; a task or code lease records its node and its reach (meta.reach; ''*'' is the whole node) and is refused while the node is leased or when its reach overlaps another fresh work lease there (conflict work | node | reach, with the coupling token). AA.3: p_box and p_parts: the box''s lease covers its parts, a part''s lease is refused while the box is held and the reverse (conflict node, relation box | part). Service-role only; the checkout MCP tools are the callers.';



CREATE OR REPLACE FUNCTION "public"."agent_connection_count"("p_user_id" "uuid", "p_except_client_id" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT (
    SELECT count(*)::integer
    FROM public.mcp_api_keys k
    WHERE k.user_id = p_user_id
      AND k.revoked_at IS NULL
      AND (k.expires_at IS NULL OR k.expires_at > now())
  ) + (
    SELECT count(DISTINCT t.client_id)::integer
    FROM public.mcp_oauth_tokens t
    WHERE t.user_id = p_user_id
      AND t.revoked_at IS NULL
      AND COALESCE(t.refresh_expires_at, t.expires_at) > now()
      AND (p_except_client_id IS NULL OR t.client_id <> p_except_client_id)
  );
$$;


ALTER FUNCTION "public"."agent_connection_count"("p_user_id" "uuid", "p_except_client_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."agent_connection_count"("p_user_id" "uuid", "p_except_client_id" "text") IS 'V3 I: how many agents one person keeps connected: live API keys plus distinct OAuth clients with a live token family. The MCP server compares it with the plan allowance before minting a key or an authorization code; p_except_client_id leaves out a client that is renewing its own connection.';



CREATE OR REPLACE FUNCTION "public"."app_session_beat"("p_session" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_last timestamptz;
  v_gap double precision;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'app_session_beat: sign in first' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deployment_settings WHERE id AND mode = 'self-hosted') THEN
    RETURN NULL;
  END IF;
  IF p_session IS NOT NULL THEN
    -- Only the caller's own session: another person's id starts a new one.
    SELECT s.id, s.last_seen_at INTO v_id, v_last
    FROM public.app_sessions s
    WHERE s.id = p_session AND s.user_id = v_user
    FOR UPDATE;
  END IF;
  IF v_id IS NOT NULL THEN
    v_gap := extract(epoch FROM clock_timestamp() - v_last);
    IF v_gap <= 1800 THEN
      UPDATE public.app_sessions
      SET active_seconds = active_seconds + LEAST(GREATEST(v_gap, 0), 90)::integer,
          last_seen_at = clock_timestamp()
      WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;
  INSERT INTO public.app_sessions (user_id, started_at, last_seen_at)
  VALUES (v_user, clock_timestamp(), clock_timestamp())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."app_session_beat"("p_session" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_criteria_ops"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_criteria jsonb;
  v_updated_at timestamptz;
  v_op jsonb;
  v_next jsonb;
  v_criterion jsonb;
  v_selector text;
  v_expected text;
  v_matched boolean;
  v_applied int := 0;
  v_changed boolean := false;
  i int;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RAISE EXCEPTION 'apply_criteria_ops: p_ops must be a jsonb array of operations';
  END IF;

  SELECT acceptance_criteria, updated_at
    INTO v_criteria, v_updated_at
    FROM public.specification_requirements
   WHERE id = p_requirement_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'applied', 0, 'changed', false);
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION
      'apply_criteria_ops: the requirement moved since you read it (expected %, found %) — re-read and retry',
      p_expected_updated_at, v_updated_at
      USING ERRCODE = '40001';
  END IF;

  IF v_criteria IS NULL OR jsonb_typeof(v_criteria) <> 'array' THEN
    v_criteria := '[]'::jsonb;
  END IF;

  -- Pre-v3l compatibility: a bare string criterion answers to no selector.
  -- Normalising here matches what both runtimes do on every write path; it is
  -- only persisted below if an op actually changed something.
  v_next := '[]'::jsonb;
  FOR i IN 0 .. jsonb_array_length(v_criteria) - 1 LOOP
    v_criterion := v_criteria -> i;
    IF jsonb_typeof(v_criterion) = 'string' THEN
      v_criterion := jsonb_build_object('text', v_criterion #>> '{}');
    END IF;
    v_next := v_next || jsonb_build_array(v_criterion);
  END LOOP;
  v_criteria := v_next;

  FOR j IN 0 .. jsonb_array_length(p_ops) - 1 LOOP
    v_op := p_ops -> j;

    v_selector := NULL;
    IF v_op ? 'criterion_id'   THEN v_selector := 'id';     v_expected := v_op ->> 'criterion_id';   END IF;
    IF v_op ? 'criterion_text' THEN
      IF v_selector IS NOT NULL THEN RAISE EXCEPTION 'apply_criteria_ops: op % carries more than one selector', j; END IF;
      v_selector := 'text';   v_expected := v_op ->> 'criterion_text';
    END IF;
    IF v_op ? 'test_id' THEN
      IF v_selector IS NOT NULL THEN RAISE EXCEPTION 'apply_criteria_ops: op % carries more than one selector', j; END IF;
      v_selector := 'testId'; v_expected := v_op ->> 'test_id';
    END IF;
    IF v_selector IS NULL THEN
      RAISE EXCEPTION 'apply_criteria_ops: op % has no selector (criterion_id | criterion_text | test_id)', j;
    END IF;

    IF (v_op ->> 'op') NOT IN ('set_met', 'bind', 'unbind', 'stamp', 'mark_stale', 'clear_stale') THEN
      RAISE EXCEPTION 'apply_criteria_ops: unknown op %', coalesce(v_op ->> 'op', '(null)');
    END IF;

    v_next := '[]'::jsonb;
    v_matched := false;

    FOR i IN 0 .. jsonb_array_length(v_criteria) - 1 LOOP
      v_criterion := v_criteria -> i;

      IF v_criterion ->> v_selector IS NOT DISTINCT FROM v_expected AND v_expected IS NOT NULL THEN
        v_matched := true;
        CASE v_op ->> 'op'
          WHEN 'set_met'     THEN v_criterion := jsonb_set(v_criterion, '{met}', to_jsonb((v_op ->> 'value')::boolean));
          WHEN 'bind'        THEN v_criterion := jsonb_set(v_criterion, '{testId}', to_jsonb(v_op ->> 'value'));
          WHEN 'unbind'      THEN v_criterion := v_criterion - 'testId';
          WHEN 'stamp'       THEN v_criterion := jsonb_set(v_criterion, '{provenance}', v_op -> 'value');
          WHEN 'mark_stale'  THEN v_criterion := jsonb_set(v_criterion, '{evidenceStale}', v_op -> 'value');
          WHEN 'clear_stale' THEN v_criterion := v_criterion - 'evidenceStale';
        END CASE;
      END IF;

      v_next := v_next || jsonb_build_array(v_criterion);
    END LOOP;

    IF v_matched THEN
      v_applied := v_applied + 1;
      IF v_next IS DISTINCT FROM v_criteria THEN
        v_changed := true;
        v_criteria := v_next;
      END IF;
    END IF;
  END LOOP;

  IF v_changed THEN
    UPDATE public.specification_requirements
       SET acceptance_criteria = v_criteria,
           updated_at = now()
     WHERE id = p_requirement_id;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'applied', v_applied,
    'changed', v_changed,
    'criteria', v_criteria);
END;
$$;


ALTER FUNCTION "public"."apply_criteria_ops"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_criteria_ops"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) IS 'The ONE locked writer of specification_requirements.acceptance_criteria. Takes the row lock before reading, applies per-criterion operations selected by criterion_id | criterion_text | test_id, and preserves every key it was not asked to change. p_expected_updated_at is an optional compare-and-swap token that raises 40001 rather than clobber.';



CREATE OR REPLACE FUNCTION "public"."apply_criteria_ops_as_member"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_project uuid;
  v_mark text;
BEGIN
  SELECT ps.project_id, sr.mark
    INTO v_project, v_mark
    FROM public.specification_requirements sr
    JOIN public.project_specifications ps ON ps.id = sr.specification_id
   WHERE sr.id = p_requirement_id;

  -- Absent and invisible answer alike: a seat learns nothing from the shape.
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('found', false, 'applied', 0, 'changed', false);
  END IF;

  -- mirrors "Users can update requirements in their projects"
  IF NOT public.is_project_member(v_project, 'contributor') THEN
    RAISE EXCEPTION 'apply_criteria_ops: contributor on this project is required to change its criteria'
      USING ERRCODE = '42501';
  END IF;

  -- mirrors the v3q RESTRICTIVE policy "Classification: cleared marks only".
  -- Without this a definer call would let an uncleared seat mutate a marked
  -- requirement it cannot even read.
  IF NOT public.mark_visible(v_project, v_mark) THEN
    RETURN jsonb_build_object('found', false, 'applied', 0, 'changed', false);
  END IF;

  RETURN public.apply_criteria_ops(p_requirement_id, p_ops, p_expected_updated_at);
END;
$$;


ALTER FUNCTION "public"."apply_criteria_ops_as_member"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_criteria_ops_as_member"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) IS 'Seat-facing entry to the criteria writer. Re-states, in code, the two policies SECURITY DEFINER bypasses: contributor membership and the v3q classification rule. Keep in step with the specification_requirements policies.';



CREATE OR REPLACE FUNCTION "public"."apply_spec_load"("p_project_id" "uuid", "p_mode" "text", "p_actor" "uuid", "p_spec" "jsonb", "p_requirements" "jsonb", "p_mappings_add" "jsonb", "p_mappings_remove" "jsonb", "p_provenance" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_spec_id uuid;
  v_req jsonb;
  v_m jsonb;
  v_ref text;
  v_row_id uuid;
  v_is_locked boolean;
  v_prior jsonb;
  v_name text;
  v_description text;
  v_category text;
  v_criteria jsonb;
  v_preserved int;
  v_node uuid;
  v_type text;
  v_n int;
  v_listed text[] := ARRAY[]::text[];
  v_locked text[] := ARRAY[]::text[];
  v_kept_local text[];
  v_added int := 0;
  v_updated int := 0;
  v_criteria_preserved int := 0;
  v_map_added int := 0;
  v_map_removed int := 0;
  v_map_skipped int := 0;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('adopt', 'apply') THEN
    RAISE EXCEPTION 'apply_spec_load: mode is adopt or apply, got %', p_mode USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'adopt' THEN
    INSERT INTO project_specifications (project_id, vision, constraints, preferences, created_by, metadata)
    VALUES (
      p_project_id,
      COALESCE(p_spec->>'vision', ''),
      COALESCE(p_spec->'constraints', '[]'::jsonb),
      COALESCE(p_spec->'preferences', '{}'::jsonb),
      p_actor,
      jsonb_build_object('provenance', p_provenance)
        || CASE WHEN p_spec ? 'specHash' THEN jsonb_build_object('specHash', p_spec->'specHash') ELSE '{}'::jsonb END
    )
    ON CONFLICT (project_id) DO NOTHING
    RETURNING id INTO v_spec_id;
    IF v_spec_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already-has-spec');
    END IF;
  ELSE
    SELECT id INTO v_spec_id
      FROM project_specifications
     WHERE project_id = p_project_id
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
    IF v_spec_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no-spec');
    END IF;
    UPDATE project_specifications
       SET vision = COALESCE(p_spec->>'vision', ''),
           constraints = COALESCE(p_spec->'constraints', '[]'::jsonb),
           preferences = COALESCE(p_spec->'preferences', '{}'::jsonb),
           updated_at = now()
     WHERE id = v_spec_id;
  END IF;

  -- Requirements, in the order git lists them.
  FOR v_req IN SELECT e FROM jsonb_array_elements(COALESCE(p_requirements, '[]'::jsonb)) AS t(e) LOOP
    v_ref := v_req->>'requirementId';
    v_listed := v_listed || v_ref;
    v_name := COALESCE(v_req->>'name', '');
    v_description := v_req->>'description';
    v_category := COALESCE(NULLIF(v_req->>'category', ''), 'functional');

    v_row_id := NULL; v_is_locked := false; v_prior := NULL;
    SELECT r.id, COALESCE(r.locked, false), r.acceptance_criteria
      INTO v_row_id, v_is_locked, v_prior
      FROM specification_requirements r
     WHERE r.specification_id = v_spec_id AND r.requirement_id = v_ref
     FOR UPDATE;

    -- Carry the stored criterion (the last one with that text) for every text
    -- git keeps; a text it adds or rewords arrives unmet.
    SELECT COALESCE(jsonb_agg(
             CASE WHEN p.obj IS NOT NULL THEN p.obj || jsonb_build_object('text', c.txt)
                  ELSE jsonb_build_object('text', c.txt, 'met', false) END
             ORDER BY c.ord), '[]'::jsonb),
           COUNT(*) FILTER (WHERE p.obj->'met' = 'true'::jsonb)
      INTO v_criteria, v_preserved
      FROM jsonb_array_elements_text(COALESCE(v_req->'acceptanceCriteria', '[]'::jsonb)) WITH ORDINALITY AS c(txt, ord)
      LEFT JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(pe.e) = 'string' THEN jsonb_build_object('text', pe.e #>> '{}') ELSE pe.e END AS obj
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_prior) = 'array' THEN v_prior ELSE '[]'::jsonb END)
               WITH ORDINALITY AS pe(e, pord)
         WHERE (jsonb_typeof(pe.e) = 'string' AND pe.e #>> '{}' = c.txt)
            OR (jsonb_typeof(pe.e) = 'object' AND jsonb_typeof(pe.e->'text') = 'string' AND pe.e->>'text' = c.txt)
         ORDER BY pe.pord DESC
         LIMIT 1
      ) p ON true;

    IF v_row_id IS NOT NULL AND v_is_locked THEN
      -- Locked means locked: nothing is written, and a change git made is named.
      IF EXISTS (
        SELECT 1 FROM specification_requirements r
         WHERE r.id = v_row_id
           AND (r.name IS DISTINCT FROM v_name
                OR COALESCE(r.description, '') IS DISTINCT FROM COALESCE(v_description, '')
                OR COALESCE(r.category, 'functional') IS DISTINCT FROM v_category
                OR public.criteria_content(r.acceptance_criteria) IS DISTINCT FROM public.criteria_content(v_criteria))
      ) THEN
        v_locked := v_locked || v_ref;
      END IF;
      CONTINUE;
    END IF;

    IF v_row_id IS NOT NULL THEN
      UPDATE specification_requirements
         SET name = v_name,
             description = v_description,
             category = v_category,
             acceptance_criteria = v_criteria,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('provenance', p_provenance),
             updated_at = now()
       WHERE id = v_row_id;
      v_updated := v_updated + 1;
      v_criteria_preserved := v_criteria_preserved + v_preserved;
    ELSE
      INSERT INTO specification_requirements (specification_id, requirement_id, name, description, category, acceptance_criteria, metadata)
      VALUES (v_spec_id, v_ref, v_name, v_description, v_category, v_criteria, jsonb_build_object('provenance', p_provenance));
      v_added := v_added + 1;
    END IF;
  END LOOP;

  -- Mappings git removed since the last sync.
  FOR v_m IN SELECT e FROM jsonb_array_elements(COALESCE(p_mappings_remove, '[]'::jsonb)) AS t(e) LOOP
    v_ref := v_m->>'requirementId';
    v_node := (v_m->>'nodeId')::uuid;
    v_type := COALESCE(NULLIF(v_m->>'mappingType', ''), 'implements');
    v_row_id := NULL; v_is_locked := false;
    SELECT r.id, COALESCE(r.locked, false) INTO v_row_id, v_is_locked
      FROM specification_requirements r
     WHERE r.specification_id = v_spec_id AND r.requirement_id = v_ref;
    CONTINUE WHEN v_row_id IS NULL;
    IF v_is_locked THEN
      IF EXISTS (SELECT 1 FROM specification_mappings sm
                  WHERE sm.specification_id = v_spec_id AND sm.requirement_id = v_row_id
                    AND sm.node_id = v_node AND COALESCE(sm.mapping_type, 'implements') = v_type)
         AND NOT v_ref = ANY (v_locked) THEN
        v_locked := v_locked || v_ref;
      END IF;
      CONTINUE;
    END IF;
    DELETE FROM specification_mappings sm
     WHERE sm.specification_id = v_spec_id AND sm.requirement_id = v_row_id
       AND sm.node_id = v_node AND COALESCE(sm.mapping_type, 'implements') = v_type;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_map_removed := v_map_removed + v_n;
  END LOOP;

  -- Mappings git holds that the project lacks.
  FOR v_m IN SELECT e FROM jsonb_array_elements(COALESCE(p_mappings_add, '[]'::jsonb)) AS t(e) LOOP
    v_ref := v_m->>'requirementId';
    v_node := (v_m->>'nodeId')::uuid;
    v_type := COALESCE(NULLIF(v_m->>'mappingType', ''), 'implements');
    v_row_id := NULL; v_is_locked := false;
    SELECT r.id, COALESCE(r.locked, false) INTO v_row_id, v_is_locked
      FROM specification_requirements r
     WHERE r.specification_id = v_spec_id AND r.requirement_id = v_ref;
    IF v_row_id IS NULL THEN
      v_map_skipped := v_map_skipped + 1;
      CONTINUE;
    END IF;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM specification_mappings sm
       WHERE sm.specification_id = v_spec_id AND sm.requirement_id = v_row_id
         AND sm.node_id = v_node AND COALESCE(sm.mapping_type, 'implements') = v_type);
    IF v_is_locked THEN
      IF NOT v_ref = ANY (v_locked) THEN v_locked := v_locked || v_ref; END IF;
      CONTINUE;
    END IF;
    INSERT INTO specification_mappings (specification_id, requirement_id, node_id, mapping_type, created_by)
    VALUES (v_spec_id, v_row_id, v_node, v_type, p_actor);
    v_map_added := v_map_added + 1;
  END LOOP;

  SELECT array_agg(r.requirement_id ORDER BY r.requirement_id) INTO v_kept_local
    FROM specification_requirements r
   WHERE r.specification_id = v_spec_id AND NOT r.requirement_id = ANY (v_listed);

  RETURN jsonb_build_object(
    'ok', true,
    'mode', p_mode,
    'specId', v_spec_id,
    'added', v_added,
    'updated', v_updated,
    'criteriaPreserved', v_criteria_preserved,
    'mappingsAdded', v_map_added,
    'mappingsRemoved', v_map_removed,
    'skippedMappings', v_map_skipped,
    'locked', to_jsonb(v_locked),
    'keptLocal', to_jsonb(COALESCE(v_kept_local, ARRAY[]::text[])));
END;
$$;


ALTER FUNCTION "public"."apply_spec_load"("p_project_id" "uuid", "p_mode" "text", "p_actor" "uuid", "p_spec" "jsonb", "p_requirements" "jsonb", "p_mappings_add" "jsonb", "p_mappings_remove" "jsonb", "p_provenance" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_spec_load"("p_project_id" "uuid", "p_mode" "text", "p_actor" "uuid", "p_spec" "jsonb", "p_requirements" "jsonb", "p_mappings_add" "jsonb", "p_mappings_remove" "jsonb", "p_provenance" "jsonb") IS 'V3 AD.2c: loads .nodespec/spec.json in one transaction. adopt creates the spec, apply updates it; criteria keep their evidence by text; locked requirements are not written and are named; mappings are added and removed as the caller''s three-way plan says, every other row kept.';



CREATE OR REPLACE FUNCTION "public"."assert_can_contain_resolves"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE dangling text;
BEGIN
  SELECT string_agg(c, ', ') INTO dangling
  FROM jsonb_array_elements_text(
         CASE jsonb_typeof(NEW.can_contain)
           WHEN 'array'  THEN NEW.can_contain
           WHEN 'object' THEN COALESCE(NEW.can_contain -> 'roleIds', '[]'::jsonb)
           ELSE '[]'::jsonb
         END) c
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles r WHERE r.id = c);

  IF dangling IS NOT NULL THEN
    RAISE EXCEPTION 'role "%" can_contain references role(s) that do not exist: %',
                    NEW.id, dangling;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assert_can_contain_resolves"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_role_affinities_resolve"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE dangling text;
BEGIN
  SELECT string_agg(aff, ', ') INTO dangling
  FROM jsonb_array_elements_text(COALESCE(NEW.role_affinities, '[]'::jsonb)) aff
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles r WHERE r.id = aff);

  IF dangling IS NOT NULL THEN
    RAISE EXCEPTION 'technology "%" references role(s) that do not exist: % '
                    '(the row would be invisible in the palette)', NEW.id, dangling;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assert_role_affinities_resolve"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") RETURNS TABLE("total_requirements" bigint, "mapped_requirements" bigint, "unmapped_requirements" bigint, "orphaned_mappings" bigint, "coverage_percentage" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
IF NOT EXISTS (
SELECT 1 FROM public.project_specifications ps
JOIN public.projects p ON p.id = ps.project_id
WHERE ps.id = p_specification_id
AND public.is_project_member(p.id, 'viewer')
) THEN
RAISE EXCEPTION 'Specification not found or access denied';
END IF;

RETURN QUERY
WITH requirement_stats AS (
SELECT COUNT(*) as total
FROM public.specification_requirements
WHERE specification_id = p_specification_id
),
mapping_stats AS (
SELECT
COUNT(DISTINCT requirement_id) as mapped,
COUNT(*) FILTER (WHERE is_orphan = true) as orphaned
FROM public.specification_mappings
WHERE specification_id = p_specification_id
)
SELECT
rs.total,
ms.mapped,
rs.total - ms.mapped as unmapped,
ms.orphaned,
CASE
WHEN rs.total > 0 THEN ROUND((ms.mapped::numeric / rs.total::numeric) * 100, 2)
ELSE 0
END as coverage
FROM requirement_stats rs
CROSS JOIN mapping_stats ms;
END;
$$;


ALTER FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."candidate_home_lane"("p_project_id" "uuid", "p_candidate_id" "uuid", "p_kind" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_lane uuid;
  v_owner uuid;
  v_name text;
  v_kind text;
BEGIN
  -- 1. an existing row's maps decide: the mapped lane that sorts first
  IF p_candidate_id IS NOT NULL THEN
    SELECT w.id INTO v_lane
      FROM public.outcome_step_maps m
      JOIN public.workflow_steps ws ON ws.id = m.step_id
      JOIN public.workflows w ON w.id = ws.workflow_id
     WHERE m.candidate_id = p_candidate_id AND w.project_id = p_project_id
     ORDER BY w.sort_order, w.name, w.id
     LIMIT 1;
    IF v_lane IS NOT NULL THEN RETURN v_lane; END IF;
  END IF;

  IF p_kind IN ('api', 'data', 'behavior') THEN
    -- 2. import-born: the project's imported lane, by kind
    SELECT id INTO v_lane FROM public.workflows WHERE project_id = p_project_id AND kind = 'imported'
     ORDER BY sort_order, name, id LIMIT 1;
    IF v_lane IS NOT NULL THEN RETURN v_lane; END IF;
    -- else adopt a clean lane already named Imported (the row v3v made)
    SELECT w.id INTO v_lane FROM public.workflows w
     WHERE w.project_id = p_project_id AND w.name = 'Imported'
       AND NOT EXISTS (SELECT 1 FROM public.workflow_steps s WHERE s.workflow_id = w.id)
       AND NOT EXISTS (SELECT 1 FROM public.requirement_candidates c WHERE c.workflow_id = w.id AND c.kind = 'outcome');
    IF v_lane IS NOT NULL THEN
      UPDATE public.workflows SET kind = 'imported', updated_at = now() WHERE id = v_lane;
      RETURN v_lane;
    END IF;
    -- else create it; a person's own lane named Imported keeps its name
    v_kind := 'imported';
    v_name := CASE WHEN EXISTS (SELECT 1 FROM public.workflows WHERE project_id = p_project_id AND name = 'Imported')
                   THEN 'Imported (repository)' ELSE 'Imported' END;
  ELSE
    -- 3. an outcome: the project's first WORKFLOW lane, never the imported one
    SELECT id INTO v_lane FROM public.workflows WHERE project_id = p_project_id AND kind = 'workflow'
     ORDER BY sort_order, name, id LIMIT 1;
    IF v_lane IS NOT NULL THEN RETURN v_lane; END IF;
    v_kind := 'workflow';
    v_name := 'Workflow';
  END IF;

  -- create the lane once, after the project's last
  SELECT owner_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  INSERT INTO public.workflows (project_id, name, kind, sort_order, created_by)
  VALUES (p_project_id, v_name, v_kind,
          COALESCE((SELECT max(sort_order) + 1 FROM public.workflows WHERE project_id = p_project_id), 0),
          v_owner)
  ON CONFLICT (project_id, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_lane;
  RETURN v_lane;
END;
$$;


ALTER FUNCTION "public"."candidate_home_lane"("p_project_id" "uuid", "p_candidate_id" "uuid", "p_kind" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."candidate_home_lane"("p_project_id" "uuid", "p_candidate_id" "uuid", "p_kind" "text") IS 'v3v + V3 6.6: the home lane for a candidate: its first-sorting mapped lane; else, import-born kinds, the project''s imported lane (kind imported, created once); else, outcomes, the project''s first workflow lane (never the imported one), created once. Definer: runs from the insert trigger under any role.';



CREATE OR REPLACE FUNCTION "public"."check_orphaned_users"() RETURNS TABLE("user_id" "uuid", "email" "text", "created_at" timestamp with time zone, "minutes_since_signup" numeric, "last_provision_attempt" timestamp with time zone, "provision_attempts" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'Authentication required';
END IF;

IF NOT public.is_admin() THEN
RAISE EXCEPTION 'Admin access required';
END IF;

RETURN QUERY
SELECT
u.id AS user_id,
u.email::text,
u.created_at,
EXTRACT(EPOCH FROM (now() - u.created_at)) / 60 AS minutes_since_signup,
MAX(sal.created_at) AS last_provision_attempt,
COUNT(sal.id) AS provision_attempts
FROM auth.users u
LEFT JOIN public.stripe_customers sc ON u.id = sc.user_id AND sc.deleted_at IS NULL
LEFT JOIN public.subscription_audit_log sal ON u.id = sal.user_id
AND sal.source IN ('provision_trigger', 'create-free-customer')
WHERE sc.customer_id IS NULL
AND u.created_at < now() - interval '5 minutes'
AND u.deleted_at IS NULL
GROUP BY u.id, u.email, u.created_at
ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."check_orphaned_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."classification_summary"("p_project_id" "uuid") RETURNS TABLE("marks" "text"[], "withheld" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH items AS (
    SELECT c.mark FROM public.requirement_candidates c WHERE c.project_id = p_project_id AND c.mark IS NOT NULL
    UNION ALL
    SELECT r.mark FROM public.specification_requirements r
      JOIN public.project_specifications ps ON ps.id = r.specification_id
     WHERE ps.project_id = p_project_id AND r.mark IS NOT NULL
    UNION ALL
    SELECT t.mark FROM public.task_items t WHERE t.project_id = p_project_id AND t.mark IS NOT NULL
    UNION ALL
    SELECT tc.mark FROM public.test_cases tc
      JOIN public.specification_requirements r ON r.id = tc.requirement_id
      JOIN public.project_specifications ps ON ps.id = r.specification_id
     WHERE ps.project_id = p_project_id AND tc.mark IS NOT NULL
    UNION ALL
    SELECT a.mark FROM public.artifacts a WHERE a.project_id = p_project_id AND a.mark IS NOT NULL
    UNION ALL
    SELECT k.mark FROM public.project_constraints k WHERE k.project_id = p_project_id AND k.mark IS NOT NULL
  )
  SELECT
    coalesce((SELECT array_agg(DISTINCT i.mark ORDER BY i.mark) FROM items i WHERE public.mark_visible(p_project_id, i.mark)), '{}'::text[]),
    coalesce((SELECT count(*)::integer FROM items i WHERE NOT public.mark_visible(p_project_id, i.mark)), 0)
  WHERE public.is_project_member(p_project_id, 'viewer')
$$;


ALTER FUNCTION "public"."classification_summary"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."classification_summary"("p_project_id" "uuid") IS 'V3 7.3: the marks the caller may see on this project (the banner derives from them) and how many marked items are withheld from them (the honest count).';



CREATE OR REPLACE FUNCTION "public"."cleanup_test_case_artifacts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF OLD.artifact_id IS NOT NULL THEN
    DELETE FROM public.artifacts WHERE id = OLD.artifact_id;
  END IF;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_test_case_artifacts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_testid_from_acceptance_criteria"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_criteria jsonb;
  v_updated jsonb;
  v_element jsonb;
  v_idx int;
  v_changed boolean := false;
BEGIN
  SELECT acceptance_criteria INTO v_criteria
  FROM public.specification_requirements
  WHERE id = OLD.requirement_id;

  IF v_criteria IS NULL OR jsonb_typeof(v_criteria) != 'array' THEN
    RETURN OLD;
  END IF;

  v_updated := '[]'::jsonb;

  FOR v_idx IN 0..jsonb_array_length(v_criteria) - 1 LOOP
    v_element := v_criteria->v_idx;
    IF v_element->>'testId' = OLD.id::text THEN
      v_element := v_element - 'testId';
      v_changed := true;
    END IF;
    v_updated := v_updated || jsonb_build_array(v_element);
  END LOOP;

  IF v_changed THEN
    UPDATE public.specification_requirements
    SET acceptance_criteria = v_updated,
        updated_at = now()
    WHERE id = OLD.requirement_id;
  END IF;

  RETURN OLD;
EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."clear_testid_from_acceptance_criteria"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT encode(sha256(convert_to(
    p_id::text
    || '|' || p_branch_id::text
    || '|' || p_sequence::text
    || '|' || p_patch_type
    || '|' || p_actor_type
    || '|' || coalesce(p_actor_id::text, '')
    || '|' || p_summary
    || '|' || p_payload::text
    || '|' || coalesce(p_preconditions::text, '')
    || '|' || extract(epoch from p_created_at)::text
    || '|' || coalesce(p_prev_hash, ''),
    'UTF8')), 'hex');
$$;


ALTER FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."constraints_count"("p_project" "uuid", "p_counts" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  moved integer;
BEGIN
  IF jsonb_typeof(p_counts) IS DISTINCT FROM 'object' THEN
    RETURN 0;
  END IF;
  UPDATE public.project_constraints c
     SET stats = jsonb_build_object(
           'fired',    COALESCE((c.stats->>'fired')::int, 0)    + COALESCE((x.value->>'fired')::int, 0),
           'violated', COALESCE((c.stats->>'violated')::int, 0) + COALESCE((x.value->>'violated')::int, 0),
           'waived',   COALESCE((c.stats->>'waived')::int, 0)   + COALESCE((x.value->>'waived')::int, 0),
           'lastFiredAt', CASE WHEN COALESCE((x.value->>'fired')::int, 0) > 0
                               THEN to_jsonb(now()) ELSE c.stats->'lastFiredAt' END)
    FROM jsonb_each(p_counts) x
   WHERE c.project_id = p_project
     AND c.id::text = x.key;
  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved;
END;
$$;


ALTER FUNCTION "public"."constraints_count"("p_project" "uuid", "p_counts" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."constraints_count"("p_project" "uuid", "p_counts" "jsonb") IS 'R.2c: add fired, violated and waived counts to a project''s constraints; lastFiredAt moves when fired does.';



CREATE OR REPLACE FUNCTION "public"."constraints_from_spec_json"("p_project" "uuid", "p_json" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_project IS NULL OR jsonb_typeof(p_json) IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.deployment_settings WHERE id AND mode = 'self-hosted')
     AND public.account_plan_tier((SELECT owner_id FROM public.projects WHERE id = p_project)) = 'community' THEN
    RETURN 0;
  END IF;
  WITH entries AS (
    SELECT CASE WHEN c->>'type' IN ('technology', 'architecture', 'deployment', 'performance',
                                    'security', 'compliance', 'cost', 'other')
                THEN c->>'type' ELSE 'other' END AS ctype,
           btrim(c->>'description') AS description,
           NULLIF(btrim(COALESCE(c->>'title', '')), '') AS title,
           NULLIF(btrim(COALESCE(c->>'rationale', '')), '') AS rationale,
           md5(p_project::text || '|' || COALESCE(c->>'type', '') || '|' || (c->>'description')) AS source_hash,
           CASE WHEN c->>'kind' = 'check'
                 AND jsonb_typeof(c->'check') = 'object'
                 AND c->'check'->>'predicate' IN ('contract_has_schema', 'no_calls_between_roles', 'technology_in_list', 'sync_calls_at_most')
                 AND c->'check'->>'severity' IN ('warn', 'refuse')
                THEN c->'check' END AS check_spec,
           CASE WHEN c->'scope'->>'kind' IN ('role', 'technology', 'contract_kind', 'node')
                 AND COALESCE(btrim(c->'scope'->>'value'), '') <> ''
                THEN c->'scope'->>'kind' END AS scope_kind,
           NULLIF(btrim(COALESCE(c->'scope'->>'value', '')), '') AS scope_value
    FROM jsonb_array_elements(p_json) AS c
    WHERE jsonb_typeof(c) = 'object'
      AND COALESCE(btrim(c->>'description'), '') <> ''
  )
  INSERT INTO public.project_constraints (project_id, ctype, title, description, rationale, source_hash, kind, check_spec, scope_kind, scope_value)
  SELECT DISTINCT ON (e.ctype, e.description) p_project, e.ctype, e.title, e.description, e.rationale, e.source_hash,
         CASE WHEN e.check_spec IS NULL THEN 'guide' ELSE 'check' END,
         e.check_spec,
         COALESCE(e.scope_kind, 'project'),
         CASE WHEN e.scope_kind IS NULL THEN NULL ELSE e.scope_value END
  FROM entries e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_constraints pc
    WHERE pc.project_id = p_project
      AND pc.ctype = e.ctype
      AND btrim(pc.description) = e.description
  )
  ON CONFLICT (project_id, source_hash) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."constraints_from_spec_json"("p_project" "uuid", "p_json" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."constraints_from_spec_json"("p_project" "uuid", "p_json" "jsonb") IS 'AA.0, R.2b, AC: copy spec.json constraints into project_constraints (checks and scopes kept, an unknown check filed as guidance), skipping any (type, description) the project already has. Below Indie on hosted it files nothing. Returns the rows inserted.';



CREATE OR REPLACE FUNCTION "public"."criteria_content"("p" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(
              CASE WHEN jsonb_typeof(e) = 'object'
                   THEN e - 'met' - 'testId' - 'provenance' - 'evidenceStale'
                   ELSE e END
              ORDER BY ord)
       FROM jsonb_array_elements(CASE WHEN p IS NOT NULL AND jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END)
            WITH ORDINALITY AS t(e, ord)),
    '[]'::jsonb);
$$;


ALTER FUNCTION "public"."criteria_content"("p" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."criteria_content"("p" "jsonb") IS 'v3x: acceptance_criteria minus its evidence keys (met, testId, provenance, evidenceStale). Two arrays with equal content differ only in evidence.';



CREATE OR REPLACE FUNCTION "public"."enforce_ai_context_provenance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  enrichment_keys text[] := ARRAY['apiReference', 'sdkInitPattern', 'configurationTemplate', 'setupInstructions'];
  present text[];
  prov jsonb;
BEGIN
  IF NEW.ai_context IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(k) INTO present
  FROM unnest(enrichment_keys) AS k
  WHERE NEW.ai_context ? k;

  IF present IS NULL THEN
    RETURN NEW;
  END IF;

  prov := NEW.ai_context -> 'provenance';
  IF prov IS NULL
     OR jsonb_typeof(prov) <> 'object'
     OR NOT (prov ? 'verifiedAt')
     OR COALESCE(prov ->> 'method', '') NOT IN ('live-docs', 'model-knowledge', 'vendor-import') THEN
    RAISE EXCEPTION 'technology_catalog "%": enrichment payload (%) requires ai_context.provenance {verifiedAt, method: live-docs|model-knowledge|vendor-import}',
      NEW.id, array_to_string(present, ', ')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_ai_context_provenance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_example_project"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_hex text;
  v_prefix text;
  v_email text;
  v_sub text;
  v_claims text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first: the example project belongs to an account.' USING ERRCODE = '28000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nodespec_example:' || v_uid::text));

  SELECT id INTO v_id FROM public.projects
   WHERE owner_id = v_uid AND metadata ? 'example'
   ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  -- Given once: a deleted example is not made again.
  IF EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = v_uid AND preferences ? 'exampleProject') THEN
    RETURN NULL;
  END IF;

  -- The account's own ids: its prefix in place of the seed's, same length, same suffixes.
  v_hex := md5(v_uid::text || ':nodespec-example');
  v_prefix := substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-4' || substr(v_hex, 14, 3)
           || '-8' || substr(v_hex, 18, 3) || '-';
  -- The account's email where the seed names the bench user, safe inside a SQL literal
  -- and inside JSON text.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  v_email := to_jsonb(coalesce(v_email, 'you'))::text;
  v_email := replace(substr(v_email, 2, length(v_email) - 2), '''', '''''');

  -- Built as the server builds: no signed-in caller inside, so neither the plan checks
  -- nor the cap read this account while its example is written.
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE replace(replace(replace(public.example_project_sql(),
    'dc000000-0000-4000-8000-', v_prefix),
    'b0000000-0000-4000-8000-000000000001', v_uid::text),
    'bench@nodespec.local', v_email);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  v_id := (v_prefix || '000000000200')::uuid;
  INSERT INTO public.user_settings (user_id, preferences)
  VALUES (v_uid, jsonb_build_object('exampleProject', jsonb_build_object('id', v_id, 'at', now())))
  ON CONFLICT (user_id) DO UPDATE
    SET preferences = coalesce(public.user_settings.preferences, '{}'::jsonb) || EXCLUDED.preferences;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."ensure_example_project"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_example_project"() IS 'AJ.6: the caller''s example project, made on the first call from the Harbor Lane Bakery demo (AJ.6b) with the caller''s own ids; NULL once it was given and deleted.';



CREATE OR REPLACE FUNCTION "public"."example_project_sql"() RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_X$
SELECT $example_sql$
CREATE OR REPLACE FUNCTION pg_temp.constraint_identity(p_ctype text, p_description text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'app-sha256:' || encode(
    extensions.digest(
      convert_to(p_ctype, 'UTF8') || '\x00'::bytea || convert_to(btrim(p_description), 'UTF8'),
      'sha256'),
    'hex')
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.task_anchor_key(p_title text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE h bigint := 2166136261; i int;
BEGIN
  FOR i IN 1..char_length(p_title) LOOP
    h := (h # ascii(substr(p_title, i, 1)))::bigint;
    h := (h * 16777619) % 4294967296;
  END LOOP;
  RETURN lpad(to_hex(h), 8, '0');
END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.seed_tasks()
RETURNS TABLE (id uuid, node_id uuid, ord int, title text, done boolean, doc_done boolean, provenance jsonb, detail text, serves text[])
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT v.id::uuid, v.node_id::uuid, v.ord, v.title, v.done, coalesce(v.doc_done, v.done), v.provenance::jsonb, v.detail, v.serves
  FROM (VALUES
    -- Storefront
    ('dc000000-0000-4000-8000-000000000701', 'dc000000-0000-4000-8000-00000000a000', 1, 'Render today''s and tomorrow''s menu from the stock table.', true, NULL::boolean,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', 'Server-render the menu so it reads before any script loads; an item at zero is left out, not greyed.', ARRAY['r003c1']),
    ('dc000000-0000-4000-8000-000000000702', 'dc000000-0000-4000-8000-00000000a000', 2, 'Show the allergens on every item and again at checkout.', true, NULL,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', 'The nine major allergens, from the item row; an order note can add more.', ARRAY['r003c2']),
    ('dc000000-0000-4000-8000-000000000703', 'dc000000-0000-4000-8000-00000000a000', 3, 'Offer pickup slots with their remaining places, earliest first.', true, NULL,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', 'Slots come from the Orders API; the page never computes capacity itself.', NULL),
    ('dc000000-0000-4000-8000-000000000704', 'dc000000-0000-4000-8000-00000000a000', 4, 'Take guest checkout with a name and a phone number, no account.', true, NULL,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', NULL, ARRAY['r001c2']),
    ('dc000000-0000-4000-8000-000000000705', 'dc000000-0000-4000-8000-00000000a000', 5, 'Hand payment to Stripe and open the order page when it confirms.', true, NULL,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', NULL, ARRAY['r001c1']),
    ('dc000000-0000-4000-8000-000000000706', 'dc000000-0000-4000-8000-00000000a000', 6, 'Show the pickup slot and a short reference the counter can read on the order page.', false, NULL,
     '{}', NULL, ARRAY['r001c3']),
    ('dc000000-0000-4000-8000-000000000707', 'dc000000-0000-4000-8000-00000000a000', 7, 'Refuse a full slot at checkout and offer the next free one.', false, NULL,
     '{}', 'The Orders API decides; the page shows its refusal and offers the next slot with room.', NULL),
    ('dc000000-0000-4000-8000-000000000708', 'dc000000-0000-4000-8000-00000000a000', 8, 'Complete manual step: Point the shop''s domain at the storefront in the DNS settings.', false, NULL,
     '{}', 'The domain is registered with the shop''s old web host. A person changes the record there once; no code output can.', NULL),
    ('dc000000-0000-4000-8000-000000000709', 'dc000000-0000-4000-8000-00000000a000', 9, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Kitchen display
    ('dc000000-0000-4000-8000-000000000710', 'dc000000-0000-4000-8000-00000000a001', 1, 'List paid orders by pickup slot, earliest first.', true, NULL,
     '{"source":"git","commitSha":"7b3c9d1","actor":"bakery-site-agent","at":"2026-09-23T11:30:00.000Z"}', NULL, ARRAY['r004c1']),
    ('dc000000-0000-4000-8000-000000000711', 'dc000000-0000-4000-8000-00000000a001', 2, 'Read the queue and mark orders ready through the Orders API.', true, NULL,
     '{"source":"git","commitSha":"7b3c9d1","actor":"bakery-site-agent","at":"2026-09-23T11:30:00.000Z"}', 'The display holds no order state of its own; the API is the record.', NULL),
    ('dc000000-0000-4000-8000-000000000712', 'dc000000-0000-4000-8000-00000000a001', 3, 'Make the ready button at least 64 px square.', false, NULL,
     '{}', 'Packers tap it with floury hands.', ARRAY['r004c2']),
    ('dc000000-0000-4000-8000-000000000713', 'dc000000-0000-4000-8000-00000000a001', 4, 'Keep the current and next slot on screen when the wifi drops.', false, NULL,
     '{}', 'Marks made offline are sent when the connection returns, oldest first.', NULL),
    ('dc000000-0000-4000-8000-000000000714', 'dc000000-0000-4000-8000-00000000a001', 5, 'Set the type so every order reads from 2 m away.', false, NULL,
     '{}', NULL, ARRAY['r004c3']),
    ('dc000000-0000-4000-8000-000000000715', 'dc000000-0000-4000-8000-00000000a001', 6, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Orders API
    ('dc000000-0000-4000-8000-000000000716', 'dc000000-0000-4000-8000-00000000a002', 1, 'Serve the slot list with remaining places from the slots table.', true, NULL,
     '{"source":"git","commitSha":"2f8e417","actor":"bakery-site-agent","at":"2026-09-21T15:45:00.000Z"}', NULL, ARRAY['r009c1']),
    ('dc000000-0000-4000-8000-000000000717', 'dc000000-0000-4000-8000-00000000a002', 2, 'Cap every slot at the capacity the shop settings give.', true, NULL,
     '{"source":"git","commitSha":"2f8e417","actor":"bakery-site-agent","at":"2026-09-21T15:45:00.000Z"}', NULL, ARRAY['r002c1']),
    ('dc000000-0000-4000-8000-000000000718', 'dc000000-0000-4000-8000-00000000a002', 3, 'Hold a place when checkout starts and release it after 10 minutes unpaid.', true, NULL,
     '{"source":"git","commitSha":"2f8e417","actor":"bakery-site-agent","at":"2026-09-21T15:45:00.000Z"}', 'The hold is a row with an expiry; the remaining count includes live holds.', ARRAY['r002c3']),
    ('dc000000-0000-4000-8000-000000000719', 'dc000000-0000-4000-8000-00000000a002', 4, 'Create one PaymentIntent per order with the order id as its idempotency key.', true, NULL,
     '{"source":"git","commitSha":"6d0e5b8","actor":"bakery-site-agent","at":"2026-09-24T10:20:00.000Z"}', NULL, ARRAY['r005c1']),
    ('dc000000-0000-4000-8000-00000000071a', 'dc000000-0000-4000-8000-00000000a002', 5, 'Mark an order paid once, however often the webhook arrives.', true, NULL,
     '{"source":"git","commitSha":"6d0e5b8","actor":"bakery-site-agent","at":"2026-09-24T10:20:00.000Z"}', NULL, ARRAY['r005c2']),
    ('dc000000-0000-4000-8000-00000000071b', 'dc000000-0000-4000-8000-00000000a002', 6, 'Give the last place in a slot inside one transaction.', false, NULL,
     '{}', 'Two checkouts racing for it get one order and one refusal that names the next free slot.', ARRAY['r002c2']),
    ('dc000000-0000-4000-8000-00000000071c', 'dc000000-0000-4000-8000-00000000a002', 7, 'Refund against the original PaymentIntent.', false, NULL,
     '{}', NULL, ARRAY['r005c3']),
    ('dc000000-0000-4000-8000-00000000071d', 'dc000000-0000-4000-8000-00000000a002', 8, 'Apply a capacity change only to places not yet given.', false, NULL,
     '{}', NULL, ARRAY['r009c2']),
    ('dc000000-0000-4000-8000-00000000071e', 'dc000000-0000-4000-8000-00000000a002', 9, 'Mark an order ready and ask Pickup texts for one text.', true, NULL,
     '{"source":"git","commitSha":"9d02f6c","actor":"bakery-site-agent","at":"2026-09-24T14:20:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-00000000071f', 'dc000000-0000-4000-8000-00000000a002', 10, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Bakery database
    ('dc000000-0000-4000-8000-000000000720', 'dc000000-0000-4000-8000-00000000a003', 1, 'Create the items, stock, orders, order lines and slots tables.', true, NULL,
     '{"source":"git","commitSha":"0c51b7a","actor":"bakery-site-agent","at":"2026-09-20T10:05:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-000000000721', 'dc000000-0000-4000-8000-00000000a003', 2, 'Turn on row level security so a customer reads only their own orders.', true, NULL,
     '{"source":"git","commitSha":"0c51b7a","actor":"bakery-site-agent","at":"2026-09-20T10:05:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-000000000722', 'dc000000-0000-4000-8000-00000000a003', 3, 'Hold slot capacity in a check the database enforces, not the page.', false, NULL,
     '{}', 'A constraint or a locked count, so no client can oversell a slot.', NULL),
    ('dc000000-0000-4000-8000-000000000723', 'dc000000-0000-4000-8000-00000000a003', 4, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Pickup texts
    ('dc000000-0000-4000-8000-000000000724', 'dc000000-0000-4000-8000-00000000a005', 1, 'Send one text when an order is marked ready, naming the slot and the counter.', true, NULL,
     '{"source":"git","commitSha":"9d02f6c","actor":"bakery-site-agent","at":"2026-09-24T14:20:00.000Z"}', NULL, ARRAY['r008c1']),
    ('dc000000-0000-4000-8000-000000000725', 'dc000000-0000-4000-8000-00000000a005', 2, 'Ignore a provider retry for an order that already has its text.', false, NULL,
     '{}', NULL, ARRAY['r008c2']),
    ('dc000000-0000-4000-8000-000000000726', 'dc000000-0000-4000-8000-00000000a005', 3, 'Report a failed send back to the order within 30 seconds.', false, NULL,
     '{}', NULL, ARRAY['r008c3']),
    ('dc000000-0000-4000-8000-000000000727', 'dc000000-0000-4000-8000-00000000a005', 4, 'Keep the slot and the counter in the first 40 characters.', false, NULL,
     '{}', 'Lock screens cut a text after about 40 characters.', ARRAY['r008c4']),
    ('dc000000-0000-4000-8000-000000000728', 'dc000000-0000-4000-8000-00000000a005', 5, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Daily cutoff
    ('dc000000-0000-4000-8000-000000000729', 'dc000000-0000-4000-8000-00000000a006', 1, 'Fire the bake list build at 20:00 shop time, the day before.', true, NULL,
     '{"source":"git","commitSha":"0c51b7a","actor":"bakery-site-agent","at":"2026-09-20T10:05:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-00000000072a', 'dc000000-0000-4000-8000-00000000a006', 2, 'Skip closed days from the shop settings.', false, NULL, '{}', NULL, NULL),
    ('dc000000-0000-4000-8000-00000000072b', 'dc000000-0000-4000-8000-00000000a006', 3, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Bake list builder
    ('dc000000-0000-4000-8000-00000000072c', 'dc000000-0000-4000-8000-00000000a007', 1, 'Sum every paid preorder for tomorrow by item.', true, NULL,
     '{"source":"git","commitSha":"5ea8c03","actor":"bakery-site-agent","at":"2026-09-25T09:15:00.000Z"}', NULL, ARRAY['r007c1']),
    ('dc000000-0000-4000-8000-00000000072d', 'dc000000-0000-4000-8000-00000000a007', 2, 'Take cancelled orders off before the list prints.', true, NULL,
     '{"source":"git","commitSha":"5ea8c03","actor":"bakery-site-agent","at":"2026-09-25T09:15:00.000Z"}', NULL, ARRAY['r007c4']),
    ('dc000000-0000-4000-8000-00000000072e', 'dc000000-0000-4000-8000-00000000a007', 3, 'Add the walk-in margin from the shop settings, rounded up to a tray of 12.', false, NULL,
     '{}', NULL, ARRAY['r007c2']),
    ('dc000000-0000-4000-8000-00000000072f', 'dc000000-0000-4000-8000-00000000a007', 4, 'Move an order paid after the cutoff to the next day''s list.', false, NULL,
     '{}', NULL, ARRAY['r007c3']),
    ('dc000000-0000-4000-8000-000000000730', 'dc000000-0000-4000-8000-00000000a007', 5, 'Add the standing wholesale orders.', false, NULL,
     '{}', 'The cafe on Pier Street takes 40 croissants a day, ordered by email today.', NULL),
    ('dc000000-0000-4000-8000-000000000731', 'dc000000-0000-4000-8000-00000000a007', 6, 'Print the list on the kitchen printer.', false, NULL,
     '{}', 'The printer address is in the shop settings.', NULL),
    ('dc000000-0000-4000-8000-000000000732', 'dc000000-0000-4000-8000-00000000a007', 7, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Customer accounts
    ('dc000000-0000-4000-8000-000000000733', 'dc000000-0000-4000-8000-00000000a008', 1, 'Sign customers in with a one-time code sent to their phone.', true, NULL,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-000000000734', 'dc000000-0000-4000-8000-00000000a008', 2, 'List a customer''s past orders, newest first.', false, NULL,
     '{}', NULL, ARRAY['r006c1']),
    ('dc000000-0000-4000-8000-000000000735', 'dc000000-0000-4000-8000-00000000a008', 3, 'Reorder into the cart at today''s prices.', true, NULL,
     '{"source":"git","commitSha":"41ad2e0","actor":"bakery-site-agent","at":"2026-09-22T16:10:00.000Z"}', NULL, ARRAY['r006c2']),
    ('dc000000-0000-4000-8000-000000000736', 'dc000000-0000-4000-8000-00000000a008', 4, 'Name any item no longer on the menu instead of dropping it.', false, NULL,
     '{}', NULL, ARRAY['r006c3']),
    ('dc000000-0000-4000-8000-000000000737', 'dc000000-0000-4000-8000-00000000a008', 5, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Shop settings
    ('dc000000-0000-4000-8000-000000000738', 'dc000000-0000-4000-8000-00000000a009', 1, 'Hold opening hours, closures, slot length and capacity in one settings row.', true, NULL,
     '{"source":"approval","actor":"bench@nodespec.local","at":"2026-09-21T12:00:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-000000000739', 'dc000000-0000-4000-8000-00000000a009', 2, 'Hold the walk-in margin and the tray size.', true, false,
     '{"source":"git","commitSha":"c7a19e2","actor":"bakery-site-agent","at":"2026-09-28T08:40:00.000Z"}', NULL, NULL),
    ('dc000000-0000-4000-8000-00000000073a', 'dc000000-0000-4000-8000-00000000a009', 3, 'Remove a closed day''s slots and its bake list.', false, NULL, '{}', NULL, NULL),
    ('dc000000-0000-4000-8000-00000000073b', 'dc000000-0000-4000-8000-00000000a009', 4, 'Keep opening hours out of every page.', true, NULL,
     '{"source":"approval","actor":"bench@nodespec.local","at":"2026-09-21T12:00:00.000Z"}', NULL, ARRAY['r009c3']),
    ('dc000000-0000-4000-8000-00000000073c', 'dc000000-0000-4000-8000-00000000a009', 5, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL),
    -- Product photos
    ('dc000000-0000-4000-8000-00000000073d', 'dc000000-0000-4000-8000-00000000a00a', 1, 'Store one photo per item, resized for the menu.', false, NULL, '{}', NULL, NULL),
    ('dc000000-0000-4000-8000-00000000073e', 'dc000000-0000-4000-8000-00000000a00a', 2, 'Verify every acceptance criterion above and tick its box.', false, NULL, '{}', NULL, NULL)
  ) AS v(id, node_id, ord, title, done, doc_done, provenance, detail, serves)
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.task_doc(p_snapshot uuid, p_node text, p_deliverable text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  g jsonb;
  n jsonb;
  proj uuid;
  role_label text;
  role_desc text;
  tech_name text;
  vision text;
  l text[] := ARRAY[]::text[];
  covered jsonb := '{}'::jsonb;
  before_l text[] := ARRAY[]::text[];
  after_l text[] := ARRAY[]::text[];
  t record;
  r record;
  a record;
  e record;
  other jsonb;
  c jsonb;
  other_role text;
  s text;
  req text;
  crit text;
BEGIN
  SELECT graph_data, project_id INTO g, proj FROM public.graph_snapshots WHERE id = p_snapshot;
  n := g->'nodes'->p_node;
  IF n IS NULL THEN RAISE EXCEPTION 'seed: no node % in the snapshot', p_node; END IF;
  SELECT label, description INTO role_label, role_desc FROM public.node_roles WHERE id = n->>'type';
  SELECT name INTO tech_name FROM public.technology_catalog WHERE id = n->>'technology';
  SELECT sp.vision INTO vision FROM public.project_specifications sp WHERE sp.project_id = proj;

  FOR t IN SELECT * FROM pg_temp.seed_tasks() x WHERE x.node_id = p_node::uuid ORDER BY x.ord LOOP
    FOREACH s IN ARRAY coalesce(t.serves, ARRAY[]::text[]) LOOP
      covered := covered || jsonb_build_object(s, 'T' || t.ord);
    END LOOP;
  END LOOP;

  l := l || ARRAY[
    '# Task: ' || (n->>'label'),
    '',
    '> **Scope:** implement ONLY this node ("' || (n->>'label') || $b$"). Work belonging to other nodes appears here solely as interfaces and coordination points -- do not implement or re-derive it.$b$,
    $b$> This document is DERIVED from the NodeSpec model + catalog (fingerprinted, regenerable via generate_task_docs). Node context/export is the model truth; propose model changes through the proposal flow -- hand-edits to model facts here do not change the model.$b$,
    '',
    '## Component Purpose',
    '',
    '**Role:** ' || coalesce(role_label, n->>'type')];
  IF n ? 'technology' THEN l := l || ARRAY['**Technology:** ' || coalesce(tech_name, n->>'technology')]; END IF;
  IF coalesce(role_desc, '') <> '' THEN l := l || ARRAY['**Description:** ' || role_desc]; END IF;
  IF n->'metadata' ? 'rationale' THEN l := l || ARRAY['**Rationale:** ' || (n->'metadata'->>'rationale')]; END IF;
  l := l || ARRAY['', '## Your Deliverable', ''];
  l := l || CASE p_deliverable
    WHEN 'code' THEN ARRAY['**Working code for this component**, honoring the contracts and criteria below, plus its configuration artifacts and tests.']
    WHEN 'declarative' THEN ARRAY[
      'This service is provisioned, not programmed -- no application code implements it (provider-managed, or operated by you if self-hosted).',
      $b$- **Provisioning configuration (IaC)** -- declare the service as config artifacts: existence, sizing, wiring, permissions. The IaC tool is NOT declared on this project's platform container -- CONFIRM the tool with the user (Terraform / OpenTofu / Pulumi / provider-native / CDK) before authoring artifacts; do NOT assume one.$b$,
      '- **Connection contracts** for every interface below']
    WHEN 'external-config' THEN ARRAY[
      '- **Connection configuration ONLY** -- endpoints, credential references, contracts. The service is configured in its own environment (console/UI); see Manual Steps. Do not author definition files it cannot import.']
    WHEN 'connection-only' THEN ARRAY[
      'This is an external service you call -- no application code implements it.',
      '- **Connection contracts** for every interface below',
      '- **Client configuration** as config artifacts; account/access setup in Manual Steps']
    ELSE ARRAY['- **Configuration artifacts** that bind this engine into the system (config kind)']
  END;
  l := l || ARRAY[
    '',
    '## Implementation Context',
    '',
    '<!-- AI-AUTHORED SECTION: NodeSpec never writes prose here. Your text survives regeneration verbatim while the derived sections around it keep refreshing. -->',
    $b$_Not yet authored._ **Consuming AI -- author this section BEFORE building.** Working from this full packet plus the repository, record the project-specific context no catalog can know: how this node's technology composes with its neighbors in THIS project, the integration specifics behind each interface contract, configuration rationale, and your intended implementation approach. Replace this placeholder (keep the heading) either by editing this file in the repo and pushing -- NodeSpec surfaces the edit as a change card for the user to accept -- or via an update_artifact patch through propose_patches. If a REVIEW NEEDED line appears here later, the derived context changed after you wrote this: re-verify the section, then delete that line.$b$,
    '',
    '## Implementation Tasks',
    '',
    $b$Ordered WORK ORDERS synthesized from the model -- this node's deliverable kind, contracts, criterion attribution, configuration, and dependency chain. They guarantee coverage, scope, and traceability; they deliberately do NOT contain the implementation detail -- that is your job (see the expansion directive below the list).$b$,
    ''];

  FOR t IN SELECT * FROM pg_temp.seed_tasks() x WHERE x.node_id = p_node::uuid ORDER BY x.ord LOOP
    l := l || ARRAY['- [' || CASE WHEN t.doc_done THEN 'x' ELSE ' ' END || '] **T' || t.ord || ' -- ' || t.title || '** <!-- t:' || pg_temp.task_anchor_key(t.title) || ' -->'];
    IF t.title = 'Verify every acceptance criterion above and tick its box.' THEN
      l := l || ARRAY[
        '  Ordering doctrine -- plans follow schemas (contract-first TDD): schemas → test plans → implement → verify. Resolve any open [PLACEHOLDER: schema] gap FIRST (get_build_readiness supplies draftInputs; submit the schema via propose_patches update_contract) -- test-plan scenarios touching a schemaless contract stay one-line [blocked by schema: …] markers until the schema lands, then the plan refreshes itself.',
        $b$  AUTOMATED criteria: call get_test_plan for EACH requirement this node serves, implement the plan's test cases, run them, and report every outcome via report_test_results -- a passing result flips the criterion's met flag automatically and the response receipt shows which criteria flipped.$b$,
        '  MANUAL criteria (rows marked (manual) above): report_test_results REFUSES to bind them -- prove each by ticking its criterion box in this task doc and having the user approve the resulting change card; that approval is the only thing that flips a manual criterion met.',
        '  This node is complete only when every criterion box is ticked and no `[PLACEHOLDER: …]` tag remains open.'];
    END IF;
    IF t.detail IS NOT NULL THEN l := l || ARRAY['  ' || t.detail]; END IF;
    FOREACH s IN ARRAY coalesce(t.serves, ARRAY[]::text[]) LOOP
      req := NULL; crit := NULL;
      SELECT r2.requirement_id, c2->>'text' INTO req, crit
        FROM public.specification_requirements r2
        JOIN public.project_specifications sp ON sp.id = r2.specification_id AND sp.project_id = proj
        CROSS JOIN LATERAL jsonb_array_elements(r2.acceptance_criteria) c2
       WHERE c2->>'id' = s;
      IF req IS NULL THEN RAISE EXCEPTION 'seed: task "%" serves %, which no requirement carries', t.title, s; END IF;
      l := l || ARRAY['  ↳ serves: ' || req || ' "' || crit || '"'];
    END LOOP;
  END LOOP;

  l := l || ARRAY[
    '',
    '**Your first action -- expand these work orders.** Each task above guarantees WHAT must be covered, not HOW. Before writing any code or configuration, expand every task with the concrete implementation steps for THIS technology in THIS project -- the specific resources, settings, files, schemas, and tests -- using the Configuration, Interface Contracts, Technology Guidance, and node context as your references. Record the expanded list in this section via update_artifact (propose_patches) after this doc is accepted, keeping task IDs, criterion citations, and open `[PLACEHOLDER: …]` tags intact. Resolve placeholders with the user through the proposal flow; this node is never complete while one remains open. When the work orders are implemented, verify through the test lane: run get_test_plan for each requirement this node serves, implement and run the plan''s tests, and report outcomes via report_test_results -- passing results are the evidence that flips criteria met.',
    '',
    '## Project Context',
    '',
    vision,
    ''];

  IF EXISTS (SELECT 1 FROM public.specification_mappings m WHERE m.node_id = p_node::uuid) THEN
    l := l || ARRAY['## Requirements -- Your Scope', ''];
    FOR r IN SELECT r2.* FROM public.specification_requirements r2
              WHERE r2.id IN (SELECT m.requirement_id FROM public.specification_mappings m WHERE m.node_id = p_node::uuid)
              ORDER BY r2.requirement_id LOOP
      l := l || ARRAY['### ' || r.requirement_id || ': ' || r.name, 'Category: ' || r.category || ' | Status: ' || r.status, r.description, '',
                      '**Acceptance criteria -- your task boxes:**'];
      FOR a IN SELECT value AS ac FROM jsonb_array_elements(r.acceptance_criteria) LOOP
        l := l || ARRAY['- [' || CASE WHEN (a.ac->>'met')::boolean THEN 'x' ELSE ' ' END || '] ' || (a.ac->>'text')
                        || CASE WHEN a.ac->>'verification' = 'manual' THEN ' (manual)' ELSE '' END];
        IF covered ? (a.ac->>'id') THEN l := l || ARRAY['  → covered by Task ' || (covered->>(a.ac->>'id'))]; END IF;
      END LOOP;
      l := l || ARRAY[''];
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_each(g->'edges') x WHERE x.value->>'source' = p_node OR x.value->>'target' = p_node) THEN
    l := l || ARRAY['## Interface Contracts', ''];
    FOR e IN SELECT x.key, x.value FROM jsonb_each(g->'edges') x
              WHERE x.value->>'source' = p_node OR x.value->>'target' = p_node ORDER BY x.key LOOP
      other := g->'nodes'->(CASE WHEN e.value->>'source' = p_node THEN e.value->>'target' ELSE e.value->>'source' END);
      c := g->'contracts'->(e.value->>'contractId');
      other_role := NULL;
      SELECT label INTO other_role FROM public.node_roles WHERE id = other->>'type';
      l := l || ARRAY[
        '### ' || CASE WHEN e.value->>'source' = p_node THEN 'SENDS TO' ELSE 'RECEIVES FROM' END || ': ' || (other->>'label') || ' (' || coalesce(other_role, other->>'type') || ')',
        '- **Contract:** ' || (c->>'name'),
        '- **Protocol:** ' || (c->>'kind')];
      IF c ? 'interactionKind' THEN l := l || ARRAY['- **Interaction:** ' || (c->>'interactionKind')]; END IF;
      IF c ? 'schema' THEN
        l := l || ARRAY['', '**Schema:**', '```', jsonb_pretty(c->'schema'), '```'];
      ELSIF c->>'kind' = 'dependency' OR c->>'interactionKind' = 'dependency' THEN
        l := l || ARRAY['', '_Dependency contract -- no payload schema expected. Capture the connection/config',
                        $b$expectations (endpoints, identifiers, references) in this node's config artifacts;$b$,
                        'propose a schema only if a real payload shape exists for this interface._'];
      ELSE
        l := l || ARRAY['', '**⚠ SCHEMA UNDEFINED**', '',
                        'Contract "' || (c->>'name') || '" (' || (c->>'kind') || ') has no schema or schemaRef.',
                        'No payload, endpoint, or message shape exists for this interface yet -- do NOT',
                        'invent one. Before implementing against this contract, propose a schema through',
                        'the proposal flow (propose_patches) and build only after it is accepted.'];
      END IF;
      l := l || ARRAY[''];
      IF e.value->>'source' = p_node THEN
        before_l := before_l || ARRAY['- ' || (other->>'label') || ' (' || (c->>'name') || ')'];
      ELSE
        after_l := after_l || ARRAY['- ' || (other->>'label') || ' (' || (c->>'name') || ')'];
      END IF;
    END LOOP;
    l := l || ARRAY['## Dependency Chain', '', 'Startup/initialization order based on edge directions and interaction patterns.', ''];
    IF cardinality(before_l) > 0 THEN l := l || ARRAY['**Must be available BEFORE this node starts:**'] || before_l || ARRAY['']; END IF;
    IF cardinality(after_l) > 0 THEN l := l || ARRAY['**Depends on THIS node being available:**'] || after_l || ARRAY['']; END IF;
  END IF;

  RETURN replace(array_to_string(l, E'\n'), ' -- ', ' ' || chr(8212) || ' ');
END
$fn$;
INSERT INTO public.projects (id, name, owner_id, metadata, automation_policy)
VALUES (
  'dc000000-0000-4000-8000-000000000200',
  'Harbor Lane Bakery (example)',
  'b0000000-0000-4000-8000-000000000001',
  '{"description": "Order ahead for pickup at a one-shop neighborhood bakery: today''s menu, a 15-minute pickup slot, card payment and one text when the order is ready. The kitchen bakes to the preorders plus a walk-in margin.",
    "example": "harbor-lane-bakery",
    "exampleVersion": 2,
    "exampleTeam": [
      {"email": "rosa.delgado@harborlanebakery.example", "role": "maintainer"},
      {"email": "sam.okafor@harborlanebakery.example", "role": "contributor"},
      {"email": "lena.fischer@harborlanebakery.example", "role": "viewer"}]}'::jsonb,
  '{"requirements": 1}'::jsonb
);
INSERT INTO public.branches (id, project_id, name, created_by, is_primary, metadata) VALUES
  ('dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000200', 'main',
   'b0000000-0000-4000-8000-000000000001', true, '{}'::jsonb),
  ('dc000000-0000-4000-8000-000000000211', 'dc000000-0000-4000-8000-000000000200', 'review/card-processor',
   'b0000000-0000-4000-8000-000000000001', false,
   '{"note": "the branch the card processor review proposals are filed against"}'::jsonb);
INSERT INTO public.graph_snapshots (id, project_id, branch_id, version, hash, patch_sequence, graph_data)
VALUES ('dc000000-0000-4000-8000-000000000220', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 3, 'hlbake03', 3, $graph${
  "id": "dc000000-0000-4000-8000-000000000200",
  "schemaVersion": 8,
  "version": 3,
  "hash": "hlbake03",
  "origin": "hybrid",
  "nodes": {
    "dc000000-0000-4000-8000-00000000a000": {
      "id": "dc000000-0000-4000-8000-00000000a000", "type": "frontend-app", "label": "Storefront", "status": "draft", "technology": "nextjs", "artifacts": [],
      "data": {"pages": "menu, slot picker, checkout, order page, account", "hosting": "one region, nearest the shop"},
      "metadata": {"position": {"x": 0, "y": 140}, "rationale": "Most orders are placed on a phone on the walk to work; the storefront is the whole order path for them."}
    },
    "dc000000-0000-4000-8000-00000000a001": {
      "id": "dc000000-0000-4000-8000-00000000a001", "type": "frontend-app", "label": "Kitchen display", "status": "draft", "technology": "react", "artifacts": [],
      "data": {"device": "one tablet by the pickup shelf", "offline": "keeps the current and next slot"},
      "metadata": {"position": {"x": 0, "y": 420}, "rationale": "Two packers work from one tablet by the pickup shelf; the display is their only view of the queue."}
    },
    "dc000000-0000-4000-8000-00000000a002": {
      "id": "dc000000-0000-4000-8000-00000000a002", "type": "serverless-function", "label": "Orders API", "status": "draft", "technology": "supabase-edge-functions", "artifacts": [],
      "data": {"endpoints": "slots, checkout, payment webhook, ready", "holds": "10 minutes"},
      "metadata": {"position": {"x": 640, "y": 380}, "rationale": "One place gives out pickup places and takes payment, so the storefront and the kitchen never disagree."}
    },
    "dc000000-0000-4000-8000-00000000a003": {
      "id": "dc000000-0000-4000-8000-00000000a003", "type": "database", "label": "Bakery database", "status": "complete", "technology": "supabase-db", "artifacts": [],
      "data": {"tables": "items, stock, orders, order_lines, slots, holds, shop_settings"},
      "metadata": {"position": {"x": 960, "y": 520}, "rationale": "Orders, holds, stock and slots in one database the API and the bake list share."}
    },
    "dc000000-0000-4000-8000-00000000a004": {
      "id": "dc000000-0000-4000-8000-00000000a004", "type": "external-service", "label": "Card payments", "status": "complete", "technology": "stripe", "artifacts": [],
      "data": {"uses": "PaymentIntents, webhooks, refunds"},
      "metadata": {"position": {"x": 960, "y": 120}, "rationale": "The shop already takes cards with Stripe at the farmers market."}
    },
    "dc000000-0000-4000-8000-00000000a005": {
      "id": "dc000000-0000-4000-8000-00000000a005", "type": "notification-service", "label": "Pickup texts", "status": "draft", "technology": "twilio", "artifacts": [],
      "data": {"volume": "about 900 texts a month"},
      "metadata": {"position": {"x": 960, "y": 320}, "rationale": "One text when the order is ready; customers asked for nothing more."}
    },
    "dc000000-0000-4000-8000-00000000a006": {
      "id": "dc000000-0000-4000-8000-00000000a006", "type": "scheduled-trigger", "label": "Daily cutoff", "status": "complete", "artifacts": [],
      "data": {"schedule": "20:00 shop time, the day before"},
      "metadata": {"position": {"x": 0, "y": 700}, "rationale": "Dough for the morning is mixed at 21:00, so the list has to exist by then."}
    },
    "dc000000-0000-4000-8000-00000000a007": {
      "id": "dc000000-0000-4000-8000-00000000a007", "type": "serverless-function", "label": "Bake list builder", "status": "draft", "technology": "supabase-edge-functions", "artifacts": [],
      "data": {"margin": "20% by default, rounded up to a tray of 12"},
      "metadata": {"position": {"x": 640, "y": 700}, "rationale": "The baker bakes from one printed list instead of counting orders at 5 am."}
    },
    "dc000000-0000-4000-8000-00000000a008": {
      "id": "dc000000-0000-4000-8000-00000000a008", "type": "auth-provider", "label": "Customer accounts", "status": "complete", "technology": "supabase-auth", "artifacts": [],
      "data": {"method": "one-time code by text"},
      "metadata": {"position": {"x": 320, "y": 0}, "rationale": "Regulars sign in with their phone number to reorder; nobody has to."}
    },
    "dc000000-0000-4000-8000-00000000a009": {
      "id": "dc000000-0000-4000-8000-00000000a009", "type": "config-store", "label": "Shop settings", "status": "draft", "artifacts": [],
      "data": {"defaults": "7:00 to 14:00, 15-minute slots, 6 orders each, cutoff 20:00, margin 20%"},
      "metadata": {"position": {"x": 960, "y": 760}, "rationale": "Hours, closures, capacity and the margin change with the season and live in one row."}
    },
    "dc000000-0000-4000-8000-00000000a00a": {
      "id": "dc000000-0000-4000-8000-00000000a00a", "type": "object-storage", "label": "Product photos", "status": "suggested", "technology": "supabase-storage", "artifacts": [],
      "data": {"size": "one photo per item, 800 px"},
      "metadata": {"position": {"x": 320, "y": 260}, "rationale": "Menu photos are suggested, not decided: the shop may keep a text-only menu."}
    }
  },
  "edges": {
    "dc000000-0000-4000-8000-00000000e001": {"id": "dc000000-0000-4000-8000-00000000e001", "source": "dc000000-0000-4000-8000-00000000a000", "target": "dc000000-0000-4000-8000-00000000a002", "contractId": "dc000000-0000-4000-8000-00000000c001", "label": "menu, slots, checkout", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e002": {"id": "dc000000-0000-4000-8000-00000000e002", "source": "dc000000-0000-4000-8000-00000000a001", "target": "dc000000-0000-4000-8000-00000000a002", "contractId": "dc000000-0000-4000-8000-00000000c001", "label": "queue and mark ready", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e003": {"id": "dc000000-0000-4000-8000-00000000e003", "source": "dc000000-0000-4000-8000-00000000a002", "target": "dc000000-0000-4000-8000-00000000a003", "contractId": "dc000000-0000-4000-8000-00000000c002", "label": "orders, holds, stock", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e004": {"id": "dc000000-0000-4000-8000-00000000e004", "source": "dc000000-0000-4000-8000-00000000a002", "target": "dc000000-0000-4000-8000-00000000a004", "contractId": "dc000000-0000-4000-8000-00000000c003", "label": "PaymentIntent and webhook", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e005": {"id": "dc000000-0000-4000-8000-00000000e005", "source": "dc000000-0000-4000-8000-00000000a002", "target": "dc000000-0000-4000-8000-00000000a005", "contractId": "dc000000-0000-4000-8000-00000000c004", "label": "one text per ready order", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e006": {"id": "dc000000-0000-4000-8000-00000000e006", "source": "dc000000-0000-4000-8000-00000000a002", "target": "dc000000-0000-4000-8000-00000000a009", "contractId": "dc000000-0000-4000-8000-00000000c005", "label": "hours and capacity", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e007": {"id": "dc000000-0000-4000-8000-00000000e007", "source": "dc000000-0000-4000-8000-00000000a006", "target": "dc000000-0000-4000-8000-00000000a007", "contractId": "dc000000-0000-4000-8000-00000000c006", "label": "20:00, the day before", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e008": {"id": "dc000000-0000-4000-8000-00000000e008", "source": "dc000000-0000-4000-8000-00000000a007", "target": "dc000000-0000-4000-8000-00000000a003", "contractId": "dc000000-0000-4000-8000-00000000c002", "label": "paid preorders", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e009": {"id": "dc000000-0000-4000-8000-00000000e009", "source": "dc000000-0000-4000-8000-00000000a007", "target": "dc000000-0000-4000-8000-00000000a009", "contractId": "dc000000-0000-4000-8000-00000000c005", "label": "walk-in margin and tray size", "criticality": "required"},
    "dc000000-0000-4000-8000-00000000e010": {"id": "dc000000-0000-4000-8000-00000000e010", "source": "dc000000-0000-4000-8000-00000000a000", "target": "dc000000-0000-4000-8000-00000000a008", "contractId": "dc000000-0000-4000-8000-00000000c007", "label": "sign-in and past orders", "criticality": "optional"},
    "dc000000-0000-4000-8000-00000000e011": {"id": "dc000000-0000-4000-8000-00000000e011", "source": "dc000000-0000-4000-8000-00000000a000", "target": "dc000000-0000-4000-8000-00000000a00a", "contractId": "dc000000-0000-4000-8000-00000000c008", "label": "menu photos", "criticality": "optional"}
  },
  "contracts": {
    "dc000000-0000-4000-8000-00000000c001": {"id": "dc000000-0000-4000-8000-00000000c001", "kind": "rest", "interactionKind": "request_response", "name": "Orders API (REST)", "status": "draft"},
    "dc000000-0000-4000-8000-00000000c002": {"id": "dc000000-0000-4000-8000-00000000c002", "kind": "sql", "interactionKind": "data_sync", "name": "Bakery data (SQL)", "status": "complete",
      "schema": {"type": "object", "properties": {"order": {"type": "object", "required": ["id", "slot_id", "status", "phone"], "properties": {"id": {"type": "string", "format": "uuid"}, "slot_id": {"type": "string", "format": "uuid"}, "status": {"enum": ["held", "paid", "ready", "collected", "refunded"]}, "phone": {"type": "string"}}}}}},
    "dc000000-0000-4000-8000-00000000c003": {"id": "dc000000-0000-4000-8000-00000000c003", "kind": "rest", "interactionKind": "request_response", "name": "Card payment and webhook", "status": "complete",
      "schema": {"type": "object", "required": ["order_id", "amount_cents", "idempotency_key"], "properties": {"order_id": {"type": "string", "format": "uuid"}, "amount_cents": {"type": "integer", "minimum": 50}, "idempotency_key": {"type": "string", "description": "the order id"}}}},
    "dc000000-0000-4000-8000-00000000c004": {"id": "dc000000-0000-4000-8000-00000000c004", "kind": "rest", "interactionKind": "request_response", "name": "Ready text", "status": "draft"},
    "dc000000-0000-4000-8000-00000000c005": {"id": "dc000000-0000-4000-8000-00000000c005", "kind": "sql", "interactionKind": "data_read", "name": "Shop settings read", "status": "complete",
      "schema": {"type": "object", "required": ["open", "close", "slot_minutes", "slot_capacity", "cutoff", "margin", "tray_size"], "properties": {"open": {"type": "string", "example": "07:00"}, "close": {"type": "string", "example": "14:00"}, "slot_minutes": {"type": "integer", "default": 15}, "slot_capacity": {"type": "integer", "default": 6}, "cutoff": {"type": "string", "example": "20:00"}, "margin": {"type": "number", "default": 0.2}, "tray_size": {"type": "integer", "default": 12}, "closed_days": {"type": "array", "items": {"type": "string", "format": "date"}}}}},
    "dc000000-0000-4000-8000-00000000c006": {"id": "dc000000-0000-4000-8000-00000000c006", "kind": "custom", "interactionKind": "event", "name": "Daily cutoff trigger", "status": "complete",
      "schema": {"type": "object", "required": ["bake_day"], "properties": {"bake_day": {"type": "string", "format": "date"}}}},
    "dc000000-0000-4000-8000-00000000c007": {"id": "dc000000-0000-4000-8000-00000000c007", "kind": "rest", "interactionKind": "auth", "name": "Customer sign-in", "status": "complete",
      "schema": {"type": "object", "required": ["phone"], "properties": {"phone": {"type": "string", "description": "E.164"}, "code": {"type": "string", "pattern": "^[0-9]{6}$"}}}},
    "dc000000-0000-4000-8000-00000000c008": {"id": "dc000000-0000-4000-8000-00000000c008", "kind": "rest", "interactionKind": "file_transfer", "name": "Product photos", "status": "draft"}
  },
  "artifacts": {},
  "metadata": {"revision": 2, "reviewed": "2026-09-24"}
}$graph$::jsonb);
UPDATE public.graph_snapshots s
   SET graph_data = jsonb_set(s.graph_data, '{artifacts}', (
     SELECT jsonb_object_agg(a.id, jsonb_build_object(
       'id', a.id, 'nodeId', a.node_id, 'kind', a.kind, 'path', a.path,
       'content', a.content, 'status', a.status, 'language', a.language,
       'createdAt', '2026-09-20T10:00:00.000Z', 'updatedAt', a.updated_at))
     FROM (VALUES
       ('dc000000-0000-4000-8000-00000000b010', 'dc000000-0000-4000-8000-00000000a000', 'source', 'app/(shop)/page.tsx', 'export default async function Menu() {}', 'complete', 'typescript', '2026-09-22T16:10:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b011', 'dc000000-0000-4000-8000-00000000a000', 'source', 'app/checkout/page.tsx', 'export default function Checkout() {}', 'draft', 'typescript', '2026-09-22T16:10:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b012', 'dc000000-0000-4000-8000-00000000a001', 'source', 'kitchen/src/App.tsx', 'export function App() {}', 'draft', 'typescript', '2026-09-23T11:30:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b013', 'dc000000-0000-4000-8000-00000000a002', 'source', 'supabase/functions/orders-api/index.ts', 'Deno.serve(handler)', 'draft', 'typescript', '2026-09-27T09:30:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b014', 'dc000000-0000-4000-8000-00000000a003', 'schema', 'supabase/migrations/0001_bakery.sql', 'create table items (id uuid primary key, name text not null)', 'complete', 'sql', '2026-09-20T10:05:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b015', 'dc000000-0000-4000-8000-00000000a005', 'source', 'supabase/functions/ready-text/index.ts', 'Deno.serve(sendReadyText)', 'draft', 'typescript', '2026-09-24T14:20:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b016', 'dc000000-0000-4000-8000-00000000a007', 'source', 'supabase/functions/build-bake-list/index.ts', 'Deno.serve(buildBakeList)', 'draft', 'typescript', '2026-09-25T09:15:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b017', 'dc000000-0000-4000-8000-00000000a009', 'config', 'config/shop-settings.json', '{ "slotMinutes": 15, "slotCapacity": 6, "cutoff": "20:00", "margin": 0.2, "traySize": 12 }', 'draft', 'json', '2026-09-28T08:40:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b018', 'dc000000-0000-4000-8000-00000000a006', 'config', 'supabase/migrations/0004_cutoff_schedule.sql', 'cron: 0 20 * * *, shop time', 'complete', 'sql', '2026-09-20T10:05:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b019', 'dc000000-0000-4000-8000-00000000a008', 'config', 'supabase/config.toml', '[auth.sms]', 'complete', 'toml', '2026-09-22T16:10:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b020', 'dc000000-0000-4000-8000-00000000a000', 'source', 'tests/e2e/order-to-pickup.spec.ts', 'import { test } from ''@playwright/test''', 'complete', 'typescript', '2026-09-22T16:10:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b021', 'dc000000-0000-4000-8000-00000000a000', 'source', 'tests/e2e/menu.spec.ts', 'import { test } from ''@playwright/test''', 'complete', 'typescript', '2026-09-22T16:10:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b022', 'dc000000-0000-4000-8000-00000000a008', 'source', 'tests/e2e/account.spec.ts', 'import { test } from ''@playwright/test''', 'draft', 'typescript', '2026-09-26T13:00:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b023', 'dc000000-0000-4000-8000-00000000a001', 'source', 'kitchen/src/__tests__/queue.test.tsx', 'import { describe } from ''vitest''', 'draft', 'typescript', '2026-09-23T11:30:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b024', 'dc000000-0000-4000-8000-00000000a002', 'source', 'tests/orders/slots.test.ts', 'import { describe } from ''vitest''', 'draft', 'typescript', '2026-09-26T09:30:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b025', 'dc000000-0000-4000-8000-00000000a002', 'source', 'tests/orders/payments.test.ts', 'import { describe } from ''vitest''', 'complete', 'typescript', '2026-09-24T10:20:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b026', 'dc000000-0000-4000-8000-00000000a007', 'source', 'tests/bake-list/build.test.ts', 'import { describe } from ''vitest''', 'draft', 'typescript', '2026-09-25T09:15:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b027', 'dc000000-0000-4000-8000-00000000a005', 'source', 'tests/texts/ready.test.ts', 'import { describe } from ''vitest''', 'draft', 'typescript', '2026-09-26T09:30:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b028', 'dc000000-0000-4000-8000-00000000a009', 'source', 'tests/settings/hours.test.ts', 'import { describe } from ''vitest''', 'complete', 'typescript', '2026-09-21T12:00:00.000Z'),
       ('dc000000-0000-4000-8000-00000000b030', 'dc000000-0000-4000-8000-00000000a000', 'doc', 'docs/order-ahead-brief.md', '# Harbor Lane Bakery: order ahead (brief, revision 2)', 'complete', 'markdown', '2026-09-19T08:30:00.000Z')
     ) AS a(id, node_id, kind, path, content, status, language, updated_at)))
 WHERE s.id = 'dc000000-0000-4000-8000-000000000220';
INSERT INTO public.project_specifications
  (id, project_id, vision, constraints, preferences, created_by, metadata, phase_status)
VALUES (
  'dc000000-0000-4000-8000-000000000230',
  'dc000000-0000-4000-8000-000000000200',
  'Customers order today''s and tomorrow''s bakes from their phone, choose a 15-minute pickup slot, pay by card and get one text when the order is ready. The kitchen bakes to the preorders plus a walk-in margin, packs by slot from a tablet, and never promises a slot it cannot fill. Walk-in customers are served as before, and nobody needs an account to order.',
  '[]'::jsonb, '{}'::jsonb,
  'b0000000-0000-4000-8000-000000000001',
  '{"revision": 2, "reviewed": "2026-09-24", "precedence": "shop rules > card processor review > brief > sketches"}'::jsonb,
  'architecture_confirmed'
);
INSERT INTO public.specification_sections (id, specification_id, name, description, order_index, ai_generated) VALUES
  ('dc000000-0000-4000-8000-000000000240', 'dc000000-0000-4000-8000-000000000230', 'Global · orders end to end', 'The rules that hold across the whole order path.', 0, false),
  ('dc000000-0000-4000-8000-000000000241', 'dc000000-0000-4000-8000-000000000230', 'Storefront',                 'What a customer sees and does on the phone.', 1, false),
  ('dc000000-0000-4000-8000-000000000242', 'dc000000-0000-4000-8000-000000000230', 'Kitchen',                    'The bake list, the display and the packing.', 2, false),
  ('dc000000-0000-4000-8000-000000000243', 'dc000000-0000-4000-8000-000000000230', 'Payments',                   'Taking the card once, and refunding against it.', 3, false),
  ('dc000000-0000-4000-8000-000000000244', 'dc000000-0000-4000-8000-000000000230', 'Accounts',                   'Returning customers and their past orders.', 4, false),
  ('dc000000-0000-4000-8000-000000000245', 'dc000000-0000-4000-8000-000000000230', 'Pickup texts',               'The one text a customer gets.', 5, false),
  ('dc000000-0000-4000-8000-000000000246', 'dc000000-0000-4000-8000-000000000230', 'Shop settings',              'Hours, closures, capacity and the margin, in one place.', 6, false);
INSERT INTO public.specification_requirements
  (id, specification_id, section_id, requirement_id, name, description, category, status, source, confirmed, locked, acceptance_criteria, metadata)
VALUES
  ('dc000000-0000-4000-8000-000000000251', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000240',
   'REQ-001', 'An order runs from menu to collection in one path',
   'Menu, cart, slot, payment, the kitchen queue, the ready text and collection run in that order for a fresh order, and nothing a customer may skip (an account, a note) stops it.',
   'functional', 'implemented', 'manual', true, false,
   $j$[
     {"id": "r001c1", "text": "Menu, cart, slot, payment, kitchen queue, ready text and collection run in one uninterrupted order", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000301", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000301", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r001c2", "text": "Guest checkout works without creating an account", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000302", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000302", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r001c3", "text": "The order page shows the pickup slot and a reference the counter can read", "verification": "automated", "met": false}
   ]$j$::jsonb,
   '{}'::jsonb),
  ('dc000000-0000-4000-8000-000000000252', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000240',
   'REQ-002', 'A pickup slot is never oversold',
   'Each 15-minute slot holds at most the orders the shop settings allow (6 by default). Two customers paying for the last place at the same moment get one order and one clear refusal, never two orders.',
   'functional', 'in-progress', 'refined', true, false,
   $j$[
     {"id": "r002c1", "text": "A slot accepts no more orders than its capacity", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000303", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000303", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r002c2", "text": "Two simultaneous checkouts for the last place produce one order and one refusal", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000304"},
     {"id": "r002c3", "text": "A held place is released if payment does not complete within 10 minutes", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000305", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000305", "at": "2026-09-26T09:10:00.000Z"}}
   ]$j$::jsonb,
   '{"promotion": {"candidateKey": "outcome:hl-02", "at": "2026-09-21T14:02:00.000Z", "by": "bakery-site-agent"}}'::jsonb),
  ('dc000000-0000-4000-8000-000000000253', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000241',
   'REQ-003', 'The menu shows only what can still be ordered',
   'The storefront lists today''s and tomorrow''s items with what is left of each, leaves out an item at zero, and shows the allergens on every item.',
   'functional', 'validated', 'refined', true, false,
   $j$[
     {"id": "r003c1", "text": "An item with no stock left disappears from the menu within a minute", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000306", "evidenceStale": "the stock query changed after the last run", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000306", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r003c2", "text": "Every item shows its allergens on the menu and at checkout", "verification": "manual", "met": true, "provenance": {"source": "approval", "actor": "shop review", "at": "2026-09-26T15:30:00.000Z"}}
   ]$j$::jsonb,
   '{"promotion": {"candidateKey": "outcome:hl-03", "at": "2026-09-21T14:04:00.000Z", "by": "bakery-site-agent"}}'::jsonb),
  ('dc000000-0000-4000-8000-000000000254', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000242',
   'REQ-004', 'The kitchen display shows what to pack next',
   'The tablet by the pickup shelf lists paid orders by pickup slot, earliest first, with each order''s items and notes, and a packer marks an order ready with one tap.',
   'functional', 'in-progress', 'manual', true, false,
   $j$[
     {"id": "r004c1", "text": "Orders are listed by pickup slot, earliest first", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000307", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000307", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r004c2", "text": "The ready button is at least 64 px square", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000308"},
     {"id": "r004c3", "text": "A packer reads every order from 2 m away", "verification": "manual", "met": false}
   ]$j$::jsonb,
   '{}'::jsonb),
  ('dc000000-0000-4000-8000-000000000255', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000243',
   'REQ-005', 'A card is charged once and only once',
   'Checkout creates one Stripe PaymentIntent per order with the order id as its idempotency key. A retried request, a double tap or a webhook delivered twice never charges twice.',
   'technical', 'implemented', 'refined', true, false,
   $j$[
     {"id": "r005c1", "text": "A retried checkout request reuses the same PaymentIntent", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000309", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000309", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r005c2", "text": "A payment webhook delivered twice marks the order paid once", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000310", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000310", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r005c3", "text": "A refund is issued against the original PaymentIntent", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000311"}
   ]$j$::jsonb,
   '{"locked": "the card processor review fixed the idempotency key to the order id"}'::jsonb),
  ('dc000000-0000-4000-8000-000000000256', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000244',
   'REQ-006', 'A returning customer reorders in two taps',
   'A signed-in customer sees past orders newest first and puts one back in the cart at today''s prices. An item no longer on the menu is named, not silently dropped.',
   'functional', 'in-progress', 'refined', true, false,
   $j$[
     {"id": "r006c1", "text": "Past orders list on the account page, newest first", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000312"},
     {"id": "r006c2", "text": "Reorder fills the cart with the same items at today's prices", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000313", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000313", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r006c3", "text": "Items no longer on the menu are named, not silently dropped", "verification": "manual", "met": false}
   ]$j$::jsonb,
   '{"promotion": {"candidateKey": "outcome:hl-04", "at": "2026-09-21T14:06:00.000Z", "by": "bakery-site-agent"}}'::jsonb),
  ('dc000000-0000-4000-8000-000000000257', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000242',
   'REQ-007', 'The bake list covers every preorder plus a walk-in margin',
   'At the cutoff the bake list sums every paid preorder for the next day by item and adds the walk-in margin from the shop settings (20% by default), rounded up to a full tray of 12. Nothing paid after the cutoff lands on tomorrow''s list.',
   'functional', 'in-progress', 'refined', true, false,
   $j$[
     {"id": "r007c1", "text": "The list sums every paid preorder by item", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000314", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000314", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r007c2", "text": "The walk-in margin rounds up to a full tray of 12", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000315"},
     {"id": "r007c3", "text": "An order paid after the cutoff moves to the next day's list", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000316"},
     {"id": "r007c4", "text": "Cancelled orders come off the list before it prints", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000317", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000317", "at": "2026-09-26T09:10:00.000Z"}}
   ]$j$::jsonb,
   '{"promotion": {"candidateKey": "outcome:hl-01", "at": "2026-09-21T13:58:00.000Z", "by": "bakery-site-agent"}}'::jsonb),
  ('dc000000-0000-4000-8000-000000000258', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000245',
   'REQ-008', 'The ready text is sent once, when the order is ready',
   'Marking an order ready sends one text to the number given at checkout, naming the pickup slot and the counter. A second tap, a provider retry or a page reload never sends a second text, and a failed send shows on the kitchen display.',
   'functional', 'blocked', 'refined', true, false,
   $j$[
     {"id": "r008c1", "text": "Marking an order ready sends exactly one text", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000318", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000318", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r008c2", "text": "A provider retry does not send a second text", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000319"},
     {"id": "r008c3", "text": "A failed send shows on the kitchen display within 30 seconds", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000320"},
     {"id": "r008c4", "text": "The text reads clearly on a phone lock screen", "verification": "manual", "met": false}
   ]$j$::jsonb,
   '{"promotion": {"candidateKey": "outcome:hl-06", "at": "2026-09-21T14:10:00.000Z", "by": "bakery-site-agent"}}'::jsonb),
  ('dc000000-0000-4000-8000-000000000259', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000246',
   'REQ-009', 'Opening hours and closures come from one place',
   'Slots, the cutoff and the menu read opening hours, closures and slot capacity from the shop settings. A holiday closure entered once removes that day''s slots and its bake list.',
   'technical', 'pending', 'refined', false, false,
   $j$[
     {"id": "r009c1", "text": "A closed day offers no pickup slots", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000321", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000321", "at": "2026-09-26T09:10:00.000Z"}},
     {"id": "r009c2", "text": "A capacity change applies only to places not yet booked", "verification": "automated", "met": false, "testId": "dc000000-0000-4000-8000-000000000322"},
     {"id": "r009c3", "text": "No page hard-codes the opening hours", "verification": "automated", "met": true, "testId": "dc000000-0000-4000-8000-000000000323", "provenance": {"source": "test", "testCaseId": "dc000000-0000-4000-8000-000000000323", "at": "2026-09-26T09:10:00.000Z"}}
   ]$j$::jsonb,
   '{"promotion": {"candidateKey": "outcome:hl-10", "at": "2026-09-21T14:12:00.000Z", "by": "bakery-site-agent"}}'::jsonb),
  ('dc000000-0000-4000-8000-00000000025a', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000240',
   'REQ-010', 'Pricing rules the shop already uses',
   'Behaviour the Orders API already exercises in tests/orders/pricing.test.ts. The till and the storefront have to agree on these, so they are held here as a requirement rather than re-read from the code.',
   'technical', 'pending', 'imported', false, false,
   $j$[
     {"id": "r010c1", "text": "a dozen costs the dozen price, not twelve singles", "verification": "automated"},
     {"id": "r010c2", "text": "sales tax is added once per order", "verification": "automated"},
     {"id": "r010c3", "text": "prices are held in whole cents", "verification": "automated"}
   ]$j$::jsonb,
   '{"backfill": {"kind": "behavior", "candidateKey": "behavior:orders-api:tests/orders/pricing.test.ts", "acceptedAt": "2026-09-19T10:02:00.000Z"}}'::jsonb);
INSERT INTO public.specification_mappings
  (id, specification_id, requirement_id, node_id, mapping_type, confidence, notes, created_by, validation_status)
VALUES
  ('dc000000-0000-4000-8000-000000000261', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000251', 'dc000000-0000-4000-8000-00000000a000', 'implements', 0.95, 'The order path is the storefront''s whole job.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000262', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000252', 'dc000000-0000-4000-8000-00000000a002', 'implements', 0.90, 'The API gives out places.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000263', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000252', 'dc000000-0000-4000-8000-00000000a003', 'implements', 0.90, 'A capacity check the database holds.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000264', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000252', 'dc000000-0000-4000-8000-00000000a000', 'implements', 0.90, 'The slot picker shows what is left.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000265', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000253', 'dc000000-0000-4000-8000-00000000a000', 'implements', 0.95, NULL, 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000266', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000254', 'dc000000-0000-4000-8000-00000000a001', 'implements', 0.95, NULL, 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000267', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000255', 'dc000000-0000-4000-8000-00000000a002', 'implements', 1.00, 'Charging once is the API''s job.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000268', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000256', 'dc000000-0000-4000-8000-00000000a008', 'implements', 0.95, NULL, 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-000000000269', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000257', 'dc000000-0000-4000-8000-00000000a007', 'implements', 0.95, NULL, 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-00000000026a', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000257', 'dc000000-0000-4000-8000-00000000a009', 'depends_on', 0.85, 'The margin and the tray size live in the shop settings.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-00000000026b', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000258', 'dc000000-0000-4000-8000-00000000a005', 'implements', 0.95, NULL, 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-00000000026c', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000259', 'dc000000-0000-4000-8000-00000000a009', 'implements', 0.90, 'Hours, closures and capacity.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-00000000026d', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-000000000259', 'dc000000-0000-4000-8000-00000000a002', 'supports', 0.80, 'The slot list reads them.', 'b0000000-0000-4000-8000-000000000001', 'valid'),
  ('dc000000-0000-4000-8000-00000000026e', 'dc000000-0000-4000-8000-000000000230', 'dc000000-0000-4000-8000-00000000025a', 'dc000000-0000-4000-8000-00000000a002', 'implements', 0.60, 'backfill_requirements: behavior candidate from repo-index evidence', NULL, 'valid');
UPDATE public.specification_requirements
   SET locked = true
 WHERE id = 'dc000000-0000-4000-8000-000000000255';
INSERT INTO public.test_cases
  (id, requirement_id, test_id, name, description, test_type, status, framework, expected_result, artifact_path, source_artifact_ids, stale, staleness_reason, updated_at)
VALUES
  ('dc000000-0000-4000-8000-000000000301', 'dc000000-0000-4000-8000-000000000251', 'TC-001', 'A full order from menu to collection', 'Order two items as a guest, pay, mark ready in the kitchen and collect.', 'e2e', 'passed', 'playwright', 'Every stage is reached once, in order, with one text sent.', 'tests/e2e/order-to-pickup.spec.ts', ARRAY['dc000000-0000-4000-8000-00000000b020']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000302', 'dc000000-0000-4000-8000-000000000251', 'TC-002', 'Guest checkout needs no account', 'Check out with a name and a phone number only.', 'e2e', 'passed', 'playwright', 'The order is placed and no account is created.', 'tests/e2e/order-to-pickup.spec.ts', ARRAY['dc000000-0000-4000-8000-00000000b020']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000303', 'dc000000-0000-4000-8000-000000000252', 'TC-003', 'A full slot refuses the next order', 'Fill a slot to capacity and try one more checkout.', 'integration', 'passed', 'vitest', 'The seventh checkout is refused with the next free slot named.', 'tests/orders/slots.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b024']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000304', 'dc000000-0000-4000-8000-000000000252', 'TC-004', 'Two checkouts race for the last place', 'Start two checkouts for the last place in a slot at the same moment.', 'integration', 'failed', 'vitest', 'One order and one refusal; never two orders.', 'tests/orders/slots.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b024','dc000000-0000-4000-8000-00000000b013']::uuid[], false, NULL, '2026-09-27T09:30:00.000Z'),
  ('dc000000-0000-4000-8000-000000000305', 'dc000000-0000-4000-8000-000000000252', 'TC-005', 'An unpaid hold is released after 10 minutes', 'Hold a place, never pay, and read the slot after 10 minutes.', 'integration', 'passed', 'vitest', 'The place is free again.', 'tests/orders/slots.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b024']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000306', 'dc000000-0000-4000-8000-000000000253', 'TC-006', 'A sold-out item leaves the menu within a minute', 'Sell the last of an item and reload the menu.', 'e2e', 'passed', 'playwright', 'The item is gone from the menu within 60 seconds.', 'tests/e2e/menu.spec.ts', ARRAY['dc000000-0000-4000-8000-00000000b021','dc000000-0000-4000-8000-00000000b010']::uuid[], true, 'the stock query changed after the last run', '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000307', 'dc000000-0000-4000-8000-000000000254', 'TC-007', 'The kitchen queue is ordered by pickup slot', 'Place orders for three slots out of order and read the queue.', 'unit', 'passed', 'vitest', 'The earliest slot is first, then the next.', 'kitchen/src/__tests__/queue.test.tsx', ARRAY['dc000000-0000-4000-8000-00000000b023']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000308', 'dc000000-0000-4000-8000-000000000254', 'TC-008', 'The ready button is at least 64 px square', 'Measure the rendered ready button on the tablet viewport.', 'acceptance', 'not_started', 'vitest', 'Both sides measure 64 px or more.', 'kitchen/src/__tests__/queue.test.tsx', ARRAY['dc000000-0000-4000-8000-00000000b023']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000309', 'dc000000-0000-4000-8000-000000000255', 'TC-009', 'A retried checkout reuses the PaymentIntent', 'Send the same checkout twice with the same order id.', 'integration', 'passed', 'vitest', 'One PaymentIntent exists for the order.', 'tests/orders/payments.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b025','dc000000-0000-4000-8000-00000000b013']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000310', 'dc000000-0000-4000-8000-000000000255', 'TC-010', 'A duplicate webhook marks the order paid once', 'Deliver the same payment webhook twice.', 'integration', 'passed', 'vitest', 'The order is paid once and no second confirmation is sent.', 'tests/orders/payments.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b025']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000311', 'dc000000-0000-4000-8000-000000000255', 'TC-011', 'A refund goes against the original PaymentIntent', 'Cancel a paid order before the cutoff and read the refund.', 'integration', 'running', 'vitest', 'The refund names the original PaymentIntent.', 'tests/orders/payments.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b025']::uuid[], false, NULL, '2026-09-29T08:05:00.000Z'),
  ('dc000000-0000-4000-8000-000000000312', 'dc000000-0000-4000-8000-000000000256', 'TC-012', 'Past orders list newest first', 'Sign in as a customer with three past orders and open the account page.', 'e2e', 'failed', 'playwright', 'The newest order is first.', 'tests/e2e/account.spec.ts', ARRAY['dc000000-0000-4000-8000-00000000b022']::uuid[], false, NULL, '2026-09-27T09:30:00.000Z'),
  ('dc000000-0000-4000-8000-000000000313', 'dc000000-0000-4000-8000-000000000256', 'TC-013', 'Reorder uses today''s prices', 'Reorder an order placed before a price change.', 'e2e', 'passed', 'playwright', 'The cart holds the same items at today''s prices.', 'tests/e2e/account.spec.ts', ARRAY['dc000000-0000-4000-8000-00000000b022']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000314', 'dc000000-0000-4000-8000-000000000257', 'TC-014', 'The bake list sums paid preorders by item', 'Build the list over a day of paid and unpaid orders.', 'unit', 'passed', 'vitest', 'Each item''s count equals the paid preorders for it.', 'tests/bake-list/build.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b026']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000315', 'dc000000-0000-4000-8000-000000000257', 'TC-015', 'The walk-in margin rounds up to a full tray', 'Build the list with 31 preordered croissants and a 20% margin.', 'unit', 'not_started', 'vitest', '48 croissants: 31 plus 20%, rounded up to four trays of 12.', 'tests/bake-list/build.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b026','dc000000-0000-4000-8000-00000000b017']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000316', 'dc000000-0000-4000-8000-000000000257', 'TC-016', 'An order paid after the cutoff moves to the next day', 'Pay for an order at 20:01 for tomorrow.', 'integration', 'not_started', 'vitest', 'It is on the day after tomorrow''s list, not tomorrow''s.', 'tests/bake-list/build.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b026']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000317', 'dc000000-0000-4000-8000-000000000257', 'TC-017', 'Cancelled orders come off the list', 'Cancel a paid order before the cutoff and build the list.', 'unit', 'passed', 'vitest', 'The cancelled order''s items are not counted.', 'tests/bake-list/build.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b026']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000318', 'dc000000-0000-4000-8000-000000000258', 'TC-018', 'Marking ready sends one text', 'Mark an order ready and count the provider calls.', 'integration', 'passed', 'vitest', 'Exactly one call, naming the slot and the counter.', 'tests/texts/ready.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b027']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000319', 'dc000000-0000-4000-8000-000000000258', 'TC-019', 'A provider retry sends no second text', 'Replay the provider''s delivery callback for an order already texted.', 'integration', 'failed', 'vitest', 'No second text is sent.', 'tests/texts/ready.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b027','dc000000-0000-4000-8000-00000000b015']::uuid[], false, NULL, '2026-09-27T09:30:00.000Z'),
  ('dc000000-0000-4000-8000-000000000320', 'dc000000-0000-4000-8000-000000000258', 'TC-020', 'A failed send shows on the kitchen display', 'Make the provider refuse a send and watch the order on the display.', 'integration', 'not_started', 'vitest', 'The order shows the failed send within 30 seconds.', 'tests/texts/ready.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b027']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000321', 'dc000000-0000-4000-8000-000000000259', 'TC-021', 'A closed day offers no slots', 'Close next Monday in the settings and list its slots.', 'integration', 'passed', 'vitest', 'No slot is offered for the closed day.', 'tests/orders/slots.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b024']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000322', 'dc000000-0000-4000-8000-000000000259', 'TC-022', 'A capacity change applies to unbooked places only', 'Lower a half-booked slot''s capacity below its bookings.', 'integration', 'not_started', 'vitest', 'Existing orders stand; no new place is given.', 'tests/orders/slots.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b024','dc000000-0000-4000-8000-00000000b017']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000323', 'dc000000-0000-4000-8000-000000000259', 'TC-023', 'No page hard-codes the opening hours', 'Search the storefront for literal opening times.', 'unit', 'passed', 'vitest', 'Every time shown comes from the shop settings.', 'tests/settings/hours.test.ts', ARRAY['dc000000-0000-4000-8000-00000000b028']::uuid[], false, NULL, '2026-09-26T09:10:00.000Z');
INSERT INTO public.workflows (id, project_id, name, color, owner_label, contributors, sort_order, created_by) VALUES
  ('dc000000-0000-4000-8000-000000000401', 'dc000000-0000-4000-8000-000000000200', 'Customer order', '#4fc98f', 'Sam Okafor',   ARRAY['Sam Okafor','Lena Fischer'],  0, 'b0000000-0000-4000-8000-000000000001'),
  ('dc000000-0000-4000-8000-000000000402', 'dc000000-0000-4000-8000-000000000200', 'Kitchen day',    '#9b9ff0', 'Rosa Delgado', ARRAY['Rosa Delgado','Sam Okafor'],  1, 'b0000000-0000-4000-8000-000000000001');
INSERT INTO public.workflow_steps (id, workflow_id, name, sort_order) VALUES
  ('dc000000-0000-4000-8000-000000000411', 'dc000000-0000-4000-8000-000000000401', 'Browse today''s menu',             0),
  ('dc000000-0000-4000-8000-000000000412', 'dc000000-0000-4000-8000-000000000401', 'Choose a pickup slot',            1),
  ('dc000000-0000-4000-8000-000000000413', 'dc000000-0000-4000-8000-000000000401', 'Pay by card',                     2),
  ('dc000000-0000-4000-8000-000000000414', 'dc000000-0000-4000-8000-000000000401', 'Get the ready text',              3),
  ('dc000000-0000-4000-8000-000000000415', 'dc000000-0000-4000-8000-000000000401', 'Collect at the counter',          4),
  ('dc000000-0000-4000-8000-000000000416', 'dc000000-0000-4000-8000-000000000401', 'Change or refund an order',       5),
  ('dc000000-0000-4000-8000-000000000417', 'dc000000-0000-4000-8000-000000000401', 'Order again',                     6),
  ('dc000000-0000-4000-8000-000000000421', 'dc000000-0000-4000-8000-000000000402', 'Close preorders at the cutoff',   0),
  ('dc000000-0000-4000-8000-000000000422', 'dc000000-0000-4000-8000-000000000402', 'Print the bake list',             1),
  ('dc000000-0000-4000-8000-000000000423', 'dc000000-0000-4000-8000-000000000402', 'Bake and stock the counter',      2),
  ('dc000000-0000-4000-8000-000000000424', 'dc000000-0000-4000-8000-000000000402', 'Pack orders by slot',             3),
  ('dc000000-0000-4000-8000-000000000425', 'dc000000-0000-4000-8000-000000000402', 'Mark ready and text the customer', 4),
  ('dc000000-0000-4000-8000-000000000426', 'dc000000-0000-4000-8000-000000000402', 'Count the day''s waste',          5);
INSERT INTO public.requirement_candidates
  (id, project_id, branch_id, workflow_id, node_id, key, kind, name, description, category, criteria, evidence, status, requirement_row_id, decided_at)
VALUES
  ('dc000000-0000-4000-8000-000000000501', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000402', 'dc000000-0000-4000-8000-00000000a007', 'outcome:hl-01', 'outcome', 'The morning bake covers every preorder',
   'Whoever opens at 5 am bakes from one list and never recounts orders by hand.', 'functional',
   $j$[{"id":"o01c1","text":"The list sums every paid preorder by item","verification":"automated"},{"id":"o01c2","text":"Cancelled orders come off the list before it prints","verification":"automated"},{"id":"o01c3","text":"Nobody recounts orders by hand at 5 am","verification":"manual"}]$j$::jsonb,
   '{"source": "kitchen interview with Rosa, 2026-09-03"}'::jsonb, 'pending', 'dc000000-0000-4000-8000-000000000257', NULL),
  ('dc000000-0000-4000-8000-000000000502', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', NULL, 'outcome:hl-02', 'outcome', 'Nobody is promised a slot the kitchen cannot fill',
   'Six bags fit on the pickup shelf per slot; a seventh is a customer waiting at the counter.', 'functional',
   $j$[{"id":"o02c1","text":"A slot accepts no more orders than its capacity","verification":"automated"},{"id":"o02c2","text":"Two simultaneous checkouts for the last place produce one order and one refusal","verification":"automated"},{"id":"o02c3","text":"A held place is released if payment does not complete within 10 minutes","verification":"automated"}]$j$::jsonb,
   '{"source": "card processor review, finding: a double tap held two places"}'::jsonb, 'pending', 'dc000000-0000-4000-8000-000000000252', NULL),
  ('dc000000-0000-4000-8000-000000000503', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', 'dc000000-0000-4000-8000-00000000a000', 'outcome:hl-03', 'outcome', 'Customers only see what they can still buy',
   'Nobody pays for a croissant that sold out at 9.', 'functional',
   $j$[{"id":"o03c1","text":"An item with no stock left disappears from the menu within a minute","verification":"automated"},{"id":"o03c2","text":"Every item shows its allergens on the menu and at checkout","verification":"manual"}]$j$::jsonb,
   '{"source": "brief, revision 2, the menu"}'::jsonb, 'pending', 'dc000000-0000-4000-8000-000000000253', NULL),
  ('dc000000-0000-4000-8000-000000000504', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', 'dc000000-0000-4000-8000-00000000a008', 'outcome:hl-04', 'outcome', 'Regulars reorder without retyping',
   'The Saturday regulars order the same box every week.', 'functional',
   $j$[{"id":"o04c1","text":"Past orders list on the account page, newest first","verification":"automated"},{"id":"o04c2","text":"Reorder fills the cart with the same items at today's prices","verification":"automated"},{"id":"o04c3","text":"Items no longer on the menu are named, not silently dropped","verification":"manual"}]$j$::jsonb,
   '{"source": "counter notes, September"}'::jsonb, 'pending', 'dc000000-0000-4000-8000-000000000256', NULL),
  ('dc000000-0000-4000-8000-000000000505', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', 'dc000000-0000-4000-8000-00000000a001', 'outcome:hl-05', 'outcome', 'Allergen notes travel with the order',
   'A note typed at checkout reaches the person packing the bag, every time.', 'technical',
   $j$[{"id":"o05c1","text":"Allergen notes print on the bag label","verification":"automated"},{"id":"o05c2","text":"The kitchen display flags any order with a note","verification":"automated"}]$j$::jsonb,
   '{"source": "county food guidance and two customer emails"}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-000000000506', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000402', 'dc000000-0000-4000-8000-00000000a005', 'outcome:hl-06', 'outcome', 'The ready text arrives once',
   'One text, when the bag is on the shelf; never two, never before.', 'functional',
   $j$[{"id":"o06c1","text":"Marking an order ready sends exactly one text","verification":"automated"},{"id":"o06c2","text":"A provider retry does not send a second text","verification":"automated"},{"id":"o06c3","text":"A failed send shows on the kitchen display within 30 seconds","verification":"automated"},{"id":"o06c4","text":"The text reads clearly on a phone lock screen","verification":"manual"}]$j$::jsonb,
   '{"source": "brief, revision 2, pickup"}'::jsonb, 'pending', 'dc000000-0000-4000-8000-000000000258', NULL),
  ('dc000000-0000-4000-8000-000000000507', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', NULL, 'outcome:hl-07', 'outcome', 'A refund never needs a phone call',
   'Cancelling before the cutoff refunds the card on its own.', 'non-functional',
   $j$[{"id":"o07c1","text":"A customer can cancel up to the cutoff and is refunded automatically","verification":"automated"},{"id":"o07c2","text":"The refund shows on the order page within a minute","verification":"automated"}]$j$::jsonb,
   '{"source": "counter notes, September"}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-000000000508', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000402', 'dc000000-0000-4000-8000-00000000a007', 'outcome:hl-08', 'outcome', 'Standing wholesale orders keep arriving',
   'The cafe on Pier Street takes 40 croissants every morning by email. Moving the bake to preorders alone would drop it.', 'technical',
   $j$[{"id":"o08c1","text":"Standing wholesale orders appear on the bake list every day","verification":"manual"},{"id":"o08c2","text":"Wholesale orders never take a pickup place","verification":"manual"}]$j$::jsonb,
   '{"source": "existing behaviour that needs a deliberate move"}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-000000000509', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', NULL, 'outcome:hl-09', 'outcome', 'Most orders are ready before the customer arrives',
   'An ambition, not a measured result: the counter wants nine bags in ten on the shelf before the slot starts. No criteria yet; this is what an unwritten outcome looks like.', 'business',
   '[]'::jsonb,
   '{"source": "brief, revision 2, what success looks like"}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-000000000510', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000402', 'dc000000-0000-4000-8000-00000000a009', 'outcome:hl-10', 'outcome', 'Hours live in one place',
   'The shop closes for two weeks in January; that is typed once.', 'technical',
   $j$[{"id":"o10c1","text":"A closed day offers no pickup slots","verification":"automated"},{"id":"o10c2","text":"No page hard-codes the opening hours","verification":"automated"}]$j$::jsonb,
   '{"source": "card processor review, finding: hours copied into three pages"}'::jsonb, 'pending', 'dc000000-0000-4000-8000-000000000259', NULL),
  ('dc000000-0000-4000-8000-000000000511', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000401', NULL, 'outcome:hl-11', 'outcome', 'Delivery by courier',
   'Carried over from the first brief and dismissed: the shop is pickup only this year, and a courier would need slots and packaging of its own.', 'business',
   $j$[{"id":"o11c1","text":"Orders within 3 miles can be delivered","verification":"manual"}]$j$::jsonb,
   '{"source": "first brief"}'::jsonb, 'dismissed', NULL, '2026-09-21T11:20:00.000Z');
INSERT INTO public.outcome_step_maps (id, branch_id, candidate_id, step_id) VALUES
  ('dc000000-0000-4000-8000-000000000521', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000501', 'dc000000-0000-4000-8000-000000000422'),
  ('dc000000-0000-4000-8000-000000000522', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000501', 'dc000000-0000-4000-8000-000000000421'),
  ('dc000000-0000-4000-8000-000000000523', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000502', 'dc000000-0000-4000-8000-000000000412'),
  ('dc000000-0000-4000-8000-000000000524', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000502', 'dc000000-0000-4000-8000-000000000424'),
  ('dc000000-0000-4000-8000-000000000525', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000503', 'dc000000-0000-4000-8000-000000000411'),
  ('dc000000-0000-4000-8000-000000000526', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000503', 'dc000000-0000-4000-8000-000000000423'),
  ('dc000000-0000-4000-8000-000000000527', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000504', 'dc000000-0000-4000-8000-000000000417'),
  ('dc000000-0000-4000-8000-000000000528', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000505', 'dc000000-0000-4000-8000-000000000415'),
  ('dc000000-0000-4000-8000-000000000529', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000505', 'dc000000-0000-4000-8000-000000000424'),
  ('dc000000-0000-4000-8000-00000000052a', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000506', 'dc000000-0000-4000-8000-000000000425'),
  ('dc000000-0000-4000-8000-00000000052b', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000506', 'dc000000-0000-4000-8000-000000000414'),
  ('dc000000-0000-4000-8000-00000000052c', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000507', 'dc000000-0000-4000-8000-000000000416'),
  ('dc000000-0000-4000-8000-00000000052d', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000508', 'dc000000-0000-4000-8000-000000000421'),
  ('dc000000-0000-4000-8000-00000000052e', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000509', 'dc000000-0000-4000-8000-000000000415'),
  ('dc000000-0000-4000-8000-00000000052f', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000510', 'dc000000-0000-4000-8000-000000000421'),
  ('dc000000-0000-4000-8000-000000000530', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000510', 'dc000000-0000-4000-8000-000000000412');
UPDATE public.requirement_candidates
   SET status = 'accepted', decided_at = '2026-09-21T16:00:00.000Z'
 WHERE id = 'dc000000-0000-4000-8000-000000000501';
UPDATE public.requirement_candidates
   SET status = 'accepted', decided_at = '2026-09-26T15:31:00.000Z'
 WHERE id = 'dc000000-0000-4000-8000-000000000503';
INSERT INTO public.outcome_derivations
  (id, project_id, branch_id, candidate_id, requirement_row_id, criteria_slice, proposed_by_kind, proposed_by_id, approved_by, created_at)
VALUES
  ('dc000000-0000-4000-8000-000000000541', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000501', 'dc000000-0000-4000-8000-000000000257', '["o01c1","o01c2","o01c3"]'::jsonb, 'agent', 'bakery-site-agent', 'b0000000-0000-4000-8000-000000000001', '2026-09-21T13:58:00.000Z'),
  ('dc000000-0000-4000-8000-000000000542', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000502', 'dc000000-0000-4000-8000-000000000252', '["o02c1","o02c2","o02c3"]'::jsonb, 'agent', 'bakery-site-agent', 'b0000000-0000-4000-8000-000000000001', '2026-09-21T14:02:00.000Z'),
  ('dc000000-0000-4000-8000-000000000543', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000503', 'dc000000-0000-4000-8000-000000000253', '["o03c1","o03c2"]'::jsonb, 'agent', 'bakery-site-agent', 'b0000000-0000-4000-8000-000000000001', '2026-09-21T14:04:00.000Z'),
  ('dc000000-0000-4000-8000-000000000544', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000504', 'dc000000-0000-4000-8000-000000000256', '["o04c1","o04c2","o04c3"]'::jsonb, 'agent', 'bakery-site-agent', 'b0000000-0000-4000-8000-000000000001', '2026-09-21T14:06:00.000Z'),
  ('dc000000-0000-4000-8000-000000000545', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000506', 'dc000000-0000-4000-8000-000000000258', '["o06c1","o06c2","o06c3","o06c4"]'::jsonb, 'agent', 'bakery-site-agent', 'b0000000-0000-4000-8000-000000000001', '2026-09-21T14:10:00.000Z'),
  ('dc000000-0000-4000-8000-000000000546', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000510', 'dc000000-0000-4000-8000-000000000259', '["o10c1","o10c2"]'::jsonb, 'human', 'bench@nodespec.local', 'b0000000-0000-4000-8000-000000000001', '2026-09-21T14:12:00.000Z');
INSERT INTO public.project_constraints (id, project_id, ctype, title, description, rationale, author, workflow_id, source_hash)
SELECT v.id::uuid, 'dc000000-0000-4000-8000-000000000200', v.ctype, v.title, v.description, v.rationale, v.author,
       v.workflow_id::uuid, pg_temp.constraint_identity(v.ctype, v.description)
FROM (VALUES
  ('dc000000-0000-4000-8000-000000000601', 'technology', 'Cards go through Stripe only',
   'Cards are taken by Stripe''s payment elements. The bakery never sees or stores a card number.',
   'Card scope stays with the processor; the shop already has a Stripe account for the farmers market reader.',
   'shop brief', NULL),
  ('dc000000-0000-4000-8000-000000000602', 'performance', 'The menu is usable in 2 seconds on a phone',
   'On a mid-range phone over 4G, the menu is usable within 2 seconds.',
   'Most orders are placed on the walk to work.',
   'shop brief', 'dc000000-0000-4000-8000-000000000401'),
  ('dc000000-0000-4000-8000-000000000603', 'architecture', 'Slots are 15 minutes, 6 orders each',
   'Pickup runs in 15-minute slots from 7:00 to 14:00, each holding 6 orders unless the shop settings say otherwise.',
   'Two people pack at the counter, and six bags is what fits on the pickup shelf per slot.',
   'Rosa Delgado', 'dc000000-0000-4000-8000-000000000401'),
  ('dc000000-0000-4000-8000-000000000604', 'architecture', 'Preorders close at 20:00 the day before',
   'The bake list is built once, at the cutoff. Nothing paid after it changes tomorrow''s bake.',
   'Dough for the morning is mixed at 21:00.',
   'Rosa Delgado', 'dc000000-0000-4000-8000-000000000402'),
  ('dc000000-0000-4000-8000-000000000605', 'compliance', 'Every item lists its allergens',
   'Every menu item carries the major allergens it contains, and an order note can add more.',
   'The county asks it of prepackaged food, and customers ask for it at the counter.',
   'Lena Fischer', NULL),
  ('dc000000-0000-4000-8000-000000000606', 'architecture', 'The kitchen display survives the wifi',
   'If the shop wifi drops, the kitchen display keeps the current and next slot on screen and sends its marks when it returns.',
   'The kitchen is at the back of an old brick building and the wifi drops there.',
   'Sam Okafor', 'dc000000-0000-4000-8000-000000000402'),
  ('dc000000-0000-4000-8000-000000000607', 'deployment', 'One region, nearest the shop',
   'Everything runs in one Supabase project in the region nearest the shop. No second region.',
   'One shop and a few hundred orders a week.',
   'Sam Okafor', NULL),
  ('dc000000-0000-4000-8000-000000000608', 'cost', 'Texts stay under $30 a month',
   'Pickup texts are sent only when an order is ready, one per order, and never for marketing.',
   'About 900 orders a month; one text each keeps the bill near $10.',
   'Lena Fischer', 'dc000000-0000-4000-8000-000000000402'),
  ('dc000000-0000-4000-8000-000000000609', 'other', 'Pickup only',
   'Orders are collected at the counter. There is no delivery.',
   'A courier would need slots and packaging of its own; the shop decided against it this year.',
   'shop brief', 'dc000000-0000-4000-8000-000000000401')
) AS v(id, ctype, title, description, rationale, author, workflow_id);
INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title, done, orphaned, provenance)
SELECT t.id, 'dc000000-0000-4000-8000-000000000200', t.node_id, pg_temp.task_anchor_key(t.title), 'T' || t.ord, t.title, t.done, false, t.provenance
FROM pg_temp.seed_tasks() t;
INSERT INTO public.task_items (id, project_id, node_id, task_key, display_id, title, done, orphaned, provenance)
VALUES ('dc000000-0000-4000-8000-00000000073f', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-00000000a007',
        pg_temp.task_anchor_key('Email the bake list to the kitchen at 20:05.'), 'T6', 'Email the bake list to the kitchen at 20:05.', false, true,
        '{"source":"git","commitSha":"3a7710e","actor":"bakery-site-agent","at":"2026-09-19T17:00:00.000Z"}'::jsonb);
DO $docs$
DECLARE docs jsonb;
BEGIN
  SELECT jsonb_object_agg(d.id, jsonb_build_object(
           'id', d.id, 'nodeId', d.node_id, 'kind', 'task', 'path', d.path,
           'content', pg_temp.task_doc('dc000000-0000-4000-8000-000000000220', d.node_id, d.deliverable),
           'status', d.status, 'language', 'markdown',
           'createdAt', '2026-09-20T10:00:00.000Z', 'updatedAt', '2026-09-28T09:00:00.000Z'))
    INTO docs
    FROM (VALUES
      ('dc000000-0000-4000-8000-00000000b001', 'dc000000-0000-4000-8000-00000000a000', '.nodespec/tasks/storefront.task.md',        'draft',     'code'),
      ('dc000000-0000-4000-8000-00000000b002', 'dc000000-0000-4000-8000-00000000a001', '.nodespec/tasks/kitchen-display.task.md',   'draft',     'code'),
      ('dc000000-0000-4000-8000-00000000b003', 'dc000000-0000-4000-8000-00000000a002', '.nodespec/tasks/orders-api.task.md',        'draft',     'code'),
      ('dc000000-0000-4000-8000-00000000b004', 'dc000000-0000-4000-8000-00000000a003', '.nodespec/tasks/bakery-database.task.md',   'complete',  'declarative'),
      ('dc000000-0000-4000-8000-00000000b005', 'dc000000-0000-4000-8000-00000000a005', '.nodespec/tasks/pickup-texts.task.md',      'draft',     'connection-only'),
      ('dc000000-0000-4000-8000-00000000b006', 'dc000000-0000-4000-8000-00000000a006', '.nodespec/tasks/daily-cutoff.task.md',      'complete',  'config'),
      ('dc000000-0000-4000-8000-00000000b007', 'dc000000-0000-4000-8000-00000000a007', '.nodespec/tasks/bake-list-builder.task.md', 'draft',     'code'),
      ('dc000000-0000-4000-8000-00000000b008', 'dc000000-0000-4000-8000-00000000a008', '.nodespec/tasks/customer-accounts.task.md', 'draft',     'external-config'),
      ('dc000000-0000-4000-8000-00000000b009', 'dc000000-0000-4000-8000-00000000a009', '.nodespec/tasks/shop-settings.task.md',     'draft',     'code'),
      ('dc000000-0000-4000-8000-00000000b00a', 'dc000000-0000-4000-8000-00000000a00a', '.nodespec/tasks/product-photos.task.md',    'suggested', 'declarative')
    ) AS d(id, node_id, path, status, deliverable);
  UPDATE public.graph_snapshots
     SET graph_data = jsonb_set(graph_data, '{artifacts}', (graph_data->'artifacts') || docs)
   WHERE id = 'dc000000-0000-4000-8000-000000000220';
END
$docs$;
INSERT INTO public.couplings (id, branch_id, scope, coupling_type, detail, from_task_item_id, to_task_item_id, from_candidate_id, to_candidate_id, from_requirement_id, to_requirement_id, created_by) VALUES
  ('dc000000-0000-4000-8000-000000000801', 'dc000000-0000-4000-8000-000000000210', 'intra', 'waits_on',
   'A retry can only be recognised once the first send records its message id.',
   'dc000000-0000-4000-8000-000000000725', 'dc000000-0000-4000-8000-000000000724', NULL, NULL, NULL, NULL, 'b0000000-0000-4000-8000-000000000001'),
  ('dc000000-0000-4000-8000-000000000802', 'dc000000-0000-4000-8000-000000000210', 'cross', 'waits_on',
   'The margin cannot be applied until the shop settings hold it.',
   'dc000000-0000-4000-8000-00000000072e', 'dc000000-0000-4000-8000-000000000739', NULL, NULL, NULL, NULL, 'b0000000-0000-4000-8000-000000000001'),
  ('dc000000-0000-4000-8000-000000000803', 'dc000000-0000-4000-8000-000000000210', 'intra', 'waits_on',
   'A cancelled order frees its place, so refunds wait on how places are held.',
   NULL, NULL, 'dc000000-0000-4000-8000-000000000507', 'dc000000-0000-4000-8000-000000000502', NULL, NULL, 'b0000000-0000-4000-8000-000000000001'),
  ('dc000000-0000-4000-8000-000000000804', 'dc000000-0000-4000-8000-000000000210', 'cross', 'waits_on',
   'A failed send is reported against the ready request the Orders API makes.',
   'dc000000-0000-4000-8000-000000000726', 'dc000000-0000-4000-8000-00000000071e', NULL, NULL, NULL, NULL, 'b0000000-0000-4000-8000-000000000001'),
  ('dc000000-0000-4000-8000-000000000805', 'dc000000-0000-4000-8000-000000000210', 'intra', 'waits_on',
   'Circular by design: the last-place transaction reads the capacity a change may lower, and a capacity change has to know which places that transaction already gave.',
   'dc000000-0000-4000-8000-00000000071b', 'dc000000-0000-4000-8000-00000000071d', NULL, NULL, NULL, NULL, 'b0000000-0000-4000-8000-000000000001');
INSERT INTO public.artifacts (id, project_id, branch_id, node_id, type, kind, path, content_text, language, description) VALUES
  ('dc000000-0000-4000-8000-00000000d001', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-00000000a002', 'source', 'source', 'supabase/functions/orders-api/index.ts',      'Deno.serve(handler)',          'typescript', 'Slots, holds, checkout, the payment webhook and the ready endpoint.'),
  ('dc000000-0000-4000-8000-00000000d002', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-00000000a000', 'source', 'source', 'app/checkout/page.tsx',                       'export default function Checkout() {}', 'typescript', 'Slot picker, guest details and the Stripe hand-off.'),
  ('dc000000-0000-4000-8000-00000000d003', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-00000000a007', 'source', 'source', 'supabase/functions/build-bake-list/index.ts', 'Deno.serve(buildBakeList)',    'typescript', 'Sums paid preorders by item at the cutoff.'),
  ('dc000000-0000-4000-8000-00000000d004', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-00000000a005', 'source', 'source', 'supabase/functions/ready-text/index.ts',      'Deno.serve(sendReadyText)',    'typescript', 'One text per ready order, through Twilio.'),
  ('dc000000-0000-4000-8000-00000000d005', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-00000000a009', 'config', 'config', 'config/shop-settings.json',                   '{ "slotMinutes": 15, "slotCapacity": 6, "cutoff": "20:00", "margin": 0.2, "traySize": 12 }', 'json', 'Hours, slot length, capacity, the cutoff and the margin.'),
  ('dc000000-0000-4000-8000-00000000d006', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-00000000a003', 'schema', 'schema', 'supabase/migrations/0001_bakery.sql',         'create table items (id uuid primary key, name text not null)', 'sql', 'The tables every node reads or writes.');
INSERT INTO public.agent_checkouts
  (id, project_id, branch_id, level, holder_kind, holder_label, holder_delegate, task_item_id, artifact_id, requirement_id, candidate_id, meta, since, heartbeat_at, released_at, released_reason)
VALUES
  ('dc000000-0000-4000-8000-000000000811', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'task', 'agent', 'bakery-site-agent', 'oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1',
   'dc000000-0000-4000-8000-000000000725', NULL, NULL, NULL,
   '{"note": "putting the ready text behind an outbox row and re-running TC-019"}'::jsonb,
   now() - interval '18 minutes', now(), NULL, NULL),
  ('dc000000-0000-4000-8000-000000000812', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'code', 'agent', 'bakery-site-agent', 'oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1',
   NULL, 'dc000000-0000-4000-8000-00000000d004', NULL, NULL,
   '{"note": "ready-text/index.ts is open for the outbox change"}'::jsonb,
   now() - interval '18 minutes', now(), NULL, NULL),
  ('dc000000-0000-4000-8000-000000000813', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'requirement', 'human', 'bench@nodespec.local', 'user:b0000000-0000-4000-8000-000000000001',
   NULL, NULL, 'dc000000-0000-4000-8000-000000000258', NULL,
   '{"note": "advisory: rewriting the provider-retry criterion after TC-019 failed"}'::jsonb,
   now() - interval '52 minutes', now(), NULL, NULL),
  ('dc000000-0000-4000-8000-000000000814', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', 'task', 'agent', 'bakery-site-agent', 'oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1',
   'dc000000-0000-4000-8000-00000000072c', NULL, NULL, NULL,
   '{"note": "bake list sums checked against last Saturday''s orders"}'::jsonb,
   now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', 'verified');
INSERT INTO public.import_jobs
  (id, project_id, branch_id, integration_id, status, stage, stages, skeleton, open_questions, proposal_id, metrics, created_at, updated_at)
VALUES (
  'dc000000-0000-4000-8000-000000000a01',
  'dc000000-0000-4000-8000-000000000200',
  'dc000000-0000-4000-8000-000000000210',
  NULL,
  'completed',
  'synthesis',
  $j$["skeleton", "archive", "resolution", "analysis", "synthesis"]$j$::jsonb,
  $j${"repo": "github.com/harbor-lane/bakery-site", "ref": "1d4b9e0", "files": 286, "languages": {"TypeScript": 171, "TSX": 66, "SQL": 19, "JSON": 18, "Markdown": 12}}$j$::jsonb,
  $j$[
    {
      "kind": "backing-service",
      "group": "Bake list builder",
      "detail": "build-bake-list/index.ts posts the finished list to a URL it reads from shop_settings.printer_url at run time. No package, host or client names what answers there, so the import drew no node and no edge for it.",
      "evidence": ["supabase/functions/build-bake-list/index.ts:52 fetch(settings.printer_url, { method: \"POST\" })", "config/shop-settings.json:7 printer_url"]
    },
    {
      "kind": "deployment-mismatch",
      "group": "Storefront",
      "detail": "vercel.json deploys the storefront to Vercel, and .github/workflows/deploy.yml also runs netlify deploy on main. The import placed the storefront on neither host.",
      "evidence": ["vercel.json:2 \"framework\": \"nextjs\"", ".github/workflows/deploy.yml:31 npx netlify deploy --prod"]
    },
    {
      "kind": "frame-near-tie",
      "group": "Daily cutoff",
      "detail": "supabase/functions/cutoff only calls build-bake-list and is fired by a pg_cron entry. It reads equally as its own scheduled job and as part of the bake list builder; the import kept it apart.",
      "evidence": ["supabase/migrations/0004_cron.sql:3 cron.schedule('bake-cutoff', '0 20 * * *', ...)", "supabase/functions/cutoff/index.ts:9 invoke('build-bake-list')"]
    }
  ]$j$::jsonb,
  'dc000000-0000-4000-8000-000000000910',
  $j${"nodes": 11, "edges": 11, "contracts": 8, "containers": 0, "groupsConsidered": 15, "groupsPromoted": 11, "openQuestions": 3, "durationSeconds": 148}$j$::jsonb,
  '2026-09-19T09:02:00.000Z', '2026-09-19T09:08:00.000Z'
);
INSERT INTO public.repo_index
  (branch_id, path, node_id, blob_sha, role, language, framework, artifact_kind, size, signals, fan_in, fan_out, centrality, indexed_at_sha)
VALUES
  ('dc000000-0000-4000-8000-000000000210', 'supabase/functions/orders-api/index.ts',      'dc000000-0000-4000-8000-00000000a002', 'sha-oa01', 'source', 'typescript', 'deno',   'source', 8420, $j${"exports": ["slots", "checkout", "webhook", "ready"], "note": "reads shop_settings"}$j$::jsonb, 3, 4, 0.88, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'tests/orders/pricing.test.ts',                'dc000000-0000-4000-8000-00000000a002', 'sha-tp01', 'test',   'typescript', 'vitest', 'source', 1980, $j${"testTitles": ["a dozen costs the dozen price, not twelve singles", "sales tax is added once per order", "prices are held in whole cents"]}$j$::jsonb, 0, 1, 0.22, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'config/shop-settings.json',                   'dc000000-0000-4000-8000-00000000a009', 'sha-ss01', 'config', 'json',       NULL,     'config', 410,  $j${"readBy": 5, "keys": ["open", "close", "slot_minutes", "slot_capacity", "cutoff", "margin", "printer_url"]}$j$::jsonb, 5, 0, 0.61, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'supabase/functions/build-bake-list/index.ts', 'dc000000-0000-4000-8000-00000000a007', 'sha-bl01', 'source', 'typescript', 'deno',   'source', 3120, $j${"exports": ["buildBakeList"], "unresolved": true, "note": "posts the list to printer_url"}$j$::jsonb, 1, 2, 0.34, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'supabase/migrations/0001_bakery.sql',         'dc000000-0000-4000-8000-00000000a003', 'sha-db01', 'source', 'sql',        NULL,     'schema', 2650, $j${"entities": ["items", "stock", "orders", "order_lines", "slots", "shop_settings"]}$j$::jsonb, 4, 0, 0.79, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'app/checkout/page.tsx',                       'dc000000-0000-4000-8000-00000000a000', 'sha-ck01', 'source', 'tsx',        'nextjs', 'source', 4310, $j${"calls": ["POST /orders"], "reads": ["shop_settings"]}$j$::jsonb, 1, 2, 0.41, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'kitchen/src/__tests__/App.test.tsx',          'dc000000-0000-4000-8000-00000000a001', 'sha-ka01', 'test',   'tsx',        'vitest', 'source', 240,  $j${"testTitles": ["renders without crashing", "renders without crashing"]}$j$::jsonb, 0, 1, 0.04, '1d4b9e0'),
  ('dc000000-0000-4000-8000-000000000210', 'tests/photos/upload.test.ts',                 'dc000000-0000-4000-8000-00000000a00a', 'sha-ph01', 'test',   'typescript', 'vitest', 'source', 260,  $j${"testTitles": ["uploads a file", "uploads a file"]}$j$::jsonb, 0, 1, 0.03, '1d4b9e0');
INSERT INTO public.requirement_candidates
  (id, project_id, branch_id, workflow_id, node_id, key, kind, name, description, category, criteria, evidence, status, requirement_row_id, decided_at)
VALUES
  ('dc000000-0000-4000-8000-0000000005a1', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', NULL, 'dc000000-0000-4000-8000-00000000a002', 'api:orders-api:routes', 'api', 'Orders API routes',
   'Orders API exposes POST /orders, GET /orders/:id and POST /orders/:id/ready, declared in supabase/functions/orders-api/index.ts and called by the storefront and the kitchen display.', 'technical',
   $j$[{"id":"bf01c1","text":"POST /orders returns the order id and its pickup slot","verification":"automated"},{"id":"bf01c2","text":"POST /orders/:id/ready refuses an order that is not paid","verification":"automated"}]$j$::jsonb,
   '{"paths": ["supabase/functions/orders-api/index.ts"], "exports": ["slots", "checkout", "webhook", "ready"], "readBy": 2}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-0000000005a2', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', NULL, 'dc000000-0000-4000-8000-00000000a003', 'data:bakery-database', 'data', 'Bakery database data model',
   'Bakery database owns 1 schema file. Entities named by the file: items, stock, orders, order_lines, slots, shop_settings.', 'technical',
   $j$[{"id":"bf02c1","text":"An order persists its items, slot and phone number and reads them back intact","verification":"automated"},{"id":"bf02c2","text":"A stock row persists its item and count and reads them back intact","verification":"automated"},{"id":"bf02c3","text":"A slot row persists its start time and capacity","verification":"automated"}]$j$::jsonb,
   '{"paths": ["supabase/migrations/0001_bakery.sql"], "entities": ["items", "stock", "orders", "order_lines", "slots", "shop_settings"]}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-0000000005a3', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', NULL, 'dc000000-0000-4000-8000-00000000a001', 'behavior:kitchen-display:kitchen/src/__tests__/App.test.tsx', 'behavior', 'App behaviour',
   'Behaviour Kitchen display already exercises in kitchen/src/__tests__/App.test.tsx (2 test titles): "renders without crashing", "renders without crashing".', 'functional',
   $j$[{"id":"bf03c1","text":"renders without crashing","verification":"automated"}]$j$::jsonb,
   '{"paths": ["kitchen/src/__tests__/App.test.tsx"], "testTitles": ["renders without crashing", "renders without crashing"]}'::jsonb, 'pending', NULL, NULL),
  ('dc000000-0000-4000-8000-0000000005a4', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', NULL, 'dc000000-0000-4000-8000-00000000a002', 'behavior:orders-api:tests/orders/pricing.test.ts', 'behavior', 'Pricing behaviour',
   'Behaviour Orders API already exercises in tests/orders/pricing.test.ts (3 test titles).', 'technical',
   $j$[{"id":"bf04c1","text":"a dozen costs the dozen price, not twelve singles","verification":"automated"},{"id":"bf04c2","text":"sales tax is added once per order","verification":"automated"},{"id":"bf04c3","text":"prices are held in whole cents","verification":"automated"}]$j$::jsonb,
   '{"paths": ["tests/orders/pricing.test.ts"], "testTitles": ["a dozen costs the dozen price, not twelve singles", "sales tax is added once per order", "prices are held in whole cents"]}'::jsonb, 'accepted', 'dc000000-0000-4000-8000-00000000025a', '2026-09-19T10:02:00.000Z'),
  ('dc000000-0000-4000-8000-0000000005a5', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210', NULL, 'dc000000-0000-4000-8000-00000000a00a', 'behavior:product-photos:tests/photos/upload.test.ts', 'behavior', 'Product photos behaviour',
   'Behaviour Product photos already exercises in tests/photos/upload.test.ts (2 test titles): "uploads a file", "uploads a file".', 'functional',
   $j$[{"id":"bf05c1","text":"uploads a file","verification":"automated"}]$j$::jsonb,
   '{"paths": ["tests/photos/upload.test.ts"], "testTitles": ["uploads a file", "uploads a file"], "dismissReason": "A smoke test, not a behaviour. The photo bucket has no requirement to carry."}'::jsonb, 'dismissed', NULL, '2026-09-19T10:04:00.000Z');
CREATE OR REPLACE FUNCTION pg_temp.plan_source_hash(p_project uuid)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE ids text;
BEGIN
  SELECT string_agg(id, E'\n' ORDER BY id COLLATE "C") INTO ids
  FROM (
    SELECT 'task:' || t.node_id::text || ':' || t.task_key AS id
      FROM public.task_items t WHERE t.project_id = p_project
    UNION ALL
    SELECT 'test:' || tc.requirement_id::text || ':' || tc.test_id
      FROM public.test_cases tc
      JOIN public.specification_requirements r ON r.id = tc.requirement_id
      JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = p_project
     WHERE tc.retired_at IS NULL
  ) x;
  RETURN pg_temp.task_anchor_key(ids) || pg_temp.task_anchor_key(reverse(ids));
END
$fn$;
INSERT INTO public.work_plans (id, project_id, branch_id, version, status, generated_by, source_hash, summary, proposed_by, created_by, created_at, updated_at)
VALUES (
  'dc000000-0000-4000-8000-000000000b01',
  'dc000000-0000-4000-8000-000000000200',
  'dc000000-0000-4000-8000-000000000210',
  1, 'proposed', 'ai',
  pg_temp.plan_source_hash('dc000000-0000-4000-8000-000000000200'),
  'The tables and the settings first, then the API, the storefront and the kitchen in the order they call each other, the texts after the kitchen, the bake list and its cutoff last. The Orders API cycle: give the last place first, then write the capacity change against it.',
  'oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1', NULL,
  '2026-09-27T10:20:00.000Z', '2026-09-27T10:20:00.000Z'
);
INSERT INTO public.work_plan_items
  (id, plan_id, item_kind, node_id, item_key, rank, layer, effort, earliest_start, slack, on_critical_path, rationale, status_snapshot)
WITH node_order(node_id, ord, on_route, why) AS (VALUES
  ('dc000000-0000-4000-8000-00000000a003', 0,  true,  'The tables come first: every other node reads or writes them.'),
  ('dc000000-0000-4000-8000-00000000a009', 1,  false, 'Hours, capacity and the margin are read by the API and the bake list, so they exist before either.'),
  ('dc000000-0000-4000-8000-00000000a008', 2,  false, 'Sign-in is provisioned, not built; the account page needs it before reorder can be proven.'),
  ('dc000000-0000-4000-8000-00000000a002', 3,  true,  'The API gives out places and takes payment; the storefront and the kitchen display both call it.'),
  ('dc000000-0000-4000-8000-00000000a000', 4,  true,  'The storefront calls the API, so it follows it; REQ-001 is proven here, end to end.'),
  ('dc000000-0000-4000-8000-00000000a001', 5,  true,  'The kitchen display reads the queue the API serves.'),
  ('dc000000-0000-4000-8000-00000000a005', 6,  true,  'A text is sent when the kitchen marks an order ready, so the texts follow the display.'),
  ('dc000000-0000-4000-8000-00000000a007', 7,  false, 'The bake list reads the paid orders and the margin; it needs both in place.'),
  ('dc000000-0000-4000-8000-00000000a006', 8,  false, 'The cutoff calls the bake list build, so it is set once the build exists.'),
  ('dc000000-0000-4000-8000-00000000a00a', 9,  false, 'The photo bucket is suggested, not decided; it waits at the end.')
),
tasks AS (
  SELECT t.node_id, t.task_key AS item_key, n.ord, 0 AS phase,
         (regexp_replace(t.display_id, '\D', '', 'g'))::int AS seq, 1.0::numeric AS effort, n.on_route, n.why
  FROM public.task_items t
  JOIN node_order n ON n.node_id = t.node_id::text
  WHERE t.project_id = 'dc000000-0000-4000-8000-000000000200'
),
tests AS (
  SELECT (SELECT n2.node_id FROM public.specification_mappings m2 JOIN node_order n2 ON n2.node_id = m2.node_id::text
           WHERE m2.requirement_id = r.id ORDER BY n2.ord DESC LIMIT 1)::uuid AS node_id,
         tc.test_id AS item_key,
         (SELECT max(n3.ord) FROM public.specification_mappings m3 JOIN node_order n3 ON n3.node_id = m3.node_id::text
           WHERE m3.requirement_id = r.id) AS ord,
         1 AS phase, (regexp_replace(tc.test_id, '\D', '', 'g'))::int AS seq, 0.5::numeric AS effort, false AS on_route,
         'A test runs after all the work it proves; ' || r.requirement_id || ' is proven on the last node it maps to.' AS why
  FROM public.test_cases tc
  JOIN public.specification_requirements r ON r.id = tc.requirement_id
  JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = 'dc000000-0000-4000-8000-000000000200'
  WHERE tc.retired_at IS NULL
),
ordered AS (
  SELECT 'task' AS item_kind, node_id, item_key, ord, phase, seq, effort, on_route, why FROM tasks
  UNION ALL
  SELECT 'test', node_id, item_key, ord, phase, seq, effort, on_route, why FROM tests
),
ranked AS (
  SELECT *,
         row_number() OVER (ORDER BY ord, phase, seq, item_key) - 1 AS rank,
         COALESCE(sum(effort) OVER (ORDER BY ord, phase, seq, item_key ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS earliest_start
  FROM ordered
)
SELECT gen_random_uuid(), 'dc000000-0000-4000-8000-000000000b01', item_kind, node_id, item_key, rank, ord, effort, earliest_start,
       CASE WHEN on_route THEN 0 ELSE 1 END, on_route, why, 'open'
FROM ranked;
INSERT INTO public.work_plan_edges (id, plan_id, from_item, to_item, coupling, reason, evidence, decision)
SELECT gen_random_uuid(), 'dc000000-0000-4000-8000-000000000b01', a.id, b.id, 'tight',
       'Circular by design: the last-place transaction reads the capacity a change may lower, and a capacity change has to know which places that transaction already gave.',
       '{"rule": "coupling", "couplingId": "dc000000-0000-4000-8000-000000000805"}'::jsonb,
       'Give the last place first. A capacity change applies only to places not yet given, so it is written against the transaction: T6 precedes T8.'
FROM public.work_plan_items a, public.work_plan_items b
WHERE a.plan_id = 'dc000000-0000-4000-8000-000000000b01' AND b.plan_id = a.plan_id
  AND a.item_kind = 'task' AND b.item_kind = 'task'
  AND a.item_key = (SELECT task_key FROM public.task_items WHERE id = 'dc000000-0000-4000-8000-00000000071b')
  AND b.item_key = (SELECT task_key FROM public.task_items WHERE id = 'dc000000-0000-4000-8000-00000000071d');
INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status, started_at, completed_at, metadata)
SELECT v.id::uuid, 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210',
       v.model, v.prompt_hash, 'completed', v.at::timestamptz, v.at::timestamptz, v.meta::jsonb
FROM (VALUES
  ('dc000000-0000-4000-8000-000000000900', 'repo-import',       'repo-import',      '2026-09-19T09:08:00.000Z', '{"source": "repo-import", "patchCount": 1}'),
  ('dc000000-0000-4000-8000-000000000901', 'bakery-site-agent', 'mcp-proposal',     '2026-09-27T09:41:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000902', 'bakery-site-agent', 'mcp-proposal',     '2026-09-27T09:43:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000903', 'bakery-site-agent', 'mcp-proposal',     '2026-09-27T10:05:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000904', 'bakery-site-agent', 'mcp-auto-applied', '2026-09-26T16:22:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000905', 'bakery-site-agent', 'mcp-proposal',     '2026-09-25T11:14:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000906', 'bakery-site-agent', 'mcp-proposal',     '2026-09-22T10:31:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000908', 'bakery-site-agent', 'mcp-proposal',     '2026-09-28T08:55:00.000Z', '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null}'),
  ('dc000000-0000-4000-8000-000000000909', 'task-generator',    'mcp-task-docs',    '2026-09-20T09:30:00.000Z', '{"source": "mcp-task-docs", "requestedBy": "bakery-site-agent", "patchCount": 10, "authMethod": "oauth_token", "apiKeyId": null, "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code"}')
) AS v(id, model, prompt_hash, at, meta);
INSERT INTO public.ai_runs (id, project_id, branch_id, model, prompt_hash, status, started_at, completed_at, metadata)
VALUES ('dc000000-0000-4000-8000-000000000907', 'dc000000-0000-4000-8000-000000000200', 'dc000000-0000-4000-8000-000000000210',
        'rosa.delgado@harborlanebakery.example', 'mcp-proposal', 'completed', '2026-09-27T11:02:00.000Z', '2026-09-27T11:02:00.000Z',
        '{"source": "mcp-server", "externalAgent": "rosa.delgado@harborlanebakery.example", "credential": null, "credentialLabel": "rosa.delgado@harborlanebakery.example", "authMethod": "jwt", "apiKeyId": null}'::jsonb);
INSERT INTO public.ai_proposals (id, ai_run_id, source_branch_id, proposal_branch_id, status, patches, validation_expectations, created_at, reviewed_at, merged_at, metadata) VALUES
  ('dc000000-0000-4000-8000-000000000910', 'dc000000-0000-4000-8000-000000000900',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'merged',
   $j$[{"patch": {"type": "add_node", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a0", "actorType": "ai", "actorId": "repo-import", "summary": "Add Storefront (frontend-app, nextjs)", "timestamp": "2026-09-19T09:08:00.000Z"}, "payload": {"id": "dc000000-0000-4000-8000-00000000a000", "label": "Storefront", "type": "frontend-app", "technology": "nextjs"}}, "explanation": "Add Storefront (frontend-app, nextjs)", "status": "accepted"}]$j$::jsonb,
   '{}', '2026-09-19T09:08:00.000Z', '2026-09-19T09:14:00.000Z', '2026-09-19T09:14:00.000Z',
   '{"source": "repo-import", "jobId": "dc000000-0000-4000-8000-000000000a01", "headSha": "1d4b9e0", "binding": "repo-index", "fileCount": 286, "summary": "11 nodes, 11 edges and 8 contracts from github.com/harbor-lane/bakery-site at 1d4b9e0: the storefront on Next.js, the kitchen display on React, the Orders API and the bake list builder as edge functions, the database, Stripe, Twilio, sign-in, the settings and the photo bucket. Three questions were left for a person rather than guessed: what answers the printer URL the settings hold, which host the storefront deploys to, and whether the daily cutoff is its own job.", "finalization": "ai-approved", "finalizationRevisions": [], "authMethod": "oauth_token", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code"}'::jsonb),
  ('dc000000-0000-4000-8000-000000000911', 'dc000000-0000-4000-8000-000000000901',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'pending',
   $j$[{"patch": {"type": "update_requirement", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a1", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Record how a declined card is retried", "timestamp": "2026-09-27T09:41:00.000Z"}, "payload": {"requirementId": "REQ-005", "changes": {"description": "Checkout creates one Stripe PaymentIntent per order with the order id as its idempotency key. A retried request, a double tap or a webhook delivered twice never charges twice. After a declined card the customer retries on the same PaymentIntent with another card; that is a new attempt, not a new charge."}}}, "explanation": "Card processor review, finding 2: a declined card is retried with a different card. Stripe confirms the same PaymentIntent with the new payment method, so the key stays the order id and nothing is charged twice.", "status": "pending"}]$j$::jsonb,
   '{}', '2026-09-27T09:41:00.000Z', NULL, NULL,
   '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null, "proposedByUserId": "b0000000-0000-4000-8000-000000000001", "normalizations": []}'::jsonb),
  ('dc000000-0000-4000-8000-000000000912', 'dc000000-0000-4000-8000-000000000902',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'pending',
   $j$[{"patch": {"type": "create_candidate", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a2", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Draft the text outbox outcome", "timestamp": "2026-09-27T09:43:00.000Z"}, "payload": {"branchId": "dc000000-0000-4000-8000-000000000210", "key": "outcome:hl-12", "name": "Ready texts go through one outbox", "description": "A provider retry sent a customer two texts. Each send writes an outbox row keyed by the order first, so a retry finds the row and stops.", "category": "functional", "criteria": [{"id": "o12c1", "text": "Each order has at most one ready text in the outbox", "verification": "automated"}, {"id": "o12c2", "text": "A failed send is retried from the outbox, not from the kitchen display", "verification": "automated"}]}}, "explanation": "TC-019 failed: a provider retry sent a second text. Filing the outbox as its own outcome rather than widening REQ-008 on my own.", "status": "pending"}]$j$::jsonb,
   '{}', '2026-09-27T09:43:00.000Z', NULL, NULL,
   '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null, "proposedByUserId": "b0000000-0000-4000-8000-000000000001", "normalizations": []}'::jsonb),
  ('dc000000-0000-4000-8000-000000000913', 'dc000000-0000-4000-8000-000000000903',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'pending',
   $j$[{"patch": {"type": "promote_candidate", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a3", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Derive the allergen-notes requirement", "timestamp": "2026-09-27T10:05:00.000Z"}, "payload": {"candidateId": "dc000000-0000-4000-8000-000000000505", "section": "Kitchen", "criteriaIds": ["o05c1", "o05c2"], "name": "Allergen notes reach the packer", "description": "Every order's allergen notes print on its bag label and flag the order on the kitchen display, so no note is lost between checkout and handover."}}, "explanation": "Both criteria on this outcome are unclaimed and testable as written. Promotion is yours to make.", "status": "pending"}]$j$::jsonb,
   '{}', '2026-09-27T10:05:00.000Z', NULL, NULL,
   '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null, "proposedByUserId": "b0000000-0000-4000-8000-000000000001", "normalizations": []}'::jsonb),
  ('dc000000-0000-4000-8000-000000000914', 'dc000000-0000-4000-8000-000000000904',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'merged',
   $j$[{"patch": {"type": "update_requirement", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a4", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Update requirement REQ-004", "timestamp": "2026-09-26T16:22:00.000Z"}, "payload": {"requirementId": "REQ-004", "changes": {"description": "The tablet by the pickup shelf lists paid orders by pickup slot, earliest first, with each order''s items and notes, and a packer marks an order ready with one tap."}}}, "explanation": "Update requirement REQ-004", "status": "accepted"}]$j$::jsonb,
   '{}', '2026-09-26T16:22:00.000Z', '2026-09-26T16:22:00.000Z', '2026-09-26T16:22:00.000Z',
   '{"source": "mcp-server", "plane": "spec", "auto": true, "externalAgent": "bakery-site-agent", "authMethod": "oauth_token", "apiKeyId": null, "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code"}'::jsonb),
  ('dc000000-0000-4000-8000-000000000915', 'dc000000-0000-4000-8000-000000000905',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'rejected',
   $j$[{"patch": {"type": "delete_requirement", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a5", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Drop the opening-hours requirement", "timestamp": "2026-09-25T11:14:00.000Z"}, "payload": {"requirementId": "REQ-009"}}, "explanation": "The opening hours are already in the storefront's config file, so this requirement looks redundant.", "status": "rejected"}]$j$::jsonb,
   '{}', '2026-09-25T11:14:00.000Z', '2026-09-25T11:40:00.000Z', NULL,
   '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null, "proposedByUserId": "b0000000-0000-4000-8000-000000000001", "normalizations": [], "resolvedBy": "app", "resolveNote": "Hours copied into the storefront are the problem. REQ-009 is what moves them to one place."}'::jsonb),
  ('dc000000-0000-4000-8000-000000000916', 'dc000000-0000-4000-8000-000000000906',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'merged',
   $j$[{"patch": {"type": "upsert_workflow_step", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a6", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Add the waste count step", "timestamp": "2026-09-22T10:31:00.000Z"}, "payload": {"workflowId": "dc000000-0000-4000-8000-000000000402", "name": "Count the day's waste", "sortOrder": 5}}, "explanation": "Waste is counted per item at close, so the walk-in margin can be tuned from real numbers.", "status": "accepted"}]$j$::jsonb,
   '{}', '2026-09-22T10:31:00.000Z', '2026-09-22T10:52:00.000Z', '2026-09-22T10:52:00.000Z',
   '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null, "proposedByUserId": "b0000000-0000-4000-8000-000000000001", "normalizations": [], "resolvedBy": "app", "resolveNote": null}'::jsonb),
  ('dc000000-0000-4000-8000-000000000917', 'dc000000-0000-4000-8000-000000000907',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'pending',
   $j$[{"patch": {"type": "upsert_workflow_step", "metadata": {"id": "dc000000-0000-4000-8000-0000000009a7", "actorType": "human", "actorId": "rosa.delgado@harborlanebakery.example", "summary": "Add an allergen check at handover", "timestamp": "2026-09-27T11:02:00.000Z"}, "payload": {"workflowId": "dc000000-0000-4000-8000-000000000401", "name": "Check allergens at handover", "sortOrder": 7}}, "explanation": "Every bag is checked against its allergen notes before it is handed over.", "status": "pending"}]$j$::jsonb,
   '{}', '2026-09-27T11:02:00.000Z', NULL, NULL,
   '{"source": "mcp-server", "externalAgent": "rosa.delgado@harborlanebakery.example", "credential": null, "credentialLabel": "rosa.delgado@harborlanebakery.example", "authMethod": "jwt", "apiKeyId": null, "normalizations": []}'::jsonb),
  ('dc000000-0000-4000-8000-000000000918', 'dc000000-0000-4000-8000-000000000908',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'pending',
   $j$[
     {"patch": {"type": "add_node", "metadata": {"id": "dc000000-0000-4000-8000-0000000009b1", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Add Kitchen printer (external-service)", "timestamp": "2026-09-28T08:55:00.000Z"}, "payload": {"id": "dc000000-0000-4000-8000-00000000a00b", "label": "Kitchen printer", "type": "external-service"}}, "explanation": "The bake list is posted to a printer on the shop network; printer_url in the shop settings names it.", "status": "pending"},
     {"patch": {"type": "add_contract", "metadata": {"id": "dc000000-0000-4000-8000-0000000009b2", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Add contract Print job (rest)", "timestamp": "2026-09-28T08:55:00.000Z"}, "payload": {"id": "dc000000-0000-4000-8000-00000000c00b", "kind": "rest", "name": "Print job"}}, "explanation": "One POST per list: the day, then a line per item and count.", "status": "pending"},
     {"patch": {"type": "add_edge", "metadata": {"id": "dc000000-0000-4000-8000-0000000009b3", "actorType": "ai", "actorId": "bakery-site-agent", "summary": "Connect Bake list builder to Kitchen printer", "timestamp": "2026-09-28T08:55:00.000Z"}, "payload": {"id": "dc000000-0000-4000-8000-00000000e00b", "source": "dc000000-0000-4000-8000-00000000a007", "target": "dc000000-0000-4000-8000-00000000a00b", "contractId": "dc000000-0000-4000-8000-00000000c00b", "label": "print the bake list"}}, "explanation": "build-bake-list/index.ts:52 posts to it.", "status": "pending"}
   ]$j$::jsonb,
   '{}', '2026-09-28T08:55:00.000Z', NULL, NULL,
   '{"source": "mcp-server", "externalAgent": "bakery-site-agent", "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code", "authMethod": "oauth_token", "apiKeyId": null, "proposedByUserId": "b0000000-0000-4000-8000-000000000001", "normalizations": [], "intents": [{"kind": "add_node", "summary": "add a node \"Kitchen printer\" (external-service)", "ids": {"nodeId": "dc000000-0000-4000-8000-00000000a00b"}, "evidence": [{"path": "config/shop-settings.json", "line": 7, "note": "printer_url"}]}, {"kind": "connect_nodes", "summary": "connect \"Bake list builder\" to \"Kitchen printer\" over a new rest contract \"Print job\"", "ids": {"edgeId": "dc000000-0000-4000-8000-00000000e00b", "contractId": "dc000000-0000-4000-8000-00000000c00b"}, "evidence": [{"path": "supabase/functions/build-bake-list/index.ts", "line": 52, "note": "fetch(settings.printer_url, { method: POST })"}]}]}'::jsonb),
  ('dc000000-0000-4000-8000-000000000919', 'dc000000-0000-4000-8000-000000000909',
   'dc000000-0000-4000-8000-000000000210', 'dc000000-0000-4000-8000-000000000210', 'merged',
   (SELECT jsonb_agg(jsonb_build_object(
      'patch', jsonb_build_object('type', 'add_artifact',
        'metadata', jsonb_build_object('id', gen_random_uuid(), 'actorType', 'ai', 'actorId', 'task-generator', 'summary', 'Add the task document for ' || n.label, 'timestamp', '2026-09-20T09:30:00.000Z'),
        'payload', jsonb_build_object('nodeId', n.id, 'kind', 'task', 'path', '.nodespec/tasks/' || n.slug || '.task.md')),
      'explanation', 'Task document for ' || n.label || ', from its mapped requirements and contracts',
      'status', 'accepted') ORDER BY n.ord)
    FROM (VALUES
      (0, 'dc000000-0000-4000-8000-00000000a003', 'Bakery database', 'bakery-database'),
      (1, 'dc000000-0000-4000-8000-00000000a009', 'Shop settings', 'shop-settings'),
      (2, 'dc000000-0000-4000-8000-00000000a008', 'Customer accounts', 'customer-accounts'),
      (3, 'dc000000-0000-4000-8000-00000000a002', 'Orders API', 'orders-api'),
      (4, 'dc000000-0000-4000-8000-00000000a000', 'Storefront', 'storefront'),
      (5, 'dc000000-0000-4000-8000-00000000a001', 'Kitchen display', 'kitchen-display'),
      (6, 'dc000000-0000-4000-8000-00000000a005', 'Pickup texts', 'pickup-texts'),
      (7, 'dc000000-0000-4000-8000-00000000a007', 'Bake list builder', 'bake-list-builder'),
      (8, 'dc000000-0000-4000-8000-00000000a006', 'Daily cutoff', 'daily-cutoff'),
      (9, 'dc000000-0000-4000-8000-00000000a00a', 'Product photos', 'product-photos')
    ) AS n(ord, id, label, slug)),
   '{}', '2026-09-20T09:30:00.000Z', '2026-09-20T09:41:00.000Z', '2026-09-20T09:41:00.000Z',
   '{"source": "mcp-task-docs", "requestedBy": "bakery-site-agent", "authMethod": "oauth_token", "apiKeyId": null, "credential": "oauth:b0000000-0000-4000-8000-000000000001:claude-code.dc000000-0000-4000-8000-0000000000c1", "credentialLabel": "oauth · claude-code"}'::jsonb);
DO $verify$
DECLARE
  p uuid := 'dc000000-0000-4000-8000-000000000200';
  snap uuid := 'dc000000-0000-4000-8000-000000000220';
  bad int;
  n_nodes int; n_reqs int; n_tests int; n_tasks int; n_outcomes int; n_steps int; n_pending int;
  n_imported int; n_questions int; n_plan_items int; n_plan_total int; plan_hash text;
BEGIN
  -- mapped nodes exist in the snapshot
  SELECT count(*) INTO bad
  FROM public.specification_mappings m
  JOIN public.project_specifications sp ON sp.id = m.specification_id AND sp.project_id = p
  WHERE NOT (SELECT graph_data->'nodes' ? m.node_id::text FROM public.graph_snapshots WHERE id = snap);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % mapping(s) point at a node that is not in the snapshot', bad; END IF;

  -- task rows sit on nodes that exist
  SELECT count(*) INTO bad
  FROM public.task_items t
  WHERE t.project_id = p
    AND NOT (SELECT graph_data->'nodes' ? t.node_id::text FROM public.graph_snapshots WHERE id = snap);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % task item(s) point at a node that is not in the snapshot', bad; END IF;

  -- every criterion testId resolves to a test case on the SAME requirement
  SELECT count(*) INTO bad
  FROM public.specification_requirements r
  JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = p
  CROSS JOIN LATERAL jsonb_array_elements(r.acceptance_criteria) c
  WHERE c->>'testId' IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.test_cases tc WHERE tc.id = (c->>'testId')::uuid AND tc.requirement_id = r.id);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % criterion testId(s) do not resolve to a test on that requirement', bad; END IF;

  -- every non-orphaned task row is a task line in its node's doc, written the
  -- way task-deltas.ts TASK_LINE reads it: "**Tn <em dash> title** <!-- t:key -->"
  SELECT count(*) INTO bad
  FROM public.task_items t
  WHERE t.project_id = p AND NOT t.orphaned
    AND NOT EXISTS (
      SELECT 1
      FROM public.graph_snapshots s, jsonb_each(s.graph_data->'artifacts') a
      WHERE s.id = snap AND a.value->>'kind' = 'task'
        AND (a.value->>'nodeId')::uuid = t.node_id
        AND position('] **' || t.display_id || ' ' || chr(8212) || ' ' || t.title || '** <!-- t:' || t.task_key || ' -->' || E'\n'
                     in a.value->>'content') > 0);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % task row(s) have no task line in their node task doc', bad; END IF;

  -- and every anchor in every task doc has a row
  SELECT count(*) INTO bad
  FROM public.graph_snapshots s, jsonb_each(s.graph_data->'artifacts') a,
       regexp_matches(a.value->>'content', '<!-- t:([a-f0-9]{8}(?:-[0-9]+)?) -->', 'g') k
  WHERE s.id = snap AND a.value->>'kind' = 'task'
    AND NOT EXISTS (SELECT 1 FROM public.task_items t
                    WHERE t.project_id = p AND t.node_id = (a.value->>'nodeId')::uuid AND t.task_key = k[1]);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % doc anchor(s) have no task row', bad; END IF;

  -- the one out-of-band tick: done in the row, open in the doc
  IF (SELECT count(*) FROM public.task_items t, public.graph_snapshots s, jsonb_each(s.graph_data->'artifacts') a
       WHERE t.project_id = p AND t.done AND s.id = snap AND a.value->>'kind' = 'task' AND (a.value->>'nodeId')::uuid = t.node_id
         AND position('- [ ] **' || t.display_id || ' ' || chr(8212) || ' ' || t.title || '**' in a.value->>'content') > 0) <> 1 THEN
    RAISE EXCEPTION 'seed: expected exactly one task ticked out of band';
  END IF;

  -- every derivation's claimed criteria exist on the outcome it derives from
  SELECT count(*) INTO bad
  FROM public.outcome_derivations d
  CROSS JOIN LATERAL jsonb_array_elements_text(d.criteria_slice) cid
  JOIN public.requirement_candidates rc ON rc.id = d.candidate_id
  WHERE d.project_id = p
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rc.criteria) c WHERE c->>'id' = cid);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % derivation(s) claim a criterion the outcome does not have', bad; END IF;

  SELECT count(*) INTO n_nodes FROM public.graph_snapshots s, jsonb_object_keys(s.graph_data->'nodes') WHERE s.id = snap;
  SELECT count(*) INTO n_reqs     FROM public.specification_requirements r JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = p;
  SELECT count(*) INTO n_tests    FROM public.test_cases tc JOIN public.specification_requirements r ON r.id = tc.requirement_id JOIN public.project_specifications sp ON sp.id = r.specification_id AND sp.project_id = p;
  SELECT count(*) INTO n_tasks    FROM public.task_items WHERE project_id = p;
  -- every outcome has a home lane in this project
  SELECT count(*) INTO bad FROM public.requirement_candidates c
   WHERE c.project_id = p AND (c.workflow_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = c.workflow_id AND w.project_id = p))
     AND c.kind = 'outcome';
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % outcome(s) without a home lane', bad; END IF;
  -- one imported lane, every import candidate in it, no outcome in it
  SELECT count(*) INTO bad FROM public.workflows WHERE project_id = p AND kind = 'imported';
  IF bad <> 1 THEN RAISE EXCEPTION 'seed: expected one imported lane, found %', bad; END IF;
  SELECT count(*) INTO bad FROM public.requirement_candidates c JOIN public.workflows w ON w.id = c.workflow_id
   WHERE c.project_id = p AND ((c.kind <> 'outcome' AND w.kind <> 'imported') OR (c.kind = 'outcome' AND w.kind = 'imported'));
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % candidate(s) homed in a lane of the wrong kind', bad; END IF;
  SELECT count(*) INTO bad FROM public.workflows WHERE project_id = p AND kind = 'workflow';
  IF bad <> 2 THEN RAISE EXCEPTION 'seed: expected the two workflows, found %', bad; END IF;
  SELECT count(*) INTO n_outcomes FROM public.requirement_candidates WHERE project_id = p AND kind = 'outcome';
  SELECT count(*) INTO n_imported FROM public.requirement_candidates WHERE project_id = p AND kind <> 'outcome' AND status = 'pending';
  SELECT jsonb_array_length(open_questions) INTO n_questions FROM public.import_jobs WHERE project_id = p;

  -- the proposed plan carries every task and every test exactly once
  SELECT count(*) INTO n_plan_items FROM public.work_plan_items WHERE plan_id = 'dc000000-0000-4000-8000-000000000b01';
  n_plan_total := n_tasks + n_tests;
  IF n_plan_items <> n_plan_total THEN RAISE EXCEPTION 'seed: the proposed plan holds % items for % tasks and tests', n_plan_items, n_plan_total; END IF;
  SELECT count(*) INTO bad FROM (SELECT item_kind, COALESCE(node_id::text, ''), item_key FROM public.work_plan_items WHERE plan_id = 'dc000000-0000-4000-8000-000000000b01' GROUP BY 1, 2, 3 HAVING count(*) > 1) d;
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % plan item(s) appear twice', bad; END IF;
  SELECT count(*) INTO bad FROM public.work_plan_edges WHERE plan_id = 'dc000000-0000-4000-8000-000000000b01' AND decision IS NOT NULL;
  IF bad <> 1 THEN RAISE EXCEPTION 'seed: the Orders API cycle needs exactly one decision, found %', bad; END IF;
  SELECT source_hash INTO plan_hash FROM public.work_plans WHERE id = 'dc000000-0000-4000-8000-000000000b01';
  IF plan_hash !~ '^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'seed: the plan source hash is not 16 hex characters: %', plan_hash; END IF;

  -- the locked requirement is locked, and its mapping made it in first
  IF NOT EXISTS (SELECT 1 FROM public.specification_requirements WHERE id = 'dc000000-0000-4000-8000-000000000255' AND locked) THEN
    RAISE EXCEPTION 'seed: REQ-005 is not locked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.specification_mappings WHERE requirement_id = 'dc000000-0000-4000-8000-000000000255') THEN
    RAISE EXCEPTION 'seed: REQ-005 has no mapping';
  END IF;

  -- every open question that names a node names one in the snapshot
  SELECT count(*) INTO bad
  FROM public.import_jobs j, jsonb_array_elements(j.open_questions) q
  WHERE j.project_id = p AND q ? 'nodeId'
    AND NOT (SELECT graph_data->'nodes' ? (q->>'nodeId') FROM public.graph_snapshots WHERE id = snap);
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % open question(s) name a node that is not in the snapshot', bad; END IF;
  SELECT count(*) INTO n_steps    FROM public.workflow_steps ws JOIN public.workflows w ON w.id = ws.workflow_id AND w.project_id = p;
  SELECT count(*) INTO n_pending  FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p WHERE ap.status = 'pending';

  -- Team mode: the example marker, its roster, the named owners and the teammate's proposal
  IF (SELECT metadata->>'example' FROM public.projects WHERE id = p) IS DISTINCT FROM 'harbor-lane-bakery'
     OR jsonb_array_length((SELECT metadata->'exampleTeam' FROM public.projects WHERE id = p)) <> 3 THEN
    RAISE EXCEPTION 'seed: the example marker or its roster is missing';
  END IF;
  IF (SELECT count(*) FROM public.workflows WHERE project_id = p AND owner_label IN ('Sam Okafor', 'Rosa Delgado')) <> 2 THEN
    RAISE EXCEPTION 'seed: the two workflows are not owned by name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_proposals WHERE id = 'dc000000-0000-4000-8000-000000000917' AND status = 'pending'
                 AND metadata->>'authMethod' = 'jwt' AND metadata->>'externalAgent' = 'rosa.delgado@harborlanebakery.example') THEN
    RAISE EXCEPTION 'seed: the teammate''s proposal is missing';
  END IF;

  -- every proposal says who or what filed it, as its writer stamps it (AL.2)
  SELECT count(*) INTO bad
  FROM public.ai_proposals ap JOIN public.branches b ON b.id = ap.source_branch_id AND b.project_id = p
  WHERE NOT (ap.metadata->>'source' = 'repo-import' OR coalesce(ap.metadata->>'credentialLabel', '') <> '');
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % proposal(s) name nobody', bad; END IF;
  -- nothing the product never writes: no mapping to review, no flagged candidate, only the import's question kinds
  IF EXISTS (SELECT 1 FROM public.specification_mappings m JOIN public.project_specifications sp ON sp.id = m.specification_id AND sp.project_id = p WHERE m.validation_status = 'needs-review') THEN
    RAISE EXCEPTION 'seed: a mapping is marked needs-review, which nothing in the product writes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.requirement_candidates WHERE project_id = p AND evidence ? 'reviewNote') THEN
    RAISE EXCEPTION 'seed: a candidate carries a reviewNote, which nothing in the product writes';
  END IF;
  SELECT count(*) INTO bad FROM public.import_jobs j, jsonb_array_elements(j.open_questions) q
   WHERE j.project_id = p AND NOT (q->>'kind' = ANY (ARRAY['frame-near-tie','unknown-technology','low-confidence-group','dependency-cycle','deployment-mismatch','backing-service','deploy-step','group-not-analyzed','tree-truncated']) AND q ? 'group' AND q ? 'detail');
  IF bad > 0 THEN RAISE EXCEPTION 'seed: % open question(s) are not in the shape the import writes', bad; END IF;

  RAISE NOTICE 'Harbor Lane Bakery seeded: % nodes, % requirements, % tests, % tasks, % outcomes, % steps, % proposals waiting (one from a teammate), % imported candidates and % open questions from the repository, one proposed plan over % items (source hash %)',
    n_nodes, n_reqs, n_tests, n_tasks, n_outcomes, n_steps, n_pending, n_imported, n_questions, n_plan_items, plan_hash;
END
$verify$;
$example_sql$::text
$_X$;


ALTER FUNCTION "public"."example_project_sql"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."example_project_sql"() IS 'Returns SQL as text: the example project''s seed, run by ensure_example_project(). Its quoted prose is data, not relations it reads; the tables it names are proven by running it (db-lanes 106, 107 and 109).';



CREATE OR REPLACE FUNCTION "public"."explode_rebind_on_proposal_accept"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- acceptProposal writes 'merged' (or 'partial'); anything else is not an accept.
  IF NEW.status NOT IN ('merged', 'partial') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata -> 'repoIndexMoves') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  UPDATE public.repo_index r
     SET node_id = m."to", updated_at = now()
    FROM jsonb_to_recordset(NEW.metadata -> 'repoIndexMoves') AS m(path text, "from" text, "to" text)
   WHERE r.branch_id = COALESCE(NEW.proposal_branch_id, NEW.source_branch_id)
     AND r.path = m.path
     AND r.node_id = m."from"
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(COALESCE(NEW.patches, '[]'::jsonb)) e
        WHERE COALESCE(e ->> 'status', 'pending') = 'rejected'
          AND ((e -> 'patch' ->> 'type' = 'add_node' AND e -> 'patch' -> 'payload' ->> 'id' = m."to")
            OR (e -> 'patch' ->> 'type' = 'remove_node' AND e -> 'patch' -> 'payload' ->> 'id' = m."from"))
     );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."explode_rebind_on_proposal_accept"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."explode_rebind_on_proposal_accept"() IS 'AA.3: on accept, moves repo_index rows to the part (or back to the node) that an explode_node or collapse_node proposal recorded in metadata.repoIndexMoves, skipping moves whose part was rejected.';



CREATE OR REPLACE FUNCTION "public"."force_provision_user"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  _url text;
  _anon_key text;
  _edge_url text;
  _body jsonb;
  _request_id bigint;
  _user_email text;
BEGIN
  -- Check if caller is admin (the token's app_metadata; a person writes their own settings row)
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'unauthorized',
      'message', 'Only admins can force provision users'
    );
  END IF;

  -- Check if user exists
  SELECT email INTO _user_email
  FROM auth.users
  WHERE id = p_user_id;

  IF _user_email IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'message', 'User does not exist'
    );
  END IF;

  -- Check if user already has a customer
  IF EXISTS (
    SELECT 1 FROM public.stripe_customers
    WHERE user_id = p_user_id AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_provisioned',
      'message', 'User already has a Stripe customer'
    );
  END IF;

  -- Get vault secrets
  SELECT decrypted_secret INTO _url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_url'
  LIMIT 1;

  SELECT decrypted_secret INTO _anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_anon_key'
  LIMIT 1;

  IF _url IS NULL OR _anon_key IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'vault_secrets_missing',
      'message', 'Required vault secrets are not configured'
    );
  END IF;

  -- Queue the provisioning request
  _edge_url := _url || '/functions/v1/create-free-customer';
  _body := jsonb_build_object(
    'trigger_source', 'auth_user_insert',
    'user_id', p_user_id::text,
    'user_email', _user_email
  );

  BEGIN
    SELECT INTO _request_id net.http_post(
      url := _edge_url,
      body := _body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _anon_key,
        'apikey', _anon_key
      )
    );

    -- Log the manual provisioning attempt
    INSERT INTO public.subscription_audit_log (user_id, source, action, metadata)
    VALUES (p_user_id, 'admin_force_provision', 'manual_provision_queued', jsonb_build_object(
      'request_id', _request_id,
      'admin_user_id', auth.uid(),
      'user_email', _user_email
    ));

    RETURN jsonb_build_object(
      'success', true,
      'request_id', _request_id,
      'message', 'Provisioning request queued successfully'
    );

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'pgnet_failed',
      'message', SQLERRM,
      'sqlstate', SQLSTATE
    );
  END;
END;
$$;


ALTER FUNCTION "public"."force_provision_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_users"() RETURNS TABLE("id" "uuid", "email" "text", "created_at" timestamp with time zone, "last_sign_in_at" timestamp with time zone, "raw_app_meta_data" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
IF NOT public.is_admin() THEN
RAISE EXCEPTION 'Admin access required';
END IF;

RETURN QUERY
SELECT u.id, u.email::text, u.created_at, u.last_sign_in_at, u.raw_app_meta_data
FROM auth.users u
ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_all_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
SELECT COALESCE(MAX(sequence), 0) + 1
FROM public.graph_patches
WHERE branch_id = p_branch_id;
$$;


ALTER FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") RETURNS TABLE("node_id" "uuid", "mapping_count" bigint, "orphaned_since" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
IF NOT EXISTS (
SELECT 1 FROM public.project_specifications ps
JOIN public.projects p ON p.id = ps.project_id
WHERE ps.id = p_specification_id
AND public.is_project_member(p.id, 'viewer')
) THEN
RAISE EXCEPTION 'Specification not found or access denied';
END IF;

RETURN QUERY
SELECT
sm.node_id,
COUNT(*) as mapping_count,
MIN(sm.last_validated_at) as orphaned_since
FROM public.specification_mappings sm
WHERE sm.specification_id = p_specification_id
AND sm.is_orphan = true
GROUP BY sm.node_id
ORDER BY orphaned_since ASC;
END;
$$;


ALTER FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_provisioning_health"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  _health jsonb;
  _trigger_exists boolean;
  _vault_secrets_ok boolean;
  _recent_successes bigint;
  _recent_failures bigint;
  _orphaned_count bigint;
BEGIN
  -- the provisioning-health function calls with the service role (no user);
  -- a signed-in caller must be an admin
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admins can view provisioning health' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_provision_stripe_customer'
      AND tgrelid = 'auth.users'::regclass
      AND tgenabled = 'O'
  ) INTO _trigger_exists;

  SELECT COUNT(*) = 2
  INTO _vault_secrets_ok
  FROM vault.decrypted_secrets
  WHERE name IN ('supabase_url', 'supabase_anon_key')
    AND decrypted_secret IS NOT NULL;

  SELECT COUNT(*) INTO _recent_successes
  FROM public.subscription_audit_log
  WHERE action = 'provisioning_success'
    AND created_at > now() - interval '1 hour';

  SELECT COUNT(*) INTO _recent_failures
  FROM public.subscription_audit_log
  WHERE action IN ('provisioning_failed', 'trigger_failed')
    AND created_at > now() - interval '1 hour';

  SELECT COUNT(*) INTO _orphaned_count
  FROM auth.users u
  LEFT JOIN public.stripe_customers sc ON u.id = sc.user_id AND sc.deleted_at IS NULL
  WHERE sc.customer_id IS NULL
    AND u.created_at < now() - interval '5 minutes'
    AND u.deleted_at IS NULL;

  _health := jsonb_build_object(
    'healthy', _trigger_exists AND _vault_secrets_ok AND _orphaned_count = 0,
    'trigger_active', _trigger_exists,
    'vault_secrets_configured', _vault_secrets_ok,
    'recent_successes_1h', _recent_successes,
    'recent_failures_1h', _recent_failures,
    'orphaned_users', _orphaned_count,
    'checked_at', now()
  );
  RETURN _health;
END;
$$;


ALTER FUNCTION "public"."get_provisioning_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") RETURNS TABLE("requirement_id" "uuid", "requirement_name" "text", "requirement_description" "text", "category" "text", "section_name" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
IF NOT EXISTS (
SELECT 1 FROM public.project_specifications ps
JOIN public.projects p ON p.id = ps.project_id
WHERE ps.id = p_specification_id
AND public.is_project_member(p.id, 'viewer')
) THEN
RAISE EXCEPTION 'Specification not found or access denied';
END IF;

RETURN QUERY
SELECT
sr.id,
sr.name,
sr.description,
sr.category,
ss.name as section_name
FROM public.specification_requirements sr
LEFT JOIN public.specification_sections ss ON ss.id = sr.section_id
WHERE sr.specification_id = p_specification_id
AND NOT EXISTS (
SELECT 1
FROM public.specification_mappings sm
WHERE sm.requirement_id = sr.id
AND sm.is_orphan = false
)
ORDER BY sr.created_at;
END;
$$;


ALTER FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_users_pending_provisioning"() RETURNS TABLE("user_id" "uuid", "email" "text", "created_at" timestamp with time zone, "minutes_waiting" numeric, "trigger_attempts" bigint, "last_error" "text", "needs_manual_intervention" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admins can view pending provisioning' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text,
    u.created_at,
    EXTRACT(EPOCH FROM (now() - u.created_at)) / 60 AS minutes_waiting,
    COUNT(DISTINCT sal.id) AS trigger_attempts,
    (
      SELECT sal2.metadata->>'error'
      FROM public.subscription_audit_log sal2
      WHERE sal2.user_id = u.id
        AND sal2.action IN ('provisioning_failed', 'trigger_failed')
      ORDER BY sal2.created_at DESC
      LIMIT 1
    ) AS last_error,
    (EXTRACT(EPOCH FROM (now() - u.created_at)) / 60 > 10
     OR COUNT(sal.id) FILTER (WHERE sal.action = 'trigger_failed') > 2
    ) AS needs_manual_intervention
  FROM auth.users u
  LEFT JOIN public.stripe_customers sc ON u.id = sc.user_id AND sc.deleted_at IS NULL
  LEFT JOIN public.subscription_audit_log sal ON u.id = sal.user_id
    AND sal.source IN ('provision_trigger', 'create-free-customer')
  WHERE sc.customer_id IS NULL
    AND u.deleted_at IS NULL
  GROUP BY u.id, u.email, u.created_at
  ORDER BY u.created_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_users_pending_provisioning"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."graph_patches_respect_leases"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_project uuid;
  v_nodes text[];
  v_lease public.agent_checkouts%ROWTYPE;
  v_graph jsonb;
  v_boxes text[] := ARRAY[]::text[];
BEGIN
  IF NEW.actor_type <> 'human' OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  v_nodes := public.patch_changed_nodes(NEW.payload);
  IF v_nodes IS NULL OR cardinality(v_nodes) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT project_id INTO v_project FROM public.branches WHERE id = NEW.branch_id;
  SELECT * INTO v_lease
    FROM public.agent_checkouts
   WHERE project_id = v_project AND released_at IS NULL
     AND level IN ('node', 'task', 'code')
     AND node_id::text = ANY(v_nodes)
     AND heartbeat_at >= now() - interval '30 minutes'
     AND holder_delegate IS DISTINCT FROM ('user:' || v_uid::text)
   ORDER BY (level = 'node') DESC, since
   LIMIT 1;
  -- AA.3: a part is covered by its box's node lease. The graph is read only
  -- when someone else holds a node lease in the project.
  IF NOT FOUND AND EXISTS (
    SELECT 1 FROM public.agent_checkouts
     WHERE project_id = v_project AND released_at IS NULL AND level = 'node'
       AND heartbeat_at >= now() - interval '30 minutes'
       AND holder_delegate IS DISTINCT FROM ('user:' || v_uid::text)
  ) THEN
    SELECT s.graph_data -> 'nodes' INTO v_graph
      FROM public.graph_snapshots s
     WHERE s.branch_id = NEW.branch_id
     ORDER BY s.patch_sequence DESC, s.created_at DESC
     LIMIT 1;
    IF v_graph IS NOT NULL THEN
      v_boxes := ARRAY(
        SELECT DISTINCT v_graph -> x ->> 'parentId'
          FROM unnest(v_nodes) AS x
         WHERE v_graph -> x ->> 'parentId' IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.node_roles r
                        WHERE r.id = v_graph -> x ->> 'type' AND 'part' = ANY(r.capability_tags)));
    END IF;
    IF cardinality(v_boxes) > 0 THEN
      SELECT * INTO v_lease
        FROM public.agent_checkouts
       WHERE project_id = v_project AND released_at IS NULL AND level = 'node'
         AND node_id::text = ANY(v_boxes)
         AND heartbeat_at >= now() - interval '30 minutes'
         AND holder_delegate IS DISTINCT FROM ('user:' || v_uid::text)
       ORDER BY since
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Node % is part of node %, which is leased by % since %. A box''s lease covers its parts: wait for the lease to end, or ask its holder to release it.',
          (SELECT x FROM unnest(v_nodes) AS x WHERE v_graph -> x ->> 'parentId' = v_lease.node_id::text LIMIT 1),
          v_lease.node_id,
          v_lease.holder_label,
          to_char(v_lease.since AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF FOUND THEN
    RAISE EXCEPTION 'Node % is % by % since %. A leased node is locked: wait for the lease to end, or ask its holder to release it.',
      v_lease.node_id,
      CASE WHEN v_lease.level = 'node' THEN 'leased' ELSE 'being worked on' END,
      v_lease.holder_label,
      to_char(v_lease.since AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."graph_patches_respect_leases"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."graph_patches_respect_leases"() IS 'AA.5b: a person''s graph patch that changes a node someone else holds a fresh lease on (node, or task/code work inside it) is refused, naming the holder. Layout-only node updates, agent patches (checked at propose and accept) and writes with no signed-in user pass.';



CREATE OR REPLACE FUNCTION "public"."graph_patches_set_hash_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prev_hash text;
BEGIN
  -- Serialize inserts per branch: without this, two concurrent inserts could both read
  -- the same predecessor and fork the chain.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.branch_id::text, 0));

  SELECT gp.entry_hash INTO v_prev_hash
  FROM graph_patches gp
  WHERE gp.branch_id = NEW.branch_id
    AND gp.sequence < NEW.sequence
  ORDER BY gp.sequence DESC
  LIMIT 1;

  -- Server-derived, always: client-supplied hash values are never trusted.
  NEW.prev_hash := v_prev_hash;
  NEW.entry_hash := compute_patch_entry_hash(
    NEW.id, NEW.branch_id, NEW.sequence, NEW.patch_type, NEW.actor_type,
    NEW.actor_id, NEW.summary, NEW.payload, NEW.preconditions, NEW.created_at,
    v_prev_hash
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."graph_patches_set_hash_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."graph_reference_ids"("p_branch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH snap AS (
    SELECT s.graph_data AS gd, s.patch_sequence
      FROM public.graph_snapshots s
      JOIN public.branches b ON b.id = s.branch_id
      JOIN public.projects p ON p.id = b.project_id
     WHERE s.branch_id = p_branch_id
       AND (auth.role() = 'service_role' OR p.owner_id = auth.uid())
     ORDER BY s.patch_sequence DESC, s.created_at DESC
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'found',         (SELECT count(*) FROM snap) > 0,
    'patchSequence', COALESCE((SELECT patch_sequence FROM snap), 0),
    'nodes',         public.jsonb_map_keys((SELECT gd->'nodes'     FROM snap)),
    'contracts',     public.jsonb_map_keys((SELECT gd->'contracts' FROM snap)),
    'edges',         public.jsonb_map_keys((SELECT gd->'edges'     FROM snap)),
    'artifacts',     public.jsonb_map_keys((SELECT gd->'artifacts' FROM snap))
  );
$$;


ALTER FUNCTION "public"."graph_reference_ids"("p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."graph_reference_ids"("p_branch_id" "uuid") IS 'The node / contract / edge / artifact id sets of a branch''s current snapshot, without its graph_data. What propose_patches validates an incoming patch batch against.';



CREATE OR REPLACE FUNCTION "public"."has_mcp_connection"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM mcp_oauth_tokens
    WHERE user_id = auth.uid()
      AND revoked_at IS NULL
      AND expires_at > now()
  ) OR EXISTS (
    SELECT 1 FROM mcp_api_keys
    WHERE user_id = auth.uid()
      AND revoked_at IS NULL
      AND last_used_at IS NOT NULL
  );
$$;


ALTER FUNCTION "public"."has_mcp_connection"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '_stripe_customer'));

  IF EXISTS (
    SELECT 1 FROM stripe_customers
    WHERE user_id = p_user_id AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO stripe_customers (user_id, customer_id)
  VALUES (p_user_id, p_customer_id);
END;
$$;


ALTER FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '_stripe_subscription'));

  IF EXISTS (
    SELECT 1 FROM stripe_subscriptions
    WHERE user_id = p_user_id AND status IN ('active', 'trialing', 'past_due', 'not_started')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO stripe_subscriptions (
    user_id, stripe_customer_id, plan_name, status,
    amount_cents, currency, billing_interval
  ) VALUES (
    p_user_id, p_customer_id, 'community', 'active',
    0, 'usd', 'month'
  );
END;
$$;


ALTER FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_assign_groups"("p_job_id" "uuid", "p_groups" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_assigned bigint;
  v_unassigned bigint;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'import_assign_groups: job is required';
  END IF;

  WITH g AS (
    SELECT (x->>'idx')::integer AS idx, d.dir
      FROM jsonb_array_elements(COALESCE(p_groups, '[]'::jsonb)) x
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(x->'dirs', '[]'::jsonb)) AS d(dir)
     WHERE x->>'idx' IS NOT NULL
  )
  UPDATE public.import_job_files f
     SET group_idx = (
       SELECT g.idx
         FROM g
        WHERE (g.dir = '' AND position('/' IN f.path) = 0)
           OR f.path = g.dir
           OR left(f.path, length(g.dir) + 1) = g.dir || '/'
        ORDER BY length(g.dir) DESC
        LIMIT 1)
   WHERE f.job_id = p_job_id;

  SELECT count(*) FILTER (WHERE group_idx IS NOT NULL), count(*) FILTER (WHERE group_idx IS NULL)
    INTO v_assigned, v_unassigned
    FROM public.import_job_files WHERE job_id = p_job_id;

  RETURN jsonb_build_object('assigned', v_assigned, 'unassigned', v_unassigned);
END;
$$;


ALTER FUNCTION "public"."import_assign_groups"("p_job_id" "uuid", "p_groups" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_assign_groups"("p_job_id" "uuid", "p_groups" "jsonb") IS 'RI-12: stamp every census row of an import job with its longest-prefix group (groups = [{idx, dirs[]}]); called by skeleton-group so rows the fetch never touches still bind on accept. service_role only.';



CREATE OR REPLACE FUNCTION "public"."import_dir_tallies"("p_job_id" "uuid", "p_manifest_names" "text"[], "p_entry_point_names" "text"[], "p_config_names" "text"[], "p_signal_cap" integer DEFAULT 20000) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  WITH rows AS (
    SELECT
      f.path,
      f.size,
      COALESCE(f.role, 'other')      AS role,
      COALESCE(f.language, 'other')  AS language,
      f.framework,
      f.artifact_kind,
      f.content,
      regexp_replace(f.path, '^.*/', '') AS basename,
      CASE
        WHEN array_length(string_to_array(f.path, '/'), 1) <= 1 THEN ''
        ELSE array_to_string(
          (string_to_array(f.path, '/'))[1:LEAST(array_length(string_to_array(f.path, '/'), 1) - 1, 2)],
          '/'
        )
      END AS dir
    FROM public.import_job_files f
    WHERE f.job_id = p_job_id
  ),
  dirs AS (
    SELECT dir, count(*) AS file_count, COALESCE(sum(size), 0) AS total_size
    FROM rows GROUP BY dir
  ),
  role_tally AS (
    SELECT dir, role, count(*) AS n FROM rows GROUP BY dir, role
  ),
  lang_tally AS (
    SELECT dir, language, count(*) AS n FROM rows GROUP BY dir, language
  ),
  fw_tally AS (
    SELECT DISTINCT dir, framework FROM rows WHERE framework IS NOT NULL
  ),
  signal AS (
    SELECT path, size, role, language, framework, artifact_kind, content
    FROM rows
    WHERE basename = ANY(p_manifest_names)
       OR basename = ANY(p_entry_point_names)
       OR basename = ANY(p_config_names)
       OR role = 'entry-point'
       OR content IS NOT NULL
  )
  SELECT jsonb_build_object(
    'totalFiles', (SELECT count(*) FROM rows),
    'dirs', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'dir', d.dir,
        'fileCount', d.file_count,
        'totalSize', d.total_size,
        'roles',      (SELECT COALESCE(jsonb_object_agg(r.role, r.n), '{}'::jsonb)     FROM role_tally r WHERE r.dir = d.dir),
        'languages',  (SELECT COALESCE(jsonb_object_agg(l.language, l.n), '{}'::jsonb) FROM lang_tally l WHERE l.dir = d.dir),
        'frameworks', (SELECT COALESCE(jsonb_agg(w.framework), '[]'::jsonb)            FROM fw_tally w WHERE w.dir = d.dir)
      ) ORDER BY d.dir), '[]'::jsonb)
      FROM dirs d
    ),
    'signalFilesTotal', (SELECT count(*) FROM signal),
    'signalFiles', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'path', s.path, 'size', s.size, 'role', s.role, 'language', s.language,
        'framework', s.framework, 'artifactKind', s.artifact_kind, 'content', s.content
      ) ORDER BY s.path), '[]'::jsonb)
      FROM (SELECT * FROM signal ORDER BY path LIMIT p_signal_cap) s
    )
  );
$$;


ALTER FUNCTION "public"."import_dir_tallies"("p_job_id" "uuid", "p_manifest_names" "text"[], "p_entry_point_names" "text"[], "p_config_names" "text"[], "p_signal_cap" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_dir_tallies"("p_job_id" "uuid", "p_manifest_names" "text"[], "p_entry_point_names" "text"[], "p_config_names" "text"[], "p_signal_cap" integer) IS 'RI-3: census aggregation for the skeleton-group stage — directory tallies + the bounded signal-file subset; service_role only.';



CREATE OR REPLACE FUNCTION "public"."import_graph_group_edges"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_group_edges bigint;
  v_cycles jsonb;
BEGIN
  IF to_regclass('pg_temp.tmp_files') IS NOT NULL THEN DROP TABLE tmp_files; END IF;
  IF to_regclass('pg_temp.tmp_edges') IS NOT NULL THEN DROP TABLE tmp_edges; END IF;

  CREATE TEMP TABLE tmp_files (path text PRIMARY KEY, group_idx integer) ON COMMIT DROP;
  INSERT INTO tmp_files (path, group_idx)
  SELECT f.path, f.group_idx FROM public.import_job_files f WHERE f.job_id = p_job_id AND f.group_idx IS NOT NULL;
  CREATE TEMP TABLE tmp_edges (from_path text NOT NULL, to_path text NOT NULL, kind text NOT NULL) ON COMMIT DROP;
  INSERT INTO tmp_edges (from_path, to_path, kind)
  SELECT e.from_path, e.to_path, e.kind FROM public.import_job_edges e WHERE e.job_id = p_job_id;
  ANALYZE tmp_files;
  ANALYZE tmp_edges;

  -- Cross-group aggregate in ONE pass: a window numbers each pair's edges,
  -- the aggregate keeps the first three as samples.
  DELETE FROM public.import_job_group_edges WHERE job_id = p_job_id;
  WITH joined AS (
    SELECT f.group_idx AS fg, t.group_idx AS tg, e.kind, e.from_path, e.to_path,
           row_number() OVER (PARTITION BY f.group_idx, t.group_idx, e.kind ORDER BY e.from_path, e.to_path) AS rn
      FROM tmp_edges e
      JOIN tmp_files f ON f.path = e.from_path
      JOIN tmp_files t ON t.path = e.to_path
     WHERE f.group_idx <> t.group_idx
  )
  INSERT INTO public.import_job_group_edges (job_id, from_group_idx, to_group_idx, kind, edge_count, samples)
  SELECT p_job_id, j.fg, j.tg, j.kind, count(*)::integer,
         COALESCE(jsonb_agg(jsonb_build_object('from', j.from_path, 'to', j.to_path) ORDER BY j.from_path, j.to_path)
                  FILTER (WHERE j.rn <= 3), '[]'::jsonb)
    FROM joined j
   GROUP BY j.fg, j.tg, j.kind;

  SELECT count(*) INTO v_group_edges FROM public.import_job_group_edges WHERE job_id = p_job_id;

  -- Cycles = strongly connected components of the group graph, from a
  -- transitive closure bounded by |groups|² rows; each once, ≤ 20.
  WITH RECURSIVE ge AS (
    SELECT DISTINCT from_group_idx AS fg, to_group_idx AS tg
      FROM public.import_job_group_edges WHERE job_id = p_job_id
  ),
  reach(a, b) AS (
    SELECT fg, tg FROM ge
    UNION
    SELECT r.a, g.tg FROM reach r JOIN ge g ON g.fg = r.b
  ),
  members AS (
    SELECT s.a, array_agg(DISTINCT m.b ORDER BY m.b) AS component
      FROM (SELECT a FROM reach WHERE a = b) s
      JOIN (SELECT r1.a, r1.b FROM reach r1 JOIN reach r2 ON r2.a = r1.b AND r2.b = r1.a
            UNION SELECT a, a FROM reach WHERE a = b) m ON m.a = s.a
     GROUP BY s.a
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c.component) ORDER BY array_length(c.component, 1), c.component), '[]'::jsonb)
    INTO v_cycles
    FROM (SELECT component FROM members GROUP BY component ORDER BY array_length(component, 1), component LIMIT 20) c;

  DROP TABLE tmp_edges;
  DROP TABLE tmp_files;

  RETURN jsonb_build_object('groupEdges', v_group_edges, 'cycles', v_cycles);
END;
$$;


ALTER FUNCTION "public"."import_graph_group_edges"("p_job_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_graph_group_edges"("p_job_id" "uuid") IS 'RI-4 graph metrics, part 2: one-pass cross-group aggregate with samples + cycles as strongly connected components. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_graph_metrics"("p_job_id" "uuid", "p_iterations" integer DEFAULT NULL::integer, "p_damping" double precision DEFAULT 0.85, "p_budget_ms" integer DEFAULT 4000) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_n bigint;
  v_edges bigint;
  v_rounds integer;
  v_i integer;
  v_dangling double precision;
  v_max double precision;
  v_top jsonb;
  v_cur text;
  v_nxt text;
  v_tmp text;
  v_t0 timestamptz := clock_timestamp();
  v_done integer := 0;
BEGIN
  IF to_regclass('pg_temp.tmp_files') IS NOT NULL THEN DROP TABLE tmp_files; END IF;
  IF to_regclass('pg_temp.tmp_edges') IS NOT NULL THEN DROP TABLE tmp_edges; END IF;
  IF to_regclass('pg_temp.tmp_rank') IS NOT NULL THEN DROP TABLE tmp_rank; END IF;
  IF to_regclass('pg_temp.tmp_pr_a') IS NOT NULL THEN DROP TABLE tmp_pr_a; END IF;
  IF to_regclass('pg_temp.tmp_pr_b') IS NOT NULL THEN DROP TABLE tmp_pr_b; END IF;
  IF to_regclass('pg_temp.tmp_contrib') IS NOT NULL THEN DROP TABLE tmp_contrib; END IF;

  -- 1. This job's graph in session-local scratch, with statistics of its own.
  CREATE TEMP TABLE tmp_files (path text PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO tmp_files (path) SELECT f.path FROM public.import_job_files f WHERE f.job_id = p_job_id;
  CREATE TEMP TABLE tmp_edges (from_path text NOT NULL, to_path text NOT NULL) ON COMMIT DROP;
  INSERT INTO tmp_edges (from_path, to_path)
  SELECT e.from_path, e.to_path FROM public.import_job_edges e WHERE e.job_id = p_job_id;
  CREATE INDEX ON tmp_edges (from_path);
  ANALYZE tmp_files;
  ANALYZE tmp_edges;

  -- 2. Degrees.
  CREATE TEMP TABLE tmp_rank (
    path text PRIMARY KEY,
    fan_in integer NOT NULL DEFAULT 0,
    out_deg integer NOT NULL DEFAULT 0,
    rank double precision NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  INSERT INTO tmp_rank (path, fan_in, out_deg)
  SELECT f.path, COALESCE(i.n, 0), COALESCE(o.n, 0)
    FROM tmp_files f
    LEFT JOIN (SELECT to_path, count(*) AS n FROM tmp_edges GROUP BY to_path) i ON i.to_path = f.path
    LEFT JOIN (SELECT from_path, count(*) AS n FROM tmp_edges GROUP BY from_path) o ON o.from_path = f.path;
  ANALYZE tmp_rank;

  SELECT count(*) INTO v_n FROM tmp_rank;
  SELECT count(*) INTO v_edges FROM tmp_edges;

  -- 3. PageRank, rounds adapted to the graph, ranks alternating between two
  --    scratch tables (no copy-back), normalized to the top file = 1.0.
  v_rounds := COALESCE(p_iterations, CASE WHEN v_edges <= 30000 THEN 10 WHEN v_edges <= 100000 THEN 8 ELSE 6 END);
  IF v_n > 0 AND v_edges > 0 THEN
    CREATE TEMP TABLE tmp_pr_a (path text PRIMARY KEY, out_deg integer NOT NULL, rank double precision NOT NULL) ON COMMIT DROP;
    CREATE TEMP TABLE tmp_pr_b (LIKE tmp_pr_a INCLUDING ALL) ON COMMIT DROP;
    CREATE TEMP TABLE tmp_contrib (path text PRIMARY KEY, contrib double precision NOT NULL) ON COMMIT DROP;
    INSERT INTO tmp_pr_a (path, out_deg, rank) SELECT path, out_deg, 1.0 / v_n FROM tmp_rank;
    ANALYZE tmp_pr_a;
    v_cur := 'tmp_pr_a';
    v_nxt := 'tmp_pr_b';

    FOR v_i IN 1..GREATEST(v_rounds, 1) LOOP
      -- Wall-clock guard: stop iterating (never below 2 rounds) once the
      -- statement has used its budget, leaving room for the wide write.
      EXIT WHEN v_i > 2 AND clock_timestamp() > v_t0 + make_interval(secs => GREATEST(p_budget_ms, 0) / 1000.0);
      EXECUTE format('SELECT COALESCE(sum(rank), 0) FROM %I WHERE out_deg = 0', v_cur) INTO v_dangling;

      TRUNCATE tmp_contrib;
      EXECUTE format(
        'INSERT INTO tmp_contrib (path, contrib)
         SELECT e.to_path, sum(src.rank / src.out_deg)
           FROM tmp_edges e JOIN %I src ON src.path = e.from_path
          WHERE src.out_deg > 0 GROUP BY e.to_path', v_cur);
      IF v_i = 1 THEN ANALYZE tmp_contrib; END IF;

      EXECUTE format('TRUNCATE %I', v_nxt);
      EXECUTE format(
        'INSERT INTO %I (path, out_deg, rank)
         SELECT p.path, p.out_deg, $1 + $2 * COALESCE(c.contrib, 0)
           FROM %I p LEFT JOIN tmp_contrib c ON c.path = p.path', v_nxt, v_cur)
        USING (1 - p_damping) / v_n + p_damping * (v_dangling / v_n), p_damping;
      IF v_i = 1 THEN EXECUTE format('ANALYZE %I', v_nxt); END IF;

      v_tmp := v_cur; v_cur := v_nxt; v_nxt := v_tmp;
      v_done := v_i;
    END LOOP;

    EXECUTE format('UPDATE tmp_rank r SET rank = p.rank FROM %I p WHERE p.path = r.path', v_cur);
    SELECT max(rank) INTO v_max FROM tmp_rank;
    IF v_max IS NULL OR v_max <= 0 THEN v_max := 1; END IF;
  ELSE
    v_max := 1;
  END IF;

  -- 4. ONE write to the wide staging rows.
  UPDATE public.import_job_files f
     SET fan_in = r.fan_in,
         fan_out = r.out_deg,
         centrality = CASE WHEN v_edges > 0 THEN (r.rank / v_max)::real ELSE 0 END
    FROM tmp_rank r
   WHERE f.job_id = p_job_id AND f.path = r.path;

  -- 5. Report.
  IF v_edges > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'path', t.path, 'centrality', t.centrality, 'fanIn', t.fan_in, 'fanOut', t.out_deg)), '[]'::jsonb)
      INTO v_top
      FROM (SELECT path, (rank / v_max)::real AS centrality, fan_in, out_deg
              FROM tmp_rank WHERE rank > 0 ORDER BY rank DESC, path LIMIT 20) t;
  ELSE
    v_top := '[]'::jsonb;
  END IF;

  IF to_regclass('pg_temp.tmp_contrib') IS NOT NULL THEN DROP TABLE tmp_contrib; END IF;
  IF to_regclass('pg_temp.tmp_pr_a') IS NOT NULL THEN DROP TABLE tmp_pr_a; END IF;
  IF to_regclass('pg_temp.tmp_pr_b') IS NOT NULL THEN DROP TABLE tmp_pr_b; END IF;
  DROP TABLE tmp_rank;
  DROP TABLE tmp_edges;
  DROP TABLE tmp_files;

  RETURN jsonb_build_object(
    'files', v_n,
    'edges', v_edges,
    'rounds', v_done,
    'roundsPlanned', v_rounds,
    'groupEdges', NULL,
    'cycles', NULL,
    'top', v_top
  );
END;
$_$;


ALTER FUNCTION "public"."import_graph_metrics"("p_job_id" "uuid", "p_iterations" integer, "p_damping" double precision, "p_budget_ms" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_graph_metrics"("p_job_id" "uuid", "p_iterations" integer, "p_damping" double precision, "p_budget_ms" integer) IS 'RI-4 graph metrics, part 1: degrees + PageRank (rounds bounded by p_budget_ms wall clock and edge count; p_iterations pins) + the single wide write, over ANALYZEd scratch copies. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_hub_files"("p_job_id" "uuid", "p_anchor_names" "text"[], "p_per_group" integer DEFAULT 120, "p_unassigned_sample" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  WITH rows AS (
    SELECT
      f.path, f.group_idx, f.role, f.language, f.framework, f.artifact_kind,
      f.size, f.centrality, f.fan_in, f.fan_out, f.content,
      (f.role = 'entry-point' OR regexp_replace(f.path, '^.*/', '') = ANY(p_anchor_names)) AS is_anchor,
      CASE
        WHEN array_length(string_to_array(f.path, '/'), 1) <= 1 THEN ''
        ELSE array_to_string(
          (string_to_array(f.path, '/'))[1:LEAST(array_length(string_to_array(f.path, '/'), 1) - 1, 2)],
          '/'
        )
      END AS dir
    FROM public.import_job_files f
    WHERE f.job_id = p_job_id
  ),
  ranked AS (
    SELECT r.*,
           row_number() OVER (
             PARTITION BY r.group_idx
             ORDER BY r.is_anchor DESC, r.centrality DESC, r.fan_in DESC, r.path
           ) AS rn
    FROM rows r
    WHERE r.group_idx IS NOT NULL
  ),
  groups AS (
    SELECT group_idx FROM rows WHERE group_idx IS NOT NULL GROUP BY group_idx
  )
  SELECT jsonb_build_object(
    'totalFiles', (SELECT count(*) FROM rows),
    'groups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'groupIdx',   g.group_idx,
        'fileCount',  (SELECT count(*) FROM rows r WHERE r.group_idx = g.group_idx),
        'languages',  (SELECT COALESCE(jsonb_object_agg(l.language, l.n), '{}'::jsonb)
                         FROM (SELECT COALESCE(language, 'other') AS language, count(*) AS n
                                 FROM rows WHERE group_idx = g.group_idx GROUP BY 1) l),
        'frameworks', (SELECT COALESCE(jsonb_agg(DISTINCT framework), '[]'::jsonb)
                         FROM rows WHERE group_idx = g.group_idx AND framework IS NOT NULL),
        'roleKinds',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('role', rk.role, 'kind', rk.kind, 'n', rk.n)), '[]'::jsonb)
                         FROM (SELECT COALESCE(role, 'unknown') AS role, COALESCE(artifact_kind, 'source') AS kind, count(*) AS n
                                 FROM rows WHERE group_idx = g.group_idx GROUP BY 1, 2) rk),
        'dirs',       (SELECT COALESCE(jsonb_agg(DISTINCT dir), '[]'::jsonb)
                         FROM rows WHERE group_idx = g.group_idx),
        'hubs',       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                          'path', h.path, 'role', h.role, 'language', h.language, 'framework', h.framework,
                          'artifactKind', h.artifact_kind, 'size', h.size, 'centrality', h.centrality,
                          'fanIn', h.fan_in, 'fanOut', h.fan_out, 'isAnchor', h.is_anchor, 'content', h.content
                        ) ORDER BY h.rn), '[]'::jsonb)
                         FROM ranked h WHERE h.group_idx = g.group_idx AND h.rn <= p_per_group)
      ) ORDER BY g.group_idx), '[]'::jsonb)
      FROM groups g
    ),
    'unassigned', jsonb_build_object(
      'count', (SELECT count(*) FROM rows WHERE group_idx IS NULL),
      'sample', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'path', u.path, 'role', u.role, 'language', u.language, 'size', u.size
                  ) ORDER BY u.path), '[]'::jsonb)
                   FROM (SELECT path, role, language, size FROM rows
                          WHERE group_idx IS NULL ORDER BY path LIMIT p_unassigned_sample) u)
    )
  );
$$;


ALTER FUNCTION "public"."import_hub_files"("p_job_id" "uuid", "p_anchor_names" "text"[], "p_per_group" integer, "p_unassigned_sample" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_hub_files"("p_job_id" "uuid", "p_anchor_names" "text"[], "p_per_group" integer, "p_unassigned_sample" integer) IS 'RI-5: per-group tallies + the bounded hub subset synthesize materializes as artifacts; service_role only.';



CREATE OR REPLACE FUNCTION "public"."import_job_bump_attempt"("p_job_id" "uuid", "p_key" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.import_jobs
     SET metrics = COALESCE(metrics, '{}'::jsonb)
                   || jsonb_build_object(p_key, COALESCE((metrics->>p_key)::integer, 0) + 1),
         updated_at = now()
   WHERE id = p_job_id
  RETURNING (metrics->>p_key)::integer INTO v_count;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."import_job_bump_attempt"("p_job_id" "uuid", "p_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_job_bump_attempt"("p_job_id" "uuid", "p_key" "text") IS 'Atomic increment of one kill-loop attempt counter in import_jobs.metrics; returns the new count. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_job_lease"("p_job_id" "uuid", "p_owner" "text", "p_ttl_seconds" integer DEFAULT 180) RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.import_jobs
     SET driver_lease_owner = p_owner,
         driver_lease_until = now() + make_interval(secs => GREATEST(p_ttl_seconds, 1))
   WHERE id = p_job_id
     AND (driver_lease_until IS NULL
          OR driver_lease_until < now()
          OR driver_lease_owner = p_owner);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;


ALTER FUNCTION "public"."import_job_lease"("p_job_id" "uuid", "p_owner" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_job_lease_release"("p_job_id" "uuid", "p_owner" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.import_jobs
     SET driver_lease_until = now()
   WHERE id = p_job_id AND driver_lease_owner = p_owner;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;


ALTER FUNCTION "public"."import_job_lease_release"("p_job_id" "uuid", "p_owner" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_job_merge_metrics"("p_job_id" "uuid", "p_patch" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    AS $$
  UPDATE public.import_jobs
     SET metrics = COALESCE(metrics, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb),
         updated_at = now()
   WHERE id = p_job_id
  RETURNING metrics;
$$;


ALTER FUNCTION "public"."import_job_merge_metrics"("p_job_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_job_merge_metrics"("p_job_id" "uuid", "p_patch" "jsonb") IS 'Atomic jsonb merge into import_jobs.metrics — parallel wave members write only their own keys. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_job_paths"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(jsonb_agg(f.path ORDER BY f.path), '[]'::jsonb)
  FROM public.import_job_files f
  WHERE f.job_id = p_job_id;
$$;


ALTER FUNCTION "public"."import_job_paths"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_job_set_probe"("p_job_id" "uuid", "p_stage" "text", "p_detail" "text") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE public.import_jobs
     SET stages = COALESCE(
                    (SELECT jsonb_agg(c)
                       FROM jsonb_array_elements(COALESCE(stages, '[]'::jsonb)) c
                      WHERE NOT (c->>'stage' = p_stage AND (c->>'ok')::boolean = false)),
                    '[]'::jsonb)
                  || jsonb_build_array(jsonb_build_object(
                       'stage', p_stage, 'ok', false,
                       'startedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                       'finishedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                       'error', p_detail)),
         updated_at = now()
   WHERE id = p_job_id;
$$;


ALTER FUNCTION "public"."import_job_set_probe"("p_job_id" "uuid", "p_stage" "text", "p_detail" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_job_set_probe"("p_job_id" "uuid", "p_stage" "text", "p_detail" "text") IS 'Replaces a stage token''s position probe (ok:false entry) in import_jobs.stages atomically. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_jobs_stale"("p_stale_seconds" integer DEFAULT 180) RETURNS TABLE("job_id" "uuid", "project_id" "uuid", "stage" "text", "seconds_since_update" integer)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT j.id, j.project_id, j.stage, EXTRACT(EPOCH FROM (now() - j.updated_at))::integer
    FROM public.import_jobs j
   WHERE j.status IN ('pending', 'running', 'promoting')
     AND (j.driver_lease_until IS NULL OR j.driver_lease_until < now())
     AND j.updated_at < now() - make_interval(secs => GREATEST(p_stale_seconds, 1))
   ORDER BY j.updated_at;
$$;


ALTER FUNCTION "public"."import_jobs_stale"("p_stale_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_jobs_stale"("p_stale_seconds" integer) IS 'Operator utility (SQL editor): import jobs whose driver lease lapsed and that have not moved for p_stale_seconds. No application caller by design.';



CREATE OR REPLACE FUNCTION "public"."import_promote_edges_page"("p_job_id" "uuid", "p_limit" integer DEFAULT 20000) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_promo jsonb;
  v_branch uuid;
  v_cur jsonb;
  v_limit integer := GREATEST(COALESCE(p_limit, 20000), 1);
  v_before integer;
  v_n integer := 0;
  v_ins integer := 0;
  v_last_from text;
  v_last_to text;
  v_last_kind text;
BEGIN
  SELECT j.promotion INTO v_promo FROM public.import_jobs j WHERE j.id = p_job_id;
  IF v_promo IS NULL OR v_promo->>'branchId' IS NULL THEN
    RAISE EXCEPTION 'import_promote_edges_page: job % has no recorded promotion (the import proposal has not been accepted)', p_job_id;
  END IF;
  IF v_promo->'edgesTotal' IS NULL OR jsonb_typeof(v_promo->'edgesTotal') = 'null' THEN
    RAISE EXCEPTION 'import_promote_edges_page: the close of job % was not prepared (import_promote_finish_prepare runs first)', p_job_id;
  END IF;
  v_branch := (v_promo->>'branchId')::uuid;
  v_cur := CASE WHEN jsonb_typeof(v_promo->'edgeCursor') = 'object' THEN v_promo->'edgeCursor' END;
  v_before := COALESCE((v_promo->>'edgesWritten')::integer, 0);

  -- The page: staging edges past the cursor in primary-key order (the key
  -- (job_id, from_path, to_path, kind) serves the range and the order).
  -- `page` is referenced twice and therefore materialized once; the
  -- data-modifying CTE runs to completion whatever the outer query reads.
  WITH page AS (
    SELECT e.from_path, e.to_path, e.kind
      FROM public.import_job_edges e
     WHERE e.job_id = p_job_id
       AND (v_cur IS NULL OR (e.from_path, e.to_path, e.kind) > (v_cur->>'from', v_cur->>'to', v_cur->>'kind'))
     ORDER BY e.from_path, e.to_path, e.kind
     LIMIT v_limit
  ),
  written AS (
    INSERT INTO public.repo_index_edges (branch_id, from_path, to_path, kind)
    SELECT v_branch, p.from_path, p.to_path, p.kind FROM page p
    ON CONFLICT DO NOTHING
    RETURNING 1
  ),
  last_row AS (
    SELECT from_path, to_path, kind FROM page
     ORDER BY from_path DESC, to_path DESC, kind DESC
     LIMIT 1
  )
  SELECT (SELECT count(*) FROM page)::integer,
         (SELECT count(*) FROM written)::integer,
         l.from_path, l.to_path, l.kind
    INTO v_n, v_ins, v_last_from, v_last_to, v_last_kind
    FROM (SELECT 1) x LEFT JOIN last_row l ON true;

  IF v_n > 0 THEN
    UPDATE public.import_jobs
       SET promotion = promotion || jsonb_build_object(
             'edgeCursor', jsonb_build_object('from', v_last_from, 'to', v_last_to, 'kind', v_last_kind),
             'edgesWritten', v_before + v_n),
           metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object('promote.edgesWritten', v_before + v_n),
           updated_at = now()
     WHERE id = p_job_id;
  END IF;

  RETURN jsonb_build_object(
    'scanned', v_n,
    'written', v_ins,
    'total', v_before + v_n,
    'done', v_n < v_limit
  );
END;
$$;


ALTER FUNCTION "public"."import_promote_edges_page"("p_job_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_promote_edges_page"("p_job_id" "uuid", "p_limit" integer) IS 'RI-14a: the next p_limit staging edges in primary-key order → repo_index_edges; cursor on the job row. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_promote_finish"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_promo jsonb;
  v_branch uuid;
  v_map jsonb;
  v_files bigint;
  v_bound bigint;
  v_edges bigint;
  v_deps bigint;
BEGIN
  SELECT j.promotion INTO v_promo FROM public.import_jobs j WHERE j.id = p_job_id;
  IF v_promo IS NULL OR v_promo->>'branchId' IS NULL THEN
    RAISE EXCEPTION 'import_promote_finish: job % has no recorded promotion (the import proposal has not been accepted)', p_job_id;
  END IF;
  IF v_promo->'edgesTotal' IS NULL OR jsonb_typeof(v_promo->'edgesTotal') = 'null' THEN
    RAISE EXCEPTION 'import_promote_finish: the close of job % was not prepared (import_promote_finish_prepare runs first)', p_job_id;
  END IF;
  IF COALESCE((v_promo->>'edgesWritten')::bigint, 0) < (v_promo->>'edgesTotal')::bigint THEN
    RAISE EXCEPTION 'import_promote_finish: job % has % of % edges paged — import_promote_edges_page is not done',
      p_job_id, COALESCE((v_promo->>'edgesWritten')::bigint, 0), (v_promo->>'edgesTotal')::bigint;
  END IF;
  v_branch := (v_promo->>'branchId')::uuid;
  v_map := COALESCE(v_promo->'groupNodes', '[]'::jsonb);

  SELECT count(*), count(node_id) INTO v_files, v_bound
    FROM public.repo_index WHERE branch_id = v_branch;
  SELECT count(*) INTO v_edges FROM public.repo_index_edges WHERE branch_id = v_branch;

  -- Node dependencies from the group aggregate, keyed by node id (several
  -- groups may share a node — absorbed support — so sum).
  DELETE FROM public.node_dependencies WHERE branch_id = v_branch;
  INSERT INTO public.node_dependencies (branch_id, from_node_id, to_node_id, kind, edge_count, samples, refreshed_at)
  SELECT v_branch, x.from_node, x.to_node, x.kind, x.n,
         (SELECT COALESCE(jsonb_agg(s.sample), '[]'::jsonb)
            FROM (SELECT sample
                    FROM public.import_job_group_edges ge2
                    JOIN jsonb_to_recordset(v_map) AS mf2(group_idx integer, node_id text)
                      ON mf2.group_idx = ge2.from_group_idx
                    JOIN jsonb_to_recordset(v_map) AS mt2(group_idx integer, node_id text)
                      ON mt2.group_idx = ge2.to_group_idx
                    CROSS JOIN LATERAL jsonb_array_elements(ge2.samples) AS sample
                   WHERE ge2.job_id = p_job_id AND ge2.kind = x.kind
                     AND mf2.node_id = x.from_node AND mt2.node_id = x.to_node
                   LIMIT 3) s),
         now()
    FROM (SELECT mf.node_id AS from_node, mt.node_id AS to_node, ge.kind, sum(ge.edge_count)::integer AS n
            FROM public.import_job_group_edges ge
            JOIN jsonb_to_recordset(v_map) AS mf(group_idx integer, node_id text)
              ON mf.group_idx = ge.from_group_idx
            JOIN jsonb_to_recordset(v_map) AS mt(group_idx integer, node_id text)
              ON mt.group_idx = ge.to_group_idx
           WHERE ge.job_id = p_job_id AND mf.node_id <> mt.node_id
           GROUP BY mf.node_id, mt.node_id, ge.kind) x;
  SELECT count(*) INTO v_deps FROM public.node_dependencies WHERE branch_id = v_branch;

  UPDATE public.import_jobs
     SET promotion = promotion || jsonb_build_object(
           'finishedAt', now(), 'files', v_files, 'bound', v_bound, 'edges', v_edges, 'nodeDependencies', v_deps),
         metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object(
           'promote.files', v_files,
           'promote.indexed', v_files,
           'promote.bound', v_bound,
           'promote.edges', v_edges,
           'promote.nodeDependencies', v_deps),
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('files', v_files, 'bound', v_bound, 'edges', v_edges, 'nodeDependencies', v_deps);
END;
$$;


ALTER FUNCTION "public"."import_promote_finish"("p_job_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_promote_finish"("p_job_id" "uuid") IS 'RI-12/14a: node dependencies + counts + record, after the edge pages are done (refuses otherwise). Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_promote_finish_prepare"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_promo jsonb;
  v_branch uuid;
  v_files bigint;
  v_bound bigint;
  v_stale bigint;
  v_total bigint;
BEGIN
  SELECT j.promotion INTO v_promo FROM public.import_jobs j WHERE j.id = p_job_id;
  IF v_promo IS NULL OR v_promo->>'branchId' IS NULL THEN
    RAISE EXCEPTION 'import_promote_finish_prepare: job % has no recorded promotion (the import proposal has not been accepted)', p_job_id;
  END IF;
  v_branch := (v_promo->>'branchId')::uuid;

  -- Rows from an earlier import of this branch that no longer exist.
  DELETE FROM public.repo_index r
   WHERE r.branch_id = v_branch
     AND NOT EXISTS (SELECT 1 FROM public.import_job_files f WHERE f.job_id = p_job_id AND f.path = r.path);
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  -- A fresh promotion supersedes every freshness finding for the branch.
  DELETE FROM public.repo_index_freshness WHERE branch_id = v_branch;
  -- The edge set is rebuilt from the staging rows; the pages fill it.
  DELETE FROM public.repo_index_edges WHERE branch_id = v_branch;

  SELECT count(*), count(node_id) INTO v_files, v_bound
    FROM public.repo_index WHERE branch_id = v_branch;
  SELECT count(*) INTO v_total FROM public.import_job_edges e WHERE e.job_id = p_job_id;

  -- The open cursor: edgeCursor null + edgesTotal present = prepared.
  UPDATE public.import_jobs
     SET promotion = promotion || jsonb_build_object(
           'files', v_files, 'bound', v_bound,
           'edgeCursor', NULL, 'edgesWritten', 0, 'edgesTotal', v_total, 'closeStartedAt', now()),
         metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object('promote.edgesWritten', 0, 'promote.edgesTotal', v_total),
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('files', v_files, 'bound', v_bound, 'stale', v_stale, 'edgesTotal', v_total);
END;
$$;


ALTER FUNCTION "public"."import_promote_finish_prepare"("p_job_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_promote_finish_prepare"("p_job_id" "uuid") IS 'RI-14a: stale rows out, freshness reset, branch edges deleted, edge cursor opened on the job row. Runs once before the edge pages. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_promote_on_proposal_accept"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_job uuid;
  v_map jsonb;
  v_files bigint;
BEGIN
  -- acceptProposal writes 'merged' (or 'partial'); anything else is not an accept.
  IF NEW.status NOT IN ('merged', 'partial') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.metadata IS NULL OR NOT (NEW.metadata ? 'jobId') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_job := (NEW.metadata->>'jobId')::uuid;

    -- group_idx → node_id from the accepted add_node patches' importGroupIdxs.
    -- A finalization that renamed, refiled or dropped nodes is honored: a
    -- dropped node's files promote unbound (node_id NULL), never to a node
    -- that does not exist.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('group_idx', gi.idx::integer, 'node_id', n.node_id)), '[]'::jsonb)
      INTO v_map
      FROM (SELECT e->'patch'->'payload'->>'id' AS node_id,
                   e->'patch'->'payload'->'metadata'->'importGroupIdxs' AS idxs
              FROM jsonb_array_elements(COALESCE(NEW.patches, '[]'::jsonb)) e
             WHERE e->'patch'->>'type' = 'add_node'
               AND COALESCE(e->>'status', 'pending') <> 'rejected') n
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(n.idxs, '[]'::jsonb)) AS gi(idx)
     WHERE n.node_id IS NOT NULL;

    SELECT count(*) INTO v_files FROM public.import_job_files f WHERE f.job_id = v_job;

    -- Record and hand over to the chain. Earlier promote checkpoints (a
    -- re-accept: partial → merged) are dropped so the tokens run again
    -- instead of replaying; the index upsert is idempotent.
    UPDATE public.import_jobs
       SET promotion = jsonb_build_object(
             'branchId', COALESCE(NEW.proposal_branch_id, NEW.source_branch_id),
             'groupNodes', v_map,
             'cursor', NULL,
             'promoted', 0,
             'files', v_files,
             'requestedAt', now(),
             'proposalId', NEW.id),
           status = 'promoting',
           stage = 'promote',
           stages = (SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
                       FROM jsonb_array_elements(COALESCE(stages, '[]'::jsonb)) c
                      WHERE c->>'stage' NOT LIKE 'promote%'),
           metrics = (COALESCE(metrics, '{}'::jsonb) - 'promote.failed')
                     || jsonb_build_object('promote.files', v_files, 'promote.indexed', 0),
           error = NULL,
           updated_at = now()
     WHERE id = v_job;
  -- query_canceled is named explicitly: OTHERS does not trap it. Whatever
  -- goes wrong here degrades to a recorded failure — never an aborted accept.
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING 'repo index promotion could not be scheduled for import job %: %', v_job, SQLERRM;
    UPDATE public.import_jobs
       SET metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object('promote.failed', 1),
           updated_at = now()
     WHERE id = v_job;
  END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."import_promote_on_proposal_accept"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_promote_page"("p_job_id" "uuid", "p_limit" integer DEFAULT 2000) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_promo jsonb;
  v_head text;
  v_branch uuid;
  v_map jsonb;
  v_cursor text;
  v_limit integer := GREATEST(COALESCE(p_limit, 2000), 1);
  v_n integer := 0;
  v_last text;
  v_before integer;
BEGIN
  SELECT j.promotion, j.skeleton->>'headSha' INTO v_promo, v_head
    FROM public.import_jobs j WHERE j.id = p_job_id;
  IF v_promo IS NULL OR v_promo->>'branchId' IS NULL THEN
    RAISE EXCEPTION 'import_promote_page: job % has no recorded promotion (the import proposal has not been accepted)', p_job_id;
  END IF;
  v_branch := (v_promo->>'branchId')::uuid;
  v_map := COALESCE(v_promo->'groupNodes', '[]'::jsonb);
  v_cursor := v_promo->>'cursor';
  v_before := COALESCE((v_promo->>'promoted')::integer, 0);

  -- The page: staging rows past the cursor, in path order (the primary key
  -- (job_id, path) serves both the range and the order).
  WITH page AS (
    SELECT f.*
      FROM public.import_job_files f
     WHERE f.job_id = p_job_id
       AND (v_cursor IS NULL OR f.path > v_cursor)
     ORDER BY f.path
     LIMIT v_limit
  ),
  written AS (
    INSERT INTO public.repo_index (
      branch_id, path, node_id, blob_sha, role, language, framework, artifact_kind, size,
      signals, fan_in, fan_out, centrality, content_ref, indexed_at_sha,
      extractor_version, updated_at
    )
    SELECT
      v_branch, f.path, m.node_id, f.blob_sha, f.role, f.language, f.framework, f.artifact_kind, f.size,
      f.signals, f.fan_in, f.fan_out, f.centrality, f.content_ref, v_head,
      f.extractor_version, now()
    FROM page f
    LEFT JOIN jsonb_to_recordset(v_map) AS m(group_idx integer, node_id text)
      ON m.group_idx = f.group_idx
    ON CONFLICT (branch_id, path) DO UPDATE SET
      node_id = EXCLUDED.node_id,
      blob_sha = EXCLUDED.blob_sha,
      role = EXCLUDED.role,
      language = EXCLUDED.language,
      framework = EXCLUDED.framework,
      artifact_kind = EXCLUDED.artifact_kind,
      size = EXCLUDED.size,
      signals = EXCLUDED.signals,
      fan_in = EXCLUDED.fan_in,
      fan_out = EXCLUDED.fan_out,
      centrality = EXCLUDED.centrality,
      content_ref = EXCLUDED.content_ref,
      indexed_at_sha = EXCLUDED.indexed_at_sha,
      extractor_version = EXCLUDED.extractor_version,
      updated_at = now()
    RETURNING path
  )
  SELECT count(*)::integer, max(path) INTO v_n, v_last FROM written;

  IF v_n > 0 THEN
    -- Progress is the job row: the cursor for the next page, the running
    -- count for the poll surface (promote.indexed), updated_at for the
    -- watchdog.
    UPDATE public.import_jobs
       SET promotion = promotion || jsonb_build_object('cursor', v_last, 'promoted', v_before + v_n),
           metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object('promote.indexed', v_before + v_n),
           updated_at = now()
     WHERE id = p_job_id;
  END IF;

  RETURN jsonb_build_object(
    'promoted', v_n,
    'cursor', v_last,
    'total', v_before + v_n,
    'done', v_n < v_limit
  );
END;
$$;


ALTER FUNCTION "public"."import_promote_page"("p_job_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_promote_page"("p_job_id" "uuid", "p_limit" integer) IS 'RI-12: promote the next page of staging rows (path order, cursor on import_jobs.promotion) into repo_index; the chain''s promote token calls it until done. service_role only.';



CREATE OR REPLACE FUNCTION "public"."import_root_deployments"("p_job_id" "uuid", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('path', r.path, 'deployments', r.signals->'deployments') ORDER BY r.path), '[]'::jsonb)
    FROM (
      SELECT f.path, f.signals
        FROM public.import_job_files f
       WHERE f.job_id = p_job_id
         AND f.group_idx IS NULL
         AND jsonb_typeof(f.signals->'deployments') = 'array'
         AND jsonb_array_length(f.signals->'deployments') > 0
       ORDER BY f.path
       LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) r;
$$;


ALTER FUNCTION "public"."import_root_deployments"("p_job_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_root_deployments"("p_job_id" "uuid", "p_limit" integer) IS 'RI-15a: deployment signals of the unassigned (repo-root) staging rows, bounded — the input of host-container planning for root compose / k8s files. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_wave_claim"("p_job_id" "uuid", "p_wave" "text", "p_limit" integer) RETURNS "text"[]
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_members text[];
BEGIN
  PERFORM 1 FROM public.import_jobs WHERE id = p_job_id FOR UPDATE;
  WITH picked AS (
    SELECT member
      FROM public.import_job_waves
     WHERE job_id = p_job_id AND wave = p_wave AND status = 'pending'
     ORDER BY member
     LIMIT GREATEST(p_limit, 0)
  ),
  claimed AS (
    UPDATE public.import_job_waves w
       SET status = 'running', updated_at = now()
      FROM picked
     WHERE w.job_id = p_job_id AND w.wave = p_wave AND w.member = picked.member
    RETURNING w.member
  )
  SELECT COALESCE(array_agg(member ORDER BY member), ARRAY[]::text[]) INTO v_members FROM claimed;
  RETURN v_members;
END;
$$;


ALTER FUNCTION "public"."import_wave_claim"("p_job_id" "uuid", "p_wave" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_wave_claim"("p_job_id" "uuid", "p_wave" "text", "p_limit" integer) IS 'RI-7 bounded waves: claims up to p_limit pending members of a wave (pending → running) under the job row lock; returns them in member order. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."import_wave_member_done"("p_job_id" "uuid", "p_wave" "text", "p_member" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_remaining integer;
BEGIN
  -- Serialize completions per job: the row lock makes "who saw zero" unique.
  PERFORM 1 FROM public.import_jobs WHERE id = p_job_id FOR UPDATE;
  UPDATE public.import_job_waves
     SET status = 'done', updated_at = now()
   WHERE job_id = p_job_id AND wave = p_wave AND member = p_member;
  SELECT count(*) INTO v_remaining
    FROM public.import_job_waves
   WHERE job_id = p_job_id AND wave = p_wave AND status <> 'done';
  RETURN v_remaining;
END;
$$;


ALTER FUNCTION "public"."import_wave_member_done"("p_job_id" "uuid", "p_wave" "text", "p_member" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_wave_register"("p_job_id" "uuid", "p_wave" "text", "p_members" "text"[]) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_n integer;
BEGIN
  PERFORM 1 FROM public.import_jobs WHERE id = p_job_id FOR UPDATE;
  INSERT INTO public.import_job_waves (job_id, wave, member, status, updated_at)
  SELECT p_job_id, p_wave, m, 'pending', now() FROM unnest(p_members) AS m
  ON CONFLICT (job_id, wave, member) DO UPDATE SET status = 'pending', updated_at = now();
  SELECT count(*) INTO v_n FROM public.import_job_waves WHERE job_id = p_job_id AND wave = p_wave AND status = 'pending';
  RETURN v_n;
END;
$$;


ALTER FUNCTION "public"."import_wave_register"("p_job_id" "uuid", "p_wave" "text", "p_members" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_blog_post_views"("post_slug" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  UPDATE public.blog_posts
  SET view_count = view_count + 1
  WHERE slug = post_slug AND status = 'published';
END;
$$;


ALTER FUNCTION "public"."increment_blog_post_views"("post_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
    false
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_example_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND metadata ? 'example');
$$;


ALTER FUNCTION "public"."is_example_project"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_example_project"("p_project_id" "uuid") IS 'AJ.6: true for an account''s example project (projects.metadata.example). Only ensure_example_project sets the mark.';



CREATE OR REPLACE FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text" DEFAULT 'viewer'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.project_role_rank(p_min_role) > 0
     AND public.project_role_rank(public.project_role(p_project_id, auth.uid())) >= public.project_role_rank(p_min_role)
$$;


ALTER FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text") IS 'V3 7.0: true when the caller holds at least p_min_role on the project (the owner implicitly). SECURITY DEFINER so policies — the roster''s own included — can call it without recursion.';



CREATE OR REPLACE FUNCTION "public"."jsonb_map_keys"("p_map" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE
           WHEN p_map IS NULL OR jsonb_typeof(p_map) <> 'object' THEN '[]'::jsonb
           ELSE COALESCE((SELECT jsonb_agg(k) FROM jsonb_object_keys(p_map) k), '[]'::jsonb)
         END;
$$;


ALTER FUNCTION "public"."jsonb_map_keys"("p_map" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."jsonb_map_keys"("p_map" "jsonb") IS 'Keys of a jsonb object as a jsonb array; [] for null or any non-object. Guards jsonb_object_keys, which raises.';



CREATE OR REPLACE FUNCTION "public"."mark_tests_stale_on_artifact_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.content_hash IS DISTINCT FROM NEW.content_hash
     AND NEW.kind = 'source' THEN
    UPDATE test_cases
    SET stale = true,
        staleness_reason = 'Source code changed',
        updated_at = now()
    WHERE NEW.id = ANY(source_artifact_ids)
      AND stale = false;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."mark_tests_stale_on_artifact_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_tests_stale_on_mapping_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  req_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    req_id := NEW.requirement_id;
  ELSIF TG_OP = 'DELETE' THEN
    req_id := OLD.requirement_id;
  END IF;

  IF req_id IS NOT NULL THEN
    UPDATE test_cases
    SET stale = true,
        staleness_reason = 'Architecture mappings changed',
        updated_at = now()
    WHERE requirement_id = req_id
      AND stale = false;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."mark_tests_stale_on_mapping_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_tests_stale_on_requirement_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  old_texts jsonb;
  new_texts jsonb;
BEGIN
  old_texts := (
    SELECT coalesce(jsonb_agg(elem - 'testId' - 'met' - 'provenance' - 'evidenceStale' ORDER BY idx), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(OLD.acceptance_criteria, '[]'::jsonb)) WITH ORDINALITY AS t(elem, idx)
  );
  new_texts := (
    SELECT coalesce(jsonb_agg(elem - 'testId' - 'met' - 'provenance' - 'evidenceStale' ORDER BY idx), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(NEW.acceptance_criteria, '[]'::jsonb)) WITH ORDINALITY AS t(elem, idx)
  );

  IF old_texts IS DISTINCT FROM new_texts
     OR OLD.description IS DISTINCT FROM NEW.description THEN
    UPDATE test_cases
    SET stale = true,
        staleness_reason = CASE
          WHEN old_texts IS DISTINCT FROM new_texts
            THEN 'Acceptance criteria changed'
          ELSE 'Requirement description changed'
        END,
        updated_at = now()
    WHERE requirement_id = NEW.id
      AND stale = false;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."mark_tests_stale_on_requirement_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p_mark IS NULL
      OR (
        p_project_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
          EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.owner_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.project_members m
                      WHERE m.project_id = p_project_id AND m.user_id = auth.uid() AND p_mark = ANY (m.clearance))
        )
      )
$$;


ALTER FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") IS 'V3 7.3: the one classification rule — unmarked, or the caller owns the project, or their seat''s clearance holds the exact mark. The restrictive item policies and classification_summary call it; the MCP boundary mirrors it.';



CREATE OR REPLACE FUNCTION "public"."mcp_api_keys_revocation_is_final"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    -- a second revoke keeps the first time; nothing brings a key back
    NEW.revoked_at := OLD.revoked_at;
    NEW.expires_at := OLD.expires_at;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.key_hash IS DISTINCT FROM OLD.key_hash THEN
    RAISE EXCEPTION 'An agent key keeps its owner and its secret; mint a new key instead.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."mcp_api_keys_revocation_is_final"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_credential_horizons"() RETURNS TABLE("delegate" "text", "kind" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 'key:' || k.id::text AS delegate, 'key'::text AS kind, k.expires_at
    FROM public.mcp_api_keys k
   WHERE k.user_id = auth.uid() AND k.revoked_at IS NULL
  UNION ALL
  SELECT 'oauth:' || t.user_id::text || ':' || t.client_id AS delegate, 'oauth'::text AS kind,
         max(COALESCE(t.refresh_expires_at, t.expires_at)) AS expires_at
    FROM public.mcp_oauth_tokens t
   WHERE t.user_id = auth.uid() AND t.revoked_at IS NULL
   GROUP BY t.user_id, t.client_id;
$$;


ALTER FUNCTION "public"."mcp_credential_horizons"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mcp_credential_horizons"() IS 'v3n: the calling user''s own credentials (key:<id> | oauth:<user>:<client>) and when each stops working — the app warns beside a hold before an agent loses access mid-task. Self-scoped; no client SELECT on the token tables.';



CREATE OR REPLACE FUNCTION "public"."mcp_rate_take"("p_holder" "text", "p_user_id" "uuid", "p_capacity" integer, "p_per_second" numeric) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_step interval;
  v_tolerance interval;
  v_tat timestamptz;
BEGIN
  IF p_holder IS NULL OR p_user_id IS NULL OR p_capacity IS NULL OR p_capacity < 1
     OR p_per_second IS NULL OR p_per_second <= 0 THEN
    RAISE EXCEPTION 'mcp_rate_take: a holder, its user, a capacity of at least 1 and a positive rate are required'
      USING ERRCODE = '22023';
  END IF;
  v_step := make_interval(secs => (1 / p_per_second)::double precision);
  v_tolerance := v_step * (p_capacity - 1);

  INSERT INTO public.mcp_rate_buckets AS b (holder, user_id, tat)
  VALUES (p_holder, p_user_id, v_now + v_step)
  ON CONFLICT (holder) DO UPDATE
     SET tat = greatest(b.tat, v_now) + v_step
   WHERE greatest(b.tat, v_now) - v_now <= v_tolerance
  RETURNING b.tat INTO v_tat;
  IF FOUND THEN
    RETURN 0;
  END IF;

  SELECT b.tat INTO v_tat FROM public.mcp_rate_buckets b WHERE b.holder = p_holder;
  RETURN greatest(1, ceil(extract(epoch FROM (v_tat - v_now - v_tolerance)))::integer);
END;
$$;


ALTER FUNCTION "public"."mcp_rate_take"("p_holder" "text", "p_user_id" "uuid", "p_capacity" integer, "p_per_second" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mcp_rate_take"("p_holder" "text", "p_user_id" "uuid", "p_capacity" integer, "p_per_second" numeric) IS 'V3 AE.5: take one call from a credential''s bucket in mcp_rate_buckets. 0 lets it through; n > 0 is the whole seconds until the next call passes (Retry-After). Service role only; the MCP server calls it once per request after authentication.';



CREATE OR REPLACE FUNCTION "public"."member_project_ids"("p_min_role" "text" DEFAULT 'viewer'::"text") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT pr.id FROM public.projects pr WHERE pr.owner_id = auth.uid()
  UNION
  SELECT m.project_id FROM public.project_members m
   WHERE m.user_id = auth.uid()
     AND public.project_role_rank(p_min_role) > 0
     AND public.project_role_rank(m.role) >= public.project_role_rank(p_min_role)
     AND public.project_seats_carried(m.project_id)
$$;


ALTER FUNCTION "public"."member_project_ids"("p_min_role" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."member_project_ids"("p_min_role" "text") IS 'V3 7.0: every project the caller holds at least p_min_role on, owned or via the roster — the IN-subquery policies read this set once.';



CREATE OR REPLACE FUNCTION "public"."node_memory"("p_project_id" "uuid", "p_branch_id" "uuid", "p_node_id" "uuid", "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH lim AS (SELECT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100) AS n, 3 AS shown),
  pushes AS (
    SELECT s.commit_sha, s.completed_at
      FROM public.git_sync_log s
     WHERE s.branch_id = p_branch_id AND s.direction = 'push' AND s.status = 'success'
       AND s.commit_sha IS NOT NULL AND s.completed_at IS NOT NULL
  ),
  -- Item 27: only a proposal that names the node anywhere can touch it.
  mentioning AS MATERIALIZED (
    SELECT p.id, COALESCE(p.merged_at, p.reviewed_at, p.created_at) AS at, p.metadata, p.patches
      FROM public.ai_proposals p
     WHERE p.source_branch_id = p_branch_id
       AND p.status IN ('merged', 'partial')
       AND strpos(p.patches::text, p_node_id::text) > 0
  ),
  decisions AS (
    SELECT m.id, m.at, m.metadata, m.patches
      FROM mentioning m
     WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(m.patches, '[]'::jsonb)) x
          WHERE COALESCE(x->>'status', '') <> 'rejected'
            AND public.node_memory_touches(x->'patch', p_node_id::text))
     ORDER BY m.at DESC
     LIMIT (SELECT n FROM lim)
  ),
  -- Item 27: the same for a person's own patches.
  named AS MATERIALIZED (
    SELECT g.id, g.created_at, g.actor_id, g.summary, g.patch_type, g.payload
      FROM public.graph_patches g
     WHERE g.branch_id = p_branch_id
       AND g.actor_type = 'human'
       AND strpos(g.payload::text, p_node_id::text) > 0
  ),
  changes AS (
    SELECT g.id, g.created_at AS at, g.actor_id, g.summary, g.patch_type
      FROM named g
     WHERE public.node_memory_touches(g.payload, p_node_id::text)
       AND NOT public.node_memory_is_layout(g.payload)
     ORDER BY g.created_at DESC
     LIMIT (SELECT n FROM lim)
  ),
  handoffs AS (
    SELECT c.id, COALESCE((c.meta->'handoff'->>'at')::timestamptz, c.released_at) AS at,
           c.holder_label, c.level, c.released_reason, c.proposal_id, c.meta
      FROM public.agent_checkouts c
     WHERE c.project_id = p_project_id
       AND c.released_at IS NOT NULL
       AND jsonb_typeof(c.meta->'handoff'->'note') = 'string'
       AND (c.node_id = p_node_id
         OR c.task_item_id IN (SELECT t.id FROM public.task_items t WHERE t.project_id = p_project_id AND t.node_id = p_node_id))
     ORDER BY 2 DESC
     LIMIT (SELECT n FROM lim)
  ),
  spec AS (
    SELECT s.id FROM public.project_specifications s
     WHERE s.project_id = p_project_id
     ORDER BY s.created_at DESC
     LIMIT 1
  ),
  proven AS (
    SELECT r.requirement_id, c.value AS criterion
      FROM public.specification_mappings m
      JOIN public.specification_requirements r ON r.id = m.requirement_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.acceptance_criteria, '[]'::jsonb)) c
     WHERE m.specification_id = (SELECT id FROM spec)
       AND m.node_id = p_node_id
       AND r.archived_at IS NULL
       AND (c.value->>'met')::boolean IS TRUE
       AND jsonb_typeof(c.value->'provenance') = 'object'
       AND (c.value->'provenance' ? 'commitSha' OR c.value->'provenance'->>'source' = 'test')
     ORDER BY c.value->'provenance'->>'at' DESC NULLS LAST
     LIMIT (SELECT n FROM lim)
  ),
  -- Item 27: a decision's reasons on the node, each once, in the proposal's
  -- order: the first three, and how many there were.
  reasons AS (
    SELECT d.id,
           COALESCE(jsonb_agg(u.text ORDER BY u.first) FILTER (WHERE u.rank <= (SELECT shown FROM lim)), '[]'::jsonb) AS shown,
           count(u.text) AS total
      FROM decisions d
      LEFT JOIN LATERAL (
        SELECT e.text, e.first, row_number() OVER (ORDER BY e.first) AS rank
          FROM (
            SELECT x.value->>'explanation' AS text, min(x.ord) AS first
              FROM jsonb_array_elements(d.patches) WITH ORDINALITY AS x(value, ord)
             WHERE COALESCE(x.value->>'status', '') <> 'rejected'
               AND public.node_memory_touches(x.value->'patch', p_node_id::text)
               AND COALESCE(x.value->>'explanation', '') NOT IN ('', 'No explanation provided')
             GROUP BY 1
          ) e
      ) u ON true
     GROUP BY d.id
  )
  SELECT jsonb_build_object(
    'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'proposalId', d.id,
        'at', d.at,
        'who', COALESCE(d.metadata->>'credentialLabel', d.metadata->>'externalAgent',
                        CASE d.metadata->>'source' WHEN 'repo-import' THEN 'the import' ELSE NULL END),
        'explanations', r.shown,
        'explanationCount', r.total,
        'intents', COALESCE(d.metadata->'intents', '[]'::jsonb),
        'commit', (SELECT u.commit_sha FROM pushes u WHERE u.completed_at >= d.at ORDER BY u.completed_at LIMIT 1)
      ) ORDER BY d.at DESC) FROM decisions d JOIN reasons r ON r.id = d.id), '[]'::jsonb),
    'changes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'patchId', g.id,
        'at', g.at,
        'actorId', g.actor_id,
        'summary', g.summary,
        'type', g.patch_type,
        'commit', (SELECT u.commit_sha FROM pushes u WHERE u.completed_at >= g.at ORDER BY u.completed_at LIMIT 1)
      ) ORDER BY g.at DESC) FROM changes g), '[]'::jsonb),
    'handoffs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'checkoutId', h.id,
        'at', h.at,
        'who', h.holder_label,
        'level', h.level,
        'reason', h.released_reason,
        'note', h.meta->'handoff'->>'note',
        'proposalId', h.proposal_id,
        'commit', h.meta->>'commitSha'
      ) ORDER BY h.at DESC) FROM handoffs h), '[]'::jsonb),
    'proven', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'requirementId', v.requirement_id,
        'text', v.criterion->>'text',
        'testCaseId', v.criterion->'provenance'->>'testCaseId',
        'source', v.criterion->'provenance'->>'source',
        'at', v.criterion->'provenance'->>'at',
        'commit', v.criterion->'provenance'->>'commitSha',
        -- truthy as the app and the functions read it: report_test_results
        -- writes an object (at, reason), older rows a reason or a boolean
        'evidenceStale', CASE jsonb_typeof(v.criterion->'evidenceStale')
                           WHEN 'object' THEN true
                           WHEN 'array' THEN true
                           WHEN 'string' THEN v.criterion->>'evidenceStale' <> ''
                           WHEN 'boolean' THEN (v.criterion->>'evidenceStale')::boolean
                           WHEN 'number' THEN (v.criterion->>'evidenceStale')::numeric <> 0
                           ELSE false
                         END
      )) FROM proven v), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."node_memory"("p_project_id" "uuid", "p_branch_id" "uuid", "p_node_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."node_memory"("p_project_id" "uuid", "p_branch_id" "uuid", "p_node_id" "uuid", "p_limit" integer) IS 'AA.7 and item 27: a node''s memory (decisions, a person''s changes, hand-offs, criteria proven at a commit), the newest of each kind, each with who and which commit; a decision carries its first three reasons and how many there were. Row security applies.';



CREATE OR REPLACE FUNCTION "public"."node_memory_is_layout"("p_patch" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT p_patch->>'type' = 'update_node'
     AND jsonb_typeof(p_patch->'payload'->'changes') = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_patch->'payload'->'changes') k
        WHERE k NOT IN ('position', 'width', 'height', 'collapsed', 'expanded', 'zIndex', 'metadata')
     )
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_object_keys(
         CASE WHEN jsonb_typeof(p_patch->'payload'->'changes'->'metadata') = 'object'
              THEN p_patch->'payload'->'changes'->'metadata' ELSE '{}'::jsonb END) k
        WHERE k NOT IN ('position', 'width', 'height', 'collapsed', 'expanded', 'zIndex')
     );
$$;


ALTER FUNCTION "public"."node_memory_is_layout"("p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."node_memory_touches"("p_patch" "jsonb", "p_node" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
       p_patch->'payload'->>'id' = p_node
    OR p_patch->'payload'->>'nodeId' = p_node
    OR p_patch->'payload'->>'source' = p_node
    OR p_patch->'payload'->>'target' = p_node
    OR p_patch->'payload'->>'parentId' = p_node,
    false);
$$;


ALTER FUNCTION "public"."node_memory_touches"("p_patch" "jsonb", "p_node" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT sc IS NULL
    OR jsonb_typeof(sc) <> 'array'
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(sc) c
      WHERE jsonb_typeof(c) = 'string'
        AND c #>> '{}' NOT IN ('request_response','event','queue','data_read','data_write',
                               'data_sync','file_transfer','auth','telemetry','ipc','dependency')
    );
$$;


ALTER FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_test_case_status_change_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_met boolean;
  v_req record;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'passed' THEN
    v_new_met := true;
  ELSIF NEW.status = 'failed' THEN
    v_new_met := false;
  ELSE
    RETURN NEW;
  END IF;

  FOR v_req IN
    SELECT sr.id
      FROM public.specification_requirements sr
     WHERE sr.acceptance_criteria @> jsonb_build_array(jsonb_build_object('testId', NEW.id::text))
     ORDER BY sr.id
  LOOP
    PERFORM public.apply_criteria_ops(
      v_req.id,
      jsonb_build_array(jsonb_build_object(
        'op', 'set_met',
        'test_id', NEW.id::text,
        'value', v_new_met)));
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_test_case_status_change_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."outcome_step_maps_terminal_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_candidate uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_candidate := OLD.candidate_id;
  ELSE
    v_candidate := NEW.candidate_id;
  END IF;

  SELECT status INTO v_status
    FROM public.requirement_candidates
   WHERE id = v_candidate;

  -- The parent is gone: a cascade is tearing this down, not a user remapping.
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION
      'This outcome is % — decided outcomes keep the steps they were filed on. Create a new outcome to map different steps.',
      v_status
      USING ERRCODE = '23514';
  END IF;

  -- An UPDATE that moves the row to a DIFFERENT candidate has to satisfy both
  -- ends, or a decided outcome could be remapped by pushing a map onto it.
  IF TG_OP = 'UPDATE' AND OLD.candidate_id IS DISTINCT FROM NEW.candidate_id THEN
    SELECT status INTO v_status
      FROM public.requirement_candidates
     WHERE id = OLD.candidate_id;
    IF FOUND AND v_status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION
        'The outcome this map belongs to is % — decided outcomes keep the steps they were filed on.',
        v_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


ALTER FUNCTION "public"."outcome_step_maps_terminal_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."outcome_step_maps_terminal_guard"() IS 'Decided outcomes keep the steps they were filed on. Refuses insert/update/delete of a step map whose owning candidate is not pending, in every lane (app, MCP, direct REST). Never blocks a cascade: an absent candidate means the parent is being deleted.';



CREATE OR REPLACE FUNCTION "public"."patch_changed_nodes"("p" "jsonb") RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_type text := p->>'type';
  v_body jsonb := COALESCE(p->'payload', '{}'::jsonb);
  v_changes jsonb := v_body->'changes';
  v_ids text[] := ARRAY[]::text[];
  v_art text;
BEGIN
  IF v_type = 'update_node' AND jsonb_typeof(v_changes) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_object_keys(v_changes) k
        WHERE k NOT IN ('position', 'size', 'width', 'height', 'style', 'visual', 'collapsed')
          AND NOT (k = 'metadata' AND jsonb_typeof(v_changes->'metadata') = 'object'
                   AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_changes->'metadata') m
                                    WHERE m NOT IN ('position', 'size', 'width', 'height', 'style', 'visual', 'collapsed')))
     ) THEN
    RETURN ARRAY[]::text[];
  END IF;

  IF v_type IN ('add_node', 'update_node', 'remove_node', 'delete_node') THEN v_ids := v_ids || (v_body->>'id'); END IF;
  IF v_type = 'add_edge' THEN v_ids := v_ids || (v_body->>'source') || (v_body->>'target'); END IF;
  IF v_type = 'connect_ports' THEN v_ids := v_ids || (v_body->>'sourceNodeId') || (v_body->>'targetNodeId'); END IF;
  v_ids := v_ids || (v_body->>'nodeId');
  IF v_type IN ('update_artifact', 'remove_artifact', 'delete_artifact') AND (v_body->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT node_id::text INTO v_art FROM public.artifacts WHERE id = (v_body->>'id')::uuid;
    v_ids := v_ids || v_art;
  END IF;
  RETURN ARRAY(SELECT DISTINCT x FROM unnest(v_ids) x
                WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
END;
$_$;


ALTER FUNCTION "public"."patch_changed_nodes"("p" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."plan_allows"("p_feature" "text", "p_project_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_subject uuid;
  v_min text;
  v_rank int;
  v_need int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.deployment_settings WHERE id AND mode = 'self-hosted') THEN
    RETURN true;
  END IF;
  IF v_uid IS NULL THEN
    RETURN true;
  END IF;
  v_min := CASE p_feature
    WHEN 'unlimited_projects' THEN 'indie'
    WHEN 'workflow_space' THEN 'indie'
    WHEN 'priority_board' THEN 'indie'
    WHEN 'team_lanes' THEN 'team'
    WHEN 'classification' THEN 'government'
    ELSE NULL
  END;
  IF v_min IS NULL THEN
    RETURN false;
  END IF;
  IF p_project_id IS NOT NULL THEN
    -- a client may call this: it answers only for a project the caller is on
    IF NOT public.is_project_member(p_project_id, 'viewer') THEN
      RETURN false;
    END IF;
    SELECT owner_id INTO v_subject FROM public.projects WHERE id = p_project_id;
  END IF;
  v_subject := coalesce(v_subject, v_uid);
  v_rank := CASE public.account_plan_tier(v_subject)
    WHEN 'community' THEN 0 WHEN 'indie' THEN 1 WHEN 'team' THEN 2 WHEN 'enterprise' THEN 3 WHEN 'government' THEN 4 ELSE 0 END;
  v_need := CASE v_min
    WHEN 'community' THEN 0 WHEN 'indie' THEN 1 WHEN 'team' THEN 2 WHEN 'enterprise' THEN 3 WHEN 'government' THEN 4 ELSE 5 END;
  RETURN v_rank >= v_need;
END;
$$;


ALTER FUNCTION "public"."plan_allows"("p_feature" "text", "p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."plan_allows"("p_feature" "text", "p_project_id" "uuid") IS 'Q: does the plan carry this feature? With a project the caller is on, its owner''s plan (any other project: false); without, the caller''s. Self-hosted and server callers (no auth.uid()) pass; an unknown feature is refused. Minimums mirror _shared/feature-rules.ts.';



CREATE OR REPLACE FUNCTION "public"."plan_guard_mark"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sets boolean;
  v_project uuid;
BEGIN
  IF TG_TABLE_NAME = 'project_members' THEN
    v_sets := coalesce(array_length(NEW.clearance, 1), 0) > 0
      AND (TG_OP = 'INSERT' OR NEW.clearance IS DISTINCT FROM OLD.clearance);
  ELSE
    v_sets := NEW.mark IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW.mark IS DISTINCT FROM OLD.mark);
  END IF;
  IF NOT v_sets THEN
    RETURN NEW;
  END IF;
  -- the Government build's alone (audit 2026-09-27)
  IF coalesce(current_setting('nodespec.edition', true), '') <> 'government' THEN
    RAISE EXCEPTION 'Classification marks are part of NodeSpec for Government only; this database is not a Government install.'
      USING ERRCODE = '42501', HINT = 'Clearing a mark is allowed everywhere.';
  END IF;
  -- the project the row belongs to: its owner's plan decides
  IF TG_TABLE_NAME = 'specification_requirements' THEN
    SELECT ps.project_id INTO v_project FROM public.project_specifications ps WHERE ps.id = NEW.specification_id;
  ELSIF TG_TABLE_NAME = 'test_cases' THEN
    SELECT ps.project_id INTO v_project
      FROM public.specification_requirements r JOIN public.project_specifications ps ON ps.id = r.specification_id
     WHERE r.id = NEW.requirement_id;
  ELSE
    v_project := NEW.project_id;
  END IF;
  IF NOT public.plan_allows('classification', v_project) THEN
    RAISE EXCEPTION 'Classification marks are available on Government.'
      USING ERRCODE = '42501', HINT = 'Clearing a mark is allowed on every plan.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."plan_guard_mark"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."plan_guard_mark"() IS 'Audit 2026-09-27: a mark or a clearance is set only in a Government install (nodespec.edition = government, set on the database by the Government build), and there only on the Government plan. Clearing is allowed everywhere.';



CREATE OR REPLACE FUNCTION "public"."project_constraints_plan_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workflow_id IS NULL AND OLD.workflow_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF public.plan_allows('workflow_space', NEW.project_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Constraints are available on Indie and above.'
    USING ERRCODE = '42501', HINT = 'Requirements, task documents, readiness and tests work on every plan without them; constraints made on a paid plan come back on Indie.';
END;
$$;


ALTER FUNCTION "public"."project_constraints_plan_scope"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."project_constraints_plan_scope"() IS 'AC: below Indie no constraint is written (a workflow deleted under one may still clear its workflow_id). The owner''s plan decides (plan_allows).';



CREATE OR REPLACE FUNCTION "public"."project_constraints_scope_shape"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.workflow_id IS NOT NULL THEN
    NEW.scope_kind := 'workflow';
    NEW.scope_value := NULL;
  ELSIF NEW.scope_kind = 'workflow' THEN
    NEW.scope_kind := 'project';
    NEW.scope_value := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."project_constraints_scope_shape"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_delete_step"("p_project_id" "uuid", "p_limit" integer DEFAULT 20000, "p_budget_ms" integer DEFAULT 2500) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '55s'
    AS $_$
DECLARE
  v_owner uuid;
  v_meta jsonb;
  v_t0 timestamptz := clock_timestamp();
  v_deleted integer := 0;
  v_n integer;
  v_batch integer;
  v_step integer;
  v_ms integer;
  v_t1 timestamptz;
  v_tbl_t0 timestamptz;
  v_tbl_rows integer;
  v_tbl_ms integer;
  v_width numeric;
  v_last text := NULL;
  v_parent text;
  r record;
  v_over boolean := false;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_delete_step: a project id is required';
  END IF;

  SELECT owner_id, COALESCE(metadata, '{}'::jsonb) INTO v_owner, v_meta
    FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    -- Already gone (a retry after the last step landed): nothing to do.
    RETURN jsonb_build_object('done', true, 'deleted', 0, 'elapsedMs', 0, 'project', 'gone');
  END IF;

  -- Owner or the service role. auth.uid() is NULL for service-role calls.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> v_owner) THEN
    RAISE EXCEPTION 'project_delete_step: only the project owner can delete project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  -- First step: mark the project and stop its live import chains. The
  -- mark is what lets a list hide the project and a later load resume.
  IF COALESCE(v_meta->>'deleting', '') <> 'true' THEN
    v_tbl_t0 := clock_timestamp();
    UPDATE public.projects
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('deleting', true, 'deletingAt', now()),
           updated_at = now()
     WHERE id = p_project_id;
    IF to_regclass('public.import_jobs') IS NOT NULL THEN
      UPDATE public.import_jobs
         SET status = 'cancelled', error = COALESCE(error, 'project deleted'), updated_at = now()
       WHERE project_id = p_project_id
         AND status IN ('pending', 'running', 'awaiting_review', 'promoting');
    END IF;
    RAISE LOG 'project_delete_step % mark: ms=%',
      p_project_id, (extract(epoch FROM clock_timestamp() - v_tbl_t0) * 1000)::integer;
  END IF;

  -- Heavy tables, leaves first. Each row: table, the column that reaches
  -- the project, and how ('branch' = via branches.project_id, 'job' = via
  -- import_jobs.project_id, 'project' = directly). Missing tables (an
  -- edition without a lane) are skipped.
  --
  -- ai_runs precedes BOTH ai_proposals (proposal_id) and graph_snapshots
  -- (input_snapshot_id): each is ON DELETE NO ACTION, so a run that still
  -- exists when its parent goes aborts the statement.
  --
  -- The V3 tables: couplings go before the candidates, requirements and
  -- task items they join. outcome_step_maps is not listed: its terminal
  -- rule refuses to delete the map of a decided outcome while the outcome
  -- stands, so the maps go with their candidates, whose drain removes the
  -- parent first. project_constraints go before workflows: workflow_id is
  -- ON DELETE SET NULL, so the other order would rewrite every
  -- workflow-scoped constraint to project scope just before deleting it.
  FOR r IN
    SELECT * FROM (VALUES
      ('repo_index_edges',          'branch_id',  'branch',  1),
      ('node_dependencies',         'branch_id',  'branch',  2),
      ('repo_index_freshness',      'branch_id',  'branch',  3),
      ('repo_index_node_summaries', 'branch_id',  'branch',  4),
      ('repo_index',                'branch_id',  'branch',  5),
      ('couplings',                 'branch_id',  'branch',  6),
      ('requirement_candidates',    'branch_id',  'branch',  7),
      ('import_job_edges',          'job_id',     'job',     8),
      ('import_job_group_edges',    'job_id',     'job',     9),
      ('import_job_rank',           'job_id',     'job',    10),
      ('import_job_waves',          'job_id',     'job',    11),
      ('import_job_groups',         'job_id',     'job',    12),
      ('import_job_files',          'job_id',     'job',    13),
      ('import_jobs',               'project_id', 'project', 14),
      ('ai_runs',                   'project_id', 'project', 15),
      ('ai_proposals',              'source_branch_id', 'branch', 16),
      ('graph_patches',             'branch_id',  'branch', 17),
      ('graph_snapshots',           'branch_id',  'branch', 18),
      ('artifacts',                 'project_id', 'project', 19),
      ('git_change_events',         'project_id', 'project', 20),
      ('task_items',                'project_id', 'project', 21),
      ('project_constraints',       'project_id', 'project', 22),
      ('workflows',                 'project_id', 'project', 23)
    ) AS t(tbl, col, via, ord)
    ORDER BY ord
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN CONTINUE; END IF;
    v_parent := CASE r.via
      WHEN 'branch'  THEN 'SELECT id FROM public.branches WHERE project_id = $1'
      WHEN 'job'     THEN 'SELECT id FROM public.import_jobs WHERE project_id = $1'
      ELSE 'SELECT $1'
    END;

    -- Batch size in BYTES, not rows. Total relation size over live tuples
    -- counts TOAST and indexes, which is where a wide row's cost actually
    -- lives: graph_snapshots is ~437 kB a row against import_job_edges'
    -- 171 B. Aim at ~8 MB, cap at 500 rows, floor at 10. A table with no
    -- statistics (reltuples <= 0) is assumed narrow; it is either empty,
    -- and exits on the first batch, or it gets the cap.
    SELECT CASE
             WHEN c.reltuples > 0
               THEN GREATEST(pg_total_relation_size(c.oid)::numeric / c.reltuples, 1)
             ELSE 1024
           END
      INTO v_width
      FROM pg_class c
     WHERE c.oid = to_regclass('public.' || r.tbl);
    v_step := GREATEST(LEAST(((8 * 1024 * 1024)::numeric / COALESCE(v_width, 1024))::integer, 500), 10);

    v_tbl_t0 := clock_timestamp();
    v_tbl_rows := 0;
    LOOP
      v_batch := LEAST(v_step, p_limit - v_deleted);
      EXIT WHEN v_batch <= 0;
      v_t1 := clock_timestamp();
      EXECUTE format(
        'DELETE FROM public.%1$I t WHERE t.ctid = ANY (ARRAY(SELECT ctid FROM public.%1$I WHERE %2$I IN (%3$s) LIMIT %4$s))',
        r.tbl, r.col, v_parent, v_batch)
      USING p_project_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_deleted := v_deleted + v_n;
      v_tbl_rows := v_tbl_rows + v_n;
      IF v_n > 0 THEN v_last := r.tbl; END IF;
      EXIT WHEN v_n < v_batch;
      -- Only ever shrink. Growth is what let a batch reach 5000 rows on a
      -- wide table and consume the whole budget in one statement.
      v_ms := (extract(epoch FROM clock_timestamp() - v_t1) * 1000)::integer;
      IF v_ms > 1000 THEN v_step := GREATEST(v_step / 4, 10); END IF;
      IF clock_timestamp() > v_t0 + make_interval(secs => GREATEST(p_budget_ms, 100) / 1000.0) THEN
        v_over := true;
        EXIT;
      END IF;
    END LOOP;

    -- Non-transactional: these lines survive a timeout that rolls the
    -- transaction back, which is the only way to see inside a failed call.
    -- Logged when the table cost something or gave something up, so a
    -- routine delete does not write 21 lines.
    v_tbl_ms := (extract(epoch FROM clock_timestamp() - v_tbl_t0) * 1000)::integer;
    IF v_tbl_ms >= 50 OR v_tbl_rows > 0 THEN
      RAISE LOG 'project_delete_step %: table=% rows=% ms=% batch=% cumulative=%',
        p_project_id, r.tbl, v_tbl_rows, v_tbl_ms, v_step, v_deleted;
    END IF;

    IF v_over OR v_deleted >= p_limit THEN
      RAISE LOG 'project_delete_step % yield: table=% deleted=% elapsedMs=%',
        p_project_id, v_last, v_deleted,
        (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer;
      RETURN jsonb_build_object(
        'done', false, 'deleted', v_deleted, 'table', v_last,
        'elapsedMs', (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer);
    END IF;
  END LOOP;

  -- Every heavy table is drained: the project row goes, and what remains
  -- (small tables) cascades exactly as it always did. This single statement
  -- is the one unbounded piece left, so it is timed on its own.
  v_tbl_t0 := clock_timestamp();
  DELETE FROM public.projects WHERE id = p_project_id;
  RAISE LOG 'project_delete_step % final cascade: ms=% totalMs=% deleted=%',
    p_project_id,
    (extract(epoch FROM clock_timestamp() - v_tbl_t0) * 1000)::integer,
    (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer,
    v_deleted;

  RETURN jsonb_build_object(
    'done', true, 'deleted', v_deleted, 'table', v_last,
    'elapsedMs', (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer);
END;
$_$;


ALTER FUNCTION "public"."project_delete_step"("p_project_id" "uuid", "p_limit" integer, "p_budget_ms" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."project_delete_step"("p_project_id" "uuid", "p_limit" integer, "p_budget_ms" integer) IS 'Deletes one bounded slice of a project''s heavy child rows (repo index, import staging, runs, proposals, snapshots, V3 ideation tables), then the project row once they are drained. Batches are sized in bytes; the call carries its own statement_timeout because the browser role''s 8 s is below what an import-touched project costs. Logs per table at LOG level. Call until done. Owner or service_role.';



CREATE OR REPLACE FUNCTION "public"."project_owner_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND auth.uid() IS NOT NULL
     AND auth.uid() <> OLD.owner_id THEN
    RAISE EXCEPTION 'Only the project owner can transfer ownership' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."project_owner_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_plan_tier"("p_project_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.deployment_settings WHERE id AND mode = 'self-hosted') THEN
    RETURN NULL;
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_project_member(p_project_id, 'viewer') THEN
    RETURN NULL;
  END IF;
  SELECT owner_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.account_plan_tier(v_owner);
END;
$$;


ALTER FUNCTION "public"."project_plan_tier"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."project_plan_tier"("p_project_id" "uuid") IS 'Decision 1: the plan a project runs on (its owner''s), for its members; NULL for anyone else and on self-hosted (the licence decides there). The app reads it at project open; plan_allows(feature, project) reads the same owner.';



CREATE OR REPLACE FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN p_user_id IS NULL OR p_project_id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.owner_id = p_user_id) THEN 'owner'
    ELSE (SELECT m.role FROM public.project_members m
           WHERE m.project_id = p_project_id AND m.user_id = p_user_id
             AND public.project_seats_carried(p_project_id))
  END
$$;


ALTER FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_role_rank"("p_role" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 4
    WHEN 'maintainer' THEN 3
    WHEN 'contributor' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END
$$;


ALTER FUNCTION "public"."project_role_rank"("p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_roster"("p_project_id" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "role" "text", "is_you" boolean, "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT r.user_id, r.email, r.role, (r.user_id = auth.uid()) AS is_you, r.created_at
    FROM (
      SELECT pr.owner_id AS user_id, u.email::text AS email, 'owner'::text AS role, pr.created_at
        FROM public.projects pr JOIN auth.users u ON u.id = pr.owner_id
       WHERE pr.id = p_project_id
      UNION ALL
      SELECT m.user_id, u.email::text, m.role, m.created_at
        FROM public.project_members m JOIN auth.users u ON u.id = m.user_id
       WHERE m.project_id = p_project_id
    ) r
   WHERE public.is_project_member(p_project_id, 'viewer')
   ORDER BY public.project_role_rank(r.role) DESC, r.created_at, r.email
$$;


ALTER FUNCTION "public"."project_roster"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."project_roster"("p_project_id" "uuid") IS 'AE.4: the owner and every seat with role, email and is_you, for a member of the project; nobody else reads a row.';



CREATE OR REPLACE FUNCTION "public"."project_seats_carried"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.deployment_settings WHERE id AND mode = 'self-hosted')
      OR EXISTS (
           SELECT 1 FROM public.projects pr
            WHERE pr.id = p_project_id
              AND public.account_plan_tier(pr.owner_id) IN ('team', 'enterprise', 'government'))
$$;


ALTER FUNCTION "public"."project_seats_carried"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."project_seats_carried"("p_project_id" "uuid") IS 'V3 decision 1: a seat reaches a project only while its owner''s plan carries seats (team_lanes, Team and above; the licence when self-hosted). Read inside project_role and member_project_ids.';



CREATE OR REPLACE FUNCTION "public"."project_specifications_constraints_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.constraints_from_spec_json(NEW.project_id, NEW.constraints);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."project_specifications_constraints_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."projects_example_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb) - 'example' - 'exampleTeam';
  ELSE
    NEW.metadata := (coalesce(NEW.metadata, '{}'::jsonb) - 'example' - 'exampleTeam')
      || jsonb_strip_nulls(jsonb_build_object('example', OLD.metadata->'example', 'exampleTeam', OLD.metadata->'exampleTeam'));
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."projects_example_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."projects_plan_cap"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL OR public.plan_allows('unlimited_projects') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nodespec_project_cap:' || NEW.owner_id::text));
  SELECT count(*) INTO v_count FROM public.projects WHERE owner_id = NEW.owner_id AND NOT (coalesce(metadata, '{}'::jsonb) ? 'example');
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'Free accounts include 2 projects and this account already has %.', v_count
      USING ERRCODE = '42501', HINT = 'Delete a project you no longer need, or upgrade to Indie for unlimited projects: https://nodespec.io/pricing';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."projects_plan_cap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_stripe_customer_on_signup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  _url text;
  _anon_key text;
  _edge_url text;
  _body jsonb;
  _request_id bigint;
  _error_detail text;
BEGIN
  -- Log that trigger fired
  BEGIN
    INSERT INTO public.subscription_audit_log (user_id, source, action, metadata)
    VALUES (NEW.id, 'provision_trigger', 'trigger_fired', jsonb_build_object(
      'user_email', COALESCE(NEW.email, ''),
      'user_created_at', NEW.created_at
    ));
  EXCEPTION WHEN OTHERS THEN
    -- If we can't log, continue anyway
    NULL;
  END;

  -- Get vault secrets
  SELECT decrypted_secret INTO _url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;

  SELECT decrypted_secret INTO _anon_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_anon_key'
    LIMIT 1;

  -- Check if secrets are available
  IF _url IS NULL OR _anon_key IS NULL THEN
    _error_detail := format('Vault secrets missing: supabase_url=%s, supabase_anon_key=%s',
      CASE WHEN _url IS NULL THEN 'NULL' ELSE 'OK' END,
      CASE WHEN _anon_key IS NULL THEN 'NULL' ELSE 'OK' END
    );

    RAISE WARNING '[provision_trigger] %', _error_detail;

    -- Log the failure
    BEGIN
      INSERT INTO public.subscription_audit_log (user_id, source, action, metadata)
      VALUES (NEW.id, 'provision_trigger', 'trigger_failed', jsonb_build_object(
        'error', 'vault_secrets_missing',
        'detail', _error_detail
      ));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN NEW;
  END IF;

  -- Build the request
  _edge_url := _url || '/functions/v1/create-free-customer';
  _body := jsonb_build_object(
    'trigger_source', 'auth_user_insert',
    'user_id', NEW.id::text,
    'user_email', COALESCE(NEW.email, '')
  );

  -- Make the pg_net HTTP request (correct API)
  BEGIN
    SELECT INTO _request_id net.http_post(
      url := _edge_url,
      body := _body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _anon_key,
        'apikey', _anon_key
      )
    );

    -- Log success
    BEGIN
      INSERT INTO public.subscription_audit_log (user_id, source, action, metadata)
      VALUES (NEW.id, 'provision_trigger', 'trigger_success', jsonb_build_object(
        'request_id', _request_id,
        'edge_url', _edge_url,
        'user_email', COALESCE(NEW.email, '')
      ));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RAISE NOTICE '[provision_trigger] Queued provisioning request % for user % (email: %)',
      _request_id, NEW.id, COALESCE(NEW.email, 'none');

  EXCEPTION WHEN OTHERS THEN
    -- Log the specific error
    _error_detail := format('pg_net call failed: %s (SQLSTATE: %s)', SQLERRM, SQLSTATE);

    RAISE WARNING '[provision_trigger] %', _error_detail;

    BEGIN
      INSERT INTO public.subscription_audit_log (user_id, source, action, metadata)
      VALUES (NEW.id, 'provision_trigger', 'trigger_failed', jsonb_build_object(
        'error', 'pgnet_call_failed',
        'detail', _error_detail,
        'sqlerrm', SQLERRM,
        'sqlstate', SQLSTATE
      ));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."provision_stripe_customer_on_signup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refuse_account_delete_with_seats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_names text;
BEGIN
  SELECT string_agg(format('"%s"', p.name), ', ' ORDER BY p.name) INTO v_names
    FROM public.projects p
   WHERE p.owner_id = OLD.id
     AND EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = p.id);
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'This account owns projects that teammates hold seats on: %. Hand each one over (Team, Make owner) or remove its seats, then delete the account.', v_names
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."refuse_account_delete_with_seats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."repo_index_backfill_material"("p_branch_id" "uuid", "p_node_id" "text" DEFAULT NULL::"text", "p_route_cap" integer DEFAULT 200, "p_schema_cap" integer DEFAULT 60, "p_test_cap" integer DEFAULT 40) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  WITH files AS (
    SELECT * FROM public.repo_index
     WHERE branch_id = p_branch_id
       AND node_id IS NOT NULL
       AND (p_node_id IS NULL OR node_id = p_node_id)
  ),
  routes AS (
    SELECT DISTINCT f.node_id, upper(COALESCE(r->>'method', 'GET')) AS method, r->>'route' AS route,
           r->>'framework' AS framework, f.path
      FROM files f, jsonb_array_elements(COALESCE(f.signals->'serverRoutes', '[]'::jsonb)) r
     WHERE COALESCE(r->>'route', '') <> ''
  ),
  routes_ranked AS (
    SELECT *, row_number() OVER (PARTITION BY node_id ORDER BY route, method, path) AS rn FROM routes
  ),
  schema_files AS (
    SELECT node_id, path, role, language, artifact_kind, centrality,
           row_number() OVER (PARTITION BY node_id ORDER BY centrality DESC, path) AS rn
      FROM files
     WHERE role IN ('schema', 'migration') OR artifact_kind = 'schema'
  ),
  test_files AS (
    SELECT node_id, path, indexed_at_sha, centrality, size,
           row_number() OVER (PARTITION BY node_id ORDER BY centrality DESC, size ASC, path) AS rn,
           count(*) OVER (PARTITION BY node_id) AS total
      FROM files
     WHERE role = 'test'
  )
  SELECT jsonb_build_object(
    'nodes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nodeId', n.node_id, 'fileCount', n.n) ORDER BY n.n DESC, n.node_id), '[]'::jsonb)
                FROM (SELECT node_id, count(*) AS n FROM files GROUP BY node_id) n),
    'routes', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'nodeId', node_id, 'method', method, 'route', route, 'framework', framework, 'path', path)
                 ORDER BY node_id, route, method), '[]'::jsonb)
                 FROM routes_ranked WHERE rn <= GREATEST(p_route_cap, 0)),
    'routeCounts', (SELECT COALESCE(jsonb_object_agg(node_id, n), '{}'::jsonb)
                      FROM (SELECT node_id, count(*) AS n FROM routes GROUP BY node_id) x),
    'schemaFiles', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'nodeId', node_id, 'path', path, 'role', role, 'language', language,
                      'artifactKind', artifact_kind, 'centrality', centrality)
                      ORDER BY node_id, centrality DESC, path), '[]'::jsonb)
                      FROM schema_files WHERE rn <= GREATEST(p_schema_cap, 0)),
    'testFiles', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'nodeId', node_id, 'path', path, 'indexedAtSha', indexed_at_sha,
                    'centrality', centrality, 'size', size, 'totalForNode', total)
                    ORDER BY node_id, centrality DESC, size ASC, path), '[]'::jsonb)
                    FROM test_files WHERE rn <= GREATEST(p_test_cap, 0))
  );
$$;


ALTER FUNCTION "public"."repo_index_backfill_material"("p_branch_id" "uuid", "p_node_id" "text", "p_route_cap" integer, "p_schema_cap" integer, "p_test_cap" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."repo_index_backfill_material"("p_branch_id" "uuid", "p_node_id" "text", "p_route_cap" integer, "p_schema_cap" integer, "p_test_cap" integer) IS 'RI-10: routes, schema files and ranked test files per node from the repo index, capped per node, one jsonb; service_role only.';



CREATE OR REPLACE FUNCTION "public"."repo_index_diff"("p_branch_id" "uuid", "p_head_sha" "text", "p_tree" "jsonb", "p_candidate_cap" integer DEFAULT 150) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_added bigint;
  v_modified bigint;
  v_deleted bigint;
  v_unverified bigint;
  v_result jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _tree (path text PRIMARY KEY, sha text) ON COMMIT DROP;
  TRUNCATE _tree;
  INSERT INTO _tree (path, sha)
  SELECT DISTINCT ON (t.path) t.path, t.sha
    FROM jsonb_to_recordset(COALESCE(p_tree, '[]'::jsonb)) AS t(path text, sha text)
   WHERE t.path IS NOT NULL;

  -- Deleted: indexed, gone from the tree → drop the row and its edges.
  WITH gone AS (
    SELECT r.path, r.node_id FROM public.repo_index r
     WHERE r.branch_id = p_branch_id AND NOT EXISTS (SELECT 1 FROM _tree t WHERE t.path = r.path)
  ), del_edges AS (
    DELETE FROM public.repo_index_edges e
     WHERE e.branch_id = p_branch_id
       AND (e.from_path IN (SELECT path FROM gone) OR e.to_path IN (SELECT path FROM gone))
  ), del_rows AS (
    DELETE FROM public.repo_index r
     WHERE r.branch_id = p_branch_id AND r.path IN (SELECT path FROM gone)
  )
  INSERT INTO public.repo_index_freshness (branch_id, path, status, node_id, head_sha, blob_sha, refreshed, detected_at)
  SELECT p_branch_id, g.path, 'deleted', g.node_id, p_head_sha, NULL, true, now() FROM gone g
  ON CONFLICT (branch_id, path) DO UPDATE SET status = 'deleted', node_id = EXCLUDED.node_id, head_sha = EXCLUDED.head_sha, refreshed = true, detected_at = now();

  -- Modified / unverified: in both, sha moved (or never known).
  INSERT INTO public.repo_index_freshness (branch_id, path, status, node_id, head_sha, blob_sha, refreshed, detected_at)
  SELECT p_branch_id, r.path,
         CASE WHEN r.blob_sha IS NULL THEN 'unverified' ELSE 'modified' END,
         r.node_id, p_head_sha, t.sha, false, now()
    FROM public.repo_index r JOIN _tree t ON t.path = r.path
   WHERE r.branch_id = p_branch_id AND (r.blob_sha IS NULL OR r.blob_sha <> t.sha)
  ON CONFLICT (branch_id, path) DO UPDATE SET
    status = EXCLUDED.status, node_id = EXCLUDED.node_id, head_sha = EXCLUDED.head_sha,
    blob_sha = EXCLUDED.blob_sha, refreshed = false, detected_at = now()
    WHERE public.repo_index_freshness.blob_sha IS DISTINCT FROM EXCLUDED.blob_sha OR public.repo_index_freshness.status = 'deleted';

  -- Added: in the tree, not indexed (node bound by the isolate's prefix rule).
  INSERT INTO public.repo_index_freshness (branch_id, path, status, node_id, head_sha, blob_sha, refreshed, detected_at)
  SELECT p_branch_id, t.path, 'added', NULL, p_head_sha, t.sha, false, now()
    FROM _tree t
   WHERE NOT EXISTS (SELECT 1 FROM public.repo_index r WHERE r.branch_id = p_branch_id AND r.path = t.path)
  ON CONFLICT (branch_id, path) DO UPDATE SET
    status = 'added', head_sha = EXCLUDED.head_sha, blob_sha = EXCLUDED.blob_sha, refreshed = false, detected_at = now()
    WHERE public.repo_index_freshness.blob_sha IS DISTINCT FROM EXCLUDED.blob_sha;

  -- A path that came back unchanged is fresh again.
  DELETE FROM public.repo_index_freshness f
   WHERE f.branch_id = p_branch_id AND f.status IN ('modified', 'unverified')
     AND EXISTS (SELECT 1 FROM public.repo_index r JOIN _tree t ON t.path = r.path
                  WHERE r.branch_id = p_branch_id AND r.path = f.path AND r.blob_sha = t.sha);

  SELECT count(*) FILTER (WHERE status = 'added'), count(*) FILTER (WHERE status = 'modified'),
         count(*) FILTER (WHERE status = 'deleted'), count(*) FILTER (WHERE status = 'unverified')
    INTO v_added, v_modified, v_deleted, v_unverified
    FROM public.repo_index_freshness WHERE branch_id = p_branch_id AND head_sha = p_head_sha;

  SELECT jsonb_build_object(
    'headSha', p_head_sha,
    'treeFiles', (SELECT count(*) FROM _tree),
    'indexFiles', (SELECT count(*) FROM public.repo_index WHERE branch_id = p_branch_id),
    'added', v_added, 'modified', v_modified, 'deleted', v_deleted, 'unverified', v_unverified,
    'staleNodes', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'nodeId', s.node_id, 'modified', s.modified, 'deleted', s.deleted, 'unverified', s.unverified,
                     'samples', s.samples) ORDER BY s.modified + s.deleted DESC, s.node_id), '[]'::jsonb)
                     FROM (SELECT f.node_id,
                                  count(*) FILTER (WHERE f.status = 'modified') AS modified,
                                  count(*) FILTER (WHERE f.status = 'deleted') AS deleted,
                                  count(*) FILTER (WHERE f.status = 'unverified') AS unverified,
                                  (SELECT COALESCE(jsonb_agg(x.path), '[]'::jsonb)
                                     FROM (SELECT path FROM public.repo_index_freshness
                                            WHERE branch_id = p_branch_id AND node_id = f.node_id AND status IN ('modified', 'deleted')
                                            ORDER BY path LIMIT 3) x) AS samples
                             FROM public.repo_index_freshness f
                            WHERE f.branch_id = p_branch_id AND f.node_id IS NOT NULL AND f.status IN ('modified', 'deleted', 'unverified')
                            GROUP BY f.node_id) s),
    -- Bounded re-extraction list: modified by centrality, then unverified, then added.
    'candidates', (SELECT COALESCE(jsonb_agg(jsonb_build_object('path', c.path, 'status', c.status, 'nodeId', c.node_id, 'sha', c.blob_sha) ORDER BY c.ord, c.rank DESC, c.path), '[]'::jsonb)
                     FROM (SELECT f.path, f.status, f.node_id, f.blob_sha,
                                  CASE f.status WHEN 'modified' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END AS ord,
                                  COALESCE(r.centrality, 0) AS rank
                             FROM public.repo_index_freshness f
                             LEFT JOIN public.repo_index r ON r.branch_id = f.branch_id AND r.path = f.path
                            WHERE f.branch_id = p_branch_id AND f.refreshed = false AND f.status <> 'deleted'
                            ORDER BY ord, rank DESC, f.path
                            LIMIT GREATEST(p_candidate_cap, 0)) c),
    'pendingRefresh', (SELECT count(*) FROM public.repo_index_freshness WHERE branch_id = p_branch_id AND refreshed = false AND status <> 'deleted'),
    -- Node → directory tallies, so an added file binds to the node whose files share its longest prefix.
    'dirsByNode', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nodeId', d.node_id, 'dir', d.dir, 'n', d.n)), '[]'::jsonb)
                     FROM (SELECT node_id,
                                  CASE WHEN array_length(string_to_array(path, '/'), 1) <= 1 THEN ''
                                       ELSE array_to_string((string_to_array(path, '/'))[1:LEAST(array_length(string_to_array(path, '/'), 1) - 1, 3)], '/') END AS dir,
                                  count(*) AS n
                             FROM public.repo_index WHERE branch_id = p_branch_id AND node_id IS NOT NULL
                            GROUP BY 1, 2) d)
  ) INTO v_result;
  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."repo_index_diff"("p_branch_id" "uuid", "p_head_sha" "text", "p_tree" "jsonb", "p_candidate_cap" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."repo_index_diff"("p_branch_id" "uuid", "p_head_sha" "text", "p_tree" "jsonb", "p_candidate_cap" integer) IS 'RI-9: classify a head tree against the repo index (added/modified/deleted/unverified), drop deleted rows, record findings, return stale nodes + a bounded refresh list; service_role only.';



CREATE OR REPLACE FUNCTION "public"."repo_index_node_context"("p_branch_id" "uuid", "p_node_id" "text", "p_hub_limit" integer DEFAULT 12) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  WITH files AS (
    SELECT * FROM public.repo_index WHERE branch_id = p_branch_id AND node_id = p_node_id
  ),
  routes AS (
    SELECT DISTINCT r->>'method' AS method, r->>'route' AS route, r->>'framework' AS framework, f.path
      FROM files f, jsonb_array_elements(COALESCE(f.signals->'serverRoutes', '[]'::jsonb)) r
  ),
  clients AS (
    SELECT c->>'lib' AS lib, count(*) AS n
      FROM files f, jsonb_array_elements(COALESCE(f.signals->'httpClients', '[]'::jsonb)) c
     GROUP BY 1
  ),
  deps AS (
    SELECT d AS dep, count(*) AS n
      FROM files f, jsonb_array_elements_text(COALESCE(f.signals->'manifestDeps', '[]'::jsonb)) d
     GROUP BY 1
  ),
  imports AS (
    SELECT i AS spec, count(*) AS n
      FROM files f, jsonb_array_elements_text(COALESCE(f.signals->'moduleImports', '[]'::jsonb)) i
     GROUP BY 1
  ),
  deployments AS (
    SELECT DISTINCT d->>'kind' AS kind, d->>'detail' AS detail, f.path
      FROM files f, jsonb_array_elements(COALESCE(f.signals->'deployments', '[]'::jsonb)) d
  )
  SELECT jsonb_build_object(
    'fileCount', (SELECT count(*) FROM files),
    'indexedAtSha', (SELECT max(indexed_at_sha) FROM files),
    'languages', (SELECT COALESCE(jsonb_object_agg(l.language, l.n), '{}'::jsonb)
                    FROM (SELECT COALESCE(language, 'other') AS language, count(*) AS n FROM files GROUP BY 1) l),
    'roles', (SELECT COALESCE(jsonb_object_agg(r.role, r.n), '{}'::jsonb)
                FROM (SELECT COALESCE(role, 'unknown') AS role, count(*) AS n FROM files GROUP BY 1) r),
    'hubs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'path', h.path, 'role', h.role, 'language', h.language, 'centrality', h.centrality,
               'fanIn', h.fan_in, 'fanOut', h.fan_out, 'size', h.size, 'contentRef', h.content_ref,
               'indexedAtSha', h.indexed_at_sha) ORDER BY h.centrality DESC, h.fan_in DESC, h.path), '[]'::jsonb)
               FROM (SELECT * FROM files ORDER BY centrality DESC, fan_in DESC, path LIMIT GREATEST(p_hub_limit, 1)) h),
    'signals', jsonb_build_object(
      'routes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'route', route, 'framework', framework, 'path', path) ORDER BY route, method), '[]'::jsonb)
                   FROM (SELECT * FROM routes ORDER BY route, method LIMIT 200) x),
      'routeCount', (SELECT count(*) FROM routes),
      'httpClients', (SELECT COALESCE(jsonb_object_agg(lib, n), '{}'::jsonb) FROM clients),
      'manifestDeps', (SELECT COALESCE(jsonb_agg(dep ORDER BY n DESC, dep), '[]'::jsonb)
                         FROM (SELECT * FROM deps ORDER BY n DESC, dep LIMIT 60) x),
      'topImports', (SELECT COALESCE(jsonb_agg(jsonb_build_object('spec', spec, 'count', n) ORDER BY n DESC, spec), '[]'::jsonb)
                       FROM (SELECT * FROM imports ORDER BY n DESC, spec LIMIT 30) x),
      'deployments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'detail', detail, 'path', path) ORDER BY kind, path), '[]'::jsonb)
                        FROM (SELECT * FROM deployments ORDER BY kind, path LIMIT 40) x)
    ),
    'dependencies', jsonb_build_object(
      'outgoing', (SELECT COALESCE(jsonb_agg(jsonb_build_object('toNodeId', to_node_id, 'kind', kind, 'edgeCount', edge_count, 'samples', samples)
                                              ORDER BY edge_count DESC, to_node_id), '[]'::jsonb)
                     FROM public.node_dependencies WHERE branch_id = p_branch_id AND from_node_id = p_node_id),
      'incoming', (SELECT COALESCE(jsonb_agg(jsonb_build_object('fromNodeId', from_node_id, 'kind', kind, 'edgeCount', edge_count, 'samples', samples)
                                              ORDER BY edge_count DESC, from_node_id), '[]'::jsonb)
                     FROM public.node_dependencies WHERE branch_id = p_branch_id AND to_node_id = p_node_id)
    )
  );
$$;


ALTER FUNCTION "public"."repo_index_node_context"("p_branch_id" "uuid", "p_node_id" "text", "p_hub_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."repo_index_node_context"("p_branch_id" "uuid", "p_node_id" "text", "p_hub_limit" integer) IS 'RI-8: what a node holds — counts, hub files, signal rollup, dependencies with evidence; service_role only.';



CREATE OR REPLACE FUNCTION "public"."repo_index_search"("p_branch_id" "uuid", "p_query" "text", "p_node_id" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  WITH q AS (
    SELECT btrim(p_query) AS text, plainto_tsquery('simple', btrim(p_query)) AS tsq
  ),
  hits AS (
    SELECT r.path, r.node_id, r.role, r.language, r.centrality, r.fan_in,
           GREATEST(
             extensions.similarity(r.path, q.text),
             CASE WHEN r.path ILIKE '%' || q.text || '%' THEN 0.9 ELSE 0 END,
             CASE WHEN q.tsq::text <> '' AND to_tsvector('simple', r.search_text) @@ q.tsq
                  THEN 0.5 + ts_rank(to_tsvector('simple', r.search_text), q.tsq) ELSE 0 END,
             CASE WHEN r.search_text ILIKE '%' || q.text || '%' THEN 0.4 ELSE 0 END
           ) AS score,
           (SELECT COALESCE(jsonb_agg(x->>'route'), '[]'::jsonb)
              FROM jsonb_array_elements(COALESCE(r.signals->'serverRoutes', '[]'::jsonb)) x
             WHERE (x->>'route') ILIKE '%' || q.text || '%') AS matched_routes
      FROM public.repo_index r, q
     WHERE r.branch_id = p_branch_id
       AND (p_node_id IS NULL OR r.node_id = p_node_id)
       AND length(q.text) >= 2
       AND (r.path ILIKE '%' || q.text || '%'
            OR r.path % q.text
            OR (q.tsq::text <> '' AND to_tsvector('simple', r.search_text) @@ q.tsq)
            OR r.search_text ILIKE '%' || q.text || '%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM hits),
    'results', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'path', h.path, 'nodeId', h.node_id, 'role', h.role, 'language', h.language,
                  'centrality', h.centrality, 'fanIn', h.fan_in, 'score', round(h.score::numeric, 3),
                  'matchedRoutes', h.matched_routes) ORDER BY h.score DESC, h.centrality DESC, h.path), '[]'::jsonb)
                  FROM (SELECT * FROM hits ORDER BY score DESC, centrality DESC, path LIMIT LEAST(GREATEST(p_limit, 1), 100)) h)
  );
$$;


ALTER FUNCTION "public"."repo_index_search"("p_branch_id" "uuid", "p_query" "text", "p_node_id" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."repo_index_search"("p_branch_id" "uuid", "p_query" "text", "p_node_id" "text", "p_limit" integer) IS 'RI-8: files by path/route/import text (trigram + full-text), bounded, node-attributed; service_role only.';



CREATE OR REPLACE FUNCTION "public"."requirement_candidates_freeze_first_derivation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.requirement_row_id IS NOT NULL AND NEW.requirement_row_id IS NOT NULL
     AND NEW.requirement_row_id IS DISTINCT FROM OLD.requirement_row_id THEN
    RAISE EXCEPTION 'requirement_candidates.requirement_row_id is the first derivation and write-once (candidate %); later derivations live in outcome_derivations', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."requirement_candidates_freeze_first_derivation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requirement_candidates_home_lane_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_project uuid;
BEGIN
  IF NEW.workflow_id IS NULL THEN
    NEW.workflow_id := public.candidate_home_lane(NEW.project_id, NULL, NEW.kind);
  END IF;
  SELECT project_id INTO v_project FROM public.workflows WHERE id = NEW.workflow_id;
  IF v_project IS NULL OR v_project <> NEW.project_id THEN
    RAISE EXCEPTION 'An outcome''s workflow must belong to its own project (workflow % is not in project %).', NEW.workflow_id, NEW.project_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."requirement_candidates_home_lane_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requirement_candidates_plan_lane"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF public.plan_allows('workflow_space', NEW.project_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.workflow_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.workflow_id IS NOT NULL AND NEW.workflow_id IS DISTINCT FROM OLD.workflow_id THEN
    RAISE EXCEPTION 'Workflows are available on Indie and above: an outcome can not be moved to another workflow on this plan.'
      USING ERRCODE = '42501', HINT = 'Upgrade at https://nodespec.io/pricing. The outcome keeps working where it is.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."requirement_candidates_plan_lane"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requirement_lock_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  -- A cascade or another trigger's write is not the user's modification.
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT COALESCE(OLD.locked, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '%', public.requirement_lock_message(OLD.requirement_id)
      USING ERRCODE = 'P0LCK', HINT = 'v3x: locked means locked';
  END IF;

  v_old := to_jsonb(OLD) - 'updated_at';
  v_new := to_jsonb(NEW) - 'updated_at';

  -- 1. the unlock door: locked → false, and nothing else changes.
  IF NOT COALESCE(NEW.locked, false) AND (v_new - 'locked') = (v_old - 'locked') THEN
    RETURN NEW;
  END IF;

  -- 2. evidence on the criteria: the content is identical, only evidence moved.
  IF (v_new - 'acceptance_criteria') = (v_old - 'acceptance_criteria')
     AND public.criteria_content(NEW.acceptance_criteria) = public.criteria_content(OLD.acceptance_criteria) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '%', public.requirement_lock_message(OLD.requirement_id)
    USING ERRCODE = 'P0LCK', HINT = 'v3x: locked means locked';
END;
$$;


ALTER FUNCTION "public"."requirement_lock_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requirement_lock_guard_child"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
  v_old_id uuid;
  v_ref text;
  i int;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_new_id := NULL; v_old_id := NULL;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      EXECUTE format('SELECT ($1).%I', TG_ARGV[i]) INTO v_new_id USING NEW;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      EXECUTE format('SELECT ($1).%I', TG_ARGV[i]) INTO v_old_id USING OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      -- only a re-point is a modification of the requirement; bookkeeping flows
      IF v_new_id IS DISTINCT FROM v_old_id THEN
        IF v_new_id IS NOT NULL THEN v_ids := v_ids || v_new_id; END IF;
        IF v_old_id IS NOT NULL THEN v_ids := v_ids || v_old_id; END IF;
      END IF;
    ELSE
      IF v_new_id IS NOT NULL THEN v_ids := v_ids || v_new_id; END IF;
      IF v_old_id IS NOT NULL THEN v_ids := v_ids || v_old_id; END IF;
    END IF;
  END LOOP;
  IF array_length(v_ids, 1) IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT r.requirement_id INTO v_ref
    FROM public.specification_requirements r
   WHERE r.id = ANY (v_ids) AND COALESCE(r.locked, false)
   ORDER BY r.requirement_id
   LIMIT 1;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION '%', public.requirement_lock_message(v_ref)
      USING ERRCODE = 'P0LCK', HINT = 'v3x: locked means locked';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$_$;


ALTER FUNCTION "public"."requirement_lock_guard_child"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requirement_lock_message"("p_ref" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT format('%s is locked. Unlock it in the app (the lock toggle on its rail under Work), then retry. No tool unlocks.',
                COALESCE(p_ref, 'This requirement'));
$$;


ALTER FUNCTION "public"."requirement_lock_message"("p_ref" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."requirement_lock_message"("p_ref" "text") IS 'V3 7.8: the one lock refusal sentence (shared with the server and the app). The door is Work, the lock toggle on the requirement''s rail; no tool unlocks.';



CREATE OR REPLACE FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer DEFAULT 20) RETURNS TABLE("tech_id" "text", "tech_name" "text", "role_affinities" "jsonb", "purpose" "text", "rank" real)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  q             text := lower(trim(coalesce(query_text, '')));
  q_slug        text;
  q_like        text;
  q_slug_like   text;
  words         text[];
  word          text;
  part          text;
  stem_parts    text := '';
  prefix_parts  text := '';
  stem_query    tsquery;
  prefix_query  tsquery;
BEGIN
  IF q = '' THEN
    RETURN;
  END IF;

  -- Catalog ids are slugs ("aws-s3"), so a spaced query is also tried hyphenated.
  q_slug := regexp_replace(q, '\s+', '-', 'g');
  q_like := '%' || replace(replace(q, '\', '\\'), '%', '\%') || '%';
  q_slug_like := '%' || replace(replace(q_slug, '\', '\\'), '%', '\%') || '%';
  words := regexp_split_to_array(q, '\s+');

  FOREACH word IN ARRAY words LOOP
    IF length(word) >= 2 THEN
      -- the stem lane, exactly as before
      part := plainto_tsquery('english', word)::text;
      IF part <> '' THEN
        IF stem_parts <> '' THEN stem_parts := stem_parts || ' | '; END IF;
        stem_parts := stem_parts || part;
      END IF;
      -- the prefix lane: 'postgres':* reaches 'postgresql'
      part := to_tsquery('english', quote_literal(word) || ':*')::text;
      IF part <> '' THEN
        IF prefix_parts <> '' THEN prefix_parts := prefix_parts || ' | '; END IF;
        prefix_parts := prefix_parts || part;
      END IF;
    END IF;
  END LOOP;

  stem_query   := CASE WHEN stem_parts   = '' THEN NULL ELSE stem_parts::tsquery   END;
  prefix_query := CASE WHEN prefix_parts = '' THEN NULL ELSE prefix_parts::tsquery END;

  RETURN QUERY
  SELECT
    tc.id AS tech_id,
    tc.name AS tech_name,
    tc.role_affinities,
    tc.ai_context->>'purpose' AS purpose,
    (
      GREATEST(
        CASE WHEN stem_query   IS NOT NULL AND tc.search_vector @@ stem_query
             THEN ts_rank_cd(tc.search_vector, stem_query, 32) ELSE 0 END,
        -- the prefix lane is a shade below an honest stem hit at equal density
        CASE WHEN prefix_query IS NOT NULL AND tc.search_vector @@ prefix_query
             THEN ts_rank_cd(tc.search_vector, prefix_query, 32) * 0.9 ELSE 0 END
      )
      + CASE
          WHEN lower(tc.id) = q OR lower(tc.id) = q_slug OR lower(tc.name) = q THEN 4.0
          WHEN lower(tc.id) LIKE q_slug || '%' OR lower(tc.name) LIKE q || '%'  THEN 2.0
          WHEN lower(tc.id) LIKE q_slug_like OR lower(tc.name) LIKE q_like      THEN 1.0
          ELSE 0.0
        END
    )::real AS rank
  FROM technology_catalog tc
  WHERE ((stem_query IS NOT NULL AND tc.search_vector @@ stem_query)
     OR (prefix_query IS NOT NULL AND tc.search_vector @@ prefix_query)
     OR lower(tc.id) LIKE q_slug_like
     OR lower(tc.name) LIKE q_like)
    -- AG.6c: a custom row only inside a project the caller belongs to. SECURITY DEFINER
    -- reads past RLS, so the filter is here; auth.uid() is the caller's (null for anon and
    -- the service role, which therefore see catalog rows only).
    AND (NOT tc.is_user_contributed OR tc.project_id IN (SELECT public.member_project_ids('viewer')))
  ORDER BY rank DESC, tc.name ASC
  LIMIT max_results;
END;
$$;


ALTER FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) IS 'V3 J: catalog discovery. A stem lane and a PREFIX lane (so "postgres" reaches PostgreSQL, which the english stemmer writes as a different lexeme), plus an exactness boost on the row''s own id and name so the thing named outranks the rows that merely mention it. AG.6c: a custom row is returned only inside a project the caller belongs to.';



CREATE OR REPLACE FUNCTION "public"."seat_project_member"("p_project_id" "uuid", "p_email" "text", "p_role" "text") RETURNS TABLE("user_id" "uuid", "email" "text", "role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
  v_user uuid;
BEGIN
  IF v_caller IS NULL OR public.project_role(p_project_id, v_caller) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'The roster is the project owner''s.' USING ERRCODE = '42501';
  END IF;
  IF public.is_example_project(p_project_id) THEN
    RAISE EXCEPTION 'The example''s teammates are example data, not accounts. Seat people on a project of your own.' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('maintainer', 'contributor', 'viewer', 'remove') THEN
    RAISE EXCEPTION 'role must be maintainer, contributor, viewer or remove (got "%").', coalesce(p_role, '') USING ERRCODE = '22023';
  END IF;
  -- Granting or changing a seat is the Team feature; removing one is not.
  IF v_role <> 'remove' AND NOT public.plan_allows('team_lanes', p_project_id) THEN
    RAISE EXCEPTION 'Project seats are Team and above. Your projects stay yours, and any seat already held keeps working.' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'email is required: the account''s NodeSpec sign-in address.' USING ERRCODE = '22023';
  END IF;
  SELECT u.id INTO v_user FROM auth.users u
   WHERE lower(u.email) = v_email AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No NodeSpec account for %. They sign up first, then you seat them.', v_email USING ERRCODE = 'P0002';
  END IF;
  IF v_user = v_caller THEN
    RAISE EXCEPTION 'That is you: the owner is not a roster seat.' USING ERRCODE = '22023';
  END IF;
  IF v_role = 'remove' THEN
    DELETE FROM public.project_members m WHERE m.project_id = p_project_id AND m.user_id = v_user;
    RETURN;
  END IF;
  INSERT INTO public.project_members (project_id, user_id, role, invited_by)
  VALUES (p_project_id, v_user, v_role, v_caller)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now();
  RETURN QUERY SELECT v_user, v_email, v_role;
END
$$;


ALTER FUNCTION "public"."seat_project_member"("p_project_id" "uuid", "p_email" "text", "p_role" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."seat_project_member"("p_project_id" "uuid", "p_email" "text", "p_role" "text") IS 'AE.4, AL.3: the owner seats or changes one account by exact email on a Team plan, and removes one (role remove) on any plan; never on the example; refused by name otherwise, before any lookup.';



CREATE OR REPLACE FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'Authentication required';
END IF;

IF NOT public.is_admin() THEN
RAISE EXCEPTION 'Admin access required';
END IF;

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('is_admin', admin_status)
WHERE id = target_user_id;
END;
$$;


ALTER FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) IS 'Operator utility (SQL editor): grant or revoke is_admin for a user. No application caller by design.';



CREATE OR REPLACE FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) RETURNS TABLE("updated_count" integer, "orphaned_count" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
v_updated integer := 0;
v_orphaned integer := 0;
BEGIN
IF NOT EXISTS (
SELECT 1 FROM public.project_specifications ps
JOIN public.projects p ON p.id = ps.project_id
WHERE ps.id = p_specification_id
AND public.is_project_member(p.id, 'contributor')
) THEN
RAISE EXCEPTION 'Specification not found or access denied';
END IF;

UPDATE public.specification_mappings
SET
is_orphan = true,
last_validated_at = now()
WHERE
specification_id = p_specification_id
AND is_orphan = false
AND node_id != ALL(p_valid_node_ids);

GET DIAGNOSTICS v_orphaned = ROW_COUNT;

UPDATE public.specification_mappings
SET
is_orphan = false,
last_validated_at = now()
WHERE
specification_id = p_specification_id
AND is_orphan = true
AND node_id = ANY(p_valid_node_ids);

GET DIAGNOSTICS v_updated = ROW_COUNT;

RETURN QUERY SELECT v_updated, v_orphaned;
END;
$$;


ALTER FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."technology_catalog_search_vector_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  typical_tech_text text;
  sdk_init_text text;
  security_text text;
BEGIN
  SELECT COALESCE(string_agg(elem, ' '), '')
  INTO typical_tech_text
  FROM jsonb_array_elements_text(
    COALESCE(NEW.ai_context->'typicalTech', '[]'::jsonb)
  ) AS elem;

  sdk_init_text := COALESCE(NEW.ai_context->>'sdkInitPattern', '');
  security_text := COALESCE(NEW.ai_context->>'securityGuidance', '');

  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(replace(NEW.id, '-', ' '), '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.ai_context->>'purpose', '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(typical_tech_text, '')), 'C') ||
    setweight(to_tsvector('english', sdk_init_text), 'C') ||
    setweight(to_tsvector('english', security_text), 'C');

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."technology_catalog_search_vector_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."template_counts_follow_rows"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'template_upvotes' THEN
    UPDATE public.project_templates
    SET upvote_count = GREATEST(upvote_count + CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END, 0)
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.template_id ELSE OLD.template_id END;
  ELSE
    UPDATE public.project_templates
    SET use_count = use_count + 1, updated_at = now()
    WHERE id = NEW.template_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."template_counts_follow_rows"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_project_ownership"("p_project_id" "uuid", "p_email" "text") RETURNS TABLE("user_id" "uuid", "email" "text", "role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
BEGIN
  IF v_caller IS NULL OR public.project_role(p_project_id, v_caller) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'The project is the owner''s to hand over.' USING ERRCODE = '42501';
  END IF;
  IF public.is_example_project(p_project_id) THEN
    RAISE EXCEPTION 'The example stays with your account; it is not handed over.' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'email is required: the account''s NodeSpec sign-in address.' USING ERRCODE = '22023';
  END IF;
  SELECT m.user_id INTO v_user
    FROM public.project_members m JOIN auth.users u ON u.id = m.user_id
   WHERE m.project_id = p_project_id AND lower(u.email) = v_email AND u.deleted_at IS NULL
   LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No seat on this project for %. Seat them first, then hand the project over.', v_email USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.projects pr SET owner_id = v_user, updated_at = now() WHERE pr.id = p_project_id;
  DELETE FROM public.project_members m WHERE m.project_id = p_project_id AND m.user_id = v_user;
  INSERT INTO public.project_members (project_id, user_id, role, invited_by)
  VALUES (p_project_id, v_caller, 'maintainer', v_user)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'maintainer', updated_at = now();
  RETURN QUERY SELECT v_user, v_email, 'owner'::text;
END
$$;


ALTER FUNCTION "public"."transfer_project_ownership"("p_project_id" "uuid", "p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transfer_project_ownership"("p_project_id" "uuid", "p_email" "text") IS 'AE.1, AL.3: the owner hands the project to an account holding a seat on it, by exact email; the previous owner keeps a maintainer seat; never the example. Refused by name otherwise, before any lookup.';



CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_emails"("p_user_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT u.id, u.email::text FROM auth.users u WHERE u.id = ANY (p_user_ids)
$$;


ALTER FUNCTION "public"."user_emails"("p_user_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_emails"("p_user_ids" "uuid"[]) IS 'V3 7.0: label roster rows for list_project_members. Service role only.';



CREATE OR REPLACE FUNCTION "public"."user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT u.id FROM auth.users u
   WHERE lower(u.email) = lower(trim(p_email)) AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1
$$;


ALTER FUNCTION "public"."user_id_by_email"("p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_id_by_email"("p_email" "text") IS 'V3 7.0: resolve an invitee by email for set_project_member. Service role only.';



CREATE OR REPLACE FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") RETURNS TABLE("user_id" "uuid", "key_id" "uuid", "scopes" "text"[], "is_valid" boolean, "rejection_reason" "text", "key_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_key_record mcp_api_keys%ROWTYPE;
BEGIN
  SELECT * INTO v_key_record
  FROM mcp_api_keys k
  WHERE k.key_hash = p_key_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text[], false, 'Invalid API key'::text, NULL::text;
    RETURN;
  END IF;

  IF v_key_record.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT v_key_record.user_id, v_key_record.id, v_key_record.scopes, false, 'API key has been revoked'::text, v_key_record.name;
    RETURN;
  END IF;

  IF v_key_record.expires_at IS NOT NULL AND v_key_record.expires_at < now() THEN
    RETURN QUERY SELECT v_key_record.user_id, v_key_record.id, v_key_record.scopes, false, 'API key has expired'::text, v_key_record.name;
    RETURN;
  END IF;

  UPDATE mcp_api_keys SET last_used_at = now() WHERE id = v_key_record.id;

  RETURN QUERY SELECT v_key_record.user_id, v_key_record.id, v_key_record.scopes, true, NULL::text, v_key_record.name;
END;
$$;


ALTER FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") IS 'Judges a presented API key by its hash: user, id, scopes, validity and the refusal reason, plus (V3 O.2) the key''s name so the MCP server can label what the key does without a second read. Service-role caller; SECURITY DEFINER.';



CREATE OR REPLACE FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") RETURNS TABLE("chain_status" "text", "entries" bigint, "broken_at_sequence" bigint, "reason" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  r RECORD;
  v_expected_prev text := NULL;
  v_count bigint := 0;
  v_recomputed text;
BEGIN
  FOR r IN
    SELECT gp.* FROM graph_patches gp
    WHERE gp.branch_id = p_branch_id
    ORDER BY gp.sequence ASC
  LOOP
    v_count := v_count + 1;

    IF r.entry_hash IS NULL THEN
      RETURN QUERY SELECT 'broken'::text, v_count, r.sequence, 'entry_hash is NULL (row predates chain or was cleared)'::text;
      RETURN;
    END IF;

    IF r.prev_hash IS DISTINCT FROM v_expected_prev THEN
      RETURN QUERY SELECT 'broken'::text, v_count, r.sequence, 'prev_hash does not match predecessor entry_hash (link re-pointed or predecessor removed)'::text;
      RETURN;
    END IF;

    v_recomputed := compute_patch_entry_hash(
      r.id, r.branch_id, r.sequence, r.patch_type, r.actor_type,
      r.actor_id, r.summary, r.payload, r.preconditions, r.created_at,
      r.prev_hash
    );

    IF v_recomputed <> r.entry_hash THEN
      RETURN QUERY SELECT 'broken'::text, v_count, r.sequence, 'entry_hash mismatch (hashed column mutated after insert)'::text;
      RETURN;
    END IF;

    v_expected_prev := r.entry_hash;
  END LOOP;

  IF v_count = 0 THEN
    RETURN QUERY SELECT 'no_chain'::text, 0::bigint, NULL::bigint, NULL::text;
  ELSE
    RETURN QUERY SELECT 'intact'::text, v_count, NULL::bigint, NULL::text;
  END IF;
END;
$$;


ALTER FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") IS 'Operator utility (SQL editor): walks a branch''s graph_patches hash chain and reports the first break. No application caller by design.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agent_checkouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "level" "text" NOT NULL,
    "holder_kind" "text" NOT NULL,
    "holder_label" "text" NOT NULL,
    "holder_key_id" "uuid",
    "task_item_id" "uuid",
    "artifact_id" "uuid",
    "requirement_id" "uuid",
    "candidate_id" "uuid",
    "proposal_id" "uuid",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "since" timestamp with time zone DEFAULT "now"() NOT NULL,
    "heartbeat_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "released_at" timestamp with time zone,
    "released_reason" "text",
    "holder_delegate" "text",
    "criterion_id" "text",
    "node_id" "uuid",
    CONSTRAINT "agent_checkouts_criterion_pairs" CHECK ((("level" = 'criterion'::"text") = ("criterion_id" IS NOT NULL))),
    CONSTRAINT "agent_checkouts_holder_kind_check" CHECK (("holder_kind" = ANY (ARRAY['agent'::"text", 'human'::"text"]))),
    CONSTRAINT "agent_checkouts_level_check" CHECK (("level" = ANY (ARRAY['task'::"text", 'code'::"text", 'requirement'::"text", 'outcome'::"text", 'criterion'::"text", 'node'::"text"]))),
    CONSTRAINT "agent_checkouts_one_ref" CHECK (("num_nonnulls"("task_item_id", "artifact_id", "requirement_id", "candidate_id") =
CASE
    WHEN ("level" = 'node'::"text") THEN 0
    ELSE 1
END)),
    CONSTRAINT "agent_checkouts_ref_matches_level" CHECK (
CASE "level"
    WHEN 'task'::"text" THEN ("task_item_id" IS NOT NULL)
    WHEN 'code'::"text" THEN ("artifact_id" IS NOT NULL)
    WHEN 'requirement'::"text" THEN ("requirement_id" IS NOT NULL)
    WHEN 'outcome'::"text" THEN ("candidate_id" IS NOT NULL)
    WHEN 'criterion'::"text" THEN (("requirement_id" IS NOT NULL) AND ("criterion_id" IS NOT NULL))
    WHEN 'node'::"text" THEN ("node_id" IS NOT NULL)
    ELSE NULL::boolean
END),
    CONSTRAINT "agent_checkouts_release_pairs" CHECK ((("released_at" IS NULL) = ("released_reason" IS NULL))),
    CONSTRAINT "agent_checkouts_released_reason_check" CHECK (("released_reason" = ANY (ARRAY['verified'::"text", 'released'::"text", 'reclaimed'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."agent_checkouts" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_checkouts" IS 'V3 lease primitive (CHECKOUTS): who holds what, at which level. task/code exclusive per active ref; criterion (v3u) exclusive per (requirement_id, criterion_id); requirement/outcome advisory drafting holds tied to a proposal. Active = released_at IS NULL; stale-held is derived from heartbeat_at, never stored; released rows are audit.';



COMMENT ON COLUMN "public"."agent_checkouts"."holder_delegate" IS 'R7: the credential that holds the lease — key:<mcp_api_keys.id> or oauth:<user_id>:<client_id> (stable across token renewals). The app and get_work_queue mark holds mine by this; holder_label is display only.';



COMMENT ON COLUMN "public"."agent_checkouts"."node_id" IS 'AA.5: the graph node a node lease locks, and the node a task or code lease works inside (graph node ids are uuid strings, not rows).';



CREATE TABLE IF NOT EXISTS "public"."ai_proposal_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "artifact_id" "text" NOT NULL,
    "content" "text" NOT NULL,
    "content_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_proposal_artifacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_proposal_artifacts" IS 'Artifact contents staged with a proposal until accept (content + content_hash). artifact_id is the artifact path-key inside the proposal patch, not an artifacts.id — deliberately no FK.';



COMMENT ON COLUMN "public"."ai_proposal_artifacts"."artifact_id" IS 'The artifact path-key inside the proposal patch, not artifacts.id — no FK by design.';



CREATE TABLE IF NOT EXISTS "public"."ai_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ai_run_id" "uuid" NOT NULL,
    "source_branch_id" "uuid" NOT NULL,
    "proposal_branch_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "patches" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "validation_expectations" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "merged_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "ai_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'reviewing'::"text", 'merged'::"text", 'rejected'::"text", 'partial'::"text", 'staged'::"text"])))
);


ALTER TABLE "public"."ai_proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_proposals" IS 'Pending / merged / rejected change sets: graph patches and V3 spec-plane ops in patches jsonb, from source_branch_id onto proposal_branch_id. The approvals queue and the collision board both hang off this table.';



CREATE TABLE IF NOT EXISTS "public"."ai_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "input_snapshot_id" "uuid",
    "output_patches" "uuid"[],
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "proposal_id" "uuid",
    CONSTRAINT "ai_runs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."ai_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_runs" IS 'Origin record for every proposal: historically an AI generation run (model, prompt_hash), today also every MCP tool call and git action that files a proposal. ai_proposals.ai_run_id is required, so the row is the audit anchor.';



CREATE TABLE IF NOT EXISTS "public"."app_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active_seconds" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "app_sessions_active_seconds_check" CHECK (("active_seconds" >= 0))
);


ALTER TABLE "public"."app_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_sessions" IS 'Time in app, managed service only: one row per session of heartbeats. Service role only: written only by app_session_beat and read only by admin_time_in_app; no policies on purpose.';



CREATE TABLE IF NOT EXISTS "public"."artifacts" (
    "id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "uri" "text",
    "content" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "kind" "text",
    "node_id" "uuid",
    "branch_id" "uuid",
    "path" "text",
    "content_text" "text",
    "content_hash" character varying(64),
    "language" character varying(50),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    "mark" "text",
    CONSTRAINT "artifacts_kind_check" CHECK ((("kind" IS NULL) OR ("kind" = ANY (ARRAY['source'::"text", 'schema'::"text", 'doc'::"text", 'config'::"text", 'build'::"text", 'design'::"text", 'task'::"text", 'test-plan'::"text"])))),
    CONSTRAINT "chk_artifacts_mark" CHECK ((("mark" IS NULL) OR ("mark" ~ '^[A-Z0-9][A-Z0-9 /\-]{0,63}$'::"text")))
);


ALTER TABLE "public"."artifacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."artifacts" IS 'Files bound to nodes on a branch: path + content_text/content_hash (or content jsonb for the legacy shape); kind is the current classifier, type the legacy one kept in step. Bindings-only artifacts hold a git content_ref in metadata.';



COMMENT ON COLUMN "public"."artifacts"."node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (uuid form). There is no nodes table.';



COMMENT ON COLUMN "public"."artifacts"."mark" IS 'V3 7.3: classification mark on this artifact — visible only to the owner and to cleared seats.';



CREATE TABLE IF NOT EXISTS "public"."blog_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."blog_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."blog_categories" IS 'Hosted-site blog categories.';



CREATE TABLE IF NOT EXISTS "public"."blog_post_categories" (
    "post_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL
);


ALTER TABLE "public"."blog_post_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."blog_post_categories" IS 'Post ↔ category join for the hosted-site blog.';



CREATE TABLE IF NOT EXISTS "public"."blog_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "excerpt" "text" NOT NULL,
    "content" "text" NOT NULL,
    "cover_image_url" "text",
    "author_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "meta_title" "text",
    "meta_description" "text",
    "keywords" "text"[],
    "published_at" timestamp with time zone,
    "view_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "content_format" "text" DEFAULT 'html'::"text" NOT NULL,
    CONSTRAINT "blog_posts_content_format_check" CHECK (("content_format" = ANY (ARRAY['html'::"text", 'markdown'::"text"]))),
    CONSTRAINT "blog_posts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."blog_posts" OWNER TO "postgres";


COMMENT ON TABLE "public"."blog_posts" IS 'Hosted-site blog posts (slug, status, SEO fields, view_count); categories via blog_post_categories.';



CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "base_snapshot_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "git_ref" "text",
    "last_synced_commit" "text",
    "is_primary" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


COMMENT ON TABLE "public"."branches" IS 'Architecture branches of a project; is_primary marks the one MCP and git bind to. base_snapshot_id points at the graph_snapshots row the branch forked from; git_ref / last_synced_commit are the git-lane cursor.';



COMMENT ON COLUMN "public"."branches"."git_ref" IS 'Git branch this NodeSpec branch mirrors (P1-7). Null = unbound (no repo connected).';



COMMENT ON COLUMN "public"."branches"."last_synced_commit" IS 'Remote commit SHA last reconciled against; baseline for the drift sweep (P1-7).';



COMMENT ON COLUMN "public"."branches"."is_primary" IS 'The project''s design trunk (exactly one per project). Identity lives here, NOT in the name — connect may rename the row to the bound git branch.';



CREATE TABLE IF NOT EXISTS "public"."bug_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "severity" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "page_url" "text" DEFAULT ''::"text",
    "browser_info" "text" DEFAULT ''::"text",
    "admin_notes" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bug_reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."bug_reports" IS 'In-app bug reports (severity, status, admin_notes); user_id nulls when the reporter is deleted.';



CREATE TABLE IF NOT EXISTS "public"."cloud_provider_patterns" (
    "id" integer NOT NULL,
    "provider" "text" NOT NULL,
    "archetype" "text" NOT NULL,
    "guidance" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cloud_provider_patterns" OWNER TO "postgres";


COMMENT ON TABLE "public"."cloud_provider_patterns" IS 'Provider × archetype guidance text for generation prompts. Keep-list reference data (P0 0.5), island by design.';



CREATE SEQUENCE IF NOT EXISTS "public"."cloud_provider_patterns_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cloud_provider_patterns_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cloud_provider_patterns_id_seq" OWNED BY "public"."cloud_provider_patterns"."id";



CREATE TABLE IF NOT EXISTS "public"."couplings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "coupling_type" "text" NOT NULL,
    "detail" "text",
    "from_candidate_id" "uuid",
    "from_requirement_id" "uuid",
    "from_task_item_id" "uuid",
    "to_candidate_id" "uuid",
    "to_requirement_id" "uuid",
    "to_task_item_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "couplings_coupling_type_check" CHECK (("coupling_type" = ANY (ARRAY['waits_on'::"text", 'blocks'::"text"]))),
    CONSTRAINT "couplings_from_one_endpoint" CHECK (("num_nonnulls"("from_candidate_id", "from_requirement_id", "from_task_item_id") = 1)),
    CONSTRAINT "couplings_scope_check" CHECK (("scope" = ANY (ARRAY['cross'::"text", 'intra'::"text"]))),
    CONSTRAINT "couplings_to_one_endpoint" CHECK (("num_nonnulls"("to_candidate_id", "to_requirement_id", "to_task_item_id") = 1))
);


ALTER TABLE "public"."couplings" OWNER TO "postgres";


COMMENT ON TABLE "public"."couplings" IS 'V3 declared dependencies between ideation-plane items (COUPLINGS: waits_on/blocks, cross/intra lane). Distinct from node_dependencies (repo-import evidence between nodes) and contract edges (architecture plane).';



CREATE TABLE IF NOT EXISTS "public"."deployment_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "mode" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "deployment_settings_id_check" CHECK ("id"),
    CONSTRAINT "deployment_settings_mode_check" CHECK (("mode" = ANY (ARRAY['hosted'::"text", 'self-hosted'::"text"])))
);


ALTER TABLE "public"."deployment_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."deployment_settings" IS 'Q: one row, absent = hosted. The community container init and the self-host bootstrap write self-hosted. No policies: only the service role and definer functions read it.';



CREATE TABLE IF NOT EXISTS "public"."deployment_targets" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "icon_name" "text" DEFAULT 'server'::"text" NOT NULL,
    "compatible_roles" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata_schema" "jsonb" DEFAULT '{}'::"jsonb",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deployment_targets" OWNER TO "postgres";


COMMENT ON TABLE "public"."deployment_targets" IS 'Deployment target catalog (compatible_roles lists node_roles ids). Reference data, island by design.';



CREATE TABLE IF NOT EXISTS "public"."enterprise_contact_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "company" "text" NOT NULL,
    "role" "text" DEFAULT ''::"text",
    "deployment_preference" "text" DEFAULT 'managed'::"text" NOT NULL,
    "message" "text" DEFAULT ''::"text",
    "user_id" "uuid",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."enterprise_contact_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."enterprise_contact_requests" IS 'Enterprise / government contact form submissions (status-tracked by admins).';



CREATE TABLE IF NOT EXISTS "public"."git_change_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "commit_sha" "text" NOT NULL,
    "commit_message" "text" DEFAULT ''::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "changed_files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."git_change_events" REPLICA IDENTITY FULL;


ALTER TABLE "public"."git_change_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."git_change_events" IS 'Inbound webhook commits awaiting review (status, resolved_by): commit_sha, author, changed_files jsonb. resolve_change accepts or dismisses them and applies the checkbox ticks they carry.';



CREATE TABLE IF NOT EXISTS "public"."git_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "repo_owner" "text" NOT NULL,
    "repo_name" "text" NOT NULL,
    "default_branch" "text" DEFAULT 'main'::"text" NOT NULL,
    "access_token_encrypted" "text" NOT NULL,
    "webhook_secret" "text",
    "last_sync_at" timestamp with time zone,
    "sync_status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "last_drift_check_at" timestamp with time zone,
    "base_url" "text",
    "auto_sync" boolean DEFAULT true NOT NULL,
    "commit_mode" "text" DEFAULT 'direct'::"text" NOT NULL,
    CONSTRAINT "git_integrations_commit_mode_check" CHECK (("commit_mode" = ANY (ARRAY['direct'::"text", 'pull-request'::"text"]))),
    CONSTRAINT "git_integrations_provider_check" CHECK (("provider" = ANY (ARRAY['github'::"text", 'gitlab'::"text"]))),
    CONSTRAINT "git_integrations_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['idle'::"text", 'syncing'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."git_integrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."git_integrations" IS 'One GitHub/GitLab connection per project: repo coordinates, encrypted token, webhook secret, sync posture (auto_sync, commit_mode). Parent of git_sync_log and git_change_events.';



COMMENT ON COLUMN "public"."git_integrations"."last_drift_check_at" IS 'Last drift-sweep run; used to throttle provider API calls (P1-7).';



COMMENT ON COLUMN "public"."git_integrations"."base_url" IS 'Optional self-hosted provider API base (GHES /api/v3, self-managed GitLab /api/v4). NULL = cloud default (P1-7).';



COMMENT ON COLUMN "public"."git_integrations"."auto_sync" IS 'Client-side auto-accept of content-only change cards (bound, unlocked files; no deletes/moves/residue/model/spec/ticks). Applied through the normal accept lane; every auto-resolve is stamped metadata.autoSynced.';



COMMENT ON COLUMN "public"."git_integrations"."commit_mode" IS 'How NodeSpec pushes land: direct commit (default) or a pull request from a nodespec/push-* work branch.';



CREATE TABLE IF NOT EXISTS "public"."git_sync_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "direction" "text" NOT NULL,
    "commit_sha" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "patches_synced" integer DEFAULT 0,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "git_sync_log_direction_check" CHECK (("direction" = ANY (ARRAY['push'::"text", 'pull'::"text"]))),
    CONSTRAINT "git_sync_log_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."git_sync_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."git_sync_log" IS 'Audit of every push/pull sync run per integration and branch: commit_sha, status, patches_synced, error_message.';



CREATE TABLE IF NOT EXISTS "public"."graph_patches" (
    "id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "sequence" bigint NOT NULL,
    "patch_type" "text" NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "summary" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "preconditions" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_at" timestamp with time zone,
    "prev_hash" "text",
    "entry_hash" "text",
    CONSTRAINT "graph_patches_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['human'::"text", 'ai'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."graph_patches" OWNER TO "postgres";


COMMENT ON TABLE "public"."graph_patches" IS 'Append-only, hash-chained patch log per branch (prev_hash → entry_hash, sequence). Snapshots are derived from it; verify_patch_chain audits it.';



COMMENT ON COLUMN "public"."graph_patches"."actor_id" IS 'Who applied the patch, typed by actor_type (human | ai | system): a user id, an agent/run id, or null. Polymorphic — no FK by design.';



CREATE TABLE IF NOT EXISTS "public"."graph_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "graph_data" "jsonb" NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "patch_sequence" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "graph_data_has_required_keys" CHECK ((("graph_data" ? 'id'::"text") AND ("graph_data" ? 'schemaVersion'::"text") AND ("graph_data" ? 'version'::"text") AND ("graph_data" ? 'hash'::"text") AND ("graph_data" ? 'nodes'::"text") AND ("graph_data" ? 'edges'::"text") AND ("graph_data" ? 'contracts'::"text") AND ("graph_data" ? 'artifacts'::"text") AND ("jsonb_typeof"(("graph_data" -> 'nodes'::"text")) = 'object'::"text") AND ("jsonb_typeof"(("graph_data" -> 'edges'::"text")) = 'object'::"text") AND ("jsonb_typeof"(("graph_data" -> 'contracts'::"text")) = 'object'::"text") AND ("jsonb_typeof"(("graph_data" -> 'artifacts'::"text")) = 'object'::"text")))
);


ALTER TABLE "public"."graph_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."graph_snapshots" IS 'Materialized graph (nodes + edges as graph_data jsonb) per branch at patch_sequence. Node identity lives HERE — there is no nodes table, so every node_id column in the schema is a soft reference into this jsonb.';



CREATE TABLE IF NOT EXISTS "public"."import_edge_kind_map" (
    "evidence_kind" "text" NOT NULL,
    "contract_kind" "text" NOT NULL,
    "direction_note" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_edge_kind_map" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_edge_kind_map" IS 'Evidence kind the import pipeline emits (import-edge-kinds.ts) → ontology contract kind. Edit rows, not code, when the contract vocabulary changes.';



CREATE TABLE IF NOT EXISTS "public"."import_job_edges" (
    "job_id" "uuid" NOT NULL,
    "from_path" "text" NOT NULL,
    "to_path" "text" NOT NULL,
    "kind" "text" NOT NULL
);


ALTER TABLE "public"."import_job_edges" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_job_edges" IS 'RI-4: resolved file→file edges for an import job (kind = import-edge-kinds.ts). Promoted to repo_index_edges on accept.';



CREATE TABLE IF NOT EXISTS "public"."import_job_files" (
    "job_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "group_idx" integer,
    "role" "text",
    "language" "text",
    "framework" "text",
    "artifact_kind" "text",
    "size" integer DEFAULT 0 NOT NULL,
    "content" "text",
    "content_truncated" boolean DEFAULT false NOT NULL,
    "signals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content_ref" "text",
    "extractor_version" integer DEFAULT 6 NOT NULL,
    "fan_in" integer DEFAULT 0 NOT NULL,
    "fan_out" integer DEFAULT 0 NOT NULL,
    "centrality" real DEFAULT 0 NOT NULL,
    "blob_sha" "text"
);


ALTER TABLE "public"."import_job_files" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_job_files" IS 'Per-job file census with signals, roles and centrality — the staging behind repo_index. Service-role only: RLS is enabled with no policies on purpose.';



COMMENT ON COLUMN "public"."import_job_files"."signals" IS 'Per-file signals extracted at stream time (FileSignals shape, import-signals.ts). Enrich merges these; content is not required.';



COMMENT ON COLUMN "public"."import_job_files"."content_ref" IS 'Storage path when the file body lives outside the row (RI-5 hubs); NULL otherwise.';



COMMENT ON COLUMN "public"."import_job_files"."extractor_version" IS 'EXTRACTOR_VERSION (import-signals.ts) that produced `signals`.';



CREATE TABLE IF NOT EXISTS "public"."import_job_group_edges" (
    "job_id" "uuid" NOT NULL,
    "from_group_idx" integer NOT NULL,
    "to_group_idx" integer NOT NULL,
    "kind" "text" NOT NULL,
    "edge_count" integer DEFAULT 0 NOT NULL,
    "samples" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "refreshed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_job_group_edges" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_job_group_edges" IS 'RI-4: group-level aggregate of import_job_edges, refreshed by import_graph_metrics. Synthesize reads THIS; it never re-walks imports.';



CREATE TABLE IF NOT EXISTS "public"."import_job_groups" (
    "job_id" "uuid" NOT NULL,
    "group_idx" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "hypothesis" "jsonb" NOT NULL,
    "result" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_job_groups_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."import_job_groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_job_groups" IS 'Per-job skeleton groups (hypothesis → result) that become nodes at promotion. Service-role only: RLS is enabled with no policies on purpose.';



CREATE TABLE IF NOT EXISTS "public"."import_job_rank" (
    "job_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "rank" double precision DEFAULT 0 NOT NULL,
    "next_rank" double precision DEFAULT 0 NOT NULL,
    "out_deg" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."import_job_rank" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_job_rank" IS 'PageRank scratch per job (rank, next_rank, out_deg); filled and emptied by import_graph_metrics. Service-role only: RLS is enabled with no policies on purpose.';



CREATE TABLE IF NOT EXISTS "public"."import_job_waves" (
    "job_id" "uuid" NOT NULL,
    "wave" "text" NOT NULL,
    "member" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_job_waves_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."import_job_waves" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_job_waves" IS 'RI-7: fan-out members per import job and wave; the last member to finish fires the fan-in (counted under the job row lock). Service-role only: RLS is enabled with no policies on purpose.';



CREATE TABLE IF NOT EXISTS "public"."import_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "integration_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "stage" "text" DEFAULT 'skeleton'::"text" NOT NULL,
    "stages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "skeleton" "jsonb",
    "open_questions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "proposal_id" "uuid",
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "driver_lease_owner" "text",
    "driver_lease_until" timestamp with time zone,
    "promotion" "jsonb",
    CONSTRAINT "import_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'awaiting_review'::"text", 'promoting'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."import_jobs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."import_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_jobs" IS 'One repo-import run per branch: stage machine (stages jsonb), skeleton, open_questions, metrics, driver lease, and the promotion record. proposal_id is a soft reference to the ai_proposals row the import files.';



COMMENT ON COLUMN "public"."import_jobs"."proposal_id" IS 'Soft reference to ai_proposals.id (linked by the import_promote_on_proposal_accept trigger); intentionally survives proposal deletion.';



COMMENT ON COLUMN "public"."import_jobs"."driver_lease_until" IS 'RI-7: while in the future, exactly one chain (driver_lease_owner) drives this job. Expired = nobody is driving.';



COMMENT ON COLUMN "public"."import_jobs"."promotion" IS 'RI-12/14a: {branchId, groupNodes:[{group_idx,node_id}], cursor, promoted, files, requestedAt, proposalId, edgeCursor?:{from,to,kind}, edgesWritten?, edgesTotal?, closeStartedAt?, finishedAt?, bound?, edges?, nodeDependencies?} — recorded by the accept trigger, advanced by import_promote_page / import_promote_edges_page, closed by import_promote_finish.';



CREATE TABLE IF NOT EXISTS "public"."mcp_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "key_prefix" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['read'::"text", 'write'::"text", 'propose'::"text"] NOT NULL,
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "valid_scopes" CHECK (("scopes" <@ ARRAY['read'::"text", 'write'::"text", 'propose'::"text"]))
);


ALTER TABLE "public"."mcp_api_keys" OWNER TO "postgres";


COMMENT ON TABLE "public"."mcp_api_keys" IS 'Hashed MCP bearer keys per user (key_hash, key_prefix, scopes, revoked_at). agent_checkouts.holder_key_id names the key that holds a lease.';



CREATE TABLE IF NOT EXISTS "public"."mcp_oauth_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "redirect_uri" "text" NOT NULL,
    "code_challenge" "text" NOT NULL,
    "code_challenge_method" "text" DEFAULT 'S256'::"text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['read'::"text", 'write'::"text", 'propose'::"text"] NOT NULL,
    "state" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mcp_oauth_codes" OWNER TO "postgres";


COMMENT ON TABLE "public"."mcp_oauth_codes" IS 'Short-lived PKCE authorization codes for the MCP OAuth flow. Service-role only: RLS is enabled with no policies on purpose.';



COMMENT ON COLUMN "public"."mcp_oauth_codes"."client_id" IS 'The OAuth client identifier the connector presented (a string agreed with the client, not a row).';



CREATE TABLE IF NOT EXISTS "public"."mcp_oauth_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "access_token_hash" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['read'::"text", 'write'::"text", 'propose'::"text"] NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refresh_token_hash" "text",
    "refresh_expires_at" timestamp with time zone,
    "rotated_from" "uuid",
    "rotated_to" "uuid",
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."mcp_oauth_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."mcp_oauth_tokens" IS 'Hashed MCP OAuth access tokens per user and client. Service-role only: RLS is enabled with no policies on purpose.';



COMMENT ON COLUMN "public"."mcp_oauth_tokens"."client_id" IS 'The OAuth client identifier the token was issued to (a string agreed with the client, not a row).';



COMMENT ON COLUMN "public"."mcp_oauth_tokens"."refresh_token_hash" IS 'v3n: sha256 of the refresh token issued with this access token; NULL for tokens issued before refresh existed (they expire at expires_at as before).';



COMMENT ON COLUMN "public"."mcp_oauth_tokens"."rotated_to" IS 'v3n: the row a refresh grant replaced this one with. A refresh token presented after rotation is reuse — the whole family is revoked.';



CREATE UNLOGGED TABLE "public"."mcp_rate_buckets" (
    "holder" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tat" timestamp with time zone NOT NULL,
    CONSTRAINT "mcp_rate_buckets_holder_check" CHECK (("holder" ~ '^(key|oauth|user):.'::"text"))
);


ALTER TABLE "public"."mcp_rate_buckets" OWNER TO "postgres";


COMMENT ON TABLE "public"."mcp_rate_buckets" IS 'V3 AE.5: the MCP rate limit every isolate shares, one row per credential holder with the theoretical arrival time of a generic cell rate check. Service role only: RLS on with no policies on purpose, anon and authenticated hold no grant; written only through mcp_rate_take. Rows cascade with the account.';



COMMENT ON COLUMN "public"."mcp_rate_buckets"."holder" IS 'The credential, as the server names it: key:<api key id>, oauth:<user id>:<client id>, or user:<user id> for a signed-in session.';



COMMENT ON COLUMN "public"."mcp_rate_buckets"."tat" IS 'Theoretical arrival time: a call at t passes while tat - t is within (capacity - 1) steps, and moves tat to max(tat, t) plus one step (1 / rate).';



CREATE TABLE IF NOT EXISTS "public"."node_dependencies" (
    "branch_id" "uuid" NOT NULL,
    "from_node_id" "text" NOT NULL,
    "to_node_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "edge_count" integer DEFAULT 0 NOT NULL,
    "samples" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "refreshed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."node_dependencies" OWNER TO "postgres";


COMMENT ON TABLE "public"."node_dependencies" IS 'Node-level aggregate of repo_index_edges, refreshed per import. The canvas reads THIS; it never aggregates the edge table live.';



COMMENT ON COLUMN "public"."node_dependencies"."from_node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (text form, import lane). There is no nodes table.';



COMMENT ON COLUMN "public"."node_dependencies"."to_node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (text form, import lane). There is no nodes table.';



CREATE TABLE IF NOT EXISTS "public"."node_roles" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "icon_name" "text" DEFAULT 'box'::"text" NOT NULL,
    "color" "text" DEFAULT '#6b7280'::"text" NOT NULL,
    "rf_visual_type" "text" DEFAULT 'service'::"text" NOT NULL,
    "palette_category" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_container" boolean DEFAULT false NOT NULL,
    "container_layer" "text",
    "can_contain" "jsonb" DEFAULT '[]'::"jsonb",
    "metadata_schema" "jsonb" DEFAULT '{}'::"jsonb",
    "suggested_contracts" "jsonb" DEFAULT '[]'::"jsonb",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "container_style" "text",
    "capability_tags" "text"[] DEFAULT '{}'::"text"[],
    "deprecated" boolean DEFAULT false NOT NULL,
    "provider" "text",
    "when_to_use" "text",
    "default_technology" "text",
    "nature" "text" DEFAULT 'build'::"text" NOT NULL,
    "interface_kind" "text" DEFAULT 'service'::"text" NOT NULL,
    CONSTRAINT "node_roles_can_contain_format_check" CHECK ((("can_contain" IS NULL) OR ("jsonb_typeof"("can_contain") = 'array'::"text") OR (("jsonb_typeof"("can_contain") = 'object'::"text") AND (("can_contain" - ARRAY['roleIds'::"text", 'natures'::"text", 'interfaceKinds'::"text", 'providers'::"text"]) = '{}'::"jsonb")))),
    CONSTRAINT "node_roles_container_layer_check" CHECK (("container_layer" = ANY (ARRAY['infrastructure'::"text", 'orchestration'::"text", 'runtime'::"text", 'logical'::"text"]))),
    CONSTRAINT "node_roles_container_style_check" CHECK ((("container_style" IS NULL) OR ("container_style" = ANY (ARRAY['hosting'::"text", 'logical-boundary'::"text"])))),
    CONSTRAINT "node_roles_container_style_coherence_check" CHECK (((("is_container" IS TRUE) AND ("container_style" IS NOT NULL)) OR (("is_container" IS NOT TRUE) AND ("container_style" IS NULL)))),
    CONSTRAINT "node_roles_container_visual_check" CHECK ((("rf_visual_type" <> 'container'::"text") OR ("is_container" IS TRUE))),
    CONSTRAINT "node_roles_interface_kind_check" CHECK (("interface_kind" = ANY (ARRAY['service'::"text", 'data'::"text", 'object_store'::"text", 'queue'::"text", 'event_bus'::"text", 'auth'::"text", 'telemetry'::"text"]))),
    CONSTRAINT "node_roles_nature_check" CHECK (("nature" = ANY (ARRAY['build'::"text", 'integrate'::"text", 'host'::"text", 'engine'::"text", 'call'::"text"]))),
    CONSTRAINT "node_roles_nature_containment_check" CHECK (((NOT (("nature" = 'host'::"text") AND ("is_container" IS NOT TRUE))) AND (NOT (("nature" = ANY (ARRAY['call'::"text", 'engine'::"text"])) AND ("is_container" IS TRUE))))),
    CONSTRAINT "node_roles_palette_category_check" CHECK (("palette_category" = ANY (ARRAY['Services'::"text", 'Database'::"text", 'Networking'::"text", 'AI & ML'::"text", 'Messaging'::"text", 'Infrastructure'::"text", 'Platform'::"text", 'Automation'::"text", 'External'::"text", 'Observability'::"text", 'Hardware'::"text", 'Game Development'::"text", 'Logical'::"text", 'requirements'::"text"]))),
    CONSTRAINT "node_roles_rf_visual_type_check" CHECK (("rf_visual_type" = ANY (ARRAY['service'::"text", 'icon'::"text", 'container'::"text", 'api'::"text", 'queue'::"text", 'cache'::"text", 'external'::"text", 'library'::"text", 'requirement'::"text"]))),
    CONSTRAINT "node_roles_suggested_contracts_check" CHECK ("public"."node_roles_suggested_contracts_valid"("suggested_contracts"))
);


ALTER TABLE "public"."node_roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."node_roles" IS 'Node role catalog (id is the role key referenced from graph nodes, technology_catalog.role_affinities and deployment_targets.compatible_roles): palette placement, containment rules and suggested contracts. Reference data, an island by design.';



COMMENT ON COLUMN "public"."node_roles"."can_contain" IS 'Containment rules. Either a JSON array of role IDs (legacy) or a rule object with optional keys: roleIds, kinds, functionalKinds, providers. Each key holds an array of strings. A child is allowed if it matches any populated allowlist.';



COMMENT ON COLUMN "public"."node_roles"."nature" IS 'Who runs this and do you author it. build = you write its code · integrate = a managed capability the provider operates · host = a platform that runs other nodes · engine = you configure it, never author its internals · call = third-party you only consume. Replaces kind (13) + treatment_mode (3). Ownership and effective treatment derive from this.';



COMMENT ON COLUMN "public"."node_roles"."interface_kind" IS 'What an edge INTO this node means — the connect-time contract birth axis (N8.6A). Replaces functional_kind, dropping the 5 values that resolved to the same fallback.';



CREATE TABLE IF NOT EXISTS "public"."stripe_customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "customer_id" "text" NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "plan_name" "text" DEFAULT 'community'::"text" NOT NULL,
    "amount_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_id" "text",
    "subscription_id" "text",
    "price_id" "text",
    "cancel_at_period_end" boolean DEFAULT false,
    "payment_method_brand" "text",
    "payment_method_last4" "text",
    "billing_interval" "text" DEFAULT 'month'::"text",
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "refund_amount_cents" integer DEFAULT 0
);

ALTER TABLE ONLY "public"."stripe_subscriptions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."stripe_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "source" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "action" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "stripe_event_id" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_audit_log" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."orphaned_users_needing_provisioning" WITH ("security_invoker"='on') AS
 SELECT "u"."id" AS "user_id",
    "u"."email",
    "u"."created_at" AS "user_created_at",
    ("now"() - "u"."created_at") AS "orphaned_duration",
    ("sc"."customer_id" IS NULL) AS "needs_customer",
    ("ss"."id" IS NULL) AS "needs_subscription",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscription_audit_log" "sal"
          WHERE (("sal"."user_id" = "u"."id") AND ("sal"."source" = ANY (ARRAY['create-free-customer'::"text", 'provision_trigger'::"text"])))) AS "provisioning_attempts"
   FROM (("auth"."users" "u"
     LEFT JOIN "public"."stripe_customers" "sc" ON ((("u"."id" = "sc"."user_id") AND ("sc"."deleted_at" IS NULL))))
     LEFT JOIN "public"."stripe_subscriptions" "ss" ON ((("u"."id" = "ss"."user_id") AND ("ss"."status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text"])))))
  WHERE (("sc"."customer_id" IS NULL) OR ("ss"."id" IS NULL))
  ORDER BY "u"."created_at" DESC;


ALTER VIEW "public"."orphaned_users_needing_provisioning" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."outcome_derivations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "requirement_row_id" "uuid" NOT NULL,
    "criteria_slice" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "proposed_by_kind" "text" NOT NULL,
    "proposed_by_id" "text",
    "via_proposal_id" "uuid",
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outcome_derivations_proposed_by_kind_check" CHECK (("proposed_by_kind" = ANY (ARRAY['human'::"text", 'agent'::"text"])))
);


ALTER TABLE "public"."outcome_derivations" OWNER TO "postgres";


COMMENT ON TABLE "public"."outcome_derivations" IS 'V3 (R5): one row per requirement DERIVED from an outcome candidate — the claimed criteria slice as a snapshot, the proposer (human user or agent credential), the carrying proposal, the approver. An outcome derives many; it stays pending until the owner settles it.';



COMMENT ON COLUMN "public"."outcome_derivations"."criteria_slice" IS 'Snapshot of the criteria this derivation claimed: [{id, text, verification?}]. Legacy criteria without ids resolve to the same text-hash id the server computes on the candidate, so claims match.';



COMMENT ON COLUMN "public"."outcome_derivations"."proposed_by_id" IS 'The proposer principal: a user id for a human, an MCP key id or OAuth client id for an agent (R7). Text because the two id spaces differ; not an FK by design.';



CREATE TABLE IF NOT EXISTS "public"."outcome_step_maps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "step_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."outcome_step_maps" OWNER TO "postgres";


COMMENT ON TABLE "public"."outcome_step_maps" IS 'V3 Ideation: which workflow steps an outcome candidate serves (ITEMS[].maps). Branch-scoped with its candidate; the workflow side is project-scoped.';



CREATE TABLE IF NOT EXISTS "public"."project_constraints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "ctype" "text" DEFAULT 'other'::"text" NOT NULL,
    "title" "text",
    "description" "text" NOT NULL,
    "rationale" "text",
    "author" "text",
    "mark" "text",
    "workflow_id" "uuid",
    "source_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'guide'::"text" NOT NULL,
    "scope_kind" "text" DEFAULT 'project'::"text" NOT NULL,
    "scope_value" "text",
    "check_spec" "jsonb",
    "waivers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "stats" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "origin" "jsonb",
    CONSTRAINT "chk_project_constraints_mark" CHECK ((("mark" IS NULL) OR ("mark" ~ '^[A-Z0-9][A-Z0-9 /\-]{0,63}$'::"text"))),
    CONSTRAINT "project_constraints_check_spec_check" CHECK (((("kind" = 'guide'::"text") AND ("check_spec" IS NULL)) OR (("kind" = 'check'::"text") AND ("jsonb_typeof"("check_spec") = 'object'::"text") AND (("check_spec" ->> 'predicate'::"text") = ANY (ARRAY['contract_has_schema'::"text", 'no_calls_between_roles'::"text", 'technology_in_list'::"text", 'sync_calls_at_most'::"text"])) AND (("check_spec" ->> 'severity'::"text") = ANY (ARRAY['warn'::"text", 'refuse'::"text"]))))),
    CONSTRAINT "project_constraints_ctype_check" CHECK (("ctype" = ANY (ARRAY['technology'::"text", 'architecture'::"text", 'deployment'::"text", 'performance'::"text", 'security'::"text", 'compliance'::"text", 'cost'::"text", 'other'::"text"]))),
    CONSTRAINT "project_constraints_kind_check" CHECK (("kind" = ANY (ARRAY['guide'::"text", 'check'::"text"]))),
    CONSTRAINT "project_constraints_scope_check" CHECK ((("scope_kind" = ANY (ARRAY['project'::"text", 'workflow'::"text", 'role'::"text", 'technology'::"text", 'contract_kind'::"text", 'node'::"text"])) AND (("scope_kind" = 'workflow'::"text") = ("workflow_id" IS NOT NULL)) AND (("scope_kind" = ANY (ARRAY['project'::"text", 'workflow'::"text"])) = ("scope_value" IS NULL)))),
    CONSTRAINT "project_constraints_waivers_check" CHECK ((("jsonb_typeof"("waivers") = 'array'::"text") AND ("jsonb_typeof"("stats") = 'object'::"text")))
);


ALTER TABLE "public"."project_constraints" OWNER TO "postgres";


COMMENT ON TABLE "public"."project_constraints" IS 'V3 constraints rail (ruling R2): one row per constraint with author/mark/lane. Expand half of expand/contract — project_specifications.constraints jsonb remains the write surface until the UI/MCP cutover holds.';



COMMENT ON COLUMN "public"."project_constraints"."mark" IS 'V3 7.3 (R2 carried it): classification mark on this constraint — visible only to the owner and to cleared seats.';



COMMENT ON COLUMN "public"."project_constraints"."source_hash" IS 'Deterministic identity md5(project|type|description) so the jsonb backfill is idempotent across replays.';



COMMENT ON COLUMN "public"."project_constraints"."kind" IS 'R.2b: guide (prose into the packets in scope) or check (a closed predicate evaluated on the graph).';



COMMENT ON COLUMN "public"."project_constraints"."scope_kind" IS 'R.2b: project, workflow (workflow_id set, Indie and above), role, technology, contract_kind or node.';



COMMENT ON COLUMN "public"."project_constraints"."check_spec" IS 'R.2b: { predicate, params, severity } of the closed vocabulary; null for guidance.';



COMMENT ON COLUMN "public"."project_constraints"."waivers" IS 'R.2b: [{ id, target, reason, owner, expiresAt, at }]: a node or edge the check does not hold against.';



COMMENT ON COLUMN "public"."project_constraints"."stats" IS 'R.2c: { fired, violated, waived, lastFiredAt }, moved by constraints_count() only.';



COMMENT ON COLUMN "public"."project_constraints"."origin" IS 'R.2c: where it came from in this project: { source, proposalId, gap, nodeIds }.';



CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "clearance" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "project_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'maintainer'::"text", 'contributor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."project_members" IS 'V3 7.0 (Membership): one row per (project, user) with a role — owner | maintainer | contributor | viewer. The project''s owner is projects.owner_id, implicit and never a roster row. Every project-scoped policy resolves through is_project_member; read tools need viewer, propose/write tools contributor, the roster is owner-only; approving is the owner''s on any channel and a maintainer''s in person only.';



COMMENT ON COLUMN "public"."project_members"."role" IS 'owner (co-owner, reserved — the tools do not grant it), maintainer (edits, approves in person, updates the project row), contributor (edits and proposes), viewer (reads).';



COMMENT ON COLUMN "public"."project_members"."invited_by" IS 'Who granted the seat — the audit; null once that account is gone.';



COMMENT ON COLUMN "public"."project_members"."clearance" IS 'V3 7.3: the marks this seat may see, exactly (CUI//SP-PRVCY is its own mark). The owner is cleared for everything. Set by set_project_member (Government).';



CREATE TABLE IF NOT EXISTS "public"."project_specifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "vision" "text" NOT NULL,
    "constraints" "jsonb" DEFAULT '[]'::"jsonb",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "raw_input" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "locked_nodes" "jsonb" DEFAULT '[]'::"jsonb",
    "phase_status" "text" DEFAULT 'drafting_requirements'::"text" NOT NULL,
    CONSTRAINT "project_specifications_phase_status_check" CHECK (("phase_status" = ANY (ARRAY['drafting_requirements'::"text", 'requirements_confirmed'::"text", 'building_architecture'::"text", 'architecture_confirmed'::"text", 'generating_code'::"text", 'architecture_first'::"text"])))
);


ALTER TABLE "public"."project_specifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."project_specifications" IS 'Exactly one row per project (UNIQUE project_id, v3b 2026-09-13): vision, phase_status, locked_nodes and the legacy constraints/preferences jsonb the spec wizard wrote. Every specification_* table keys on this row''s id — the project hop is deliberate legacy.';



COMMENT ON COLUMN "public"."project_specifications"."created_by" IS 'The author. Defaults to auth.uid() (V3 K): the app''s person-path inserts (first vision, spec bootstrap) never sent it, and the v3p INSERT policy checks created_by = auth.uid(), so the first save on a fresh project was refused as an RLS violation.';



COMMENT ON COLUMN "public"."project_specifications"."locked_nodes" IS 'Array of architecture node IDs that are locked from AI modifications during refinement operations';



CREATE TABLE IF NOT EXISTS "public"."project_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "graph_data" "jsonb" NOT NULL,
    "thumbnail_url" "text",
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "technologies" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "node_count" integer DEFAULT 0 NOT NULL,
    "edge_count" integer DEFAULT 0 NOT NULL,
    "author_type" "text" DEFAULT 'official'::"text" NOT NULL,
    "author_id" "uuid",
    "is_public" boolean DEFAULT true NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "use_count" integer DEFAULT 0 NOT NULL,
    "version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "template_specification" "jsonb",
    "upvote_count" integer DEFAULT 0 NOT NULL,
    "repo_url" "text",
    CONSTRAINT "valid_author_type" CHECK (("author_type" = ANY (ARRAY['official'::"text", 'community'::"text"]))),
    CONSTRAINT "valid_category" CHECK (("category" = ANY (ARRAY['general'::"text", 'saas'::"text", 'e-commerce'::"text", 'microservices'::"text", 'iot'::"text", 'mobile'::"text", 'data-pipeline'::"text", 'real-time'::"text", 'ai-ml'::"text", 'devops'::"text"]))),
    CONSTRAINT "valid_edge_count" CHECK (("edge_count" >= 0)),
    CONSTRAINT "valid_graph_data" CHECK ((("graph_data" ? 'id'::"text") AND ("graph_data" ? 'schemaVersion'::"text") AND ("graph_data" ? 'nodes'::"text") AND ("graph_data" ? 'edges'::"text") AND ("graph_data" ? 'contracts'::"text") AND ("graph_data" ? 'artifacts'::"text") AND ("jsonb_typeof"(("graph_data" -> 'nodes'::"text")) = 'object'::"text") AND ("jsonb_typeof"(("graph_data" -> 'edges'::"text")) = 'object'::"text") AND ("jsonb_typeof"(("graph_data" -> 'contracts'::"text")) = 'object'::"text") AND ("jsonb_typeof"(("graph_data" -> 'artifacts'::"text")) = 'object'::"text"))),
    CONSTRAINT "valid_node_count" CHECK (("node_count" >= 0)),
    CONSTRAINT "valid_use_count" CHECK (("use_count" >= 0))
);


ALTER TABLE "public"."project_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."project_templates" IS 'Marketplace templates: graph_data + template_specification, author, visibility, counters (use_count, upvote_count). Hosted edition.';



COMMENT ON COLUMN "public"."project_templates"."template_specification" IS 'Optional specification blueprint containing vision, features, requirements, and node mappings. Applied when a user creates a project from this template.';



COMMENT ON COLUMN "public"."project_templates"."repo_url" IS 'Public source repository for this template. Official templates: owner-curated. Community templates: set by the author via the publish flow.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "automation_policy" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "projects_automation_code_pinned" CHECK ((COALESCE(("automation_policy" ->> 'code'::"text"), '0'::"text") = '0'::"text"))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON TABLE "public"."projects" IS 'Root of every tenant object. owner_id is the RLS anchor for the whole tree; automation_policy is the per-lane V3 autonomy policy (ask | propose | auto).';



COMMENT ON COLUMN "public"."projects"."automation_policy" IS 'V3 Autonomy settings, keyed by tier (candidates|requirements|architecture|tasks|tests|code), values 0=ask 1=propose 2=auto. Empty = today''s effective routing, resolved in code. code is pinned to 0 by CHECK: NodeSpec never writes code.';



CREATE TABLE IF NOT EXISTS "public"."repo_index" (
    "branch_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "node_id" "text",
    "blob_sha" "text",
    "role" "text",
    "language" "text",
    "framework" "text",
    "artifact_kind" "text",
    "size" integer DEFAULT 0 NOT NULL,
    "signals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "fan_in" integer DEFAULT 0 NOT NULL,
    "fan_out" integer DEFAULT 0 NOT NULL,
    "centrality" real DEFAULT 0 NOT NULL,
    "content_ref" "text",
    "indexed_at_sha" "text",
    "classifier_version" integer DEFAULT 1 NOT NULL,
    "extractor_version" integer DEFAULT 6 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_text" "text" GENERATED ALWAYS AS ((("path" || ' '::"text") || COALESCE(("signals")::"text", ''::"text"))) STORED
);


ALTER TABLE "public"."repo_index" OWNER TO "postgres";


COMMENT ON TABLE "public"."repo_index" IS 'One row per imported file per branch. node_id = binding (100% coverage); content never here (content_ref → Storage).';



COMMENT ON COLUMN "public"."repo_index"."node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (text form — the import lane carries node ids as text).';



COMMENT ON COLUMN "public"."repo_index"."classifier_version" IS 'Equals CLASSIFIER_VERSION (file-classifier.ts) when the row was classified; a bump marks rows stale for re-classification.';



COMMENT ON COLUMN "public"."repo_index"."extractor_version" IS 'Equals EXTRACTOR_VERSION (import-signals.ts) when signals were extracted; a bump marks rows stale for re-extraction.';



COMMENT ON COLUMN "public"."repo_index"."search_text" IS 'RI-8: path + signals text for search. Indexed by tsvector GIN only (idx_repo_index_search_fts); the trigram GIN over it was dropped 2026-09-06 — it was two thirds of the paged index write cost.';



CREATE TABLE IF NOT EXISTS "public"."repo_index_edges" (
    "branch_id" "uuid" NOT NULL,
    "from_path" "text" NOT NULL,
    "to_path" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."repo_index_edges" OWNER TO "postgres";


COMMENT ON TABLE "public"."repo_index_edges" IS 'Resolved file→file relationships (kind: import | http-call | schema-ref | manifest-dep). Indexed both directions; ranking and traversal are SQL.';



CREATE TABLE IF NOT EXISTS "public"."repo_index_freshness" (
    "branch_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "status" "text" NOT NULL,
    "node_id" "text",
    "head_sha" "text",
    "blob_sha" "text",
    "refreshed" boolean DEFAULT false NOT NULL,
    "detected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "repo_index_freshness_status_check" CHECK (("status" = ANY (ARRAY['added'::"text", 'modified'::"text", 'deleted'::"text", 'unverified'::"text"])))
);


ALTER TABLE "public"."repo_index_freshness" OWNER TO "postgres";


COMMENT ON TABLE "public"."repo_index_freshness" IS 'RI-9: files whose blob sha moved since the indexed head, node-attributed; refreshed = signals re-extracted since detection.';



COMMENT ON COLUMN "public"."repo_index_freshness"."node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (text form, import lane).';



CREATE TABLE IF NOT EXISTS "public"."requirement_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "node_id" "text",
    "key" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT 'functional'::"text" NOT NULL,
    "criteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requirement_row_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "mark" "text",
    "workflow_id" "uuid" NOT NULL,
    CONSTRAINT "chk_requirement_candidates_mark" CHECK ((("mark" IS NULL) OR ("mark" ~ '^[A-Z0-9][A-Z0-9 /\-]{0,63}$'::"text"))),
    CONSTRAINT "requirement_candidates_category_check" CHECK (("category" = ANY (ARRAY['functional'::"text", 'non-functional'::"text", 'technical'::"text", 'business'::"text"]))),
    CONSTRAINT "requirement_candidates_kind_check" CHECK (("kind" = ANY (ARRAY['api'::"text", 'data'::"text", 'behavior'::"text", 'outcome'::"text"]))),
    CONSTRAINT "requirement_candidates_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."requirement_candidates" OWNER TO "postgres";


COMMENT ON TABLE "public"."requirement_candidates" IS 'RI-10: deterministic requirement candidates from repo-index evidence, STAGED for review; accepted rows name the requirement they became.';



COMMENT ON COLUMN "public"."requirement_candidates"."node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (text form); NULL for ideation-born outcomes.';



COMMENT ON COLUMN "public"."requirement_candidates"."key" IS 'Stable evidence identity (api:<node>:<resource> | data:<node> | behavior:<node>:<test path>); regeneration refreshes pending rows by key and never touches decided ones.';



COMMENT ON COLUMN "public"."requirement_candidates"."requirement_row_id" IS 'The FIRST derivation (write-once since v3l; nulled only by cascade). Every derivation, including this one, lives in outcome_derivations.';



COMMENT ON COLUMN "public"."requirement_candidates"."mark" IS 'V3 7.3: classification mark (handling caveat) on this outcome — e.g. CUI or CUI//SP-PRVCY. Visible only to the owner and to seats whose clearance holds the exact mark.';



COMMENT ON COLUMN "public"."requirement_candidates"."workflow_id" IS 'v3v: the outcome''s HOME workflow (exactly one; RESTRICT on lane delete). Step maps may still touch other lanes'' steps — the JOIN seam — that touch is not a home.';



CREATE TABLE IF NOT EXISTS "public"."scope_archetypes" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text" NOT NULL,
    "detection_signals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "spec_guidance" "text" DEFAULT ''::"text" NOT NULL,
    "feature_guidance" "text" DEFAULT ''::"text" NOT NULL,
    "architecture_guidance" "text" DEFAULT ''::"text" NOT NULL,
    "relevant_categories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "requirement_count_range" "jsonb" DEFAULT '{"max": 10, "min": 5}'::"jsonb" NOT NULL,
    "multi_archetype_feature_guidance" "text" DEFAULT ''::"text" NOT NULL,
    "multi_archetype_architecture_guidance" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scope_archetypes" OWNER TO "postgres";


COMMENT ON TABLE "public"."scope_archetypes" IS 'Project archetype catalog: detection_signals and per-archetype spec/feature/architecture guidance. Keep-list reference data (P0 0.5), island by design.';



CREATE TABLE IF NOT EXISTS "public"."specification_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "specification_id" "uuid" NOT NULL,
    "requirement_id" "uuid",
    "node_id" "uuid" NOT NULL,
    "mapping_type" "text" DEFAULT 'implements'::"text",
    "confidence" numeric DEFAULT 1.0,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "last_validated_at" timestamp with time zone,
    "is_orphan" boolean DEFAULT false NOT NULL,
    "artifact_ids" "jsonb" DEFAULT '[]'::"jsonb",
    "validation_status" "text" DEFAULT 'pending'::"text",
    "validation_provenance" "jsonb",
    CONSTRAINT "specification_mappings_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "specification_mappings_mapping_type_check" CHECK (("mapping_type" = ANY (ARRAY['implements'::"text", 'depends_on'::"text", 'validates'::"text", 'supports'::"text"]))),
    CONSTRAINT "specification_mappings_validation_status_check" CHECK (("validation_status" = ANY (ARRAY['pending'::"text", 'valid'::"text", 'needs-review'::"text", 'invalid'::"text"])))
);

ALTER TABLE ONLY "public"."specification_mappings" REPLICA IDENTITY FULL;


ALTER TABLE "public"."specification_mappings" OWNER TO "postgres";


COMMENT ON TABLE "public"."specification_mappings" IS 'Requirement → node traceability (mapping_type implements | depends_on | validates | supports, confidence). node_id is a soft reference into graph_snapshots; is_orphan is refreshed by sync_orphan_mappings when nodes disappear.';



COMMENT ON COLUMN "public"."specification_mappings"."node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (uuid form); is_orphan is refreshed when the node disappears.';



COMMENT ON COLUMN "public"."specification_mappings"."artifact_ids" IS 'Array of artifact UUIDs within the node that specifically implement this requirement. Empty array means all node artifacts are relevant.';



COMMENT ON COLUMN "public"."specification_mappings"."validation_status" IS 'Validation status of this mapping: pending (not yet validated), valid (confirmed correct), needs-review (may be incorrect), invalid (confirmed incorrect)';



COMMENT ON COLUMN "public"."specification_mappings"."validation_provenance" IS 'Audit trail for validation_status: {source, actor?, at, note?}. Written by mark_entity_complete (MCP) and future UI completion lanes. NULL = status never explicitly declared.';



CREATE TABLE IF NOT EXISTS "public"."specification_requirement_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "specification_id" "uuid" NOT NULL,
    "from_requirement_id" "uuid" NOT NULL,
    "to_requirement_id" "uuid" NOT NULL,
    "relation_type" "text" NOT NULL,
    "source" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "specification_requirement_relations_check" CHECK (("from_requirement_id" <> "to_requirement_id")),
    CONSTRAINT "specification_requirement_relations_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['expands'::"text", 'depends_on'::"text", 'relates_to'::"text"]))),
    CONSTRAINT "specification_requirement_relations_source_check" CHECK (("source" = ANY (ARRAY['user'::"text", 'ai'::"text"])))
);

ALTER TABLE ONLY "public"."specification_requirement_relations" REPLICA IDENTITY FULL;


ALTER TABLE "public"."specification_requirement_relations" OWNER TO "postgres";


COMMENT ON TABLE "public"."specification_requirement_relations" IS 'Requirement → requirement links: expands | depends_on | relates_to, with source user | ai. Supersession travels as expands.';



CREATE TABLE IF NOT EXISTS "public"."specification_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "specification_id" "uuid" NOT NULL,
    "requirement_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" DEFAULT 'functional'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "acceptance_criteria" "jsonb" DEFAULT '[]'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "section_id" "uuid",
    "source" "text" DEFAULT 'ai-generated'::"text" NOT NULL,
    "confirmed" boolean DEFAULT false,
    "architecture_trace" "jsonb" DEFAULT '[]'::"jsonb",
    "locked" boolean DEFAULT false,
    "mark" "text",
    "archived_at" timestamp with time zone,
    CONSTRAINT "chk_specification_requirements_mark" CHECK ((("mark" IS NULL) OR ("mark" ~ '^[A-Z0-9][A-Z0-9 /\-]{0,63}$'::"text"))),
    CONSTRAINT "specification_requirements_category_check" CHECK (("category" = ANY (ARRAY['functional'::"text", 'non-functional'::"text", 'technical'::"text", 'business'::"text"]))),
    CONSTRAINT "specification_requirements_source_check" CHECK (("source" = ANY (ARRAY['ai-generated'::"text", 'manual'::"text", 'refined'::"text", 'imported'::"text"]))),
    CONSTRAINT "specification_requirements_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in-progress'::"text", 'implemented'::"text", 'validated'::"text", 'blocked'::"text"])))
);

ALTER TABLE ONLY "public"."specification_requirements" REPLICA IDENTITY FULL;


ALTER TABLE "public"."specification_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."specification_requirements" IS 'The canonical requirement (REQ-xxx as requirement_id, row uuid as id). acceptance_criteria jsonb carries each criterion''s met state, testId binding and provenance; architecture_trace jsonb mirrors specification_mappings (dual-written — mappings are the relational truth).';



COMMENT ON COLUMN "public"."specification_requirements"."requirement_id" IS 'The display id (REQ-xxx), unique per specification — a label, not a reference. Rows reference each other by id (uuid).';



COMMENT ON COLUMN "public"."specification_requirements"."mark" IS 'V3 7.3: classification mark on this requirement — visible only to the owner and to cleared seats.';



COMMENT ON COLUMN "public"."specification_requirements"."archived_at" IS 'v3y: the human archive act (the app, or update_requirement { archived }). Done is derived; this is the explicit archive beside the derived lineage archive (D2).';



CREATE TABLE IF NOT EXISTS "public"."specification_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "specification_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "ai_generated" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_index_non_negative" CHECK (("order_index" >= 0))
);


ALTER TABLE "public"."specification_sections" OWNER TO "postgres";


COMMENT ON TABLE "public"."specification_sections" IS 'Named sections that group requirements inside a specification (order_index); created on demand by the requirement writers'' section argument.';



CREATE TABLE IF NOT EXISTS "public"."stripe_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkout_session_id" "text",
    "payment_intent_id" "text",
    "customer_id" "text" NOT NULL,
    "amount_subtotal" integer DEFAULT 0,
    "amount_total" integer DEFAULT 0,
    "currency" "text" DEFAULT 'usd'::"text",
    "payment_status" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "node_id" "uuid" NOT NULL,
    "task_key" "text" NOT NULL,
    "done" boolean DEFAULT false NOT NULL,
    "provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "display_id" "text",
    "title" "text",
    "orphaned" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mark" "text",
    CONSTRAINT "chk_task_items_mark" CHECK ((("mark" IS NULL) OR ("mark" ~ '^[A-Z0-9][A-Z0-9 /\-]{0,63}$'::"text"))),
    CONSTRAINT "task_items_task_key_check" CHECK ((("char_length"("task_key") >= 1) AND ("char_length"("task_key") <= 64)))
);

ALTER TABLE ONLY "public"."task_items" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_items" IS 'Done-state + provenance for anchored implementation tasks (<!-- t:key --> in .task.md). State only — the task list always derives from the doc; orphaned marks keys the generator no longer emits.';



COMMENT ON COLUMN "public"."task_items"."node_id" IS 'Soft reference to a node in graph_snapshots.graph_data (uuid form); orphaned flips when the node disappears.';



COMMENT ON COLUMN "public"."task_items"."display_id" IS 'The display id (T1, T2 …) shown in task documents — a label, not a reference; task_key is the stable anchor.';



COMMENT ON COLUMN "public"."task_items"."mark" IS 'V3 7.3: classification mark on this task — visible only to the owner and to cleared seats.';



CREATE TABLE IF NOT EXISTS "public"."technology_catalog" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "icon_url" "text",
    "brand_color" "text" DEFAULT '#6b7280'::"text" NOT NULL,
    "role_affinities" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ai_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "suggested_files" "jsonb" DEFAULT '[]'::"jsonb",
    "metadata_schema" "jsonb" DEFAULT '{}'::"jsonb",
    "common_connections" "jsonb" DEFAULT '[]'::"jsonb",
    "is_user_contributed" boolean DEFAULT false NOT NULL,
    "project_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text",
    "secondary_color" "text",
    "search_vector" "tsvector",
    CONSTRAINT "system_entries_have_no_project" CHECK (((("is_user_contributed" = false) AND ("project_id" IS NULL)) OR ("is_user_contributed" = true)))
);


ALTER TABLE "public"."technology_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."technology_catalog" IS 'Technology catalog (id is the key graph nodes carry): role_affinities into node_roles, ai_context for task packets, search_vector for the palette. project_id/created_by are set only on user-contributed rows.';



CREATE TABLE IF NOT EXISTS "public"."template_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "template_comments_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 4000)))
);


ALTER TABLE "public"."template_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."template_comments" IS 'Flat user comments on marketplace templates (hosted edition). Edited = updated_at > created_at.';



CREATE TABLE IF NOT EXISTS "public"."template_upvotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."template_upvotes" OWNER TO "postgres";


COMMENT ON TABLE "public"."template_upvotes" IS 'One upvote per user per template; the counter on project_templates is maintained by the increment/decrement functions.';



CREATE TABLE IF NOT EXISTS "public"."template_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."template_usage" OWNER TO "postgres";


COMMENT ON TABLE "public"."template_usage" IS 'One row per template application (template, user, and the project it seeded — project_id nulls when that project is deleted).';



CREATE TABLE IF NOT EXISTS "public"."test_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requirement_id" "uuid" NOT NULL,
    "test_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "test_type" "text" DEFAULT 'unit'::"text",
    "status" "text" DEFAULT 'not_started'::"text",
    "implementation" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "expected_result" "text",
    "framework" "text",
    "artifact_id" "uuid",
    "artifact_path" "text",
    "source_artifact_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "source_context_hash" "text",
    "stale" boolean DEFAULT false NOT NULL,
    "staleness_reason" "text",
    "retired_at" timestamp with time zone,
    "retired_reason" "text",
    "mark" "text",
    CONSTRAINT "chk_test_cases_mark" CHECK ((("mark" IS NULL) OR ("mark" ~ '^[A-Z0-9][A-Z0-9 /\-]{0,63}$'::"text"))),
    CONSTRAINT "test_cases_framework_check" CHECK ((("framework" IS NULL) OR ("framework" = ANY (ARRAY['vitest'::"text", 'jest'::"text", 'mocha'::"text", 'playwright'::"text", 'cypress'::"text", 'puppeteer'::"text", 'k6'::"text", 'artillery'::"text", 'pytest'::"text", 'unittest'::"text", 'go_test'::"text", 'rspec'::"text", 'minitest'::"text", 'junit'::"text", 'testng'::"text", 'nunit'::"text", 'xunit'::"text", 'swift_testing'::"text", 'xctest'::"text", 'dart_test'::"text", 'rust_test'::"text", 'elixir_exunit'::"text", 'other'::"text"])))),
    CONSTRAINT "test_cases_status_check" CHECK (("status" = ANY (ARRAY['not_started'::"text", 'passed'::"text", 'failed'::"text", 'skipped'::"text", 'running'::"text"]))),
    CONSTRAINT "test_cases_test_type_check" CHECK (("test_type" = ANY (ARRAY['unit'::"text", 'integration'::"text", 'e2e'::"text", 'acceptance'::"text", 'performance'::"text", 'security'::"text"])))
);

ALTER TABLE ONLY "public"."test_cases" REPLICA IDENTITY FULL;


ALTER TABLE "public"."test_cases" OWNER TO "postgres";


COMMENT ON TABLE "public"."test_cases" IS 'One binding test per criterion (test_id TC-xxx, requirement_id FK): status from report_test_results, artifact_id/artifact_path the implementing file, source_artifact_ids + source_context_hash for evidence staleness, retired_at instead of delete.';



COMMENT ON COLUMN "public"."test_cases"."test_id" IS 'The display id (TC-xxx), unique per requirement — a label, not a reference.';



COMMENT ON COLUMN "public"."test_cases"."source_artifact_ids" IS 'Soft references to artifacts.id: the files whose content hash the case was proven against (staleness evidence); artifacts may be deleted independently.';



COMMENT ON COLUMN "public"."test_cases"."retired_at" IS 'Soft-retirement timestamp (update_test_case retire lane). NULL = live. Retired cases are excluded from count/board surfaces but never deleted — evidence is preserved. A fresh report_test_results run revives the case (clears this).';



COMMENT ON COLUMN "public"."test_cases"."retired_reason" IS 'Why the case was retired (required by the retire lane, e.g. "superseded by TC-004"). Cleared on revival.';



COMMENT ON COLUMN "public"."test_cases"."mark" IS 'V3 7.3: classification mark on this test — visible only to the owner and to cleared seats.';



CREATE TABLE IF NOT EXISTS "public"."user_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" "text" DEFAULT 'general'::"text" NOT NULL,
    "rating" integer,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_feedback" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_feedback" IS 'In-app feedback (type, rating, message).';



CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "user_id" "uuid" NOT NULL,
    "handle" "text" NOT NULL,
    "display_name" "text",
    "bio" "text",
    "avatar_url" "text",
    "website_url" "text",
    "github_url" "text",
    "socials" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reserved_handle" CHECK (("handle" <> ALL (ARRAY['admin'::"text", 'nodespec'::"text", 'official'::"text", 'api'::"text", 'app'::"text", 'templates'::"text", 'blog'::"text", 'pricing'::"text", 'settings'::"text", 'support'::"text", 'u'::"text", 'www'::"text", 'root'::"text", 'moderator'::"text", 'help'::"text", 'about'::"text", 'terms'::"text", 'privacy'::"text", 'docs'::"text", 'government'::"text"]))),
    CONSTRAINT "valid_bio" CHECK ((("bio" IS NULL) OR ("char_length"("bio") <= 500))),
    CONSTRAINT "valid_display_name" CHECK ((("display_name" IS NULL) OR ("char_length"("display_name") <= 80))),
    CONSTRAINT "valid_handle" CHECK (("handle" ~ '^[a-z0-9][a-z0-9-]{2,29}$'::"text"))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_profiles" IS 'Public author identity for the hosted marketplace (/u/<handle>). The only client-readable source of user display data.';



CREATE TABLE IF NOT EXISTS "public"."user_settings" (
    "user_id" "uuid" NOT NULL,
    "is_admin" boolean DEFAULT false,
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "has_seen_onboarding" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_settings" IS 'Per-user app settings: is_admin (read by is_admin() in RLS), preferences jsonb, onboarding flag, and the BYO-model provider/model selection used by the repo-import summariser.';



COMMENT ON COLUMN "public"."user_settings"."is_admin" IS 'Not an authorization source: a person writes their own settings row. Admin is the token''s app_metadata.is_admin, read by public.is_admin().';



CREATE TABLE IF NOT EXISTS "public"."work_exports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "item_kind" "text" NOT NULL,
    "node_id" "uuid",
    "item_key" "text" NOT NULL,
    "target" "text" NOT NULL,
    "external_id" "text",
    "external_url" "text",
    "payload_hash" "text" NOT NULL,
    "status" "text" NOT NULL,
    "error" "text",
    "exported_by" "uuid",
    "exported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "work_exports_item_kind_check" CHECK (("item_kind" = ANY (ARRAY['task'::"text", 'test'::"text"]))),
    CONSTRAINT "work_exports_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "work_exports_target_check" CHECK (("target" = ANY (ARRAY['slack'::"text", 'jira'::"text", 'notion'::"text"])))
);


ALTER TABLE "public"."work_exports" OWNER TO "postgres";


COMMENT ON TABLE "public"."work_exports" IS 'V3 P6 (PRI-4, Team): one live export per (item, target) to Slack / Jira / Notion; a re-export with the same payload_hash is a no-op. Ships ahead of its UI (R3). Owners read; the work-export function (service role) writes.';



COMMENT ON COLUMN "public"."work_exports"."node_id" IS 'The owning node of the exported task (uuid, the graph''s id) or the requirement''s mapped node for a test; NULL when the item has no node. Not an FK: nodes live in the graph snapshot, not a table.';



COMMENT ON COLUMN "public"."work_exports"."external_id" IS 'The target system''s own id for the exported item (Slack ts, Jira issue key, Notion page id) — a foreign identity, not a NodeSpec reference.';



CREATE TABLE IF NOT EXISTS "public"."work_plan_edges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "from_item" "uuid" NOT NULL,
    "to_item" "uuid" NOT NULL,
    "coupling" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "decision" "text",
    CONSTRAINT "work_plan_edges_coupling_check" CHECK (("coupling" = ANY (ARRAY['tight'::"text", 'loose'::"text"]))),
    CONSTRAINT "work_plan_edges_no_self_loop" CHECK (("from_item" <> "to_item"))
);


ALTER TABLE "public"."work_plan_edges" OWNER TO "postgres";


COMMENT ON TABLE "public"."work_plan_edges" IS 'V3 P6 (PRI): classified precedence between two items of one plan — tight (hard; the plan may not invert it) or loose (advisory) — with the reason, the evidence, and the decision that answered a tight cycle (cycles are questions, never guesses).';



CREATE TABLE IF NOT EXISTS "public"."work_plan_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "item_kind" "text" NOT NULL,
    "node_id" "uuid",
    "item_key" "text" NOT NULL,
    "rank" integer NOT NULL,
    "layer" integer DEFAULT 0 NOT NULL,
    "effort" numeric(8,2) DEFAULT 1 NOT NULL,
    "earliest_start" numeric(10,2) DEFAULT 0 NOT NULL,
    "slack" numeric(10,2) DEFAULT 0 NOT NULL,
    "on_critical_path" boolean DEFAULT false NOT NULL,
    "rationale" "text",
    "status_snapshot" "text",
    CONSTRAINT "work_plan_items_earliest_start_check" CHECK (("earliest_start" >= (0)::numeric)),
    CONSTRAINT "work_plan_items_effort_check" CHECK (("effort" >= (0)::numeric)),
    CONSTRAINT "work_plan_items_item_key_check" CHECK ((("char_length"("item_key") >= 1) AND ("char_length"("item_key") <= 200))),
    CONSTRAINT "work_plan_items_item_kind_check" CHECK (("item_kind" = ANY (ARRAY['task'::"text", 'test'::"text"]))),
    CONSTRAINT "work_plan_items_layer_check" CHECK (("layer" >= 0)),
    CONSTRAINT "work_plan_items_rank_check" CHECK (("rank" >= 0)),
    CONSTRAINT "work_plan_items_slack_check" CHECK (("slack" >= (0)::numeric)),
    CONSTRAINT "work_plan_items_task_has_node" CHECK ((("item_kind" <> 'task'::"text") OR ("node_id" IS NOT NULL)))
);


ALTER TABLE "public"."work_plan_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."work_plan_items" IS 'V3 P6 (PRI): the ordered work of one plan — (item_kind, node_id, item_key) with the engine''s numbers (rank = the work order, layer, effort, earliest_start, slack, on_critical_path) and the AI''s rationale. get_work_queue reads the accepted plan''s task rows by (node_id, item_key) → rank.';



COMMENT ON COLUMN "public"."work_plan_items"."node_id" IS 'The owning node for a task (required); the requirement''s mapped node for a test, or NULL when the requirement maps nowhere. Text-typed node ids elsewhere are the graph''s; this column is the uuid the graph and task_items carry.';



COMMENT ON COLUMN "public"."work_plan_items"."item_key" IS 'The task anchor key (<!-- t:key -->) for a task; the test_cases.test_id for a test.';



CREATE TABLE IF NOT EXISTS "public"."work_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "generated_by" "text" DEFAULT 'ai'::"text" NOT NULL,
    "source_hash" "text" NOT NULL,
    "summary" "text",
    "proposed_by" "text",
    "created_by" "uuid",
    "accepted_by" "uuid",
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "work_plans_generated_by_check" CHECK (("generated_by" = ANY (ARRAY['ai'::"text", 'user'::"text"]))),
    CONSTRAINT "work_plans_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'accepted'::"text", 'superseded'::"text", 'rejected'::"text"]))),
    CONSTRAINT "work_plans_version_check" CHECK (("version" >= 1))
);


ALTER TABLE "public"."work_plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."work_plans" IS 'V3 P6 (PRI): one row per work-plan version on a branch — proposed by the AI or the user, accepted by the user, superseded by the next accepted plan. ONE accepted plan per branch. Owners read; the MCP tools (service role) write. Realtime.';



COMMENT ON COLUMN "public"."work_plans"."source_hash" IS 'Hash of the task-doc anchors + test ids the plan was built over — a regenerated doc marks the plan stale (the board says so instead of ordering vanished work).';



COMMENT ON COLUMN "public"."work_plans"."proposed_by" IS 'The proposing principal (R7): a user id for a human, an MCP key id or OAuth client id for an agent — text because the id spaces differ; not an FK by design.';



CREATE TABLE IF NOT EXISTS "public"."workflow_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_steps" OWNER TO "postgres";


COMMENT ON TABLE "public"."workflow_steps" IS 'Ordered steps within a workflow lane (LANES[].steps). Outcome cards map onto steps via outcome_step_maps.';



CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "owner_label" "text",
    "contributors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'workflow'::"text" NOT NULL,
    CONSTRAINT "workflows_kind_check" CHECK (("kind" = ANY (ARRAY['workflow'::"text", 'imported'::"text", 'change'::"text"])))
);


ALTER TABLE "public"."workflows" OWNER TO "postgres";


COMMENT ON TABLE "public"."workflows" IS 'V3 Ideation lanes: business workflows per project (Workflow Space LANES). Project-scoped by ruling — stable across branches; candidate↔step maps carry the branch scope.';



COMMENT ON COLUMN "public"."workflows"."kind" IS 'V3 6.6 + AA.2: workflow (a lane a person works in), imported (the one system lane the home-lane trigger homes import-born candidates in; drawn as the aside''s Imported row, never as a workflow) or change (a change a person is making to an imported system: migrate, harden, change a component, extend; drawn as a workflow, its steps from the intent''s template).';



ALTER TABLE ONLY "public"."cloud_provider_patterns" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cloud_provider_patterns_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_proposal_artifacts"
    ADD CONSTRAINT "ai_proposal_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_proposal_artifacts"
    ADD CONSTRAINT "ai_proposal_artifacts_proposal_id_artifact_id_key" UNIQUE ("proposal_id", "artifact_id");



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_sessions"
    ADD CONSTRAINT "app_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_categories"
    ADD CONSTRAINT "blog_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."blog_categories"
    ADD CONSTRAINT "blog_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_categories"
    ADD CONSTRAINT "blog_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."blog_post_categories"
    ADD CONSTRAINT "blog_post_categories_pkey" PRIMARY KEY ("post_id", "category_id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_project_id_name_key" UNIQUE ("project_id", "name");



ALTER TABLE ONLY "public"."bug_reports"
    ADD CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cloud_provider_patterns"
    ADD CONSTRAINT "cloud_provider_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cloud_provider_patterns"
    ADD CONSTRAINT "cloud_provider_patterns_provider_archetype_key" UNIQUE ("provider", "archetype");



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deployment_settings"
    ADD CONSTRAINT "deployment_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deployment_targets"
    ADD CONSTRAINT "deployment_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enterprise_contact_requests"
    ADD CONSTRAINT "enterprise_contact_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."git_integrations"
    ADD CONSTRAINT "git_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."git_integrations"
    ADD CONSTRAINT "git_integrations_project_id_key" UNIQUE ("project_id");



ALTER TABLE ONLY "public"."git_sync_log"
    ADD CONSTRAINT "git_sync_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."graph_patches"
    ADD CONSTRAINT "graph_patches_branch_id_sequence_key" UNIQUE ("branch_id", "sequence");



ALTER TABLE ONLY "public"."graph_patches"
    ADD CONSTRAINT "graph_patches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."graph_snapshots"
    ADD CONSTRAINT "graph_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_edge_kind_map"
    ADD CONSTRAINT "import_edge_kind_map_pkey" PRIMARY KEY ("evidence_kind");



ALTER TABLE ONLY "public"."import_job_edges"
    ADD CONSTRAINT "import_job_edges_pkey" PRIMARY KEY ("job_id", "from_path", "to_path", "kind");



ALTER TABLE ONLY "public"."import_job_files"
    ADD CONSTRAINT "import_job_files_pkey" PRIMARY KEY ("job_id", "path");



ALTER TABLE ONLY "public"."import_job_group_edges"
    ADD CONSTRAINT "import_job_group_edges_pkey" PRIMARY KEY ("job_id", "from_group_idx", "to_group_idx", "kind");



ALTER TABLE ONLY "public"."import_job_groups"
    ADD CONSTRAINT "import_job_groups_pkey" PRIMARY KEY ("job_id", "group_idx");



ALTER TABLE ONLY "public"."import_job_rank"
    ADD CONSTRAINT "import_job_rank_pkey" PRIMARY KEY ("job_id", "path");



ALTER TABLE ONLY "public"."import_job_waves"
    ADD CONSTRAINT "import_job_waves_pkey" PRIMARY KEY ("job_id", "wave", "member");



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_api_keys"
    ADD CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_oauth_codes"
    ADD CONSTRAINT "mcp_oauth_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."mcp_oauth_codes"
    ADD CONSTRAINT "mcp_oauth_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_oauth_tokens"
    ADD CONSTRAINT "mcp_oauth_tokens_access_token_hash_key" UNIQUE ("access_token_hash");



ALTER TABLE ONLY "public"."mcp_oauth_tokens"
    ADD CONSTRAINT "mcp_oauth_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_rate_buckets"
    ADD CONSTRAINT "mcp_rate_buckets_pkey" PRIMARY KEY ("holder");



ALTER TABLE ONLY "public"."node_dependencies"
    ADD CONSTRAINT "node_dependencies_pkey" PRIMARY KEY ("branch_id", "from_node_id", "to_node_id", "kind");



ALTER TABLE ONLY "public"."node_roles"
    ADD CONSTRAINT "node_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_candidate_id_requirement_row_id_key" UNIQUE ("candidate_id", "requirement_row_id");



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outcome_step_maps"
    ADD CONSTRAINT "outcome_step_maps_candidate_id_step_id_key" UNIQUE ("candidate_id", "step_id");



ALTER TABLE ONLY "public"."outcome_step_maps"
    ADD CONSTRAINT "outcome_step_maps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_constraints"
    ADD CONSTRAINT "project_constraints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_constraints"
    ADD CONSTRAINT "project_constraints_project_id_source_hash_key" UNIQUE ("project_id", "source_hash");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_project_id_key" UNIQUE ("project_id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_index_edges"
    ADD CONSTRAINT "repo_index_edges_pkey" PRIMARY KEY ("branch_id", "from_path", "to_path", "kind");



ALTER TABLE ONLY "public"."repo_index_freshness"
    ADD CONSTRAINT "repo_index_freshness_pkey" PRIMARY KEY ("branch_id", "path");



ALTER TABLE ONLY "public"."repo_index"
    ADD CONSTRAINT "repo_index_pkey" PRIMARY KEY ("branch_id", "path");



ALTER TABLE ONLY "public"."requirement_candidates"
    ADD CONSTRAINT "requirement_candidates_branch_id_key_key" UNIQUE ("branch_id", "key");



ALTER TABLE ONLY "public"."requirement_candidates"
    ADD CONSTRAINT "requirement_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scope_archetypes"
    ADD CONSTRAINT "scope_archetypes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."specification_mappings"
    ADD CONSTRAINT "specification_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."specification_requirement_relations"
    ADD CONSTRAINT "specification_requirement_rel_from_requirement_id_to_requir_key" UNIQUE ("from_requirement_id", "to_requirement_id", "relation_type");



ALTER TABLE ONLY "public"."specification_requirement_relations"
    ADD CONSTRAINT "specification_requirement_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."specification_requirements"
    ADD CONSTRAINT "specification_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."specification_requirements"
    ADD CONSTRAINT "specification_requirements_specification_id_requirement_id_key" UNIQUE ("specification_id", "requirement_id");



ALTER TABLE ONLY "public"."specification_sections"
    ADD CONSTRAINT "specification_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_orders"
    ADD CONSTRAINT "stripe_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_subscriptions"
    ADD CONSTRAINT "stripe_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_audit_log"
    ADD CONSTRAINT "subscription_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_items"
    ADD CONSTRAINT "task_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_items"
    ADD CONSTRAINT "task_items_project_id_node_id_task_key_key" UNIQUE ("project_id", "node_id", "task_key");



ALTER TABLE ONLY "public"."technology_catalog"
    ADD CONSTRAINT "technology_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_comments"
    ADD CONSTRAINT "template_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_upvotes"
    ADD CONSTRAINT "template_upvotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_upvotes"
    ADD CONSTRAINT "template_upvotes_template_id_user_id_key" UNIQUE ("template_id", "user_id");



ALTER TABLE ONLY "public"."template_usage"
    ADD CONSTRAINT "template_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_cases"
    ADD CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_cases"
    ADD CONSTRAINT "test_cases_requirement_id_test_id_key" UNIQUE ("requirement_id", "test_id");



ALTER TABLE ONLY "public"."user_feedback"
    ADD CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."work_exports"
    ADD CONSTRAINT "work_exports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_plan_edges"
    ADD CONSTRAINT "work_plan_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_plan_edges"
    ADD CONSTRAINT "work_plan_edges_plan_id_from_item_to_item_key" UNIQUE ("plan_id", "from_item", "to_item");



ALTER TABLE ONLY "public"."work_plan_items"
    ADD CONSTRAINT "work_plan_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_plans"
    ADD CONSTRAINT "work_plans_branch_id_version_key" UNIQUE ("branch_id", "version");



ALTER TABLE ONLY "public"."work_plans"
    ADD CONSTRAINT "work_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_project_id_name_key" UNIQUE ("project_id", "name");



CREATE INDEX "app_sessions_last_seen_idx" ON "public"."app_sessions" USING "btree" ("last_seen_at" DESC);



CREATE INDEX "app_sessions_user_started_idx" ON "public"."app_sessions" USING "btree" ("user_id", "started_at" DESC);



CREATE INDEX "idx_agent_checkouts_branch" ON "public"."agent_checkouts" USING "btree" ("branch_id");



CREATE INDEX "idx_agent_checkouts_candidate" ON "public"."agent_checkouts" USING "btree" ("candidate_id");



CREATE UNIQUE INDEX "idx_agent_checkouts_code_active" ON "public"."agent_checkouts" USING "btree" ("artifact_id") WHERE (("released_at" IS NULL) AND ("level" = 'code'::"text"));



CREATE UNIQUE INDEX "idx_agent_checkouts_criterion_active" ON "public"."agent_checkouts" USING "btree" ("requirement_id", "criterion_id") WHERE (("released_at" IS NULL) AND ("level" = 'criterion'::"text"));



CREATE INDEX "idx_agent_checkouts_holder_delegate" ON "public"."agent_checkouts" USING "btree" ("holder_delegate");



CREATE INDEX "idx_agent_checkouts_holder_key" ON "public"."agent_checkouts" USING "btree" ("holder_key_id");



CREATE UNIQUE INDEX "idx_agent_checkouts_node_active" ON "public"."agent_checkouts" USING "btree" ("project_id", "node_id") WHERE (("released_at" IS NULL) AND ("level" = 'node'::"text"));



CREATE INDEX "idx_agent_checkouts_node_inside" ON "public"."agent_checkouts" USING "btree" ("project_id", "node_id") WHERE ("released_at" IS NULL);



CREATE INDEX "idx_agent_checkouts_project_active" ON "public"."agent_checkouts" USING "btree" ("project_id") WHERE ("released_at" IS NULL);



CREATE INDEX "idx_agent_checkouts_proposal" ON "public"."agent_checkouts" USING "btree" ("proposal_id");



CREATE INDEX "idx_agent_checkouts_requirement" ON "public"."agent_checkouts" USING "btree" ("requirement_id");



CREATE UNIQUE INDEX "idx_agent_checkouts_task_active" ON "public"."agent_checkouts" USING "btree" ("task_item_id") WHERE (("released_at" IS NULL) AND ("level" = 'task'::"text"));



CREATE INDEX "idx_ai_proposal_artifacts_proposal_id" ON "public"."ai_proposal_artifacts" USING "btree" ("proposal_id");



CREATE INDEX "idx_ai_proposals_proposal_branch_id" ON "public"."ai_proposals" USING "btree" ("proposal_branch_id");



CREATE INDEX "idx_ai_runs_branch" ON "public"."ai_runs" USING "btree" ("branch_id", "started_at" DESC);



CREATE INDEX "idx_ai_runs_input_snapshot_id" ON "public"."ai_runs" USING "btree" ("input_snapshot_id");



CREATE INDEX "idx_ai_runs_project_id" ON "public"."ai_runs" USING "btree" ("project_id");



CREATE INDEX "idx_ai_runs_proposal" ON "public"."ai_runs" USING "btree" ("proposal_id");



CREATE INDEX "idx_artifacts_branch_id" ON "public"."artifacts" USING "btree" ("branch_id");



CREATE INDEX "idx_artifacts_content_hash" ON "public"."artifacts" USING "btree" ("content_hash");



CREATE INDEX "idx_artifacts_kind" ON "public"."artifacts" USING "btree" ("kind");



CREATE INDEX "idx_artifacts_language" ON "public"."artifacts" USING "btree" ("language");



CREATE INDEX "idx_artifacts_node_id" ON "public"."artifacts" USING "btree" ("node_id");



CREATE INDEX "idx_artifacts_path" ON "public"."artifacts" USING "btree" ("path");



CREATE INDEX "idx_artifacts_project" ON "public"."artifacts" USING "btree" ("project_id");



CREATE INDEX "idx_blog_categories_slug" ON "public"."blog_categories" USING "btree" ("slug");



CREATE INDEX "idx_blog_post_categories_category" ON "public"."blog_post_categories" USING "btree" ("category_id");



CREATE INDEX "idx_blog_posts_author_id" ON "public"."blog_posts" USING "btree" ("author_id");



CREATE INDEX "idx_blog_posts_published_at" ON "public"."blog_posts" USING "btree" ("published_at" DESC);



CREATE INDEX "idx_blog_posts_slug" ON "public"."blog_posts" USING "btree" ("slug");



CREATE INDEX "idx_blog_posts_status" ON "public"."blog_posts" USING "btree" ("status");



CREATE INDEX "idx_branches_base_snapshot_id" ON "public"."branches" USING "btree" ("base_snapshot_id");



CREATE INDEX "idx_branches_created_by" ON "public"."branches" USING "btree" ("created_by");



CREATE UNIQUE INDEX "idx_branches_one_primary" ON "public"."branches" USING "btree" ("project_id") WHERE "is_primary";



CREATE INDEX "idx_branches_project" ON "public"."branches" USING "btree" ("project_id");



CREATE INDEX "idx_bug_reports_created_at" ON "public"."bug_reports" USING "btree" ("created_at");



CREATE INDEX "idx_bug_reports_status" ON "public"."bug_reports" USING "btree" ("status");



CREATE INDEX "idx_bug_reports_user_id" ON "public"."bug_reports" USING "btree" ("user_id");



CREATE INDEX "idx_couplings_branch" ON "public"."couplings" USING "btree" ("branch_id");



CREATE INDEX "idx_couplings_created_by" ON "public"."couplings" USING "btree" ("created_by");



CREATE INDEX "idx_couplings_from_candidate" ON "public"."couplings" USING "btree" ("from_candidate_id");



CREATE INDEX "idx_couplings_from_requirement" ON "public"."couplings" USING "btree" ("from_requirement_id");



CREATE INDEX "idx_couplings_from_task_item" ON "public"."couplings" USING "btree" ("from_task_item_id");



CREATE INDEX "idx_couplings_to_candidate" ON "public"."couplings" USING "btree" ("to_candidate_id");



CREATE INDEX "idx_couplings_to_requirement" ON "public"."couplings" USING "btree" ("to_requirement_id");



CREATE INDEX "idx_couplings_to_task_item" ON "public"."couplings" USING "btree" ("to_task_item_id");



CREATE INDEX "idx_enterprise_contact_requests_created" ON "public"."enterprise_contact_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_enterprise_contact_requests_status" ON "public"."enterprise_contact_requests" USING "btree" ("status");



CREATE INDEX "idx_enterprise_contact_requests_user" ON "public"."enterprise_contact_requests" USING "btree" ("user_id");



CREATE INDEX "idx_git_change_events_created" ON "public"."git_change_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_git_change_events_integration_status" ON "public"."git_change_events" USING "btree" ("integration_id", "status");



CREATE INDEX "idx_git_change_events_project_status" ON "public"."git_change_events" USING "btree" ("project_id", "status");



CREATE INDEX "idx_git_change_events_resolved_by" ON "public"."git_change_events" USING "btree" ("resolved_by");



CREATE INDEX "idx_git_integrations_created_by" ON "public"."git_integrations" USING "btree" ("created_by");



CREATE INDEX "idx_git_integrations_project" ON "public"."git_integrations" USING "btree" ("project_id");



CREATE INDEX "idx_git_sync_log_branch" ON "public"."git_sync_log" USING "btree" ("branch_id", "started_at" DESC);



CREATE INDEX "idx_git_sync_log_integration" ON "public"."git_sync_log" USING "btree" ("integration_id", "started_at" DESC);



CREATE INDEX "idx_git_sync_log_project" ON "public"."git_sync_log" USING "btree" ("project_id");



CREATE INDEX "idx_git_sync_log_project_id" ON "public"."git_sync_log" USING "btree" ("project_id");



CREATE INDEX "idx_graph_snapshots_project_id" ON "public"."graph_snapshots" USING "btree" ("project_id");



CREATE INDEX "idx_import_job_edges_to" ON "public"."import_job_edges" USING "btree" ("job_id", "to_path");



CREATE INDEX "idx_import_job_files_group" ON "public"."import_job_files" USING "btree" ("job_id", "group_idx");



CREATE INDEX "idx_import_jobs_branch" ON "public"."import_jobs" USING "btree" ("branch_id") WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "idx_import_jobs_integration" ON "public"."import_jobs" USING "btree" ("integration_id");



CREATE INDEX "idx_import_jobs_project_status" ON "public"."import_jobs" USING "btree" ("project_id", "status");



CREATE INDEX "idx_mappings_node_lookup" ON "public"."specification_mappings" USING "btree" ("node_id", "is_orphan");



CREATE INDEX "idx_mappings_orphan" ON "public"."specification_mappings" USING "btree" ("specification_id", "is_orphan") WHERE ("is_orphan" = true);



CREATE UNIQUE INDEX "idx_mcp_api_keys_active_name" ON "public"."mcp_api_keys" USING "btree" ("user_id", "lower"("name")) WHERE ("revoked_at" IS NULL);



COMMENT ON INDEX "public"."idx_mcp_api_keys_active_name" IS 'V3 I: one live key per name per person; the lease board names an agent by its key name, so the name is the identity. Revoked keys free their name.';



CREATE INDEX "idx_mcp_api_keys_key_hash" ON "public"."mcp_api_keys" USING "btree" ("key_hash");



CREATE INDEX "idx_mcp_api_keys_key_prefix" ON "public"."mcp_api_keys" USING "btree" ("key_prefix");



CREATE INDEX "idx_mcp_api_keys_user_id" ON "public"."mcp_api_keys" USING "btree" ("user_id");



CREATE INDEX "idx_mcp_oauth_codes_code" ON "public"."mcp_oauth_codes" USING "btree" ("code");



CREATE INDEX "idx_mcp_oauth_codes_expires" ON "public"."mcp_oauth_codes" USING "btree" ("expires_at");



CREATE INDEX "idx_mcp_oauth_codes_user" ON "public"."mcp_oauth_codes" USING "btree" ("user_id");



CREATE INDEX "idx_mcp_oauth_tokens_expires" ON "public"."mcp_oauth_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_mcp_oauth_tokens_hash" ON "public"."mcp_oauth_tokens" USING "btree" ("access_token_hash");



CREATE UNIQUE INDEX "idx_mcp_oauth_tokens_refresh_hash" ON "public"."mcp_oauth_tokens" USING "btree" ("refresh_token_hash") WHERE ("refresh_token_hash" IS NOT NULL);



CREATE INDEX "idx_mcp_oauth_tokens_rotated_from" ON "public"."mcp_oauth_tokens" USING "btree" ("rotated_from");



CREATE INDEX "idx_mcp_oauth_tokens_rotated_to" ON "public"."mcp_oauth_tokens" USING "btree" ("rotated_to");



CREATE INDEX "idx_mcp_oauth_tokens_user" ON "public"."mcp_oauth_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_mcp_oauth_tokens_user_client_live" ON "public"."mcp_oauth_tokens" USING "btree" ("user_id", "client_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_mcp_rate_buckets_user_id" ON "public"."mcp_rate_buckets" USING "btree" ("user_id");



CREATE INDEX "idx_node_dependencies_to" ON "public"."node_dependencies" USING "btree" ("branch_id", "to_node_id");



CREATE INDEX "idx_node_roles_palette_category" ON "public"."node_roles" USING "btree" ("palette_category", "sort_order");



CREATE INDEX "idx_node_roles_rf_visual_type" ON "public"."node_roles" USING "btree" ("rf_visual_type");



CREATE INDEX "idx_outcome_derivations_approved_by" ON "public"."outcome_derivations" USING "btree" ("approved_by");



CREATE INDEX "idx_outcome_derivations_branch" ON "public"."outcome_derivations" USING "btree" ("branch_id");



CREATE INDEX "idx_outcome_derivations_candidate" ON "public"."outcome_derivations" USING "btree" ("candidate_id");



CREATE INDEX "idx_outcome_derivations_project" ON "public"."outcome_derivations" USING "btree" ("project_id");



CREATE INDEX "idx_outcome_derivations_proposal" ON "public"."outcome_derivations" USING "btree" ("via_proposal_id");



CREATE INDEX "idx_outcome_derivations_requirement" ON "public"."outcome_derivations" USING "btree" ("requirement_row_id");



CREATE INDEX "idx_outcome_step_maps_branch" ON "public"."outcome_step_maps" USING "btree" ("branch_id");



CREATE INDEX "idx_outcome_step_maps_step" ON "public"."outcome_step_maps" USING "btree" ("step_id");



CREATE INDEX "idx_patches_branch_sequence" ON "public"."graph_patches" USING "btree" ("branch_id", "sequence");



CREATE INDEX "idx_project_constraints_project" ON "public"."project_constraints" USING "btree" ("project_id", "ctype");



CREATE INDEX "idx_project_constraints_workflow" ON "public"."project_constraints" USING "btree" ("workflow_id");



CREATE INDEX "idx_project_members_invited_by" ON "public"."project_members" USING "btree" ("invited_by");



CREATE INDEX "idx_project_members_user" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "idx_project_specifications_created_at" ON "public"."project_specifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_project_specifications_created_by" ON "public"."project_specifications" USING "btree" ("created_by");



CREATE INDEX "idx_project_specifications_project_id" ON "public"."project_specifications" USING "btree" ("project_id");



CREATE INDEX "idx_project_templates_author" ON "public"."project_templates" USING "btree" ("author_id") WHERE ("author_id" IS NOT NULL);



CREATE INDEX "idx_project_templates_category" ON "public"."project_templates" USING "btree" ("category");



CREATE INDEX "idx_project_templates_marketplace_sort" ON "public"."project_templates" USING "btree" ("is_public", "is_featured" DESC, "use_count" DESC);



CREATE INDEX "idx_project_templates_slug" ON "public"."project_templates" USING "btree" ("slug");



CREATE INDEX "idx_project_templates_tags" ON "public"."project_templates" USING "gin" ("tags");



CREATE INDEX "idx_projects_owner_id" ON "public"."projects" USING "btree" ("owner_id");



CREATE INDEX "idx_proposals_ai_run" ON "public"."ai_proposals" USING "btree" ("ai_run_id");



CREATE INDEX "idx_proposals_proposal_branch" ON "public"."ai_proposals" USING "btree" ("proposal_branch_id");



CREATE INDEX "idx_proposals_source_branch" ON "public"."ai_proposals" USING "btree" ("source_branch_id", "created_at" DESC);



CREATE INDEX "idx_proposals_status" ON "public"."ai_proposals" USING "btree" ("status");



CREATE INDEX "idx_repo_index_centrality" ON "public"."repo_index" USING "btree" ("branch_id", "centrality" DESC);



CREATE INDEX "idx_repo_index_edges_to" ON "public"."repo_index_edges" USING "btree" ("branch_id", "to_path");



CREATE INDEX "idx_repo_index_freshness_node" ON "public"."repo_index_freshness" USING "btree" ("branch_id", "node_id");



CREATE INDEX "idx_repo_index_node" ON "public"."repo_index" USING "btree" ("branch_id", "node_id");



CREATE INDEX "idx_repo_index_path_trgm" ON "public"."repo_index" USING "gin" ("path" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_repo_index_search_fts" ON "public"."repo_index" USING "gin" ("to_tsvector"('"simple"'::"regconfig", "search_text"));



CREATE INDEX "idx_repo_index_versions" ON "public"."repo_index" USING "btree" ("branch_id", "classifier_version", "extractor_version");



CREATE INDEX "idx_requirement_candidates_branch_status" ON "public"."requirement_candidates" USING "btree" ("branch_id", "status");



CREATE INDEX "idx_requirement_candidates_node" ON "public"."requirement_candidates" USING "btree" ("branch_id", "node_id");



CREATE INDEX "idx_requirement_candidates_project" ON "public"."requirement_candidates" USING "btree" ("project_id");



CREATE INDEX "idx_requirement_candidates_req_row" ON "public"."requirement_candidates" USING "btree" ("requirement_row_id") WHERE ("requirement_row_id" IS NOT NULL);



CREATE INDEX "idx_requirement_candidates_requirement_row" ON "public"."requirement_candidates" USING "btree" ("requirement_row_id");



CREATE INDEX "idx_requirement_candidates_workflow" ON "public"."requirement_candidates" USING "btree" ("workflow_id");



CREATE INDEX "idx_requirements_for_mapping_check" ON "public"."specification_requirements" USING "btree" ("specification_id", "id");



CREATE INDEX "idx_requirements_section" ON "public"."specification_requirements" USING "btree" ("section_id") WHERE ("section_id" IS NOT NULL);



CREATE INDEX "idx_requirements_source" ON "public"."specification_requirements" USING "btree" ("source");



CREATE INDEX "idx_sections_order" ON "public"."specification_sections" USING "btree" ("specification_id", "order_index");



CREATE INDEX "idx_sections_specification_id" ON "public"."specification_sections" USING "btree" ("specification_id");



CREATE INDEX "idx_snapshots_branch" ON "public"."graph_snapshots" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "idx_spec_mappings_artifact_ids" ON "public"."specification_mappings" USING "gin" ("artifact_ids");



CREATE INDEX "idx_spec_mappings_node_id" ON "public"."specification_mappings" USING "btree" ("node_id");



CREATE INDEX "idx_spec_mappings_requirement_id" ON "public"."specification_mappings" USING "btree" ("requirement_id");



CREATE INDEX "idx_spec_mappings_spec_id" ON "public"."specification_mappings" USING "btree" ("specification_id");



CREATE INDEX "idx_spec_mappings_validation_status" ON "public"."specification_mappings" USING "btree" ("validation_status");



CREATE INDEX "idx_spec_req_relations_spec" ON "public"."specification_requirement_relations" USING "btree" ("specification_id");



CREATE INDEX "idx_spec_requirements_archived" ON "public"."specification_requirements" USING "btree" ("specification_id") WHERE ("archived_at" IS NOT NULL);



CREATE INDEX "idx_spec_requirements_locked" ON "public"."specification_requirements" USING "btree" ("specification_id") WHERE ("locked" = true);



CREATE INDEX "idx_spec_requirements_spec_id" ON "public"."specification_requirements" USING "btree" ("specification_id");



CREATE INDEX "idx_spec_requirements_status" ON "public"."specification_requirements" USING "btree" ("status");



CREATE INDEX "idx_specification_mappings_created_by" ON "public"."specification_mappings" USING "btree" ("created_by");



CREATE INDEX "idx_specification_requirement_relations_to_requirement" ON "public"."specification_requirement_relations" USING "btree" ("to_requirement_id");



CREATE INDEX "idx_specs_locked_nodes" ON "public"."project_specifications" USING "gin" ("locked_nodes");



CREATE UNIQUE INDEX "idx_stripe_customers_unique_active_user" ON "public"."stripe_customers" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_stripe_customers_user_id" ON "public"."stripe_customers" USING "btree" ("user_id");



CREATE INDEX "idx_stripe_subscriptions_status" ON "public"."stripe_subscriptions" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_stripe_subscriptions_unique_active_user" ON "public"."stripe_subscriptions" USING "btree" ("user_id") WHERE ("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text"]));



CREATE INDEX "idx_stripe_subscriptions_user_id" ON "public"."stripe_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_subscription_audit_log_created_at" ON "public"."subscription_audit_log" USING "btree" ("created_at");



CREATE INDEX "idx_subscription_audit_log_source" ON "public"."subscription_audit_log" USING "btree" ("source");



CREATE INDEX "idx_subscription_audit_log_subscription_id" ON "public"."subscription_audit_log" USING "btree" ("subscription_id");



CREATE INDEX "idx_subscription_audit_log_user_id" ON "public"."subscription_audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_task_items_project_node" ON "public"."task_items" USING "btree" ("project_id", "node_id");



CREATE INDEX "idx_technology_catalog_created_by" ON "public"."technology_catalog" USING "btree" ("created_by");



CREATE INDEX "idx_technology_catalog_project" ON "public"."technology_catalog" USING "btree" ("project_id") WHERE ("project_id" IS NOT NULL);



CREATE INDEX "idx_technology_catalog_role_affinities" ON "public"."technology_catalog" USING "gin" ("role_affinities");



CREATE INDEX "idx_technology_catalog_search_vector" ON "public"."technology_catalog" USING "gin" ("search_vector");



CREATE INDEX "idx_template_comments_template_created" ON "public"."template_comments" USING "btree" ("template_id", "created_at" DESC);



CREATE INDEX "idx_template_comments_user" ON "public"."template_comments" USING "btree" ("user_id");



CREATE INDEX "idx_template_upvotes_template_id" ON "public"."template_upvotes" USING "btree" ("template_id");



CREATE INDEX "idx_template_upvotes_user_id" ON "public"."template_upvotes" USING "btree" ("user_id");



CREATE INDEX "idx_template_usage_project_id" ON "public"."template_usage" USING "btree" ("project_id") WHERE ("project_id" IS NOT NULL);



CREATE INDEX "idx_template_usage_template_id" ON "public"."template_usage" USING "btree" ("template_id");



CREATE INDEX "idx_template_usage_user_id" ON "public"."template_usage" USING "btree" ("user_id");



CREATE INDEX "idx_test_cases_artifact_id" ON "public"."test_cases" USING "btree" ("artifact_id");



CREATE INDEX "idx_test_cases_requirement_id" ON "public"."test_cases" USING "btree" ("requirement_id");



CREATE INDEX "idx_test_cases_status" ON "public"."test_cases" USING "btree" ("status");



CREATE INDEX "idx_user_feedback_created_at" ON "public"."user_feedback" USING "btree" ("created_at");



CREATE INDEX "idx_user_feedback_user_id" ON "public"."user_feedback" USING "btree" ("user_id");



CREATE INDEX "idx_work_exports_exported_by" ON "public"."work_exports" USING "btree" ("exported_by");



CREATE INDEX "idx_work_exports_project" ON "public"."work_exports" USING "btree" ("project_id");



CREATE INDEX "idx_work_plan_edges_from" ON "public"."work_plan_edges" USING "btree" ("from_item");



CREATE INDEX "idx_work_plan_edges_plan" ON "public"."work_plan_edges" USING "btree" ("plan_id");



CREATE INDEX "idx_work_plan_edges_to" ON "public"."work_plan_edges" USING "btree" ("to_item");



CREATE INDEX "idx_work_plan_items_plan" ON "public"."work_plan_items" USING "btree" ("plan_id");



CREATE INDEX "idx_work_plan_items_plan_rank" ON "public"."work_plan_items" USING "btree" ("plan_id", "rank");



CREATE INDEX "idx_work_plans_accepted_by" ON "public"."work_plans" USING "btree" ("accepted_by");



CREATE INDEX "idx_work_plans_branch" ON "public"."work_plans" USING "btree" ("branch_id");



CREATE INDEX "idx_work_plans_created_by" ON "public"."work_plans" USING "btree" ("created_by");



CREATE INDEX "idx_work_plans_project" ON "public"."work_plans" USING "btree" ("project_id");



CREATE INDEX "idx_workflow_steps_workflow" ON "public"."workflow_steps" USING "btree" ("workflow_id", "sort_order");



CREATE INDEX "idx_workflows_created_by" ON "public"."workflows" USING "btree" ("created_by");



CREATE INDEX "idx_workflows_project" ON "public"."workflows" USING "btree" ("project_id", "sort_order");



CREATE UNIQUE INDEX "stripe_subscriptions_stripe_customer_id_unique" ON "public"."stripe_subscriptions" USING "btree" ("stripe_customer_id") WHERE (("stripe_customer_id" IS NOT NULL) AND ("stripe_customer_id" <> ''::"text"));



CREATE UNIQUE INDEX "stripe_subscriptions_stripe_subscription_id_unique" ON "public"."stripe_subscriptions" USING "btree" ("stripe_subscription_id") WHERE (("stripe_subscription_id" IS NOT NULL) AND ("stripe_subscription_id" <> ''::"text"));



CREATE UNIQUE INDEX "uq_work_exports_one_per_target" ON "public"."work_exports" USING "btree" ("project_id", "item_kind", COALESCE(("node_id")::"text", ''::"text"), "item_key", "target");



CREATE UNIQUE INDEX "uq_work_plan_items_identity" ON "public"."work_plan_items" USING "btree" ("plan_id", "item_kind", COALESCE(("node_id")::"text", ''::"text"), "item_key");



CREATE UNIQUE INDEX "uq_work_plans_one_accepted_per_branch" ON "public"."work_plans" USING "btree" ("branch_id") WHERE ("status" = 'accepted'::"text");



CREATE UNIQUE INDEX "uq_workflows_one_imported_lane" ON "public"."workflows" USING "btree" ("project_id") WHERE ("kind" = 'imported'::"text");



CREATE OR REPLACE TRIGGER "on_test_case_status_change" AFTER UPDATE OF "status" ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."on_test_case_status_change_fn"();



CREATE OR REPLACE TRIGGER "task_items_updated_at" BEFORE UPDATE ON "public"."task_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "template_comments_updated_at" BEFORE UPDATE ON "public"."template_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_ai_context_provenance_ins" BEFORE INSERT ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_ai_context_provenance"();



CREATE OR REPLACE TRIGGER "trg_ai_context_provenance_upd" BEFORE UPDATE OF "ai_context" ON "public"."technology_catalog" FOR EACH ROW WHEN (("old"."ai_context" IS DISTINCT FROM "new"."ai_context")) EXECUTE FUNCTION "public"."enforce_ai_context_provenance"();



CREATE OR REPLACE TRIGGER "trg_artifacts_plan_mark" BEFORE INSERT OR UPDATE OF "mark" ON "public"."artifacts" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_can_contain_resolves" BEFORE INSERT OR UPDATE OF "can_contain" ON "public"."node_roles" FOR EACH ROW EXECUTE FUNCTION "public"."assert_can_contain_resolves"();



CREATE OR REPLACE TRIGGER "trg_candidates_freeze_first_derivation" BEFORE UPDATE OF "requirement_row_id" ON "public"."requirement_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_candidates_freeze_first_derivation"();



CREATE OR REPLACE TRIGGER "trg_cleanup_test_case_artifacts" BEFORE DELETE ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_test_case_artifacts"();



CREATE OR REPLACE TRIGGER "trg_clear_testid_on_delete" BEFORE DELETE ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."clear_testid_from_acceptance_criteria"();



CREATE OR REPLACE TRIGGER "trg_explode_rebind_on_accept" AFTER UPDATE OF "status" ON "public"."ai_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."explode_rebind_on_proposal_accept"();



CREATE OR REPLACE TRIGGER "trg_graph_patches_a_respect_leases" BEFORE INSERT ON "public"."graph_patches" FOR EACH ROW EXECUTE FUNCTION "public"."graph_patches_respect_leases"();



CREATE OR REPLACE TRIGGER "trg_graph_patches_hash_chain" BEFORE INSERT ON "public"."graph_patches" FOR EACH ROW EXECUTE FUNCTION "public"."graph_patches_set_hash_chain"();



CREATE OR REPLACE TRIGGER "trg_import_promote_on_accept" AFTER UPDATE OF "status" ON "public"."ai_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."import_promote_on_proposal_accept"();



CREATE OR REPLACE TRIGGER "trg_mark_tests_stale_on_artifact_change" AFTER UPDATE ON "public"."artifacts" FOR EACH ROW EXECUTE FUNCTION "public"."mark_tests_stale_on_artifact_change"();



CREATE OR REPLACE TRIGGER "trg_mark_tests_stale_on_mapping_change" AFTER INSERT OR DELETE ON "public"."specification_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."mark_tests_stale_on_mapping_change"();



CREATE OR REPLACE TRIGGER "trg_mark_tests_stale_on_req_change" AFTER UPDATE ON "public"."specification_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."mark_tests_stale_on_requirement_change"();



CREATE OR REPLACE TRIGGER "trg_mcp_api_keys_revocation_is_final" BEFORE UPDATE ON "public"."mcp_api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."mcp_api_keys_revocation_is_final"();



CREATE OR REPLACE TRIGGER "trg_node_roles_updated_at" BEFORE UPDATE ON "public"."node_roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_outcome_step_maps_terminal" BEFORE INSERT OR DELETE OR UPDATE ON "public"."outcome_step_maps" FOR EACH ROW EXECUTE FUNCTION "public"."outcome_step_maps_terminal_guard"();



CREATE OR REPLACE TRIGGER "trg_project_constraints_plan_mark" BEFORE INSERT OR UPDATE OF "mark" ON "public"."project_constraints" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_project_constraints_plan_scope" BEFORE INSERT OR UPDATE ON "public"."project_constraints" FOR EACH ROW EXECUTE FUNCTION "public"."project_constraints_plan_scope"();



CREATE OR REPLACE TRIGGER "trg_project_constraints_scope_shape" BEFORE INSERT OR UPDATE OF "workflow_id", "scope_kind", "scope_value" ON "public"."project_constraints" FOR EACH ROW EXECUTE FUNCTION "public"."project_constraints_scope_shape"();



CREATE OR REPLACE TRIGGER "trg_project_members_plan_clearance" BEFORE INSERT OR UPDATE OF "clearance" ON "public"."project_members" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_project_owner_guard" BEFORE UPDATE OF "owner_id" ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."project_owner_guard"();



CREATE OR REPLACE TRIGGER "trg_project_specifications_constraints_sync" AFTER INSERT OR UPDATE OF "constraints" ON "public"."project_specifications" FOR EACH ROW EXECUTE FUNCTION "public"."project_specifications_constraints_sync"();



CREATE OR REPLACE TRIGGER "trg_projects_example_guard" BEFORE INSERT OR UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."projects_example_guard"();



CREATE OR REPLACE TRIGGER "trg_projects_plan_cap" BEFORE INSERT ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."projects_plan_cap"();



CREATE OR REPLACE TRIGGER "trg_requirement_candidates_a_plan_lane" BEFORE INSERT OR UPDATE OF "workflow_id" ON "public"."requirement_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_candidates_plan_lane"();



CREATE OR REPLACE TRIGGER "trg_requirement_candidates_home_lane" BEFORE INSERT OR UPDATE OF "workflow_id", "project_id" ON "public"."requirement_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_candidates_home_lane_guard"();



CREATE OR REPLACE TRIGGER "trg_requirement_candidates_plan_mark" BEFORE INSERT OR UPDATE OF "mark" ON "public"."requirement_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_requirement_lock_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."outcome_derivations" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_lock_guard_child"('requirement_row_id');



CREATE OR REPLACE TRIGGER "trg_requirement_lock_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."specification_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_lock_guard_child"('requirement_id');



CREATE OR REPLACE TRIGGER "trg_requirement_lock_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."specification_requirement_relations" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_lock_guard_child"('from_requirement_id', 'to_requirement_id');



CREATE OR REPLACE TRIGGER "trg_requirement_lock_guard" BEFORE DELETE OR UPDATE ON "public"."specification_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."requirement_lock_guard"();



CREATE OR REPLACE TRIGGER "trg_specification_requirements_plan_mark" BEFORE INSERT OR UPDATE OF "mark" ON "public"."specification_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_task_items_plan_mark" BEFORE INSERT OR UPDATE OF "mark" ON "public"."task_items" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_technology_affinities_resolve" BEFORE INSERT OR UPDATE OF "role_affinities" ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."assert_role_affinities_resolve"();



CREATE OR REPLACE TRIGGER "trg_technology_catalog_search_vector" BEFORE INSERT OR UPDATE ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."technology_catalog_search_vector_update"();



CREATE OR REPLACE TRIGGER "trg_technology_catalog_updated_at" BEFORE UPDATE ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_template_upvote_count" AFTER INSERT OR DELETE ON "public"."template_upvotes" FOR EACH ROW EXECUTE FUNCTION "public"."template_counts_follow_rows"();



CREATE OR REPLACE TRIGGER "trg_template_use_count" AFTER INSERT ON "public"."template_usage" FOR EACH ROW EXECUTE FUNCTION "public"."template_counts_follow_rows"();



CREATE OR REPLACE TRIGGER "trg_test_cases_plan_mark" BEFORE INSERT OR UPDATE OF "mark" ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."plan_guard_mark"();



CREATE OR REPLACE TRIGGER "trg_update_requirements_updated_at" BEFORE UPDATE ON "public"."specification_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_update_sections_updated_at" BEFORE UPDATE ON "public"."specification_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_update_project_timestamp" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_update_work_plans_updated_at" BEFORE UPDATE ON "public"."work_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_blog_post_updated_at_trigger" BEFORE UPDATE ON "public"."blog_posts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."requirement_candidates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_holder_key_id_fkey" FOREIGN KEY ("holder_key_id") REFERENCES "public"."mcp_api_keys"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_checkouts"
    ADD CONSTRAINT "agent_checkouts_task_item_id_fkey" FOREIGN KEY ("task_item_id") REFERENCES "public"."task_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_proposal_artifacts"
    ADD CONSTRAINT "ai_proposal_artifacts_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_proposal_branch_id_fkey" FOREIGN KEY ("proposal_branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_input_snapshot_id_fkey" FOREIGN KEY ("input_snapshot_id") REFERENCES "public"."graph_snapshots"("id");



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id");



ALTER TABLE ONLY "public"."app_sessions"
    ADD CONSTRAINT "app_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blog_post_categories"
    ADD CONSTRAINT "blog_post_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."blog_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blog_post_categories"
    ADD CONSTRAINT "blog_post_categories_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bug_reports"
    ADD CONSTRAINT "bug_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_from_candidate_id_fkey" FOREIGN KEY ("from_candidate_id") REFERENCES "public"."requirement_candidates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_from_requirement_id_fkey" FOREIGN KEY ("from_requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_from_task_item_id_fkey" FOREIGN KEY ("from_task_item_id") REFERENCES "public"."task_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_to_candidate_id_fkey" FOREIGN KEY ("to_candidate_id") REFERENCES "public"."requirement_candidates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_to_requirement_id_fkey" FOREIGN KEY ("to_requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."couplings"
    ADD CONSTRAINT "couplings_to_task_item_id_fkey" FOREIGN KEY ("to_task_item_id") REFERENCES "public"."task_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enterprise_contact_requests"
    ADD CONSTRAINT "enterprise_contact_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "fk_base_snapshot" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."graph_snapshots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."git_integrations"
    ADD CONSTRAINT "git_integrations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."git_integrations"
    ADD CONSTRAINT "git_integrations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_sync_log"
    ADD CONSTRAINT "git_sync_log_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_sync_log"
    ADD CONSTRAINT "git_sync_log_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_sync_log"
    ADD CONSTRAINT "git_sync_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_patches"
    ADD CONSTRAINT "graph_patches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_snapshots"
    ADD CONSTRAINT "graph_snapshots_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_snapshots"
    ADD CONSTRAINT "graph_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_edges"
    ADD CONSTRAINT "import_job_edges_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_files"
    ADD CONSTRAINT "import_job_files_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_group_edges"
    ADD CONSTRAINT "import_job_group_edges_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_groups"
    ADD CONSTRAINT "import_job_groups_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_rank"
    ADD CONSTRAINT "import_job_rank_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_waves"
    ADD CONSTRAINT "import_job_waves_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_api_keys"
    ADD CONSTRAINT "mcp_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_oauth_codes"
    ADD CONSTRAINT "mcp_oauth_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_oauth_tokens"
    ADD CONSTRAINT "mcp_oauth_tokens_rotated_from_fkey" FOREIGN KEY ("rotated_from") REFERENCES "public"."mcp_oauth_tokens"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mcp_oauth_tokens"
    ADD CONSTRAINT "mcp_oauth_tokens_rotated_to_fkey" FOREIGN KEY ("rotated_to") REFERENCES "public"."mcp_oauth_tokens"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mcp_oauth_tokens"
    ADD CONSTRAINT "mcp_oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_rate_buckets"
    ADD CONSTRAINT "mcp_rate_buckets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_dependencies"
    ADD CONSTRAINT "node_dependencies_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."requirement_candidates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_requirement_row_id_fkey" FOREIGN KEY ("requirement_row_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_derivations"
    ADD CONSTRAINT "outcome_derivations_via_proposal_id_fkey" FOREIGN KEY ("via_proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outcome_step_maps"
    ADD CONSTRAINT "outcome_step_maps_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_step_maps"
    ADD CONSTRAINT "outcome_step_maps_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."requirement_candidates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcome_step_maps"
    ADD CONSTRAINT "outcome_step_maps_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_constraints"
    ADD CONSTRAINT "project_constraints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_constraints"
    ADD CONSTRAINT "project_constraints_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_index"
    ADD CONSTRAINT "repo_index_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_index_edges"
    ADD CONSTRAINT "repo_index_edges_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_index_freshness"
    ADD CONSTRAINT "repo_index_freshness_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."requirement_candidates"
    ADD CONSTRAINT "requirement_candidates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."requirement_candidates"
    ADD CONSTRAINT "requirement_candidates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."requirement_candidates"
    ADD CONSTRAINT "requirement_candidates_requirement_row_id_fkey" FOREIGN KEY ("requirement_row_id") REFERENCES "public"."specification_requirements"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."requirement_candidates"
    ADD CONSTRAINT "requirement_candidates_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."specification_mappings"
    ADD CONSTRAINT "specification_mappings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."specification_mappings"
    ADD CONSTRAINT "specification_mappings_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specification_mappings"
    ADD CONSTRAINT "specification_mappings_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "public"."project_specifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specification_requirement_relations"
    ADD CONSTRAINT "specification_requirement_relations_from_requirement_id_fkey" FOREIGN KEY ("from_requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specification_requirement_relations"
    ADD CONSTRAINT "specification_requirement_relations_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "public"."project_specifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specification_requirement_relations"
    ADD CONSTRAINT "specification_requirement_relations_to_requirement_id_fkey" FOREIGN KEY ("to_requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specification_requirements"
    ADD CONSTRAINT "specification_requirements_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."specification_sections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."specification_requirements"
    ADD CONSTRAINT "specification_requirements_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "public"."project_specifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specification_sections"
    ADD CONSTRAINT "specification_sections_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "public"."project_specifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_subscriptions"
    ADD CONSTRAINT "stripe_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_audit_log"
    ADD CONSTRAINT "subscription_audit_log_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."stripe_subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_items"
    ADD CONSTRAINT "task_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."technology_catalog"
    ADD CONSTRAINT "technology_catalog_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."technology_catalog"
    ADD CONSTRAINT "technology_catalog_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_comments"
    ADD CONSTRAINT "template_comments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_comments"
    ADD CONSTRAINT "template_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_upvotes"
    ADD CONSTRAINT "template_upvotes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_upvotes"
    ADD CONSTRAINT "template_upvotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_usage"
    ADD CONSTRAINT "template_usage_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_usage"
    ADD CONSTRAINT "template_usage_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_usage"
    ADD CONSTRAINT "template_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_cases"
    ADD CONSTRAINT "test_cases_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."test_cases"
    ADD CONSTRAINT "test_cases_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."specification_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_feedback"
    ADD CONSTRAINT "user_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_exports"
    ADD CONSTRAINT "work_exports_exported_by_fkey" FOREIGN KEY ("exported_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_exports"
    ADD CONSTRAINT "work_exports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_plan_edges"
    ADD CONSTRAINT "work_plan_edges_from_item_fkey" FOREIGN KEY ("from_item") REFERENCES "public"."work_plan_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_plan_edges"
    ADD CONSTRAINT "work_plan_edges_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."work_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_plan_edges"
    ADD CONSTRAINT "work_plan_edges_to_item_fkey" FOREIGN KEY ("to_item") REFERENCES "public"."work_plan_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_plan_items"
    ADD CONSTRAINT "work_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."work_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_plans"
    ADD CONSTRAINT "work_plans_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_plans"
    ADD CONSTRAINT "work_plans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_plans"
    ADD CONSTRAINT "work_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_plans"
    ADD CONSTRAINT "work_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



CREATE POLICY "AI run access follows project ownership" ON "public"."ai_runs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "ai_runs"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "ai_runs"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "AI run access follows project ownership (read)" ON "public"."ai_runs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "ai_runs"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Admins can create categories" ON "public"."blog_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can delete categories" ON "public"."blog_categories" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete post categories" ON "public"."blog_post_categories" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete system technologies" ON "public"."technology_catalog" FOR DELETE TO "authenticated" USING (("public"."is_admin"() AND ("is_user_contributed" = false)));



CREATE POLICY "Admins can insert post categories" ON "public"."blog_post_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert subscriptions" ON "public"."stripe_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert system technologies" ON "public"."technology_catalog" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("is_user_contributed" = false)));



CREATE POLICY "Admins can read all audit log entries" ON "public"."subscription_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all bug reports" ON "public"."bug_reports" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all feedback" ON "public"."user_feedback" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all subscriptions" ON "public"."stripe_subscriptions" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all technologies" ON "public"."technology_catalog" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can update all bug reports" ON "public"."bug_reports" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update categories" ON "public"."blog_categories" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update post categories" ON "public"."blog_post_categories" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update subscriptions" ON "public"."stripe_subscriptions" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update system technologies" ON "public"."technology_catalog" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() AND ("is_user_contributed" = false))) WITH CHECK (("public"."is_admin"() AND ("is_user_contributed" = false)));



CREATE POLICY "Admins create posts" ON "public"."blog_posts" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("author_id" = "auth"."uid"())));



CREATE POLICY "Admins delete posts" ON "public"."blog_posts" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins read every post" ON "public"."blog_posts" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins update posts" ON "public"."blog_posts" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Anon can read deployment targets" ON "public"."deployment_targets" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anon can read node roles" ON "public"."node_roles" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anon can read system technologies" ON "public"."technology_catalog" FOR SELECT TO "anon" USING (("is_user_contributed" = false));



CREATE POLICY "Anonymous users can submit enterprise requests" ON "public"."enterprise_contact_requests" FOR INSERT TO "anon" WITH CHECK (("user_id" IS NULL));



CREATE POLICY "Anonymous users can view public templates" ON "public"."project_templates" FOR SELECT TO "anon" USING (("is_public" = true));



CREATE POLICY "Anyone can read the import edge kind map" ON "public"."import_edge_kind_map" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view categories" ON "public"."blog_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view post categories" ON "public"."blog_post_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view published posts" ON "public"."blog_posts" FOR SELECT USING (("status" = 'published'::"text"));



CREATE POLICY "Artifact access follows project ownership" ON "public"."artifacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "artifacts"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "artifacts"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Artifact access follows project ownership (read)" ON "public"."artifacts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "artifacts"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Artifact access follows proposal ownership" ON "public"."ai_proposal_artifacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."ai_proposals"
     JOIN "public"."branches" ON (("branches"."id" = "ai_proposals"."source_branch_id")))
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("ai_proposals"."id" = "ai_proposal_artifacts"."proposal_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."ai_proposals"
     JOIN "public"."branches" ON (("branches"."id" = "ai_proposals"."source_branch_id")))
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("ai_proposals"."id" = "ai_proposal_artifacts"."proposal_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Artifact access follows proposal ownership (read)" ON "public"."ai_proposal_artifacts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."ai_proposals"
     JOIN "public"."branches" ON (("branches"."id" = "ai_proposals"."source_branch_id")))
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("ai_proposals"."id" = "ai_proposal_artifacts"."proposal_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Authenticated users can insert own enterprise requests" ON "public"."enterprise_contact_requests" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can read all deployment targets" ON "public"."deployment_targets" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read all roles" ON "public"."node_roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read cloud provider patterns" ON "public"."cloud_provider_patterns" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can read scope archetypes" ON "public"."scope_archetypes" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can read system technologies" ON "public"."technology_catalog" FOR SELECT TO "authenticated" USING (("is_user_contributed" = false));



CREATE POLICY "Authenticated users can view public templates" ON "public"."project_templates" FOR SELECT TO "authenticated" USING (("is_public" = true));



CREATE POLICY "Authors can delete own templates" ON "public"."project_templates" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "Authors can update own templates" ON "public"."project_templates" FOR UPDATE TO "authenticated" USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "Authors can view own templates" ON "public"."project_templates" FOR SELECT TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "Classification: cleared marks only" ON "public"."artifacts" AS RESTRICTIVE TO "authenticated" USING ("public"."mark_visible"("project_id", "mark")) WITH CHECK ("public"."mark_visible"("project_id", "mark"));



CREATE POLICY "Classification: cleared marks only" ON "public"."project_constraints" AS RESTRICTIVE TO "authenticated" USING ("public"."mark_visible"("project_id", "mark")) WITH CHECK ("public"."mark_visible"("project_id", "mark"));



CREATE POLICY "Classification: cleared marks only" ON "public"."requirement_candidates" AS RESTRICTIVE TO "authenticated" USING ("public"."mark_visible"("project_id", "mark")) WITH CHECK ("public"."mark_visible"("project_id", "mark"));



CREATE POLICY "Classification: cleared marks only" ON "public"."specification_requirements" AS RESTRICTIVE TO "authenticated" USING ("public"."mark_visible"(( SELECT "ps"."project_id"
   FROM "public"."project_specifications" "ps"
  WHERE ("ps"."id" = "specification_requirements"."specification_id")), "mark")) WITH CHECK ("public"."mark_visible"(( SELECT "ps"."project_id"
   FROM "public"."project_specifications" "ps"
  WHERE ("ps"."id" = "specification_requirements"."specification_id")), "mark"));



CREATE POLICY "Classification: cleared marks only" ON "public"."task_items" AS RESTRICTIVE TO "authenticated" USING ("public"."mark_visible"("project_id", "mark")) WITH CHECK ("public"."mark_visible"("project_id", "mark"));



CREATE POLICY "Classification: cleared marks only" ON "public"."test_cases" AS RESTRICTIVE TO "authenticated" USING ("public"."mark_visible"(( SELECT "ps"."project_id"
   FROM ("public"."specification_requirements" "r"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "r"."specification_id")))
  WHERE ("r"."id" = "test_cases"."requirement_id")), "mark")) WITH CHECK ("public"."mark_visible"(( SELECT "ps"."project_id"
   FROM ("public"."specification_requirements" "r"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "r"."specification_id")))
  WHERE ("r"."id" = "test_cases"."requirement_id")), "mark"));



CREATE POLICY "Comments are seen where their template is" ON "public"."template_comments" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."project_templates" "t"
  WHERE ("t"."id" = "template_comments"."template_id"))));



CREATE POLICY "Community authors can create templates" ON "public"."project_templates" FOR INSERT TO "authenticated" WITH CHECK ((("author_type" = 'community'::"text") AND ("author_id" = "auth"."uid"())));



CREATE POLICY "Maintainers manage the repository connection" ON "public"."git_integrations" TO "authenticated" USING ("public"."is_project_member"("project_id", 'maintainer'::"text")) WITH CHECK ("public"."is_project_member"("project_id", 'maintainer'::"text"));



CREATE POLICY "Patch access follows branch ownership" ON "public"."graph_patches" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "graph_patches"."branch_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "graph_patches"."branch_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Patch access follows branch ownership (read)" ON "public"."graph_patches" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "graph_patches"."branch_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Plan: constraints are Indie and above" ON "public"."project_constraints" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."plan_allows"('workflow_space'::"text", "project_id") OR "public"."is_example_project"("project_id")));



CREATE POLICY "Project maintainers can reject a proposed work plan" ON "public"."work_plans" FOR UPDATE TO "authenticated" USING ((("status" = 'proposed'::"text") AND "public"."is_project_member"("project_id", 'maintainer'::"text") AND "public"."plan_allows"('priority_board'::"text", "project_id"))) WITH CHECK ((("status" = 'rejected'::"text") AND "public"."is_project_member"("project_id", 'maintainer'::"text") AND "public"."plan_allows"('priority_board'::"text", "project_id")));



COMMENT ON POLICY "Project maintainers can reject a proposed work plan" ON "public"."work_plans" IS 'V3 6.3 + Q: the one app-side write on a plan, on a Priority plan (Indie). A proposed plan becomes rejected, by a maintainer or the owner; accepting is accept_work_plan.';



CREATE POLICY "Project maintainers can update their projects" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("public"."is_project_member"("id", 'maintainer'::"text")) WITH CHECK ("public"."is_project_member"("id", 'maintainer'::"text"));



CREATE POLICY "Project members can view sync log" ON "public"."git_sync_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_sync_log"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Project members can view the roster" ON "public"."project_members" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id", 'viewer'::"text"));



CREATE POLICY "Project members can view their projects" ON "public"."projects" FOR SELECT TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_project_member"("id", 'viewer'::"text")));



CREATE POLICY "Project owners can create projects" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Project owners can create requirement relations" ON "public"."specification_requirement_relations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirement_relations"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can delete requirement relations" ON "public"."specification_requirement_relations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirement_relations"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can delete their projects" ON "public"."projects" FOR DELETE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Project owners can insert change events" ON "public"."git_change_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can insert sync logs" ON "public"."git_sync_log" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_sync_log"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can manage git integrations (read)" ON "public"."git_integrations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_integrations"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their checkouts" ON "public"."agent_checkouts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "agent_checkouts"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "agent_checkouts"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can manage their checkouts (read)" ON "public"."agent_checkouts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "agent_checkouts"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their constraints" ON "public"."project_constraints" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_constraints"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_constraints"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can manage their constraints (read)" ON "public"."project_constraints" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_constraints"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their couplings" ON "public"."couplings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "couplings"."branch_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "couplings"."branch_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can manage their couplings (read)" ON "public"."couplings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "couplings"."branch_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their outcome derivations" ON "public"."outcome_derivations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "outcome_derivations"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "outcome_derivations"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can manage their outcome derivations (read)" ON "public"."outcome_derivations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "outcome_derivations"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their outcome step maps (delete)" ON "public"."outcome_step_maps" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "outcome_step_maps"."branch_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their outcome step maps (insert)" ON "public"."outcome_step_maps" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "outcome_step_maps"."branch_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their outcome step maps (read)" ON "public"."outcome_step_maps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "outcome_step_maps"."branch_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their outcome step maps (update)" ON "public"."outcome_step_maps" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "outcome_step_maps"."branch_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "outcome_step_maps"."branch_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their requirement candidates" ON "public"."requirement_candidates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "requirement_candidates"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "requirement_candidates"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can manage their requirement candidates (read)" ON "public"."requirement_candidates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "requirement_candidates"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their workflow steps (delete)" ON "public"."workflow_steps" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their workflow steps (insert)" ON "public"."workflow_steps" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their workflow steps (read)" ON "public"."workflow_steps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their workflow steps (update)" ON "public"."workflow_steps" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their workflows (delete)" ON "public"."workflows" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "workflows"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their workflows (insert)" ON "public"."workflows" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "workflows"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can manage their workflows (read)" ON "public"."workflows" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "workflows"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can manage their workflows (update)" ON "public"."workflows" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "workflows"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "workflows"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text") AND "public"."plan_allows"('workflow_space'::"text", "p"."id")))));



CREATE POLICY "Project owners can read their work exports" ON "public"."work_exports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "work_exports"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can read their work plan edges" ON "public"."work_plan_edges" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."work_plans" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "work_plan_edges"."plan_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can read their work plan items" ON "public"."work_plan_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."work_plans" "w"
     JOIN "public"."projects" "p" ON (("p"."id" = "w"."project_id")))
  WHERE (("w"."id" = "work_plan_items"."plan_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can read their work plans" ON "public"."work_plans" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "work_plans"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can remove seats" ON "public"."project_members" FOR DELETE TO "authenticated" USING ("public"."is_project_member"("project_id", 'owner'::"text"));



CREATE POLICY "Project owners can resolve change events" ON "public"."git_change_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Project owners can view change events" ON "public"."git_change_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view requirement relations" ON "public"."specification_requirement_relations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirement_relations"."specification_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their import edges" ON "public"."import_job_edges" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."import_jobs" "j"
     JOIN "public"."projects" "p" ON (("p"."id" = "j"."project_id")))
  WHERE (("j"."id" = "import_job_edges"."job_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their import group edges" ON "public"."import_job_group_edges" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."import_jobs" "j"
     JOIN "public"."projects" "p" ON (("p"."id" = "j"."project_id")))
  WHERE (("j"."id" = "import_job_group_edges"."job_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their import jobs" ON "public"."import_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "import_jobs"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their node dependencies" ON "public"."node_dependencies" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "node_dependencies"."branch_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their repo index" ON "public"."repo_index" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "repo_index"."branch_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their repo index edges" ON "public"."repo_index_edges" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "repo_index_edges"."branch_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their repo index freshness" ON "public"."repo_index_freshness" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches" "b"
     JOIN "public"."projects" "p" ON (("p"."id" = "b"."project_id")))
  WHERE (("b"."id" = "repo_index_freshness"."branch_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners can view their requirement candidates" ON "public"."requirement_candidates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "requirement_candidates"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Project owners on Team can add seats" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_project_member"("project_id", 'owner'::"text") AND "public"."plan_allows"('team_lanes'::"text", "project_id")));



CREATE POLICY "Project owners on Team can change seats" ON "public"."project_members" FOR UPDATE TO "authenticated" USING (("public"."is_project_member"("project_id", 'owner'::"text") AND "public"."plan_allows"('team_lanes'::"text", "project_id"))) WITH CHECK (("public"."is_project_member"("project_id", 'owner'::"text") AND "public"."plan_allows"('team_lanes'::"text", "project_id")));



CREATE POLICY "Proposal access follows project ownership (read)" ON "public"."ai_proposals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "ai_proposals"."source_branch_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Proposal writes follow the approver's seat" ON "public"."ai_proposals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "ai_proposals"."source_branch_id") AND "public"."is_project_member"("projects"."id", 'maintainer'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "ai_proposals"."source_branch_id") AND "public"."is_project_member"("projects"."id", 'maintainer'::"text")))));



COMMENT ON POLICY "Proposal writes follow the approver's seat" ON "public"."ai_proposals" IS 'V3 H (2026-09-21): a session writes a proposal row only from the seat that may settle one (maintainer or the owner). Reads stay viewer and above through the (read) policy; the service role is unchanged.';



CREATE POLICY "Public profiles are viewable, own profile always" ON "public"."user_profiles" FOR SELECT TO "authenticated", "anon" USING (("is_public" OR ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Service role can insert change events" ON "public"."git_change_events" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert sync logs" ON "public"."git_sync_log" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role full access to ai_proposal_artifacts" ON "public"."ai_proposal_artifacts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to ai_proposals" ON "public"."ai_proposals" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to ai_runs" ON "public"."ai_runs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to artifacts" ON "public"."artifacts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to branches" ON "public"."branches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to git_integrations" ON "public"."git_integrations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to git_sync_log" ON "public"."git_sync_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to graph_patches" ON "public"."graph_patches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to graph_snapshots" ON "public"."graph_snapshots" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to project_specifications" ON "public"."project_specifications" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to projects" ON "public"."projects" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to specification_mappings" ON "public"."specification_mappings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to specification_requirements" ON "public"."specification_requirements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to specification_sections" ON "public"."specification_sections" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to stripe_customers" ON "public"."stripe_customers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to stripe_orders" ON "public"."stripe_orders" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to stripe_subscriptions" ON "public"."stripe_subscriptions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to subscription_audit_log" ON "public"."subscription_audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to test_cases" ON "public"."test_cases" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Snapshot access follows project ownership" ON "public"."graph_snapshots" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "graph_snapshots"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "graph_snapshots"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Snapshot access follows project ownership (read)" ON "public"."graph_snapshots" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "graph_snapshots"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Users and admins can delete comments" ON "public"."template_comments" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Users can create branches in their projects" ON "public"."branches" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can create own comments" ON "public"."template_comments" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create own profile" ON "public"."user_profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create task items for their projects" ON "public"."task_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can create test cases for their requirements" ON "public"."test_cases" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can delete branches in their projects" ON "public"."branches" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Users can delete mappings in their projects" ON "public"."specification_mappings" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can delete own profile" ON "public"."user_profiles" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete own project technologies" ON "public"."technology_catalog" FOR DELETE TO "authenticated" USING ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can delete own template usage" ON "public"."template_usage" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete requirements in their projects" ON "public"."specification_requirements" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can delete sections in their projects" ON "public"."specification_sections" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can delete specifications for their projects" ON "public"."project_specifications" FOR DELETE TO "authenticated" USING (("project_id" IN ( SELECT "public"."member_project_ids"('contributor'::"text") AS "member_project_ids")));



CREATE POLICY "Users can delete task items for their projects" ON "public"."task_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can delete test cases for their requirements" ON "public"."test_cases" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can insert mappings in their projects" ON "public"."specification_mappings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can insert own audit log entries" ON "public"."subscription_audit_log" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own bug reports" ON "public"."bug_reports" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own feedback" ON "public"."user_feedback" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own settings" ON "public"."user_settings" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND ("is_admin" IS NOT TRUE)));



CREATE POLICY "Users can insert project technologies" ON "public"."technology_catalog" FOR INSERT TO "authenticated" WITH CHECK ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("project_id" IN ( SELECT "public"."member_project_ids"('contributor'::"text") AS "member_project_ids"))));



CREATE POLICY "Users can insert requirements in their projects" ON "public"."specification_requirements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can insert sections in their projects" ON "public"."specification_sections" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can insert specifications for their projects" ON "public"."project_specifications" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("project_id" IN ( SELECT "public"."member_project_ids"('contributor'::"text") AS "member_project_ids"))));



CREATE POLICY "Users can read change events for their projects" ON "public"."git_change_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."git_integrations" "gi"
     JOIN "public"."projects" "p" ON (("p"."id" = "gi"."project_id")))
  WHERE (("gi"."id" = "git_change_events"."integration_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Users can read own bug reports" ON "public"."bug_reports" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read own customer data" ON "public"."stripe_customers" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read own orders" ON "public"."stripe_orders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."stripe_customers"
  WHERE (("stripe_customers"."customer_id" = "stripe_orders"."customer_id") AND ("stripe_customers"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can read own project technologies" ON "public"."technology_catalog" FOR SELECT TO "authenticated" USING ((("is_user_contributed" = true) AND ("project_id" IN ( SELECT "public"."member_project_ids"('viewer'::"text") AS "member_project_ids"))));



CREATE POLICY "Users can read own subscription" ON "public"."stripe_subscriptions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can record own template usage" ON "public"."template_usage" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can remove their own upvotes" ON "public"."template_upvotes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update branches in their projects" ON "public"."branches" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND "public"."is_project_member"("projects"."id", 'contributor'::"text")))));



CREATE POLICY "Users can update change events for their projects" ON "public"."git_change_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."git_integrations" "gi"
     JOIN "public"."projects" "p" ON (("p"."id" = "gi"."project_id")))
  WHERE (("gi"."id" = "git_change_events"."integration_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."git_integrations" "gi"
     JOIN "public"."projects" "p" ON (("p"."id" = "gi"."project_id")))
  WHERE (("gi"."id" = "git_change_events"."integration_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can update mappings in their projects" ON "public"."specification_mappings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can update own comments" ON "public"."template_comments" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own profile" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own project technologies" ON "public"."technology_catalog" FOR UPDATE TO "authenticated" USING ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can update own settings" ON "public"."user_settings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("is_admin" = ( SELECT "user_settings_1"."is_admin"
   FROM "public"."user_settings" "user_settings_1"
  WHERE ("user_settings_1"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update requirements in their projects" ON "public"."specification_requirements" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can update sections in their projects" ON "public"."specification_sections" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can update specifications for their projects" ON "public"."project_specifications" FOR UPDATE TO "authenticated" USING (((("project_id" IS NOT NULL) AND ("project_id" IN ( SELECT "public"."member_project_ids"('contributor'::"text") AS "member_project_ids"))) OR (("project_id" IS NULL) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (((("project_id" IS NOT NULL) AND ("project_id" IN ( SELECT "public"."member_project_ids"('contributor'::"text") AS "member_project_ids"))) OR (("project_id" IS NULL) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can update task items for their projects" ON "public"."task_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can update test cases for their requirements" ON "public"."test_cases" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND "public"."is_project_member"("p"."id", 'contributor'::"text")))));



CREATE POLICY "Users can upvote templates" ON "public"."template_upvotes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view branches in their projects" ON "public"."branches" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND "public"."is_project_member"("projects"."id", 'viewer'::"text")))));



CREATE POLICY "Users can view mappings in their projects" ON "public"."specification_mappings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Users can view own enterprise requests" ON "public"."enterprise_contact_requests" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own settings" ON "public"."user_settings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own template usage" ON "public"."template_usage" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view requirements in their projects" ON "public"."specification_requirements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Users can view sections in their projects" ON "public"."specification_sections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Users can view specifications for their projects" ON "public"."project_specifications" FOR SELECT TO "authenticated" USING (((("project_id" IS NOT NULL) AND ("project_id" IN ( SELECT "public"."member_project_ids"('viewer'::"text") AS "member_project_ids"))) OR (("project_id" IS NULL) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can view task items for their projects" ON "public"."task_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Users can view test cases for their requirements" ON "public"."test_cases" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND "public"."is_project_member"("p"."id", 'viewer'::"text")))));



CREATE POLICY "Users can view their own API keys" ON "public"."mcp_api_keys" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read their own upvotes" ON "public"."template_upvotes" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "admin_delete_templates" ON "public"."project_templates" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_insert_official_templates" ON "public"."project_templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("author_type" = 'official'::"text")));



CREATE POLICY "admin_select_all_templates" ON "public"."project_templates" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_update_templates" ON "public"."project_templates" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."agent_checkouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_proposal_artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_post_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bug_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cloud_provider_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."couplings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deployment_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deployment_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enterprise_contact_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."git_change_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."git_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."git_sync_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_patches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_edge_kind_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_group_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_rank" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_waves" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_oauth_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_oauth_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_rate_buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_dependencies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."outcome_derivations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."outcome_step_maps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_constraints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_specifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_index" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_index_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_index_freshness" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."requirement_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scope_archetypes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."specification_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."specification_requirement_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."specification_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."specification_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."technology_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_upvotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_exports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_plan_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_plan_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."agent_checkouts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."ai_proposals";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."git_change_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."graph_patches";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."import_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."outcome_derivations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."outcome_step_maps";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."project_constraints";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."requirement_candidates";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_mappings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_requirement_relations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_requirements";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_sections";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."stripe_subscriptions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."task_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."test_cases";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."work_plans";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workflow_steps";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workflows";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




































































































































































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "public"."account_plan_tier"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."account_plan_tier"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_time_in_app"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_time_in_app"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_time_in_app"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."agent_checkout_claim"("p_project_id" "uuid", "p_level" "text", "p_ref_id" "uuid", "p_holder_kind" "text", "p_holder_label" "text", "p_holder_key_id" "uuid", "p_branch_id" "uuid", "p_proposal_id" "uuid", "p_meta" "jsonb", "p_stale_after_minutes" integer, "p_holder_delegate" "text", "p_criterion_id" "text", "p_node_id" "uuid", "p_reach" "text"[], "p_box" "uuid", "p_parts" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_checkout_claim"("p_project_id" "uuid", "p_level" "text", "p_ref_id" "uuid", "p_holder_kind" "text", "p_holder_label" "text", "p_holder_key_id" "uuid", "p_branch_id" "uuid", "p_proposal_id" "uuid", "p_meta" "jsonb", "p_stale_after_minutes" integer, "p_holder_delegate" "text", "p_criterion_id" "text", "p_node_id" "uuid", "p_reach" "text"[], "p_box" "uuid", "p_parts" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."agent_connection_count"("p_user_id" "uuid", "p_except_client_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_connection_count"("p_user_id" "uuid", "p_except_client_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_session_beat"("p_session" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_session_beat"("p_session" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_session_beat"("p_session" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_criteria_ops"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_criteria_ops"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_criteria_ops_as_member"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_criteria_ops_as_member"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_criteria_ops_as_member"("p_requirement_id" "uuid", "p_ops" "jsonb", "p_expected_updated_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_spec_load"("p_project_id" "uuid", "p_mode" "text", "p_actor" "uuid", "p_spec" "jsonb", "p_requirements" "jsonb", "p_mappings_add" "jsonb", "p_mappings_remove" "jsonb", "p_provenance" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_spec_load"("p_project_id" "uuid", "p_mode" "text", "p_actor" "uuid", "p_spec" "jsonb", "p_requirements" "jsonb", "p_mappings_add" "jsonb", "p_mappings_remove" "jsonb", "p_provenance" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_can_contain_resolves"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_can_contain_resolves"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_can_contain_resolves"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_role_affinities_resolve"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_role_affinities_resolve"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_role_affinities_resolve"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."candidate_home_lane"("p_project_id" "uuid", "p_candidate_id" "uuid", "p_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."candidate_home_lane"("p_project_id" "uuid", "p_candidate_id" "uuid", "p_kind" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_orphaned_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_orphaned_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_orphaned_users"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."classification_summary"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."classification_summary"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."classification_summary"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."classification_summary"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_test_case_artifacts"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_test_case_artifacts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_test_case_artifacts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_testid_from_acceptance_criteria"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_testid_from_acceptance_criteria"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_testid_from_acceptance_criteria"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."constraints_count"("p_project" "uuid", "p_counts" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."constraints_count"("p_project" "uuid", "p_counts" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."constraints_from_spec_json"("p_project" "uuid", "p_json" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."constraints_from_spec_json"("p_project" "uuid", "p_json" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."criteria_content"("p" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."criteria_content"("p" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."criteria_content"("p" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_ai_context_provenance"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_ai_context_provenance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_ai_context_provenance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_example_project"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_example_project"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_example_project"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."example_project_sql"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."example_project_sql"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."explode_rebind_on_proposal_accept"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."explode_rebind_on_proposal_accept"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."force_provision_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."force_provision_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_provision_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_all_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_all_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_provisioning_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_provisioning_health"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_provisioning_health"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_users_pending_provisioning"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_users_pending_provisioning"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_users_pending_provisioning"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."graph_patches_respect_leases"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."graph_patches_respect_leases"() TO "service_role";



GRANT ALL ON FUNCTION "public"."graph_patches_set_hash_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."graph_patches_set_hash_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."graph_patches_set_hash_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."graph_reference_ids"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."graph_reference_ids"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."graph_reference_ids"("p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_mcp_connection"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_mcp_connection"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_mcp_connection"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_mcp_connection"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_assign_groups"("p_job_id" "uuid", "p_groups" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_assign_groups"("p_job_id" "uuid", "p_groups" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_dir_tallies"("p_job_id" "uuid", "p_manifest_names" "text"[], "p_entry_point_names" "text"[], "p_config_names" "text"[], "p_signal_cap" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_dir_tallies"("p_job_id" "uuid", "p_manifest_names" "text"[], "p_entry_point_names" "text"[], "p_config_names" "text"[], "p_signal_cap" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_graph_group_edges"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_graph_group_edges"("p_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_graph_metrics"("p_job_id" "uuid", "p_iterations" integer, "p_damping" double precision, "p_budget_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_graph_metrics"("p_job_id" "uuid", "p_iterations" integer, "p_damping" double precision, "p_budget_ms" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_hub_files"("p_job_id" "uuid", "p_anchor_names" "text"[], "p_per_group" integer, "p_unassigned_sample" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_hub_files"("p_job_id" "uuid", "p_anchor_names" "text"[], "p_per_group" integer, "p_unassigned_sample" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_job_bump_attempt"("p_job_id" "uuid", "p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_job_bump_attempt"("p_job_id" "uuid", "p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_job_lease"("p_job_id" "uuid", "p_owner" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_job_lease"("p_job_id" "uuid", "p_owner" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_job_lease_release"("p_job_id" "uuid", "p_owner" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_job_lease_release"("p_job_id" "uuid", "p_owner" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_job_merge_metrics"("p_job_id" "uuid", "p_patch" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_job_merge_metrics"("p_job_id" "uuid", "p_patch" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_job_paths"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_job_paths"("p_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_job_set_probe"("p_job_id" "uuid", "p_stage" "text", "p_detail" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_job_set_probe"("p_job_id" "uuid", "p_stage" "text", "p_detail" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_jobs_stale"("p_stale_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_jobs_stale"("p_stale_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_promote_edges_page"("p_job_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_promote_edges_page"("p_job_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_promote_finish"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_promote_finish"("p_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_promote_finish_prepare"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_promote_finish_prepare"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."import_promote_on_proposal_accept"() TO "anon";
GRANT ALL ON FUNCTION "public"."import_promote_on_proposal_accept"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_promote_on_proposal_accept"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_promote_page"("p_job_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_promote_page"("p_job_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_root_deployments"("p_job_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_root_deployments"("p_job_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_wave_claim"("p_job_id" "uuid", "p_wave" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_wave_claim"("p_job_id" "uuid", "p_wave" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_wave_member_done"("p_job_id" "uuid", "p_wave" "text", "p_member" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_wave_member_done"("p_job_id" "uuid", "p_wave" "text", "p_member" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_wave_register"("p_job_id" "uuid", "p_wave" "text", "p_members" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_wave_register"("p_job_id" "uuid", "p_wave" "text", "p_members" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_blog_post_views"("post_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_blog_post_views"("post_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_blog_post_views"("post_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_example_project"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_example_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_example_project"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_min_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."jsonb_map_keys"("p_map" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."jsonb_map_keys"("p_map" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."jsonb_map_keys"("p_map" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_artifact_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_artifact_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_artifact_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_mapping_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_mapping_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_mapping_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_requirement_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_requirement_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_requirement_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_visible"("p_project_id" "uuid", "p_mark" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_api_keys_revocation_is_final"() TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_api_keys_revocation_is_final"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_api_keys_revocation_is_final"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mcp_credential_horizons"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mcp_credential_horizons"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_credential_horizons"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mcp_rate_take"("p_holder" "text", "p_user_id" "uuid", "p_capacity" integer, "p_per_second" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mcp_rate_take"("p_holder" "text", "p_user_id" "uuid", "p_capacity" integer, "p_per_second" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."member_project_ids"("p_min_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."member_project_ids"("p_min_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."member_project_ids"("p_min_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."member_project_ids"("p_min_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."node_memory"("p_project_id" "uuid", "p_branch_id" "uuid", "p_node_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."node_memory"("p_project_id" "uuid", "p_branch_id" "uuid", "p_node_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."node_memory"("p_project_id" "uuid", "p_branch_id" "uuid", "p_node_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."node_memory_is_layout"("p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."node_memory_is_layout"("p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."node_memory_is_layout"("p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."node_memory_touches"("p_patch" "jsonb", "p_node" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."node_memory_touches"("p_patch" "jsonb", "p_node" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."node_memory_touches"("p_patch" "jsonb", "p_node" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."on_test_case_status_change_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_test_case_status_change_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_test_case_status_change_fn"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."outcome_step_maps_terminal_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."outcome_step_maps_terminal_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."patch_changed_nodes"("p" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."patch_changed_nodes"("p" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."patch_changed_nodes"("p" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."plan_allows"("p_feature" "text", "p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."plan_allows"("p_feature" "text", "p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."plan_allows"("p_feature" "text", "p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."plan_guard_mark"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."plan_guard_mark"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_constraints_plan_scope"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_constraints_plan_scope"() TO "service_role";



GRANT ALL ON FUNCTION "public"."project_constraints_scope_shape"() TO "anon";
GRANT ALL ON FUNCTION "public"."project_constraints_scope_shape"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_constraints_scope_shape"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_delete_step"("p_project_id" "uuid", "p_limit" integer, "p_budget_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_delete_step"("p_project_id" "uuid", "p_limit" integer, "p_budget_ms" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_delete_step"("p_project_id" "uuid", "p_limit" integer, "p_budget_ms" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_owner_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."project_owner_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_owner_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_plan_tier"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_plan_tier"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_plan_tier"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_role"("p_project_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_role_rank"("p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_role_rank"("p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."project_role_rank"("p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_role_rank"("p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_roster"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_roster"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_roster"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_seats_carried"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_seats_carried"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_specifications_constraints_sync"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_specifications_constraints_sync"() TO "service_role";



GRANT ALL ON FUNCTION "public"."projects_example_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."projects_example_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."projects_example_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."projects_plan_cap"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."projects_plan_cap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."provision_stripe_customer_on_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."provision_stripe_customer_on_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."provision_stripe_customer_on_signup"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refuse_account_delete_with_seats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refuse_account_delete_with_seats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."repo_index_backfill_material"("p_branch_id" "uuid", "p_node_id" "text", "p_route_cap" integer, "p_schema_cap" integer, "p_test_cap" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."repo_index_backfill_material"("p_branch_id" "uuid", "p_node_id" "text", "p_route_cap" integer, "p_schema_cap" integer, "p_test_cap" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."repo_index_diff"("p_branch_id" "uuid", "p_head_sha" "text", "p_tree" "jsonb", "p_candidate_cap" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."repo_index_diff"("p_branch_id" "uuid", "p_head_sha" "text", "p_tree" "jsonb", "p_candidate_cap" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."repo_index_node_context"("p_branch_id" "uuid", "p_node_id" "text", "p_hub_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."repo_index_node_context"("p_branch_id" "uuid", "p_node_id" "text", "p_hub_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."repo_index_search"("p_branch_id" "uuid", "p_query" "text", "p_node_id" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."repo_index_search"("p_branch_id" "uuid", "p_query" "text", "p_node_id" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."requirement_candidates_freeze_first_derivation"() TO "anon";
GRANT ALL ON FUNCTION "public"."requirement_candidates_freeze_first_derivation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."requirement_candidates_freeze_first_derivation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."requirement_candidates_home_lane_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."requirement_candidates_home_lane_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."requirement_candidates_home_lane_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."requirement_candidates_plan_lane"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."requirement_candidates_plan_lane"() TO "service_role";



GRANT ALL ON FUNCTION "public"."requirement_lock_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."requirement_lock_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."requirement_lock_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."requirement_lock_guard_child"() TO "anon";
GRANT ALL ON FUNCTION "public"."requirement_lock_guard_child"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."requirement_lock_guard_child"() TO "service_role";



GRANT ALL ON FUNCTION "public"."requirement_lock_message"("p_ref" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."requirement_lock_message"("p_ref" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."requirement_lock_message"("p_ref" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."seat_project_member"("p_project_id" "uuid", "p_email" "text", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seat_project_member"("p_project_id" "uuid", "p_email" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seat_project_member"("p_project_id" "uuid", "p_email" "text", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."technology_catalog_search_vector_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."technology_catalog_search_vector_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."technology_catalog_search_vector_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."template_counts_follow_rows"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."template_counts_follow_rows"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_project_ownership"("p_project_id" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_project_ownership"("p_project_id" "uuid", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_project_ownership"("p_project_id" "uuid", "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_emails"("p_user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_emails"("p_user_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_id_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") TO "service_role";




































GRANT ALL ON TABLE "public"."agent_checkouts" TO "anon";
GRANT ALL ON TABLE "public"."agent_checkouts" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_checkouts" TO "service_role";



GRANT ALL ON TABLE "public"."ai_proposal_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."ai_proposal_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_proposal_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."ai_proposals" TO "anon";
GRANT ALL ON TABLE "public"."ai_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."ai_runs" TO "anon";
GRANT ALL ON TABLE "public"."ai_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_runs" TO "service_role";



GRANT ALL ON TABLE "public"."app_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."artifacts" TO "anon";
GRANT ALL ON TABLE "public"."artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."blog_categories" TO "anon";
GRANT ALL ON TABLE "public"."blog_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."blog_categories" TO "service_role";



GRANT ALL ON TABLE "public"."blog_post_categories" TO "anon";
GRANT ALL ON TABLE "public"."blog_post_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."blog_post_categories" TO "service_role";



GRANT ALL ON TABLE "public"."blog_posts" TO "anon";
GRANT ALL ON TABLE "public"."blog_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."blog_posts" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."bug_reports" TO "anon";
GRANT ALL ON TABLE "public"."bug_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."bug_reports" TO "service_role";



GRANT ALL ON TABLE "public"."cloud_provider_patterns" TO "anon";
GRANT ALL ON TABLE "public"."cloud_provider_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."cloud_provider_patterns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cloud_provider_patterns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cloud_provider_patterns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cloud_provider_patterns_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."couplings" TO "anon";
GRANT ALL ON TABLE "public"."couplings" TO "authenticated";
GRANT ALL ON TABLE "public"."couplings" TO "service_role";



GRANT ALL ON TABLE "public"."deployment_settings" TO "service_role";



GRANT ALL ON TABLE "public"."deployment_targets" TO "anon";
GRANT ALL ON TABLE "public"."deployment_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."deployment_targets" TO "service_role";



GRANT ALL ON TABLE "public"."enterprise_contact_requests" TO "anon";
GRANT ALL ON TABLE "public"."enterprise_contact_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."enterprise_contact_requests" TO "service_role";



GRANT ALL ON TABLE "public"."git_change_events" TO "anon";
GRANT ALL ON TABLE "public"."git_change_events" TO "authenticated";
GRANT ALL ON TABLE "public"."git_change_events" TO "service_role";



GRANT ALL ON TABLE "public"."git_integrations" TO "anon";
GRANT ALL ON TABLE "public"."git_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."git_integrations" TO "service_role";



GRANT ALL ON TABLE "public"."git_sync_log" TO "anon";
GRANT ALL ON TABLE "public"."git_sync_log" TO "authenticated";
GRANT ALL ON TABLE "public"."git_sync_log" TO "service_role";



GRANT ALL ON TABLE "public"."graph_patches" TO "anon";
GRANT ALL ON TABLE "public"."graph_patches" TO "authenticated";
GRANT ALL ON TABLE "public"."graph_patches" TO "service_role";



GRANT ALL ON TABLE "public"."graph_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."graph_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."graph_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."import_edge_kind_map" TO "anon";
GRANT ALL ON TABLE "public"."import_edge_kind_map" TO "authenticated";
GRANT ALL ON TABLE "public"."import_edge_kind_map" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_edges" TO "anon";
GRANT ALL ON TABLE "public"."import_job_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_edges" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_files" TO "anon";
GRANT ALL ON TABLE "public"."import_job_files" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_files" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_group_edges" TO "anon";
GRANT ALL ON TABLE "public"."import_job_group_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_group_edges" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_groups" TO "anon";
GRANT ALL ON TABLE "public"."import_job_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_groups" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_rank" TO "anon";
GRANT ALL ON TABLE "public"."import_job_rank" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_rank" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_waves" TO "anon";
GRANT ALL ON TABLE "public"."import_job_waves" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_waves" TO "service_role";



GRANT ALL ON TABLE "public"."import_jobs" TO "anon";
GRANT ALL ON TABLE "public"."import_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_jobs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."mcp_api_keys" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."mcp_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_oauth_codes" TO "anon";
GRANT ALL ON TABLE "public"."mcp_oauth_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_oauth_codes" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_oauth_tokens" TO "anon";
GRANT ALL ON TABLE "public"."mcp_oauth_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_oauth_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_rate_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."node_dependencies" TO "anon";
GRANT ALL ON TABLE "public"."node_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."node_dependencies" TO "service_role";



GRANT ALL ON TABLE "public"."node_roles" TO "anon";
GRANT ALL ON TABLE "public"."node_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."node_roles" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_customers" TO "anon";
GRANT ALL ON TABLE "public"."stripe_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_customers" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."stripe_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."subscription_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."orphaned_users_needing_provisioning" TO "anon";
GRANT ALL ON TABLE "public"."orphaned_users_needing_provisioning" TO "authenticated";
GRANT ALL ON TABLE "public"."orphaned_users_needing_provisioning" TO "service_role";



GRANT ALL ON TABLE "public"."outcome_derivations" TO "anon";
GRANT ALL ON TABLE "public"."outcome_derivations" TO "authenticated";
GRANT ALL ON TABLE "public"."outcome_derivations" TO "service_role";



GRANT ALL ON TABLE "public"."outcome_step_maps" TO "anon";
GRANT ALL ON TABLE "public"."outcome_step_maps" TO "authenticated";
GRANT ALL ON TABLE "public"."outcome_step_maps" TO "service_role";



GRANT ALL ON TABLE "public"."project_constraints" TO "anon";
GRANT ALL ON TABLE "public"."project_constraints" TO "authenticated";
GRANT ALL ON TABLE "public"."project_constraints" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_specifications" TO "anon";
GRANT ALL ON TABLE "public"."project_specifications" TO "authenticated";
GRANT ALL ON TABLE "public"."project_specifications" TO "service_role";



GRANT ALL ON TABLE "public"."project_templates" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."project_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_templates" TO "service_role";



GRANT UPDATE("name") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("description") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("category") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("graph_data") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("thumbnail_url") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("tags") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("technologies") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("node_count") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("edge_count") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("is_public") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("version") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("updated_at") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("template_specification") ON TABLE "public"."project_templates" TO "authenticated";



GRANT UPDATE("repo_url") ON TABLE "public"."project_templates" TO "authenticated";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."repo_index" TO "anon";
GRANT ALL ON TABLE "public"."repo_index" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_index" TO "service_role";



GRANT ALL ON TABLE "public"."repo_index_edges" TO "anon";
GRANT ALL ON TABLE "public"."repo_index_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_index_edges" TO "service_role";



GRANT ALL ON TABLE "public"."repo_index_freshness" TO "anon";
GRANT ALL ON TABLE "public"."repo_index_freshness" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_index_freshness" TO "service_role";



GRANT ALL ON TABLE "public"."requirement_candidates" TO "anon";
GRANT ALL ON TABLE "public"."requirement_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."requirement_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."scope_archetypes" TO "anon";
GRANT ALL ON TABLE "public"."scope_archetypes" TO "authenticated";
GRANT ALL ON TABLE "public"."scope_archetypes" TO "service_role";



GRANT ALL ON TABLE "public"."specification_mappings" TO "anon";
GRANT ALL ON TABLE "public"."specification_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."specification_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."specification_requirement_relations" TO "anon";
GRANT ALL ON TABLE "public"."specification_requirement_relations" TO "authenticated";
GRANT ALL ON TABLE "public"."specification_requirement_relations" TO "service_role";



GRANT ALL ON TABLE "public"."specification_requirements" TO "anon";
GRANT ALL ON TABLE "public"."specification_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."specification_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."specification_sections" TO "anon";
GRANT ALL ON TABLE "public"."specification_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."specification_sections" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_orders" TO "anon";
GRANT ALL ON TABLE "public"."stripe_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_orders" TO "service_role";



GRANT ALL ON TABLE "public"."task_items" TO "anon";
GRANT ALL ON TABLE "public"."task_items" TO "authenticated";
GRANT ALL ON TABLE "public"."task_items" TO "service_role";



GRANT ALL ON TABLE "public"."technology_catalog" TO "anon";
GRANT ALL ON TABLE "public"."technology_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."technology_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."template_comments" TO "anon";
GRANT ALL ON TABLE "public"."template_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."template_comments" TO "service_role";



GRANT ALL ON TABLE "public"."template_upvotes" TO "anon";
GRANT ALL ON TABLE "public"."template_upvotes" TO "authenticated";
GRANT ALL ON TABLE "public"."template_upvotes" TO "service_role";



GRANT ALL ON TABLE "public"."template_usage" TO "anon";
GRANT ALL ON TABLE "public"."template_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."template_usage" TO "service_role";



GRANT ALL ON TABLE "public"."test_cases" TO "anon";
GRANT ALL ON TABLE "public"."test_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."test_cases" TO "service_role";



GRANT ALL ON TABLE "public"."user_feedback" TO "anon";
GRANT ALL ON TABLE "public"."user_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."user_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";



GRANT ALL ON TABLE "public"."work_exports" TO "anon";
GRANT ALL ON TABLE "public"."work_exports" TO "authenticated";
GRANT ALL ON TABLE "public"."work_exports" TO "service_role";



GRANT ALL ON TABLE "public"."work_plan_edges" TO "anon";
GRANT ALL ON TABLE "public"."work_plan_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."work_plan_edges" TO "service_role";



GRANT ALL ON TABLE "public"."work_plan_items" TO "anon";
GRANT ALL ON TABLE "public"."work_plan_items" TO "authenticated";
GRANT ALL ON TABLE "public"."work_plan_items" TO "service_role";



GRANT ALL ON TABLE "public"."work_plans" TO "anon";
GRANT ALL ON TABLE "public"."work_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."work_plans" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_steps" TO "anon";
GRANT ALL ON TABLE "public"."workflow_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_steps" TO "service_role";



GRANT ALL ON TABLE "public"."workflows" TO "anon";
GRANT ALL ON TABLE "public"."workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."workflows" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































