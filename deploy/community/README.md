# NodeSpec Community — Docker install

The Docker-only way to run NodeSpec. Works the same on Windows, macOS, and
Linux; nothing is required beyond Docker itself. No Supabase CLI, no WSL,
no shell scripts.

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine with the compose plugin
  (Linux), running
- Roughly 10 GB of free disk for container images, 8 GB of RAM

## Start

From this directory (`deploy/community`):

1. Copy the configuration file and set the one required value.

   Windows PowerShell:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   macOS/Linux:
   ```bash
   cp .env.example .env
   ```

   In `.env`, set `ENCRYPTION_SECRET` to any long random string (for
   example the output of `openssl rand -base64 32`, or any 40+ random
   characters). Set it once and back it up.

2. Start the stack:
   ```
   docker compose up -d
   ```
   The first run downloads several gigabytes of images and takes a few
   minutes. `docker compose ps` shows progress; everything except
   `db-init` (which runs once and exits) should reach "running".

3. Open http://localhost and create your account. Accounts confirm
   instantly on a local install (no e-mail round-trip).

4. Connect your AI: click "MCP disconnected" in the app header and follow
   the instructions for your client. On a default local install the
   connection approves itself with no sign-in page.

## Everyday commands

```
docker compose ps            # status
docker compose logs -f       # logs (add a service name to narrow)
docker compose down          # stop (data volumes survive)
docker compose up -d         # start again / apply .env changes
docker compose down -v       # DESTROY: stop AND delete all data
```

## Update

```
git pull
docker compose up -d --build
```

The database volume survives updates; `db-init` never touches an
initialized database.

## First admin

Your first account works fully without admin rights. To promote it, run
the promotion statement from `deploy/selfhost/sql/first-admin.sql` against
the database:

```
docker compose exec db psql -U postgres -d postgres
```

## Going beyond localhost

The default `.env` uses the public Supabase demo secrets — safe on your
own machine, an open door on a network. Before exposing this deployment:

1. Generate a fresh `POSTGRES_PASSWORD`, `JWT_SECRET`, and
   `SECRET_KEY_BASE`, and mint an `ANON_KEY` / `SERVICE_ROLE_KEY` pair
   signed by your new `JWT_SECRET` (the Supabase self-hosting docs provide
   a generator: https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys).
2. Set `MCP_LOCAL_TRUST=false` and a real `TURNSTILE_SITE_KEY`.
3. Update `SITE_URL` (and `FRONTEND_PORT`) to the address users will reach,
   put TLS in front, then `docker compose up -d --build` (the frontend
   bakes `SITE_URL` at build time).
4. Note: changing `JWT_SECRET` or `POSTGRES_PASSWORD` after first boot
   requires re-initializing (`docker compose down -v`) or manually
   updating role passwords — do it before inviting users.

Password-recovery e-mails need real SMTP; add `GOTRUE_SMTP_*` variables to
the `auth` service if you need them (accounts autoconfirm locally, so
day-one use never depends on e-mail).

## From source instead

Developers who want to build and hack on NodeSpec itself can use the
Supabase-CLI flow in `deploy/selfhost/` — that path requires a Linux shell
and the Supabase CLI, and is not needed just to run the product.
