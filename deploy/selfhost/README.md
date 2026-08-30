# NodeSpec Self-Host — Enterprise Deployment (SHIP-1(e))

> The Team/Enterprise artifact is a **CI build product of the main repo, never a
> fork** (SHIP-1 doctrine, `docs/SHIP1_CUTOVER_RUNBOOK.md` §6). The runtime shape
> is the same Supabase OSS stack the NodeSpec bench runs daily — the bench IS the
> self-host reflection — plus the two pieces the CLI stack doesn't provide: a
> served frontend and the deployment configuration in this directory.
>
> **Status: bench-proven components, first client VM run pending.** Every stack
> component here (Postgres 17 + the schema, GoTrue, PostgREST, Realtime, Storage,
> the edge runtime serving all functions) is exercised end-to-end by the 32-scenario
> bench on this exact shape. The frontend container and bootstrap wrapper are
> authored against that and verified at build time; their first full VM execution
> is part of the pilot's acceptance — rough edges found there get fixed in THIS
> file, same convention as `docs/STAGING_RUNBOOK.md`.

## What a deployment looks like

One VM (AWS EC2 / GCP CE / anything with Docker), one bundle:

| Piece | Runs as | Port (default) |
|---|---|---|
| Postgres 17 + the NodeSpec schema | Docker (via Supabase CLI) | 54322 |
| Auth (GoTrue), API (PostgREST), Realtime, Storage | Docker (via Supabase CLI) | 54321 |
| Edge functions (MCP server, generators, git lanes) | Docker edge runtime (via Supabase CLI) | 54321/functions/v1 |
| Supabase Studio (DB admin — keep firewalled) | Docker (via Supabase CLI) | 54323 |
| **NodeSpec frontend + single-origin gateway** | Docker (nginx, this directory) | **80 — the only exposed port**; proxies auth/rest/realtime/storage/functions to Kong |

The customer bundle is produced by `scripts/selfhost/build-bundle.mjs` (CI
dispatch per customer): squashed schema instead of migration history, a stamped
license verification key, and a leak-gate pass — see the workflow. What you are
reading may be inside such a bundle already.

## Prerequisites (on the VM)

Two tools, installed from SIGNED/PINNED sources only — no `curl | sh`, no
third-party apt repos, and no Node runtime on the VM (security audit
2026-08-24; the frontend's Node lives inside its build container):

1. **Docker Engine** — from Ubuntu's own signed archive:
   `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2`
2. **Supabase CLI** — the pinned `.deb` from the release these scripts were
   verified against (github.com/supabase/cli/releases, v2.115.0 or later).
   Download `supabase_<version>_linux_amd64.deb` and the release's checksum
   manifest — named plain `checksums.txt` (live-verified 2026-08-24) — then:
   `grep linux_amd64.deb checksums.txt | sed 's|  .*deb|  supabase.deb|' | sha256sum -c -`
   (POSIX-shell-safe on purpose; must print `supabase.deb: OK`) BEFORE
   `sudo dpkg -i supabase.deb`. Sanity: the `.deb` is ~60 MB; a 9-byte
   download is a "Not Found" page, not a package. Fallback check: compare
   `sha256sum supabase.deb` to the digest GitHub shows on the asset row.

## Deploy

```bash
# 1. Unpack the bundle, then from its root:
cp deploy/selfhost/selfhost.env.example deploy/selfhost/selfhost.env
#    Edit selfhost.env — every value is documented in the file. The three that
#    MUST be set: ENCRYPTION_SECRET (any long random string, then never change
#    it — it envelopes stored customer secrets), NODESPEC_LICENSE (issued by
#    NodeSpec with your contract), and PUBLIC_APP_URL.

# 2. Bootstrap (idempotent — safe to re-run):
bash deploy/selfhost/bootstrap.sh
```

The bootstrap:
- verifies Docker + the Supabase CLI,
- composes `supabase/functions/.env` from your `selfhost.env` (the functions
  read `NODESPEC_DEPLOYMENT=self-hosted`, your license, and the encryption
  secret from there),
- starts the Supabase stack (`supabase start`) and applies the schema
  (`supabase db reset` on first run — the bundle's schema, no bench seed),
- builds and starts the frontend container on `FRONTEND_PORT` (default 80) —
  the single origin serving the app AND the proxied Supabase surface.

## First admin

Sign up through the app first (with SMTP unconfigured, confirmations are off —
see Auth email below), then promote that account:

```bash
# psql runs INSIDE the db container (CLI 2.x has no `supabase db psql`):
docker exec -i "$(docker ps --format '{{.Names}}' | grep '^supabase_db_')" \
  psql -U postgres -d postgres -v admin_email=you@company.com -f - \
  < deploy/selfhost/sql/first-admin.sql
# (plain email, no quotes — the SQL uses psql's :'admin_email' safe quoting)
# or open Studio (:54323) → SQL editor → paste sql/first-admin.sql, replace
# :'admin_email' on the set_config line with 'you@company.com'.
```

It sets both admin surfaces (the `user_settings` row server checks read, and the
JWT `app_metadata` claim RLS reads). Log out and back in so the fresh JWT
carries the claim.

## The license

`NODESPEC_LICENSE` (in `selfhost.env`) is the signed `nslic1.…` token NodeSpec
issues per contract. It sets your deployment's plan tier — same tier vocabulary
as the SaaS, different source. **Fail-closed and non-fatal:** a missing/expired/
altered license runs at the community tier and logs the exact reason
(`[selfhost-license] running unlicensed: …` in the functions log) — nothing
stops working, per the all-features doctrine; tiers scale, they never gate
features. Renewals are a new token in `selfhost.env` + a stack restart.

## Auth email (SMTP)

Out of the box, email confirmations are OFF (`enable_confirmations = false` in
`supabase/config.toml`) — accounts work immediately, which is right for a
firewalled pilot. For confirmed-email production use, configure
`[auth.email.smtp]` in `supabase/config.toml` with your relay and set
`enable_confirmations = true`, then `supabase stop && supabase start`.

## Upgrades, backups, operations

- **Upgrade:** unpack the new bundle beside the old, stop the frontend
  container, run the bundle's `deltas/*.sql` in order against the database
  (release-to-release schema deltas ship with each bundle), re-run
  `bootstrap.sh`. Never run `supabase db reset` on a live deployment — it
  DROPS the database; it is a first-install step only.
- **Backup:** `supabase db dump --local --data-only -f backup-$(date +%F).sql`
  on a schedule you control (cron), copied off the VM (e.g. to S3); the Docker
  volumes carry the live data, so VM/EBS snapshots are a second layer.
- **Firewall:** expose ONLY `FRONTEND_PORT` (default 80) — the app's nginx
  proxies the whole Supabase surface on the same origin, so 54321 stays
  closed and MCP agents connect via `http(s)://<host>/functions/v1/mcp-server`.
  Keep 54321/54322 (API/Postgres) and 54323 (Studio) internal. (Single-origin
  mode landed 2026-08-24 after a live find: home/mobile networks commonly
  filter nonstandard outbound ports; enterprise proxies want 80/443 anyway.)
- **Logs:** `supabase functions logs` / `docker logs nodespec-frontend`.

## Doctrine notes (what this artifact is and isn't)

- Config, never a branch: the ONE deployment-mode flag is
  `NODESPEC_DEPLOYMENT=self-hosted`. There is no self-host fork to drift.
- The bundle carries no migration history, no git history, no bench fixtures,
  and no NodeSpec secrets — the leak-gate CI refuses to build otherwise.
- Code-level divergence per customer is declined by doctrine; deployment
  configuration is the customization surface.
