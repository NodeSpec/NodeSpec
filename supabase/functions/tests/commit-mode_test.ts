// UX-1.1b (docs/V2_TASKS.md, owner spec 2026-08-21): commit mode — direct
// (default, byte-identical to before) or pull-request (work branch + PR,
// baseline untouched until the merge-arrival lane sees the merge).
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

Deno.test("workBranchName: recognizable, sanitized, unique per seed", () => {
  assertEquals(workBranchName("main", "abc123"), "nodespec/push-main-abc123");
  const weird = workBranchName("feature/x y!z", "s1");
  assert(weird.startsWith("nodespec/push-feature-x-y-z"), weird);
  assert(!/[ !]/.test(weird), "no illegal ref characters");
  assert(workBranchName("main", "a") !== workBranchName("main", "b"), "seed differentiates");
  const unseeded = workBranchName("main");
  assert(unseeded.startsWith("nodespec/push-main-"), unseeded);
});

// ── source pins: the git-push lane wiring the helpers into ────────────────────
const pushSource = await Deno.readTextFile(
  new URL("../git-push/index.ts", import.meta.url),
);

Deno.test("git-push: PR mode never advances the sync baseline (merge-arrival owns that)", () => {
  assert(pushSource.includes('if (commitMode !== "pull-request") {'), "baseline advance is mode-guarded");
  const guardIdx = pushSource.indexOf('if (commitMode !== "pull-request") {');
  const baselineIdx = pushSource.indexOf("last_synced_commit: commitSha");
  assert(guardIdx !== -1 && baselineIdx > guardIdx, "the advance sits INSIDE the guard");
});

Deno.test("git-push: both providers commit to pushRef, and the self-push prefix rides every mode", () => {
  // The work-branch push must still carry SELF_PUSH_PREFIX or the webhook
  // would raise a drift card against our own commit.
  const prefixIdx = pushSource.indexOf("`${SELF_PUSH_PREFIX} ${reasonText}`");
  const modeIdx = pushSource.indexOf("const commitMode = resolveCommitMode(integration);");
  assert(prefixIdx !== -1 && modeIdx !== -1 && prefixIdx < modeIdx, "message built before the mode fork, shared by both");
  assert(!pushSource.includes("pushToGitHub(\n        apiBase,\n        integration.repo_owner,\n        integration.repo_name,\n        targetRef,"), "GitHub lane pushes to pushRef, not targetRef");
  assert((pushSource.match(/pushRef,/g) ?? []).length >= 2, "both provider calls take pushRef");
});

Deno.test("git-push: a PR-open failure after the commit is loud, never silent", () => {
  assert(pushSource.includes("but opening the PR failed"), "orphan work branch is reported, with the manual path");
});
