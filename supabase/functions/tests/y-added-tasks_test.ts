// Y (owner 2026-09-23): a task a person adds by hand in the Requirements
// record. The task list is the agent's (generate_task_docs); a hand-added
// task lives in its own `## Added Tasks` section of the node's task doc, in
// the same line format, so every reader of the list sees it and regeneration
// carries it verbatim, renumbered after the generated work orders. The
// orphan reconcile runs against the doc as stored, Added Tasks included, so
// a person's task is never orphaned by the list regenerating around it.
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";
import {
  ADDED_TASKS_HEADING,
  appendAddedTask,
  cleanTaskTitle,
  nextAddedTaskId,
  parseTaskDocTasks,
  preserveAddedTasksSection,
  taskAnchorKey,
} from "../_shared/task-deltas.ts";
import { computeTaskContextFingerprint, getTaskDocumentPath } from "../_shared/task-document-generator.ts";
import { refreshTaskPackets } from "../_shared/packet-freshness.ts";

const K1 = taskAnchorKey("Scaffold the API component.");
const K2 = taskAnchorKey("Implement the integration with DB.");
const SERVES = { reqId: "REQ-004", text: "Marking a book finished twice does not count it twice" };

const GENERATED = `# Task: API

## Implementation Tasks

- [ ] **T1 — Scaffold the API component.** <!-- t:${K1} -->
  Create the source layout.
- [ ] **T2 — Implement the integration with DB.** <!-- t:${K2} -->

**Your first action — expand these work orders.**

## Requirements — Your Scope

- [ ] a criterion box, not a task
`;

Deno.test("Y: a task added to a generated doc opens the section right after the generated list, next id, anchor, serves-line", () => {
  const r = appendAddedTask(GENERATED, { nodeLabel: "API", title: "Backfill finished_at for old rows", serves: SERVES });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.displayId, "T3");
  assertEquals(r.key, taskAnchorKey("Backfill finished_at for old rows"));
  const lines = r.content.split("\n");
  const head = lines.indexOf(ADDED_TASKS_HEADING);
  assert(head > lines.findIndex((l) => l.startsWith("**Your first action")), "after the generated list and its directive");
  assert(head < lines.indexOf("## Requirements — Your Scope"), "before the next section");
  assert(r.content.includes(`- [ ] **T3 — Backfill finished_at for old rows** <!-- t:${r.key} -->\n  ↳ serves: REQ-004 "${SERVES.text}"`));
  const parsed = parseTaskDocTasks(r.content).tasks;
  assertEquals(parsed.map((t) => t.displayId), ["T1", "T2", "T3"]);
  assertEquals(parsed[2].added, true);
  assertEquals(parsed[0].added, undefined, "a generated task carries no added flag");
  assertEquals(parsed[2].serves, [SERVES]);
});

Deno.test("Y: a second task joins the existing section; a title the doc already lists is refused in words", () => {
  const first = appendAddedTask(GENERATED, { nodeLabel: "API", title: "Backfill finished_at", serves: SERVES });
  assert(first.ok);
  if (!first.ok) return;
  const second = appendAddedTask(first.content, { nodeLabel: "API", title: "Log the double click", serves: SERVES });
  assert(second.ok);
  if (!second.ok) return;
  assertEquals(second.displayId, "T4");
  assertEquals(second.content.split(ADDED_TASKS_HEADING).length - 1, 1, "one section");
  assertEquals(parseTaskDocTasks(second.content).tasks.filter((t) => t.added).map((t) => t.displayId), ["T3", "T4"]);
  assertEquals(appendAddedTask(second.content, { nodeLabel: "API", title: "Scaffold the API component.", serves: SERVES }), { ok: false, refusal: "T1 on API already says that." });
  assertEquals(appendAddedTask(second.content, { nodeLabel: "API", title: "  ** ", serves: SERVES }), { ok: false, refusal: "A task needs a title." });
});

Deno.test("Y: with no doc yet a minimal one starts, holding only the section; the title is cleaned to survive the line format", () => {
  const r = appendAddedTask(null, { nodeLabel: "Supabase Postgres", title: "Add **the** index\n<!-- x -->", serves: SERVES });
  assert(r.ok);
  if (!r.ok) return;
  assert(r.content.startsWith("# Task: Supabase Postgres\n"));
  assertEquals(r.displayId, "T1");
  assertEquals(cleanTaskTitle("Add **the** index\n<!-- x -->"), "Add the index x");
  assertEquals(parseTaskDocTasks(r.content).tasks.map((t) => [t.title, t.added]), [["Add the index x", true]]);
  assertEquals(nextAddedTaskId(r.content), "T2");
  assertEquals(nextAddedTaskId(null), "T1");
  assertEquals(getTaskDocumentPath("Supabase Postgres", "bf000000-0000-4000-8000-00000000a004"), ".nodespec/tasks/supabase-postgres-bf000000.task.md", "the moved helper keeps its rule");
});

