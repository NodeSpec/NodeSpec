# NodeSpec test bench

A live end-to-end regression suite: real scenarios driven against a RUNNING
NodeSpec stack (edge functions, database, MCP server) and the real GitHub
API, asserting on responses, committed files, and database state. Nothing is
mocked — a failing check is a live bug report.

```
npm run bench:oss                # run everything
npm run bench:oss -- --preflight # check the stack, the keys and the sandbox; run nothing
npm run bench:oss -- --list      # scenarios grouped by functional area (offline)
npm run bench:oss -- --only=unchanged-push
npm run bench:oss -- --dry-run
```

## What you need

1. **A running local NodeSpec stack.** Either the Docker quick start
   (`deploy/community` — the gateway serves everything on
   `http://localhost`) or the source dev stack (`npx supabase start` —
   `http://127.0.0.1:54321`). The bench REFUSES non-local URLs: it churns
   projects and force-pushes a repo, so it must never point at a shared or
   production deployment.
2. **An account in your stack.** Sign up in the app (any email/password —
   local stacks don't send confirmation mail). The bench signs in as this
   user and creates throwaway projects (name prefix `bench-auto-`, cleaned
   up on the next run).
3. **An MCP API key.** Mint one in the app (Agents → Connected → Connect an
   agent) for the same account — the MCP scenarios authenticate with it. The
   account needs room for two more connections on top of it: `v3-connections`
   and `checkout-loop` mint their own keys as the signed-in person (and revoke
   them at the end), so a community account (one connection) cannot run them.
4. **A dedicated throwaway GitHub repo** (e.g. `you/nodespec-bench-sandbox`)
   plus a token with contents + pull-request read/write on it. The sandbox
   is **FORCE-RESET before every scenario** — never point it at a repo you
   care about.

## Configure

Copy `.env.bench.example` to `.env.bench` (same directory, gitignored) and
fill it in:

- `SUPABASE_URL` — `http://localhost` (Docker quick start) or
  `http://127.0.0.1:54321` (dev stack).
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Docker quick start:
  the `ANON_KEY` / `SERVICE_ROLE_KEY` values from `deploy/community/.env`.
  Dev stack: printed by `npx supabase status`.
- `GITHUB_TOKEN` / `BENCH_REPO` — the sandbox repo and its token.
- `BENCH_LIVE_PROVIDER` / `GITLAB_TOKEN` / `BENCH_LIVE_BASE_URL` — optional;
  point the LIVE import scenario (`BENCH_LIVE_REPO=…`) at a GitLab project:
  `BENCH_LIVE_PROVIDER=gitlab`, a personal access token with `read_api` +
  `read_repository`, and for self-managed GitLab the API base
  (`https://gitlab.example.com/api/v4`). `BENCH_LIVE_REPO` is the full
  project path (`group/subgroup/project` — nested groups are fine).
- `BENCH_USER` / `BENCH_PASS` / `MCP_API_KEY` — the account and API key you
  created above (uncomment the lines; the commented defaults are for a
  seeded dev database and will not exist in your stack).

## Before anything runs: the preflight

Every run starts by proving the stack can answer for this checkout, and stops
with the problem named (exit code 3) instead of letting scenarios fail one by
one for the same reason:

- the stack answers at `SUPABASE_URL` and the service key is the stack's;
- the database carries every table and service-role function the migrations
  in this checkout make (a database behind the checkout names the objects it
  is missing and says to reset or migrate it);
- the MCP server and the edge functions are served;
- `BENCH_USER` signs in, and the MCP key is accepted;
- the sandbox repo exists and the token can push to it.

It warns, without stopping, when the account is below Team (the tier-gated
checks then record SKIP with the reason), when it has no room for the
connections the scenarios mint, and when the GitHub token is close to its
rate limit. Keys and tokens a crashed earlier run left behind are cleared.

## Statuses, exit codes and the report

Each scenario ends in one status:

- **PASS**: every check held.
- **FAIL**: a product check failed. The check line carries the evidence.
- **SKIP**: the check could not apply on this stack and says why (a gate the
  account's plan does not reach, a live repo with nothing to accept). A skip
  is never counted as a pass.
- **ERROR**: the stack or the harness failed and every product check the
  scenario made held: the sandbox could not be reset, a call never answered
  or failed below its tool (a 5xx, a gateway page, a timeout), or the
  scenario made no check at all. The line says whether the stack answered
  its health check afterwards (it stalled and came back) or still did not,
  and a set-up slower than 20 s is printed with its sign-in and sandbox-reset
  times. Re-run it; if it repeats, look at the stack.
  A scenario that runs past its time budget is a FAIL, since the product may
  have stalled.

A call that fails below the tool is recorded against the scenario ("every MCP
call reached its tool"), so a crashed function can never read as a refusal a
check expected. Every request has a time limit (`BENCH_REQUEST_TIMEOUT_MS`,
default 60000) and every scenario a budget (`BENCH_SCENARIO_TIMEOUT_MIN`,
default 12; long scenarios carry their own). A 429 from the MCP rate limit
is waited out once, as `Retry-After` says.

The exit code is 0 when nothing failed, 1 when a product check failed, and 3
when the harness or the stack did. The whole run is written to
`scripts/bench/out/bench-report.json` (statuses, every check with its detail,
timings), which is the file to attach to an issue.

## Two doors, both on the bench

Scenarios read and write fixtures with the **service key** (`rest(env)`,
RLS bypassed) and drive the server over **MCP** (the seeded key, a minted
key, or the person's session as bearer). `v3-app-writes` adds the third
door, the one the browser uses: PostgREST **as the signed-in person**
(`restAs(env, session)`, the person's JWT), under the RLS policies. A check
that fails there is the app failing, whatever the tools say.

`src/tests/bench-coverage.test.ts` keeps the bench honest about its reach:
every registered MCP tool has a live scenario, every edge function is
exercised or excused by name, and every table the app writes as the person
is written as the person here or excused by name.

## Reading the output

Scenarios are grouped by the functionality they prove — repository sync and
drift detection, branches and pull requests, architecture proposals over
MCP, requirements and the specification plane, acceptance evidence and the
work loop, test plans and verification, file bindings and task packets.
Each scenario prints per-check PASS/FAIL/SKIP with the failing payload
inline; the summary repeats the tally per area. Re-run a single failure with
`-- --only=<name>` before filing an issue, and paste the check output — it
contains the evidence.
