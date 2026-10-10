---
name: nodespec-oss-developer
description: NodeSpec OSS Skill for Developers. Drive implementation work on a project managed by the self-hosted, open source NodeSpec Community Edition (the user runs NodeSpec locally and has its MCP server connected). Use whenever the user asks to plan, build, implement, continue, or verify work on a NodeSpec project ("design my architecture", "build the next node", "implement REQ-007", "work through the backlog", "run the verification loop", "what should I build next"), or whenever a repo contains a .nodespec/ directory (model.json / spec.json / tasks/ / tests/). NodeSpec is the source of truth for architecture, requirements, and acceptance criteria; this skill defines the end-to-end flow from empty project to verified software, how the canvas holds nodes, the exact tool loop, the honesty rules that prevent invented schemas and unearned completions, and the token discipline. Do NOT use for editing the NodeSpec application's own source code: Community Edition users have that code checked out, and this skill governs building THEIR projects with NodeSpec, never modifying NodeSpec itself.
---

# NodeSpec OSS Skill for Developers

You are implementing software whose architecture, requirements, and acceptance
criteria live in a self-hosted NodeSpec. NodeSpec assembles deterministic,
trusted context; you supply the code. Three rules override everything else:

1. **Never invent what NodeSpec marks missing.** `⚠ SCHEMA UNDEFINED`,
   `[PLACEHOLDER: …]`, and `[blocked by schema: …]` are stop signs, not
   invitations. The resolution path is always named in the same payload.
2. **Never claim what you haven't proven.** Criteria flip only through evidence
   (test results you actually ran) or the user's approval of a tick. "Never
   report a result you did not actually run or that the user ran on their own test bench with confirmation if you prompt them" is a hard rule. If the user inquires on the status of an acceptance, ask if they confirmed.
3. **Fetch once, act, report.** The tools are dieted; don't undo that by
   re-fetching. One brief per node, one plan per requirement, summary-first
   readiness.

## How NodeSpec works, in brief

- **The canvas is the architecture.** A node has a catalog role (its `type`:
  the job it does) and usually a catalog technology. Nodes connect through
  edges, each carrying a contract (the interface: kind, schema). A
  container holds nodes in one of three ways, read from its type: it
  **runs** them (a runtime or cluster hosts them), it **places** them (a
  network or cloud account their configuration names), or it **groups**
  them (organization only). A node has one parent; a group whose nodes all
  run on one host sits inside that host. An edge joins two nodes, never a
  container.
- **Every change files as a proposal.** A graph write is decided by the
  user in the app, or applies as it files when the Architecture lane is at
  Auto-apply. Spec writes (requirements, vision) follow the project's
  Autonomy settings per lane, filed directly or in a `propose_patches`
  batch; a promotion, a confirmed requirement or a locked node waits for the
  user at every level. A proposal is checked
  where it is filed: a node placed where its parent may not hold it, an
  edge ending on a container, or a node someone else holds is refused by
  name, and nothing is created.
- **Git carries the model.** On a connected repository NodeSpec pushes
  `.nodespec/` (`model.json`, `spec.json`, `tasks/*.task.md`,
  `tests/*.tests.md`, `BOARD.md`); commits made outside NodeSpec come back
  as change cards to reconcile.

## The flow at a glance: empty project to verified software

Every NodeSpec project moves through the same concrete pipeline. Each stage
produces an artifact the next stage consumes; skipping a stage is what the
readiness gate exists to catch.

1. **Capture intent.** `update_vision` records the product vision in the
   user's own words. `create_requirement` adds requirements with acceptance
   criteria (criteria always start unmet); `section` groups them.
2. **Design the architecture.** `search_catalog` for exact role/technology
   ids, then ONE `propose_patches` batch: contracts first, then nodes, then
   edges referencing both. The user accepts or rejects each patch in the app —
   nothing lands on the canvas without their approval.
3. **Map ownership.** `map_requirement` binds each requirement to the node(s)
   that serve it. This traceability edge is what lets readiness, task docs,
   and test plans exist at all.
4. **Preflight.** `get_build_readiness` names every gap standing between the
   graph and buildable work: contracts missing schemas (you draft them from
   the provided inputs and propose them), unresolved criterion owners,
   missing task docs. Clear blockers; advisories inform.
