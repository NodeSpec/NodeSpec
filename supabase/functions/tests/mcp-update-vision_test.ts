// C3 commit 8: update_vision — the minimal vision write lane (R6 later adds
// visionHash + instruction stitching). Pins: write scope, blank refusal
// (clearing rides the app, not MCP), length ceiling, update-in-place on an
// existing spec, the create_requirement-parity bootstrap when no spec
// exists (race convergence included), and the backfill nextAction.
import { handleUpdateVision } from "../mcp-server/tools/vision.ts";
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";

const PROJECT = { id: "11111111-1111-4111-8111-111111111111", name: "Bench" };
const WRITE_AUTH = { userId: "user-1", authMethod: "api_key", keyId: "k1", scopes: ["write"] } as never;
const READ_AUTH = { userId: "user-1", authMethod: "api_key", keyId: "k1", scopes: ["read"] } as never;

Deno.test("update_vision: write scope required", async () => {
  const fake = new FakeSupabase();
  const res = await handleUpdateVision(fake as never, READ_AUTH, { project_id: PROJECT.id, vision: "x" });
  assert(!res.success && res.error?.includes("write scope"), String(res.error));
});

Deno.test("update_vision: refuses blank and over-length visions", async () => {
  const fake = new FakeSupabase();
  const blank = await handleUpdateVision(fake as never, WRITE_AUTH, { project_id: PROJECT.id, vision: "   " });
  assert(!blank.success && blank.error?.includes("cannot be blanked"), String(blank.error));

  const long = await handleUpdateVision(fake as never, WRITE_AUTH, {
    project_id: PROJECT.id, vision: "v".repeat(10_001),
  });
  assert(!long.success && long.error?.includes("too long"), String(long.error));
  assertEquals(fake.callsTo("project_specifications").length, 0, "validation precedes any write");
});

Deno.test("update_vision: updates the existing spec in place", async () => {
  const fake = new FakeSupabase();
  fake.script("projects", "select", { data: [PROJECT] });
  fake.script("project_specifications", "select", { data: { id: "spec-1" } });
  fake.script("project_specifications", "update", { data: null });

  const res = await handleUpdateVision(fake as never, WRITE_AUTH, {
    project_id: PROJECT.id, vision: "A task API for small teams.",
  });
  assert(res.success, String(res.error));
  const data = res.data as { specificationId: string; specificationCreated: boolean; nextAction: string };
  assertEquals(data.specificationId, "spec-1");
  assertEquals(data.specificationCreated, false);
  const [upd] = fake.callsTo("project_specifications", "update");
  assertEquals((upd.payload as Record<string, unknown>).vision, "A task API for small teams.");
  assert(data.nextAction.includes("create_requirement"), "nextAction continues the backfill");
});

Deno.test("update_vision: bootstraps a minimal spec when none exists (create_requirement parity)", async () => {
  const fake = new FakeSupabase();
  fake.script("projects", "select", { data: [PROJECT] });
  fake.script("project_specifications", "select", { data: null });          // no spec yet
  fake.script("project_specifications", "insert", { data: { id: "spec-new" } });
  fake.script("project_specifications", "select", { data: { id: "spec-new" } }); // converge

  const res = await handleUpdateVision(fake as never, WRITE_AUTH, {
    project_id: PROJECT.id, vision: "Vision text",
  });
  assert(res.success, String(res.error));
  const data = res.data as { specificationId: string; specificationCreated: boolean };
  assertEquals(data.specificationId, "spec-new");
  assertEquals(data.specificationCreated, true);
  const [ins] = fake.callsTo("project_specifications", "insert");
  const payload = ins.payload as Record<string, unknown>;
  assertEquals(payload.vision, "Vision text");
  assertEquals(payload.phase_status, "drafting_requirements");
  assertEquals(payload.created_by, "user-1");
});

Deno.test("update_vision: losing the bootstrap race re-writes onto the winning spec", async () => {
  const fake = new FakeSupabase();
  fake.script("projects", "select", { data: [PROJECT] });
  fake.script("project_specifications", "select", { data: null });
  fake.script("project_specifications", "insert", { data: { id: "spec-mine" } });
  fake.script("project_specifications", "select", { data: { id: "spec-winner" } });
  fake.script("project_specifications", "update", { data: null });

  const res = await handleUpdateVision(fake as never, WRITE_AUTH, {
    project_id: PROJECT.id, vision: "Vision text",
  });
  assert(res.success, String(res.error));
  assertEquals((res.data as { specificationId: string }).specificationId, "spec-winner");
  const updates = fake.callsTo("project_specifications", "update");
  assertEquals(updates.length, 1, "vision re-written onto the winner");
});
