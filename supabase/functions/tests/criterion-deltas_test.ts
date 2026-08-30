// R5a/R5b/R5c · completion provenance — the git→`met` lane.
//
// Owner requirement: a task marked complete — in NodeSpec, in git, or over MCP —
// must trace backwards to the origin requirement's acceptance criteria. Task docs
// already RENDER per-criterion `met` as `- [x]` checkboxes, and a task doc is a
// normal repo file, so a developer or an AI ticking a box is already producing the
// signal. Nothing read it. These pins hold the reader — and, more importantly, the
// three refusals that keep it honest:
//   1. EXACT text match only (no inference about reworded lines),
//   2. unticks are reported but NEVER applied,
//   3. the doc can never author a requirement the database does not know.
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";
import {
  parseTaskDocCriteria, computeCriterionDeltas, applicableDeltas, applyTickDeltas, summarizeDeltas,
} from "../_shared/criterion-deltas.ts";
import { applyCriterionDeltas } from "../_shared/git-drift.ts";

const DOC = `# Task: API Service

## Requirements — Your Scope

### REQ-001: Login works
Category: functional | Status: pending
Users can sign in.

**Acceptance criteria — your task boxes:**
- [x] password login succeeds
  → covered by Task T-1
- [ ] lockout after 5 failures
  → THIS NODE: internal logic

### REQ-002: Audit trail
**Acceptance criteria — your task boxes:**
- [x] every login is logged

## Implementation Tasks

- [x] this is NOT an acceptance criterion
`;

const current = {
  "REQ-001": [
    { text: "password login succeeds", met: false },
    { text: "lockout after 5 failures", met: false },
  ],
  "REQ-002": [{ text: "every login is logged", met: false }],
};

// ── R5a: the parser ───────────────────────────────────────────────────────────

Deno.test("parses checkboxes per REQ, in document order", () => {
  const parsed = parseTaskDocCriteria(DOC);
  assertEquals(Object.keys(parsed.requirements).sort(), ["REQ-001", "REQ-002"]);
  assertEquals(parsed.requirements["REQ-001"], [
    { text: "password login succeeds", checked: true },
    { text: "lockout after 5 failures", checked: false },
  ]);
});

// A checkbox in Manual Steps is a to-do, not evidence. Treating it as a criterion
// would fabricate completion out of unrelated prose.
Deno.test("checkboxes OUTSIDE the Requirements section are ignored", () => {
  const parsed = parseTaskDocCriteria(DOC);
  const all = Object.values(parsed.requirements).flat().map((c) => c.text);
  assert(!all.includes("this is NOT an acceptance criterion"));
});

Deno.test("indented back-reference lines are not criteria", () => {
  const parsed = parseTaskDocCriteria(DOC);
  const all = Object.values(parsed.requirements).flat().map((c) => c.text);
  assert(!all.some((t) => t.startsWith("→")), "the → sub-lines must not parse as boxes");
  assertEquals(parsed.requirements["REQ-001"].length, 2);
});

Deno.test("an empty or heading-less document yields nothing rather than throwing", () => {
  assertEquals(parseTaskDocCriteria("").requirements, {});
  assertEquals(parseTaskDocCriteria("just prose\n- [x] loose box").requirements, {});
});

Deno.test("uppercase [X] counts as ticked", () => {
  const parsed = parseTaskDocCriteria("## Requirements\n### REQ-001: X\n- [X] done\n");
  assertEquals(parsed.requirements["REQ-001"], [{ text: "done", checked: true }]);
});

// ── R5a: the diff ─────────────────────────────────────────────────────────────

Deno.test("a ticked box whose DB criterion is unmet is a tick delta", () => {
  const result = computeCriterionDeltas(parseTaskDocCriteria(DOC), current);
  assertEquals(result.deltas.filter((d) => d.direction === "tick").map((d) => d.text).sort(), [
    "every login is logged",
    "password login succeeds",
  ]);
  assertEquals(result.flagged, []);
});

Deno.test("an already-met criterion produces NO delta — nothing to do", () => {
  const result = computeCriterionDeltas(parseTaskDocCriteria(DOC), {
    ...current,
    "REQ-001": [{ text: "password login succeeds", met: true }, { text: "lockout after 5 failures", met: false }],
  });
  assert(!result.deltas.some((d) => d.text === "password login succeeds"));
});

// THE inference refusal.
Deno.test("a REWORDED criterion is flagged, never guessed onto its old text", () => {
  const result = computeCriterionDeltas(
    parseTaskDocCriteria("## Requirements\n### REQ-001: X\n- [x] password login succeeds quickly\n"),
    current,
  );
  assertEquals(result.deltas, [], "no delta — the evidence proved the OLD wording");
  assertEquals(result.flagged, [{
    requirementId: "REQ-001", text: "password login succeeds quickly", reason: "unknown-criterion",
  }]);
});

