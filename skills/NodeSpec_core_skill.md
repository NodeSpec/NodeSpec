---
name: nodespec-developer
description: Drive implementation work on a project managed by NodeSpec (the user has the NodeSpec MCP server connected). Use whenever the user asks to build, implement, continue, or verify work on a NodeSpec project — "build the next node", "implement REQ-007", "work through the backlog", "run the verification loop", "what should I build next" — or whenever a repo contains a .nodespec/ directory (model.json / spec.json / tasks/ / tests/). NodeSpec is the source of truth for architecture, requirements, and acceptance criteria; this skill defines the exact tool loop, the honesty rules that prevent invented schemas and unearned completions, and the token discipline. Do NOT use for editing the NodeSpec application's own source code.
---

# NodeSpec Development Loop

You are implementing software whose architecture, requirements, and acceptance
criteria live in NodeSpec. NodeSpec assembles deterministic, trusted context;
you supply the code. Three rules override everything else:

1. **Never invent what NodeSpec marks missing.** `⚠ SCHEMA UNDEFINED`,
   `[PLACEHOLDER: …]`, and `[blocked by schema: …]` are stop signs, not
   invitations. The resolution path is always named in the same payload.
2. **Never claim what you haven't proven.** Criteria flip only through evidence
   (test results you actually ran) or the user's approval of a tick. "Never
   report a result you did not actually run or that the user ran on their own test bench with confirmation if you prompt them" is a hard rule. If the user inquires on the status of an acceptance, ask if they confirmed.
3. **Fetch once, act, report.** The tools are dieted; don't undo that by
   re-fetching. One brief per node, one plan per requirement, summary-first
   readiness.

## Where to look — routing questions to the right source

NodeSpec owns **intent** (what should exist, what "done" means, how components
relate); the repo owns **actuality** (what the code currently does). Route
every question to the side that owns it — the classic failure is answering an
intent question from code (you'll reverse-engineer requirements that were
never asked for) or an actuality question from NodeSpec (previews aren't
files).

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
  to the user (`update_requirement` / `update_contract` proposal or a plain
  question) instead of quietly picking a side.

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

### 1. Preflight (per work batch)
`get_build_readiness(project_id, branch_id)` — unscoped returns SUMMARY:
per-node `{ready, blockerCounts, advisoryCounts}`, `buildOrder`, and ONE
`remediations` map keyed by gap kind. Pick the first not-ready node in
`buildOrder`, then re-call scoped: `node_ids: [<that node>]` for full gap
detail. Do not request `detail:'full'` unscoped.

### 2. Clear blockers before writing any code
- **`schema` blockers**: each carries `draftInputs` — both endpoint
  technologies, the counterparty's real API endpoints, the criteria being
  served, and a `suggestedSpecFormat`. Draft every missing schema FROM THOSE
  INPUTS (never from memory of what an API "usually" looks like), then submit
  ALL drafts as **one** `propose_patches` batch of `update_contract` patches
  (`changes.schema` = the JSON object, `changes.specFormat` = the format you
  actually wrote). Then STOP on those contracts until the user accepts. A
  `⚠ SCHEMA REFERENCE BROKEN` detail means re-link, not re-draft: fix
  `changes.schemaRef` or use `link_schema_artifact`.
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
(never for prose context); `view:'full'` almost never.

### 4. Verify (per requirement the node serves)
Doctrine: **plans follow schemas — schemas → plans → implement → verify.**
- `get_test_plan(project_id, branch_id, requirement_id)`. If
  `schemaBlockedContracts` is non-empty, resolve those first (step 2); blocked
  scenarios in the plan are markers, not work.
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
- A **failing** result is correct data — report it, fix the code, re-run
  exactly the failing tests, re-report. Fresh passes clear staleness.

### 5. Close the node
`mark_entity_complete(node_id)` — this records your declaration and returns
the still-unmet criteria. If any remain, you are not done; go back to step 4.
Then return to step 1 for the next node in `buildOrder`.

## Git-connected projects
Pushes from NodeSpec refresh stale task docs and test plans automatically —
after the user accepts schema proposals, the regenerated docs land in the next
push; re-read them rather than assuming your cached copy. Out-of-band edits you
make to bound source files will surface as change cards and stale test cases —
that is the system working; reconcile, re-run, re-report.

## Token discipline (why this skill exists)
- Repo files beat tool calls when both exist (`.nodespec/` is the same truth).
- `view:'brief'` unless transforming structured fields.
- Readiness: summary → ONE scoped call per node you're actually building.
- One `get_test_plan` per requirement per change of its inputs — not per
  session.
- Batch: all schema drafts in one proposal; all test outcomes for a
  requirement in one report.
- Don't paste tool responses back into your own messages; act on them.

## When something looks wrong
Contradictions between the brief and the live graph, criteria that can't be
tested as written, requirements that seem to belong to a different node — raise
them to the user via the named tools (`update_requirement`, `map_requirement`,
`update_contract` proposals), never by silently building your own
interpretation. NodeSpec's cards and proposals exist so the human rules once,
in one place, with provenance.
