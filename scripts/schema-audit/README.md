# Schema audit

Keeps the migration chain, the live catalog and the code telling the same
story. Two halves, one verdict — `npm run schema:audit` exits 1 on any
HARD finding.

| Half | What it checks | Where |
|------|----------------|-------|
| static | Replays `CREATE / DROP / RENAME TABLE` across `supabase/migrations` into a table ledger, then scans `src/` and `supabase/functions/` for every `.from('x')`: each must name a table the chain ends with. Forward references (a table a later phase creates, probed behind a try/catch) are allowed only through `FORWARD_REFS` in `ledger.mjs`. | `ledger.mjs`, also run by vitest (`src/tests/schema-code-parity.test.ts`) |
| catalog | `audit.sql` against a database that has the chain applied: functions whose bodies name relations that do not exist, identical trigger-function bodies under different names, foreign-key columns with no index, RLS-on-with-no-policies tables that do not say the posture is intentional, ledger ↔ database drift; plus inventory (uncommented tables, islands, soft `*_id` columns). | `audit.sql`, `run.mjs` |

## Running it

Against the local Supabase stack (the normal path):

```sh
supabase db reset          # or: supabase migration up
npm run schema:audit       # DATABASE_URL defaults to the CLI's 54322 port
```

Options: `--static-only` (no database), `--json` (raw report). Point
`DATABASE_URL` elsewhere to audit another stack — never production over a
service key; the queries are read-only but the habit is not.

`audit.sql` runs as-is in psql or the SQL editor and prints one JSON
document, so it can be read without the runner.

### The catalog half needs a `psql` on PATH

The runner shells out to `psql`. The Supabase CLI runs Postgres inside
Docker and installs no client, so on Windows especially you may have a
working stack and still no `psql` — the runner says so and exits 2. Three
ways through, in order of preference:

```sh
winget install PostgreSQL.psql        # Windows; macOS: brew install libpq
npm run schema:audit

# or borrow the client inside the CLI's own container
docker exec -i supabase_db_<project> psql -U postgres -X -tA \
  < scripts/schema-audit/audit.sql

# or skip the database half — the ledger/code gate still runs
npm run schema:audit -- --static-only
```

`--static-only` is the half that catches phantom-table reads, and it needs
nothing but the repo, so it is always worth running.

## Reading the verdict

- **HARD** findings are defects or sprawl the repo has decided to keep at
  zero: a function that raises the day it is called, a cascade that table-
  scans, two names for one trigger body, a security posture nobody wrote
  down, code naming a table that does not exist.
- **warn** lines are inventory for the reader: tables without a comment,
  islands and soft references that are not yet explained. Add a `COMMENT`
  and they stop appearing — that is the point of them.

When a HARD finding is intentional, the fix is to make the intent legible
to the audit (a comment that says "service role only", a `FORWARD_REFS`
entry), never to loosen the query. A function that returns SQL as a text
constant (`example_project_sql()`) says so in its comment ("Returns SQL as
text"); its prose is then not read as relations, and the tables it names are
proven by running it in a lane.

## Stock-Postgres replay (no Supabase CLI)

`replay/` reproduces the audited catalog on a plain Postgres 16+ — the way
the 2026-09-14 audit was done in a container without Docker:

```sh
# 1. once, as root: stub the Supabase-only extensions the chain creates
cp replay/ext-stubs/* "$(pg_config --sharedir)/extension/"
# 2. an empty database, the platform shim, then the chain
createdb replay && psql replay -f replay/shim.sql
bash replay/replay.sh          # every migration, one psql session each
# 3. audit it
DATABASE_URL=postgresql:///replay npm run schema:audit
```

`shim.sql` provides just enough of `auth`, `storage`, `vault`, the roles
and the realtime publication for the public-schema migrations to apply;
`ext-stubs/` are no-op `pg_cron` / `pg_net` extensions. `vector` is guarded
in the one migration that uses it, so the embedding column simply does not
exist on the replay. Expect exactly one migration to fail on stock
Postgres: the pg_cron scheduling one, which defines no schema objects.
