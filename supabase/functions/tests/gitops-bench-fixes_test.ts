// Owner bench 2026-07-29, three gitops bugs:
//  1. "After pushing a PR from a new branch, it still says '# changes'" — the
//     merged PR came home as a push of OUR OWN commits + merge machinery, and
//     the head-commit-only self-push guard missed it → isNodeSpecMergeArrival
//     recognizes the range (merge-commit AND squash strategies) so the webhook
//     and sweep load the model instead of raising a card against ourselves.
//  2. Compare/Accept/Load-from-repo silently read the DEFAULT branch (covered
//     by the selective-fetch ref plumbing; client pins live in vitest).
//  3. Renaming a file in the inspector never renamed it in git — the push lane
//     only ADDED tree entries → computeStalePaths yields the delete set from
//     the repo's prior anchor vs the new model.
import { assert, assertEquals } from "./helpers.ts";
import {
  isNodeSpecMergeArrival,
  isSelfPushOnly,
  computeStalePaths,
  SELF_PUSH_PREFIX,
  LEGACY_SELF_PUSH_PREFIXES,
  type DriftSweepResult,
} from "../_shared/git-drift.ts";

const own = (n: number) => ({ message: `${SELF_PUSH_PREFIX} ${n} files from feature-x` });
const legacyOwn = (n: number) => ({ message: `${LEGACY_SELF_PUSH_PREFIXES[0]} ${n} files from feature-x` });

// Rebrand 2026-07-30: the prefix changed with the app name — the LEGACY prefix
// must stay matched forever (existing repos carry history under the old name).
Deno.test("rebrand: new prefix signs as NodeSpec; legacy Nodal prefix still matches everywhere", () => {
  assert(SELF_PUSH_PREFIX.startsWith("Update from NodeSpec:"));
  assert(isSelfPushOnly([legacyOwn(1), legacyOwn(2)]));
  assert(isSelfPushOnly([own(1), legacyOwn(2)]), "mixed old+new history is still all-ours");
  assert(isNodeSpecMergeArrival([
    legacyOwn(1),
    { message: "Merge pull request #7 from owner/feature-x" },
  ]), "a merged PR of LEGACY-prefixed pushes is still our own arrival");
});

Deno.test("merge-commit strategy: self-pushes + 'Merge pull request' head = arrival", () => {
  assert(isNodeSpecMergeArrival([
    own(1), own(2),
    { message: "Merge pull request #7 from owner/feature-x" },
  ]));
});

Deno.test("squash strategy: single commit carrying OUR PR title = arrival", () => {
  assert(isNodeSpecMergeArrival([
    { message: "Merge design branch 'feature-x' into 'main' (#7)" },
  ]));
});

Deno.test("rebase strategy: replayed self-pushes alone = arrival", () => {
  assert(isNodeSpecMergeArrival([own(1), own(2)]));
});

Deno.test("an external commit anywhere in the range disqualifies it", () => {
  assert(!isNodeSpecMergeArrival([
    own(1),
    { message: "fix: hand-edited the config" },
    { message: "Merge pull request #7 from owner/feature-x" },
  ]));
});

Deno.test("merge machinery ALONE proves nothing (foreign PR merged)", () => {
  assert(!isNodeSpecMergeArrival([
    { message: "Merge pull request #9 from someone/other-branch" },
  ]));
  assert(!isNodeSpecMergeArrival([
    { message: "Merge branch 'main' into feature-y" },
  ]));
});

Deno.test("empty range is never an arrival", () => {
  assert(!isNodeSpecMergeArrival([]));
});

// ── computeStalePaths ─────────────────────────────────────────────────────────

const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";

Deno.test("rename: the OLD path is deleted, nothing else", () => {
  const stale = computeStalePaths(
    [{ id: A1, path: "src/old-name.ts" }, { id: A2, path: "src/kept.ts" }],
    {
      [A1]: { id: A1, path: "src/new-name.ts", content: "x" },
      [A2]: { id: A2, path: "src/kept.ts", content: "y" },
    },
    ["src/new-name.ts", "src/kept.ts", ".nodespec/model.json"],
  );
  assertEquals(stale, ["src/old-name.ts"]);
});

Deno.test("removed artifact: its path is deleted", () => {
  const stale = computeStalePaths(
    [{ id: A1, path: "src/gone.ts" }],
    {},
    [".nodespec/model.json"],
  );
  assertEquals(stale, ["src/gone.ts"]);
});

Deno.test("content-cleared artifact keeps its path — the model still claims it", () => {
  // Not in the pushed files (extractArtifactFiles filters empty content), but
  // the artifact still exists at the same path → NOT stale.
  const stale = computeStalePaths(
    [{ id: A1, path: "src/wip.ts" }],
    { [A1]: { id: A1, path: "src/wip.ts", content: "" } },
    [".nodespec/model.json"],
  );
  assertEquals(stale, []);
});