// Task docs are DERIVED artifacts; they must never become a back door for authoring.
Deno.test("a requirement the database does not know is flagged, never created", () => {
  const result = computeCriterionDeltas(
    parseTaskDocCriteria("## Requirements\n### REQ-999: Invented\n- [x] something\n"),
    current,
  );
  assertEquals(result.deltas, []);
  assertEquals(result.flagged[0].reason, "unknown-requirement");
});

// THE retraction refusal.
Deno.test("an UNticked box is reported as a delta but is NOT applicable", () => {
  const result = computeCriterionDeltas(
    parseTaskDocCriteria("## Requirements\n### REQ-001: X\n- [ ] password login succeeds\n"),
    { "REQ-001": [{ text: "password login succeeds", met: true }] },
  );
  assertEquals(result.deltas, [{ requirementId: "REQ-001", text: "password login succeeds", direction: "untick" }]);
  assertEquals(applicableDeltas(result), [], "a stale doc must never retract evidence a test proved");
});

Deno.test("summarize reports ticks, unapplied unticks and flags separately", () => {
  const text = summarizeDeltas({
    deltas: [
      { requirementId: "R", text: "a", direction: "tick" },
      { requirementId: "R", text: "b", direction: "untick" },
    ],
    flagged: [{ requirementId: "R", text: "c", reason: "unknown-criterion" }],
  });
  assert(text.includes("newly met"));
  assert(text.includes("not applied"));
  assert(text.includes("unrecognized"));
});

// ── R5c: applying ─────────────────────────────────────────────────────────────

Deno.test("applyTickDeltas sets met and stamps provenance, keeping other fields", () => {
  const { criteria, applied } = applyTickDeltas(
    [{ text: "a", met: false, note: "keep me" }, { text: "b", met: false }],
    [{ requirementId: "R", text: "a", direction: "tick" }],
    { source: "git", commitSha: "abc123", actor: "dev", at: "2026-07-31T00:00:00.000Z" },
  );
  assertEquals(applied, 1);
  assertEquals(criteria[0], {
    text: "a", met: true, note: "keep me",
    provenance: { source: "git", commitSha: "abc123", actor: "dev", at: "2026-07-31T00:00:00.000Z" },
  });
  assertEquals(criteria[1], { text: "b", met: false }, "untouched criteria keep their shape");
});

Deno.test("applyTickDeltas reads legacy bare-string criteria", () => {
  const { criteria, applied } = applyTickDeltas(
    ["a"],
    [{ requirementId: "R", text: "a", direction: "tick" }],
    { source: "git", at: "2026-07-31T00:00:00.000Z" },
  );
  assertEquals(applied, 1);
  assertEquals((criteria[0] as Record<string, unknown>).met, true);
});

Deno.test("applyCriterionDeltas writes only ticks, and only for known requirements", async () => {
  const fake = new FakeSupabase();
  fake.script("project_specifications", "select", { data: { id: "spec-1" } });
  fake.script("specification_requirements", "select", {
    data: { id: "row-1", acceptance_criteria: [{ text: "a", met: false }] },
  });
  fake.script("specification_requirements", "update", { data: null });
  const result = await applyCriterionDeltas(fake, "p1", {
    deltas: {
      deltas: [
        { requirementId: "REQ-001", text: "a", direction: "tick" },
        { requirementId: "REQ-001", text: "z", direction: "untick" },
      ],
      flagged: [],
    },
    commitSha: "deadbeef",
    actor: "dev",
  });
  assertEquals(result.applied, 1);
  assertEquals(result.requirementsTouched, ["REQ-001"]);
  const upd = fake.callsTo("specification_requirements", "update")[0].payload as Record<string, unknown>;
  const criteria = upd.acceptance_criteria as Array<Record<string, unknown>>;
  assertEquals(criteria[0].met, true);
  assertEquals((criteria[0].provenance as Record<string, unknown>).commitSha, "deadbeef");
});

Deno.test("applyCriterionDeltas with nothing applicable touches NOTHING", async () => {
  const fake = new FakeSupabase();
  const result = await applyCriterionDeltas(fake, "p1", {
    deltas: { deltas: [{ requirementId: "R", text: "a", direction: "untick" }], flagged: [] },
  });
  assertEquals(result.applied, 0);
  assertEquals(fake.calls.length, 0, "an untick-only card must not even read the spec");
});

// ── R5b/R5c wiring ────────────────────────────────────────────────────────────

const source = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));

