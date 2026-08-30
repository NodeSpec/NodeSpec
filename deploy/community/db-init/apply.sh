#!/usr/bin/env bash
# NodeSpec Community — one-shot database initialization (compose stack).
#
# 1. Aligns the platform role passwords with .env (the supabase/postgres
#    image creates the roles; their passwords must match what the sibling
#    services were told).
# 2. Applies the NodeSpec schema + reference data from supabase/migrations,
#    in filename order, exactly once — a re-run sees public.projects and
#    exits without touching an initialized database.
set -euo pipefail

export PGPASSWORD="${POSTGRES_PASSWORD}"
PSQL_ADMIN=(psql -h db -p 5432 -U supabase_admin -d postgres -v ON_ERROR_STOP=1)
PSQL_PG=(psql -h db -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "[nodespec-init] waiting for the database"
until pg_isready -h db -p 5432 -U supabase_admin >/dev/null 2>&1; do sleep 2; done

echo "[nodespec-init] aligning platform role passwords"
"${PSQL_ADMIN[@]}" <<SQL
ALTER USER postgres WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER authenticator WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_auth_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
CREATE SCHEMA IF NOT EXISTS _realtime;
SQL

# The CLI/hosted platform provides auth helper functions the raw image
# baseline may lack (live-caught 2026-09-02: the image ships auth.uid() but
# not auth.jwt(), so the squashed schema died at its first auth.jwt()
# reference). Create only what is MISSING — never replace what the image or
# a newer GoTrue owns — using the canonical Supabase definitions.
echo "[nodespec-init] ensuring auth helper functions"
"${PSQL_ADMIN[@]}" <<'SQL'
DO $do$
BEGIN
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    CREATE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE
      AS $f$
        select coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $f$;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $f$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
      $f$;
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $f$
        select coalesce(
          nullif(current_setting('request.jwt.claim.role', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
        )::text
      $f$;
  END IF;
  IF to_regprocedure('auth.email()') IS NULL THEN
    CREATE FUNCTION auth.email() RETURNS text
      LANGUAGE sql STABLE
      AS $f$
        select coalesce(
          nullif(current_setting('request.jwt.claim.email', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
        )::text
      $f$;
  END IF;
END
$do$;
SQL

# The NodeSpec schema references auth.users (FKs, RLS). The supabase/postgres
# image ships the auth baseline; if a future image defers it to GoTrue's
# first migration run, wait rather than fail.
echo "[nodespec-init] waiting for the auth schema baseline"
until [ "$("${PSQL_ADMIN[@]}" -tAc "select to_regclass('auth.users') is not null")" = "t" ]; do
  echo "[nodespec-init] auth.users not present yet — retrying"
  sleep 2
done

if [ "$("${PSQL_ADMIN[@]}" -tAc "select to_regclass('public.projects') is not null")" = "t" ]; then
  echo "[nodespec-init] NodeSpec schema already present — nothing to do"
  exit 0
fi

echo "[nodespec-init] applying the NodeSpec schema + reference data"
# -1 (single transaction) per file: a failure rolls the whole file back, so
# the public.projects idempotence check above can never see a half-applied
# database on the next run (live-caught 2026-09-02: a mid-file error left a
# partial schema that a retry would have skipped past).
for f in /nodespec-migrations/*.sql; do
  echo "[nodespec-init] applying ${f}"
  "${PSQL_PG[@]}" -1 -f "${f}"
done

echo "[nodespec-init] done"
