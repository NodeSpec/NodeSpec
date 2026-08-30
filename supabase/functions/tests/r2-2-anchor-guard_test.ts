// R2.2: anchor-restore on connect + push overwrite guard (pure decision pins).
// Owner-discovered via an accidental disaster-recovery test: after a DB reset the
// repo's model.json was the ONLY surviving copy of the graph. Two lanes:
//   connect — a repo anchor is NEVER silently ignored: empty project → adopt
//   proposal (existing R2 lane, now user-visible), non-empty project → mismatch
//   card (accept = baseline/overwrite-on-next-push, dismiss = stay protected);
//   push — an UNBASELINED push against a repo that already carries an anchor is
//   blocked until explicitly confirmed (fail closed when unsure).
import { assert, assertEquals } from "./helpers.ts";
import { decideConnectAnchorAction, evaluateUnbaselinedPush, summarizeAnchor } from "../_shared/git-drift.ts";
import { serializeModel, parseModel } from "../_shared/model-anchor.ts";

const S = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
const graph: any = {
  nodes: {
    [S]: { id: S, type: "backend-service", label: "Api", metadata: {}, ports: [] },
    [T]: { id: T, type: "database", label: "Db", metadata: {}, ports: [] },
  },
  edges: { e1: { id: "e1", source: S, target: T, contractId: "c1" } },
  contracts: { c1: { id: "c1", kind: "sql", name: "Api → Db", schema: {} } },
  artifacts: {},
};

Deno.test("connect decision: empty adopts, matching auto-baselines, genuine unbaselined divergence gets the card", () => {
  const base = { anchorPresent: true, parsedOk: true, hashOk: true, projectMatchesAnchor: false, baselined: false };
  assertEquals(decideConnectAnchorAction({ ...base, anchorPresent: false, nodeCount: 0 }), "none");
  assertEquals(decideConnectAnchorAction({ ...base, nodeCount: 0 }), "adopt");
  // Owner bench 2026-07-28: disconnect/reconnect with no changes raised a phantom
  // card — a repo anchor that IS this project's model is NOT a mismatch.
  assertEquals(decideConnectAnchorAction({ ...base, nodeCount: 7, projectMatchesAnchor: true }), "auto-baseline");
  assertEquals(decideConnectAnchorAction({ ...base, nodeCount: 7 }), "mismatch-card");
  // Baselined divergence belongs to the drift sweep, not a connect card.
  assertEquals(decideConnectAnchorAction({ ...base, nodeCount: 7, baselined: true }), "none");
  assertEquals(decideConnectAnchorAction({ ...base, parsedOk: false, hashOk: false, nodeCount: 0 }), "invalid-skip");
  assertEquals(decideConnectAnchorAction({ ...base, hashOk: false, nodeCount: 0 }), "invalid-skip");
});

Deno.test("push guard: unbaselined + repo anchor → BLOCKED with a summary", async () => {
  const anchorText = await serializeModel(graph);
  const verdict = evaluateUnbaselinedPush(null, anchorText);
  assert(verdict.blocked, "never silently overwrite a foreign anchor");
  assertEquals(verdict.summary?.nodes, 2);
  assertEquals(verdict.summary?.edges, 1);
  const parsed = parseModel(anchorText);
  assert(parsed.ok);
  assertEquals(verdict.summary?.modelHash, summarizeAnchor(parsed.model).modelHash);
});

Deno.test("push guard: a CORRUPT repo anchor still blocks (it is the user's file)", () => {
  const verdict = evaluateUnbaselinedPush(null, "{ not an anchor");
  assert(verdict.blocked);
  assertEquals(verdict.summary, undefined);
  assert(String(verdict.reason).includes("did not parse"));
});

Deno.test("push guard: baselined pushes and anchor-free repos pass untouched", async () => {
  const anchorText = await serializeModel(graph);
  assertEquals(evaluateUnbaselinedPush("abc123", anchorText).blocked, false, "baselined = drift sweep owns it");
  assertEquals(evaluateUnbaselinedPush(null, null).blocked, false, "empty repo — first push is safe");
});
