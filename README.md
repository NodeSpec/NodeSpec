# NodeSpec Community Edition

**Spec-driven development with an evidence loop — architecture your AI agents
can read, write, and prove things against.**

NodeSpec turns a product spec into a living architecture: requirements map to
nodes on a canvas, contracts define every interaction, tests bind to
acceptance criteria, and the whole model is served to AI agents over
[MCP](https://modelcontextprotocol.io) — 30 tools that let your assistant
read the spec, propose architecture as reviewable patches, and report test
evidence back into the model. You review and approve in the app; the agent
does the legwork; the evidence trail shows what's actually proven.

This repository is the **complete self-host container** under Apache-2.0:
frontend, single-origin gateway, Postgres schema, auth, realtime, storage,
edge functions, the full MCP server, the evidence pipeline, gitops, and a
curated starter technology catalog. One VM, one bootstrap script, unlimited
projects.

## Quick start

Prerequisites: Docker + the Supabase CLI (pinned install steps, checksums
included, in [`deploy/selfhost/README.md`](deploy/selfhost/README.md)).

```bash
cp deploy/selfhost/selfhost.env.example deploy/selfhost/selfhost.env
# edit selfhost.env — the file documents every value; three are required
bash deploy/selfhost/bootstrap.sh
```

Then open the address you configured, create an account, and point your AI
tool at `http(s)://<your-host>/functions/v1/mcp-server`. The deploy guide
covers TLS, backups, user administration, and running behind CloudFront or a
reverse proxy.

## What's in the box

- **Architecture Canvas** — containers, nodes, edges, contracts; every edge
  carries a contract, every contract can carry a schema.
- **Specification engine** — requirements with acceptance criteria, mapped to
  the nodes that implement them; a Work Board that derives status from
  evidence, never from vibes.
- **MCP server (30 tools)** — projects, requirements, architecture proposals,
  task-doc and test-plan generation, build-readiness preflight, test-result
  reporting with binding evidence.
- **Gitops** — connect a repo, push/pull, webhook change cards, assign files
  to nodes, git-provenance on completed work.
- **Starter technology catalog** — curated, full-depth entries for the
  technologies most projects touch; add your own freely.

## Editions

| | Community (this repo) | Hosted (nodespec.io) | Enterprise |
|---|---|---|---|
| Where it runs | Your infrastructure | Managed | Your infrastructure |
| Projects | Unlimited | 1 free · unlimited on Indie ($15/mo) | Unlimited |
| Repo-import reverse visualization | — | Indie and above | Included |
| Full enriched catalog (800+) | Starter set | Continuously updated | Included |
| Team integrations (Slack/Jira, as they land) | — | Team ($60/user/mo) | Custom |
| Support | Community | Included | Contract |

The community edition is a build product of the same monorepo as the hosted
service — not a fork, and not a crippled demo. It runs the same schema, the
same MCP server, and the same evidence loop.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off; PRs are applied to the
monorepo and land in the next export). Security reports: [SECURITY.md](SECURITY.md).

## License

Apache-2.0 — see [LICENSE](LICENSE). "NodeSpec" and the NodeSpec logo are
trademarks; see [NOTICE](NOTICE).
