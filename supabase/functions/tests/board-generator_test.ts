// D2 (docs/WORK_LOOP_PLAN.md): BOARD.md — a PROJECTION, never a second truth.
// Pins: byte-idempotent regeneration, the zero-prose grammar, the parse
// round-trip, tick ingestion DELEGATING to the existing delta lanes
// (tick-only asymmetry included), and merge dedup with task-doc deltas.
import {
  BOARD_PATH,
  renderBoardMd,
  parseBoardMd,
  computeBoardTickDeltas,
  mergeCriterionDeltaResults,
  mergeTaskDeltaResults,
  type BoardModel,
} from "../_shared/board-generator.ts";
import { taskAnchorKey } from "../_shared/task-deltas.ts";
import { assert, assertEquals } from "./helpers.ts";

const NODE_A = "11111111-1111-4111-8111-111111111111";
const K1 = taskAnchorKey("Scaffold the API component.");
const K2 = taskAnchorKey("Wire the database.");

function model(): BoardModel {
  return {
    requirements: [
      {
        requirementId: "REQ-002",
        name: "Rate limiting",
        status: "pending",
        archived: false,
        criteria: [{ text: "requests over quota get 429" }],
        nodes: [],
        tests: { total: 0, passed: 0, failed: 0, stale: 0 },
        testCases: [],
        planPath: null,
      },
      {
        requirementId: "REQ-001",
        name: "Login",
        status: "in-progress",
        archived: false,
        criteria: [
          { text: "password login succeeds", met: true },
          { text: "lockout after 5 failures" },
        ],
        nodes: [
          {
            id: NODE_A,
            label: "API Service",
            tasks: [
              { displayId: "T1", title: "Scaffold the API component.", key: K1, done: true },
              { displayId: "T2", title: "Wire the database.", key: K2, done: false },
            ],
          },
        ],
        tests: { total: 2, passed: 1, failed: 1, stale: 0 },
        testCases: [
          { testId: "TC-2", name: "lockout counter increments", status: "failed", stale: true },
          { testId: "TC-1", name: "password login succeeds", status: "passed", stale: false },
        ],
        planPath: ".nodespec/tests/req-001.tests.md",
      },
    ],
  };
}

Deno.test("render is byte-idempotent and order-independent (requirements sort by id)", () => {
  const a = renderBoardMd(model());
  const b = renderBoardMd(model());
  assertEquals(a, b);
  const reversed = model();
  reversed.requirements.reverse();
  assertEquals(renderBoardMd(reversed), a, "input order must not change the bytes");
  assert(a.indexOf("REQ-001") < a.indexOf("REQ-002"), "sorted by requirement id");
});

Deno.test("zero prose: every line matches the board grammar", () => {
  const allowed = [
    /^# Work Board <!-- nodespec-board v1 -->$/,
    /^<!-- .* -->$/,
    /^\|.*\|$/,
    /^## .+ <!-- r:[^\s]+ -->$/,
    /^status: [a-z-]+( \((smoke|deep)\))? · criteria \d+\/\d+ · tasks \d+\/\d+ · tests \d+\/\d+\/\d+ of \d+$/,
    /^### Criteria$/,
    /^### Tasks — .+ <!-- n:[0-9a-fA-F-]{36} -->$/,
    /^### Tests( — \S+)?$/,
    /^- \[[ x]\] .+$/,
    /^- (✅|❌|▫️) .+$/,
    /^  ↳ (tasks|tests): .+$/,
    /^$/,
  ];
  for (const line of renderBoardMd(model()).split("\n")) {
    assert(allowed.some((re) => re.test(line)), `prose leaked into the board: "${line}"`);
  }
  // The aligned variant (annotations present) obeys the same grammar.
  for (const line of renderBoardMd(alignedModel()).split("\n")) {
    assert(allowed.some((re) => re.test(line)), `prose leaked into the aligned board: "${line}"`);
  }
});

