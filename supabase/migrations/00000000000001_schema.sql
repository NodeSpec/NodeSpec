


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






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






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
AND p.owner_id = auth.uid()
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


CREATE OR REPLACE FUNCTION "public"."cleanup_old_conversation_history"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
DELETE FROM public.conversation_history
WHERE created_at < now() - INTERVAL '30 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_conversation_history"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."convert_graph_nodes_to_v3"("graph" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
nodes_obj jsonb;
node_key text;
node_val jsonb;
mapping record;
new_nodes jsonb := '{}'::jsonb;
changed boolean := false;
BEGIN
nodes_obj := graph -> 'nodes';

IF nodes_obj IS NULL OR jsonb_typeof(nodes_obj) != 'object' THEN
RETURN graph;
END IF;

FOR node_key, node_val IN SELECT * FROM jsonb_each(nodes_obj)
LOOP
SELECT ltm.role_id, ltm.technology_id, ltm.deployment_target_id
INTO mapping
FROM public.legacy_type_mappings ltm
WHERE ltm.legacy_type = node_val ->> 'type';

IF mapping IS NOT NULL THEN
node_val := jsonb_set(node_val, '{type}', to_jsonb(mapping.role_id));

IF mapping.technology_id IS NOT NULL AND (node_val ->> 'technology') IS NULL THEN
node_val := jsonb_set(node_val, '{technology}', to_jsonb(mapping.technology_id));
END IF;

IF mapping.deployment_target_id IS NOT NULL AND (node_val ->> 'deploymentTarget') IS NULL THEN
node_val := jsonb_set(node_val, '{deploymentTarget}', to_jsonb(mapping.deployment_target_id));
END IF;

changed := true;
END IF;

new_nodes := new_nodes || jsonb_build_object(node_key, node_val);
END LOOP;

IF changed THEN
RETURN jsonb_set(graph, '{nodes}', new_nodes);
ELSE
RETURN graph;
END IF;
END;
$$;


