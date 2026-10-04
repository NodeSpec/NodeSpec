#!/usr/bin/env bash
# Replays every migration in order against DATABASE_URL (default: a local
# database named "replay"), one psql session per file with ON_ERROR_STOP so
# a failing file is recorded — and the rest of that file skipped — while the
# run continues. Prints ok/fail counts; failures with their first error
# lines land in replay-failures.log beside this script.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="${MIGRATIONS:-$HERE/../../../supabase/migrations}"
DB="${DATABASE_URL:-postgresql:///replay}"
LOG="$HERE/replay-failures.log"
: > "$LOG"
ok=0; bad=0
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  if out=$(psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    ok=$((ok+1))
  else
    bad=$((bad+1))
    { echo "=== FAIL $(basename "$f")"; echo "$out" | grep -E "ERROR|LINE|DETAIL|HINT" | head -6; } >> "$LOG"
  fi
done
echo "replay: ok=$ok fail=$bad (details: $LOG)"
