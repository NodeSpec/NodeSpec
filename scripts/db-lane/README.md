# The SQL test lane

Behaviour tests that run **inside a real Postgres** with the migration chain
applied. Each file builds its own fixture in a transaction, exercises a
function or trigger the way the app and the MCP server do, asserts with
`RAISE EXCEPTION`, and rolls back. The database is unchanged afterwards.

```bash
npx supabase start && npx supabase db reset      # once, the local stack
npm run test:db                                  # every file
npm run test:db -- --only=delete                 # a substring of a file name
npm run test:db -- --list                        # names only, nothing runs
DATABASE_URL=postgresql://... npm run test:db    # another LOCAL database, host psql
DB_LANE_CONTAINER=my-postgres npm run test:db    # psql inside that container
```

Docker is all a machine needs. With no `DATABASE_URL`, the runner looks for
the Supabase CLI's database container (`supabase_db_<project_id>`, from
`supabase/config.toml`) and runs each file with the `psql` inside it, so the
host needs no Postgres client, no published port and no bash (the runner is
Node, and runs the same from PowerShell). The `\ir` lines that apply a
migration are inlined, since the container cannot see this checkout. With
no container it falls back to `127.0.0.1:54322` and the host's `psql`, and
says what to start when there is neither.

The lanes pass on a seeded stack (`supabase db reset` loads
`supabase/seed.sql`, whose bench user already holds a Team plan and an API
key) and on a bare chain (the PR gate): a lane that needs a plan replaces the
owner's plan inside its transaction, and a lane that counts rows owns its
owner.

The runner refuses a `DATABASE_URL` whose host is not `127.0.0.1`, `localhost`
or a unix socket unless `ALLOW_NONLOCAL=1` is set. Never point it at
production.

## Where it runs

The PR gate runs this lane on every pull request, inside the Postgres the
migration chain was just applied to (`.github/workflows/pr-gate.yml`, the
`migrations` job, after the schema audit). A fresh chain has no users and
every file owns its fixture with one, so the runner seeds a throwaway
`auth.users` row when `DB_LANE_SEED_USER=1` and the table is empty. A seeded
local stack has `bench@nodespec.local` and is left alone.

## The rate limit (2026-09-26)

- `089_mcp_rate_buckets.sql`: `mcp_rate_take` on real rows. A burst of 60,
  the 61st waits 1 second, another credential is not held back; a second of
  rest lets 4 through and no fifth, a long rest the burst and no more; bad
  arguments and a foreign holder refused. As a signed-in person and as
  anon the table and the function are refused; with a grant put back, RLS
  alone still shows and takes nothing. Deleting an account deletes its
  buckets and nobody else's.

## A node's history stays small (2026-09-27)

- `091_node_memory_bounds.sql`: `node_memory` after item 27. A proposal
  binding thirty files to a node is one decision carrying its first three
  reasons, in the proposal's order and each once, and a count of thirty (not
  the rejected file, not another node's); a decision that gave no reason
  carries none and counts none. A proposal naming the node only as an edge's
  end is found; one naming its id only in a sentence, or editing a file on
  it, is not. Forty edits of a file, its removal and its move onto the node
  are not the node's memory; a rename is. Each kind keeps its newest twenty.

## A Team project outlives its people (2026-09-27)

- `092_team_data_outlives_people.sql`: a contributor who wrote a spec and
  connected the repository, and a person who resolved a card, delete their
  accounts; the spec, its requirements, the connection and the card stay,
  their creator emptied. After a hand-over the previous owner's branch and
  snapshots stay when that account goes. An owner whose project a seat is
  held on is refused deletion by the project's name until the seats go. A
  revoked key stays revoked and keeps its hash; a person cannot mint,
  update or un-revoke one, nor run the Stripe helpers or read the
  provisioning dashboard; anon runs none of them; an admin reads the
  pending-provisioning list. A contributor reads the repository connection
  and cannot change it; a maintainer can.

## Classification is the Government build's (2026-09-27)