Deno.test("parse round-trip: ticks and anchors come back exactly", () => {
  const parsed = parseBoardMd(renderBoardMd(model()));
  assertEquals(parsed.flagged, []);
  assertEquals(parsed.criteria["REQ-001"], [
    { text: "password login succeeds", checked: true },
    { text: "lockout after 5 failures", checked: false },
  ]);
  assertEquals(parsed.criteria["REQ-002"], [{ text: "requests over quota get 429", checked: false }]);
  assertEquals(parsed.tasksByNode[NODE_A], [
    { displayId: "T1", title: "Scaffold the API component.", key: K1, checked: true },
    { displayId: "T2", title: "Wire the database.", key: K2, checked: false },
  ]);
});

Deno.test("tick ingestion rides the EXISTING lanes: tick reported, untick reported but tick-only applies, unknowns flagged", () => {
  // User ticks the lockout criterion and T2 in the rendered file.
  const md = renderBoardMd(model())
    .replace("- [ ] lockout after 5 failures", "- [x] lockout after 5 failures")
    .replace(`- [ ] **T2 — Wire the database.** <!-- t:${K2} -->`, `- [x] **T2 — Wire the database.** <!-- t:${K2} -->`);
  const parsed = parseBoardMd(md);
  const { criterionDeltas, taskDeltas } = computeBoardTickDeltas(
    parsed,
    {
      "REQ-001": [
        { text: "password login succeeds", met: false }, // board shows [x] from render → tick
        { text: "lockout after 5 failures", met: false },
      ],
      "REQ-002": [{ text: "requests over quota get 429", met: true }], // board shows [ ] → untick (reported, never applied)
    },
    new Map([[`${NODE_A}::${K1}`, true]]),
  );
  const crit = criterionDeltas.deltas.map((d) => `${d.requirementId}:${d.text}:${d.direction}`).sort();
  assertEquals(crit, [
    "REQ-001:lockout after 5 failures:tick",
    "REQ-001:password login succeeds:tick",
    "REQ-002:requests over quota get 429:untick",
  ]);
  assertEquals(taskDeltas.deltas, [
    { nodeId: NODE_A, key: K2, displayId: "T2", title: "Wire the database.", direction: "tick" },
  ]);
});

Deno.test("a criterion the database does not know is FLAGGED, never created", () => {
  const md = [
    "# Work Board <!-- nodespec-board v1 -->",
    "## REQ-009 — Ghost <!-- r:REQ-009 -->",
    "### Criteria",
    "- [x] invented criterion",
    "",
  ].join("\n");
  const { criterionDeltas } = computeBoardTickDeltas(parseBoardMd(md), {}, new Map());
  assertEquals(criterionDeltas.deltas, []);
  assertEquals(criterionDeltas.flagged, [
    { requirementId: "REQ-009", text: "invented criterion", reason: "unknown-requirement" },
  ]);
});

Deno.test("merge with task-doc deltas dedups the same tick from both sources", () => {
  const tick = { requirementId: "REQ-001", text: "c1", direction: "tick" as const };
  const merged = mergeCriterionDeltaResults(
    { deltas: [tick], flagged: [] },
    { deltas: [{ ...tick }, { requirementId: "REQ-001", text: "c2", direction: "tick" as const }], flagged: [] },
  );
  assertEquals(merged.deltas.length, 2);
  const t = { nodeId: NODE_A, key: K1, displayId: "T1", title: "t", direction: "tick" as const };
  const mergedTasks = mergeTaskDeltaResults({ deltas: [t], flagged: [] }, { deltas: [{ ...t }], flagged: [] });
  assertEquals(mergedTasks.deltas.length, 1);
});

Deno.test("wiring: push writes the board, webhook and sweep ingest it, path excluded from residue by prefix", async () => {
  assertEquals(BOARD_PATH, ".nodespec/BOARD.md");
  const push = await Deno.readTextFile(new URL("../git-push/index.ts", import.meta.url));
  assert(push.includes("renderBoardMd(boardModel)"), "push renders the board");
  assert(push.includes("BOARD.md generation skipped (push continues)"), "board failure never fails a push");
  const drift = await Deno.readTextFile(new URL("../_shared/git-drift.ts", import.meta.url));
  assert(drift.includes("computeSweepBoardDeltas"), "sweep ingests");
  assert(drift.includes("mergeCriterionDeltaResults(criterionDeltas, boardDeltas.criterionDeltas)"), "sweep merges into the SAME arrays");
  const hook = await Deno.readTextFile(new URL("../git-webhook/handlers.ts", import.meta.url));
  assert(hook.includes("computeWebhookBoardDeltas"), "webhook ingests");
  assert(hook.includes("f.path === BOARD_PATH"), "webhook keys on the board path");
});


