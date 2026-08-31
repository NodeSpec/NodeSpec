# NodeSpec test bench

A live end-to-end regression suite: real scenarios driven against a RUNNING
NodeSpec stack (edge functions, database, MCP server) and the real GitHub
API, asserting on responses, committed files, and database state. Nothing is
mocked — a failing check is a live bug report.

```
npm run bench:oss             # run everything
npm run bench:oss -- --list   # scenarios grouped by functional area (offline)
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
3. **An MCP API key.** Mint one in the app (Account → API keys) for the same
   account — the MCP scenarios authenticate with it.
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
- `BENCH_USER` / `BENCH_PASS` / `MCP_API_KEY` — the account and API key you
  created above (uncomment the lines; the commented defaults are for a
  seeded dev database and will not exist in your stack).

## Reading the output

Scenarios are grouped by the functionality they prove — repository sync and
drift detection, branches and pull requests, architecture proposals over
MCP, requirements and the specification plane, acceptance evidence and the
work loop, test plans and verification, file bindings and task packets.
Each scenario prints per-check PASS/FAIL with the failing payload inline;
the summary repeats the tally per area. Re-run a single failure with
`-- --only=<name>` before filing an issue, and paste the check output — it
contains the evidence.
