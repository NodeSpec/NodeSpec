-- NodeSpec self-host: promote the first admin (SHIP-1(e)).
--
-- Usage (after the account has signed up through the app) — plain email,
-- NO quote gymnastics (live-caught 2026-08-24: the doubly-quoted form lost
-- its inner quotes in the shell and psql read the email as a table name):
--   docker exec -i "$(docker ps --format '{{.Names}}' | grep '^supabase_db_')" \
--     psql -U postgres -d postgres -v admin_email=you@company.com -f - \
--     < deploy/selfhost/sql/first-admin.sql
-- Or paste into Studio's SQL editor and replace :'admin_email' on the first
-- statement with the quoted literal 'you@company.com'.
--
-- Two psql mechanics at work: :'admin_email' is psql's SAFELY-QUOTED
-- interpolation (the caller never supplies quotes), and the set_config hop
-- exists because psql variables do not expand inside dollar-quoted blocks.
--
-- Admin is DUAL-SURFACE in NodeSpec and both halves are set here:
--   1. user_settings.is_admin  — read by server-side checks (e.g. the
--      community project-cap exemption in create_project).
--   2. auth.users app_metadata — read by the RLS is_admin() helper via the
--      JWT. The user must LOG OUT AND BACK IN afterwards so their fresh JWT
--      carries the claim.
-- Idempotent: safe to re-run; raises a clear error when the email is unknown.

SELECT set_config('nodespec.admin_email', :'admin_email', false);

DO $$
DECLARE
  v_email text := current_setting('nodespec.admin_email');
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user with email % — sign up through the app first.', v_email;
  END IF;

  INSERT INTO public.user_settings (user_id, is_admin)
  VALUES (v_user_id, true)
  ON CONFLICT (user_id) DO UPDATE SET is_admin = true;

  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
  WHERE id = v_user_id;

  RAISE NOTICE 'Promoted % to admin (both surfaces). Have them log out and back in.', v_email;
END $$;
