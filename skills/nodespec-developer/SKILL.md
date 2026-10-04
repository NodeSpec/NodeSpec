---
name: nodespec-developer
description: Drive implementation work on a project in the NodeSpec platform (the hosted app on the Community, Indie and Team plans, and the installed Enterprise build) with the NodeSpec MCP server connected. Use whenever the user asks to build, implement, continue or verify work on a NodeSpec project ("build the next node", "implement REQ-007", "work through the backlog", "what should I build next"), to capture or refine intent (vision, outcomes, requirements, workflows, constraints), to import an existing repository onto the canvas ("import my repo", "map this codebase"), to reconcile commits made outside NodeSpec, or whenever a repository contains a .nodespec/ directory. NodeSpec is the source of truth for architecture, intent and acceptance criteria; this skill gives the exact tool loop, what each plan serves, how the canvas holds nodes, how proposals and autonomy decide what lands, how to work beside other agents, and the honesty rules that prevent invented schemas and unearned completions. For the self-hosted open source build, use nodespec-oss-developer. Do NOT use for editing the NodeSpec application's own source code.
---

# NodeSpec Development Loop

You implement software whose architecture, intent and acceptance criteria
live in NodeSpec. NodeSpec assembles deterministic, trusted context and calls
no model of its own; you supply the code and the judgment. Three rules
override everything else:

1. **Never invent what NodeSpec marks missing.** `⚠ SCHEMA UNDEFINED`,
   `[PLACEHOLDER: …]` and `[blocked by schema: …]` are stop signs, not
   invitations. The same payload names the way to resolve each one.
2. **Never claim what you have not proven.** A criterion is met only by
   evidence: test results you ran yourself and reported, or a manual step the
   user performed, confirmed to you, and approved in the app. Never report a
   result you did not run. When the user asks whether something passed, answer
   from `list_requirements`, and for a manual step ask whether they confirmed it.
3. **Fetch once, act, report.** One brief per node, one test plan per
   requirement, readiness as a summary first. Re-fetching what you already
   hold wastes the user's tokens.

## Words this skill uses

Several words mean one thing here and something else elsewhere. Read them
this way throughout:

| Word | Means | Not |
|---|---|---|
| plan | the user's subscription: Community (free), Indie, Team; the installed Enterprise build serves everything Team does | the **work plan** (an ordering artifact, Indie and above) or a **test plan** (one requirement's scenarios) |
| node | one box on the canvas: a `type` (its role, the job it does) and usually a `technology` (what it is built with), both catalog ids | a file or a class; a node may be one class or a whole service |
| container | a node that holds other nodes; it **runs**, **places** or **groups** them | an edge endpoint: an edge never joins a container |
| outcome | something the product must achieve for its users, with criteria. The app says Outcome; the ops and ids say candidate (`create_candidate`, `candidateId`) | a requirement |
| requirement | `REQ-nnn`: buildable criteria derived from one or more outcomes and mapped to the nodes that serve it | an outcome; there is no requirement hierarchy |
| workflow | a row in the Workflows space with ordered steps; outcomes sit on steps. Reads return them as `lanes`, and an outcome's own workflow is its `homeLane` | an autonomy lane |
| autonomy lane | one row of the Autonomy settings (Outcomes & workflow, Requirements, Architecture, Tasks, Tests), each at Ask first, Propose or Auto-apply | a workflow |
| proposal | a change filed for the user to decide, shown under Agents, Proposals | a change card |
| change card | a commit made outside NodeSpec that the sync check noticed | a proposal |
| lease | a hold taken with `checkout_task`; exclusive or advisory by level | a lock: a lock is the user's, set in the app |

## What your plan serves

`tools/list` shows exactly what your connection reaches. A tool not in the
list is on no plan the user reaches: do not call it, and do not offer the user
a workflow that needs it.

| Plan | Adds |
|---|---|
| Every plan, Community and up | The build loop: the catalog, `propose_patches`, requirements, outcomes and the vision, readiness, task documents, test plans and evidence, the work queue and leases, git change cards, keys |
| Indie and above | Repository import (`run_repo_import`, `get_import_context`, `get_node_context`, `search_repo_index`, `backfill_requirements`); the work plan (`get_work_plan`, `propose_work_plan`, `accept_work_plan`); workflows and constraints, which are ops inside `propose_patches` |
| Team and above | Seats: `set_project_member` (`list_project_members` reads on every plan) |

- **Whose plan decides.** Each call is decided by the project it names. On a
  project the user owns, their own plan decides; a call above it is refused
  ("this account resolves to ..."). On a Team project they hold a seat on, the
  owner's plan decides ("this project runs on its owner's ... plan"). Seats
  exist on Team and above; below Team a project is its owner's alone.
- **Below Indie** a batch carrying a workflow or constraint op is refused by
  name before anything is filed (see "The spec plane"). `get_outcome_board`
  then says `workflows.available: false` and carries no `lanes`, `homeLane` or
  `steps`: that means "not on this plan", never "nothing placed yet".
- **After an upgrade** the user reconnects the NodeSpec MCP server and the
  list refreshes.
- **The example project.** Every account has an example project (Harbor Lane
  Bakery) to explore. Its reads answer as Team, so every surface shows; its
  writes follow the user's own plan. Build only in the project the user names.

## How NodeSpec works

- **The canvas is the architecture.** Nodes connect through edges; each edge
  carries a contract (its kind and schema). A container holds nodes in one of
  three ways, read from its type: it **runs** them (a runtime or cluster hosts
  them), it **places** them (a network or cloud account their configuration
  names), or it **groups** them (organization only). A node has one parent; a
  group whose nodes all run on one host sits inside that host. An edge joins
  two nodes, never a container.
- **The chain runs vision → outcome → requirement → node.** The vision is the
  user's words, split into sentences. Each outcome cites the vision sentences
  it serves. Each requirement derives from one or more outcomes and maps to
  the nodes that serve it. On Indie and above every pending outcome also sits
  on a workflow step. Readiness reports a missing link (see step 1 of the
  loop).
