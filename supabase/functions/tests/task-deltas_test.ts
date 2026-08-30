// A4 (docs/WORK_LOOP_PLAN.md): the T-task return path — anchored identity,
// parse/diff/apply, and the generator round-trip. Doctrine mirrors the
// criterion lane: identity is content (never position), no inference
// (anchor-less lines flag, never guess), ticks only (a file's unticked box
// never retracts recorded state).
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";
import {
  taskAnchorKey,
  assignTaskKeys,
  parseTaskDocTasks,
  computeTaskDeltas,
  applicableTaskDeltas,
  applyTaskDeltas,
  reconcileTaskItemOrphans,
  loadTaskStateByNode,
  summarizeTaskDeltas,
} from "../_shared/task-deltas.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";

// ── keys ──────────────────────────────────────────────────────────────────────

Deno.test("taskAnchorKey is deterministic hex8 over the title", () => {
  const a = taskAnchorKey("Scaffold the Billing component.");
  assertEquals(a, taskAnchorKey("Scaffold the Billing component."));
  assert(/^[a-f0-9]{8}$/.test(a), `not hex8: ${a}`);
  assert(a !== taskAnchorKey("Scaffold the Billing component"), "content change must change the key");
});

Deno.test("assignTaskKeys disambiguates duplicate titles by occurrence", () => {
  const keys = assignTaskKeys(["Do X.", "Do Y.", "Do X."]);
  assertEquals(keys[0], taskAnchorKey("Do X."));
  assertEquals(keys[2], `${taskAnchorKey("Do X.")}-2`);
  assert(keys[0] !== keys[2]);
});

// ── parse ─────────────────────────────────────────────────────────────────────

const K1 = taskAnchorKey("Scaffold the API component.");
const K2 = taskAnchorKey("Implement the integration with DB.");

const DOC = `# Task: API

## Requirements — Your Scope

### REQ-001: Login
**Acceptance criteria — your task boxes:**
- [x] password login succeeds

## Implementation Tasks

- [x] **T1 — Scaffold the API component.** <!-- t:${K1} -->
  Create the source layout.
- [ ] **T2 — Implement the integration with DB.** <!-- t:${K2} -->
- [x] **T3 — A legacy pre-anchor task.**

## Manual Steps

- [ ] this checkbox belongs to another lane
`;

Deno.test("parseTaskDocTasks reads ONLY the Implementation Tasks section", () => {
  const parsed = parseTaskDocTasks(DOC);
  assertEquals(parsed.tasks.length, 2, "criteria and manual-step boxes must not parse as tasks");
  assertEquals(parsed.tasks[0], { displayId: "T1", title: "Scaffold the API component.", key: K1, checked: true });
  assertEquals(parsed.tasks[1].checked, false);
});

Deno.test("a task line without an anchor is flagged no-anchor, never positionally guessed", () => {
  const parsed = parseTaskDocTasks(DOC);
  assertEquals(parsed.flagged, [{ title: "A legacy pre-anchor task.", reason: "no-anchor" }]);
});

Deno.test("empty input parses to nothing", () => {
  assertEquals(parseTaskDocTasks(""), { tasks: [], flagged: [] });
});

// ── diff ──────────────────────────────────────────────────────────────────────

Deno.test("a ticked box with no recorded state is a tick delta (first tick creates the row)", () => {
  const result = computeTaskDeltas("node-1", parseTaskDocTasks(DOC), new Map());
  assertEquals(applicableTaskDeltas(result).map((d) => d.key), [K1]);
});

Deno.test("recorded-done tasks produce no delta; unticked-but-done reports untick, not applicable", () => {
  const result = computeTaskDeltas(
    "node-1",
    parseTaskDocTasks(DOC),
    new Map([[K1, true], [K2, true]]),
  );
  assertEquals(result.deltas, [
    { nodeId: "node-1", key: K2, displayId: "T2", title: "Implement the integration with DB.", direction: "untick" },
  ]);
  assertEquals(applicableTaskDeltas(result), [], "unticks are never applicable");
});

Deno.test("summarize names ticks, unapplied unticks, and pre-anchor lines separately", () => {
  const result = computeTaskDeltas("n", parseTaskDocTasks(DOC), new Map([[K2, true]]));
  const summary = summarizeTaskDeltas(result);
  assert(summary.includes("1 task newly done"), summary);
  assert(summary.includes("unticked in the doc (not applied)"), summary);
  assert(summary.includes("1 pre-anchor task line(s)"), summary);
});

// ── apply ─────────────────────────────────────────────────────────────────────

Deno.test("applyTaskDeltas upserts ticks with provenance and skips already-done rows", async () => {
  const fake = new FakeSupabase();
  fake.script("task_items", "select", {
    data: [{ node_id: "node-1", task_key: K1, done: true }],
    error: null,
  });
  fake.script("task_items", "upsert", { data: null, error: null });

  const result = await applyTaskDeltas(fake, "proj-1", {
    deltas: {
      deltas: [
        { nodeId: "node-1", key: K1, displayId: "T1", title: "already done", direction: "tick" },
        { nodeId: "node-1", key: K2, displayId: "T2", title: "fresh tick", direction: "tick" },
        { nodeId: "node-1", key: "deadbeef", displayId: "T3", title: "never applied", direction: "untick" },
      ],
      flagged: [],
    },
    commitSha: "abc123",
    actor: "dev",
  });

  assertEquals(result.applied, 1, "already-done skipped, untick never applied");
  const upserts = fake.callsTo("task_items", "upsert");
  assertEquals(upserts.length, 1);
  const rows = upserts[0].payload as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].task_key, K2);
  assertEquals(rows[0].done, true);
  assertEquals(rows[0].orphaned, false);
  const provenance = rows[0].provenance as Record<string, unknown>;
  assertEquals(provenance.source, "git");
  assertEquals(provenance.commitSha, "abc123");
  assert((upserts[0] as { opts?: { onConflict?: string } }).opts?.onConflict === "project_id,node_id,task_key");
});

