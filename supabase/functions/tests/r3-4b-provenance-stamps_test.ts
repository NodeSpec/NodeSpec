// R3-4b: every lane that materializes external content stamps the SAME provenance
// convention — sourceProvenance names the origin lane. Both anchor lanes (snapshot
// restore + adopt-as-patches) stamp 'anchor-restore'. And the stamp must never leak
// into the anchor itself: the round-trip modelHash invariant still holds.
import { assert, assertEquals } from "./helpers.ts";
import { serializeModel, parseModel, anchorToGraph, anchorToPatches } from "../_shared/model-anchor.ts";

const N = "11111111-1111-4111-8111-111111111111";
const A = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function graph(): any {
  return {
    nodes: { [N]: { id: N, type: "backend-service", label: "Api", metadata: {}, ports: [], artifacts: [A] } },
    edges: {},
    contracts: {},
    artifacts: { [A]: { id: A, nodeId: N, path: "src/index.ts", kind: "source", content: "x", status: "draft" } },
  };
}

Deno.test("anchorToGraph artifacts carry sourceProvenance: anchor-restore", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const { graph: restored } = anchorToGraph(parsed.model, { graphId: "g", version: 1, nowIso: "2026-07-29T00:00:00.000Z" });
  // deno-lint-ignore no-explicit-any
  const arts = Object.values(restored.artifacts as Record<string, any>);
  assertEquals(arts.length, 1);
  assertEquals(arts[0].sourceProvenance, "anchor-restore");
  assertEquals(arts[0].metadata.restoredFromAnchor, true, "existing metadata convention kept");
});

Deno.test("anchorToPatches add_artifact payloads carry the same origin", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const artifactPatches = anchorToPatches(parsed.model).filter((p) => p.type === "add_artifact");
  assertEquals(artifactPatches.length, 1);
  // deno-lint-ignore no-explicit-any
  assertEquals((artifactPatches[0].payload as any).sourceProvenance, "anchor-restore");
});

Deno.test("the stamp never leaks into the anchor: restore → re-serialize = same modelHash", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const { graph: restored } = anchorToGraph(parsed.model, { graphId: "g", version: 1, nowIso: "2026-07-29T00:00:00.000Z" });
  const reParsed = parseModel(await serializeModel(restored, []));
  assert(reParsed.ok);
  assertEquals(reParsed.ok && reParsed.model.modelHash, parsed.model.modelHash);
});

// ── The DETAIL record, not just the string (owner bench 2026-07-30) ──────────────
// "anchor-restore provenance_detail is NULL" while the residue-bind lane wrote the
// full {at, origin, commitSha}. Both anchor lanes wrote only HALF the convention:
// anchorToGraph set metadata without `provenance`, anchorToPatches set no metadata
// at all. Every lane that materializes external content now records both halves.
const HEAD = "21f5859be679e423a8346ca9cd03a83b1e8c6565";

Deno.test("anchorToGraph records the full provenance detail with the source commit", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const { graph: restored } = anchorToGraph(parsed.model, {
    graphId: "g", version: 1, nowIso: "2026-07-29T00:00:00.000Z", sourceCommit: HEAD,
  });
  // deno-lint-ignore no-explicit-any
  const art = Object.values(restored.artifacts as Record<string, any>)[0];
  assertEquals(art.metadata.provenance.origin, "anchor-restore");
  assertEquals(art.metadata.provenance.commitSha, HEAD);
  assertEquals(art.metadata.provenance.at, "2026-07-29T00:00:00.000Z");
  assertEquals(art.metadata.restoredFromAnchor, true, "pre-existing metadata survives");
});

Deno.test("anchorToPatches records the full provenance detail with the source commit", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const p = anchorToPatches(parsed.model, "git-adopt", HEAD).filter((x) => x.type === "add_artifact")[0];
  // deno-lint-ignore no-explicit-any
  const prov = (p.payload as any).metadata.provenance;
  assertEquals(prov.origin, "anchor-restore");
  assertEquals(prov.commitSha, HEAD);
  assert(typeof prov.at === "string" && prov.at.length > 0);
});

Deno.test("no source commit → origin + timestamp still recorded, never a NULL detail", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const { graph: restored } = anchorToGraph(parsed.model, { graphId: "g", version: 1, nowIso: "2026-07-29T00:00:00.000Z" });
  // deno-lint-ignore no-explicit-any
  const prov = Object.values(restored.artifacts as Record<string, any>)[0].metadata.provenance;
  assertEquals(prov.origin, "anchor-restore");
  assertEquals(prov.commitSha, undefined, "absent, not null");
  assertEquals(prov.at, "2026-07-29T00:00:00.000Z");

  // deno-lint-ignore no-explicit-any
  const patchProv = (anchorToPatches(parsed.model).filter((x) => x.type === "add_artifact")[0].payload as any).metadata.provenance;
  assertEquals(patchProv.origin, "anchor-restore");
  assertEquals(patchProv.commitSha, undefined);
});

Deno.test("the detail record still never leaks into the anchor (hash unchanged)", async () => {
  const parsed = parseModel(await serializeModel(graph(), []));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const { graph: restored } = anchorToGraph(parsed.model, {
    graphId: "g", version: 1, nowIso: "2026-07-29T00:00:00.000Z", sourceCommit: HEAD,
  });
  const reParsed = parseModel(await serializeModel(restored, []));
  assert(reParsed.ok);
  assertEquals(reParsed.ok && reParsed.model.modelHash, parsed.model.modelHash,
    "provenance is DB-local; the anchor must hash identically or restore→push would churn");
});