ALTER FUNCTION "public"."convert_graph_nodes_to_v3"("graph" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_patch_payload_to_v3"("payload" "jsonb", "patch_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
node_obj jsonb;
node_type text;
mapping record;
path_key text;
BEGIN
IF patch_type = 'add_node' THEN
path_key := 'node';
ELSIF patch_type = 'update_node' THEN
path_key := 'changes';
ELSE
RETURN payload;
END IF;

node_obj := payload -> path_key;
IF node_obj IS NULL THEN
RETURN payload;
END IF;

node_type := node_obj ->> 'type';
IF node_type IS NULL THEN
RETURN payload;
END IF;

SELECT ltm.role_id, ltm.technology_id, ltm.deployment_target_id
INTO mapping
FROM public.legacy_type_mappings ltm
WHERE ltm.legacy_type = node_type;

IF mapping IS NULL THEN
RETURN payload;
END IF;

node_obj := jsonb_set(node_obj, '{type}', to_jsonb(mapping.role_id));

IF mapping.technology_id IS NOT NULL AND (node_obj ->> 'technology') IS NULL THEN
node_obj := jsonb_set(node_obj, '{technology}', to_jsonb(mapping.technology_id));
END IF;

IF mapping.deployment_target_id IS NOT NULL AND (node_obj ->> 'deploymentTarget') IS NULL THEN
node_obj := jsonb_set(node_obj, '{deploymentTarget}', to_jsonb(mapping.deployment_target_id));
END IF;

RETURN jsonb_set(payload, ARRAY[path_key], node_obj);
END;
$$;


ALTER FUNCTION "public"."convert_patch_payload_to_v3"("payload" "jsonb", "patch_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_template_upvote_count"("tid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE project_templates
  SET upvote_count = GREATEST(upvote_count - 1, 0)
  WHERE id = tid;
END;
$$;


ALTER FUNCTION "public"."decrement_template_upvote_count"("tid" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."evaluate_acceptance_criteria"("p_requirement_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
v_criteria jsonb;
v_spec_id uuid;
v_updated_criteria jsonb := '[]'::jsonb;
v_criterion jsonb;
v_test_id text;
v_test_status text;
v_has_validates boolean;
v_met boolean;
v_total int := 0;
v_met_count int := 0;
v_unmet_count int := 0;
v_unknown_count int := 0;
i int;
BEGIN
SELECT sr.acceptance_criteria, sr.specification_id
INTO v_criteria, v_spec_id
FROM specification_requirements sr
JOIN project_specifications ps ON ps.id = sr.specification_id
JOIN projects p ON p.id = ps.project_id
WHERE sr.id = p_requirement_id
AND p.owner_id = auth.uid();

IF NOT FOUND THEN
RAISE EXCEPTION 'Requirement not found or access denied';
END IF;

IF v_criteria IS NULL OR jsonb_array_length(v_criteria) = 0 THEN
RETURN jsonb_build_object('total', 0, 'met', 0, 'unmet', 0, 'unknown', 0);
END IF;

FOR i IN 0..jsonb_array_length(v_criteria) - 1 LOOP
v_criterion := v_criteria->i;
v_test_id := v_criterion->>'testId';
v_total := v_total + 1;
v_met := NULL;

IF v_test_id IS NOT NULL AND v_test_id != '' THEN
SELECT status INTO v_test_status
FROM test_cases
WHERE id = v_test_id::uuid;

IF v_test_status = 'passed' THEN
v_met := true;
ELSIF v_test_status = 'failed' THEN
v_met := false;
END IF;
ELSE
SELECT EXISTS(
SELECT 1 FROM specification_mappings
WHERE requirement_id = p_requirement_id
AND mapping_type = 'validates'
AND confidence >= 0.8
) INTO v_has_validates;

IF v_has_validates THEN
v_met := true;
END IF;
END IF;

IF v_met IS TRUE THEN
v_met_count := v_met_count + 1;
v_criterion := jsonb_set(v_criterion, '{met}', 'true'::jsonb);
ELSIF v_met IS FALSE THEN
v_unmet_count := v_unmet_count + 1;
v_criterion := jsonb_set(v_criterion, '{met}', 'false'::jsonb);
ELSE
v_unknown_count := v_unknown_count + 1;
END IF;

v_updated_criteria := v_updated_criteria || jsonb_build_array(v_criterion);
END LOOP;

UPDATE specification_requirements
SET acceptance_criteria = v_updated_criteria,
updated_at = now()
WHERE id = p_requirement_id;

RETURN jsonb_build_object(
'total', v_total,
'met', v_met_count,
'unmet', v_unmet_count,
'unknown', v_unknown_count
);
END;
$$;


ALTER FUNCTION "public"."evaluate_acceptance_criteria"("p_requirement_id" "uuid") OWNER TO "postgres";


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
  _is_admin boolean;
BEGIN
  -- Check if caller is admin
  SELECT is_admin INTO _is_admin
  FROM public.user_settings
  WHERE user_id = auth.uid();

  IF NOT COALESCE(_is_admin, false) THEN
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
AND p.owner_id = auth.uid()
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
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_provision_stripe_customer'
      AND tgrelid = 'auth.users'::regclass
      AND tgenabled = 'O'
  ) INTO _trigger_exists;

  SELECT 
    COUNT(*) = 2
  INTO _vault_secrets_ok
  FROM vault.decrypted_secrets
  WHERE name IN ('supabase_url', 'supabase_anon_key')
    AND decrypted_secret IS NOT NULL;

  SELECT COUNT(*)
  INTO _recent_successes
  FROM public.subscription_audit_log
  WHERE action = 'provisioning_success'
    AND created_at > now() - interval '1 hour';

  SELECT COUNT(*)
  INTO _recent_failures
  FROM public.subscription_audit_log
  WHERE action IN ('provisioning_failed', 'trigger_failed')
    AND created_at > now() - interval '1 hour';

  SELECT COUNT(*)
  INTO _orphaned_count
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
AND p.owner_id = auth.uid()
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
  _is_admin boolean;
BEGIN
  SELECT is_admin INTO _is_admin
  FROM public.user_settings
  WHERE user_id = auth.uid();

  IF NOT COALESCE(_is_admin, false) THEN
    RAISE EXCEPTION 'unauthorized: only admins can view pending provisioning';
  END IF;

  RETURN QUERY
  SELECT 
    u.id as user_id,
    u.email,
    u.created_at,
    EXTRACT(EPOCH FROM (now() - u.created_at)) / 60 as minutes_waiting,
    COUNT(DISTINCT sal.id) as trigger_attempts,
    (
      SELECT sal2.metadata->>'error'
      FROM public.subscription_audit_log sal2
      WHERE sal2.user_id = u.id
        AND sal2.action IN ('provisioning_failed', 'trigger_failed')
      ORDER BY sal2.created_at DESC
      LIMIT 1
    ) as last_error,
    (EXTRACT(EPOCH FROM (now() - u.created_at)) / 60 > 10 
     OR COUNT(sal.id) FILTER (WHERE sal.action = 'trigger_failed') > 2
    ) as needs_manual_intervention
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
    token_limit, amount_cents, currency, billing_interval,
    is_lifetime_limit
  ) VALUES (
    p_user_id, p_customer_id, 'community', 'active',
    0, 0, 'usd', 'month',
    false
  );
END;
$$;


ALTER FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."increment_template_upvote_count"("tid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE project_templates
  SET upvote_count = upvote_count + 1
  WHERE id = tid;
END;
$$;


ALTER FUNCTION "public"."increment_template_upvote_count"("tid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_template_use_count"("tid" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE project_templates
  SET use_count = use_count + 1, updated_at = now()
  WHERE id = tid;
$$;


ALTER FUNCTION "public"."increment_template_use_count"("tid" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."n9b_convert_nodes"("graph" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
  nodes jsonb;
  node_key text;
  node_val jsonb;
  el jsonb;
  mapping record;
  rebuilt jsonb;
  changed boolean := false;
BEGIN
  nodes := graph -> 'nodes';
  IF nodes IS NULL THEN RETURN graph; END IF;

  -- domain shape: nodes as object map
  IF jsonb_typeof(nodes) = 'object' THEN
    rebuilt := '{}'::jsonb;
    FOR node_key, node_val IN SELECT * FROM jsonb_each(nodes) LOOP
      IF position('.' IN COALESCE(node_val ->> 'type', '')) > 0 THEN
        SELECT ltm.role_id, ltm.technology_id INTO mapping
        FROM public.legacy_type_mappings ltm
        WHERE ltm.legacy_type = node_val ->> 'type';
        IF FOUND AND mapping.role_id IS NOT NULL THEN
          node_val := jsonb_set(node_val, '{type}', to_jsonb(mapping.role_id));
          IF mapping.technology_id IS NOT NULL
             AND COALESCE(node_val ->> 'technology', '') = '' THEN
            node_val := jsonb_set(node_val, '{technology}', to_jsonb(mapping.technology_id));
          END IF;
          changed := true;
        END IF;
      END IF;
      rebuilt := rebuilt || jsonb_build_object(node_key, node_val);
    END LOOP;
    IF changed THEN RETURN jsonb_set(graph, '{nodes}', rebuilt); END IF;
    RETURN graph;
  END IF;

  -- ReactFlow shape: nodes as array (templates only) — dotted domain types can sit
  -- at el.type, el.data.type or el.data.nodeType; render types never contain dots.
  IF jsonb_typeof(nodes) = 'array' THEN
    rebuilt := '[]'::jsonb;
    FOR el IN SELECT * FROM jsonb_array_elements(nodes) LOOP
      FOR mapping IN
        SELECT ltm.role_id, ltm.technology_id, p.path
        FROM (VALUES ('{type}'::text[], 1), ('{data,type}'::text[], 2), ('{data,nodeType}'::text[], 3)) AS p(path, ord)
        JOIN public.legacy_type_mappings ltm
          ON ltm.legacy_type = el #>> p.path
        WHERE position('.' IN COALESCE(el #>> p.path, '')) > 0
        ORDER BY p.ord
      LOOP
        el := jsonb_set(el, mapping.path, to_jsonb(mapping.role_id));
        IF mapping.technology_id IS NOT NULL
           AND COALESCE(el ->> 'technology', el -> 'data' ->> 'technology', '') = '' THEN
          el := jsonb_set(el, '{technology}', to_jsonb(mapping.technology_id));
        END IF;
        changed := true;
      END LOOP;
      rebuilt := rebuilt || jsonb_build_array(el);
    END LOOP;
    IF changed THEN RETURN jsonb_set(graph, '{nodes}', rebuilt); END IF;
    RETURN graph;
  END IF;

  RETURN graph;
END;
$$;


ALTER FUNCTION "public"."n9b_convert_nodes"("graph" "jsonb") OWNER TO "postgres";


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
  v_requirement_id uuid;
  v_criteria jsonb;
  v_updated_criteria jsonb;
  v_criterion jsonb;
  v_new_met boolean;
  i int;
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

  FOR v_requirement_id, v_criteria IN
    SELECT sr.id, sr.acceptance_criteria
    FROM specification_requirements sr
    WHERE sr.acceptance_criteria IS NOT NULL
      AND jsonb_array_length(sr.acceptance_criteria) > 0
      AND sr.acceptance_criteria::text LIKE '%' || NEW.id::text || '%'
  LOOP
    v_updated_criteria := '[]'::jsonb;

    FOR i IN 0..jsonb_array_length(v_criteria) - 1 LOOP
      v_criterion := v_criteria->i;

      IF v_criterion->>'testId' = NEW.id::text THEN
        v_criterion := jsonb_set(v_criterion, '{met}', to_jsonb(v_new_met));
      END IF;

      v_updated_criteria := v_updated_criteria || jsonb_build_array(v_criterion);
    END LOOP;

    UPDATE specification_requirements
    SET acceptance_criteria = v_updated_criteria,
        updated_at = now()
    WHERE id = v_requirement_id;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_test_case_status_change_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_orphaned_user_alerts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  _orphaned_user RECORD;
  _alert_count integer := 0;
BEGIN
  FOR _orphaned_user IN 
    SELECT * FROM public.check_orphaned_users()
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.provisioning_alerts
      WHERE user_id = _orphaned_user.user_id
        AND alert_type = 'orphaned_user'
        AND NOT resolved
    ) THEN
      INSERT INTO public.provisioning_alerts (
        user_id, 
        alert_type, 
        severity, 
        message, 
        metadata
      ) VALUES (
        _orphaned_user.user_id,
        'orphaned_user',
        CASE 
          WHEN _orphaned_user.minutes_since_signup > 60 THEN 'critical'
          WHEN _orphaned_user.minutes_since_signup > 30 THEN 'high'
          WHEN _orphaned_user.minutes_since_signup > 10 THEN 'medium'
          ELSE 'low'
        END,
        format('User %s has been without Stripe customer for %s minutes', 
          _orphaned_user.email, 
          ROUND(_orphaned_user.minutes_since_signup::numeric, 1)
        ),
        jsonb_build_object(
          'minutes_since_signup', _orphaned_user.minutes_since_signup,
          'provision_attempts', _orphaned_user.provision_attempts,
          'last_provision_attempt', _orphaned_user.last_provision_attempt
        )
      );
      _alert_count := _alert_count + 1;
    END IF;
  END LOOP;

  RETURN _alert_count;
END;
$$;


ALTER FUNCTION "public"."process_orphaned_user_alerts"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."reconstruct_legacy_type"("p_role_id" "text", "p_technology_id" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
result text;
BEGIN
IF p_technology_id IS NOT NULL THEN
SELECT ltm.legacy_type INTO result
FROM public.legacy_type_mappings ltm
WHERE ltm.role_id = p_role_id
AND ltm.technology_id = p_technology_id
LIMIT 1;
END IF;

IF result IS NULL THEN
SELECT ltm.legacy_type INTO result
FROM public.legacy_type_mappings ltm
WHERE ltm.role_id = p_role_id
AND ltm.technology_id IS NULL
LIMIT 1;
END IF;

IF result IS NULL THEN
RETURN p_role_id;
END IF;

RETURN result;
END;
$$;


ALTER FUNCTION "public"."reconstruct_legacy_type"("p_role_id" "text", "p_technology_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."repair_feature_requirement_consistency"("p_specification_id" "uuid") RETURNS TABLE("repaired_entity_type" "text", "repaired_entity_id" "uuid", "repaired_entity_name" "text", "added_links" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  req_row RECORD;
  feat_row RECORD;
  missing_feature_names text[];
  missing_req_ids text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_specifications ps
    JOIN public.projects p ON p.id = ps.project_id
    WHERE ps.id = p_specification_id
    AND p.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Specification not found or access denied';
  END IF;

  FOR req_row IN
    SELECT r.id, r.requirement_id, r.name, r.feature_names
    FROM public.specification_requirements r
    WHERE r.specification_id = p_specification_id
  LOOP
    SELECT ARRAY(
      SELECT f.name
      FROM public.specification_features f
      WHERE f.specification_id = p_specification_id
      AND req_row.requirement_id = ANY(
        SELECT jsonb_array_elements_text(f.related_requirements)
      )
      AND f.name NOT IN (
        SELECT jsonb_array_elements_text(req_row.feature_names)
      )
    ) INTO missing_feature_names;

    IF array_length(missing_feature_names, 1) > 0 THEN
      UPDATE public.specification_requirements
      SET feature_names = feature_names || to_jsonb(missing_feature_names)
      WHERE id = req_row.id;

      repaired_entity_type := 'requirement';
      repaired_entity_id := req_row.id;
      repaired_entity_name := req_row.name;
      added_links := missing_feature_names;
      RETURN NEXT;
    END IF;
  END LOOP;

  FOR feat_row IN
    SELECT f.id, f.name, f.related_requirements
    FROM public.specification_features f
    WHERE f.specification_id = p_specification_id
  LOOP
    SELECT ARRAY(
      SELECT r.requirement_id
      FROM public.specification_requirements r
      WHERE r.specification_id = p_specification_id
      AND feat_row.name = ANY(
        SELECT jsonb_array_elements_text(r.feature_names)
      )
      AND r.requirement_id NOT IN (
        SELECT jsonb_array_elements_text(feat_row.related_requirements)
      )
    ) INTO missing_req_ids;

    IF array_length(missing_req_ids, 1) > 0 THEN
      UPDATE public.specification_features
      SET related_requirements = related_requirements || to_jsonb(missing_req_ids)
      WHERE id = feat_row.id;

      repaired_entity_type := 'feature';
      repaired_entity_id := feat_row.id;
      repaired_entity_name := feat_row.name;
      added_links := missing_req_ids;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."repair_feature_requirement_consistency"("p_specification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_graph_nodes_to_legacy"("graph" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
nodes_obj jsonb;
node_key text;
node_val jsonb;
legacy text;
new_nodes jsonb := '{}'::jsonb;
changed boolean := false;
BEGIN
nodes_obj := graph -> 'nodes';

IF nodes_obj IS NULL OR jsonb_typeof(nodes_obj) != 'object' THEN
RETURN graph;
END IF;

FOR node_key, node_val IN SELECT * FROM jsonb_each(nodes_obj)
LOOP
legacy := public.reconstruct_legacy_type(
node_val ->> 'type',
node_val ->> 'technology'
);

IF legacy IS DISTINCT FROM (node_val ->> 'type') THEN
node_val := jsonb_set(node_val, '{type}', to_jsonb(legacy));
node_val := node_val - 'technology' - 'deploymentTarget';
changed := true;
END IF;

new_nodes := new_nodes || jsonb_build_object(node_key, node_val);
END LOOP;

IF changed THEN
RETURN jsonb_set(graph, '{nodes}', new_nodes);
ELSE
RETURN graph;
END IF;
END;
$$;


ALTER FUNCTION "public"."revert_graph_nodes_to_legacy"("graph" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer DEFAULT 20) RETURNS TABLE("tech_id" "text", "tech_name" "text", "role_affinities" "jsonb", "purpose" "text", "rank" real)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  search_query tsquery;
  words text[];
  word text;
  or_query text := '';
BEGIN
  words := regexp_split_to_array(trim(query_text), '\s+');

  FOREACH word IN ARRAY words LOOP
    IF length(word) >= 2 THEN
      IF or_query != '' THEN
        or_query := or_query || ' | ';
      END IF;
      or_query := or_query || plainto_tsquery('english', word)::text;
    END IF;
  END LOOP;

  IF or_query = '' THEN
    RETURN;
  END IF;

  search_query := or_query::tsquery;

  RETURN QUERY
  SELECT
    tc.id AS tech_id,
    tc.name AS tech_name,
    tc.role_affinities,
    tc.ai_context->>'purpose' AS purpose,
    ts_rank_cd(tc.search_vector, search_query, 32) AS rank
  FROM technology_catalog tc
  WHERE tc.search_vector @@ search_query
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$;


ALTER FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) OWNER TO "postgres";


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
AND p.owner_id = auth.uid()
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


CREATE OR REPLACE FUNCTION "public"."update_blog_post_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_blog_post_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_catalog_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_catalog_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_project_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_project_timestamp"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_user_api_keys_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_api_keys_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_settings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_settings_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_feature_requirement_consistency"("p_specification_id" "uuid") RETURNS TABLE("entity_type" "text", "entity_id" "uuid", "entity_name" "text", "missing_links" "text"[], "direction" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_specifications ps
    JOIN public.projects p ON p.id = ps.project_id
    WHERE ps.id = p_specification_id
    AND p.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Specification not found or access denied';
  END IF;

  RETURN QUERY
  SELECT
    'requirement'::text AS entity_type,
    r.id AS entity_id,
    r.name AS entity_name,
    ARRAY(
      SELECT f.name
      FROM public.specification_features f
      WHERE f.specification_id = p_specification_id
      AND r.requirement_id = ANY(
        SELECT jsonb_array_elements_text(f.related_requirements)
      )
      AND f.name NOT IN (
        SELECT jsonb_array_elements_text(r.feature_names)
      )
    ) AS missing_links,
    'feature_names missing entries'::text AS direction
  FROM public.specification_requirements r
  WHERE r.specification_id = p_specification_id
  AND EXISTS (
    SELECT 1
    FROM public.specification_features f
    WHERE f.specification_id = p_specification_id
    AND r.requirement_id = ANY(
      SELECT jsonb_array_elements_text(f.related_requirements)
    )
    AND f.name NOT IN (
      SELECT jsonb_array_elements_text(r.feature_names)
    )
  )

  UNION ALL

  SELECT
    'feature'::text AS entity_type,
    f.id AS entity_id,
    f.name AS entity_name,
    ARRAY(
      SELECT r.requirement_id
      FROM public.specification_requirements r
      WHERE r.specification_id = p_specification_id
      AND f.name = ANY(
        SELECT jsonb_array_elements_text(r.feature_names)
      )
      AND r.requirement_id NOT IN (
        SELECT jsonb_array_elements_text(f.related_requirements)
      )
    ) AS missing_links,
    'related_requirements missing entries'::text AS direction
  FROM public.specification_features f
  WHERE f.specification_id = p_specification_id
  AND EXISTS (
    SELECT 1
    FROM public.specification_requirements r
    WHERE r.specification_id = p_specification_id
    AND f.name = ANY(
      SELECT jsonb_array_elements_text(r.feature_names)
    )
    AND r.requirement_id NOT IN (
      SELECT jsonb_array_elements_text(f.related_requirements)
    )
  );
END;
$$;


ALTER FUNCTION "public"."validate_feature_requirement_consistency"("p_specification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") RETURNS TABLE("user_id" "uuid", "key_id" "uuid", "scopes" "text"[], "is_valid" boolean, "rejection_reason" "text")
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
    RETURN QUERY SELECT 
      NULL::uuid,
      NULL::uuid,
      NULL::text[],
      false,
      'Invalid API key'::text;
    RETURN;
  END IF;

  IF v_key_record.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 
      v_key_record.user_id,
      v_key_record.id,
      v_key_record.scopes,
      false,
      'API key has been revoked'::text;
    RETURN;
  END IF;

  IF v_key_record.expires_at IS NOT NULL AND v_key_record.expires_at < now() THEN
    RETURN QUERY SELECT 
      v_key_record.user_id,
      v_key_record.id,
      v_key_record.scopes,
      false,
      'API key has expired'::text;
    RETURN;
  END IF;

  UPDATE mcp_api_keys
  SET last_used_at = now()
  WHERE id = v_key_record.id;

  RETURN QUERY SELECT 
    v_key_record.user_id,
    v_key_record.id,
    v_key_record.scopes,
    true,
    NULL::text;
END;
$$;


ALTER FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") OWNER TO "postgres";


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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agent_run_checkpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "current_phase" "text",
    "detected_intent" "text",
    "specification_id" "uuid",
    "patches" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "graph_snapshot" "jsonb",
    "arch_session" "jsonb",
    "counters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "summary" "text",
    "user_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "transcript" "jsonb"
);


ALTER TABLE "public"."agent_run_checkpoints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_proposal_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "artifact_id" "text" NOT NULL,
    "content" "text" NOT NULL,
    "content_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_proposal_artifacts" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."artifacts" (
    "id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "uri" "text",
    "content" "jsonb",
    "storage_path" "text",
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
    CONSTRAINT "artifacts_kind_check" CHECK ((("kind" IS NULL) OR ("kind" = ANY (ARRAY['source'::"text", 'schema'::"text", 'doc'::"text", 'config'::"text", 'build'::"text", 'design'::"text", 'task'::"text", 'test-plan'::"text"]))))
);


ALTER TABLE "public"."artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blog_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."blog_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blog_post_categories" (
    "post_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL
);


ALTER TABLE "public"."blog_post_categories" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "base_snapshot_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "git_ref" "text",
    "last_synced_commit" "text",
    "is_primary" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."cloud_provider_patterns" (
    "id" integer NOT NULL,
    "provider" "text" NOT NULL,
    "archetype" "text" NOT NULL,
    "guidance" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cloud_provider_patterns" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cloud_provider_patterns_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cloud_provider_patterns_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cloud_provider_patterns_id_seq" OWNED BY "public"."cloud_provider_patterns"."id";



CREATE TABLE IF NOT EXISTS "public"."code_structures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "artifact_id" "uuid",
    "node_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "entities" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "relationships" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "modules" "jsonb",
    "metrics" "jsonb",
    "language" character varying(50) NOT NULL,
    "parse_depth" character varying(20) DEFAULT 'shallow'::character varying,
    "content_hash" character varying(64),
    "parsed_at" timestamp with time zone DEFAULT "now"(),
    "parser_version" character varying(20) DEFAULT 'v1'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "filename" character varying(500)
);


ALTER TABLE "public"."code_structures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "conversation_history_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."conversation_history" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."generation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb" DEFAULT '{}'::"jsonb",
    "sequence" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."generation_events" OWNER TO "postgres";


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
    "created_by" "uuid" NOT NULL,
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
    "content_truncated" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."import_job_files" OWNER TO "postgres";


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
    CONSTRAINT "import_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'awaiting_review'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."import_jobs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."import_jobs" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."mcp_oauth_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "access_token_hash" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['read'::"text", 'write'::"text", 'propose'::"text"] NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mcp_oauth_tokens" OWNER TO "postgres";


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
    "default_ports" "jsonb" DEFAULT '[]'::"jsonb",
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
    CONSTRAINT "node_roles_interface_kind_check" CHECK (("interface_kind" = ANY (ARRAY['service'::"text", 'data'::"text", 'object_store'::"text", 'queue'::"text", 'event_bus'::"text", 'auth'::"text", 'telemetry'::"text"]))),
    CONSTRAINT "node_roles_nature_check" CHECK (("nature" = ANY (ARRAY['build'::"text", 'integrate'::"text", 'host'::"text", 'engine'::"text", 'call'::"text"]))),
    CONSTRAINT "node_roles_nature_containment_check" CHECK (((NOT (("nature" = 'host'::"text") AND ("is_container" IS NOT TRUE))) AND (NOT (("nature" = ANY (ARRAY['call'::"text", 'engine'::"text"])) AND ("is_container" IS TRUE))))),
    CONSTRAINT "node_roles_palette_category_check" CHECK (("palette_category" = ANY (ARRAY['Services'::"text", 'Database'::"text", 'Networking'::"text", 'AI & ML'::"text", 'Messaging'::"text", 'Infrastructure'::"text", 'Platform'::"text", 'Automation'::"text", 'External'::"text", 'Observability'::"text", 'Hardware'::"text", 'Game Development'::"text", 'Logical'::"text", 'requirements'::"text"]))),
    CONSTRAINT "node_roles_rf_visual_type_check" CHECK (("rf_visual_type" = ANY (ARRAY['service'::"text", 'icon'::"text", 'container'::"text", 'api'::"text", 'queue'::"text", 'cache'::"text", 'external'::"text", 'library'::"text", 'requirement'::"text"]))),
    CONSTRAINT "node_roles_suggested_contracts_check" CHECK ("public"."node_roles_suggested_contracts_valid"("suggested_contracts"))
);


ALTER TABLE "public"."node_roles" OWNER TO "postgres";


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
    "token_limit" integer DEFAULT 0,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "refund_amount_cents" integer DEFAULT 0,
    "is_lifetime_limit" boolean DEFAULT false NOT NULL
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


CREATE TABLE IF NOT EXISTS "public"."project_specifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "vision" "text" NOT NULL,
    "constraints" "jsonb" DEFAULT '[]'::"jsonb",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "raw_input" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "locked_nodes" "jsonb" DEFAULT '[]'::"jsonb",
    "phase_status" "text" DEFAULT 'drafting_requirements'::"text" NOT NULL,
    CONSTRAINT "project_specifications_phase_status_check" CHECK (("phase_status" = ANY (ARRAY['drafting_requirements'::"text", 'requirements_confirmed'::"text", 'building_architecture'::"text", 'architecture_confirmed'::"text", 'generating_code'::"text", 'architecture_first'::"text"])))
);


ALTER TABLE "public"."project_specifications" OWNER TO "postgres";


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


COMMENT ON COLUMN "public"."project_templates"."template_specification" IS 'Optional specification blueprint containing vision, features, requirements, and node mappings. Applied when a user creates a project from this template.';



COMMENT ON COLUMN "public"."project_templates"."repo_url" IS 'Public source repository for this template. Official templates: owner-curated. Community templates: set by the author via the publish flow.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provisioning_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "resolved" boolean DEFAULT false,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "provisioning_alerts_alert_type_check" CHECK (("alert_type" = ANY (ARRAY['orphaned_user'::"text", 'provisioning_failed'::"text", 'duplicate_customer'::"text"]))),
    CONSTRAINT "provisioning_alerts_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."provisioning_alerts" OWNER TO "postgres";


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
    CONSTRAINT "specification_requirements_category_check" CHECK (("category" = ANY (ARRAY['functional'::"text", 'non-functional'::"text", 'technical'::"text", 'business'::"text"]))),
    CONSTRAINT "specification_requirements_source_check" CHECK (("source" = ANY (ARRAY['ai-generated'::"text", 'manual'::"text", 'refined'::"text", 'imported'::"text"]))),
    CONSTRAINT "specification_requirements_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in-progress'::"text", 'implemented'::"text", 'validated'::"text", 'blocked'::"text"])))
);

ALTER TABLE ONLY "public"."specification_requirements" REPLICA IDENTITY FULL;


ALTER TABLE "public"."specification_requirements" OWNER TO "postgres";


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
    CONSTRAINT "task_items_task_key_check" CHECK ((("char_length"("task_key") >= 1) AND ("char_length"("task_key") <= 64)))
);

ALTER TABLE ONLY "public"."task_items" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_items" IS 'Done-state + provenance for anchored implementation tasks (<!-- t:key --> in .task.md). State only — the task list always derives from the doc; orphaned marks keys the generator no longer emits.';



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


CREATE TABLE IF NOT EXISTS "public"."template_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."template_usage" OWNER TO "postgres";


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
    CONSTRAINT "test_cases_framework_check" CHECK ((("framework" IS NULL) OR ("framework" = ANY (ARRAY['vitest'::"text", 'jest'::"text", 'mocha'::"text", 'playwright'::"text", 'cypress'::"text", 'puppeteer'::"text", 'k6'::"text", 'artillery'::"text", 'pytest'::"text", 'unittest'::"text", 'go_test'::"text", 'rspec'::"text", 'minitest'::"text", 'junit'::"text", 'testng'::"text", 'nunit'::"text", 'xunit'::"text", 'swift_testing'::"text", 'xctest'::"text", 'dart_test'::"text", 'rust_test'::"text", 'elixir_exunit'::"text", 'other'::"text"])))),
    CONSTRAINT "test_cases_status_check" CHECK (("status" = ANY (ARRAY['not_started'::"text", 'passed'::"text", 'failed'::"text", 'skipped'::"text", 'running'::"text"]))),
    CONSTRAINT "test_cases_test_type_check" CHECK (("test_type" = ANY (ARRAY['unit'::"text", 'integration'::"text", 'e2e'::"text", 'acceptance'::"text", 'performance'::"text", 'security'::"text"])))
);

ALTER TABLE ONLY "public"."test_cases" REPLICA IDENTITY FULL;


ALTER TABLE "public"."test_cases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."test_cases"."retired_at" IS 'Soft-retirement timestamp (update_test_case retire lane). NULL = live. Retired cases are excluded from count/board surfaces but never deleted — evidence is preserved. A fresh report_test_results run revives the case (clears this).';



COMMENT ON COLUMN "public"."test_cases"."retired_reason" IS 'Why the case was retired (required by the retire lane, e.g. "superseded by TC-004"). Cleared on revival.';



CREATE TABLE IF NOT EXISTS "public"."token_addons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_payment_intent_id" "text",
    "tokens_purchased" integer DEFAULT 1000000 NOT NULL,
    "tokens_remaining" integer DEFAULT 1000000 NOT NULL,
    "purchased_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "token_addons_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'depleted'::"text"])))
);