Deno.test("applyTaskDeltas with nothing applicable touches NOTHING", async () => {
  const fake = new FakeSupabase();
  const result = await applyTaskDeltas(fake, "proj-1", {
    deltas: { deltas: [{ nodeId: "n", key: "aa", displayId: "T1", title: "t", direction: "untick" }], flagged: [] },
  });
  assertEquals(result.applied, 0);
  assertEquals(fake.calls.length, 0);
});

// ── orphan reconciliation ─────────────────────────────────────────────────────

Deno.test("reconcileTaskItemOrphans flags vanished keys and restores reappearing ones — never deletes", async () => {
  const fake = new FakeSupabase();
  fake.script("task_items", "select", {
    data: [
      { id: "row-1", task_key: K1, orphaned: false },   // still emitted → untouched
      { id: "row-2", task_key: "0000dead", orphaned: false }, // vanished → orphan
      { id: "row-3", task_key: K2, orphaned: true },    // reappeared → restore
    ],
    error: null,
  });
  fake.script("task_items", "update", { data: null, error: null });
  fake.script("task_items", "update", { data: null, error: null });

  const result = await reconcileTaskItemOrphans(fake, "proj-1", "node-1", DOC);
  assertEquals(result, { orphaned: 1, restored: 1 });
  const updates = fake.callsTo("task_items", "update");
  assertEquals(updates.length, 2);
  assertEquals(updates[0].payload, { orphaned: true });
  assertEquals(updates[1].payload, { orphaned: false });
  assertEquals(fake.callsTo("task_items", "delete").length, 0, "orphaning must never delete");
});

Deno.test("loadTaskStateByNode groups one batch read into per-node maps", async () => {
  const fake = new FakeSupabase();
  fake.script("task_items", "select", {
    data: [
      { node_id: "n1", task_key: "aaaa1111", done: true },
      { node_id: "n1", task_key: "bbbb2222", done: false },
      { node_id: "n2", task_key: "cccc3333", done: true },
    ],
    error: null,
  });
  const byNode = await loadTaskStateByNode(fake, "proj-1");
  assertEquals(byNode.get("n1")?.get("aaaa1111"), true);
  assertEquals(byNode.get("n1")?.get("bbbb2222"), false);
  assertEquals(byNode.get("n2")?.get("cccc3333"), true);
});

// ── generator round-trip ──────────────────────────────────────────────────────

const N1 = "11111111-1111-1111-1111-111111111111";
// deno-lint-ignore no-explicit-any
const genCatalogs: any = {
  nodeRoles: {
    "backend-service": {
      id: "backend-service", label: "Backend Service", kind: "app_service",
      is_container: false, treatment_mode: "leaf",
    },
  },
  technologies: {},
};
// deno-lint-ignore no-explicit-any
const genGraph: any = {
  nodes: { [N1]: { id: N1, type: "backend-service", label: "Billing", metadata: {}, ports: [] } },
  edges: {}, contracts: {}, artifacts: {},
};

Deno.test("A4 generator: every emitted task line carries a stable anchor", () => {
  const doc = generateTaskDocument({ node: genGraph.nodes[N1], graph: genGraph, catalogs: genCatalogs, requirements: [] });
  const parsed = parseTaskDocTasks(doc);
  assert(parsed.tasks.length >= 2, "expected at least foundation + verify tasks");
  assertEquals(parsed.flagged, [], "the generator must never emit an anchor-less task line");
  for (const task of parsed.tasks) {
    assert(task.key !== null && /^[a-f0-9]{8}(-\d+)?$/.test(task.key), `bad key on ${task.displayId}`);
    assertEquals(task.key!.split("-")[0], taskAnchorKey(task.title), "key must derive from the title");
  }
});

Deno.test("A4 generator: keys are stable across regenerations; taskState renders [x]", () => {
  const first = parseTaskDocTasks(
    generateTaskDocument({ node: genGraph.nodes[N1], graph: genGraph, catalogs: genCatalogs, requirements: [] }),
  );
  const doneKey = first.tasks[0].key!;
  const second = parseTaskDocTasks(
    generateTaskDocument({
      node: genGraph.nodes[N1], graph: genGraph, catalogs: genCatalogs, requirements: [],
      taskState: new Map([[doneKey, true]]),
    }),
  );
  assertEquals(
    second.tasks.map((t) => t.key),
    first.tasks.map((t) => t.key),
    "regeneration must keep every key",
  );
  assertEquals(second.tasks[0].checked, true, "recorded done-state must render [x]");
  assertEquals(second.tasks.slice(1).some((t) => t.checked), false, "only the recorded key ticks");
});

Deno.test("A4 generator: without taskState the output renders every box unticked (pre-A4 shape)", () => {
  const doc = generateTaskDocument({ node: genGraph.nodes[N1], graph: genGraph, catalogs: genCatalogs, requirements: [] });
  const parsed = parseTaskDocTasks(doc);
  assert(parsed.tasks.every((t) => !t.checked));
});
