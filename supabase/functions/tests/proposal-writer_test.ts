// C3 commit 3: server-side proposal writer with artifact-content
// externalization — closing the gap where server-inserted proposals carried
// full artifact bodies into ai_proposals.patches (a guaranteed ~1MB
// PostgREST failure at repo scale; the sentinel lane was client-only,
// pinned as such in mcp-proposals_test.ts). Pins: sentinel substitution,
// side-table batching (50), adopt-lane row shapes, and rollback honesty —
// a failed side-table write must not leave a proposal that would rehydrate
// to sentinel strings.
import { EXTERNALIZED_CONTENT_SENTINEL, writeProposal } from "../_shared/proposal-writer.ts";
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";

const meta = (summary: string) => ({
  id: crypto.randomUUID(), actorType: "system", actorId: "u1", summary, timestamp: "2026-08-04T00:00:00Z",
});

const nodePatch = () => ({
  type: "add_node",
  payload: { id: crypto.randomUUID(), type: "backend-service", label: "API" },
  metadata: meta("Add API node"),
});

const artifactPatch = (content: string) => ({
  type: "add_artifact",
  payload: { id: crypto.randomUUID(), nodeId: "n1", path: "src/x.ts", content, contentHash: "h1" },
  metadata: meta("Add artifact"),
});

Deno.test("proposal writer: strips artifact content to the sentinel and stores it in the side table", async () => {
  const fake = new FakeSupabase();
  fake.script("ai_runs", "insert", { data: null });
  fake.script("ai_proposals", "insert", { data: null });
  fake.script("ai_proposal_artifacts", "upsert", { data: null });

  const art = artifactPatch("export const real = 'content';");
  const result = await writeProposal(fake, {
    projectId: "p1", branchId: "b1", source: "repo-import",
    patches: [nodePatch(), art],
  });

  assertEquals(result.patchCount, 2);
  assertEquals(result.externalizedArtifacts, 1);

  const [prop] = fake.callsTo("ai_proposals", "insert");
  const payload = prop.payload as Record<string, unknown>;
  const patches = payload.patches as Array<{ patch: { type: string; payload: Record<string, unknown> }; status: string; explanation: string }>;
  const stored = patches.find((p) => p.patch.type === "add_artifact")!;
  assertEquals(stored.patch.payload.content, EXTERNALIZED_CONTENT_SENTINEL);
  assertEquals(stored.status, "pending");
  assertEquals(payload.status, "pending");
  assertEquals(payload.source_branch_id, "b1");
  assertEquals(payload.proposal_branch_id, "b1");

  const [side] = fake.callsTo("ai_proposal_artifacts", "upsert");
  const rows = side.payload as Array<Record<string, unknown>>;
  assertEquals(rows[0].artifact_id, art.payload.id);
  assertEquals(rows[0].content, "export const real = 'content';");
  assertEquals(rows[0].content_hash, "h1");
  assertEquals((side.opts as Record<string, unknown>).onConflict, "proposal_id,artifact_id");

  const [run] = fake.callsTo("ai_runs", "insert");
  const runPayload = run.payload as Record<string, unknown>;
  assertEquals(runPayload.model, "repo-import");
  assertEquals(runPayload.status, "completed");
});

Deno.test("proposal writer: batches side-table rows at 50", async () => {
  const fake = new FakeSupabase();
  fake.script("ai_runs", "insert", { data: null });
  fake.script("ai_proposals", "insert", { data: null });
  fake.script("ai_proposal_artifacts", "upsert", { data: null });
  fake.script("ai_proposal_artifacts", "upsert", { data: null });

  const patches = Array.from({ length: 70 }, (_, i) => artifactPatch(`content-${i}`));
  const result = await writeProposal(fake, { projectId: "p1", branchId: "b1", source: "repo-import", patches });

  assertEquals(result.externalizedArtifacts, 70);
  const upserts = fake.callsTo("ai_proposal_artifacts", "upsert");
  assertEquals(upserts.length, 2);
  assertEquals((upserts[0].payload as unknown[]).length, 50);
  assertEquals((upserts[1].payload as unknown[]).length, 20);
});

Deno.test("proposal writer: contentless and non-artifact patches pass through untouched", async () => {
  const fake = new FakeSupabase();
  fake.script("ai_runs", "insert", { data: null });
  fake.script("ai_proposals", "insert", { data: null });

  const bare = {
    type: "add_artifact",
    payload: { id: crypto.randomUUID(), nodeId: "n1", path: "src/y.ts", content: "" },
    metadata: meta("stat-only artifact"),
  };
  const result = await writeProposal(fake, {
    projectId: "p1", branchId: "b1", source: "repo-import", patches: [nodePatch(), bare],
  });

  assertEquals(result.externalizedArtifacts, 0);
  assertEquals(fake.callsTo("ai_proposal_artifacts", "upsert").length, 0, "no side rows for empty content");
  const [prop] = fake.callsTo("ai_proposals", "insert");
  const patches = (prop.payload as Record<string, unknown>).patches as Array<{ patch: { payload: Record<string, unknown> } }>;
  assertEquals(patches[1].patch.payload.content, "", "empty content survives verbatim, never sentineled");
});

Deno.test("proposal writer: side-table failure rolls the proposal back and throws", async () => {
  const fake = new FakeSupabase();
  fake.script("ai_runs", "insert", { data: null });
  fake.script("ai_proposals", "insert", { data: null });
  fake.script("ai_proposal_artifacts", "upsert", { error: { message: "disk full" } });
  fake.script("ai_proposal_artifacts", "delete", { data: null });
  fake.script("ai_proposals", "delete", { data: null });
  fake.script("ai_runs", "delete", { data: null });

  let threw = false;
  try {
    await writeProposal(fake, {
      projectId: "p1", branchId: "b1", source: "repo-import",
      patches: [artifactPatch("big content")],
    });
  } catch (e) {
    threw = true;
    assert(String(e).includes("externalization failed"), `error names the failure: ${e}`);
  }
  assert(threw, "must throw");
  assertEquals(fake.callsTo("ai_proposals", "delete").length, 1, "proposal rolled back");
  assertEquals(fake.callsTo("ai_runs", "delete").length, 1, "run rolled back");
});

Deno.test("proposal writer: ai_proposals failure rolls the run back and throws", async () => {
  const fake = new FakeSupabase();
  fake.script("ai_runs", "insert", { data: null });
  fake.script("ai_proposals", "insert", { error: { message: "RLS says no" } });
  fake.script("ai_runs", "delete", { data: null });

  let threw = false;
  try {
    await writeProposal(fake, { projectId: "p1", branchId: "b1", source: "repo-import", patches: [nodePatch()] });
  } catch (e) {
    threw = true;
    assert(String(e).includes("ai_proposals insert failed"), String(e));
  }
  assert(threw, "must throw");
  assertEquals(fake.callsTo("ai_runs", "delete").length, 1);
});
