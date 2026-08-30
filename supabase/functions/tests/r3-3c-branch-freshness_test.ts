// R3-3c: the branch-switch freshness ladder. Switching to a design branch checks
// THAT branch's ref through the one sweep engine; this pure helper decides what a
// moved (or vanished) ref means. The load-bearing pins: silent actions happen ONLY
// when nothing can be lost (canvas already at HEAD, or provably untouched since its
// baseline on an explicit user ask) — everything uncertain falls to the explicit card.
import { assertEquals } from "./helpers.ts";
import { decideBranchFreshness } from "../_shared/git-drift.ts";

const base = {
  refDeleted: false,
  refMoved: true,
  modelChanged: true,
  canvasMatchesHead: false,
  canvasMatchesBaseline: false,
  matchedArtifactCount: 0,
  residueCount: 0,
  userInitiated: true,
};

Deno.test("ref deleted wins over everything — the post-PR-merge lifecycle card", () => {
  assertEquals(
    decideBranchFreshness({ ...base, refDeleted: true, canvasMatchesHead: true }),
    "ref-deleted-card",
  );
});

Deno.test("unmoved ref → nothing, regardless of anything else", () => {
  assertEquals(decideBranchFreshness({ ...base, refMoved: false }), "none");
});

Deno.test("canvas already at HEAD + clean range → silent baseline fast-forward", () => {
  assertEquals(
    decideBranchFreshness({ ...base, canvasMatchesHead: true }),
    "baseline-fast-forward",
  );
  // ...but artifact content changed in the range → the card (files need review even
  // when the MODEL hashes agree; anchor artifacts are bindings, not contents).
  assertEquals(
    decideBranchFreshness({ ...base, canvasMatchesHead: true, matchedArtifactCount: 2 }),
    "card",
  );
});

Deno.test("working copy untouched since baseline + user-initiated → auto-restore", () => {
  assertEquals(
    decideBranchFreshness({ ...base, canvasMatchesBaseline: true }),
    "auto-restore",
  );
  // The SAME state on a background sweep does NOT auto-load — only an explicit
  // user ask (a branch switch) earns the silent lane.
  assertEquals(
    decideBranchFreshness({ ...base, canvasMatchesBaseline: true, userInitiated: false }),
    "card",
  );
  // Residue (unattributed files) in the range → conservative card, never silent.
  assertEquals(
    decideBranchFreshness({ ...base, canvasMatchesBaseline: true, residueCount: 1 }),
    "card",
  );
});

Deno.test("diverged working copy (matches neither HEAD nor baseline) → the explicit card", () => {
  assertEquals(decideBranchFreshness(base), "card");
});

Deno.test("model untouched but files moved in the range → the standard card", () => {
  assertEquals(
    decideBranchFreshness({ ...base, modelChanged: false, matchedArtifactCount: 1 }),
    "card",
  );
});