- **Nothing lands without the user.** Every change you make is filed through
  a tool, and where it lands depends on what it touches (see "Proposals and
  autonomy" below). A proposal is checked where it is filed: a node placed
  where its parent may not hold it, an edge ending on a container, or a node
  someone else holds is refused by name, and nothing is created.
- **Git carries the model.** On a connected repository NodeSpec pushes
  `.nodespec/` (`model.json`, `spec.json`, `tasks/*.task.md`,
  `tests/*.tests.md`, `BOARD.md`). Commits made outside NodeSpec come back as
  change cards to reconcile.

### Proposals and autonomy

Two planes, never mixed in one call:

- **Canvas changes** (nodes, edges, contracts, artifacts, explodes) are
  always proposals the user decides on the canvas, whatever the Architecture
  lane says.
- **Spec changes** (requirements, the vision, outcomes, workflows,
  constraints) follow the project's autonomy lanes. A direct spec tool
  (`create_requirement`, `update_requirement`, `delete_requirement`,
  `update_vision`, `map_requirement`, `relate_requirements`) is refused at Ask
  first, files a proposal at Propose, and applies at Auto-apply. A
  `propose_patches` batch of spec ops always files, and **applies as it
  files** when every lane it touches is at Auto-apply, your key has the write
  scope, and your account may approve on the project (the owner's agent). The
  response says it applied.
- **What waits for the person at every level:** a promotion, an attach or a
  settle; a changed or retired constraint; any change to a confirmed
  requirement; a batch that sets the vision; anything filed by a key that may
  only propose or by a member's agent on a Team project. Only the user's
  session in the app accepts a promotion, attach, settle or constraint change.
- **A batch that mixes the planes is refused by name** and nothing is filed:
  file the canvas changes first, then the spec changes.
- **Evidence is not change.** `report_test_results` never routes; it lands
  at every level.

## Where to look: route each question to its owner

NodeSpec owns **intent** (what should exist, what done means, how components
relate); the repository owns **actuality** (what the code does now). Answering
an intent question from code reverse-engineers requirements nobody asked for;
answering an actuality question from NodeSpec mistakes previews for files.

| You need | Go to | Not |
|---|---|---|
| What a node must do; its criteria; its scope | The node's `.task.md` in the repo, or its `get_project_context` brief | Its source, read and inferred |
| Requirement wording, met state, exact criterion text | `list_requirements` (`.nodespec/spec.json` has wording only, never evidence state) | A test plan's paraphrase; memory |
| The interface between two nodes | The contract (schema, kind, transport) in the brief's Interface Contracts | The other side's source code |
| Which files implement a node | The brief's Existing Implementation table, or the node's artifacts in `.nodespec/model.json` (no tool call needed) | A repo-wide grep by name |
| What the code does; symbols, utilities, conventions, build config | The repository files, read directly | Any MCP tool: `contentPreview` is a preview, never the file |
| Anything pending, stale or drifted | `get_project_status` counts, then `get_pending_changes` | Diffing the repo against `.nodespec/` yourself |
| Why a node is not buildable | `get_build_readiness` scoped to that node | Compile errors |

Two rules:

- **Contracts beat counterparty code.** Implement against the other node's
  contract schema. When the contract has no schema, the answer is a `schema`
  blocker and a drafted schema proposal, never "read their code and conform
  to it": an interface that exists only in code drifts silently. Read the
  other side's source only to inform the schema you draft.
- **When NodeSpec and the repository disagree,** the repository wins on what
  the code IS and NodeSpec wins on what it SHOULD BE, and the disagreement is
  the finding: reconcile pending change cards first; with none, raise the
  mismatch to the user (an `update_requirement` or `update_contract` proposal,
  or a plain question) instead of picking a side quietly.

## The loop

### 0. Orient (once per session)

`get_project_status(project_id)` gives the phase, the counts and
`nextAction`. When the project is git-connected and the repository is checked
out, read `.nodespec/tasks/*.task.md` and `.nodespec/tests/*.tests.md` from
disk: they are the documents the tools serve, and reading files costs less
than tool calls. When `pendingRepositoryChanges` is not zero, reconcile first
(see "Git-connected projects"). Never build on unreconciled drift.

`nextAction` may lead with EXPANSION REQUESTED: the user pressed Expand on a
node and the request waits for you (MCP is not event driven; `stagedExplodes`
lists the nodes, and the node's `get_project_context` view `slice` says it
too). Claim the node (`checkout_task` level `node`), read its code and propose
ONE `explode_node` (see "Patch discipline"). Once it is proposed the status
says it waits for the user: do not propose it again.

Two import leads work the same way (Indie and above). IMPORT A REPOSITORY:
the user started the project from a repository and no import exists yet;
when it says none is connected, ask them to connect it in the app's Git
window, then call `run_repo_import`. IMPORT INTENT CHOSEN: after the import
the user answered in the app what they are here to do (`importIntent` names
the choice and the change). Do not ask again; work Phase 4 of "Importing an
existing repository" with that answer. Once the outcomes are proposed or
filed, the status says so: do not propose them again.

### 1. Preflight (per batch of work)

`get_build_readiness(project_id, branch_id)` unscoped returns a summary:
per node `{ready, blockerCounts, advisoryCounts}`, a `buildOrder`, ONE
`remediations` map keyed by gap kind, and the project-level advisory
`candidatesOpen` (outcomes under Work never made a requirement; mention
it to the user; it never blocks a build). Take the first node in `buildOrder`
that is not ready and call again with `node_ids: [<that node>]` for the full
gap detail. Never request `detail:'full'` unscoped.

The chain comes with the plan. Every plan carries a vision whose sentences
the outcomes cite, and every requirement derives from an outcome; on Indie
and above every pending outcome also sits on a workflow step. Where the plan
carries a link, a missing one is a gap in the `chain` block: `vision` (none,
or none cited), `off-vision` (an outcome cites no sentence of the current
vision), `origin` (a requirement derives from no outcome), `no-step`;
`unserved` (a sentence no outcome serves) is advisory, and constraints are
only ever a note. Readiness reports the chain and nothing
waits on it: task documents, test plans, the queue, leases and test reports
stay open, so close the gaps alongside the build. A node's own blockers are
only `schema`, `owner` and `doc`; everything else on a node is advisory.

### 2. Clear blockers before writing any code

- **`schema`**: each carries `draftInputs` (both endpoint technologies, the
  counterparty's real API endpoints, the criteria being served, a
  `suggestedSpecFormat`). Draft every missing schema FROM THOSE INPUTS, never
  from memory of what an API usually looks like, and submit all of them as
  **one** `propose_patches` batch of `update_contract` patches
  (`changes.schema` is the JSON object, `changes.specFormat` the format you
  wrote). Then stop on those contracts until the user accepts. A
  `⚠ SCHEMA REFERENCE BROKEN` detail means re-link, not re-draft: propose an
  `update_contract` patch whose `changes.schemaRef` is the id of an ACCEPTED
  `kind='schema'` artifact, never one from a pending proposal.
- **`owner`**: settle with the user through `map_requirement`, or
  `update_requirement` when the requirement itself is wrong. Never guess an
  owner.
- **`doc`**: `generate_task_docs(node_ids: [...])`, then the user accepts the
  proposal. A node someone holds keeps its document as it is and comes back
  listed under `held`.
- **Advisories** (config, mapping, tests, classification, constraint) inform
  and never block. Each kind's fix is in `remediations`: read it there, once.

### 3. Implement (per node, in `buildOrder`)

Get the brief: the node's `.nodespec/tasks/<node>.task.md`, or
`get_project_context(target_type:'node', target_id, view:'brief')`. The brief
IS the implementation spec: work its T-numbered tasks in order, then any
tasks under `## Added Tasks` (tasks the user added by hand; regeneration
keeps them verbatim). Honour `## Configuration` (the user's decisions),
respect "Never decompose its internals" on boundary nodes, and turn
`## Manual Steps` into instructions for the user: you cannot click through a
console for them.

- **Read set.** Open the node's bound artifacts and the schema artifacts its
  contracts reference. Grep wider only for symbols and conventions, never to
  discover scope.
- **Views.** `view:'brief'` for prose context. `view:'structured'` only for
  fields you will transform; `view:'full'` almost never.
- **What moved around the node:** `view:'slice'` returns every edge with its
  full contract, its consumers' expectations, its requirements, tasks, tests
  and leases, the constraints and vision sentences that apply, and its memory
  (decisions, changes, hand-offs, learnings, criteria proven at a commit,
  each with who and the commit). A memory entry flagged `review` was written
  before the node's context changed: check it again before relying on it.
  Keep the slice's `fingerprint` and pass it back as `since` to get only the
  sections that changed; `budget` caps it in tokens.

### 4. Verify (per requirement the node serves)

Order: **schemas → plans → implement → verify.** Budget: **ONE binding test
per acceptance criterion first.** That is the smoke tier, and "verified
(smoke)" on the board is a legitimate state. Deeper tests (edge cases, load,
properties) wait until the smoke tier is green. More cases per criterion is
sprawl, not rigour: `get_project_status`'s `testBudget` flags over-tested
requirements, and an over-budget report returns a consolidation nudge.

- **Plan.** `get_test_plan(project_id, branch_id, requirement_id)`. The plan
  is current by construction: the server compares its fingerprint with the
  live graph on every read and regenerates on the spot when the inputs moved
  (`refreshed: true` says it just did, and the user's own Test Strategy edits
  carry forward). Never force a regeneration. Resolve `schemaBlockedContracts`
  first (step 2); blocked scenarios are markers, not work.
- **Claim the criterion first** when other agents work on the project:
  `checkout_task { level: 'criterion', ref_id: <the requirement's row id>,
  criterion_id: <the criterion's id from list_requirements> }`. The lease is
  exclusive (one criterion, one binding test, one reported outcome). A refusal
  names the holder: verify a different criterion instead.
- **Write the failing test first, and REPORT the red.** A `failed` report is
  not a mistake to hide: it sets `met` to false with provenance,
  a genuine, auditable RED and the first half of the cycle. Implement, re-run
  exactly the failing tests, report the green. Fresh passes clear staleness.
- **Implement the Automated Test Scenarios** in the project's framework, one
  Given/When/Then per criterion, using the suggested `TC-` ids. A case the
  user added by hand in Work is already bound to its criterion
  (`metadata.source: 'manual'`): report under THAT `test_id`. A report naming
  the criterion under another id is refused as a conflict and names the id to
  use (`boundTestId`); reusing the user's id for another criterion is refused
  before anything lands.
- **Report every outcome you ran.** Commit and push FIRST, then report with `git: { commit_sha, branch }`:
  `report_test_results(project_id, requirement_id, results:[{test_id, status,
  criterion_text, framework, artifact_path, source_artifact_ids?}], git: {...})`.
  `criterion_text` is the criterion's EXACT wording (from `list_requirements`
  or the plan; the match is exact, never fuzzy). Read the receipt:
  `flippedCriteria` is what you proved; `warnings` name unbound texts (fix the
  wording and report again) and manual criteria you may not report.
- **Maintain cases with `update_test_case`**: fix a mistyped `test_id`, move a
  case to the requirement it verifies (`reassign_to`; it arrives stale, so run
  it there), retire a superseded case (`update_test_case { retire: true,
  retire_reason }`; never a hard delete, and a fresh report revives it), or
  re-bind after a criterion reword (`criterion_text`; binding alone never sets
  met).
- **Manual criteria are never reported.** Ask the user to perform the step.
  Once they confirm, tick the criterion's box in the node's `.task.md`,
  commit and push; the user applies it in the Git panel. That approval, not
  your word, meets the criterion.

### 5. Close the node

`mark_entity_complete(project_id, node_id)` records your declaration and
returns the criteria still unmet. If any remain, you are not done: return to
step 4. Then go back to step 1 for the next node in `buildOrder`.

## Working beside other agents

- **One agent per key.** A key serves the connection that initialized with it
  last. A call from any other connection on that key is refused before
  anything runs, naming the client that holds it; a restart is a new
  connection and takes the key back. Every agent connects with its own key,
  named for that agent.
- **Who the user sees.** Every write is attributed to the credential you
  connected with: the key's name (`key · hermes`) or the OAuth client. The
  transport proves it and you cannot change it. `external_agent` is a
  nickname shown beside it ("calls itself ..."), never a replacement; do not
  spend effort inventing one.
- **Leases.** Claim before working: `checkout_task` levels `task` (the
  default), `code`, `criterion` and `node` are exclusive; `requirement` and
  `outcome` are advisory drafting holds that coexist. A fresh exclusive hold
  refuses you and names the holder: take the next queue entry. A hold silent
  for 30 minutes is reclaimable, and claiming it is atomic. Read `handoff` on
  a successful claim: it is the previous holder's note.
- **A leased node is locked.** Level `node` (`node_id`) holds a node's
  structure: its type, technology, configuration, edges, contracts, bound
  files and task document. While someone else holds it, or holds work inside
  it, `propose_patches` refuses changes to that node. Work inside a node runs
  in parallel: name your files in `touches`, and your reach is those files,
  their imports inside the node and what the same tests verify; with no
  `touches` you reach the whole node and block everyone else there. A refusal
  names the holder, what it holds and the file that couples you: narrow
  `touches`, wait, or coordinate. On an exploded node the box's lease covers
  its parts: a part's lease, or work inside it, waits for the box, and the box
  waits for its parts. A refused claim on a node whose files split into groups
  with no imports between them carries `explodeSignal`: if the contention
  lasts, propose an explode.
- **Heartbeat and release.** `checkout_heartbeat` between steps keeps the
  lease fresh and publishes progress (`{ tests, touches }`, and
  `meta.commitSha` per commit you push). A touched file outside your reach
  extends it when free; when someone else's work reaches it, it comes back in
  `outsideScope`: coordinate before committing it. `release_checkout` with
  reason `released` and a `note` (done, next, blocked) when you step away; the
  next claim receives the note and the node's memory keeps it. A passing
  `report_test_results` releases your task leases on that requirement as
  `verified` by itself. Releasing marks nothing done; evidence does.
- Every exclusive lease ends exactly one of three audited ways: verified (evidence), released (given back), reclaimed (went stale). The handshake is commit → push → `report_test_results` with `git.commit_sha`, never the reverse. `get_pending_changes` flags `touchesHeldWork` when a commit landed on files bound to a lease someone else holds: resolve the change with the holder, never over them.
- **A waiting proposal holds what it changes.** A second proposal, or a
  direct write, on a requirement, outcome, constraint, workflow or step that
  a waiting proposal already changes is refused, naming that proposal: wait
  for it (`get_proposal_status`), read again, and file against what it left;
  reject your own out-of-date proposal first.
- **Accepts are all or nothing.** Accepting checks every patch against the
  rows as they are now before writing anything: a batch something overtook
  applies nothing and stays pending with the reason (set aside, at
  Auto-apply). A promotion whose REQ number was taken meanwhile takes the
  next. Only one decider takes a proposal; a second is refused.
- **Guard your writes.** `update_requirement` and `delete_requirement` take
  `preconditions` (`value_equals` on `updated_at`, or the exact fields you
  read); spec patches in `propose_patches` carry the same list in their
  metadata. A row that changed since your read refuses loudly with its current
  state: read again and resubmit, never overwrite blind. Two agents deriving
  from one outcome guard their own slices with `hash_match` on
  `criteria[id=<id>].text`, so disjoint slices never collide.
- **Whole-list writes keep what landed meanwhile.** A requirement's criteria
  (`update_requirement` with `acceptance_criteria`), a test's binding and a
  constraint's waivers land only on the row as it was read; when it moved, the
  server reads it again and decides again, keeping evidence, bindings or
  waivers that arrived in between. After three moves the write is refused with
  nothing changed.
- **Check the board before drafting.** `get_work_queue`'s `activeHolds` is the
  whole lease board (every level, yours marked `mine`). Before editing a
  requirement or outcome another agent holds a fresh drafting lease on,
  coordinate through proposals instead.

## Designing architecture: the catalog is the vocabulary

The canvas is not free-form boxes. Every node's `type` is a catalog role id
and its `technology` a catalog technology id. A node proposed with an
invented `type` is the most common way an architecture proposal comes back
wrong.

**Before any `propose_patches` that adds nodes:**

1. **`search_catalog(query)`**, one call per capability you need ("postgres",
   "message queue", "object storage"). It returns matching role and
   technology ids, each with `when_to_use` and a plain-language nature line,
   each role with its `holds` line, and a `guidance` legend that is the
   authoritative vocabulary:
   - `treatment`: **leaf** (you author its code) · **boundary** (you configure
     or call it and NEVER author its internals) · **container** (it holds
     other nodes; its `holds` line says whether it runs, places or groups them,
     and what it may hold).
   - `ownership`: **build** (yours) · **rent** (managed; the provider runs it)
     · **call** (external, consumed by contract) · **host** (a platform hosting
     other nodes).
   - `configMode`: **definition-as-code** (its definition is a repo file) ·
     **declarative** (IaC provisioning) · **external** (configured in a
     console; you hold connection config only).
2. **`lookup_catalog({ technology_id })`** for each technology you settle on:
   purpose, config mode, best practices, security guidance, integration
   patterns, SDK init and common API patterns, the docs URL and the lifecycle
   steer. A row marked MIGRATED or RETIRED names its successor; never
   recommend it for new work.
3. **Then propose**, with `type` and `technology` spelled exactly as the
   catalog spells them.

**Rules the catalog encodes:**

- A **boundary** node is never decomposed. You configure or call it; its task
  packet says so.
- **Provider-branded managed services** (ids prefixed `aws-`, `azure-`,
  `gcp-`, `supabase-`, `firebase-`, `cloudflare-`) sit INSIDE their provider's
  platform node. Create the platform node (role id = the provider, e.g. `aws`)
  first and parent them to it.
- **A node has one parent.** A node sits only where its parent may hold it
  (`get_project_context` on the parent, or `lookup_catalog` on its type, says
  what it may hold); a proposal that breaks it is refused, naming what the
  parent holds. The placement (`hosts`, `contains`, `scopes`) follows how the
  parent holds, so leave `placementKind` unset.
- **Logical groups** (`application-module`, `bounded-context`,
  `microservice-boundary`, `software-layer`) are optional organization:
  nothing runs in them. A group whose nodes all run on one host sits inside
  that host. Do not nest into groups unless the user models it that way.
- **If nothing fits, say so.** The user can define a custom node in the app.
  Never invent a catalog id to fill a gap.
- **Proposing blind costs quality.** The server conforms a near-miss `type`
  or `technology` to the catalog, but it can only pick from what you named: a
  wrong id becomes a wrong node with a weaker task packet. One catalog read
  decides the quality of everything downstream.

### Where it runs

- **The code is the node.** Its type says what job it does, its technology
  the framework (Express, FastAPI, Next.js).
- **The runtime that runs portable code is its host**: a container, a virtual
  machine, a cluster, or a managed runtime that only runs it (App Engine,
  Elastic Beanstalk, Azure App Service, Vercel). Put the node inside the host
  and keep its framework; the host's task document writes the deploy
  definition (app.yaml, Dockerfile, compose service, task definition) for each
  node it runs.
- **Code written against a platform's own API is a leaf** with the platform as
  its technology (a Lambda, an Azure Function, a Cloudflare Worker, a Step
  Functions workflow), placed in its cloud account. Engines (Glue, Databricks,
  n8n) are leaves too.
- **A managed service** (a database, a queue, a bucket) sits in the network or
  account it lives in.
- **A network link** (VPN, Direct Connect, Transit Gateway, NAT, a private
  endpoint) is a Network Connection inside the VPC it serves.
- Each task document says where its node runs (**Runs on:** the chain up to
  the account, and the host with its technology).

## Patch discipline: how canvas writes behave

`propose_patches` carries every canvas write, and its validator is strict so
mistakes fail loudly instead of landing quietly.

- **Intents first.** `intents[]` states what you want and the server compiles
  it into patches, mints the ids and answers with them: no uuid bookkeeping,
  no ordering to get right. The kinds: `add_node` (may name itself with `ref`
  so a later intent in the same call points at it as `"@ref"`),
  `connect_nodes`, `set_contract_schema`, `bind_file` (binds a repository file
  to a node), `explode_node`, `collapse_node` and `place_on_step` (a spec
  intent; see "The spec plane"). Any intent may carry
  `evidence: [{ path, line, note }]`, shown to the reviewer. `patches[]` is the
  explicit form for an op intents do not cover; both may ride one call. The
  user reads the intents on the card.
- **Exploding a node, one level.** When a node holds several concerns (its
  files fall into groups, its leases keep colliding), claim it (`checkout_task`
  level `node`), read its code, and propose `explode_node` with the parts you
  see: each with a `label`, a `role` its node's type lists (`lookup_catalog`
  shows them: handler, repository, page, table group ...), the `files` it owns
  and `why` it is a part; `takes` moves an outside edge's end to the part that
  owns it. The server checks it (every file in one part or left on the node,
  no part without files) and derives the edges between parts from the files'
  imports. The node keeps its id, edges, mappings and task document, which
  becomes the integration document; each part gets its own at the next
  generation. A part holds nothing, and a node that is not a container holds
  only its parts. `collapse_node` folds the parts back. The response's
  `suggestions` name the requirements whose proof now sits in one part.
