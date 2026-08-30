---
name: nodespec-developer
description: Drive implementation work on a project managed by NodeSpec (the user has the NodeSpec MCP server connected). Use whenever the user asks to build, implement, continue, or verify work on a NodeSpec project — "build the next node", "implement REQ-007", "work through the backlog", "run the verification loop", "what should I build next" — whenever they ask to import, visualize, or reverse-engineer an existing repository into NodeSpec ("import my repo", "map this codebase", "get my project onto the canvas"), or whenever a repo contains a .nodespec/ directory (model.json / spec.json / tasks/ / tests/). NodeSpec is the source of truth for architecture, requirements, and acceptance criteria; this skill defines the exact tool loop, the repo-import and spec-backfill workflow, the honesty rules that prevent invented schemas and unearned completions, and the token discipline. Do NOT use for editing the NodeSpec application's own source code.
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

## Importing an existing repo (first-time visualization)

When the user wants an existing codebase on the NodeSpec canvas, ONE tool
carries the whole flow: `run_repo_import` (Indie tier and above — a
Community account gets a refusal naming the upgrade path). Never build the model by hand —
do not scan the repo and `propose_patches` nodes yourself; the deterministic
pipeline classifies, groups, and synthesizes with provenance, and your job is
judgment over its output, not re-derivation.

Preconditions: the project exists, the repo is connected in the app's Git
panel, and the canvas is empty (a populated canvas or a repo carrying
`.nodespec/model.json` is refused — those are adopt/drift territory).

**Phase 1 — drive.** Call `run_repo_import(project_id)`. A `running` response
means call it again — completed work replays instantly. Most repos stage in
one call.

**Phase 2 — review and decide.** The staged response is the complete review
package: per-group frames with evidence, the draft's nodes/edges/contracts,
per-node **signals** (declared routes, outbound HTTP clients, manifest deps,
top imports, deployment surfaces), open questions, review hints, and the
import doctrine. Actually review it — rubber-stamping defeats the lane:
- Answer every open question; fix generic labels; verify roles.
- Missing relationships are usually visible in the signals: a node with
  `outboundHttp` calling a node with `routes` is an `add_edges` candidate,
  citing both sides as evidence. Never ask for the repo URL — the signals
  section replaces file reading.
- Tag stacks the pipeline could not infer: `set_technology` with catalog ids
  (`search_catalog` when unsure). Untagged nodes render generic on the canvas.
Then call `run_repo_import` again with `decisions`: `{approve: true}` or the
bounded revisions (renames, role_changes, set_technology, drop_nodes,
add_edges with evidence, drop_edges). This promotes ONE proposal into the app.

**Phase 3 — the user accepts in the app.** The proposal appears in their
review panel; you cannot accept it for them. Tell them it is ready and wait.

**Phase 4 — spec backfill (do NOT stop at acceptance).** An accepted import
is structure without intent — half an import. As soon as the user confirms
acceptance (or your next `run_repo_import` call reports state `accepted`
with coverage gaps), run the backfill workflow in this order:
1. `update_vision` — ask the user for their product vision in THEIR words
   first; never write vision from the code.
2. `create_requirement` — propose requirements with acceptance criteria for
   what the code evidently does; criteria START UNMET (existing code proves
   nothing until tested). Group related requirements as you go with the
   `section` parameter (a section name — created when absent).
3. `map_requirement` — bind each requirement to the node(s) serving it.
Repeat 2–3 until `run_repo_import` reports empty coverage (it lists exactly
which nodes still lack requirements). Then hand off to the normal build loop
below — readiness, briefs, test plans all activate once the spec plane exists.

Restart semantics: `restart=true` only after a failure, or when the user
explicitly wants a fresh re-analysis over an existing canvas or accepted
import. A `rejected` proposal means ask the user what was wrong FIRST.

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

## Tool reference — the 30 tools by job

Grouped by the question you are answering. Every tool takes `project_id`
(name or UUID) unless noted. Read tools are cheap but not free — see token
discipline above.

**Orient — "where am I, what's next"**
| Tool | Use when |
|---|---|
| `list_projects` | Resolve which project the user means; list what exists |
| `list_branches` | Get the branch_id that scoped calls need (main is default) |
| `get_project_status` | START HERE each session: phase, counts, pending drift, `nextAction` |
| `get_architecture_overview` | The whole topology at once (Mermaid) — orientation, not implementation detail |

