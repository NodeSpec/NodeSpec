-- db-lane 104: the RLS and access audit (owner 2026-09-30: "Check and audit all of our RLS
-- settings to ensure we are not introducing a leakage or security risk").
--
--   The database is put back the way the audit found it (the insert policy that let a
--   person write is_admin, the four functions that trusted that column, the blog's author
--   policies, the open icon uploads, the three template counters, the open comment and
--   upvote reads, project_role and key validation for anyone, the customer insert), the
--   migration runs, and then, acting as the people involved:
--   - a person cannot give themselves is_admin; one whose row already says so is still
--     refused the pending list, the forced provisioning and the health read, and is held
--     to the Free cap; an admin by token reads the list and passes the cap;
--   - a person cannot publish, edit or delete a post, or read a draft; anon reads what is
--     published; an admin writes, edits and reads drafts;
--   - a person cannot upload or overwrite a logo in the icons bucket; an admin can;
--   - a template's counts move with upvote and usage rows, never below zero, and the
--     counter RPCs are gone;
--   - a comment on a private template is seen by its author and not by anon or another
--     person; a person sees their own upvotes and not another's;
--   - a person and anon cannot run project_role or validate_mcp_api_key, while membership
--     still works through is_project_member; a person cannot insert a Stripe customer;
--   - replaying the migration changes nothing.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE FUNCTION pg_temp.act_as(p_user text, p_admin boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims',
           format('{"role":"authenticated","sub":"%s","app_metadata":{"is_admin":%s}}', p_user,
                  CASE WHEN p_admin THEN 'true' ELSE 'false' END), true);
$$;
CREATE FUNCTION pg_temp.act_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'anon', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
-- A policy snapshot, to show a replay changes nothing.
CREATE FUNCTION pg_temp.shape() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'policies', (SELECT jsonb_agg(jsonb_build_array(schemaname, tablename, policyname, cmd, roles, qual, with_check) ORDER BY schemaname, tablename, policyname)
                 FROM pg_policies WHERE schemaname IN ('public', 'storage')),
    'grants', (SELECT jsonb_agg(jsonb_build_array(p.proname, has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')) ORDER BY p.proname)
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'functions', (SELECT jsonb_agg(md5(p.prosrc) ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace));
$$;

DO $$
BEGIN
  IF to_regclass('public.blog_posts') IS NULL OR to_regclass('public.template_upvotes') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'db-lane 104: the blog, template or storage tables are missing. Apply migration 20260314011331 and the chain after it.';
  END IF;
END $$;

-- ── the database as the audit found it ───────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_users_pending_provisioning()
RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone, minutes_waiting numeric, trigger_attempts bigint, last_error text, needs_manual_intervention boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT COALESCE((SELECT us.is_admin FROM public.user_settings us WHERE us.user_id = auth.uid()), false) THEN
    RAISE EXCEPTION 'unauthorized: only admins can view pending provisioning' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT u.id, u.email::text, now(), 0::numeric, 0::bigint, NULL::text, false FROM auth.users u;
END $$;
CREATE OR REPLACE FUNCTION public.force_provision_user(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM public.user_settings WHERE user_id = auth.uid()), false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  RETURN jsonb_build_object('success', true, 'email', (SELECT email FROM auth.users WHERE id = p_user_id));
END $$;
CREATE OR REPLACE FUNCTION public.get_provisioning_health() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE((SELECT us.is_admin FROM public.user_settings us WHERE us.user_id = auth.uid()), false) THEN
    RAISE EXCEPTION 'unauthorized: only admins can view provisioning health' USING ERRCODE = '42501';
  END IF;
  RETURN '{}'::jsonb;
END $$;
CREATE OR REPLACE FUNCTION public.projects_plan_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.plan_allows('unlimited_projects') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = auth.uid() AND is_admin IS TRUE) THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM public.projects WHERE owner_id = NEW.owner_id) >= 2 THEN
    RAISE EXCEPTION 'Free accounts include 2 projects' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP POLICY IF EXISTS "Admins create posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Admins update posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Admins delete posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Admins read every post" ON public.blog_posts;
CREATE POLICY "Authenticated users can create posts" ON public.blog_posts FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "Authors and admins can update posts" ON public.blog_posts FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "Authors and admins can delete posts" ON public.blog_posts FOR DELETE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "Authenticated users can view their own drafts" ON public.blog_posts FOR SELECT TO authenticated USING (author_id = auth.uid() OR status = 'published');

DROP POLICY IF EXISTS "Admins can upload icons" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update icons" ON storage.objects;
CREATE POLICY "Authenticated users can upload icons" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'icons');
CREATE POLICY "Authenticated users can update icons" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'icons') WITH CHECK (bucket_id = 'icons');
-- A Supabase stack grants these; the scratch stand-in for storage does not. The logos
-- are readable here so the update policy alone decides an overwrite.
GRANT SELECT, INSERT, UPDATE ON storage.objects TO authenticated;
CREATE POLICY "db104 icons readable" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'icons');
INSERT INTO storage.buckets (id, name, public) VALUES ('icons', 'icons', true) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_template_upvote_count ON public.template_upvotes;
DROP TRIGGER IF EXISTS trg_template_use_count ON public.template_usage;
CREATE FUNCTION public.increment_template_upvote_count(tid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.project_templates SET upvote_count = upvote_count + 1 WHERE id = tid; $$;
CREATE FUNCTION public.decrement_template_upvote_count(tid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.project_templates SET upvote_count = GREATEST(upvote_count - 1, 0) WHERE id = tid; $$;
CREATE FUNCTION public.increment_template_use_count(tid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.project_templates SET use_count = use_count + 1 WHERE id = tid; $$;
GRANT EXECUTE ON FUNCTION public.increment_template_upvote_count(uuid), public.decrement_template_upvote_count(uuid),
  public.increment_template_use_count(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Comments are seen where their template is" ON public.template_comments;
CREATE POLICY "Anyone can view template comments" ON public.template_comments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Users read their own upvotes" ON public.template_upvotes;
CREATE POLICY "Anon users can read upvote counts" ON public.template_upvotes FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated users can read upvotes" ON public.template_upvotes FOR SELECT TO authenticated USING (true);

GRANT EXECUTE ON FUNCTION public.project_role(uuid, uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mcp_api_key(text) TO PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Service can insert customer data" ON public.stripe_customers;
CREATE POLICY "Service can insert customer data" ON public.stripe_customers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- The people: Ada and Bo (Free), and an admin by token.
DO $$
BEGIN
  DELETE FROM public.deployment_settings;
  INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
    ('db104000-0000-4000-8000-000000000001', 'db-lane-104-ada@nodespec.local', '{}'),
    ('db104000-0000-4000-8000-000000000002', 'db-lane-104-bo@nodespec.local', '{}'),
    ('db104000-0000-4000-8000-000000000003', 'db-lane-104-admin@nodespec.local', '{"is_admin": true}');
  INSERT INTO public.project_templates (id, name, slug, graph_data, author_type, author_id, is_public, upvote_count, use_count) VALUES
    ('db104000-0000-4000-8000-0000000000f1', 'Public one', 'db104-public', '{"id": "g104", "schemaVersion": 8, "nodes": {}, "edges": {}, "contracts": {}, "artifacts": {}}', 'official', NULL, true, 5, 10),
    ('db104000-0000-4000-8000-0000000000f2', 'Bo private', 'db104-private', '{"id": "g104", "schemaVersion": 8, "nodes": {}, "edges": {}, "contracts": {}, "artifacts": {}}', 'community', 'db104000-0000-4000-8000-000000000002', false, 0, 0);
  INSERT INTO public.template_comments (template_id, user_id, body) VALUES
    ('db104000-0000-4000-8000-0000000000f1', 'db104000-0000-4000-8000-000000000002', 'db104 public comment'),
    ('db104000-0000-4000-8000-0000000000f2', 'db104000-0000-4000-8000-000000000002', 'db104 private comment');
  INSERT INTO public.blog_posts (slug, title, excerpt, content, author_id, status) VALUES
    ('db104-live', 'Live', 'x', 'x', 'db104000-0000-4000-8000-000000000003', 'published'),
    ('db104-draft', 'Draft', 'x', 'x', 'db104000-0000-4000-8000-000000000003', 'draft'),
    ('db104-ada-legacy', 'Ada legacy', 'x', 'x', 'db104000-0000-4000-8000-000000000001', 'published');
  INSERT INTO storage.objects (bucket_id, name) VALUES ('icons', 'db104/logo.png');
END $$;

\ir ../../supabase/migrations/20260930120000_v3_rls_audit.sql
CREATE TEMP TABLE lane_104_shape AS SELECT pg_temp.shape() AS s;
\ir ../../supabase/migrations/20260930120000_v3_rls_audit.sql

-- ── 0. replaying changes nothing ──────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT s FROM lane_104_shape) IS DISTINCT FROM pg_temp.shape() THEN
    RAISE EXCEPTION 'db-lane 104: replaying the migration changed a policy, a grant or a function';
  END IF;
END $$;

-- ── 1. admin is the token's ───────────────────────────────────────────────────────
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.user_settings (user_id, is_admin) VALUES ('db104000-0000-4000-8000-000000000001', true);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a person gave themselves is_admin'; END IF;
  INSERT INTO public.user_settings (user_id, has_seen_onboarding) VALUES ('db104000-0000-4000-8000-000000000001', true);
END $$;
RESET ROLE;
-- As if Ada had set the flag before this change.
UPDATE public.user_settings SET is_admin = true WHERE user_id = 'db104000-0000-4000-8000-000000000001';
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean; v jsonb; n int := 0;
BEGIN
  v_refused := false;
  BEGIN PERFORM 1 FROM public.get_users_pending_provisioning(); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a settings flag read the pending list, emails and all'; END IF;
  v := public.force_provision_user('db104000-0000-4000-8000-000000000002');
  IF v ->> 'error' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'db-lane 104: a settings flag passed the forced provisioning check: %', v; END IF;
  v_refused := false;
  BEGIN PERFORM public.get_provisioning_health(); EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a settings flag read the provisioning health'; END IF;
  -- the Free cap holds for her: two projects, not three
  FOR i IN 1..3 LOOP
    BEGIN
      INSERT INTO public.projects (name, owner_id) VALUES ('db104 ada ' || i, 'db104000-0000-4000-8000-000000000001');
      n := n + 1;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 104: a settings flag let a Free account make % projects', n; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM 1 FROM public.get_users_pending_provisioning();
  IF (public.force_provision_user('db104000-0000-4000-8000-00000000dead') ->> 'error') = 'unauthorized' THEN
    RAISE EXCEPTION 'db-lane 104: an admin by token was refused forced provisioning';
  END IF;
  PERFORM public.get_provisioning_health();
  FOR i IN 1..3 LOOP
    INSERT INTO public.projects (name, owner_id) VALUES ('db104 admin ' || i, 'db104000-0000-4000-8000-000000000003');
  END LOOP;
END $$;
RESET ROLE;

-- ── 2. the blog is the admin's ────────────────────────────────────────────────────
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false; n int;
BEGIN
  BEGIN
    INSERT INTO public.blog_posts (slug, title, excerpt, content, author_id, status)
    VALUES ('db104-spam', 'Spam', 'x', 'x', 'db104000-0000-4000-8000-000000000001', 'published');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a person published a blog post'; END IF;
  UPDATE public.blog_posts SET title = 'Defaced' WHERE slug IN ('db104-ada-legacy', 'db104-live');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 104: a person edited % post(s)', n; END IF;
  DELETE FROM public.blog_posts WHERE slug LIKE 'db104-%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 104: a person deleted % post(s)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE slug = 'db104-draft') THEN RAISE EXCEPTION 'db-lane 104: a person read a draft'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE slug = 'db104-live') THEN RAISE EXCEPTION 'db-lane 104: a person cannot read a published post'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_anon();
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE slug = 'db104-draft') OR NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE slug = 'db104-live') THEN
    RAISE EXCEPTION 'db-lane 104: anon should read what is published and nothing else';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  INSERT INTO public.blog_posts (slug, title, excerpt, content, author_id, status)
  VALUES ('db104-admin-new', 'New', 'x', 'x', 'db104000-0000-4000-8000-000000000003', 'published');
  UPDATE public.blog_posts SET title = 'Reviewed' WHERE slug IN ('db104-ada-legacy', 'db104-draft');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'db-lane 104: an admin edited % of 2 posts', n; END IF;
  DELETE FROM public.blog_posts WHERE slug = 'db104-ada-legacy';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'db-lane 104: an admin could not take a post down'; END IF;
END $$;
RESET ROLE;

-- ── 3. the logos are the admin's ──────────────────────────────────────────────────
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false; n int;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('icons', 'db104/spoof.png');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a person uploaded a logo'; END IF;
  BEGIN
    UPDATE storage.objects SET metadata = '{"spoofed": true}' WHERE bucket_id = 'icons' AND name = 'db104/logo.png';
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n := 0; END;
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 104: a person overwrote a logo'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES ('icons', 'db104/new.png');
RESET ROLE;

-- ── 4. counts follow rows; 5. comments and upvotes are seen by whom they concern ─────
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record;
BEGIN
  IF to_regprocedure('public.increment_template_upvote_count(uuid)') IS NOT NULL
     OR to_regprocedure('public.decrement_template_upvote_count(uuid)') IS NOT NULL
     OR to_regprocedure('public.increment_template_use_count(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 104: a template counter RPC is still there';
  END IF;
  INSERT INTO public.template_upvotes (template_id, user_id) VALUES ('db104000-0000-4000-8000-0000000000f1', 'db104000-0000-4000-8000-000000000001');
  INSERT INTO public.template_usage (template_id, user_id) VALUES ('db104000-0000-4000-8000-0000000000f1', 'db104000-0000-4000-8000-000000000001');
  SELECT upvote_count, use_count INTO c FROM public.project_templates WHERE id = 'db104000-0000-4000-8000-0000000000f1';
  IF c.upvote_count <> 6 OR c.use_count <> 11 THEN RAISE EXCEPTION 'db-lane 104: counts should be 6 and 11, are % and %', c.upvote_count, c.use_count; END IF;
  DELETE FROM public.template_upvotes WHERE template_id = 'db104000-0000-4000-8000-0000000000f1' AND user_id = 'db104000-0000-4000-8000-000000000001';
  IF (SELECT upvote_count FROM public.project_templates WHERE id = 'db104000-0000-4000-8000-0000000000f1') <> 5 THEN
    RAISE EXCEPTION 'db-lane 104: removing an upvote did not bring the count back';
  END IF;
  -- comments: the public template's, not the private one's
  IF NOT EXISTS (SELECT 1 FROM public.template_comments WHERE body = 'db104 public comment')
     OR EXISTS (SELECT 1 FROM public.template_comments WHERE body = 'db104 private comment') THEN
    RAISE EXCEPTION 'db-lane 104: a person should see the public template''s comment and not the private one''s';
  END IF;
END $$;
RESET ROLE;
-- Bo upvotes; the count on a private template never goes below zero.
UPDATE public.project_templates SET upvote_count = 0 WHERE id = 'db104000-0000-4000-8000-0000000000f2';
INSERT INTO public.template_upvotes (template_id, user_id) VALUES ('db104000-0000-4000-8000-0000000000f1', 'db104000-0000-4000-8000-000000000002');
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.template_upvotes WHERE user_id = 'db104000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'db-lane 104: a person read another person''s upvote';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.template_comments WHERE body LIKE 'db104 %') <> 2 THEN
    RAISE EXCEPTION 'db-lane 104: the private template''s author should read both comments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.template_upvotes WHERE user_id = 'db104000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'db-lane 104: a person cannot read their own upvote';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act_anon();
SET LOCAL ROLE anon;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.template_comments WHERE body = 'db104 private comment')
     OR NOT EXISTS (SELECT 1 FROM public.template_comments WHERE body = 'db104 public comment') THEN
    RAISE EXCEPTION 'db-lane 104: anon should read the public template''s comment only';
  END IF;
  IF EXISTS (SELECT 1 FROM public.template_upvotes) THEN RAISE EXCEPTION 'db-lane 104: anon read upvotes'; END IF;
  BEGIN
    PERFORM public.validate_mcp_api_key('db104-no-such-key');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: anon ran validate_mcp_api_key'; END IF;
  v_refused := false;
  BEGIN
    PERFORM public.project_role('db104000-0000-4000-8000-0000000000f1', 'db104000-0000-4000-8000-000000000002');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: anon ran project_role'; END IF;
END $$;
RESET ROLE;

-- ── 6. the service's answers stay the service's; membership still works ─────────────
SELECT pg_temp.act_as('db104000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_refused boolean := false; v_project uuid;
BEGIN
  BEGIN
    PERFORM public.project_role((SELECT id FROM public.projects WHERE name = 'db104 ada 1'), 'db104000-0000-4000-8000-000000000003');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a person asked another person''s role on a project'; END IF;
  SELECT id INTO v_project FROM public.projects WHERE name = 'db104 ada 1';
  IF v_project IS NULL OR NOT public.is_project_member(v_project, 'owner') THEN
    RAISE EXCEPTION 'db-lane 104: the owner no longer reads their own project';
  END IF;
  v_refused := false;
  BEGIN
    INSERT INTO public.stripe_customers (user_id, customer_id) VALUES ('db104000-0000-4000-8000-000000000001', 'cus_db104_spoof');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true; END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 104: a person wrote a Stripe customer mapping'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.validate_mcp_api_key(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.project_role(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db-lane 104: the service lost key validation or project_role';
  END IF;
  RAISE NOTICE 'db-lane 104: admin is the token''s (a settings flag reaches nothing, the Free cap holds), the blog and the logos are the admin''s, template counts follow rows, comments follow their template, upvotes are their person''s, project_role, key validation and the customer mapping are the service''s, replay changes nothing';
END $$;

ROLLBACK;