ALTER TABLE "public"."token_addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "granted_by" "uuid",
    "amount" integer NOT NULL,
    "reason" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."token_grants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_rollover" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rollover_tokens" integer DEFAULT 0 NOT NULL,
    "source_period_start" timestamp with time zone NOT NULL,
    "source_period_end" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "token_rollover_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'consumed'::"text"])))
);


ALTER TABLE "public"."token_rollover" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "edge_function" "text",
    "project_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'platform'::"text" NOT NULL
);


ALTER TABLE "public"."token_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "api_key_encrypted" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_api_keys_provider_check" CHECK (("provider" = ANY (ARRAY['openai'::"text", 'anthropic'::"text", 'google'::"text"])))
);


ALTER TABLE "public"."user_api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" "text" DEFAULT 'general'::"text" NOT NULL,
    "rating" integer,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_feedback" OWNER TO "postgres";


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
    "ai_provider" "text",
    "ai_model" "text",
    "use_global_ai" boolean DEFAULT true NOT NULL,
    "use_v4_orchestrator" boolean DEFAULT false NOT NULL,
    "has_seen_onboarding" boolean DEFAULT false NOT NULL,
    CONSTRAINT "user_settings_ai_provider_check" CHECK ((("ai_provider" IS NULL) OR ("ai_provider" = ANY (ARRAY['openai'::"text", 'anthropic'::"text", 'google'::"text"]))))
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."cloud_provider_patterns" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cloud_provider_patterns_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_run_checkpoints"
    ADD CONSTRAINT "agent_run_checkpoints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_proposal_artifacts"
    ADD CONSTRAINT "ai_proposal_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_proposal_artifacts"
    ADD CONSTRAINT "ai_proposal_artifacts_proposal_id_artifact_id_key" UNIQUE ("proposal_id", "artifact_id");



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_runs"
    ADD CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."code_structures"
    ADD CONSTRAINT "code_structures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_history"
    ADD CONSTRAINT "conversation_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deployment_targets"
    ADD CONSTRAINT "deployment_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enterprise_contact_requests"
    ADD CONSTRAINT "enterprise_contact_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generation_events"
    ADD CONSTRAINT "generation_events_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."import_job_files"
    ADD CONSTRAINT "import_job_files_pkey" PRIMARY KEY ("job_id", "path");