- **A database explodes into groups**, never one node per table. A group is
  the store's own namespace (a schema, a set of collections, a keyspace) with
  role `part-table-group`; it lists its `tables` (each with its name and its
  columns, key fields or kind, and the `file` that defines it, wherever it
  lives), its `references` to other groups (`via: foreign_key` or `code`), and,
  on each service edge it takes, `access: read | write | both` as that
  service's queries use it. A group that lists its tables need not own a file.
- **Unknown keys in `changes` are REFUSED by name, never silently dropped.**
  The refusal lists the offending keys and the known fields: fix the keys and
  resubmit. A node's configuration lives at `changes.metadata.config`, not at
  a top-level `configuration` key.
- **`update_node` metadata is replaced wholesale.** Read the node first and
  send the COMPLETE metadata object: a partial write erases the keys you left
  out, `config` included.
- **When a project ruling contradicts catalog guidance** (an accepted
  requirement pins a different language or pattern than the technology's
  catalog entry suggests), set `changes.metadata.suppressCatalogGuidance:
  true` on the node: its task packet drops the catalog guidance and defers to
  the project's own Implementation Context. Removing the flag restores it.
  Never hand-edit packet text: packets regenerate.
- **New files are bound to their node.** Include `add_artifact` patches (with
  `nodeId`), or `bind_file` intents, so freshness, staleness and future briefs
  see them. A node's implementation, configuration and schema files are
  separate artifacts; do not glue them together to keep the count down.