5. **Implement, node by node.** Work `buildOrder` — or let `get_work_queue`
   serve it task-by-task (the same order), with `checkout_task` /
   `release_checkout` marking who holds what when several agents share the
   project (a checkout is coordination, never permission; a leased node is
   locked: level `node` holds its structure, and work inside it runs in
   parallel when each claim names its files in `touches`; release with a
   `note` for whoever comes next). The node's task document
   (`.nodespec/tasks/<node>.task.md` in the repo, or the `get_project_context`
   brief) is the implementation spec — T-numbered tasks, configuration
   decisions, contract references. Your read set is the node's bound
   artifacts, not the whole repo.
6. **Verify, requirement by requirement.** `get_test_plan` gives the
   scenarios; you implement and RUN them; `report_test_results` with each
   criterion's exact wording is the only thing that flips criteria met.
   A passing report also releases your task checkouts on that requirement's
   tasks as 'verified' — evidence, not declaration, closes the lease.
   Manual steps are the user's to confirm, never yours to report.
7. **Close.** `mark_entity_complete` per node — it returns any still-unmet
   criteria, and unmet means not done. Then back to step 4 for the next node.

One rule wraps every write: the project's Autonomy settings route it. A
lane on "Propose" means your edit comes back as `routed: proposed` with a
proposalId and NOTHING changed until the user accepts; "Ask first" refuses
— discuss, never retry. Promotion of an outcome candidate is ALWAYS the
user's act, in the app. Working beside other agents, guard requirement
writes with `preconditions` (`value_equals` on `updated_at` is the cheap
whole-row token): a row that changed since your read refuses loudly with
the current state — re-read and re-submit, never overwrite blind.

Git-connected projects wrap this loop: NodeSpec's pushes write the task docs,
test plans, and board file into `.nodespec/`; your out-of-band commits come
back as change cards to reconcile before building further. The sections below
are the full doctrine for each stage.

## Where to look — routing questions to the right source

