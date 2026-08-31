// Dogfood find 2026-09-02 (#3): test-plan reads must self-correct.
//
// The Godot project had five plans still reporting "noschema" after the
// schema landed — the read path served the stored artifact on the word of
// its stored stale flag, never comparing fingerprints, while the task-doc
// lane recomputes on every generate. ensureTestDocumentForRequirement now
// owns the freshness decision for EVERY read: fingerprint match serves the
// stored plan untouched; a moved fingerprint regenerates immediately with
// the user's Test Strategy edits carried forward.
import { ensureTestDocumentForRequirement } from "../_shared/mcp-context-assembly.ts";
import { computeTestContextFingerprint, getTestDocumentPath } from "../_shared/test-document-generator.ts";
import { assert, assertEquals } from "./helpers.ts";

const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
const CATALOGS: any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };

const REQ = {
  requirementId: "REQ-001",
  name: "Camera follows",
  description: "The camera tracks the player.",
  category: "functional",
  status: "pending",
  acceptanceCriteria: [{ text: "Camera keeps the player centered", met: false }],
};

// deno-lint-ignore no-explicit-any
function graphWith(schema: Record<string, unknown> | undefined): any {
  return {
    nodes: {
      [N1]: { id: N1, label: "Camera", type: "backend-service", ports: [] },
      [N2]: { id: N2, label: "World", type: "backend-service", ports: [] },
    },
    edges: { e1: { id: "e1", source: N2, target: N1, contractId: "c1" } },
    contracts: { c1: { id: "c1", name: "Hint Interface", kind: "rest", ...(schema ? { schema } : {}) } },
    artifacts: {},
  };
}

// deno-lint-ignore no-explicit-any
function withStoredPlan(graph: any, content: string, fingerprint: unknown): any {
  graph.artifacts["a1"] = {
    id: "a1", nodeId: N1, kind: "test-plan",
    path: getTestDocumentPath(REQ.requirementId, REQ.name),
    content, status: "accepted",
    metadata: { testContextFingerprint: fingerprint, requirementId: REQ.requirementId },
  };
  return graph;
}

const mapped = [{ nodeId: N1, label: "Camera", role: "backend-service", technology: undefined }];

Deno.test("fingerprint match: the stored plan serves untouched, no regeneration", () => {
  const g = graphWith(undefined);
  const fp = computeTestContextFingerprint(REQ, mapped, [], g, undefined, CATALOGS);
  const stored = withStoredPlan(g, "# Test Plan: STORED BODY\n## Test Strategy\ncustom", fp);
  const r = ensureTestDocumentForRequirement(stored, CATALOGS, REQ, [N1]);
  assertEquals(r.isNew, false);
  assert(r.refreshed !== true, "no refresh when inputs are unchanged");
  assert(r.content.includes("STORED BODY"), "stored content served verbatim (wrapped)");
});

Deno.test("fingerprint moved (schema landed): the read regenerates NOW and keeps Test Strategy edits", () => {
  // Stored fingerprint was computed while the contract had NO schema...
  const before = graphWith(undefined);
  const oldFp = computeTestContextFingerprint(REQ, mapped, [], before, undefined, CATALOGS);
  // ...then the schema landed in the live graph.
  const after = withStoredPlan(
    graphWith({ openapi: "3.1.0", paths: { "/hint": {} } }),
    "# Test Plan: STALE STORED BODY\n\n## Test Strategy\n\nMY CUSTOM STRATEGY EDIT\n",
    oldFp,
  );
  const r = ensureTestDocumentForRequirement(after, CATALOGS, REQ, [N1]);
  assertEquals(r.isNew, false);
  assertEquals(r.refreshed, true, "a moved fingerprint must regenerate at read time");
  assert(!r.content.includes("STALE STORED BODY"), "stale derived content is gone");
  assert(r.content.includes("MY CUSTOM STRATEGY EDIT"), "user's Test Strategy section carried forward verbatim");
  const newFp = r.fingerprint as { fingerprint: string };
  assert(newFp.fingerprint !== (oldFp as { fingerprint: string }).fingerprint, "returned fingerprint is the CURRENT one");
});

Deno.test("legacy artifact without a comparable hash keeps serving (push-gate migrates it)", () => {
  const g = withStoredPlan(graphWith(undefined), "# Test Plan: LEGACY", { notAFingerprint: true });
  const r = ensureTestDocumentForRequirement(g, CATALOGS, REQ, [N1]);
  assertEquals(r.isNew, false);
  assert(r.refreshed !== true, "legacy artifacts are not churned at read time");
  assert(r.content.includes("LEGACY"));
});