- **A file bound to ANOTHER node is that node's work.** If your change needs
  it, stop: that is a cross-node change through an interface. Propose the
  contract or schema change, or tell the user the other node needs work. The
  one exception is a shared schema artifact both sides' contracts reference:
  propose its update once and name both consumers.
- **Boundary and engine nodes** (n8n, managed services): their artifacts are
  definitions and connection config, never reimplementations.
- **Concurrency.** Pass `base_sequence` (the `headSequence` you last read from
  `get_architecture_overview`): if the canvas moved, the call is refused with
  nothing created; read again with `since_sequence` and re-propose.
- **Validation errors name exact fields** and no proposal is created on
  failure: fix and resubmit; there is nothing to clean up.
- **`get_proposal_status`** reports what actually happened to a proposal's
  patches once they settle. Trust it over your memory of what you submitted.

## The spec plane: vision, outcomes, requirements, constraints

### Outcomes and derivation

- **Draft outcomes** with `create_candidate` inside `propose_patches`: a name,
  a description, criteria (each with `text` and `verification`, `automated` or
  `manual`), `serves` (the vision sentences it serves, by id from
  `get_outcome_board` or by the sentence's words; a sentence the vision does
  not have refuses the batch by name), its home workflow (`workflowId` or
  `workflowName`) and, in the same proposal, `set_outcome_step_maps` or a
  `place_on_step` intent for the step it belongs on. The outcome records which
  agent filed it.
- **An outcome derives MANY requirements.** Read the outcome's criteria with
  their ids on `get_outcome_board` (pending outcomes, claimed criteria, steps,
  derivations, who holds what; `include_settled` adds decided ones). Hold the
  outcome first (`checkout_task {level: 'outcome'}`): advisory, it binds to
  your proposal when you file and releases when the user decides. Then propose
  `promote_candidate { candidateId, criteriaIds, name }` once per requirement
  you want, one slice of criteria each. A criterion is claimed once: a claimed
  one refuses by name.
- **An outcome attaches to a requirement that already exists**:
  `attach_candidate { candidateId, requirementId: 'REQ-nnn', criteriaIds? }`
  writes one derivation and mints nothing (a hand-written outcome becoming the
  origin of a backfilled REQ; a second outcome behind one REQ). A locked
  requirement refuses it. `list_requirements` lists every outcome behind each
  requirement in `derivedFrom`.