// ── D3 refinement (owner 2026-08-21): the file opens as a TABLE ──────────────

Deno.test("the summary table heads the file: anchor-linked rows, status emoji, aligned counts", () => {
  const md = renderBoardMd(model());
  const lines = md.split("\n");
  assertEquals(lines[3], "| Requirement | Status | Criteria | Tasks | Tests P/F/S | Nodes |");
  assertEquals(lines[4], "|---|---|---|---|---|---|");
  assert(lines[5].startsWith("| [REQ-001](#req-001--login) — Login | 🔵 in-progress | 1/2 | 1/2 | 1/1/0 of 2 | API Service |"), lines[5]);
  assert(lines[6].startsWith("| [REQ-002](#req-002--rate-limiting) — Rate limiting | ⬜ pending |"), lines[6]);
  // The table appears BEFORE any detail section.
  assert(md.indexOf("| [REQ-001]") < md.indexOf("## REQ-001"));
});

Deno.test("the Tests section aligns the third lane: read-only glyph lines + the plan path, sorted", () => {
  const md = renderBoardMd(model());
  assert(md.includes("### Tests — .nodespec/tests/req-001.tests.md"), "plan path rides the heading");
  const t1 = md.indexOf("- ✅ TC-1 — password login succeeds");
  const t2 = md.indexOf("- ❌ TC-2 — lockout counter increments (stale)");
  assert(t1 !== -1 && t2 !== -1 && t1 < t2, "cases sorted by test id, stale suffixed");
  // Ingestion parity: the table and the test lines are INVISIBLE to the
  // parser — only checkbox sections tick.
  const parsed = parseBoardMd(md);
  assertEquals(parsed.flagged, []);
  assertEquals(Object.keys(parsed.criteria).sort(), ["REQ-001", "REQ-002"]);
});

Deno.test("a plan with no reported cases still shows (plan exists, nothing proven)", () => {
  const m = model();
  m.requirements[0].planPath = ".nodespec/tests/req-002.tests.md";
  const md = renderBoardMd(m);
  assert(md.includes("### Tests — .nodespec/tests/req-002.tests.md"));
});

Deno.test("pipes in names cannot break the table", () => {
  const m = model();
  // model() lists REQ-002 first — rename THAT row.
  m.requirements[0].name = "Rate | limiting";
  const md = renderBoardMd(m);
  const row = md.split("\n").find((l) => l.includes("REQ-002"))!;
  assert(row.includes("Rate \\| limiting"), row);
});

// ── D3 refinement 2 (owner 2026-08-21): LATERAL alignment per criterion ──────

import { alignCriterionLanes, formatCriterionAnnotation } from "../_shared/board-alignment.ts";
import { parseTaskDocTasks } from "../_shared/task-deltas.ts";

function alignedModel(): BoardModel {
  return {
    requirements: [{
      requirementId: "REQ-001",
      name: "Login",
      status: "in-progress",
      archived: false,
      criteria: [
        { text: "password login succeeds", met: true, testId: "row-tc1" },
        { text: "lockout after 5 failures" },
      ],
      nodes: [{
        id: NODE_A,
        label: "API Service",
        tasks: [
          { displayId: "T1", title: "Scaffold the API component.", key: K1, done: true },
          { displayId: "T2", title: "Wire the database.", key: K2, done: false,
            serves: [{ reqId: "REQ-001", text: "password login succeeds" }] },
        ],
      }],
      tests: { total: 2, passed: 1, failed: 0, stale: 0 },
      testCases: [
        { rowId: "row-tc1", testId: "TC-1", name: "password login succeeds", status: "passed", stale: false },
        { rowId: "row-tc9", testId: "TC-9", name: "unbound smoke case", status: "failed", stale: false },
      ],
      planPath: null,
    }],
  };
}

