// UX-1.1b (docs/V2_TASKS.md, owner spec 2026-08-21): commit mode, direct
// (default) or pull-request (a work branch and its pull request, the baseline
// untouched until the sync check sees the merge). AD.4: one work branch per
// tracked ref, one open pull request on it.
import { resolveCommitMode, workBranchName } from "../_shared/commit-mode.ts";
import { assert, assertEquals } from "./helpers.ts";

Deno.test("resolveCommitMode: only an explicit 'pull-request' opts in", () => {
  assertEquals(resolveCommitMode({ commit_mode: "pull-request" }), "pull-request");
  assertEquals(resolveCommitMode({ commit_mode: "direct" }), "direct");
  assertEquals(resolveCommitMode({ commit_mode: null }), "direct");
  assertEquals(resolveCommitMode({}), "direct");
  assertEquals(resolveCommitMode(undefined), "direct");
  assertEquals(resolveCommitMode({ commit_mode: "yolo" }), "direct", "unknown values never opt in");
});

Deno.test("workBranchName: recognizable, sanitized, one per tracked ref (AD.4)", () => {
  assertEquals(workBranchName("main"), "nodespec/push-main");
  assertEquals(workBranchName("main"), workBranchName("main"), "the same ref always names the same work branch");
  const weird = workBranchName("feature/x y!z");
  assertEquals(weird, "nodespec/push-feature-x-y-z");
  assert(!/[ !]/.test(weird), "no illegal ref characters");
  assert(workBranchName("develop") !== workBranchName("main"), "one per tracked ref");
});

// ── source pins: the git-push lane wiring the helpers into ────────────────────
const pushSource = await Deno.readTextFile(
  new URL("../git-push/index.ts", import.meta.url),
);

Deno.test("git-push: PR mode never advances the sync baseline (merge-arrival owns that)", () => {
  assert(pushSource.includes('if (commitMode !== "pull-request") {'), "baseline advance is mode-guarded");
  const guardIdx = pushSource.indexOf('if (commitMode !== "pull-request") {');
  // AD.1: the advance goes through the one baseline writer.
  const baselineIdx = pushSource.indexOf("advanceBaseline(serviceClient, { branchId: branch.id, to: commitSha");
  assert(guardIdx !== -1 && baselineIdx > guardIdx, "the advance sits INSIDE the guard");
});

Deno.test("git-push: both providers commit to pushRef, and the commit subject is the same in every mode", () => {
  // AD.1: the prefix is a label for people; NodeSpec knows its commits by the
  // sha and blobs it records, in either mode.
  const prefixIdx = pushSource.indexOf("`${SELF_PUSH_PREFIX} ${reasonText}`");
  const modeIdx = pushSource.indexOf("const commitMode = resolveCommitMode(integration);");
  assert(prefixIdx !== -1 && modeIdx !== -1 && prefixIdx < modeIdx, "message built before the mode fork, shared by both");
  assert(!pushSource.includes("pushToGitHub(\n        apiBase,\n        integration.repo_owner,\n        integration.repo_name,\n        targetRef,"), "GitHub lane pushes to pushRef, not targetRef");
  assert((pushSource.match(/pushRef,/g) ?? []).length >= 2, "both provider calls take pushRef");
});

Deno.test("git-push: a PR-open failure after the commit is loud, never silent", () => {
  assert(pushSource.includes("but opening the PR failed"), "orphan work branch is reported, with the manual path");
});