ALTER TABLE ONLY "public"."import_job_groups"
    ADD CONSTRAINT "import_job_groups_pkey" PRIMARY KEY ("job_id", "group_idx");



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



ALTER TABLE ONLY "public"."node_roles"
    ADD CONSTRAINT "node_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provisioning_alerts"
    ADD CONSTRAINT "provisioning_alerts_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."token_addons"
    ADD CONSTRAINT "token_addons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_addons"
    ADD CONSTRAINT "token_addons_stripe_payment_intent_id_key" UNIQUE ("stripe_payment_intent_id");



ALTER TABLE ONLY "public"."token_grants"
    ADD CONSTRAINT "token_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_rollover"
    ADD CONSTRAINT "token_rollover_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_usage"
    ADD CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."code_structures"
    ADD CONSTRAINT "unique_node_filename" UNIQUE ("node_id", "filename");



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_user_id_provider_key" UNIQUE ("user_id", "provider");



ALTER TABLE ONLY "public"."user_feedback"
    ADD CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "idx_agent_run_checkpoints_project" ON "public"."agent_run_checkpoints" USING "btree" ("project_id");



CREATE INDEX "idx_agent_run_checkpoints_session" ON "public"."agent_run_checkpoints" USING "btree" ("session_id");



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



CREATE INDEX "idx_code_structures_artifact" ON "public"."code_structures" USING "btree" ("artifact_id");



