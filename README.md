# NodeSpec

**Design Smarter. Builder Better. Ship Faster.**

NodeSpec is an AI architecture governance and specification driven development platform. It is designed to assist individuals, businesses, or Government entities with new system builds or refine existing systems via a sidecar service that natively integrates to the user's AI-of-choice over Model Context Protocol (MCP) interface.

**[nodespec.io](https://nodespec.io)**\

---

## The problem it solves

AI coding assistants are fast and fluent, and that is exactly the problem. Given
a vague prompt and a large codebase, they invent interfaces that exist nowhere,
re-derive decisions you already made, drift away from the design in your head,
and report work as finished without proving it. The output looks plausible.
Reviewing it costs more than writing it would have. 

NodeSpec inherently solves a core problem of nonlinear development merging requirement definition with architecture and quality exportable code.  With frontier and open-weight models, it is possible for users to solve a portion of these issues inherently through agentic workflows, but this relegates the user to markdown management/review, loss of context via chat-pane-only text threads, and stale references.Existing specification driven development workflows primarily consist of various markdown and skills, and do not bridge disciplines of quality software engineering practice when paired with AI. Historically, users, architects, and developers implemented separate disciplines that required contextual understanding, endless meetings, powerpoint, etc within enterprises and small business operations. NodeSpec provides an intuitive canvas for both a human and an Agent via a .json model to understand the structure of a system, modular context of key components of logic, integrations and contracts between system logic, and the ability to export the system into discreet sets of tasks and integrated test plans. All of this is looped into the user's native gitops workflow, with the NodeSpec model.json consistently updating upon a commit into the related git branch.


NodeSpec keeps that account, and hands your AI the slice of it that matters for
the task at hand:

- **No token-stuffed dumps.** Focus your AI or dev team via our Team version on a specific module and node, it's related code artifacts, necessary integration logic, and deployment needs.
- **No invented interfaces.** When a contract has no schema, NodeSpec says so and
  names the resolution path. Missing is marked missing, never filled in with a
  guess.
- **No unearned completions.** An acceptance criterion flips to met only when
  test results are reported through the user's confirmation or for more powerful frontier models, confirmation of internal automated tests with provenance.
  
- **Git Native** The NodeSpec model.json commits to your git as NodeSpec's reference. Upon commits either from NodeSpec or out-of-band to the user's repo, a webhook detects a change and requests the user to reconcile where that commit's artifact changes reside..

<img width="3806" height="2083" alt="image" src="https://github.com/user-attachments/assets/ebbd7e89-ed27-42dc-969e-20dba35e4dc2" />

**MCP-Native and Headless with User's AI of Choice**

<img width="3828" height="1955" alt="image" src="https://github.com/user-attachments/assets/db6a0e8a-caf1-4c70-8c35-b8bb36af0cc7" />

**Specification Markdown Canvas**

<img width="3824" height="1951" alt="image" src="https://github.com/user-attachments/assets/14703fb8-64f3-446a-b4fc-67acc75dd83d" />

**Decomposition Canvas**

<img width="3824" height="1957" alt="image" src="https://github.com/user-attachments/assets/8603e9c3-62f9-4e61-a754-2c8213761015" />

**Architecture Canvas**

## Core concepts

Five ideas carry the whole model. Everything else is built from them.

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

NodeSpec ships a curated catalog, not a free-text field.

- **85+ architectural roles** across 14 categories: Services, Database,
  Networking, AI & ML, Messaging, Infrastructure, Platform, Automation,
  External, Observability, Hardware, Game Development, and Logical boundaries.
- **300+ technologies**, each carrying AI context written for the moment your
  assistant is about to use it: what it is good at, how it fails, the security
  posture it expects, its setup checklist, and where its real documentation
  lives.

Roles and technologies are bound by affinity, so the catalog knows a database
role pairs with PostgreSQL and not with a CDN. New roles and technologies are
added as catalog entries. Your architecture is never limited to what fits a
fixed menu, and when nothing in the catalog matches, a generic role is the
honest answer rather than a wrong one.

---

## How your AI connects

NodeSpec exposes its project context to any assistant that integrates via the Model
Context Protocol (MCP): Claude, Claude Code, OpenAI Codex, Cursor, Windsurf, and others. Your AI
gets a focused toolset for reading architecture and requirements, proposing
changes, and reporting verified results.

Two guarantees matter here:

- **Everything is a proposal.** Your AI never writes directly to your
  architecture. Changes arrive as reviewable proposals you accept or reject.
- **Untrusted content is fenced.** Every user-authored field flowing back to
  your assistant — labels, descriptions, criteria, documents — is wrapped and
  marked as data, so text living in your project cannot issue instructions to
  the AI reading it.

---

## Skills

Skills teach an AI assistant *how to work with NodeSpec* before it makes a
single call: when to reach for it, what order the workflow runs in, and which
rules are non-negotiable.

**NodeSpec Core** is the one to attach. It covers the
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

NodeSpec is git-native. Your architecture is not a picture of your repository;
it lives *in* your repository.

- **The model commits to your repo.** The architecture, per-node task briefs, and
  per-requirement test plans are written into a `.nodespec/` directory as
  reviewable files that travel with the code.
- **Task briefs are documents, not prompts.** Each node gets a written contextual task per the technology being implemented:
  its responsibilities, configuration decisions, interface contracts, bound
  files, and the criteria it serves
- **Accepted changes push automatically.** When you accept a proposal, the
  regenerated model and documents flow back to the repo without a manual step.
- **Out-of-band edits are detected, not ignored.** When code changes outside the
  NodeSpec loop, the affected files are matched back to the nodes that own them
  and surfaced as change cards to accept, clean up, or dismiss. Renames and
  moves follow the file rather than orphaning its binding.
- **Documents stay fresh.** Task docs and test plans are fingerprinted against
  their inputs, so a changed requirement or a newly defined schema marks the
  documents that depended on it and regenerates them.

The practical effect: your architecture cannot quietly diverge from your code,
because divergence itself becomes a reviewable item.

---

## Repository import

Already have a codebase? NodeSpec reverse-engineers it into a reviewable
architecture via a deterministic workflow followed by your AI's reasoning.

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

5. **Backfill.** An imported architecture has structure but can consistently have poorly documented intent, so the
   loop continues: your AI asks for your product vision in *your* words or will read the existing readme, then
   proposes requirements and maps them to components until every node is
   covered. Acceptance criteria start unmet so that existing code proves nothing until
   it is tested. This allows for users to begin the existing scaffold to a regression test bench prior to committing major changes to an existing fork. This does not gate the user, but is highly recommended as an initial time investment for scalable systems.

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
| **Community** | Free on the web app, every feature, up to 3 projects, no credit card. Your AI does the building over MCP. |
| **Team** | Self-hosted in your own environment: unlimited projects, multiple users, your data residency. |
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
