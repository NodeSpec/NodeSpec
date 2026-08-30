# NodeSpec Community Edition

NodeSpec is a visual specification and architecture tool for software built
with AI assistants. You design the system on a canvas, attach requirements and
acceptance criteria, and connect the AI you already use. Your assistant reads
the spec over [MCP](https://modelcontextprotocol.io), proposes architecture
changes as patches you review in the app, and reports test results back as
evidence. Acceptance criteria only count as met when evidence says so.

NodeSpec runs no model of its own. It stores the plan, serves each task's
context to your AI, and keeps the evidence trail.

This repository is the complete self-host package under Apache-2.0: frontend,
Postgres schema, auth, edge functions, the MCP server, git integration, and a
starter technology catalog. It runs on one machine with Docker, works fully
offline, and has no project limit.

## Prerequisites

- Docker Engine or Docker Desktop, running
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Git
- Roughly 10 GB of free disk for container images, and 8 GB of RAM

The bootstrap script is a bash script. On Linux and macOS, run it in your
normal shell. On Windows, run everything inside WSL2 or a Linux container
under Docker Desktop.

## Install

Clone the repository and create your configuration file:

```bash
git clone https://github.com/NodeSpec/NodeSpec.git
cd NodeSpec
cp deploy/selfhost/selfhost.env.example deploy/selfhost/selfhost.env
```

Open `deploy/selfhost/selfhost.env` in an editor. The file documents every
value, and the defaults are set up for a local install. One value is required:
set `ENCRYPTION_SECRET` to a long random string, for example the output of

```bash
openssl rand -base64 32
```

Set it once and back it up. It encrypts the credentials you store in the app
(git tokens, AI keys), and changing it later makes those unreadable.

Then boot the stack:

```bash
bash deploy/selfhost/bootstrap.sh
```

The first run downloads the Supabase images, which takes several minutes.
When the script prints `done`, open http://localhost (or the
`PUBLIC_APP_URL` you configured) and create your account. To grant that
account the admin role, follow the "First admin" section of
[`deploy/selfhost/README.md`](deploy/selfhost/README.md). The same guide
covers TLS, backups, user administration, and running behind a reverse proxy
or CloudFront.

## Connect your AI

Click the "MCP disconnected" button in the app header. It shows tested
instructions for Claude Desktop, Claude Code, Cursor, OpenAI Codex, VS Code,
and other MCP clients. The server URL is always
`http(s)://<your-host>/functions/v1/mcp-server`.

Two behaviors are specific to a local install:

- With `MCP_LOCAL_TRUST=true` (the default in the example configuration), a
  single-user install skips the browser sign-in when an AI connects. This
  stands down automatically once a second account exists or the account
  enrolls two-factor auth. Set it to `false` before exposing the deployment
  beyond your own machine.
- Some clients refuse plain-HTTP server URLs. For those, the in-app guide
  shows a small bridge configuration (`mcp-remote`) that works without TLS.
  Putting HTTPS in front of the container removes the need for the bridge.

## Update

```bash
git pull
bash deploy/selfhost/bootstrap.sh
```

The bootstrap script is idempotent. It never resets an existing database, and
new schema migrations are applied by the Supabase CLI. Back up before major
updates; the deploy guide shows how.

## Editions

The community edition is a build product of the same monorepo as the hosted
service. It runs the same schema, the same MCP server, and the same evidence
loop. The hosted and enterprise editions add repository import (reverse
visualization of an existing codebase), the continuously updated full
technology catalog, team features, and support. Current plans and pricing:
[nodespec.io/pricing](https://nodespec.io/pricing).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions use DCO sign-off, are
applied to the monorepo, and land here in the next export. Security reports:
[SECURITY.md](SECURITY.md).

## License

Apache-2.0, see [LICENSE](LICENSE). "NodeSpec" and the NodeSpec logo are
trademarks; see [NOTICE](NOTICE).