CREATE INDEX "idx_code_structures_filename" ON "public"."code_structures" USING "btree" ("filename");



CREATE INDEX "idx_code_structures_hash" ON "public"."code_structures" USING "btree" ("content_hash");



CREATE INDEX "idx_code_structures_node" ON "public"."code_structures" USING "btree" ("node_id");



CREATE INDEX "idx_code_structures_project" ON "public"."code_structures" USING "btree" ("project_id");



CREATE INDEX "idx_conversation_history_project_time" ON "public"."conversation_history" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "idx_conversation_history_session" ON "public"."conversation_history" USING "btree" ("session_id", "created_at");



CREATE INDEX "idx_conversation_history_user_id" ON "public"."conversation_history" USING "btree" ("user_id");



CREATE INDEX "idx_enterprise_contact_requests_created" ON "public"."enterprise_contact_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_enterprise_contact_requests_status" ON "public"."enterprise_contact_requests" USING "btree" ("status");



CREATE INDEX "idx_generation_events_project_created" ON "public"."generation_events" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "idx_generation_events_run_id" ON "public"."generation_events" USING "btree" ("run_id");



CREATE INDEX "idx_generation_events_run_seq" ON "public"."generation_events" USING "btree" ("run_id", "sequence");



CREATE INDEX "idx_generation_events_user_id" ON "public"."generation_events" USING "btree" ("user_id");



CREATE INDEX "idx_git_change_events_created" ON "public"."git_change_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_git_change_events_integration_status" ON "public"."git_change_events" USING "btree" ("integration_id", "status");



CREATE INDEX "idx_git_change_events_project_status" ON "public"."git_change_events" USING "btree" ("project_id", "status");



CREATE INDEX "idx_git_integrations_created_by" ON "public"."git_integrations" USING "btree" ("created_by");



CREATE INDEX "idx_git_integrations_project" ON "public"."git_integrations" USING "btree" ("project_id");



CREATE INDEX "idx_git_sync_log_branch" ON "public"."git_sync_log" USING "btree" ("branch_id", "started_at" DESC);



CREATE INDEX "idx_git_sync_log_integration" ON "public"."git_sync_log" USING "btree" ("integration_id", "started_at" DESC);



CREATE INDEX "idx_git_sync_log_project_id" ON "public"."git_sync_log" USING "btree" ("project_id");



CREATE INDEX "idx_graph_snapshots_project_id" ON "public"."graph_snapshots" USING "btree" ("project_id");



CREATE INDEX "idx_import_job_files_group" ON "public"."import_job_files" USING "btree" ("job_id", "group_idx");



CREATE INDEX "idx_import_jobs_project_status" ON "public"."import_jobs" USING "btree" ("project_id", "status");



CREATE INDEX "idx_mappings_node_lookup" ON "public"."specification_mappings" USING "btree" ("node_id", "is_orphan");



CREATE INDEX "idx_mappings_orphan" ON "public"."specification_mappings" USING "btree" ("specification_id", "is_orphan") WHERE ("is_orphan" = true);



CREATE INDEX "idx_mcp_api_keys_key_hash" ON "public"."mcp_api_keys" USING "btree" ("key_hash");



CREATE INDEX "idx_mcp_api_keys_key_prefix" ON "public"."mcp_api_keys" USING "btree" ("key_prefix");



CREATE INDEX "idx_mcp_api_keys_user_id" ON "public"."mcp_api_keys" USING "btree" ("user_id");



CREATE INDEX "idx_mcp_oauth_codes_code" ON "public"."mcp_oauth_codes" USING "btree" ("code");



CREATE INDEX "idx_mcp_oauth_codes_expires" ON "public"."mcp_oauth_codes" USING "btree" ("expires_at");



CREATE INDEX "idx_mcp_oauth_tokens_expires" ON "public"."mcp_oauth_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_mcp_oauth_tokens_hash" ON "public"."mcp_oauth_tokens" USING "btree" ("access_token_hash");



CREATE INDEX "idx_mcp_oauth_tokens_user" ON "public"."mcp_oauth_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_node_roles_palette_category" ON "public"."node_roles" USING "btree" ("palette_category", "sort_order");



CREATE INDEX "idx_node_roles_rf_visual_type" ON "public"."node_roles" USING "btree" ("rf_visual_type");



CREATE INDEX "idx_patches_branch_sequence" ON "public"."graph_patches" USING "btree" ("branch_id", "sequence");



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



CREATE INDEX "idx_proposals_source_branch" ON "public"."ai_proposals" USING "btree" ("source_branch_id", "created_at" DESC);



CREATE INDEX "idx_proposals_status" ON "public"."ai_proposals" USING "btree" ("status");



CREATE INDEX "idx_provisioning_alerts_created_at" ON "public"."provisioning_alerts" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_provisioning_alerts_resolved" ON "public"."provisioning_alerts" USING "btree" ("resolved") WHERE (NOT "resolved");



CREATE INDEX "idx_provisioning_alerts_user_id" ON "public"."provisioning_alerts" USING "btree" ("user_id");



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



CREATE INDEX "idx_spec_requirements_locked" ON "public"."specification_requirements" USING "btree" ("specification_id") WHERE ("locked" = true);



CREATE INDEX "idx_spec_requirements_spec_id" ON "public"."specification_requirements" USING "btree" ("specification_id");



CREATE INDEX "idx_spec_requirements_status" ON "public"."specification_requirements" USING "btree" ("status");



CREATE INDEX "idx_specification_mappings_created_by" ON "public"."specification_mappings" USING "btree" ("created_by");



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



CREATE INDEX "idx_token_addons_user_status" ON "public"."token_addons" USING "btree" ("user_id", "status");



CREATE INDEX "idx_token_grants_granted_by" ON "public"."token_grants" USING "btree" ("granted_by");



CREATE INDEX "idx_token_grants_user_id" ON "public"."token_grants" USING "btree" ("user_id");



CREATE INDEX "idx_token_rollover_user_status" ON "public"."token_rollover" USING "btree" ("user_id", "status");



CREATE INDEX "idx_token_usage_created_at" ON "public"."token_usage" USING "btree" ("created_at");



CREATE INDEX "idx_token_usage_model" ON "public"."token_usage" USING "btree" ("model");



CREATE INDEX "idx_token_usage_source" ON "public"."token_usage" USING "btree" ("source");



CREATE INDEX "idx_token_usage_user_id" ON "public"."token_usage" USING "btree" ("user_id");



CREATE INDEX "idx_token_usage_user_model_date" ON "public"."token_usage" USING "btree" ("user_id", "model", "created_at");



CREATE INDEX "idx_user_api_keys_user_id" ON "public"."user_api_keys" USING "btree" ("user_id");



CREATE INDEX "idx_user_api_keys_user_provider" ON "public"."user_api_keys" USING "btree" ("user_id", "provider");



CREATE INDEX "idx_user_feedback_created_at" ON "public"."user_feedback" USING "btree" ("created_at");



CREATE INDEX "idx_user_feedback_user_id" ON "public"."user_feedback" USING "btree" ("user_id");



CREATE UNIQUE INDEX "stripe_subscriptions_stripe_customer_id_unique" ON "public"."stripe_subscriptions" USING "btree" ("stripe_customer_id") WHERE (("stripe_customer_id" IS NOT NULL) AND ("stripe_customer_id" <> ''::"text"));



CREATE UNIQUE INDEX "stripe_subscriptions_stripe_subscription_id_unique" ON "public"."stripe_subscriptions" USING "btree" ("stripe_subscription_id") WHERE (("stripe_subscription_id" IS NOT NULL) AND ("stripe_subscription_id" <> ''::"text"));



CREATE OR REPLACE TRIGGER "on_test_case_status_change" AFTER UPDATE OF "status" ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."on_test_case_status_change_fn"();



