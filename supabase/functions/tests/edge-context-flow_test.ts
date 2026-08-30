// N8.6(C): edge fields flow through EVERY context surface, consistently.
// The owner's consistency question caught four gaps:
//   (1) edge direction/criticality reached NO export surface (model.json, anchor
//       slice, GraphRefExport all dropped them; adopt-from-anchor could not restore
//       them — not git-durable);
//   (2) the packet fingerprint was blind to contract descriptors (which the packet
//       RENDERS), edge behavior fields, and inline contract.schema;
//   (3) the (B) UI hint claimed the packet reads criticality — false until now:
//       optional/fallback outgoing edges leave must-be-available for a soft list;
//   (4) MCP contract entries lacked the descriptors the packet carries.
import { assert, assertEquals } from "./helpers.ts";
import { serializeModel, parseModel, anchorToPatches } from "../_shared/model-anchor.ts";
import { generateTaskDocument, computeTaskContextFingerprint } from "../_shared/task-document-generator.ts";
import { buildNodeContext } from "../_shared/mcp-context-assembly.ts";

const S = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
function graphWith(edgeExtra: Record<string, unknown>, contractExtra: Record<string, unknown> = {}): any {
  return {
    nodes: {
      [S]: { id: S, type: "backend-service", label: "Api", metadata: {}, ports: [] },
      [T]: { id: T, type: "backend-service", label: "Svc", metadata: {}, ports: [] },
    },
    edges: { e1: { id: "e1", source: S, target: T, contractId: "c1", ...edgeExtra } },
    contracts: { c1: { id: "c1", kind: "rest", name: "Api → Svc", interactionKind: "request_response", transport: "http", specFormat: "openapi", schema: {}, ...contractExtra } },
    artifacts: {},
  };
}

// ── (1) model.json durability ─────────────────────────────────────────────────────

Deno.test("model.json: behavior fields serialize when set, are ABSENT when unset (anchor byte-stability)", async () => {
  const plain = JSON.parse(await serializeModel(graphWith({})));
  assert(!("direction" in plain.edges[0]), "unset direction adds no key — old anchors stay byte-identical");
  assert(!("criticality" in plain.edges[0]), "unset criticality adds no key");

  const set = JSON.parse(await serializeModel(graphWith({ direction: "bidirectional", criticality: "fallback" })));
  assertEquals(set.edges[0].direction, "bidirectional");
  assertEquals(set.edges[0].criticality, "fallback");
  assert(set.edges[0].contentHash !== plain.edges[0].contentHash, "behavior change moves the edge contentHash");
});

Deno.test("adopt-from-anchor restores behavior fields (disaster-recovery path)", async () => {
  const json = await serializeModel(graphWith({ direction: "bidirectional", criticality: "optional" }));
  const parsed = parseModel(json);
  assert(parsed.ok, "round-trips through parseModel");
  // deno-lint-ignore no-explicit-any
  const patches = anchorToPatches((parsed as any).model);
  // deno-lint-ignore no-explicit-any
  const edgePatch = patches.find((p: any) => p.type === "add_edge") as any;
  assertEquals(edgePatch.payload.direction, "bidirectional");
  assertEquals(edgePatch.payload.criticality, "optional");
});

Deno.test("model.json carries REACHABLE contracts only (owner bench: 6 contracts for a 1-edge graph)", async () => {
  const g = graphWith({});
  g.contracts["dead1"] = { id: "b0834d5a-c001-4001-8001-b0834d5a0000", kind: "amqp", name: "Stub: AMQP In", schema: {} };
  g.contracts["dead2"] = { id: "70feb68d-c706-4574-9248-b0f7adba6cc2", kind: "rest", name: "rest contract", schema: {} };
  const model = JSON.parse(await serializeModel(g));
  assertEquals(model.contracts.length, 1, "orphaned stubs and palette-drop leftovers stay canvas-side");
  assertEquals(model.contracts[0].id, "c1");
});

// ── (2) fingerprint sensitivity ───────────────────────────────────────────────────

Deno.test("fingerprint moves on transport override, criticality, and inline schema — stable otherwise", () => {
  // deno-lint-ignore no-explicit-any
  const fp = (g: any) => computeTaskContextFingerprint(g.nodes[S], g, []).fingerprint;
  const base = fp(graphWith({}));
  assertEquals(fp(graphWith({})), base, "same inputs → same fingerprint");
  assert(fp(graphWith({}, { transport: "grpc" })) !== base, "transport override stales the packet");
  assert(fp(graphWith({}, { interactionKind: "event" })) !== base, "interactionKind change stales the packet");
  assert(fp(graphWith({ criticality: "fallback" })) !== base, "criticality change stales the packet");
  assert(fp(graphWith({ direction: "bidirectional" })) !== base, "direction change stales the packet");
  assert(fp(graphWith({}, { schema: { openapi: "3.1.0" } })) !== base, "INLINE schema content stales the packet");
});

// ── (3) criticality reaches the dependency chain ──────────────────────────────────

Deno.test("fallback edge leaves must-be-available for the soft-dependency list", () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = { nodeRoles: {}, technologies: {} };
  const g = graphWith({ criticality: "fallback" });
  const doc = generateTaskDocument({ node: g.nodes[S], graph: g, catalogs, requirements: [] });
  const mustSection = doc.split("**Must be available BEFORE this node starts:**")[1]?.split("**")[0] ?? "";
  assert(!mustSection.includes("Svc"), "fallback target is NOT startup-blocking");
  assert(doc.includes("**Optional / fallback dependencies (NOT startup-blocking):**"), "soft list renders");
  assert(doc.includes("degrade gracefully"), "soft entry carries the degrade instruction");

  const required = generateTaskDocument({ node: g.nodes[S], graph: graphWith({}), catalogs, requirements: [] });
  assert(required.includes("**Must be available BEFORE this node starts:**"), "required (default) edge keeps hard ordering");
  assert(!required.includes("NOT startup-blocking"), "no soft list without soft edges");
});

// ── (4) MCP context carries the same detail level as the packet ──────────────────

Deno.test("MCP contract entries carry descriptors + criticality", () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = { nodeRoles: {}, technologies: {}, legacyTypeMappings: {} };
  const g = graphWith({ criticality: "optional" });
  const ctx = buildNodeContext(g.nodes[S], g, catalogs);
  assertEquals(ctx.contracts.length, 1);
  assertEquals(ctx.contracts[0].interactionKind, "request_response");
  assertEquals(ctx.contracts[0].transport, "http");
  assertEquals(ctx.contracts[0].specFormat, "openapi");
  assertEquals(ctx.contracts[0].criticality, "optional");
});
