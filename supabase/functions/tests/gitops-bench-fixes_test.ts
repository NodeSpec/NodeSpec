// Owner bench 2026-07-29, three gitops bugs:
//  1. "After pushing a PR from a new branch, it still says '# changes'" — the
//     merged PR came home as a push of OUR OWN commits + merge machinery, and
//     the head-commit-only self-push guard missed it. AD.1 recognises such a
//     range by the blobs NodeSpec recorded (merge, rebase and squash alike)
//     and AD.2b files git's model as a proposal instead of a card.
//  2. Compare/Accept/Load-from-repo silently read the DEFAULT branch (covered
//     by the selective-fetch ref plumbing; client pins live in vitest).
//  3. Renaming a file in the inspector never renamed it in git — the push lane
//     only ADDED tree entries → computeStalePaths yields the delete set from
//     the repo's prior anchor vs the new model.
import { assert, assertEquals } from "./helpers.ts";
import { computeStalePaths, SELF_PUSH_PREFIX } from "../_shared/git-drift.ts";

// AD.4 retired the message matchers (isSelfPushMessage, isSelfPushOnly,
// isNodeSpecMergeArrival) with the old webhook's wrappers: NodeSpec knows its
// own commits by recorded sha and blob, and a merge of its writing arrives by
// blob (ad1b-push-plan_test.ts). The prefix stays, a label for people.
Deno.test("AD.4: the message matchers are gone; the prefix is a label", async () => {
  const drift = await Deno.readTextFile(new URL("../_shared/git-drift.ts", import.meta.url));
  for (const gone of ["isSelfPushMessage", "isSelfPushOnly", "isNodeSpecMergeArrival", "LEGACY_SELF_PUSH_PREFIXES", "computeWebhookCriterionDeltas", "computeWebhookBindingResolution", "computeWebhookTaskDeltas", "computeWebhookBoardDeltas"]) {
    assert(!drift.includes(gone), `${gone} retired`);
  }
  assert(SELF_PUSH_PREFIX.startsWith("Update from NodeSpec:"));
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
