// R3-4b: every lane that materializes external content stamps the SAME provenance
// convention: sourceProvenance names the origin lane. Both anchor lanes (the load
// of git's model, a diff filed as a proposal since V3 AD.2b, and adopt-as-patches)
// stamp 'anchor-restore'. And the stamp must never leak into the anchor itself.
import { assert, assertEquals } from "./helpers.ts";
import { serializeModel, parseModel, anchorToPatches } from "../_shared/model-anchor.ts";
import { anchorLoadPatches } from "../_shared/anchor-load.ts";

const N = "11111111-1111-4111-8111-111111111111";
const HEAD = "21f5859be679e423a8346ca9cd03a83b1e8c6565";
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

const EMPTY = { nodes: {}, edges: {}, contracts: {}, artifacts: {} };
const NOW = "2026-07-29T00:00:00.000Z";
// deno-lint-ignore no-explicit-any
const loadArtifact = async (model: any, sourceCommit: string) =>
  (await anchorLoadPatches(EMPTY, model, { actorId: "git-load", sourceCommit, nowIso: NOW })).patches
    .filter((p) => p.type === "add_artifact")
    // deno-lint-ignore no-explicit-any
    .map((p) => p.payload as any);

Deno.test("a load's new bindings carry sourceProvenance: anchor-restore", async () => {
  const parsed = parseModel(await serializeModel(graph()));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const arts = await loadArtifact(parsed.model, HEAD);
  assertEquals(arts.length, 1);
  assertEquals(arts[0].sourceProvenance, "anchor-restore");
});

Deno.test("anchorToPatches add_artifact payloads carry the same origin", async () => {
  const parsed = parseModel(await serializeModel(graph()));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const artifactPatches = anchorToPatches(parsed.model).filter((p) => p.type === "add_artifact");
  assertEquals(artifactPatches.length, 1);
  // deno-lint-ignore no-explicit-any
  assertEquals((artifactPatches[0].payload as any).sourceProvenance, "anchor-restore");
});

// ── The DETAIL record, not just the string (owner bench 2026-07-30) ──────────────
// "anchor-restore provenance_detail is NULL" while the residue-bind lane wrote the
// full {at, origin, commitSha}. Both anchor lanes wrote only HALF the convention:
// anchorToGraph set metadata without `provenance`, anchorToPatches set no metadata
// at all. Every lane that materializes external content now records both halves.
Deno.test("a load records the full provenance detail with the source commit", async () => {
  const parsed = parseModel(await serializeModel(graph()));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const [art] = await loadArtifact(parsed.model, HEAD);
  assertEquals(art.metadata.provenance.origin, "anchor-restore");
  assertEquals(art.metadata.provenance.commitSha, HEAD);
  assertEquals(art.metadata.provenance.at, NOW);
  assertEquals(art.metadata.contentSource, { type: "git", ref: HEAD, optional: true }, "its content comes from git at accept");
});

Deno.test("anchorToPatches records the full provenance detail with the source commit", async () => {
  const parsed = parseModel(await serializeModel(graph()));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  const p = anchorToPatches(parsed.model, "git-adopt", HEAD).filter((x) => x.type === "add_artifact")[0];
  // deno-lint-ignore no-explicit-any
  const prov = (p.payload as any).metadata.provenance;
  assertEquals(prov.origin, "anchor-restore");
  assertEquals(prov.commitSha, HEAD);
  assert(typeof prov.at === "string" && prov.at.length > 0);
});

Deno.test("no source commit → origin + timestamp still recorded, never a NULL detail", async () => {
  const parsed = parseModel(await serializeModel(graph()));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  // deno-lint-ignore no-explicit-any
  const patchProv = (anchorToPatches(parsed.model).filter((x) => x.type === "add_artifact")[0].payload as any).metadata.provenance;
  assertEquals(patchProv.origin, "anchor-restore");
  assertEquals(patchProv.commitSha, undefined);
});

Deno.test("the detail record never leaks into the anchor (hash unchanged)", async () => {
  const g = graph();
  const before = parseModel(await serializeModel(g));
  g.artifacts[A].sourceProvenance = "anchor-restore";
  g.artifacts[A].metadata = { provenance: { origin: "anchor-restore", commitSha: HEAD, at: NOW } };
  const after = parseModel(await serializeModel(g));
  assert(before.ok && after.ok);
  assertEquals(after.ok && after.model.modelHash, before.ok && before.model.modelHash,
    "provenance is DB-local; the anchor must hash identically or a load then a push would churn");
});
