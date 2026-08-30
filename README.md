# NodeSpec Community Edition

NodeSpec is a visual specification and architecture tool for software built
with AI assistants. 

It is an extension of your AI coding harness via Model Context Protocol (MCP) so that you can build requirements, acceptance, architecture, tasks, tests, and code in an iterative manner while still governing your core design. 

NodeSpec never runs a model of its own. It is a deterministic server that allows you to extend the intelligence of your AI to the context necessary, while also providing modular context exports via your nodes if you are running multi-developer or agentic workflows.

**[nodespec.io](https://nodespec.io)**

---

## The problem it solves

AI coding assistants are fast and the frontier models have become extremely powerful with reasoning ability. All advancements considers, the tendency for sprawl
with a vague prompt and a large codebase requires tool calls and reasoning over inefficiently structured repository references. While repos are great for multiple functions, quick and efficient context to either a human or agent becomes
magnitudes easier and less costly when structured in necessary bounded context. In parallel, the user needs to know what is being built and why, or in more complex case, pass off to another developer. As a result, current SDD tools have limitation as nothing more than a set of structured markdown instructions. NodeSpec seeks to blend context management with a living graph of system design memory that is called when necessary, as well as loosely coupled from a user's iteration so that your AI or developers can still commit to Git while seeing and approving what goes where.

NodeSpec is architected to blend Specification Driven Development (SDD) with initial software architectural design and fast iterative development at the core of the user's GitOps workflow. The context size tradeoff happens at the beginning when NodeSpec provides your AI with necessary project context, but then can efficiently export necessary nodes and interfaces only for that specific functionality.


As a Design Governance Platform, the system will:

- **Faster Requirement View and Approval**: Allow you to faster generate and see requirements or "Vibe Require"
- **Greenfield and Brownfield Workflows**: Initial projects start as Vision -> Requirements -> Acceptance Criteria -> Architecture -> Tasks Per Architecture Node with Interface Recognition -> Test-Plans -> Code -> Triage Back Upstream. If importing an existing repo, the Community Edition allows you to assign existing code to your canvas. If using our hosted or enterprise versions, NodeSpec comes with a reverse engineering repo import. Both workflows commit NodeSpec's model.json as the source of reference.
- **Test Driven Methology**: Just enough test driven development (TDD) practices to ensure that if your model or separate test bench accomplishes 
- **No invented interfaces.** When a contract has no schema, NodeSpec says so and
  names the resolution path. Missing is marked missing, never filled in with a
  guess.
- **No unearned completions.** An acceptance criterion flips to met only when
  test results are reported through a verified lane, with provenance. Saying it
  works is not evidence.
- **Nothing trapped in a vendor database.** The model, the task briefs, and the
  test plans commit to *your* repository as reviewable files.
- **Living Canvas with Instruction Logic**- Instead of a static architecture diagram, NodeSpec creates a human-viewable and machine-readable canvas that is contextually built around each platform, technology, or framework. For example, an AWS-specific node comes with detailed instruction logic so that an AI can properly configure it either with automated reasoning or user-defined inputs.

---
## Application Workflow
**Three Primary Views**
- Specification View
<img width="1655" height="715" alt="image" src="https://github.com/user-attachments/assets/607cb0a5-2b8c-48d0-a1d1-91b05da55718" />
<img width="1915" height="932" alt="image" src="https://github.com/user-attachments/assets/357a1221-f5e8-43c3-87a1-a8a3eba27c36" />

Includes a traditional markdown view for copy/paste/export that auto-updates as requirements, architecture, tasks and tests are implemented or modified, as well as an easy-to-read board


- Requirement View
<img width="1906" height="932" alt="image" src="https://github.com/user-attachments/assets/c1908172-225f-47b9-8af5-586c9acd53b8" />
Provides a CRUD-style interface for Requirement modification, tracing, archiving, and status. Lock or unlock to prevent your AI from modifying via the MCP connection, and request audit runs while seeing any automated tests mark your initial test plans, tasks, and upstream to your acceptance criteria. Filter for easy viewing, and auto-detection of changes render testing stale to ensure the user is implementing regression tests against previously passed test parameters.

-Architecture View
<img width="1913" height="963" alt="image" src="https://github.com/user-attachments/assets/94083f64-d2b9-42c5-b55d-5fd0e17a7907" />
Human-consumable interface for seeing where your AI is organizing your services and how logic relates. This can be at any level of abstraction of a system, where a node can be at smaller level, object, or encompassing an entire service and/or platform. Each node individually exports with it's necessary context file should the user connect multiple development agents or human teams. There is nothing proprietary in the export, and is relational structure of JSON for a machine to import.



## Core concepts

Five ideas carry the whole model. Everything else is built from them.
<img width="1894" height="918" alt="image" src="https://github.com/user-attachments/assets/af11cb67-2f0e-4a11-8e12-00bd038fc610" />

### Node

A component of your system: a service, a database, a queue, a frontend app, a
cloud platform, a logical boundary. Every node carries two separate facts:

- **Role** — what it *is* architecturally (`backend-service`, `database`,
  `frontend-app`, `message-broker`). The role determines the doctrine your AI
  receives, the ports the node exposes, and how it renders.
- **Technology** — what it is *built with* (PostgreSQL, FastAPI, Kotlin). The
  technology carries curated guidance: best practices, anti-patterns, security
  notes, setup checklists, and pointers to live documentation.

Keeping these apart is what lets NodeSpec say something useful about a service
whose technology you have not chosen yet — and lets you swap the technology
later without redrawing the architecture.

### Edge

A connection between two nodes. An edge is never just a line: every edge carries
a **contract**, and an edge without one is invalid by construction. This is the
rule that prevents the classic architecture-diagram failure, where arrows mean
whatever the reader assumes they mean.

### Contract

The interface between two components, described in four layers: its **kind**
(the wire shape — REST, GraphQL, gRPC, WebSocket, Kafka, SQL, and others), its
**interaction kind** (what the exchange *means* — request/response, publish,
subscribe, and so on), its **transport**, and its **schema** (inline or as a
referenced file).

The contract, not the counterparty's source code, is what your AI implements
against. When two components must agree, they agree on the contract — so the
interface exists in one place instead of being re-inferred on both sides and
drifting apart silently.

### Port

The named attachment point where an edge meets a node — inbound or outbound. A
port takes its meaning from the contract on its connected edge.

### Artifact

A file bound to a node: source, config, schema, or documentation. Bound files
are what make a node's implementation visible — to task briefs, to freshness
checks, and to drift detection when someone edits them outside NodeSpec.

**Underneath all of it: patches and branches.** Every change to the model is an
immutable, attributed patch — an audit trail you can replay, not a
last-write-wins document. Branches let you explore a direction without
disturbing shared work.

---

## The catalog
<img width="243" height="891" alt="image" src="https://github.com/user-attachments/assets/fe1d7e9c-2469-4b05-a382-de03252f9242" />

<img width="430" height="696" alt="image" src="https://github.com/user-attachments/assets/b94a187a-e3bf-4f07-83af-4b5e26182ae9" />

NodeSpec ships a curated catalog, not a free-text field.

- **87 architectural roles** across 14 categories: Services, Database,
  Networking, AI & ML, Messaging, Infrastructure, Platform, Automation,
  External, Observability, Hardware, Game Development, and Logical boundaries.
- **300+ technologies**, each carrying AI context written for the moment your
  assistant is about to use it: what it is good at, how it fails, the security
  posture it expects, its setup checklist, and where its real documentation
  lives.

Roles and technologies are bound by affinity, so the catalog knows a database
role pairs with PostgreSQL and not with a CDN. New roles and technologies are
added as catalog entries — your architecture is never limited to what fits a
fixed menu, and when nothing in the catalog matches, a generic role is the
honest answer rather than a wrong one.

---

## How your AI connects

NodeSpec exposes its project context to any assistant that speaks the Model
Context Protocol — Claude, Claude Code, Cursor, Windsurf, and others. Your AI
gets a focused toolset for reading architecture and requirements, proposing
changes, and reporting verified results.

Two guarantees matter here:

- **Everything is a proposal.** Your AI never writes directly to your
  architecture. Changes arrive as reviewable proposals you accept or reject. You can set auto approve but must have the application open.
- **Untrusted content is fenced.** Every user-authored field flowing back to
  your assistant — labels, descriptions, criteria, documents — is wrapped and
  marked as data, so text living in your project cannot issue instructions to
  the AI reading it.

---

## Skills

Skills teach an AI assistant *how to work with NodeSpec* before it makes a
single call — when to reach for it, what order the workflow runs in, and which
rules are non-negotiable.

**NodeSpec Core** (`nodespec-developer`) covers the
full working loop:

- Orienting on a project and reconciling any drift before building
- The preflight → clear blockers → implement → verify → close cycle
- Importing an existing repository and backfilling its requirements
- Routing rules for which questions the architecture answers and which the code
  answers
- The honesty rules — never invent a missing schema, never claim an untested
  criterion, never report a result you did not actually run

The deeper doctrine ships from the server itself, in the tool responses, so
guidance stays locked to the running version rather than drifting inside a file
that was installed months ago.

*Planned:* domain-specific skill packs layered on the core skill — cloud
platform conventions, data engineering, autonomy and robotics, and
language-specific practice — for teams that want house rules applied on top of
the standard loop.

---

## GitOps
<img width="703" height="512" alt="image" src="https://github.com/user-attachments/assets/676ab2b0-a5d3-43d6-9dd1-73b309c41a4d" />

NodeSpec is git-native. Your architecture is not a picture of your repository;
it lives *in* your repository.

- **The model commits to your repo.** The architecture, per-node task briefs, and
  per-requirement test plans are written into a `.nodespec/` directory as
  reviewable files that travel with the code.
- **Task briefs are documents, not prompts.** Each node gets a written brief —
  its responsibilities, configuration decisions, interface contracts, bound
  files, and the criteria it serves — that your AI reads directly from the repo.
- **Accepted changes push automatically.** When you accept a proposal, the
  regenerated model and documents flow back to the repo without a manual step.
- **Out-of-band edits are detected, not ignored.** When code changes outside the
  NodeSpec loop, the affected files are matched back to the nodes that own them
  and surfaced as change cards to accept, clean up, or dismiss. Renames and
  moves follow the file rather than orphaning its binding.
- **Documents stay fresh.** Task briefs and test plans are fingerprinted against
  their inputs, so a changed requirement or a newly defined schema marks the
  documents that depended on it and regenerates them.

The practical effect: your architecture cannot quietly diverge from your code,
because divergence itself becomes a reviewable item.

---

## Repository import (NodeSpec Paid Versions Only)

Already have a codebase? NodeSpec reverse-engineers it into a reviewable
architecture — deterministically, then with your AI's judgment on top.

You connect the repository and tell your assistant to run the import. From
there, one tool carries the whole flow:

1. **Analysis.** NodeSpec classifies every file, groups directories into
   candidate components, and decides each group's *frame* — whether it is what
   the repository is *about* (a first-class component) or configuration serving
   something else (which becomes files on the component it serves). Nothing is
   guessed: when the evidence is too close to call, the ambiguity is raised as a
   question rather than resolved silently.

2. **Evidence.** The analysis extracts what actually connects your components,
   across languages: package-level imports, declared HTTP routes against
   outbound HTTP clients, dependency manifests, and deployment surfaces —
   Dockerfiles, Compose services, Kubernetes manifests, Helm charts, desktop
   installers, and mobile app manifests. Deployment config binds to the
   component it deploys instead of floating as a mystery node.

3. **Review.** Your AI receives the complete draft in one response — components,
   connections, contracts, the evidence behind each, and the open questions —
   and applies judgment: renaming vague labels, correcting roles, tagging
   technologies, adding relationships it can cite evidence for, and dropping
   what does not belong. It never has to fetch your repository to do this.

4. **Acceptance.** The result arrives as a single proposal you review and apply
   — all of it, or just the parts you want.

5. **Backfill.** An imported architecture has structure but no intent, so the
   loop continues: your AI asks for your product vision in *your* words, then
   proposes requirements and maps them to components until every node is
   covered. Acceptance criteria start unmet — existing code proves nothing until
   it is tested.

A repository already authored by NodeSpec is never re-inferred. Its model is
adopted from the repo, and later changes arrive through drift detection instead.

---

## Requirements and traceability

Requirements are first-class, not comments on a diagram.

- Requirements carry **acceptance criteria** — the specific, checkable
  statements that define done.
- Requirements **map to nodes**, so every component knows what it must satisfy
  and every requirement knows who serves it.
- Requirements **relate to each other** — expands, depends on, relates to — so
  the effect of a change is visible.
- **Test plans are generated per requirement** from its criteria, and results
  reported back flip criteria to met with provenance attached. Criteria that
  require human judgment take a separate approval lane and can never be flipped
  by an automated report.
- **Build readiness** is a preflight, not a guess: before your AI writes code,
  NodeSpec reports what would block it — an undefined schema, an unmapped
  requirement, a missing document — and names the fix for each.

---

## Templates

Pre-built architecture blueprints get a project started with real topology,
contracts, and requirements already in place — including full-stack cloud
applications, a modern SaaS stack, and an AI retrieval pipeline. Browse them at
[nodespec.io/templates](https://nodespec.io/templates).

---

## Editions

| Edition | For |
|---|---|
| **Community** | Free open source download or 2 project limit on web version, every feature, up to 3 projects, no credit card. Your AI does the building over MCP. |
| **Indie**| Unlimited Projects, Repo Import for faster brownfield development
| **Team** | Multi-developer use-cases with JIRA and Slack integration
| **Enterprise** | Custom user counts, deployment model, model connectivity, and support. |
| **Government** | Compliant cloud enclaves, government-specific catalog additions, a compliance package builder, and open-weight model support. |

See [nodespec.io/pricing](https://nodespec.io/pricing) for current details.

---

## Links

- **Web app** — [nodespec.io](https://nodespec.io)
- **Templates** — [nodespec.io/templates](https://nodespec.io/templates)
- **Connecting your AI** — [nodespec.io/docs/mcp](https://nodespec.io/docs/mcp)
- **Government** — [nodespec.io/government](https://nodespec.io/government)
- **Blog** — [nodespec.io/blog](https://nodespec.io/blog)

---

*Contributing to NodeSpec itself? See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).*

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
