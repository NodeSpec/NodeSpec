// R5d · mark_entity_complete — whole-node completion, honestly scoped.
//
// THE invariant (owner decision 2026-07-21): whole-node completion NEVER flips
// acceptance criteria. "The component is done" is a DECLARATION the implementer
// makes; "this criterion is proven" requires evidence (a passing test, or an
// approved git tick). This tool writes `specification_mappings.validation_status`
// — its first writer — plus provenance, and nothing else.
import { FakeSupabase, assert, assertEquals } from "./helpers.ts";
import { handleMarkEntityComplete } from "../mcp-server/tools/requirements.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const AUTH: Any = { userId: "user-1", scopes: ["read", "write", "propose"] };
// A UUID: resolveProjectByName's non-UUID branch does a by-NAME lookup that
// expects an array — the UUID branch is the one this fixture scripts.
const PROJECT_UUID = "00000000-0000-4000-8000-000000000001";

const GRAPH = {
  nodes: {
    "node-1": { id: "node-1", label: "API Service" },
    "node-2": { id: "node-2", label: "API Service" }, // duplicate label for the ambiguity case
    "node-3": { id: "node-3", label: "Worker" },
  },
  artifacts: {
    "art-task": { id: "art-task", nodeId: "node-3", kind: "task", path: ".nodespec/tasks/worker.task.md" },
  },
};

function db(opts: { mappings?: Any[]; graph?: Any } = {}) {
  const fake = new FakeSupabase();
  // resolveProjectByName: project lookup by id/name
  fake.script("projects", "select", { data: { id: PROJECT_UUID, name: "Demo", owner_id: "user-1" } });
  fake.script("project_specifications", "select", { data: { id: "spec-1" } });
  fake.script("branches", "select", { data: { id: "branch-main" } });
  fake.script("graph_snapshots", "select", { data: { graph_data: opts.graph ?? GRAPH } });
  fake.script("specification_mappings", "select", {
    data: opts.mappings ?? [{ id: "map-1", requirement_id: "row-1" }, { id: "map-2", requirement_id: "row-2" }],
  });
  fake.script("specification_mappings", "update", { data: null });
  fake.script("specification_requirements", "select", {
    data: [
      { requirement_id: "REQ-001", acceptance_criteria: [{ text: "a", met: true }, { text: "b", met: false }] },
      { requirement_id: "REQ-002", acceptance_criteria: [{ text: "c", met: false }] },
    ],
  });
  return fake;
}

Deno.test("marks the node's mappings valid with provenance", async () => {
  const fake = db();
  const result = await handleMarkEntityComplete(fake, AUTH, {
    project_id: PROJECT_UUID, node_id: "node-3", external_agent: "claude-code", note: "worker shipped",
  });
  assert(result.success, JSON.stringify(result));
  const data = result.data as Any;
  assertEquals(data.validationStatus, "valid");
  assertEquals(data.mappingsUpdated, 2);

  const upd = fake.callsTo("specification_mappings", "update")[0];
  const payload = upd.payload as Any;
  assertEquals(payload.validation_status, "valid");
  assertEquals(payload.validation_provenance.source, "mcp");
  assertEquals(payload.validation_provenance.actor, "claude-code");
  assertEquals(payload.validation_provenance.note, "worker shipped");
  // Scoped to THIS node's mappings, never the whole spec.
  assert(upd.filters.some((f) => f.method === "eq" && f.args[0] === "node_id" && f.args[1] === "node-3"));
});

// THE invariant.
Deno.test("NEVER flips criteria — no write touches specification_requirements", async () => {
  const fake = db();
  const result = await handleMarkEntityComplete(fake, AUTH, { project_id: PROJECT_UUID, node_id: "node-3" });
  assert(result.success);
  assertEquals(fake.callsTo("specification_requirements", "update").length, 0,
    "'the component is done' is a declaration; 'this criterion is proven' requires evidence");
  assertEquals(fake.callsTo("specification_requirements", "insert").length, 0);
});

Deno.test("the response reports outstanding unmet criteria so declaration ≠ proof", async () => {
  const result = await handleMarkEntityComplete(db(), AUTH, { project_id: PROJECT_UUID, node_id: "node-3" });
  assert(result.success);
  const data = result.data as Any;
  assertEquals(data.criteriaUntouched, true);
  assertEquals(data.unmetCriteria, 2, "b and c are unmet");
  assert((data.note as string).includes("remain UNMET"));
  assert((data.note as string).includes("never flips criteria"));
});

Deno.test("complete:false reverts the declaration to pending and clears provenance", async () => {
  const fake = db();
  const result = await handleMarkEntityComplete(fake, AUTH, {
    project_id: PROJECT_UUID, node_id: "node-3", complete: false,
  });
  assert(result.success);
  const payload = fake.callsTo("specification_mappings", "update")[0].payload as Any;
  assertEquals(payload.validation_status, "pending");
  assertEquals(payload.validation_provenance, null, "NULL = never declared");
});

Deno.test("a task-artifact id resolves to its owning node", async () => {
  const fake = db();
  const result = await handleMarkEntityComplete(fake, AUTH, { project_id: PROJECT_UUID, node_id: "art-task" });
  assert(result.success);
  assertEquals((result.data as Any).nodeId, "node-3");
  assertEquals((result.data as Any).nodeLabel, "Worker");
});

Deno.test("an exact unique label resolves; an ambiguous one refuses", async () => {
  const ok = await handleMarkEntityComplete(db(), AUTH, { project_id: PROJECT_UUID, node_id: "Worker" });
  assert(ok.success);
  assertEquals((ok.data as Any).nodeId, "node-3");

  const ambiguous = await handleMarkEntityComplete(db(), AUTH, { project_id: PROJECT_UUID, node_id: "API Service" });
  assert(!ambiguous.success);
  assert((ambiguous.error as string).includes("ambiguous"));
});

Deno.test("an unmapped node refuses — there is nothing to mark", async () => {
  const result = await handleMarkEntityComplete(db({ mappings: [] }), AUTH, {
    project_id: PROJECT_UUID, node_id: "node-3",
  });
  assert(!result.success);
  assert((result.error as string).includes("no requirement mappings"));
  assert((result.error as string).includes("map_requirement"));
});

Deno.test("an unknown entity refuses with the three accepted forms named", async () => {
  const result = await handleMarkEntityComplete(db(), AUTH, { project_id: PROJECT_UUID, node_id: "nope" });
  assert(!result.success);
  assert((result.error as string).includes("node UUID"));
});

Deno.test("write scope is required", async () => {
  const result = await handleMarkEntityComplete(db(), { userId: "user-1", scopes: ["read"] } as Any, {
    project_id: PROJECT_UUID, node_id: "node-3",
  });
  assert(!result.success);
  assert((result.error as string).includes("write scope"));
});

Deno.test("registry + dispatch wiring", () => {
  const registry = Deno.readTextFileSync(new URL("../mcp-server/tool-registry.ts", import.meta.url));
  assert(registry.includes("'mark_entity_complete'"));
  assert(registry.includes("THIS TOOL NEVER FLIPS ACCEPTANCE CRITERIA"),
    "the description must state the invariant to the calling AI");
  const transport = Deno.readTextFileSync(new URL("../mcp-server/transport.ts", import.meta.url));
  assert(transport.includes("case 'mark_entity_complete':"));
  assert(transport.includes("handleMarkEntityComplete"));
});
