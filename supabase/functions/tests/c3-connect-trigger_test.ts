// C3 commit 6: the connect-flow trigger — source pins (jsr-403 keeps deno
// check off; these hold the load-bearing lines of the no-anchor branch).
// The brownfield entry fires ONLY on no-anchor + empty graph, dedupes onto
// a live job instead of stacking new ones, stays best-effort (a job-insert
// failure never fails the save), and reports through anchorAdopt.importJob.
import { assert } from "./helpers.ts";

const src = await Deno.readTextFile(
  new URL("../save-git-integration/index.ts", import.meta.url),
);

Deno.test("connect trigger: fires only inside the no-anchor branch, gated on empty graph", () => {
  const noAnchorBlock = src.slice(
    src.indexOf('anchorAdopt.skipped = "no anchor found'),
    src.indexOf("if (anchorText) {"),
  );
  assert(noAnchorBlock.includes("if (nodeCount === 0)"),
    "job creation is gated on the EMPTY-graph condition inside the no-anchor branch");
  assert(noAnchorBlock.includes('from("import_jobs")'),
    "the trigger writes an import_jobs row");
  assert(!src.slice(src.indexOf("if (anchorText) {")).includes('.insert({\n                id: jobId'),
    "no job creation on the anchor-present paths");
});

Deno.test("connect trigger: dedupes onto a live job instead of stacking", () => {
  assert(src.includes('.in("status", ["pending", "running", "awaiting_review"])'),
    "live-job probe covers pending/running/awaiting_review");
  assert(src.includes("resumed: true"),
    "an existing live job is reported as resumed, not duplicated");
});

Deno.test("connect trigger: best-effort — insert failure warns, never throws", () => {
  const block = src.slice(
    src.indexOf("import job insert failed") - 400,
    src.indexOf("import job insert failed") + 200,
  );
  assert(block.includes("console.warn"), "failure is a warn");
  assert(!block.includes("throw"), "failure never throws out of the save");
});

Deno.test("connect trigger: response surface is anchorAdopt.importJob {id, status}", () => {
  assert(src.includes("anchorAdopt.importJob = { id: jobId, status: \"pending\" }"),
    "fresh job reported with id + status");
  assert(src.includes("anchorAdopt.importJob = { id: existingJob.id, status: existingJob.status, resumed: true }"),
    "resumed job reported with its live status");
});