CREATE OR REPLACE TRIGGER "task_items_updated_at" BEFORE UPDATE ON "public"."task_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "template_comments_updated_at" BEFORE UPDATE ON "public"."template_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_ai_context_provenance_ins" BEFORE INSERT ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_ai_context_provenance"();



CREATE OR REPLACE TRIGGER "trg_ai_context_provenance_upd" BEFORE UPDATE OF "ai_context" ON "public"."technology_catalog" FOR EACH ROW WHEN (("old"."ai_context" IS DISTINCT FROM "new"."ai_context")) EXECUTE FUNCTION "public"."enforce_ai_context_provenance"();



CREATE OR REPLACE TRIGGER "trg_can_contain_resolves" BEFORE INSERT OR UPDATE OF "can_contain" ON "public"."node_roles" FOR EACH ROW EXECUTE FUNCTION "public"."assert_can_contain_resolves"();



CREATE OR REPLACE TRIGGER "trg_cleanup_test_case_artifacts" BEFORE DELETE ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_test_case_artifacts"();



CREATE OR REPLACE TRIGGER "trg_clear_testid_on_delete" BEFORE DELETE ON "public"."test_cases" FOR EACH ROW EXECUTE FUNCTION "public"."clear_testid_from_acceptance_criteria"();



CREATE OR REPLACE TRIGGER "trg_graph_patches_hash_chain" BEFORE INSERT ON "public"."graph_patches" FOR EACH ROW EXECUTE FUNCTION "public"."graph_patches_set_hash_chain"();



CREATE OR REPLACE TRIGGER "trg_mark_tests_stale_on_artifact_change" AFTER UPDATE ON "public"."artifacts" FOR EACH ROW EXECUTE FUNCTION "public"."mark_tests_stale_on_artifact_change"();



CREATE OR REPLACE TRIGGER "trg_mark_tests_stale_on_mapping_change" AFTER INSERT OR DELETE ON "public"."specification_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."mark_tests_stale_on_mapping_change"();



CREATE OR REPLACE TRIGGER "trg_mark_tests_stale_on_req_change" AFTER UPDATE ON "public"."specification_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."mark_tests_stale_on_requirement_change"();



CREATE OR REPLACE TRIGGER "trg_node_roles_updated_at" BEFORE UPDATE ON "public"."node_roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_catalog_updated_at"();



CREATE OR REPLACE TRIGGER "trg_technology_affinities_resolve" BEFORE INSERT OR UPDATE OF "role_affinities" ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."assert_role_affinities_resolve"();



CREATE OR REPLACE TRIGGER "trg_technology_catalog_search_vector" BEFORE INSERT OR UPDATE ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."technology_catalog_search_vector_update"();



CREATE OR REPLACE TRIGGER "trg_technology_catalog_updated_at" BEFORE UPDATE ON "public"."technology_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."update_catalog_updated_at"();



CREATE OR REPLACE TRIGGER "trg_update_requirements_updated_at" BEFORE UPDATE ON "public"."specification_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_update_sections_updated_at" BEFORE UPDATE ON "public"."specification_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_update_project_timestamp" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_project_timestamp"();



CREATE OR REPLACE TRIGGER "update_blog_post_updated_at_trigger" BEFORE UPDATE ON "public"."blog_posts" FOR EACH ROW EXECUTE FUNCTION "public"."update_blog_post_updated_at"();



CREATE OR REPLACE TRIGGER "user_api_keys_updated_at" BEFORE UPDATE ON "public"."user_api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_api_keys_updated_at"();



CREATE OR REPLACE TRIGGER "user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."agent_run_checkpoints"
    ADD CONSTRAINT "agent_run_checkpoints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



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
    ADD CONSTRAINT "branches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bug_reports"
    ADD CONSTRAINT "bug_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."code_structures"
    ADD CONSTRAINT "code_structures_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_history"
    ADD CONSTRAINT "conversation_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_history"
    ADD CONSTRAINT "conversation_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enterprise_contact_requests"
    ADD CONSTRAINT "enterprise_contact_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "fk_base_snapshot" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."graph_snapshots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."generation_events"
    ADD CONSTRAINT "generation_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generation_events"
    ADD CONSTRAINT "generation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."git_change_events"
    ADD CONSTRAINT "git_change_events_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."git_integrations"
    ADD CONSTRAINT "git_integrations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."import_job_files"
    ADD CONSTRAINT "import_job_files_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_job_groups"
    ADD CONSTRAINT "import_job_groups_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



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
    ADD CONSTRAINT "mcp_oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_specifications"
    ADD CONSTRAINT "project_specifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provisioning_alerts"
    ADD CONSTRAINT "provisioning_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."provisioning_alerts"
    ADD CONSTRAINT "provisioning_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."token_addons"
    ADD CONSTRAINT "token_addons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_grants"
    ADD CONSTRAINT "token_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."token_grants"
    ADD CONSTRAINT "token_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_rollover"
    ADD CONSTRAINT "token_rollover_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_usage"
    ADD CONSTRAINT "token_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_feedback"
    ADD CONSTRAINT "user_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "AI run access follows project ownership" ON "public"."ai_runs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "ai_runs"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "ai_runs"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Admins can create categories" ON "public"."blog_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can delete categories" ON "public"."blog_categories" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete post categories" ON "public"."blog_post_categories" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete system technologies" ON "public"."technology_catalog" FOR DELETE TO "authenticated" USING (("public"."is_admin"() AND ("is_user_contributed" = false)));



CREATE POLICY "Admins can insert post categories" ON "public"."blog_post_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert provisioning alerts" ON "public"."provisioning_alerts" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_settings"
  WHERE (("user_settings"."user_id" = "auth"."uid"()) AND ("user_settings"."is_admin" = true)))));



CREATE POLICY "Admins can insert subscriptions" ON "public"."stripe_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert system technologies" ON "public"."technology_catalog" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("is_user_contributed" = false)));



CREATE POLICY "Admins can insert token grants" ON "public"."token_grants" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND (( SELECT "auth"."uid"() AS "uid") = "granted_by")));



CREATE POLICY "Admins can read all audit log entries" ON "public"."subscription_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all bug reports" ON "public"."bug_reports" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all feedback" ON "public"."user_feedback" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all subscriptions" ON "public"."stripe_subscriptions" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all technologies" ON "public"."technology_catalog" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all token grants" ON "public"."token_grants" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read all token usage" ON "public"."token_usage" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can update all bug reports" ON "public"."bug_reports" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update categories" ON "public"."blog_categories" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update post categories" ON "public"."blog_post_categories" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update provisioning alerts" ON "public"."provisioning_alerts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_settings"
  WHERE (("user_settings"."user_id" = "auth"."uid"()) AND ("user_settings"."is_admin" = true)))));



CREATE POLICY "Admins can update subscriptions" ON "public"."stripe_subscriptions" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update system technologies" ON "public"."technology_catalog" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() AND ("is_user_contributed" = false))) WITH CHECK (("public"."is_admin"() AND ("is_user_contributed" = false)));



CREATE POLICY "Admins can view all provisioning alerts" ON "public"."provisioning_alerts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_settings"
  WHERE (("user_settings"."user_id" = "auth"."uid"()) AND ("user_settings"."is_admin" = true)))));



CREATE POLICY "Anon can read deployment targets" ON "public"."deployment_targets" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anon can read node roles" ON "public"."node_roles" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anon can read system technologies" ON "public"."technology_catalog" FOR SELECT TO "anon" USING (("is_user_contributed" = false));



CREATE POLICY "Anon users can read upvote counts" ON "public"."template_upvotes" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anonymous users can submit enterprise requests" ON "public"."enterprise_contact_requests" FOR INSERT TO "anon" WITH CHECK (("user_id" IS NULL));



CREATE POLICY "Anonymous users can view public templates" ON "public"."project_templates" FOR SELECT TO "anon" USING (("is_public" = true));



CREATE POLICY "Anyone can view categories" ON "public"."blog_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view post categories" ON "public"."blog_post_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view published posts" ON "public"."blog_posts" FOR SELECT USING (("status" = 'published'::"text"));



CREATE POLICY "Anyone can view template comments" ON "public"."template_comments" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Artifact access follows project ownership" ON "public"."artifacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "artifacts"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "artifacts"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Artifact access follows proposal ownership" ON "public"."ai_proposal_artifacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."ai_proposals"
     JOIN "public"."branches" ON (("branches"."id" = "ai_proposals"."source_branch_id")))
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("ai_proposals"."id" = "ai_proposal_artifacts"."proposal_id") AND ("projects"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."ai_proposals"
     JOIN "public"."branches" ON (("branches"."id" = "ai_proposals"."source_branch_id")))
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("ai_proposals"."id" = "ai_proposal_artifacts"."proposal_id") AND ("projects"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Authenticated users can create posts" ON "public"."blog_posts" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "Authenticated users can insert own enterprise requests" ON "public"."enterprise_contact_requests" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can read all deployment targets" ON "public"."deployment_targets" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read all roles" ON "public"."node_roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read cloud provider patterns" ON "public"."cloud_provider_patterns" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can read scope archetypes" ON "public"."scope_archetypes" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can read system technologies" ON "public"."technology_catalog" FOR SELECT TO "authenticated" USING (("is_user_contributed" = false));



CREATE POLICY "Authenticated users can read upvotes" ON "public"."template_upvotes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view public templates" ON "public"."project_templates" FOR SELECT TO "authenticated" USING (("is_public" = true));



CREATE POLICY "Authenticated users can view their own drafts" ON "public"."blog_posts" FOR SELECT TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR ("status" = 'published'::"text")));