NodeSpec owns **intent** (what should exist, what "done" means, how components
relate); the repo owns **actuality** (what the code currently does). Route
every question to the side that owns it — the classic failure is answering an
intent question from code (you'll invent requirements that were never asked
for) or an actuality question from NodeSpec (previews aren't files).

| You need… | Go to | NOT |
|---|---|---|
| What a node must do; its criteria; scope | The node's `.task.md` (repo) or `get_project_context` brief | Reading its source and inferring |
| Requirement wording, met/unmet state, exact criterion text for reporting | `list_requirements` (or `.nodespec/spec.json` for wording only — it never carries evidence state) | The test plan's paraphrase; your memory |
| The interface between two nodes | The CONTRACT (schema/kind/transport in the brief's Interface Contracts) | The counterparty's source code |
| What files implement this node | The brief's Existing Implementation table / the node's bound artifact paths (also in `.nodespec/model.json` → artifacts, no tool call needed) | Repo-wide grep by name similarity |
| What the code actually does; symbols, utilities, conventions, build config | Read/grep the repo files directly | Any MCP tool — `contentPreview` is a preview, never the file |
| Is anything pending/stale/drifted | `get_project_status` counts → `get_pending_changes` | Diffing the repo against `.nodespec/` yourself |
| Why a node isn't buildable | Scoped `get_build_readiness` | Guessing from compile errors |

Two hard routing rules:

- **Contracts beat counterparty code.** When integrating with another node,
  implement against its contract schema. If the contract is silent (no schema)
  the answer is a `schema` blocker + draft proposal — NOT "read their code and
  conform to it." Conforming to code creates an interface that exists nowhere
  in the model and will drift silently. Read counterparty source only to
  INFORM a schema draft you're proposing, never as a substitute for one.
- **When NodeSpec and the repo disagree,** the repo wins on what code IS,
  NodeSpec wins on what code SHOULD BE — and the disagreement itself is the
  finding: reconcile pending cards first; if none exist, surface the mismatch
  to the user (an `update_requirement` call or an `update_contract` patch
  proposal, or a plain question) instead of quietly picking a side.

## Designing architecture: the catalog is the vocabulary

Every node's `type` is a catalog role id and its `technology` a catalog
technology id. Proposing an invented id is the most common way an
architecture proposal comes back wrong.

1. **`search_catalog(query)`**: one call per capability you need
   ("postgres", "message queue"). Each result carries its id, `when_to_use`,
   a nature line, and for a role its `holds` line: whether it runs, places
   or groups what it holds, or is a leaf, and what it may hold. The
   `guidance` legend is the vocabulary: `treatment` (leaf: you author its
   code; boundary: you configure or call it, never author its internals;
   container: it holds other nodes), `ownership` and `configMode`.
2. **`lookup_catalog`** on each id you settle on: purpose, config mode,
   best practices, security guidance, SDK patterns, the docs URL, and for a
   role everything it may hold. A row marked MIGRATED or RETIRED names its
   successor.
3. **Then propose** with the ids exactly as the catalog spells them.

The rules the catalog encodes:

- **A node has one parent**, and sits only where its parent may hold it;
  a proposal that breaks it is refused naming what the parent holds. The
  placement follows how the parent holds, so leave `placementKind` unset.
- **Logical groups** (`application-module`, `bounded-context`,
  `microservice-boundary`, `software-layer`) are optional organization:
  nothing runs in them. A group whose nodes all run on one host sits inside
  that host.
- A **boundary** node is never decomposed: you configure or call it.
- **Provider-branded managed services** (technology ids prefixed `aws-`,
  `azure-`, `gcp-` and the like) belong inside their provider's platform
  node; create it first.
- **If nothing fits, say so.** The user can define a custom node in the
  app. Never invent a catalog id.

This edition ships a curated starter catalog, so a search returns fewer
rows than a larger catalog would; the vocabulary and the rules are the same.

### Where it runs

- **The code is the node.** Its role says what job it does, its technology
  the framework (Express, FastAPI, Next.js).
- **The runtime that runs portable code is its host**: a container, a
  virtual machine, a cluster, or a managed runtime that only runs it. Put
  the node inside the host and keep its framework; the host's task document
  writes the deploy definition (Dockerfile, compose service, manifest) for
  each node it runs.
- **Code written against a platform's own API is a leaf** with the platform
  as its technology (a Lambda, a Cloudflare Worker), placed in its cloud
  account. Its platform configuration is its own. Engines (n8n, Airflow)
  are leaves too.
- **A managed service** (a database, a queue, a bucket) sits in the network
  or account it lives in.
- **A network link** (VPN, NAT, a private endpoint) is a Network Connection
  inside the VPC it serves.
- Each task document says where its node runs (**Runs on:** the chain up to
  the account, and the host with its technology).

## Patch discipline: how graph writes actually behave

`propose_patches` carries ALL graph writes, and its validator is strict so
that mistakes fail loudly instead of landing quietly:

- **Unknown keys in `changes` are REFUSED by name, never silently dropped.**
  The refusal lists the offending keys and the known fields for that entity —
  read it, fix the keys, resubmit. A node's configuration lives at
  `changes.metadata.config`, not at a top-level `configuration` key.
- **`update_node` metadata is replaced wholesale.** Read the node first and
  send the COMPLETE metadata object — a partial metadata write erases the
  keys you left out (including `config`).
- **When a project ruling contradicts catalog guidance** (an accepted
  requirement pins a different language or pattern than the technology's
  catalog entry suggests), set `changes.metadata.suppressCatalogGuidance:
  true` on the affected node(s): its task packet drops the catalog guidance
  section and defers to the project's own Implementation Context. Removing
  the flag restores the guidance. Never fight the catalog by hand-editing
  packet text — packets regenerate.
- **Validation errors name exact fields** and no proposal is created on
  failure — fix and resubmit; there is nothing to clean up.
- **`get_proposal_status`** reports the effective outcome: once a proposal's
  patches have settled, the status you read reflects what actually happened
  to them. Trust it over your memory of what you submitted.

## Multi-artifact nodes & cross-node integrations

A node is a single unit of varying scale in a system representing related modular logic or platforms; ALL artifacts bound to it are one deliverable. Depending on the user's use case for example, a node could represent a class within a single program, or a collection of services that would be too noisy to map otherwise.

- **Scan set = the bound set.** When implementing or modifying a node, read
  exactly its bound artifact files (plus the schema artifacts its contracts
  reference) — not the whole repo. Add repo-wide searches only for symbols and
  conventions, not for scope discovery.
- **New files you create for a node get BOUND to it**: include `add_artifact`
  patches (with `nodeId`) in your proposal so the graph tracks them —
  unbound files are invisible to freshness, staleness, and future briefs.
  One node's implementation + its config + its schema artifacts can and
  should be several artifacts; don't glue them into one file to keep the
  count down.
- **A file bound to ANOTHER node is that node's work.** If your change
  requires touching it, stop: that is a cross-node change traveling through
  an interface. Route it through the contract (propose the schema/contract
  change) or tell the user the other node needs work — its own task doc is
  the brief for that. The one exception is a shared schema artifact
  referenced by both sides' contracts: propose the update once and note both
  consumers.
- **Boundary/engine nodes** (n8n, managed services): their bound artifacts
  are definitions and connection config, never reimplementations — if you
  find yourself writing application code for one, re-read its brief.

## The loop

### 0. Orient (once per session)
`get_project_status(project_id)` → phase, counts, `nextAction`. If the project
is git-connected and you have the repo checked out, prefer reading
`.nodespec/tasks/*.task.md` and `.nodespec/tests/*.tests.md` from the repo —
they are the same documents the MCP serves, and reading files is cheaper than
tool calls. Check `pendingRepositoryChanges`: if non-zero, reconcile FIRST via
`get_pending_changes` → `resolve_change` (classify each: residue to clean, real
change to accept with patches, noise to dismiss). Never build on unreconciled
drift.

`nextAction` may lead with EXPANSION REQUESTED: the person pressed Expand on
a node in the canvas and the request waits for you (MCP is not event driven;
`stagedExplodes` lists the nodes). Read the node (`get_project_context` view
`slice` says it too), claim its lease (`checkout_task` level `node`) and
propose ONE `explode_node`. Once it is proposed the status says it waits for
the person; do not propose it again.

### 1. Preflight (per work batch)
`get_build_readiness(project_id, branch_id)` — unscoped returns SUMMARY:
per-node `{ready, blockerCounts, advisoryCounts}`, `buildOrder`, and ONE
`remediations` map keyed by gap kind. Pick the first not-ready node in
`buildOrder`, then re-call scoped: `node_ids: [<that node>]` for full gap
detail. Do not request `detail:'full'` unscoped.
The `chain` block reports what the project lacks from vision to
requirements: a vision the outcomes cite (`serves` on `create_candidate` /
`update_candidate`), an outcome behind every requirement. Nothing waits on
it; close its gaps alongside the build.

### 2. Clear blockers before writing any code
- **`schema` blockers**: each carries `draftInputs` — both endpoint
  technologies, the counterparty's real API endpoints, the criteria being
  served, and a `suggestedSpecFormat`. Draft every missing schema FROM THOSE
  INPUTS (never from memory of what an API "usually" looks like), then submit
  ALL drafts as **one** `propose_patches` batch of `update_contract` patches
  (`changes.schema` = the JSON object, `changes.specFormat` = the format you
  actually wrote). Then STOP on those contracts until the user accepts. A
  `⚠ SCHEMA REFERENCE BROKEN` detail means re-link, not re-draft: propose an
  `update_contract` patch whose `changes.schemaRef` is the uuid of an
  ACCEPTED `kind='schema'` artifact (never one from a still-pending proposal).
- **`owner` blockers**: settle with the user via `map_requirement` (or
  `update_requirement` if the requirement itself is wrong). Never guess an
  owner.
- **`doc` blockers**: `generate_task_docs(node_ids: [...])`, then have the user
  accept the proposal.
- **Advisories** (config, mapping, tests, classification) inform; they never
  block. The fix for each kind is in `remediations` — read it there, once.

### 3. Implement (per node, in buildOrder)
Get the brief: the node's `.nodespec/tasks/<node>.task.md` from the repo, or
`get_project_context(target_type:'node', target_id, view:'brief')`. The brief
IS the implementation spec: work the T-numbered tasks in order. Your read set
is the node's bound artifacts (see "Multi-artifact nodes" above) — open those
files; grep wider only for symbols and conventions. Honor
`## Configuration` values (user decisions), respect `Never decompose its
internals` on boundary nodes, execute `## Manual Steps` by telling the USER
what to do (you cannot do console clicks for them). Only request
`view:'structured'` when you need machine-readable fields you'll transform
(never for prose context); `view:'full'` almost never. To check what moved
around a node while you work on it, read `view:'slice'`: every edge with its
full contract, its consumers' expectations, its requirements, tasks, tests
and leases, the vision sentences that apply, and its memory
(decisions, changes, hand-offs, its learning, criteria proven at a commit,
each with who and commit; an entry flagged `review` was written before the
node's context changed: re-check it before you rely on it), with its size
beside the whole spec's and what it left out. Keep its `fingerprint` and pass it back as `since`;
only the sections that changed come back. `budget` caps it in tokens.

Before building a work order, write its **steps** under its task line: one
indented checkbox line per step (`  - [ ] <step>`), with any detail indented
further under its step. Write them into the stored doc with `propose_patches`
`update_artifact`, passing `base_sequence` (the `headSequence` you read the
doc at); if another agent changed the doc first, yours is set aside as a stale
read: read it again and add your lines to it. Steps stay with their work order
when the doc regenerates. `generate_task_docs` lists the open work orders with
no steps (`workOrdersWithoutSteps`, with the doc's `artifactId`) and the format
(`stepFormat`). When a work order is reworded or removed, its steps move to
`### Steps to review` at the end of Implementation Tasks, each group under
`Written for T<n>: <title>` (`stepsToReview` counts them): move each step
under the work order it belongs to, or delete it.

### 4. Verify (per requirement the node serves)
Doctrine: **plans follow schemas — schemas → plans → implement → verify.**
Test budget: **ONE binding test per acceptance criterion first** — that is
the smoke tier, and "verified (smoke)" on the board is a legitimate state,
not a shortcut. Defer deep-tier tests (edge cases, load, property tests)
until the requirement's smoke tier is green. More cases per criterion is
sprawl to consolidate, not rigor — `get_project_status`'s `testBudget`
gauge flags over-tested requirements, and an over-budget
`report_test_results` write returns a consolidation nudge: merge
overlapping cases into the strongest one per criterion, retiring the
losers via `update_test_case` (`retire: true` + reason — never a hard
delete; the row survives and a fresh report revives it). The same tool
fixes a mistyped `test_id`, moves a case to the requirement it actually
verifies (`reassign_to` — it arrives deliberately stale; re-run there),
and re-binds a case after a criterion reword (`criterion_text`; binding
alone never flips met).
- `get_test_plan(project_id, branch_id, requirement_id)`. The plan you
  receive is CURRENT by construction: the server compares the stored plan's
  fingerprint against the live graph on every read and regenerates on the
  spot when inputs moved (a `refreshed: true` response says it just did,
  and the user's own Test Strategy edits are carried forward) — so never
  second-guess a served plan or try to force a regeneration. If
  `schemaBlockedContracts` is non-empty, resolve those first (step 2);
  blocked scenarios in the plan are markers, not work.
- Under each `#### AC-...` test case heading, write the test's **statements**,
  one checkbox line each (`- [ ] Given ..., when ..., then ...`, with a then
  that can be observed and names the file or API it checks); under a manual
  item, the same lines indented by two spaces. Write them into the plan
  (`testPlanArtifactId`) with `update_artifact` and `base_sequence`, as for
  steps. They stay with their criterion when the plan regenerates.
  `get_test_plan` lists the cases with none (`testCasesWithoutStatements`) and
  the format (`statementFormat`). A reworded or removed criterion's statements
  move to `#### Statements to review`, each group under a `Written for:` line
  that quotes the criterion (`statementsToReview` counts them): move each
  under its test case, or delete it.
- Implement the **Automated Test Scenarios** in the project's framework —
  derive Given/When/Then from each criterion; use the suggested `TC-` ids.
- Run them. Report EVERY outcome:
  `report_test_results(project_id, requirement_id, results:[{test_id, status,
  criterion_text, framework, artifact_path, source_artifact_ids?}])` —
  `criterion_text` must be the criterion's EXACT wording (copy from
  `list_requirements` or the plan; the match is exact, never fuzzy). Read the
  receipt: `flippedCriteria` is what you proved; `warnings` name unbound texts
  (fix the wording, re-report) and manual-lane refusals.
- **Manual Verification** items: never report these. Ask the user to perform
  the step; once they confirm, tick the criterion's box in the node's
  `.task.md` in the repo and push — the user approves the resulting change
  card. That approval, not your say-so, flips the criterion.
- **Working beside other agents? Claim the criterion first.**
  `checkout_task { level: 'criterion', ref_id: <requirement ROW uuid>,
  criterion_id: <the criterion's id — list_requirements serves it on every
  criterion> }`. The lease is exclusive (one criterion, one binding test,
  one reported outcome): a refusal names the holder — verify a different
  criterion instead of duplicating their work. Release it or let evidence
  end it; 30 silent minutes makes it reclaimable.
- **Write the failing test first, and REPORT the red.** A `failed` report
  is not a mistake to hide: it flips `met` to false with provenance — a
  genuine, auditable RED, the first half of the TDD cycle the lane is built
  for. Implement, re-run exactly the failing tests, report the green.
- A **failing** result is correct data — report it, fix the code, re-run
  exactly the failing tests, re-report. Fresh passes clear staleness.

### 5. Close the node
`mark_entity_complete(project_id, node_id)` records your declaration and returns
the still-unmet criteria. If any remain, you are not done; go back to step 4.
Then return to step 1 for the next node in `buildOrder`.

## Git-connected projects
Pushes from NodeSpec refresh stale task docs and test plans automatically:
after the user accepts schema proposals, the regenerated docs land in the next
push, so re-read them rather than trusting your cached copy. Commits made
outside NodeSpec, yours included, come back as change cards (and stale test
cases). That is the system working: reconcile each card, then re-run and
re-report.

**Reconcile a card in one read and one write.** `get_pending_changes` lists
the cards; `get_pending_changes` with `change_event_id` answers one card's
reconcile packet:

- `files`: each changed file with its action, its `owner` (the node its
  binding names) or a `suggestion` (the node that owns the nearest
  bound directory, with the reason), `newDirectory` when it sits in a
  directory the change adds, and its `kind` (task doc, test, spec or model
  anchor).
- `nodes`: each touched node's role, technology, contracts in and out with
  the node on the other end, mapped requirements (locked, confirmed), tests,
  live holds (yours marked `mine`), task-doc freshness, and
  `lastFileRemoved`.
- `signals`: `{ available: false }` in this edition. Read the changed files
  yourself for new routes, dependencies and service directories.
- `classification`: content-only, needs-binding, structural, spec,
  model-edited, conflicts; `conflicts` names each node and why (a locked
  requirement, someone else's hold).
- `draft`: intents for `resolve_change` (add_node with a `ref`, bind_file,
  connect_nodes, each citing `evidence: [{ path, line, note }]`), and notes
  for what only you can judge (a removed route, a node with no files left,
  a new outbound host).

Then act on what the change is:

- content-only: `resolve_change` accepted, with the card's `commitSha`.
- needs-binding or structural: `resolve_change` accepted with `intents`, the
  draft as it stands or edited. They file ONE proposal the user reviews with
  its evidence; the card resolves when they accept it, and the bound files'
  bytes come from the card's commit.
- conflicts: a locked requirement is the user's to unlock and held work is
  the holder's. Say so and leave the card; never resolve over them.
- spec or model-edited: the card offers a load of `.nodespec/spec.json` or
  `.nodespec/model.json`, which the user decides in the Git panel.

Never file an intent the packet or your own reading gives no evidence for,
and cite the file and line you read.

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
push and clears the entries — a declared file needs no proposal round-trip.
Files you do NOT declare arrive as unattributed residue for someone to
classify by hand, so declaring is the cheap path, not extra work.

Only NEW files: once a file is bound it lives in `.nodespec/model.json` and
must never be re-declared. Never declare anything under `.nodespec/` — those
are generated. An entry naming a component that does not exist is reported
back, not created: architecture changes still go through `propose_patches`.

**The board file.** Every NodeSpec push writes `.nodespec/BOARD.md` — one
checkbox line per acceptance criterion and per implementation task, grouped
by requirement, with a derived status line. It is a PROJECTION of the design
state: tick boxes to record completion (ingested on the next push or webhook,
applied after user approval, exactly like task-doc ticks) but never edit the
text — lines are matched exactly, and the file regenerates on every push.
An assistant that has never heard of NodeSpec can work the project from this
one file.

**Push code; propose bindings.** When a proposal needs to bind files whose
content you already pushed to git, do NOT paste the file bodies into
`propose_patches`. Push the commit first, then submit the `add_artifact`
patches WITHOUT `content` and pass `content_ref: "<pushed commit sha>"` —
NodeSpec pulls the bytes from git when the user accepts. One call can bind
dozens of files this way; the sha pins exactly what you pushed. The commit
must be pushed and reachable before the user accepts, or the accept fails
naming the missing paths.

## Token discipline (why this skill exists)
- Repo files beat tool calls when both exist (`.nodespec/` is the same truth).
- `view:'brief'` unless transforming structured fields.
- Readiness: summary → ONE scoped call per node you're actually building.
- One `get_test_plan` per requirement per change of its inputs — not per
  session.
- Batch: all schema drafts in one proposal; all test outcomes for a
  requirement in one report.
- Large proposals: stream as a chunked session — `finalize: false` starts a
  staged (invisible) session, append batches with the returned `proposal_id`,
  `finalize: true` on the last call submits everything as ONE proposal.
  Sessions expire after 30 idle minutes; never leave one unfinalized. Calls
  cap at 500 patches each.
- Truncation honesty: on any call with more than ~20 patches, pass
  `expected_patch_count` — a shorter delivery then fails loudly instead of
  creating a fragment. Always compare the response's `patchCountThisCall`
  with what you sent before telling the user a proposal is complete.
- Don't paste tool responses back into your own messages; act on them.
- The endpoint holds each credential to a burst of 60 calls, then 4 a second
  (240 a minute). A 429 carries Retry-After in seconds: wait that long, then
  retry once; batch the work instead of looping.

## Tool reference — the tools by job

Grouped by the question you are answering. Every tool takes `project_id`
(name or UUID) unless noted. Read tools are cheap but not free — see token
discipline above.

**Orient — "where am I, what's next"**
| Tool | Use when |
|---|---|
| `list_projects` | Resolve which project the user means; list what exists |
| `get_project_status` | START HERE each session: phase, counts, pending drift, `nextAction` |
| `get_architecture_overview` | The whole topology at once (Mermaid) — orientation, not implementation detail |

**Spec plane — "capture intent"**
| Tool | Use when |
|---|---|
| `update_vision` | Set the product vision — the user's words, asked for, never inferred from code |
| `create_requirement` | Add a requirement with acceptance criteria (criteria start unmet, always); `section` files it under a named section, created when absent |
| `update_requirement` | Reword, re-criterion, reprioritize, or re-section an existing requirement (`section` name moves it; null clears) Locked means locked: a locked requirement refuses every write; no tool unlocks, the user does in the app. |
| `delete_requirement` | Last resort for disposable drafts only — refused (without `force`) when mapped or carrying test evidence (deletion cascades it away). Prefer supersession: `create_requirement` + `expands` relation archives the original; `update_test_case` retires its cases with history intact |
| `map_requirement` | Bind a requirement to the node(s) serving it — this is the traceability edge |
| `relate_requirements` | Declare lineage between requirements: `expands` (the newer supersedes and archives the completed older one), `depends_on` (ordering), `relates_to` (loose). Binding a requirement to nodes is `map_requirement` |
| `list_requirements` | Exact criterion wording + met/unmet state — the source for `criterion_text` |

**Build — "implement the next node"**
| Tool | Use when |
|---|---|
| `get_build_readiness` | Preflight: summary first, then ONE scoped re-call per node you will build |
| `get_project_context` | The node brief (`view:'brief'`) when the repo's `.task.md` isn't at hand; `view:'slice'` for what moved around the node. The structured view and the slice say what the node may hold and what its parent holds |
| `generate_task_docs` | Regenerate stale/missing task packets (doc blockers). A doc's `## Added Tasks` section holds tasks a person added by hand in the app; regeneration carries it verbatim, and you build those tasks like the generated work orders. Lists the work orders with no steps |
| `propose_patches` | ALL graph writes: nodes, edges, contracts, schema drafts, artifact bindings: always a proposal, never direct. See "Patch discipline" above. For files already pushed to git, omit `content` and pass `content_ref` (push code; propose bindings) |
| `get_proposal_status` | Did the user accept what you proposed — the status reflects the settled outcome |
| `mark_entity_complete` | Declare a node done — returns any still-unmet criteria (believe them) |

**Verify — "prove it"**
| Tool | Use when |
|---|---|
| `get_test_plan` | Per requirement: the scenarios to implement (schemas → plans → implement → verify; budget: one binding test per criterion first). Served plans are freshness-checked at read time — trust what you receive. Lists the test cases with no statements |
| `report_test_results` | EVERY outcome you actually ran, exact `criterion_text` — this is what flips criteria; heed the testBudget nudge |
| `update_test_case` | Fix a mistyped `test_id`, move a case to the requirement it actually verifies (`reassign_to` — it arrives stale, re-run there), retire a superseded case (`retire` + reason — never a hard delete; a fresh report revives it), or re-bind after a criterion reword (`criterion_text`, exact text; binding alone never flips met) |

**Work loop: "what should I build next" (safe beside other agents)**
| Tool | Use when |
|---|---|
| `get_work_queue` | Top of an autonomous loop: the next unblocked tasks in build order, with who holds what. Its `activeHolds` is the whole lease board (your holds marked `mine`) |
| `checkout_task` | Claim before working: level task (default), code, criterion (`ref_id` = requirement row uuid + `criterion_id`) or node (`node_id`: its structure is locked while you hold it; name the files in `touches` so others can work beside you). A refusal names the holder; take the next entry. A hold silent for 30 minutes is claimable |
| `checkout_heartbeat` | Between work steps: keeps your lease fresh and publishes progress |
| `release_checkout` | Stepping away without evidence: 'released' with a `note` saying where the work stands. A passing `report_test_results` releases your task leases on that requirement as 'verified' |

**Outcomes and approvals**
| Tool | Use when |
|---|---|
| `get_outcome_board` | Before drafting outcomes or requirements from them: the pending outcomes with criteria ids, what is already claimed, and who holds what |
| `resolve_proposal` | Accept or reject a pending spec proposal only when the user tells you to; a promotion is accepted by the user in the app, never by your key |
| `list_project_members` | Who is on the project and what your own access allows |

**Git drift: "the repo changed out of band"**
| Tool | Use when |
|---|---|
| `get_pending_changes` | List unreconciled change cards after out-of-band commits — each card also surfaces checkbox ticks it carries (`criterionDeltas` for acceptance criteria, `taskDeltas` for anchored implementation tasks) |
| `resolve_change` | Classify each card: accept with patches, clean residue, or dismiss noise. Pass the card's `commit_sha` as `get_pending_changes` returned it: a card that moved on to cover newer commits is refused, so read it again. Ticks split by kind: a criterion tick is the user's to apply in the Git panel, so an accept leaves the card pending for them (`waitingForPerson` says what waits); task ticks follow the Tasks setting (Auto-apply: accept with `apply_ticks: true`; Propose: they wait for the user; Ask first: the accept is refused). Ticks apply only on accept, never twice, and unticked boxes never retract evidence. With patches, the patches are filed as a proposal and the card stays pending until the user accepts it (`reconcileProposalId` on the card); leave the card alone meanwhile |

**Catalog — "what roles/technologies exist"**
| Tool | Use when |
|---|---|
| `search_catalog` | Find role and technology ids by capability or name (before proposing nodes or setting technology) |
| `lookup_catalog` | Full detail on one known id |

**Keys & projects — "connection admin" (rare; usually the user's job in the app)**
| Tool | Use when |
|---|---|
| `create_api_key` / `list_api_keys` / `revoke_api_key` | Mint, audit, or revoke MCP API keys when the user asks |
| `create_project` | Start a brand-new project |

## When something looks wrong
Contradictions between the brief and the live graph, criteria that can't be
tested as written, requirements that seem to belong to a different node — raise
them to the user via the named tools (`update_requirement`, `map_requirement`,
an `update_contract` patch proposal), never by silently building your own
interpretation. NodeSpec's cards and proposals exist so the human rules once,
in one place, with provenance.