- **Agents draft below the promotion line; a human crosses it.** Promote,
  attach and settle always file as proposals and only the user accepts them,
  in the app. The outcome stays pending until the user settles it.
- **A decided outcome is terminal.** Once settled or dismissed, nothing more
  lands on it ("... is settled now: a decided outcome is terminal, so nothing
  more lands on it"): file a new outcome instead. The one exception: a settled
  outcome's citations may change (`update_candidate` carrying `serves` alone).
- **Workflows** (Indie and above) are ops inside `propose_patches`:
  `upsert_workflow` (`name`; with `id` it updates, without it creates;
  `intent` makes it a change to an imported system), `upsert_workflow_step`
  (`name`, and `workflowId`, or `workflowName` for a workflow created earlier
  in the same proposal), `set_outcome_step_maps`, and `delete_workflow` /
  `delete_workflow_step` by `id`. A workflow that is still the home of an
  outcome cannot be deleted, and no op moves an outcome's home: ask the user
  to remove it in the app, which moves its outcomes first.

### Requirements

- `create_requirement` adds one with acceptance criteria; criteria always
  start unmet. `section` files it under a named section, created when absent.
  Each requirement needs the outcome it serves: attach one, or file the
  outcome first; readiness reports a requirement with no outcome as `origin`.
- `update_requirement` rewords, re-criterions, reprioritizes or moves it
  (`section`; null clears). `archived: true` takes it out of every working set
  and `false` restores it; archiving is the user's act, so do it only when they
  ask. DONE is derived (every criterion met with fresh evidence) and never
  written; `status` is read-only legacy.
- `delete_requirement` is for disposable drafts only: without `force` it
  refuses a requirement that is mapped or carries test evidence. Prefer
  supersession: `create_requirement` with an `expands` relation archives the
  original, and `update_test_case` retires its cases with history kept.
- `map_requirement` binds a requirement to the nodes serving it (`mode`: add,
  remove or replace; `mapping_type` defaults to implements). This is the
  traceability edge.
- `relate_requirements` declares lineage between requirements: `expands` (extension: the newer supersedes and archives the completed older one), `depends_on` (ordering), `relates_to` (loose).
  There is NO requirement hierarchy: the OUTCOME is the umbrella. If two
  requirements feel like parent and child, the parent is an outcome: promote
  or attach it, never nest.

**Why your write came back as a proposal: the three-rung ladder.** Every spec
write meets the row's own brake before the lane's autonomy level, so one tool
call behaves differently per row. Read the answer; never retry blind:

| The row is | Your write | What to do |
|---|---|---|
| **open** | follows the lane's level (Ask first refuses, Propose files a proposal, Auto-apply applies) | the level is the user's decision; never retry a refusal |
| **confirmed** | ALWAYS comes back as a proposal, whatever the lane says; the answer carries `reason: "confirmed"` and the REQ id | nothing is wrong: tell the user it waits for them |
| **locked** | refused before the handler runs, in the lock's own words | no tool unlocks, the user does in the app. Evidence (`report_test_results`) still lands |

### Constraints

A constraint is what the project holds itself to: a workflow feature (Indie
and above). Below Indie no tool names one and no document or read carries
one; one made on a paid plan comes back when the owner is on Indie again.
NodeSpec ships none and never words one: every constraint is the user's,
filed by them in the app or drafted by you from what they said and accepted
by them. Nothing waits on constraints.

- **File one** with `create_constraint` inside `propose_patches`: `ctype`
  (technology, architecture, deployment, performance, security, compliance,
  cost or other), `description` (the constraint itself; with `ctype` it is its
  identity, so the same one filed twice is refused as already recorded),
  `title` and `rationale` when you have them, and `workflowId` or
  `workflowName` when it holds for one workflow, or
  `scope { kind: role | technology | contract_kind | node, value }` for
  anything narrower than the project.
- **A check** is one of four predicates evaluated on the graph
  (`contract_has_schema`, `no_calls_between_roles`, `technology_in_list`,
  `sync_calls_at_most`) with the project's own scope and parameters and a
  severity: a proposal that adds a break of a `refuse` check is refused by
  name; one that breaks a `warn` check files with the warning. A break that is
  meant gets a waiver the user accepts
  (`update_constraint { addWaiver }` in the same batch).
- **Guidance** rides into the task documents of the nodes in scope.
  `get_build_readiness` reports standing breaks as `constraint` advisories,
  and a whole-project read's `constraintSignals` bring evidence from this
  project (a check waived again and again, a constraint unused for 90 days, a
  schema gap on many nodes, a learning written into several nodes'
  Implementation Context), each with an ask. A rejected proposal may carry the
  reviewer's `reviewNote`. In every case ask the user, and file what they say
  in their words.

## Git-connected projects

Pushes from NodeSpec refresh stale task documents and test plans: after the
user accepts a schema proposal, the regenerated documents arrive in the next
push, so read them again rather than trusting your copy. Commits made outside
NodeSpec, yours included, come back as change cards (and stale test cases).
That is the system working: reconcile each card, then re-run and re-report.

**Reconcile a card in one read and one write.** `get_pending_changes` lists
the cards, each with `commitSha`, the ticks it carries (`criterionDeltas`,
`taskDeltas`) and `touchesHeldWork`. `get_pending_changes` with
`change_event_id` answers one card's reconcile packet:

- `files`: each changed file with its action, its `owner` (the node its
  binding names, else the repository index's node) or a `suggestion` (the node
  owning the nearest bound directory, with the reason), `newDirectory` when it
  sits in a directory the change adds, and its `kind` (task document, test,
  spec or model anchor).
- `nodes`: each touched node's type, technology, contracts in and out with the
  node at the other end, mapped requirements (locked, confirmed), tests, live
  holds (yours marked `mine`), task-document freshness and `lastFileRemoved`.
- `signals`: what the diff declares, each with file and line: routes added or
  removed, outbound hosts, dependencies added or dropped with the catalog
  entry they name (`ioredis` names Redis), clients, connection variables,
  deployment files, new directories with their own manifest. Without
  repository import on the plan it is `{ available: false }`: read the changed
  files yourself.
- `classification`: content-only, needs-binding, structural, spec,
  model-edited or conflicts; `conflicts` names each node and why (a locked
  requirement, someone else's hold).
- `draft`: intents for `resolve_change` (`add_node` with a `ref`, `bind_file`,
  `connect_nodes`, each citing `evidence: [{ path, line, note }]`), and notes
  for what only you can judge (a removed route, a node with no files left, a
  new outbound host).

Then decide with `resolve_change`, passing the card's `commit_sha` exactly as
`get_pending_changes` returned it (a card that moved on to newer commits is
refused: read it again):

| The card is | Do |
|---|---|
| content-only | `resolution: 'accepted'` |
| needs-binding or structural | `resolution: 'accepted'` with `intents` (the draft as it stands or edited). They file ONE proposal the user reviews with its evidence; the card stays pending until they accept it (`reconcileProposalId` on the card), and the bound files' bytes come from the card's commit. Leave the card alone meanwhile |
| conflicts | a locked requirement is the user's to unlock and held work is the holder's: say so and leave the card; never resolve over them |
| spec or model-edited | the card offers a load of `.nodespec/spec.json` or `.nodespec/model.json`, which the user decides in the Git panel |
| noise | `resolution: 'dismissed'` |

Never file an intent the packet or your own reading gives no evidence for,
and cite the file and line you read.

**Ticks split by kind.** A task tick follows the Tasks lane: at Auto-apply,
accept the card with `resolve_change { resolution: 'accepted', apply_ticks: true }`;
at Propose it waits on the card for the user; at Ask first the accept is
refused. A criterion tick is the user's to apply in the Git panel; `resolve_change` never does, at any setting
(an accept leaves the card pending for them, and `waitingForPerson` says what
waits). Ticks apply only on accept and never twice, and an unticked box never
retracts evidence.

**Work on the branch NodeSpec tracks.** Commit and push to the branch the
project is connected to: `get_pending_changes` names it (`trackedBranch`); it
is the repository's default branch unless the owner bound another. The sync
check reads that branch. A commit anywhere else raises no change card until
it merges there, and test results you report for it are held (the receipt
says `held` and names the branch) until the commit arrives on it.

**Declare the files you create.** When you write a NEW source file in a
git-connected project, add one entry to `.nodespec/bindings.json` in the same
commit, naming the component it belongs to:

```json
{ "version": 1, "bindings": [
  { "path": "src/api/users.ts", "node": "API Service", "kind": "source", "language": "typescript" }
] }
```

`node` is the component's label or id; `kind` is one of source, schema, doc,
config, build, design. NodeSpec binds those files to their node on the next
push and clears the entries: a declared file needs no proposal round trip.
Files you do not declare arrive as unattributed residue for someone to sort
by hand. Declare NEW files only: a bound file lives in `.nodespec/model.json`
and is never declared again. Never declare anything under `.nodespec/`. An
entry naming a component that does not exist is reported back, not created:
architecture changes still go through `propose_patches`.

**The board file.** Every NodeSpec push writes `.nodespec/BOARD.md`: one
checkbox per acceptance criterion and per implementation task, grouped by
requirement, with a derived status line. It is a projection: tick boxes to
record completion (taken in on the next push, applied as described under
"Ticks split by kind") but never edit the text, which is matched exactly and
regenerated on every push.

**Push code; propose bindings.** When a proposal binds files whose content you
already pushed, do not paste their bodies into `propose_patches`. Push the
commit first, then submit the `add_artifact` patches WITHOUT `content` and
pass `content_ref: "<pushed commit sha>"`: NodeSpec pulls the bytes from git
when the user accepts. One call can bind dozens of files this way, and the
sha pins exactly what you pushed. The commit must be reachable before the
user accepts, or the accept fails naming the missing paths.

## Importing an existing repository (Indie and above)

When the user wants an existing codebase on the canvas, ONE tool carries the
whole flow: `run_repo_import`. Below Indie it refuses, naming the upgrade
path. Never build the model by hand: the deterministic pipeline classifies,
groups and synthesizes with provenance, and your job is judgment over its
output, not re-derivation.

Preconditions: the project exists, the repository is connected in the app's
Git panel, and the canvas is empty (a populated canvas, or a repository that
carries `.nodespec/model.json`, is refused).

**Phase 1: start and poll.** Call `run_repo_import(project_id)`. The pipeline
runs in the background; a `running` response carries progress. Poll again in
about 30 seconds (a stalled job is restarted automatically). Never re-derive
the analysis yourself while it runs.

**Phase 2: review and decide.** The staged response is the complete review
package: per-group frames with evidence, the draft's nodes, edges and
contracts, per-node **signals** (declared routes, outbound HTTP clients,
manifest dependencies, top imports, deployment surfaces), open questions,
review hints and the import doctrine. Review it; rubber-stamping defeats the
review:
- Answer every open question, fix generic labels, verify types.
- Missing relationships usually show in the signals: a node with
  `outboundHttp` calling a node with `routes` is an `add_edges` candidate,
  citing both sides. Never ask for the repository URL: the signals replace
  reading files.
- Tag stacks the pipeline could not infer with `set_technology` and catalog
  ids (`search_catalog` when unsure). Untagged nodes render generic.
- Each draft node names its `parent`, and each host and group says what it may
  hold (`holds`). A `role_changes` entry its parent may not hold, or that
  leaves a node inside it that the new type may not hold, is refused when you
  submit, in the words a proposal gets, and nothing is finalized.

Then call `run_repo_import` again with `decisions`: `{approve: true}`, or the
bounded revisions (renames, role_changes, set_technology, drop_nodes,
add_edges with evidence, drop_edges). This promotes ONE proposal into the
app.

**Phase 3: the user accepts in the app.** You cannot accept it for them. Tell
them it is ready and wait.

**Phase 4: intent first, then the spec plane (do NOT stop at acceptance).**
An accepted import is structure without intent. It stays as found; what
follows starts from what the user is here to do. When the user confirms
acceptance (or `run_repo_import` reports state `accepted`), work in this
order. The `accepted` response carries `index`: the repository index is
written in pages after the accept, and while `index.state` is `indexing` the
retrieval tools are still filling in; poll `run_repo_import` again in about
15 seconds before relying on them.

1. `get_import_context(project_id)`: the repository's own words as a READ:
   its READMEs (root first, then by depth, monorepo-aware), package
   descriptors (name and description), docs index pages, CI workflow and job
   names, and e2e spec titles in file order, each bounded in bytes and every
   user-authored string inside the untrusted-data envelope. The `doctrine`
   block sits outside the envelope and is the rule. Draft the vision from the
   descriptors and READMEs. The vision is drafted from descriptors and
   CONFIRMED by the user, never written from code; when the response says
   `empty: true` there is nothing to draft from, so ask for the vision instead
   of inventing one.
2. **Intent.** The response's `intent` block says what the user is here to
   do. When they answered in the app as they accepted, `intent.changes` lists
   the change they opened: its steps, the nodes in its scope and the existing
   test files on them. Otherwise `intent.ask` is the question to ask, with
   `intent.choices`: migrate it, harden it, change a component, extend it, or
   describe the whole system.
3. **A change** (the first four choices) is its own workflow:
   `upsert_workflow { name: the user's words, intent }` when it is not in the
   app yet; its steps come from the intent's template, What works today first.
   Its outcomes go on its steps
   (`create_candidate { workflowName: the change, stepName, serves }`, each
   citing the vision sentence it serves). What works today holds the baseline,
   limited to the nodes the change touches and the edges that cross into them.
   Ask for the change's constraints and file each with
   `create_constraint { workflowName: the change }`. File all of it as ONE
   `propose_patches` call: `update_vision` + the change + `create_candidate` +
   `create_constraint`. It lands under Agents, Proposals as a **context**
   proposal. Then prove the baseline: `backfill_requirements` with `node_id`,
   one node of the change at a time, stages a behaviour candidate per readable
   test file; accept the ones the baseline keeps and attach the baseline
   outcome to each (`attach_candidate`), so the existing tests are its proof.
   While a change is open a whole-system backfill is refused unless the user
   asked for it (`whole_system: true`). Requirements derive from the outcomes
   and map to nodes; those nodes are the change's scope, `run_repo_import`
   counts coverage on those only, and everything else is the system as found.
4. **Describe the whole system** (the fifth choice): one workflow
   (`upsert_workflow`) per flow the README, docs and CI describe; steps
   (`upsert_workflow_step`, by `workflowName`) from the e2e order and the CI
   jobs; outcomes (`create_candidate`, by `workflowName`) for what the README
   promises, with its testable claims as criteria, each citing the vision
   sentence it serves (`serves`: the sentence's words work while the vision is
   in the same batch; afterwards `get_outcome_board` lists the sentence ids).
   File all of it as ONE `propose_patches` call: `update_vision` +
   `upsert_workflow` + `upsert_workflow_step` + `create_candidate`. Then tell
   the user the vision is a DRAFT and ask them to confirm it in their own
   words.

Either way, Workflows and outcomes are proposed, never applied: do not call
`upsert_workflow` or `create_candidate` outside this one proposal for a
backfill, at any autonomy level. The response's `routing` field names the
strictest autonomy lane the batch answers to; the proposal files regardless, because
proposing IS the ask, and a batch carrying the drafted vision waits even at
Auto-apply. Workflows are Indie and above (so is repository import); read
`workflows.available` on `get_outcome_board` before planning workflows.

Then, for the whole system:
1. `backfill_requirements(project_id)`: the deterministic first pass. It
   derives candidates from the repository index (declared route groups become
   "<Resource> API" with a criterion per route; schema and migration files
   become "<Node> data model"; test files with readable titles become
   "<Module> behaviour" with each title as a criterion) and STAGES them;
   nothing reaches the spec until you accept. Walk the pending list with the
   user, then call it again with `accept: [ids]` and `dismiss: [ids]`.
   Accepted candidates become `ai-generated`, unconfirmed requirements whose
   criteria START UNMET, mapped to their node at confidence 0.6; refine
   wording with `update_requirement` and file them with `section`. An accept
   IS a promotion: the candidate stays a pending outcome (home workflow
   "Imported") that derived its requirement, so the chain runs outcome →
   requirement → node from the first backfill. Cite the vision sentence it
   serves with `update_candidate { serves }`; the user settles it in the app
   when it is fully covered.
2. `create_requirement`: hand-write requirements for what the candidates could
   not see (the response's `uncoveredNodes`, and intent the code does not
   declare), each with the outcome it serves.
3. `map_requirement`: bind each hand-written requirement to the nodes serving
   it.

Repeat 2 and 3 until `run_repo_import` reports empty coverage (it lists the
nodes still without requirements), then hand off to the loop: readiness,
briefs and test plans activate once the spec plane exists.

**Phase 5: work from the index, not the files.** Once accepted, every file
is bound to a node in the repository index. For briefs and questions about an
imported component, call `get_node_context(project_id, node_id)` (counts, hub
files with git refs, a signals rollup, dependencies with evidence, the
summary the import wrote) and `search_repo_index(project_id, query, node_id?)`
to find a route, symbol or file. Neither reads files into your context; never
ask the user for the repository. `get_import_context` is for the
repository's own words; the index tools are for its code. Read a hub file's
bytes through `get_project_context` (`target_type: 'artifact'`) only when the
brief needs the code itself. NodeSpec calls no model: say what a component
does from its hub files yourself.

Restart: `restart=true` only after a failure, or when the user explicitly
wants a fresh analysis over an existing canvas or accepted import. A
`rejected` proposal means ask the user what was wrong FIRST.

## What a proposal must carry

The app renders what you filed and nothing else. NodeSpec has no model of its
own: the Proposals panel draws each card's heading from the payload, its one
line from your explanation, and its act from the rows (the next REQ ref, the
section or node it lands on, the plan version). A field you
leave empty renders empty. Nobody writes a sentence for you, and the user
rejects what they cannot read.

| You file | It must carry | The card then says |
|---|---|---|
| A promotion (`promote_candidate` inside `propose_patches`) | `candidateId`, the `criteriaIds` slice, `name`, `section` (where the requirement lands; without it the card falls back to the outcome's node), and `explanations[i]`: one line on why this slice is a requirement now | Make "<outcome>" a requirement · your line · **Accept as REQ-nnn on <section>** |
| An outcome draft (`create_candidate`) | `name`, `description`, `criteria[]` each with `text` and `verification` (`automated` or `manual`), `serves`, the home workflow (`workflowId` or `workflowName`), a `set_outcome_step_maps` in the same proposal for its step, and `explanations[i]`: what you read that made you draft it | New outcome: <name> · N criteria · your line · Accept |
| A constraint (`create_constraint`) | `ctype`, `description`, `title` when it has a short name, `rationale`, the workflow or `scope` it holds for, for a check `kind: 'check'` and `check { predicate, severity, params }`, `origin` when it came from a signal or a review, and `explanations[i]`: where you read it | New constraint: <title, else description> · your line · Accept |
| A waiver, a changed check, a retired constraint (`update_constraint`, `delete_constraint`) | `constraintId`; for a waiver `addWaiver { target: the node or edge, reason }` (and `expiresAt` when temporary); for a retirement a `reason`; and `explanations[i]`: the evidence | the constraint · your line · the user accepts it in the app; a key never can |
| An attach (`attach_candidate`) | `candidateId`, `requirementId`, `criteriaIds` when a slice, and one line on why it belongs behind that requirement | the outcome · your line · Accept |
| A plan (`propose_work_plan`) | `summary`: one line saying what the order optimizes for; a `rationale` on every item (shown beside the task); a `decision` on one edge of every open cycle | Plan vN · N tasks and tests · your summary · **Accept plan vN** |
| A requirement edit or delete that needs a reason | file the spec patch through `propose_patches` with `explanations[i]`; a direct `update_requirement` routed as a proposal carries only the tool's own summary line | REQ-nnn · name · your line; a locked target says "REQ-nnn is locked" and offers the unlock door instead of Accept |
| Test results (`report_test_results`) | the exact `criterion_text`, `artifact_path` (the test file), `source_artifact_ids` (the files it verifies), `expected_result`, and `git.commit_sha` after commit and push | the requirement's record: each criterion with the test that proves it, each test with its expected result, the code files they touch |
| A task tick | the checkbox in the node's `.task.md`, committed and pushed on the tracked branch; the change card carries the commit. At the Tasks lane's Auto-apply, `resolve_change` with `apply_ticks: true` stamps it; at Propose it waits on the card for the user; at Ask first the accept is refused | the task with its done tick and the commit that ticked it |
| A criterion tick | only for a manual criterion, once the user confirms the step: its box in the node's `.task.md`, committed and pushed. The user applies it in the Git panel; an automated criterion is proven by `report_test_results`, never by a tick | the criterion met, recorded as applied by the user |

Three rules for the line:
- One line is one line. The card is narrow; the decision page carries the
  rest of a promotion, and a plan's rationale lives on each item.
- Name the fact, not the act. "Both criteria are unclaimed and testable as
  written" is a reason; "you should accept this" is not.
- Never file without it. An `explanations` array shorter than `patches`
  leaves the later cards blank.

## Token discipline

- Repository files beat tool calls when both exist (`.nodespec/` is the same
  truth).
- `view:'brief'` unless you transform structured fields.
- Readiness: the summary, then ONE scoped call per node you actually build.
- One `get_test_plan` per requirement per change of its inputs, not per
  session.
- Batch: all schema drafts in one proposal; all results for a requirement in
  one report.
- **Large proposals stream as one chunked session**: `finalize: false` starts a
  staged session nobody sees yet; append batches with the returned
  `proposal_id`; `finalize: true` on the last call submits everything as ONE
  proposal. Sessions expire after 30 idle minutes, so never leave one
  unfinalized. Each call carries at most 500 patches.
- **Truncation honesty**: on any call with more than about 20 patches, pass
  `expected_patch_count`, so a short delivery fails loudly instead of creating
  a fragment, and compare the response's `patchCountThisCall` with what you
  sent before telling the user a proposal is complete.
- Act on tool responses; do not paste them back into your messages.
- **Rate limit**: the endpoint holds each credential to a burst of 60 calls,
  then 4 a second (240 a minute). A 429 carries Retry-After in seconds: wait
  that long, then retry once. Batch the work instead of looping.

## Tool reference

Every tool takes `project_id` (a name or UUID) unless noted. Each row says
when to reach for the tool; the sections above say how.

**Orient**
| Tool | Use when |
|---|---|
| `list_projects` | Resolving which project the user means (no `project_id`) |
| `create_project` | Starting a brand-new project; the account's project limit applies (no `project_id`) |
| `get_project_status` | START HERE each session: phase, counts, pending drift, `testBudget`, `nextAction` |
| `get_architecture_overview` | The whole topology at once, with its `headSequence` (`since_sequence` for what changed); orientation, not implementation detail |
| `list_project_members` | Who holds a seat and what your own seat allows: read tools need viewer, propose and write tools need contributor; approving is the owner's (a maintainer's, in the app) and never yours for a member |
| `set_project_member` | Only when the owner tells you to: seat an account by email as maintainer, contributor or viewer, or remove it; `clearance` (NodeSpec for Government only) lists the classification marks the seat may see. Ownership is never a seat (Team and above) |

**Catalog**
| Tool | Use when |
|---|---|
| `search_catalog` | FIRST, per capability, before proposing any node or an import's `role_changes` / `set_technology`: role ids, technology ids, `when_to_use`, each role's `holds` line and the treatment / ownership / configMode legend (no `project_id`) |
| `lookup_catalog` | Per id you chose, before designing around it: the technology's guidance and MIGRATED / RETIRED steer, or for a role how it holds and everything it may hold (no `project_id`) |

**Build**
| Tool | Use when |
|---|---|
| `get_build_readiness` | Preflight: the summary first, then ONE scoped call per node you will build |
| `get_project_context` | A node's brief (`view:'brief'`) when its `.task.md` is not at hand; `view:'slice'` for what moved around it; an artifact's bytes (`target_type: 'artifact'`) |
| `generate_task_docs` | Doc blockers: regenerate stale or missing task documents; a held node's document is left as it is and listed under `held` |
| `propose_patches` | Every canvas write, and spec ops (outcomes, workflows, constraints, promotions, attaches, settles, and requirement changes that need a reason): see "Proposals and autonomy" and "Patch discipline" |
| `get_proposal_status` | Did the user decide what you proposed; the status reflects what actually settled (no `project_id`) |
| `mark_entity_complete` | Declaring a node done; it returns the criteria still unmet (believe them) |

**Spec plane**
| Tool | Use when |
|---|---|
| `update_vision` | Setting the product vision: the user's words, asked for and never inferred from code; after an import, drafted from `get_import_context` inside the context proposal and confirmed by the user |
| `get_outcome_board` | Before drafting or deriving: pending outcomes with criterion ids, claimed criteria, steps, derivations, who holds what (credential, `mine`), the vision sentences, and `workflows.available` |
| `list_requirements` | Exact criterion wording, criterion ids and met state, and each requirement's `derivedFrom`: the source for `criterion_text` |
| `create_requirement` | Adding a requirement with acceptance criteria (unmet at first); `section` files it |
| `update_requirement` | Rewording, re-criterioning, reprioritizing, re-sectioning or archiving a requirement; `preconditions` guards it. A locked requirement refuses every write |
| `delete_requirement` | Disposable drafts only; refused without `force` when mapped or carrying evidence. Prefer an `expands` successor |
| `map_requirement` | Binding a requirement to the nodes serving it |
| `relate_requirements` | Declaring `expands`, `depends_on` or `relates_to` between two requirements |
| `resolve_proposal` | Accepting or rejecting a pending spec proposal, only when the user tells you to. Canvas proposals are decided on the canvas, and a promotion, attach, settle or constraint change only by the user in the app |

**Verify**
| Tool | Use when |
|---|---|
| `get_test_plan` | Per requirement: the scenarios to implement |
| `report_test_results` | EVERY outcome you actually ran, with the exact `criterion_text`; this is what meets criteria. Commit and push first, then report with `git` |
| `update_test_case` | Fixing a `test_id`, moving a case (`reassign_to`), retiring one (`retire` with a reason), or re-binding after a reword (`criterion_text`) |

**Work loop**
| Tool | Use when |
|---|---|
| `get_work_queue` | Top of an autonomous loop: the next unblocked tasks in pinned order (the accepted work plan, else the readiness `buildOrder`), with `activeHolds`, the whole lease board |
| `get_work_plan` | Before ordering work (Indie+): the accepted work plan, or the deterministic graph (tight and loose edges, layers, the critical path, open questions) |
| `propose_work_plan` | Your order over EVERY item, each with a one-line rationale; tight edges are hard, loose ones may invert with a reason, every cycle needs a decision, refused by name otherwise; the user accepts (Indie and above) |
| `accept_work_plan` | Only when the user says so: it supersedes the previous work plan and `get_work_queue` then serves it; a stale plan (the documents changed) is refused (Indie and above) |
| `checkout_task` | Claiming work before you start; levels and rules under "Working beside other agents" |
| `checkout_heartbeat` | Between work steps: keeps the lease fresh and publishes `{ tests, touches }` and `commitSha` |
| `release_checkout` | Stepping away without evidence (`released`, with a `note`), or closing an advisory hold whose proposal settled (`resolved`) |

**Git**
| Tool | Use when |
|---|---|
| `get_pending_changes` | Listing change cards after commits made outside NodeSpec; with `change_event_id`, one card's reconcile packet |
| `resolve_change` | Deciding a card: `accepted` (with `intents` or `patches` when it needs a proposal) or `dismissed`, with the card's `commit_sha` |

**Repository import (Indie and above)**
| Tool | Use when |
|---|---|
| `run_repo_import` | THE import tool, in every state: drive the pipeline, receive the staged package, submit `decisions`, and after acceptance read the index state and backfill coverage (Indie and above) |
| `get_import_context` | After acceptance: the repository's READMEs, descriptors, docs index pages, CI names and e2e titles, bounded and enveloped, to draft the vision and workflows from (Indie and above) |
| `get_node_context` | What an imported node holds: file and language counts, hub files with artifact ids, the signals rollup, dependencies in and out, the import's summary (Indie and above) |
| `search_repo_index` | Finding a file in an imported repository by path, route text or import text, each hit attributed to its node; `node_id` scopes it (Indie and above) |
| `backfill_requirements` | After acceptance: stage requirement candidates from the index, then `accept` or `dismiss` them by id; `node_id` limits it to one node of an open change; it never writes a requirement on its own (Indie and above) |

**Keys** (rare and usually the user's job in the app; these three answer a
signed-in session only, never a key, and take no `project_id`)
| Tool | Use when |
|---|---|
| `create_api_key` | Minting a key when the user asks: one key per agent, one live key per name. The plan caps how many agents one person keeps connected (Community one, Indie and above five per person, keys and OAuth clients alike); a refusal names the cap or the taken name |
| `list_api_keys` | The user's connected agents, keys and OAuth clients alike, with the plan's allowance (`connections.active` of `connections.limit`) |
| `revoke_api_key` | Revoking a key (`key_id`) or an OAuth-connected client (`client_id`) when the user asks |

**NodeSpec for Government only.** `mark` on `create_requirement` or
`update_requirement` puts a classification mark (`CUI`, `CUI//SP-PRVCY`) on
ONE item. A read response with `withheld: N` means marked items were removed for your clearance;
never guess at them; ask the user.

## Look-alike names: route by the noun, not the verb

| If the noun is | The pair | Never |
|---|---|---|
| An inbound GIT COMMIT (someone pushed; NodeSpec noticed) | `get_pending_changes` → `resolve_change` | `resolve_proposal`: a change card is not a proposal |
| A change YOU proposed (spec or canvas, waiting for the user) | `get_proposal_status` → the user decides (or `resolve_proposal` when the user says so) | `resolve_change`: proposals never appear as change cards |
| WHAT TO DO NEXT (the live queue, holds attached) | `get_work_queue` | `get_work_plan`: the plan is the ORDERING ARTIFACT (Indie+), not the queue |
| PROOF vs DECLARATION vs MAINTENANCE | `report_test_results` meets criteria with evidence · `mark_entity_complete` declares a NODE and returns what is still unmet · `update_test_case` maintains the case rows | Declaring instead of proving: a declaration flips nothing |

Two near-neighbours are not interchangeable either: `map_requirement` binds a
requirement to the NODES serving it (traceability); `relate_requirements`
declares lineage between requirements (`expands`, `depends_on`,
`relates_to`). `backfill_requirements` is the import's bulk writer and never a substitute for either.

## When something looks wrong

Contradictions between the brief and the live graph, criteria that cannot be
tested as written, requirements that seem to belong to another node: raise
them with the user through the named tools (`update_requirement`,
`map_requirement`, an `update_contract` proposal), never by quietly building
your own interpretation. NodeSpec's cards and proposals exist so the user
rules once, in one place, with provenance.