Deno.test("R5b: only TASK-kind matches are read for criteria", () => {
  const src = source("../_shared/git-drift.ts");
  assert(src.includes('match.matches.filter((m) => m.kind === "task")'),
    "a ticked box in ordinary source is prose, not evidence");
  assert(src.includes("criterionDeltas"), "the deltas ride on the card");
});

Deno.test("R5b: a shared criterion appearing in several task docs is deduped", () => {
  const src = source("../_shared/git-drift.ts");
  assert(src.includes("the same tick must not be reported, or applied, twice"));
});

Deno.test("R5c: applying is an explicit card action, never part of the sweep", () => {
  const drift = source("../_shared/git-drift.ts");
  const pull = source("../git-pull/index.ts");
  // The sweep COMPUTES deltas; only the apply-criteria endpoint writes them.
  assert(!/runDriftSweep[\s\S]{0,8000}applyCriterionDeltas\(/.test(drift),
    "the sweep must not apply deltas — one approval, never silent");
  assert(pull.includes("mode === 'apply-criteria'") || pull.includes("requestMode === 'apply-criteria'"));
  assert(pull.includes("criteriaApplied"), "a card records that its criteria were applied (no double-apply)");
});

// ── A2: the (manual) suffix round-trip (docs/WORK_LOOP_PLAN.md) ───────────────
// The generator renders manual-lane criteria as `text (manual)` but the
// database stores the bare text. Before A2, ticking a manual criterion's box
// was flagged unknown-criterion — yet the doc, the test plan, and
// report_test_results all tell the AI that tick is the ONLY way a manual
// criterion flips. The matcher now retries with ONE trailing " (manual)"
// stripped, and the delta carries the STORED text so apply matches.

Deno.test("A2: a ticked (manual)-suffixed box round-trips onto its stored criterion", () => {
  const doc = `## Requirements

### REQ-010: Ops runbook
**Acceptance criteria — your task boxes:**
- [x] operator can rotate keys (manual)
- [ ] alert fires on failure
`;
  const parsed = parseTaskDocCriteria(doc);
  const result = computeCriterionDeltas(parsed, {
    "REQ-010": [
      { text: "operator can rotate keys", met: false },
      { text: "alert fires on failure", met: false },
    ],
  });
  assertEquals(result.flagged, [], "the manual tick must not be flagged");
  assertEquals(result.deltas, [
    { requirementId: "REQ-010", text: "operator can rotate keys", direction: "tick" },
  ]);

  // The full round-trip: the delta's stored text applies cleanly.
  const applied = applyTickDeltas(
    [{ text: "operator can rotate keys", met: false }],
    applicableDeltas(result),
    { source: "git", commitSha: "abc123", at: "2026-08-17T00:00:00Z" },
  );
  assertEquals(applied.applied, 1, "the stripped-match delta must actually apply");
  assertEquals(applied.criteria[0].met, true);
});

Deno.test("A2: a criterion whose GENUINE text ends in (manual) exact-matches first", () => {
  const doc = `## Requirements

### REQ-011: Docs
**Acceptance criteria — your task boxes:**
- [x] runbook documents the failover steps (manual)
`;
  // Stored text literally ends in "(manual)" — exact match wins; no strip.
  const result = computeCriterionDeltas(parseTaskDocCriteria(doc), {
    "REQ-011": [{ text: "runbook documents the failover steps (manual)", met: false }],
  });
  assertEquals(result.flagged, []);
  assertEquals(result.deltas, [
    { requirementId: "REQ-011", text: "runbook documents the failover steps (manual)", direction: "tick" },
  ]);
});

Deno.test("A2: a genuinely reworded line is still flagged — stripping is not inference", () => {
  const doc = `## Requirements

### REQ-012: Auth
**Acceptance criteria — your task boxes:**
- [x] users may rotate their keys (manual)
`;
  const result = computeCriterionDeltas(parseTaskDocCriteria(doc), {
    "REQ-012": [{ text: "operator can rotate keys", met: false }],
  });
  assertEquals(result.deltas, []);
  assertEquals(result.flagged, [
    { requirementId: "REQ-012", text: "users may rotate their keys (manual)", reason: "unknown-criterion" },
  ]);
});

Deno.test("A2: an UNTICKED (manual) box on a met criterion reports untick with stored text", () => {
  const doc = `## Requirements

### REQ-013: Ops
**Acceptance criteria — your task boxes:**
- [ ] operator can rotate keys (manual)
`;
  const result = computeCriterionDeltas(parseTaskDocCriteria(doc), {
    "REQ-013": [{ text: "operator can rotate keys", met: true }],
  });
  assertEquals(result.deltas, [
    { requirementId: "REQ-013", text: "operator can rotate keys", direction: "untick" },
  ]);
  assertEquals(applicableDeltas(result), [], "unticks stay non-applicable");
});