CREATE POLICY "Authors and admins can delete posts" ON "public"."blog_posts" FOR DELETE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'is_admin'::"text") = 'true'::"text")));



CREATE POLICY "Authors and admins can update posts" ON "public"."blog_posts" FOR UPDATE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'is_admin'::"text") = 'true'::"text"))) WITH CHECK ((("author_id" = "auth"."uid"()) OR ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'is_admin'::"text") = 'true'::"text")));



CREATE POLICY "Authors can delete own templates" ON "public"."project_templates" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "Authors can update own templates" ON "public"."project_templates" FOR UPDATE TO "authenticated" USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "Authors can view own templates" ON "public"."project_templates" FOR SELECT TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "Community authors can create templates" ON "public"."project_templates" FOR INSERT TO "authenticated" WITH CHECK ((("author_type" = 'community'::"text") AND ("author_id" = "auth"."uid"())));



CREATE POLICY "Patch access follows branch ownership" ON "public"."graph_patches" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "graph_patches"."branch_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "graph_patches"."branch_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project members can view sync log" ON "public"."git_sync_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_sync_log"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project owners can create requirement relations" ON "public"."specification_requirement_relations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirement_relations"."specification_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Project owners can delete requirement relations" ON "public"."specification_requirement_relations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirement_relations"."specification_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Project owners can insert change events" ON "public"."git_change_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project owners can insert sync logs" ON "public"."git_sync_log" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_sync_log"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project owners can manage git integrations" ON "public"."git_integrations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_integrations"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_integrations"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project owners can manage their projects" ON "public"."projects" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Project owners can resolve change events" ON "public"."git_change_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project owners can view change events" ON "public"."git_change_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "git_change_events"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Project owners can view requirement relations" ON "public"."specification_requirement_relations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirement_relations"."specification_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Project owners can view their import jobs" ON "public"."import_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "import_jobs"."project_id") AND ("projects"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Proposal access follows project ownership" ON "public"."ai_proposals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "ai_proposals"."source_branch_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."branches"
     JOIN "public"."projects" ON (("projects"."id" = "branches"."project_id")))
  WHERE (("branches"."id" = "ai_proposals"."source_branch_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Public profiles are viewable, own profile always" ON "public"."user_profiles" FOR SELECT TO "authenticated", "anon" USING (("is_public" OR ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Service can insert customer data" ON "public"."stripe_customers" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Service role can insert change events" ON "public"."git_change_events" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert sync logs" ON "public"."git_sync_log" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role full access to agent_run_checkpoints" ON "public"."agent_run_checkpoints" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to ai_proposal_artifacts" ON "public"."ai_proposal_artifacts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to ai_proposals" ON "public"."ai_proposals" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to ai_runs" ON "public"."ai_runs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to artifacts" ON "public"."artifacts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to branches" ON "public"."branches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to code_structures" ON "public"."code_structures" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to conversation_history" ON "public"."conversation_history" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access to generation_events" ON "public"."generation_events" TO "service_role" USING (true) WITH CHECK (true);



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



CREATE POLICY "Service role full access to token_usage" ON "public"."token_usage" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role inserts token usage" ON "public"."token_usage" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Snapshot access follows project ownership" ON "public"."graph_snapshots" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "graph_snapshots"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "graph_snapshots"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users and admins can delete comments" ON "public"."template_comments" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Users can create branches in their projects" ON "public"."branches" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can create own comments" ON "public"."template_comments" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create own profile" ON "public"."user_profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can create task items for their projects" ON "public"."task_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can create test cases for their requirements" ON "public"."test_cases" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can create their own API keys" ON "public"."mcp_api_keys" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete branches in their projects" ON "public"."branches" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete code structures for their projects" ON "public"."code_structures" FOR DELETE TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can delete mappings in their projects" ON "public"."specification_mappings" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete own agent checkpoints" ON "public"."agent_run_checkpoints" FOR DELETE TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can delete own api keys" ON "public"."user_api_keys" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own conversation history" ON "public"."conversation_history" FOR DELETE TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can delete own profile" ON "public"."user_profiles" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete own project technologies" ON "public"."technology_catalog" FOR DELETE TO "authenticated" USING ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can delete own template usage" ON "public"."template_usage" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete requirements in their projects" ON "public"."specification_requirements" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete sections in their projects" ON "public"."specification_sections" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete specifications for their projects" ON "public"."project_specifications" FOR DELETE TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can delete task items for their projects" ON "public"."task_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete test cases for their requirements" ON "public"."test_cases" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert code structures for their projects" ON "public"."code_structures" FOR INSERT TO "authenticated" WITH CHECK (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can insert mappings in their projects" ON "public"."specification_mappings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert own agent checkpoints" ON "public"."agent_run_checkpoints" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert own api keys" ON "public"."user_api_keys" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own audit log entries" ON "public"."subscription_audit_log" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own bug reports" ON "public"."bug_reports" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own conversation history" ON "public"."conversation_history" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert own feedback" ON "public"."user_feedback" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own generation events" ON "public"."generation_events" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "generation_events"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can insert own settings" ON "public"."user_settings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert project technologies" ON "public"."technology_catalog" FOR INSERT TO "authenticated" WITH CHECK ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert requirements in their projects" ON "public"."specification_requirements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert sections in their projects" ON "public"."specification_sections" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert specifications for their projects" ON "public"."project_specifications" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can read change events for their projects" ON "public"."git_change_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."git_integrations" "gi"
     JOIN "public"."projects" "p" ON (("p"."id" = "gi"."project_id")))
  WHERE (("gi"."id" = "git_change_events"."integration_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Users can read generation events for their projects" ON "public"."generation_events" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM ("public"."ai_runs"
     JOIN "public"."projects" ON (("projects"."id" = "ai_runs"."project_id")))
  WHERE (("ai_runs"."id" = "generation_events"."run_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can read own api keys" ON "public"."user_api_keys" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own bug reports" ON "public"."bug_reports" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read own customer data" ON "public"."stripe_customers" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read own orders" ON "public"."stripe_orders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."stripe_customers"
  WHERE (("stripe_customers"."customer_id" = "stripe_orders"."customer_id") AND ("stripe_customers"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can read own project technologies" ON "public"."technology_catalog" FOR SELECT TO "authenticated" USING ((("is_user_contributed" = true) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can read own subscription" ON "public"."stripe_subscriptions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read own token usage" ON "public"."token_usage" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can record own template usage" ON "public"."template_usage" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can remove their own upvotes" ON "public"."template_upvotes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update branches in their projects" ON "public"."branches" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update change events for their projects" ON "public"."git_change_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."git_integrations" "gi"
     JOIN "public"."projects" "p" ON (("p"."id" = "gi"."project_id")))
  WHERE (("gi"."id" = "git_change_events"."integration_id") AND ("p"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."git_integrations" "gi"
     JOIN "public"."projects" "p" ON (("p"."id" = "gi"."project_id")))
  WHERE (("gi"."id" = "git_change_events"."integration_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Users can update code structures for their projects" ON "public"."code_structures" FOR UPDATE TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can update mappings in their projects" ON "public"."specification_mappings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update own agent checkpoints" ON "public"."agent_run_checkpoints" FOR UPDATE TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can update own api keys" ON "public"."user_api_keys" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own comments" ON "public"."template_comments" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own profile" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own project technologies" ON "public"."technology_catalog" FOR UPDATE TO "authenticated" USING ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("is_user_contributed" = true) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can update own settings" ON "public"."user_settings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("is_admin" = ( SELECT "user_settings_1"."is_admin"
   FROM "public"."user_settings" "user_settings_1"
  WHERE ("user_settings_1"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update requirements in their projects" ON "public"."specification_requirements" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update sections in their projects" ON "public"."specification_sections" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update specifications for their projects" ON "public"."project_specifications" FOR UPDATE TO "authenticated" USING (((("project_id" IS NOT NULL) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (("project_id" IS NULL) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (((("project_id" IS NOT NULL) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (("project_id" IS NULL) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can update task items for their projects" ON "public"."task_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update test cases for their requirements" ON "public"."test_cases" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update their own API keys" ON "public"."mcp_api_keys" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can upvote templates" ON "public"."template_upvotes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view branches in their projects" ON "public"."branches" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "branches"."project_id") AND ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view code structures for their projects" ON "public"."code_structures" FOR SELECT TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can view mappings in their projects" ON "public"."specification_mappings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_mappings"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view own agent checkpoints" ON "public"."agent_run_checkpoints" FOR SELECT TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can view own conversation history" ON "public"."conversation_history" FOR SELECT TO "authenticated" USING (("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can view own enterprise requests" ON "public"."enterprise_contact_requests" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own settings" ON "public"."user_settings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own template usage" ON "public"."template_usage" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own token addons" ON "public"."token_addons" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own token rollover" ON "public"."token_rollover" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view requirements in their projects" ON "public"."specification_requirements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_requirements"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view sections in their projects" ON "public"."specification_sections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_specifications" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "specification_sections"."specification_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view specifications for their projects" ON "public"."project_specifications" FOR SELECT TO "authenticated" USING (((("project_id" IS NOT NULL) AND ("project_id" IN ( SELECT "projects"."id"
   FROM "public"."projects"
  WHERE ("projects"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (("project_id" IS NULL) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can view task items for their projects" ON "public"."task_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_items"."project_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view test cases for their requirements" ON "public"."test_cases" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."specification_requirements" "sr"
     JOIN "public"."project_specifications" "ps" ON (("ps"."id" = "sr"."specification_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("sr"."id" = "test_cases"."requirement_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view their own API keys" ON "public"."mcp_api_keys" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "admin_delete_templates" ON "public"."project_templates" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_insert_official_templates" ON "public"."project_templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("author_type" = 'official'::"text")));



CREATE POLICY "admin_select_all_templates" ON "public"."project_templates" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_update_templates" ON "public"."project_templates" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."agent_run_checkpoints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_proposal_artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_post_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bug_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cloud_provider_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."code_structures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deployment_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enterprise_contact_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generation_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."git_change_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."git_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."git_sync_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_patches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_job_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_oauth_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_oauth_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_specifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provisioning_alerts" ENABLE ROW LEVEL SECURITY;


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


ALTER TABLE "public"."token_addons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_rollover" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."git_change_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."graph_patches";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."import_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_mappings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_requirement_relations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_requirements";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."specification_sections";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."stripe_subscriptions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."task_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."test_cases";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."assert_can_contain_resolves"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_can_contain_resolves"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_can_contain_resolves"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_role_affinities_resolve"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_role_affinities_resolve"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_role_affinities_resolve"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_requirement_coverage"("p_specification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_orphaned_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_orphaned_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_orphaned_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_conversation_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_conversation_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_conversation_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_test_case_artifacts"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_test_case_artifacts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_test_case_artifacts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_testid_from_acceptance_criteria"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_testid_from_acceptance_criteria"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_testid_from_acceptance_criteria"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_patch_entry_hash"("p_id" "uuid", "p_branch_id" "uuid", "p_sequence" bigint, "p_patch_type" "text", "p_actor_type" "text", "p_actor_id" "uuid", "p_summary" "text", "p_payload" "jsonb", "p_preconditions" "jsonb", "p_created_at" timestamp with time zone, "p_prev_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."convert_graph_nodes_to_v3"("graph" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."convert_graph_nodes_to_v3"("graph" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_graph_nodes_to_v3"("graph" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."convert_patch_payload_to_v3"("payload" "jsonb", "patch_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."convert_patch_payload_to_v3"("payload" "jsonb", "patch_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_patch_payload_to_v3"("payload" "jsonb", "patch_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_template_upvote_count"("tid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_template_upvote_count"("tid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_template_upvote_count"("tid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_ai_context_provenance"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_ai_context_provenance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_ai_context_provenance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."evaluate_acceptance_criteria"("p_requirement_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."evaluate_acceptance_criteria"("p_requirement_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."evaluate_acceptance_criteria"("p_requirement_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."force_provision_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_provision_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."force_provision_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_patch_sequence"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_orphan_nodes"("p_specification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_provisioning_health"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_provisioning_health"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_provisioning_health"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unmapped_requirements"("p_specification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_users_pending_provisioning"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_users_pending_provisioning"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_users_pending_provisioning"() TO "service_role";



GRANT ALL ON FUNCTION "public"."graph_patches_set_hash_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."graph_patches_set_hash_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."graph_patches_set_hash_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_mcp_connection"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_mcp_connection"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_mcp_connection"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_mcp_connection"() TO "service_role";



GRANT ALL ON FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."idempotent_customer_insert"("p_user_id" "uuid", "p_customer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."idempotent_free_subscription"("p_user_id" "uuid", "p_customer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_blog_post_views"("post_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_blog_post_views"("post_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_blog_post_views"("post_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_template_upvote_count"("tid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_template_upvote_count"("tid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_template_upvote_count"("tid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_template_use_count"("tid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_template_use_count"("tid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_template_use_count"("tid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_artifact_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_artifact_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_artifact_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_mapping_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_mapping_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_mapping_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_requirement_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_requirement_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_tests_stale_on_requirement_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."n9b_convert_nodes"("graph" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."n9b_convert_nodes"("graph" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."n9b_convert_nodes"("graph" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."node_roles_suggested_contracts_valid"("sc" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."on_test_case_status_change_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_test_case_status_change_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_test_case_status_change_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_orphaned_user_alerts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_orphaned_user_alerts"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_orphaned_user_alerts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."provision_stripe_customer_on_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."provision_stripe_customer_on_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."provision_stripe_customer_on_signup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reconstruct_legacy_type"("p_role_id" "text", "p_technology_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reconstruct_legacy_type"("p_role_id" "text", "p_technology_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconstruct_legacy_type"("p_role_id" "text", "p_technology_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."repair_feature_requirement_consistency"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."repair_feature_requirement_consistency"("p_specification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_graph_nodes_to_legacy"("graph" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."revert_graph_nodes_to_legacy"("graph" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_graph_nodes_to_legacy"("graph" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_relevant_technologies"("query_text" "text", "max_results" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_admin_status"("target_user_id" "uuid", "admin_status" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_orphan_mappings"("p_specification_id" "uuid", "p_valid_node_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."technology_catalog_search_vector_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."technology_catalog_search_vector_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."technology_catalog_search_vector_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_blog_post_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_blog_post_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_blog_post_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_catalog_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_catalog_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_catalog_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_project_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_project_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_project_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_api_keys_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_api_keys_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_api_keys_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_settings_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_settings_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_settings_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_feature_requirement_consistency"("p_specification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_feature_requirement_consistency"("p_specification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_mcp_api_key"("p_key_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_patch_chain"("p_branch_id" "uuid") TO "service_role";
























GRANT ALL ON TABLE "public"."agent_run_checkpoints" TO "anon";
GRANT ALL ON TABLE "public"."agent_run_checkpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_run_checkpoints" TO "service_role";



GRANT ALL ON TABLE "public"."ai_proposal_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."ai_proposal_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_proposal_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."ai_proposals" TO "anon";
GRANT ALL ON TABLE "public"."ai_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."ai_runs" TO "anon";
GRANT ALL ON TABLE "public"."ai_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_runs" TO "service_role";



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



GRANT ALL ON TABLE "public"."code_structures" TO "anon";
GRANT ALL ON TABLE "public"."code_structures" TO "authenticated";
GRANT ALL ON TABLE "public"."code_structures" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_history" TO "anon";
GRANT ALL ON TABLE "public"."conversation_history" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_history" TO "service_role";



GRANT ALL ON TABLE "public"."deployment_targets" TO "anon";
GRANT ALL ON TABLE "public"."deployment_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."deployment_targets" TO "service_role";



GRANT ALL ON TABLE "public"."enterprise_contact_requests" TO "anon";
GRANT ALL ON TABLE "public"."enterprise_contact_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."enterprise_contact_requests" TO "service_role";



GRANT ALL ON TABLE "public"."generation_events" TO "anon";
GRANT ALL ON TABLE "public"."generation_events" TO "authenticated";
GRANT ALL ON TABLE "public"."generation_events" TO "service_role";



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



GRANT ALL ON TABLE "public"."import_job_files" TO "anon";
GRANT ALL ON TABLE "public"."import_job_files" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_files" TO "service_role";



GRANT ALL ON TABLE "public"."import_job_groups" TO "anon";
GRANT ALL ON TABLE "public"."import_job_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."import_job_groups" TO "service_role";



GRANT ALL ON TABLE "public"."import_jobs" TO "anon";
GRANT ALL ON TABLE "public"."import_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."mcp_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_oauth_codes" TO "anon";
GRANT ALL ON TABLE "public"."mcp_oauth_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_oauth_codes" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_oauth_tokens" TO "anon";
GRANT ALL ON TABLE "public"."mcp_oauth_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_oauth_tokens" TO "service_role";



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



GRANT ALL ON TABLE "public"."provisioning_alerts" TO "anon";
GRANT ALL ON TABLE "public"."provisioning_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."provisioning_alerts" TO "service_role";



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



GRANT ALL ON TABLE "public"."token_addons" TO "anon";
GRANT ALL ON TABLE "public"."token_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."token_addons" TO "service_role";



GRANT ALL ON TABLE "public"."token_grants" TO "anon";
GRANT ALL ON TABLE "public"."token_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."token_grants" TO "service_role";



GRANT ALL ON TABLE "public"."token_rollover" TO "anon";
GRANT ALL ON TABLE "public"."token_rollover" TO "authenticated";
GRANT ALL ON TABLE "public"."token_rollover" TO "service_role";



GRANT ALL ON TABLE "public"."token_usage" TO "anon";
GRANT ALL ON TABLE "public"."token_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."token_usage" TO "service_role";



GRANT ALL ON TABLE "public"."user_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."user_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."user_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."user_feedback" TO "anon";
GRANT ALL ON TABLE "public"."user_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."user_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";









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