Deno.test("path swap: old path now claimed by ANOTHER artifact is never deleted", () => {
  const stale = computeStalePaths(
    [{ id: A1, path: "src/a.ts" }, { id: A2, path: "src/b.ts" }],
    {
      // A1 moved to b.ts, A2 moved to a.ts — both paths still claimed.
      [A1]: { id: A1, path: "src/b.ts", content: "x" },
      [A2]: { id: A2, path: "src/a.ts", content: "y" },
    },
    ["src/a.ts", "src/b.ts"],
  );
  assertEquals(stale, []);
});

Deno.test("leading-slash normalization matches anchor and graph paths", () => {
  const stale = computeStalePaths(
    [{ id: A1, path: "/src/old.ts" }],
    { [A1]: { id: A1, path: "/src/new.ts", content: "x" } },
    ["src/new.ts"],
  );
  assertEquals(stale, ["src/old.ts"]);
});

// Owner bench-procedure audit 2026-07-30: the merge-arrival lane restores the model
// SERVER-side and reports `fast_forwarded` — the same status the plain self-push
// bookkeeping fast-forward reports. The client only refreshed the canvas on
// `behind_in_sync`, so a merged PR updated the DB while the canvas kept rendering
// the old model (R3-3c step 1 would have read as "auto-load is broken"). The
// `restoredModel` flag is what separates "a model was loaded, go refresh" from
// "bookkeeping only, stay silent" — pin the distinction at the type level.
Deno.test("merge-arrival result is distinguishable from a bookkeeping fast-forward", () => {
  // Shape pin: both are `fast_forwarded`; only the model-loading one flags it.
  const mergeArrival: DriftSweepResult = {
    status: "fast_forwarded", headSha: "h", baseSha: "b", modelChanged: true, restoredModel: true,
  };
  const bookkeeping: DriftSweepResult = { status: "fast_forwarded", headSha: "h", baseSha: "b" };
  assertEquals(mergeArrival.status, bookkeeping.status, "same status — the flag is the only signal");
  assert(mergeArrival.restoredModel === true, "the canvas MUST be refreshed after this one");
  assert(bookkeeping.restoredModel !== true, "self-push bookkeeping must not trigger a refresh");
});

// ── DATA-LOSS edge case (owner bench 2026-07-30) ────────────────────────────────
// "Created a branch, made a file, merged to main via PR, went to main: the
//  artifact did not exist and NodeSpec will not detect it."
// The sweep checked isSelfPushOnly FIRST and bare-advanced the baseline to HEAD
// without loading anything — premised on "our own commits ⇒ this canvas has
// them", which the PR merge lane falsifies (the commits were authored on ANOTHER
// branch). A rebase/fast-forward merge yields a pure self-push range, so the
// merge was swallowed: baseline := HEAD, model never loaded, and every later
// sweep saw head === baseline → "clean". Permanently undetectable.
Deno.test("a pure self-push range IS a merge arrival — the subset relation the fix relies on", () => {
  // Rebase/fast-forward merge: B's own commits replayed onto main, no merge commit.
  const rebased = [own(1), own(2)];
  assert(isSelfPushOnly(rebased), "fixture really is self-push-only");
  assert(
    isNodeSpecMergeArrival(rebased),
    "…and must ALSO be a merge arrival, or removing the self-push shortcut would " +
      "leave these ranges to the ladder with no restore lane",
  );
});

Deno.test("every self-push-only range is claimed by the merge-arrival lane (no orphan ranges)", () => {
  // Whatever shape a NodeSpec-authored range takes, the lane that OWNS it must be
  // the one that can load a model — never a bare baseline advance.
  for (const range of [
    [own(1)],
    [own(1), own(2), own(3)],
    [legacyOwn(1), own(2)],
  ]) {
    assert(isSelfPushOnly(range), "precondition");
    assert(isNodeSpecMergeArrival(range), `merge-arrival must claim ${JSON.stringify(range)}`);
  }
});

// ── Dogfood find 2026-09-02 (#4): unchanged trees mint no commits ─────────────
Deno.test("git-push: a byte-identical tree short-circuits before any commit is created", async () => {
  const src = await Deno.readTextFile(new URL("../git-push/index.ts", import.meta.url));
  // The guard compares content-addressed tree shas and returns the EXISTING
  // head, flagged unchanged — before the commit POST, so no empty commit can
  // ever exist.
  const guardIdx = src.indexOf("treeData.sha === baseTreeSha");
  const commitIdx = src.indexOf("/git/commits`");
  assert(guardIdx > -1, "unchanged-tree guard present");
  assert(commitIdx > guardIdx, "guard sits before commit creation");
  const guard = src.slice(guardIdx, guardIdx + 200);
  assert(guard.includes("unchanged: true"), "guard reports unchanged, not success-with-new-sha");
  assert(guard.includes("sha: latestCommitSha"), "existing head sha is what the caller sees");
  // The response surfaces the flag, and PR mode opens nothing for nothing.
  assert(src.includes('{ unchanged: true, message: "Tree identical to the current head'), "response carries the flag");
  assert(src.includes('prWorkBranch && !unchanged'), "no PR is opened for an unchanged tree");
});