Deno.test("Y preserve: regeneration carries the section verbatim after the generated list, renumbered after it", () => {
  const withAdded = appendAddedTask(GENERATED, { nodeLabel: "API", title: "Backfill finished_at", serves: SERVES });
  assert(withAdded.ok);
  if (!withAdded.ok) return;
  // the agent's list grew by one task on regeneration
  const K3 = taskAnchorKey("Write the migration.");
  const regenerated = GENERATED.replace(
    `- [ ] **T2 — Implement the integration with DB.** <!-- t:${K2} -->`,
    `- [ ] **T2 — Implement the integration with DB.** <!-- t:${K2} -->\n- [ ] **T3 — Write the migration.** <!-- t:${K3} -->`,
  );
  const out = preserveAddedTasksSection(regenerated, withAdded.content);
  const tasks = parseTaskDocTasks(out).tasks;
  assertEquals(tasks.map((t) => [t.displayId, t.title, t.added ?? false]), [
    ["T1", "Scaffold the API component.", false],
    ["T2", "Implement the integration with DB.", false],
    ["T3", "Write the migration.", false],
    ["T4", "Backfill finished_at", true],
  ]);
  assertEquals(tasks[3].key, withAdded.key, "identity is the title: the key never moves");
  assertEquals(tasks[3].serves, [SERVES]);
  assert(out.indexOf(ADDED_TASKS_HEADING) < out.indexOf("## Requirements — Your Scope"));
  assertEquals(preserveAddedTasksSection(out, out), out, "idempotent");
});

Deno.test("Y preserve: no stored section → generated unchanged; a task the generated list now carries leaves the section", () => {
  assertEquals(preserveAddedTasksSection(GENERATED, GENERATED), GENERATED);
  const added = appendAddedTask(GENERATED, { nodeLabel: "API", title: "Write the migration.", serves: SERVES });
  assert(added.ok);
  if (!added.ok) return;
  const K3 = taskAnchorKey("Write the migration.");
  const regenerated = GENERATED.replace("\n**Your first action", `- [ ] **T3 — Write the migration.** <!-- t:${K3} -->\n\n**Your first action`);
  const out = preserveAddedTasksSection(regenerated, added.content);
  assertEquals(out, regenerated, "the only added task is listed above now: the section has nothing left to carry");
  assertEquals(parseTaskDocTasks(out).tasks.filter((t) => t.key === K3).length, 1, "never two lines under one key");
});

Deno.test("Y freshness path: a fingerprint flip regenerates the doc around the Added Tasks section, and the reconcile does not orphan it", async () => {
  const N1 = "11111111-1111-1111-1111-111111111111";
  const N2 = "22222222-2222-2222-2222-222222222222";
  const sb = new FakeSupabase();
  for (const t of ["node_roles", "technology_catalog", "deployment_targets", "legacy_type_mappings", "cloud_provider_patterns", "scope_archetypes"]) {
    sb.script(t, "select", { data: [], error: null });
  }
  sb.script("project_specifications", "select", { data: null, error: null });
  const added = appendAddedTask(null, { nodeLabel: "API Service", title: "Backfill finished_at", serves: SERVES });
  assert(added.ok);
  if (!added.ok) return;
  // task state (one read), then the reconcile's own read of the node's rows
  sb.script("task_items", "select", { data: [{ node_id: N1, task_key: added.key, done: false }], error: null });
  sb.script("task_items", "select", { data: [{ id: "ti-1", task_key: added.key, orphaned: false }], error: null });

  // deno-lint-ignore no-explicit-any
  const graph: any = {
    nodes: { [N1]: { id: N1, type: "backend-service", label: "API Service", metadata: {}, ports: [] } },
    edges: {}, contracts: {}, artifacts: {},
  };
  const node = graph.nodes[N1];
  const staleFp = computeTaskContextFingerprint({ id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports }, graph, []);
  graph.nodes[N2] = { id: N2, type: "database", label: "Store", metadata: {}, ports: [] };
  graph.edges["e1"] = { id: "e1", source: N1, target: N2, contractId: "c1" };
  graph.contracts["c1"] = { id: "c1", kind: "sql", name: "API to Store" };
  graph.artifacts["task-1"] = {
    id: "task-1", nodeId: N1, kind: "task", path: ".nodespec/tasks/api-service.task.md",
    content: added.content, metadata: { taskContextFingerprint: staleFp },
  };
  const r = await refreshTaskPackets(sb as never, "proj-1", graph);
  assertEquals(r.refreshed, 1);
  const out = String(graph.artifacts["task-1"].content);
  assert(out.includes("## Your Deliverable"), "the derived sections are the real regenerated doc");
  const mine = parseTaskDocTasks(out).tasks.filter((t) => t.added);
  assertEquals(mine.map((t) => t.key), [added.key], "the person's task survived");
  const orphaning = sb.callsTo("task_items", "update").filter((c) => (c.payload as { orphaned?: boolean })?.orphaned === true);
  assertEquals(orphaning.length, 0, "its state row stays live");
});