Deno.test("each criterion reads laterally: ITS tasks (via serves) and ITS test (via testId) on the ↳ line", () => {
  const md = renderBoardMd(alignedModel());
  const lines = md.split("\n");
  const critIdx = lines.indexOf("- [x] password login succeeds");
  assert(critIdx !== -1);
  assertEquals(lines[critIdx + 1], "  ↳ tasks: T2 ☐ (API Service) · tests: TC-1 ✅");
  // The unaligned criterion carries NO annotation — the board never guesses.
  const bare = lines.indexOf("- [ ] lockout after 5 failures");
  assert(bare !== -1 && !lines[bare + 1].trim().startsWith("↳"), lines[bare + 1]);
  // The aligned test left the leftovers section; the unbound one stayed.
  assert(!md.includes("- ✅ TC-1"), "aligned test must not repeat in the Tests section");
  assert(md.includes("- ❌ TC-9 — unbound smoke case"), "unbound evidence never hides");
  // General tasks (no serves) still tick in their node section.
  assert(md.includes(`- [x] **T1 — Scaffold the API component.** <!-- t:${K1} -->`));
});

Deno.test("annotation lines are INVISIBLE to ingestion — ticks parse exactly as before", () => {
  const md = renderBoardMd(alignedModel());
  const parsed = parseBoardMd(md);
  assertEquals(parsed.flagged, []);
  assertEquals(parsed.criteria["REQ-001"]!.map((c) => c.text), [
    "password login succeeds",
    "lockout after 5 failures",
  ]);
  assertEquals(parsed.tasksByNode[NODE_A]!.length, 2);
});

Deno.test("alignCriterionLanes: multi-serve tasks annotate under EACH criterion; other-req serves read as general", () => {
  const lanes = alignCriterionLanes({
    requirementId: "REQ-001",
    criteria: [{ text: "c1" }, { text: "c2" }],
    tasks: [
      { displayId: "T1", title: "t", done: false, nodeLabel: "API",
        serves: [{ reqId: "REQ-001", text: "c1" }, { reqId: "REQ-001", text: "c2" }] },
      { displayId: "T2", title: "u", done: true, nodeLabel: "API",
        serves: [{ reqId: "REQ-777", text: "someone else's criterion" }] },
    ],
    tests: [],
  });
  assertEquals(lanes.byCriterion.get("c1")!.tasks.map((t) => t.displayId), ["T1"]);
  assertEquals(lanes.byCriterion.get("c2")!.tasks.map((t) => t.displayId), ["T1"]);
  assertEquals(lanes.generalTasks.map((t) => t.displayId), ["T2"]);
});

Deno.test("the shared parser reads verified serves-lines and ignores the unverified variant", () => {
  const doc = [
    "# Task: API", "",
    "## Implementation Tasks", "",
    `- [ ] **T1 — Scaffold the API component.** <!-- t:${K1} -->`,
    '  ↳ serves: REQ-001 "password login succeeds"',
    '  ↳ serves (unverified match): REQ-002 "phantom" — requirement not mapped to that node; verify or reassign before relying on it',
    `- [ ] **T2 — Wire the database.** <!-- t:${K2} -->`, "",
  ].join("\n");
  const parsed = parseTaskDocTasks(doc);
  assertEquals(parsed.tasks[0].serves, [{ reqId: "REQ-001", text: "password login succeeds" }]);
  assertEquals(parsed.tasks[1].serves, undefined);
});

Deno.test("formatCriterionAnnotation: empty when nothing aligns, segments compose", () => {
  assertEquals(formatCriterionAnnotation({ tasks: [], tests: [] }), "");
  assertEquals(
    formatCriterionAnnotation({
      tasks: [{ displayId: "T3", title: "t", done: true, nodeLabel: "Worker" }],
      tests: [{ testId: "TC-2", name: "n", status: "failed", stale: true }],
    }),
    "↳ tasks: T3 ☑ (Worker) · tests: TC-2 ❌ (stale)",
  );
});
