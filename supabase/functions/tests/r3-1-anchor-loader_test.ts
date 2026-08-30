// R3-1 THE LOADER: anchorToGraph is the inverse of serializeModel.
// THE invariant: restore a graph from its anchor, re-serialize it, and the
// modelHash reproduces — a restored project's next push writes a byte-identical
// anchor (no phantom drift after disaster recovery or branch switch).
// Honest limits, pinned as such: contract schema CONTENT and artifact file
// CONTENT are not in the anchor — schemas restore empty, artifacts hydrate on
// demand (R2.1 lane). The round-trip invariant therefore holds exactly for
// empty-schema contracts (the dominant case; a content-bearing schema serializes
// a different schemaHash after restore — one honest drift on the next push).
import { assert, assertEquals } from "./helpers.ts";
import { serializeModel, parseModel, anchorToGraph } from "../_shared/model-anchor.ts";

const S = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const A1 = "44444444-4444-4444-8444-444444444444";
const G = "55555555-5555-4555-8555-555555555555";

// deno-lint-ignore no-explicit-any
const graph: any = {
  id: G,
  schemaVersion: 8,
  version: 3,
  hash: "whatever",
  nodes: {
    [S]: {
      id: S, type: "backend-service", label: "Api", technology: "python-backend",
      parentId: T, placementKind: "hosts", metadata: {}, data: {},
      ports: [{ id: P1, name: "DB out", direction: "out" }],
      artifacts: [A1],
    },
    [T]: { id: T, type: "aws", label: "AWS", metadata: {}, data: {}, ports: [] },
  },
  edges: {
    e1: {
      id: "66666666-6666-4666-8666-666666666666", source: S, target: T,
      contractId: "77777777-7777-4777-8777-777777777777", sourcePortId: P1,
      label: "Api → AWS", direction: "bidirectional", criticality: "fallback", metadata: {},
    },
  },
  contracts: {
    c1: { id: "77777777-7777-4777-8777-777777777777", kind: "sql", name: "Api → Db", interactionKind: "data_read", transport: "sql", specFormat: "sql_ddl", schema: {}, metadata: {} },
  },
  artifacts: {
    [A1]: { id: A1, nodeId: S, path: "src/main.py", kind: "source", content: "print(1)", createdAt: "2026-07-28T00:00:00Z", updatedAt: "2026-07-28T00:00:00Z" },
  },
};

const MAPPINGS = [{ requirementId: "REQ-001", nodeId: S }];

Deno.test("round-trip: restore from anchor, re-serialize → SAME modelHash", async () => {
  const anchorText = await serializeModel(graph);
  const parsed = parseModel(anchorText);
  assert(parsed.ok);

  const { graph: restored, counts } = anchorToGraph(parsed.model, {
    graphId: G, version: 4, nowIso: "2026-07-28T12:00:00Z",
  });
  assertEquals(counts, { nodes: 2, edges: 1, contracts: 1, artifacts: 1 });

  const reserialized = await serializeModel(restored);
  const reparsed = parseModel(reserialized);
  assert(reparsed.ok);
  assertEquals(reparsed.model.modelHash, parsed.model.modelHash, "restored graph must re-anchor byte-equivalently — no phantom drift after restore");
});

Deno.test("restored graph carries everything the anchor holds", () => {
  // deno-lint-ignore no-explicit-any
  const model: any = {
    modelVersion: 1, generatedBy: "nodespec", modelHash: "h",
    nodes: [{ id: S, type: "backend-service", label: "Api", technology: "rust", parentId: T, placementKind: "hosts", ports: [{ id: P1, name: "Out", direction: "out" }], contentHash: "x" }],
    edges: [{ id: "66666666-6666-4666-8666-666666666666", source: S, target: T, contractId: "77777777-7777-4777-8777-777777777777", direction: "bidirectional", criticality: "optional", contentHash: "x" }],
    contracts: [{ id: "77777777-7777-4777-8777-777777777777", kind: "grpc", name: "c", interactionKind: "request_response", transport: "grpc", specFormat: "protobuf", contentHash: "x" }],
    artifacts: [{ id: A1, nodeId: S, path: "src/main.rs", kind: "source" }],
    mappings: [],
  };
  const { graph: g } = anchorToGraph(model, { graphId: G, version: 1, nowIso: "2026-07-28T12:00:00Z" });

  assertEquals(g.schemaVersion, 8, "client GraphSchema requires schemaVersion");
  assertEquals(g.nodes[S].technology, "rust");
  assertEquals(g.nodes[S].placementKind, "hosts");
  assertEquals(g.nodes[S].artifacts, [A1], "artifact ownership rebuilt onto the node");
  const edge = g.edges["66666666-6666-4666-8666-666666666666"];
  assertEquals(edge.direction, "bidirectional");
  assertEquals(edge.criticality, "optional", "N8.6(C) behavior fields survive the loop");
  const contract = g.contracts["77777777-7777-4777-8777-777777777777"];
  assertEquals(contract.transport, "grpc");
  assertEquals(contract.schema, {}, "schema CONTENT is not in the anchor — restores empty, honestly");
  const artifact = g.artifacts[A1];
  assertEquals(artifact.content, "", "file content hydrates on demand via the R2.1 lane");
  assertEquals(artifact.metadata.restoredFromAnchor, true);
});
