// R3-4c: the user's ignore-this-residue decisions live in the card's metadata and
// must SURVIVE the cumulative sweep supersede — a wholesale metadata replace would
// resurrect every ignored file on the next sweep.
import { assertEquals } from "./helpers.ts";
import { FakeSupabase } from "./helpers.ts";
import { upsertCumulativeSweepEvent } from "../_shared/git-drift.ts";

Deno.test("supersede preserves the survivor's ignoredResidue list", async () => {
  const sb = new FakeSupabase();
  sb.script("git_change_events", "select", {
    data: [{
      id: "evt-1",
      metadata: { source: "sweep", branchName: "main", ignoredResidue: ["build/output.js"] },
    }],
    error: null,
  });

  const eventId = await upsertCumulativeSweepEvent(sb, {
    integrationId: "int-1",
    projectId: "proj-1",
    headSha: "newhead",
    summary: "2 out-of-band commit(s)",
    files: [{ path: "build/output.js", action: "modified" }],
    metadata: { source: "sweep", branchName: "main", residuePaths: ["build/output.js"] },
  });

  assertEquals(eventId, "evt-1");
  const update = sb.callsTo("git_change_events", "update")[0];
  // deno-lint-ignore no-explicit-any
  const meta = (update.payload as any).metadata;
  assertEquals(meta.ignoredResidue, ["build/output.js"], "ignore decisions survive the supersede");
  assertEquals(meta.residuePaths, ["build/output.js"], "fresh sweep data still lands");
});

Deno.test("a fresh card (no survivor) carries no ignoredResidue", async () => {
  const sb = new FakeSupabase();
  sb.script("git_change_events", "select", { data: [], error: null });
  sb.script("git_change_events", "insert", { data: { id: "evt-new" }, error: null });

  await upsertCumulativeSweepEvent(sb, {
    integrationId: "int-1",
    projectId: "proj-1",
    headSha: "head",
    summary: "s",
    files: [],
    metadata: { source: "sweep", branchName: "main", residuePaths: [] },
  });

  const insert = sb.callsTo("git_change_events", "insert")[0];
  // deno-lint-ignore no-explicit-any
  assertEquals((insert.payload as any).metadata.ignoredResidue, undefined);
});