- `093_classification_government_only.sql`: a hosted plan_name naming
  Government or Enterprise is Team. No mark and no clearance is set on the
  managed site, on a self-hosted (open source or Enterprise) database, or by
  the server itself, and the refusal names the Government build; a
  Government install (`nodespec.edition = government`) sets both; clearing
  a mark and emptying a clearance are allowed everywhere.

## Desktop and mobile apps have their rows (2026-09-30)

- `105_desktop_mobile_rows.sql`: migration 20260930140000 applied twice
  over a project that drew a desktop app and a phone app. Windows Forms,
  WinUI 3, Qt, GTK, Avalonia UI, JavaFX and Wails drop as a Desktop App and
  Capacitor and Compose Multiplatform as a Mobile App, each with no picker,
  a code packet, a reason not to choose it and choices that name no
  version; the cross-platform ones say where they ship. Every app
  technology import names takes the type, the device and the target import
  draws it on; Swift (macOS) and JavaFX carry the Swift and Java logos; the
  index defaults to extractor version 6; replay and the stored graph are
  unchanged.

## Every account has an example project (2026-09-30)

- `106_example_project.sql`: migration 20260930150000 applied twice. A
  Free account asking for its example gets the whole Living Cascade demo
  under its own ids, named as the example and marked, with the Team mode
  roster, named workflow owners and a teammate's proposal; nothing in it
  names the seed's ids or the bench user, and asking again gives the same
  project. A second account (an apostrophe in its email, the two Free
  projects already held) gets its own copy. The call leaves the caller
  signed in as they were, is refused signed out and to anon, and nobody
  signed in reads the SQL it runs. The cap does not count the example; a
  person cannot set, change or remove the mark and the server can. A Free
  owner reads the example's constraints and not their own project's, and
  writes none of the example's workflows or constraints. Deleted, it is
  not made again.
- `107_example_bakery.sql` (AJ.6b, 2026-10-01): under 20260930150000 one
  account holds the game example and another has deleted it; then
  20261001120000 runs twice. The game example is gone, the account's own
  project stays, and its next call makes the Harbor Lane Bakery example
  under the same id, whole, with Team mode, naming the account and none of
  the seed's ids. Every task row is a task line in its node's doc the way
  the server reads one (the em dash), where the game example's were not.
  The account that deleted its example is not given the bakery; a new
  account gets its own; a replay leaves the bakeries alone.

## What the multi-agent files prove (2026-09-21)

- `050_agent_checkouts.sql`: two agents contend for one task through
  `agent_checkout_claim` and the first holds; a silent hold is reclaimed
  under the threshold given, with its audit row; the server's heartbeat,
  release, bind, resolve and revoke UPDATEs are replayed with their exact
  filters against rows they must and must not touch; the partial unique
  index refuses a duplicate written around the RPC; the CHECK constraints
  close the vocabulary; a file is exclusive, a requirement advisory, a
  criterion exclusive per pair; owner, contributor and viewer see the
  board, a viewer and a stranger write nothing.
- `051_mcp_api_keys.sql`: `validate_mcp_api_key` on real rows: a live key
  validates with its user, id and scopes and is stamped; unknown, revoked
  and expired keys refuse with the reason the server relays; scopes are
  closed at the table; RLS keeps keys per person; a person reads their own
  keys and nothing more (minting and revoking are the server's, which keeps
  the connection cap), and a key the server revokes refuses the next
  connection.
- `052_proposal_states.sql`: the status vocabulary; the compare-and-set
  `resolve_proposal` relies on (a settled row refuses, the first resolver
  lands, the second finds nothing); each seat's read and write; an accept
  without an import job leaves `import_jobs` alone. The seats are the
  ladder's: the owner and a maintainer write, a contributor and a viewer
  read only (migration 20260921120000, the owner's ruling on the finding
  this file first recorded).
