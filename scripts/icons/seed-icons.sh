#!/usr/bin/env bash
# Seed the deployment's OWN Supabase storage with the vendored icon set, then
# repoint technology_catalog at it (ICONS-1, owner ruling 2026-09-01: icons
# ship WITH the product — no deployment hotlinks the hosted bucket, because
# enterprise boxes may be fully air-gapped and OSS forks point at their own
# stacks).
#
# What it does, in order — idempotent, safe to re-run after every update:
#   1. creates the public `icons` bucket if it doesn't exist,
#   2. uploads every file under assets/icons/ (x-upsert — re-runs overwrite),
#   3. repoints technology_catalog.icon_url from the hosted-bucket prefix to
#      this deployment's own storage path (relative by default: the selfhost
#      nginx gateway proxies /storage/ to Kong, so /storage/v1/... resolves
#      against the app origin in both community and enterprise builds),
#   4. verifies every repointed row against storage.objects and warns about
#      any that would 404.
#
# Step 3 also self-heals the known update-lane hazard: catalog migrations
# that (re)write hosted-absolute icon URLs are re-localized on the next run,
# which is why bootstrap.sh calls this on every invocation.
#
# Env (all optional):
#   ICON_API_URL      Supabase API base for uploads   (default http://127.0.0.1:54321)
#   ICON_URL_BASE     URL prefix stamped into the DB  (default /storage/v1/object/public/icons/)
#                     Use an absolute base (e.g. http://127.0.0.1:54321/storage/v1/object/public/icons/)
#                     when the app is NOT served behind the single-origin gateway.
#   SERVICE_ROLE_KEY  Storage-write key; read from `supabase status` when unset.
#
# Bash + curl + docker only — the selfhost VM deliberately carries no Node
# runtime (security audit 2026-08-24).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ASSETS="$ROOT/assets/icons"
API_URL="${ICON_API_URL:-http://127.0.0.1:54321}"
URL_BASE="${ICON_URL_BASE:-/storage/v1/object/public/icons/}"
HOSTED_PREFIX='https://komnpkjlvgfworfbdrya.supabase.co/storage/v1/object/public/icons/'

say()  { printf '[seed-icons] %s\n' "$*"; }
fail() { printf '[seed-icons] ERROR: %s\n' "$*" >&2; exit 1; }

# 0 · assets present? (a pre-snapshot clone has only the README — not an error)
[ -d "$ASSETS" ] || { say "no assets/icons directory — nothing to seed"; exit 0; }
mapfile -t FILES < <(find "$ASSETS" -type f ! -name 'README.md' ! -name '.gitkeep' | sort)
if [ "${#FILES[@]}" -eq 0 ]; then
  say "assets/icons holds no icon files yet (run scripts/icons/snapshot-icons.mjs on an ops machine) — nothing to seed"
  exit 0
fi

# 1 · service key (storage writes are RLS-gated; anon can't upload)
if [ -z "${SERVICE_ROLE_KEY:-}" ]; then
  SERVICE_ROLE_KEY="$(cd "$ROOT" && supabase status -o env 2>/dev/null \
    | grep -E '^(SERVICE_ROLE_KEY|SECRET_KEY)=' | head -1 \
    | sed -E 's/^[A-Z_]+=//; s/^"//; s/"$//')"
fi
[ -n "${SERVICE_ROLE_KEY:-}" ] || fail "SERVICE_ROLE_KEY unset and not readable from 'supabase status' — is the stack running?"
AUTH=(-H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY")

# 2 · public icons bucket (409/400 = already exists — fine)
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/storage/v1/bucket" \
  "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"id":"icons","name":"icons","public":true}')"
case "$CODE" in
  200|201) say "created public bucket 'icons'";;
  400|409) say "bucket 'icons' already exists";;
  401|403) fail "storage refused the service key (HTTP $CODE) — check SERVICE_ROLE_KEY";;
  *)       fail "bucket create failed (HTTP $CODE) — is the stack up at $API_URL?";;
esac

# 3 · upload everything (x-upsert overwrites, so re-runs converge)
ok=0; failed=0; failed_list=""
for f in "${FILES[@]}"; do
  rel="${f#"$ASSETS"/}"
  urlpath="${rel// /%20}"
  case "${f##*.}" in
    png)      ctype='image/png' ;;
    svg)      ctype='image/svg+xml' ;;
    webp)     ctype='image/webp' ;;
    jpg|jpeg) ctype='image/jpeg' ;;
    ico)      ctype='image/x-icon' ;;
    *)        ctype='application/octet-stream' ;;
  esac
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "$API_URL/storage/v1/object/icons/$urlpath" \
    "${AUTH[@]}" -H "Content-Type: $ctype" -H 'x-upsert: true' \
    --data-binary @"$f")"
  if [ "$CODE" = "200" ]; then ok=$((ok+1)); else failed=$((failed+1)); failed_list="$failed_list  $rel (HTTP $CODE)\n"; fi
done
say "uploaded $ok/${#FILES[@]} files"
[ "$failed" -eq 0 ] || { printf '%b' "$failed_list" >&2; fail "$failed uploads failed"; }

# 4 · repoint catalog rows at this deployment's storage
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
[ -n "$DB_CONTAINER" ] || fail "could not find the supabase_db_* container — is the stack running?"
REPOINTED="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc \
  "with u as (
     update public.technology_catalog
     set icon_url = replace(icon_url, '$HOSTED_PREFIX', '$URL_BASE'), updated_at = now()
     where icon_url like '$HOSTED_PREFIX%'
     returning 1)
   select count(*) from u;")"
say "repointed $REPOINTED catalog rows from the hosted bucket to $URL_BASE"

# 5 · verify: every localized row must resolve to an object we just seeded
BROKEN="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "select t.id || ' -> ' || t.icon_url
   from public.technology_catalog t
   where t.icon_url like '$URL_BASE%'
     and not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'icons'
         and o.name = replace(replace(t.icon_url, '$URL_BASE', ''), '%20', ' ')
     )
   order by t.id;")"
if [ -n "$BROKEN" ]; then
  say "WARNING: rows pointing at objects the seed does not carry (broken image until the asset is added upstream):"
  printf '%s\n' "$BROKEN" >&2
else
  say "all localized icon rows resolve against the seeded bucket"
fi
say "done"
