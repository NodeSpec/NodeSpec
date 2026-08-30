# NodeSpec Community Edition

**Design Smarter. Build Better. Ship Faster**

NodeSpec Community is an open source, visual specification and software architecture platform built for AI-assisted development.

It connects to your existing AI coding assistant through the **Model Context Protocol (MCP)** and gives it structured access to your product requirements, acceptance criteria, architecture, interfaces, implementation tasks, test plans, and verified results.

NodeSpec does **not** run or require its own AI model.

Your AI remains the reasoning and coding engine. NodeSpec provides the structured system context, workflow, governance, and evidence layer around it.

**[nodespec.io](https://nodespec.io)**

---

## Why NodeSpec

Modern AI coding assistants can write code extremely well, but creates a secondary source of issues: system alignment, recall, and human and agent governance and awareness of what is being built or why.

A large repository forces an assistant to repeatedly inspect files, reconstruct architecture, infer interfaces, rediscover requirements, and reason about decisions that may exist only implicitly in the code.

In multi-agent development workflows, each agent has to know what the source of the design is, otherwise the user incurs potentially catastrophic drift.

We decided to approach the problem differently.

Instead of treating the repository as the only source of system context, NodeSpec maintains a **living model of the software system** alongside the code.

That model captures:

* What the system must do
* What "done" means
* Which components are responsible for each requirement
* How those components communicate
* Which files implement each component
* What work remains
* What must be tested
* What has actually been verified

Your AI can query that model through MCP and receive the **smallest useful slice of context for the work it is performing**.

The result is a workflow that combines:

**Specification Driven Development + Architecture + AI Context Management + GitOps + Verification**

without replacing your IDE, repository, AI assistant, or development workflow.

---

# The NodeSpec Workflow

NodeSpec supports both greenfield and brownfield development.

### Greenfield

```text
Vision
  ↓
Requirements
  ↓
Acceptance Criteria
  ↓
Architecture
  ↓
Interfaces / Contracts
  ↓
Tasks by Architecture Node
  ↓
Test Plans
  ↓
Implementation
  ↓
Verification
  ↓
Update the System Model
```

### Brownfield

```text
Existing Repository
  ↓
Analyze Structure
  ↓
Reconstruct Architecture
  ↓
Review Evidence
  ↓
Accept / Correct the Model
  ↓
Backfill Requirements
  ↓
Map Requirements to Components
  ↓
Test Existing Behavior
  ↓
Continue Development
```

Both workflows converge on the same system model.

That model is stored in the repository and becomes the shared reference point for developers, AI agents, architecture, requirements, and verification.

---

# What NodeSpec Changes About AI Development

## Give AI Bounded Context Instead of the Whole Repository

NodeSpec models a system as interconnected architectural nodes.

A node might represent:

* a backend service
* a frontend application
* a database
* a queue
* a cloud service
* an AI component
* a deployment platform
* a logical subsystem

Each node carries the context necessary to understand and modify that part of the system.

Instead of asking an AI assistant to repeatedly reconstruct the entire codebase, NodeSpec can provide the relevant:

* responsibilities
* requirements
* acceptance criteria
* technology guidance
* interfaces
* bound files
* implementation tasks
* test plans

for the component currently being changed.

This becomes especially useful when multiple developers or agents are working against the same system.

---

## Make Architecture Machine-Readable

Most architecture diagrams are pictures.

Humans interpret the boxes and arrows. Machines cannot reliably determine what those arrows actually mean.

NodeSpec treats architecture as structured data.

A connection between two components is not simply a line. It carries an explicit **contract** describing the interaction.

That means an AI does not need to infer whether an arrow represents REST, SQL, Kafka, gRPC, WebSocket, or something else.

The interface is part of the model.

---

## Keep Humans in Control of System Design

AI-generated architectural changes are proposals.

They do not silently become part of the system model.

Your assistant can:

1. Inspect the system
2. Identify a needed change
3. Propose the change
4. Explain why it is needed
5. Submit it for review

You can then accept or reject it.

Auto-approval can also be enabled while the NodeSpec application is open.

---

## Require Evidence Before Declaring Work Complete

NodeSpec separates **implementation claims** from **verified results**.

An acceptance criterion does not become complete simply because an AI says the implementation works.

Automated criteria require reported test evidence through a verified execution path.

Human judgment criteria use a separate approval path.

If the evidence is missing, the criterion remains unmet.

---

## Keep the Architecture With the Code

NodeSpec is Git-native.

The architecture model, task briefs, and test plans are written into your repository under:

```text
.nodespec/
```

They are normal reviewable files.

They can be:

* committed
* diffed
* branched
* reviewed
* versioned
* consumed by humans
* consumed by AI agents

Your system model is not trapped inside a vendor database.

---

# Application Workflow

NodeSpec currently centers around three primary views.

## 1. Specification View

<img width="1655" height="715" alt="NodeSpec specification view" src="https://github.com/user-attachments/assets/607cb0a5-2b8c-48d0-a1d1-91b05da55718" />

<img width="1915" height="932" alt="NodeSpec specification board" src="https://github.com/user-attachments/assets/357a1221-f5e8-43c3-87a1-a8a3eba27c36" />

The Specification View gives you two ways to work with the evolving system specification.

### Document View

A traditional Markdown-style specification that updates as requirements, architecture, tasks, and tests change.

Use it when you want to:

* read the system as a document
* copy or export specification content
* review the complete product definition
* provide structured context outside NodeSpec

### Board View

A faster visual interface for working with individual specification objects and their relationships.

The document and board represent the same underlying system model.

---

## 2. Requirement View

<img width="1906" height="932" alt="NodeSpec requirement view" src="https://github.com/user-attachments/assets/c1908172-225f-47b9-8af5-586c9acd53b8" />

Requirements are first-class system objects rather than comments attached to a diagram.

From the Requirement View you can:

* create and modify requirements
* define acceptance criteria
* map requirements to architecture nodes
* trace implementation responsibility
* archive requirements
* lock requirements against AI modification
* request audit runs
* inspect test status
* track completion
* identify stale verification after upstream changes

If a requirement or dependency changes after a test has passed, NodeSpec can mark the affected verification as stale.

Passing a test once does not mean the result remains valid forever.

---

## 3. Architecture View

<img width="1913" height="963" alt="NodeSpec architecture view" src="https://github.com/user-attachments/assets/94083f64-d2b9-42c5-b55d-5fd0e17a7907" />

The Architecture View provides a human-readable representation of the same architecture your AI operates against.

You decide the level of abstraction.

A node can represent:

* a small logical component
* an object or module
* a microservice
* an application
* an infrastructure service
* an entire platform

Each node can export its own context package for use by another developer or AI agent.

The export is structured JSON and supporting documents, not a proprietary binary format.

This allows teams and agents to work on individual components without requiring the entire repository to be loaded into context.

---

# Core Concepts

Five objects form the foundation of the NodeSpec architecture model.

<img width="1894" height="918" alt="NodeSpec core concepts" src="https://github.com/user-attachments/assets/af11cb67-2f0e-4a11-8e12-00bd038fc610" />

## Node

A **Node** represents a component of the system.

Examples include:

* backend service
* database
* message broker
* frontend application
* cloud platform
* AI service
* infrastructure component
* logical boundary

Every node separates two important concepts:

### Role

What the component **is architecturally**.

Examples:

```text
backend-service
database
frontend-app
message-broker
```

The role determines:

* architectural behavior
* available ports
* applicable guidance
* how the component renders

### Technology

What the component is **implemented with**.

Examples:

```text
PostgreSQL
FastAPI
Kotlin
Redis
AWS Lambda
React
```

Technology definitions can include:

* implementation guidance
* best practices
* anti-patterns
* security considerations
* setup checklists
* documentation references

Separating role from technology allows a system to be designed before every implementation decision has been made.

It also lets you change technologies without having to redesign the logical architecture.

---

## Edge

An **Edge** connects two nodes.

But an edge is not simply a visual arrow.

Every edge carries a contract.

An edge without a defined contract is considered incomplete.

This prevents one of the most common problems with architecture diagrams: arrows whose meaning exists only in the author's head.

---

## Contract

A **Contract** defines how two components interact.

Contracts describe four primary dimensions:

### Kind

The interface or protocol shape.

Examples:

* REST
* GraphQL
* gRPC
* WebSocket
* Kafka
* SQL

### Interaction

What the exchange does.

Examples:

* request / response
* publish
* subscribe
* stream
* query

### Transport

How the interaction moves between components.

### Schema

The structure of the exchanged data, defined either inline or through a referenced file.

The contract becomes the implementation boundary.

Your AI should implement against the contract rather than attempting to infer behavior from another component's source code.

When two components need to agree, they agree on the contract.

---

## Port

A **Port** is the named attachment point where an edge connects to a node.

Ports may be inbound or outbound.

Their meaning comes from the contract associated with the connected edge.

---

## Artifact

An **Artifact** is a file associated with a node.

Examples include:

* source files
* configuration
* schemas
* infrastructure definitions
* documentation

Artifact bindings connect the architecture model back to the actual repository.

They are also used for:

* task context
* change detection
* freshness checks
* drift detection

---

## Patches and Branches

Changes to the NodeSpec model are represented as attributed patches.

This creates an auditable history of how the architecture changes over time rather than relying on a single last-write-wins document.

Branches allow alternate architectural directions to be explored without immediately modifying shared work.

---

# Architecture Catalog

<img width="243" height="891" alt="NodeSpec architecture catalog" src="https://github.com/user-attachments/assets/fe1d7e9c-2469-4b05-a382-de03252f9242" />

<img width="430" height="696" alt="NodeSpec technology catalog" src="https://github.com/user-attachments/assets/b94a187a-e3bf-4f07-83af-4b5e26182ae9" />

NodeSpec uses a curated architectural catalog rather than treating architecture as unrestricted free text.

The catalog currently includes:

* **87 architectural roles**
* **14 role categories**
* **300+ technologies**

Categories include:

* Services
* Databases
* Networking
* AI & ML
* Messaging
* Infrastructure
* Platforms
* Automation
* External Systems
* Observability
* Hardware
* Game Development
* Logical Boundaries

Technology entries can provide contextual guidance to an AI at the point where that technology is being used.

That context may include:

* intended use
* common failure modes
* security considerations
* implementation guidance
* setup steps
* official documentation

Roles and technologies are connected through affinity rules.

For example, NodeSpec understands that PostgreSQL is appropriate for a database role while a CDN is not.

The catalog does not limit the architecture to predefined components. Generic roles remain available when a specialized definition does not exist.

When NodeSpec does not know something, the goal is to represent that uncertainty rather than manufacture an answer.

---

# How Your AI Connects

NodeSpec exposes project context through the **Model Context Protocol (MCP)**.

Any compatible assistant can interact with it.

Examples include:

* Claude Desktop
* Claude Code
* Cursor
* Windsurf
* OpenAI Codex
* VS Code MCP clients
* other MCP-compatible tools

Your AI receives tools for:

* reading architecture
* inspecting requirements
* retrieving scoped project context
* identifying blockers
* proposing architectural changes
* working through implementation tasks
* reporting verification results

Two rules are particularly important.

## AI Changes Are Proposals

Your AI does not directly rewrite the architecture model.

Changes are submitted as proposals that can be reviewed and accepted or rejected.

Auto-approval is available when desired while the application is open.

## Project Content Is Treated as Data

User-authored content returned to an assistant, including labels, descriptions, criteria, and documents, is fenced and identified as project data.

This prevents text stored inside the project from being treated as NodeSpec instructions.

---

# Skills

NodeSpec skills teach an AI assistant how to use NodeSpec before it makes its first MCP call.

The core skill, `nodespec-developer`, covers the complete development loop:

```text
Orient
  ↓
Reconcile Drift
  ↓
Preflight
  ↓
Resolve Blockers
  ↓
Implement
  ↓
Verify
  ↓
Close
```

It also covers:

* importing existing repositories
* backfilling requirements
* determining when architecture should answer a question
* determining when source code should answer a question
* handling missing schemas
* handling unverified acceptance criteria
* reporting only tests that were actually executed

A critical design choice is that detailed doctrine is returned by the running NodeSpec server.

The skill teaches the assistant how to operate NodeSpec, while version-specific implementation guidance stays with the server.

This helps prevent local skill files from drifting away from the version of NodeSpec actually running.

### Planned Skill Packs

Future domain-specific packs may layer additional guidance on top of the core workflow, including:

* cloud architecture
* data engineering
* autonomy and robotics
* language-specific development
* organization-specific engineering practices

---

# GitOps

<img width="703" height="512" alt="NodeSpec GitOps workflow" src="https://github.com/user-attachments/assets/676ab2b0-a5d3-43d6-9dd1-73b309c41a4d" />

NodeSpec is Git-native.

Your architecture is not merely a visualization of your repository.

It lives with your repository.

## The Model Commits With the Code

NodeSpec writes architecture artifacts into:

```text
.nodespec/
```

This includes the system model, node-specific task briefs, and requirement-specific test plans.

These files can travel through the same:

* branches
* pull requests
* reviews
* commits
* CI workflows

as the code they describe.

## Task Briefs Are Durable Context

Tasks are exported as documents rather than transient prompts.

A node's task brief can include:

* responsibilities
* configuration decisions
* contracts
* bound files
* requirements
* acceptance criteria
* implementation context

An AI agent can read that brief directly from the repository.

## Accepted Changes Synchronize Back to Git

When a NodeSpec proposal is accepted, the relevant system documents can be regenerated and written back to the repository.

## Out-of-Band Changes Become Visible

Developers will not always work through NodeSpec.

That is expected.

When files change outside the NodeSpec workflow, those changes can be matched back to the architectural nodes that own them.

NodeSpec can then surface the change for review.

Files that move or are renamed can continue to retain their architectural relationship rather than becoming orphaned from the model.

## Generated Context Tracks Freshness

Task briefs and test plans are fingerprinted against the information used to generate them.

If an upstream requirement, contract, or architectural decision changes, dependent documents can be marked stale and regenerated.

The goal is simple:

**Architecture drift should become visible rather than silently accumulating.**

---

# Repository Import

> Repository import is available in paid NodeSpec editions.

Already have a codebase?

NodeSpec can reconstruct an initial architectural model from an existing repository.

The process combines deterministic repository analysis with judgment from your existing AI assistant.

```text
Repository
  ↓
Deterministic Analysis
  ↓
Evidence Extraction
  ↓
AI Review
  ↓
Human Acceptance
  ↓
Requirement Backfill
  ↓
Normal NodeSpec Workflow
```

## 1. Analyze

NodeSpec classifies files and groups repository structures into candidate components.

It determines whether a directory represents:

* a first-class architectural component
* configuration belonging to another component
* supporting files
* deployment infrastructure
* an ambiguous structure requiring review

When evidence is insufficient, ambiguity is surfaced rather than silently resolved.

## 2. Collect Evidence

NodeSpec looks for evidence describing the actual structure and connectivity of the repository.

This can include:

* package imports
* HTTP routes
* outbound HTTP clients
* dependency manifests
* Dockerfiles
* Docker Compose services
* Kubernetes manifests
* Helm charts
* desktop installers
* mobile application manifests

Deployment configuration is associated with the component it deploys rather than being automatically modeled as an independent service.

## 3. Review With Your AI

Your assistant receives the proposed architecture together with the evidence supporting it.

It can then:

* improve component names
* correct architectural roles
* identify technologies
* review relationships
* add supported connections
* remove incorrect components
* flag unresolved questions

The assistant does not need to independently crawl the repository to perform this architectural review.

## 4. Accept

The reconstructed architecture is returned as a proposal.

You decide what becomes part of the project model.

## 5. Backfill Intent

Existing code tells NodeSpec what exists.

It does not necessarily explain why it exists.

After the structural import, your AI can work with you to establish:

* product vision
* requirements
* acceptance criteria
* ownership by component

Existing code does not automatically satisfy an acceptance criterion.

The behavior must still be verified.

### Existing NodeSpec Repositories

If a repository already contains a NodeSpec model, NodeSpec does not attempt to infer the architecture again.

It adopts the existing model and uses drift detection for subsequent changes.

---

# Requirements and Traceability

Requirements are part of the system graph.

They are not notes attached to an architecture diagram.

Each requirement can contain explicit **acceptance criteria** defining what must be true before the requirement is considered complete.

Requirements can also:

* map to architecture nodes
* depend on other requirements
* expand other requirements
* relate to other requirements
* generate test plans
* track verification state
* identify stale evidence

This creates traceability across:

```text
Requirement
    ↓
Acceptance Criteria
    ↓
Architecture Node
    ↓
Implementation Task
    ↓
Files
    ↓
Test Plan
    ↓
Verification Evidence
```

## Build Readiness

Before implementation begins, NodeSpec can perform a preflight check.

Instead of simply telling an AI to "build it," NodeSpec can identify blockers such as:

* undefined interface schemas
* requirements that are not mapped
* missing documents
* incomplete architectural decisions
* unresolved dependencies

The assistant receives both the blocker and the expected resolution path.

---

# Design Rules

Several rules exist throughout the NodeSpec workflow.

### No Invented Interfaces

If a required interface schema does not exist, it is reported as missing.

NodeSpec does not manufacture one to make the architecture appear complete.

### No Unearned Completion

Acceptance criteria only become satisfied through their designated verification path.

A statement that something "works" is not evidence.

### No Hidden System Model

The architecture, task briefs, and test plans can live in the repository as inspectable files.

### Architecture and Implementation Remain Connected

Files can be bound to the components they implement.

Changes to those files can therefore be evaluated in architectural context.

### Humans Retain Architectural Authority

AI assistants can reason about the system and propose changes without silently changing the approved model.

---

# Templates

NodeSpec includes pre-built architecture templates that provide an initial topology, contracts, and requirements.

Example use cases include:

* full-stack cloud applications
* modern SaaS platforms
* AI retrieval systems

Browse templates at:

**[nodespec.io/templates](https://nodespec.io/templates)**

---

# Editions

| Edition        | Intended Use                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Community**  | Free, open source, self-hosted NodeSpec for individual development                                                 |
| **Indie**      | Unlimited projects and repository import for faster brownfield development                                         |
| **Team**       | Multi-developer workflows with integrations such as JIRA and Slack                                                 |
| **Enterprise** | Custom user counts, deployment models, model connectivity, and support                                             |
| **Government** | Government deployment options, specialized catalog extensions, compliance workflows, and open-weight model support |

See **[nodespec.io/pricing](https://nodespec.io/pricing)** for current hosted plans and commercial features.

---

# Install Community Edition

## Prerequisites

You will need:

* Docker Engine or Docker Desktop
* [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
* Git
* approximately 10 GB of free disk space only for initial Supabase install (the NodeSpec application is not this large)
* approximately 8 GB of RAM

The bootstrap process uses Bash.

On Linux and macOS, run it from your normal shell.

On Windows, use WSL2 or a Linux environment running through Docker Desktop.

---

## 1. Clone NodeSpec

```bash
git clone https://github.com/NodeSpec/NodeSpec.git
cd NodeSpec
```

---

## 2. Create Your Configuration

```bash
cp deploy/selfhost/selfhost.env.example deploy/selfhost/selfhost.env
```

Open:

```text
deploy/selfhost/selfhost.env
```

The file documents each available configuration value and includes defaults suitable for local development.

One value must be configured before startup:

```text
ENCRYPTION_SECRET
```

Generate one with:

```bash
openssl rand -base64 32
```

Set this value once and store it somewhere safe.

NodeSpec uses it to encrypt credentials stored by the application, including Git tokens and AI keys.

Changing the secret later will make previously encrypted values unreadable.

---

## 3. Start NodeSpec

```bash
bash deploy/selfhost/bootstrap.sh
```

The first startup downloads the required Supabase container images.

When the bootstrap process reports that startup is complete, open:

```text
http://localhost
```

or the `PUBLIC_APP_URL` configured in your environment file.

Create your account and follow the **First admin** instructions in:

[`deploy/selfhost/README.md`](deploy/selfhost/README.md)

The same deployment guide covers:

* TLS
* backups
* user administration
* reverse proxies
* CloudFront deployments

---

# Connect Your AI

Inside NodeSpec, click **MCP disconnected** in the application header.

The connection guide includes tested configuration instructions for clients including:

* Claude Desktop
* Claude Code
* Cursor
* OpenAI Codex
* VS Code
* other MCP-compatible clients

Your MCP server endpoint is:

```text
http(s)://<your-host>/functions/v1/mcp-server
```

## Local Trust

The example configuration defaults to:

```text
MCP_LOCAL_TRUST=true
```

For a single-user local installation, this allows an AI client to connect without requiring the browser authentication flow.

Local trust automatically disables when:

* a second user account exists
* the account enables two-factor authentication

Set:

```text
MCP_LOCAL_TRUST=false
```

before exposing the deployment outside your local machine.

## Clients That Require HTTPS

Some MCP clients will not connect directly to a plain HTTP endpoint.

For those clients, the NodeSpec connection guide provides an `mcp-remote` bridge configuration.

If HTTPS is configured in front of NodeSpec, the bridge is not required.

---

# Updating NodeSpec

Pull the latest version:

```bash
git pull
```

Then rerun the bootstrap:

```bash
bash deploy/selfhost/bootstrap.sh
```

The bootstrap script is idempotent.

It does not reset an existing database.

New schema migrations are applied through the Supabase CLI.

Back up your deployment before major upgrades. See the self-hosting deployment guide for backup procedures.

---

# Community and Commercial Editions

NodeSpec Community Edition is built from the same monorepo as the hosted NodeSpec platform.

The Community Edition uses the same underlying:

* data model
* MCP server architecture
* evidence workflow
* specification model

Commercial editions add capabilities such as:

* automated repository import
* reverse visualization of existing codebases
* the continuously updated full technology catalog
* multi-user workflows
* enterprise integrations
* deployment options
* support

See **[nodespec.io/pricing](https://nodespec.io/pricing)** for current details.

---

# Links

* **Web App:** [nodespec.io](https://nodespec.io)
* **Templates:** [nodespec.io/templates](https://nodespec.io/templates)
* **Connect Your AI:** [nodespec.io/docs/mcp](https://nodespec.io/docs/mcp)
* **Government:** [nodespec.io/government](https://nodespec.io/government)
* **Blog:** [nodespec.io/blog](https://nodespec.io/blog)

---

# Contributing

Contributions are welcome.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution requirements.

Contributions use DCO sign-off, are applied to the NodeSpec monorepo, and appear in the Community Edition through subsequent exports.

If you are contributing to NodeSpec itself, also see:

[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)

Security issues should be reported according to:

[`SECURITY.md`](SECURITY.md)

---

# License

NodeSpec Community Edition is licensed under the **Apache License 2.0**.

See [`LICENSE`](LICENSE).

"NodeSpec" and the NodeSpec logo are trademarks.

See [`NOTICE`](NOTICE).

This version should paste directly into GitHub without needing to strip formatting or convert anything.