- `066_catalog_search.sql`: `search_relevant_technologies` on real rows. A
  row named with a long spelling is reachable by a prefix of it (the english
  stemmer writes "postgres" as a different lexeme than "PostgreSQL", so the
  row could not match its own short name at all); the row NAMED by a query
  outranks the rows that merely mention it, however often they repeat it;
  case and hyphens never decide; a trailing stopword no longer raises "no
  operand in tsquery"; and a word in no row still answers nothing
  (migration 20260921140000, the owner's report 2026-09-21).
- `065_agent_connections.sql`: `agent_connection_count` on real rows: live
  keys count, revoked and expired keys do not; an OAuth client counts once
  however many rows its rotation left, a refreshable family still counts,
  revoked and fully expired clients do not; the renewing client is left
  out by name; another person's rows never count; a session cannot call
  it. Then one live key per name per person, case blind, and a revoked key
  frees its name (migration 20260921130000, owner ruling 2026-09-21).

- `068_plan_in_the_database.sql`: the plan on the app's own writes (V3 Q,
  migration 20260922110000). A Community owner writes no workflow, step,
  step map, lane move, seat or mark, and stops at two projects, while still
  reading what exists; an outcome that names a lane is filed on the home
  lane. Indie writes workflows and lifts the cap; Team adds seats;
  Government marks and clears. A Community seat on a paid project writes
  what the owner pays for; `plan_allows` says nothing about a project the
  caller is not on and `account_plan_tier` is not callable by clients; a
  self-hosted database and the server pass. `064_plan_reject.sql` now
  starts its owner on Community (rejects nothing) before Indie.

The Deno suite's half of the same behaviours runs on `MemorySupabase`
(`supabase/functions/tests/helpers.ts`), a table-backed fake that applies
the query filters; the two SQL functions it models are proven here.

## Why this lane exists

The unit gates cannot see the database. On 2026-09-18 main shipped a
`propose_patches` that calls the `graph_reference_ids` RPC while the migration
creating it had been deleted (a fresh reset rejected it: the SQL function
referenced a helper defined after it). Every gate was green: the Deno test
scripted the RPC's answer, and the vitest files asserted that the migration
text contained certain strings. Nothing asked a database whether the function
existed. `010_graph_reference_ids.sql` does.

The same shape covers project deletion: three vitest files read the delete
migration's text; `020_project_delete_at_scale.sql` deletes a project with
46 000 rows and counts what is left, then a second with the V3 tables
filled (decided outcomes filed on steps, couplings, workflow-scoped
constraints), one row a step.

A drop is proved the same way. `030_dead_tables_are_gone.sql` asserts that
the table V3 1.3 dropped answers no regclass, that `audit_log` (listed on
the board's first pass from a text grep, and in truth template text inside
an artifact's content string) never existed, and that the four tables which
shared the dropped table's migration still answer through their RLS as the
owner and as a stranger.

## Writing a file

- Name it `NNN_what_it_proves.sql`; files run in name order.
- Start with `\set ON_ERROR_STOP on` and `BEGIN;`, end with `ROLLBACK;`.
- Impersonate the caller the way the code does. The MCP server is the service
  role; the app is an authenticated user. Set both claim spellings:

  ```sql
  SET LOCAL request.jwt.claim.role = 'service_role';
  SET LOCAL request.jwt.claims = '{"role":"service_role"}';
  ```

- Own fixtures with the seeded bench user (`bench@nodespec.local`), falling
  back to any `auth.users` row; refuse with a clear message when there is none.
- Use fixed ids under a per-file prefix (`db1…`, `db2…`) so two files never
  collide even if a rollback is skipped by a crash.
- Every assertion is a `RAISE EXCEPTION` naming what was expected and what
  came back. Report success with `RAISE NOTICE 'db-lane NNN: …'`; the runner
  prints those lines under `PASS`.
- Check `to_regprocedure` / `to_regclass` first and fail naming the
  migration, so a stack behind the chain reads as "apply migration X", not
  as a mystery.

`src/tests/db-lane.test.ts` pins the wiring (runner, package script, the
`BEGIN`/`ROLLBACK` contract of every file) and, with `NODESPEC_DB_LANE=1`,
runs the lane inside `npm test`.
