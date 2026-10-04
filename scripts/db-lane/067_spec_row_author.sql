-- db-lane 067: the first vision save is the author's to make (K.1, owner's
-- live report 2026-09-21).
--
--   The app's person-path inserts on project_specifications (the first
--   vision, the spec bootstrap) never send created_by, and the v3p INSERT
--   policy checks created_by = auth.uid(); before migration 20260921150000
--   the very first save on a fresh project was refused as an RLS
--   violation. The column now defaults to auth.uid(): the app's exact
--   insert lands stamped with its author, the author can then update the
--   vision, a stranger and an anonymous caller are still refused, a
--   second row for the same project is refused by UNIQUE (the app updates
--   instead), and a service-role insert that names the author keeps the
--   name it gave (an explicit value beats the default).
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_default text;
BEGIN
  IF to_regclass('public.project_specifications') IS NULL THEN
    RAISE EXCEPTION 'db-lane 067: public.project_specifications is missing. Run supabase db reset.';
  END IF;
  SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO v_default
    FROM pg_attrdef ad
    JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
   WHERE ad.adrelid = 'public.project_specifications'::regclass AND a.attname = 'created_by';
  IF v_default IS NULL OR v_default NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'db-lane 067: created_by does not default to auth.uid(). Apply migration 20260921150000.';
  END IF;
  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'db-lane 067: no auth.users row to own the fixture. Run supabase db reset.'; END IF;
  PERFORM set_config('lane.owner', v_owner::text, true);

  INSERT INTO auth.users (id, email) VALUES ('db670000-0000-4000-8000-000000000002', 'db-lane-067-stranger@nodespec.local');
  INSERT INTO public.projects (id, name, owner_id) VALUES
    ('db670000-0000-4000-8000-000000000010', 'db-lane 067 fresh', v_owner),
    ('db670000-0000-4000-8000-000000000020', 'db-lane 067 server', v_owner);
END $$;

-- ── 1. the owner, as the app: the exact insert useProjectVision.save sends ──
SELECT set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claim.sub', current_setting('lane.owner'), true),
       set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('lane.owner')), true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_author uuid;
BEGIN
  INSERT INTO public.project_specifications (project_id, vision, raw_input, phase_status)
    VALUES ('db670000-0000-4000-8000-000000000010', 'A shelf, not a wishlist.', '', 'drafting_requirements');
  SELECT created_by INTO v_author FROM public.project_specifications
   WHERE project_id = 'db670000-0000-4000-8000-000000000010';
  IF v_author IS DISTINCT FROM current_setting('lane.owner')::uuid THEN
    RAISE EXCEPTION 'db-lane 067: the first vision save should be stamped with its author, got %', v_author;
  END IF;

  -- the author edits the vision the way the app does when a row exists
  UPDATE public.project_specifications SET vision = 'A shelf.', updated_at = now()
   WHERE project_id = 'db670000-0000-4000-8000-000000000010';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'db-lane 067: the author should be able to update their own vision';
  END IF;

  -- one spec per project: a second insert is a unique violation, not a new row
  BEGIN
    INSERT INTO public.project_specifications (project_id, vision, raw_input, phase_status)
      VALUES ('db670000-0000-4000-8000-000000000010', 'Again.', '', 'drafting_requirements');
    RAISE EXCEPTION 'db-lane 067: a second spec row for the same project should be refused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- ── 2. a stranger is still refused ─────────────────────────────────────────
SET LOCAL request.jwt.claim.sub = 'db670000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"db670000-0000-4000-8000-000000000002"}';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.project_specifications (project_id, vision, raw_input, phase_status)
      VALUES ('db670000-0000-4000-8000-000000000020', 'Not mine.', '', 'drafting_requirements');
    RAISE EXCEPTION 'db-lane 067: a stranger wrote a spec on someone else''s project';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 3. an anonymous caller is still refused ────────────────────────────────
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'anon';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.project_specifications (project_id, vision, raw_input, phase_status)
      VALUES ('db670000-0000-4000-8000-000000000020', 'Nobody.', '', 'drafting_requirements');
    RAISE EXCEPTION 'db-lane 067: an anonymous caller wrote a spec';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- RLS refused it
    WHEN not_null_violation THEN NULL;      -- auth.uid() is NULL: no author, no row
  END;
END $$;

-- ── 4. the server names the author; an explicit value beats the default ────
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_author uuid;
BEGIN
  INSERT INTO public.project_specifications (project_id, vision, raw_input, phase_status, created_by)
    VALUES ('db670000-0000-4000-8000-000000000020', 'Server-written.', '', 'drafting_requirements',
            'db670000-0000-4000-8000-000000000002');
  SELECT created_by INTO v_author FROM public.project_specifications
   WHERE project_id = 'db670000-0000-4000-8000-000000000020';
  IF v_author <> 'db670000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'db-lane 067: the server''s explicit created_by should stand, got %', v_author;
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'db-lane 067: a spec row is born of its author: the app''s exact vision insert lands stamped by the created_by default, the author edits, a stranger and an anonymous caller stay refused, one row per project, and the server''s explicit author stands';
END $$;

ROLLBACK;