**Import — "get this repo onto the canvas"**
| Tool | Use when |
|---|---|
| `run_repo_import` | THE import tool, every state: drive the pipeline, receive the staged package, submit `decisions`, and after acceptance read backfill coverage. See the import section above |

**Spec plane — "capture intent" (the backfill workflow lives here)**
| Tool | Use when |
|---|---|
| `update_vision` | Set the product vision — the user's words, asked for, never inferred from code |
| `create_requirement` | Add a requirement with acceptance criteria (criteria start unmet, always); `section` files it under a named section, created when absent |
| `update_requirement` | Reword, re-criterion, reprioritize, or re-section an existing requirement (`section` name moves it; null clears) |
| `delete_requirement` | Last resort for disposable drafts only — refused (without `force`) when mapped or carrying test evidence (deletion cascades it away). Prefer supersession: `create_requirement` + `expands` relation archives the original; `update_test_case` retires its cases with history intact |
| `map_requirement` | Bind a requirement to the node(s) serving it — this is the traceability edge |
| `relate_requirements` | Declare depends-on/refines/conflicts between requirements |
| `set_requirement_lock` | Freeze a settled requirement against further edits |
| `list_requirements` | Exact criterion wording + met/unmet state — the source for `criterion_text` |

**Build — "implement the next node"**
| Tool | Use when |
|---|---|
| `get_build_readiness` | Preflight: summary first, then ONE scoped re-call per node you will build |
| `get_project_context` | The node brief (`view:'brief'`) when the repo's `.task.md` isn't at hand |
| `generate_task_docs` | Regenerate stale/missing task packets (doc blockers) |
| `propose_patches` | ALL graph writes: nodes, edges, contracts, schema drafts, artifact bindings — always a proposal, never direct. For files already pushed to git, omit `content` and pass `content_ref` (push code; propose bindings) |
| `get_proposal_status` | Did the user accept what you proposed |
| `mark_entity_complete` | Declare a node done — returns any still-unmet criteria (believe them) |

**Verify — "prove it"**
| Tool | Use when |
|---|---|
| `get_test_plan` | Per requirement: the scenarios to implement (schemas → plans → implement → verify; budget: one binding test per criterion first) |
| `report_test_results` | EVERY outcome you actually ran, exact `criterion_text` — this is what flips criteria; heed the testBudget nudge |
| `update_test_case` | Fix a mistyped `test_id`, move a case to the requirement it actually verifies (`reassign_to` — it arrives stale, re-run there), retire a superseded case (`retire` + reason — never a hard delete; a fresh report revives it), or re-bind after a criterion reword (`criterion_text`, exact text; binding alone never flips met) |

**Git drift — "the repo changed out of band"**
| Tool | Use when |
|---|---|
| `get_pending_changes` | List unreconciled change cards after out-of-band commits — each card also surfaces checkbox ticks it carries (`criterionDeltas` for acceptance criteria, `taskDeltas` for anchored implementation tasks) |
| `resolve_change` | Classify each card: accept with patches, clean residue, or dismiss noise. When a card carries ticks, accept with `apply_ticks: true` — that single call flips the ticked criteria met and marks the tasks done with git provenance. Ticks apply only on accept, re-resolving cannot double-apply, and unticked boxes never retract evidence |

**Catalog — "what roles/technologies exist"**
| Tool | Use when |
|---|---|
| `search_catalog` | Find role and technology ids by capability or name (before role_changes / set_technology) |
| `lookup_catalog` | Full detail on one known id |

**Keys — "connection admin" (rare; usually the user's job in the app)**
| Tool | Use when |
|---|---|
| `create_api_key` / `list_api_keys` / `revoke_api_key` | Mint, audit, or revoke MCP API keys when the user asks |
| `create_project` | Start a brand-new project (respects the account's project limit) |

## When something looks wrong
Contradictions between the brief and the live graph, criteria that can't be
tested as written, requirements that seem to belong to a different node — raise
them to the user via the named tools (`update_requirement`, `map_requirement`,
`update_contract` proposals), never by silently building your own
interpretation. NodeSpec's cards and proposals exist so the human rules once,
in one place, with provenance.
