// N8.6(A): packet error-handling + dependency-ordering pins.
// (1) Protocol guidance keys on contract KIND first — the old
//     `interactionKind || contractKind` collapse made the grpc/websocket branches
//     unreachable whenever interactionKind was set (always, the UI force-fills it),
//     and tested phantom tokens (rest_api, pub_sub, async_job, database, realtime)
//     that exist in no enum.
// (2) websocket/sse are connection-oriented: payload semantics stay event (async),
//     but dependency ORDERING follows the transport — you connect TO the server, so
//     it must exist first.
import { assert } from "./helpers.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";

const S = "11111111-1111-1111-1111-111111111111";
const G = "22222222-2222-2222-2222-222222222222";
const W = "33333333-3333-3333-3333-333333333333";
const K = "44444444-4444-4444-4444-444444444444";

// deno-lint-ignore no-explicit-any
const catalogs: any = { nodeRoles: {}, technologies: {} };

// deno-lint-ignore no-explicit-any
function buildGraph(): any {
  return {
    nodes: {
      [S]: { id: S, type: "backend-service", label: "Api", metadata: {}, ports: [] },
      [G]: { id: G, type: "backend-service", label: "GrpcSvc", metadata: {}, ports: [] },
      [W]: { id: W, type: "backend-service", label: "WsHub", metadata: {}, ports: [] },
      [K]: { id: K, type: "message-broker", label: "Bus", metadata: {}, ports: [] },
    },
    edges: {
      e1: { id: "e1", source: S, target: G, contractId: "c1" },
      e2: { id: "e2", source: S, target: W, contractId: "c2" },
      e3: { id: "e3", source: S, target: K, contractId: "c3" },
    },
    contracts: {
      c1: { id: "c1", kind: "grpc", name: "Api → GrpcSvc", interactionKind: "request_response", transport: "grpc", specFormat: "protobuf", schema: {} },
      c2: { id: "c2", kind: "websocket", name: "Api → WsHub", interactionKind: "event", transport: "websocket", specFormat: "json_schema", schema: {} },
      c3: { id: "c3", kind: "kafka", name: "Api → Bus", interactionKind: "event", transport: "kafka", specFormat: "asyncapi", schema: {} },
    },
    artifacts: {},
  };
}

Deno.test("grpc protocol guidance is reachable despite interactionKind being set", () => {
  const graph = buildGraph();
  const doc = generateTaskDocument({ node: graph.nodes[S], graph, catalogs, requirements: [] });
  assert(doc.includes('gRPC errors from GrpcSvc ("Api → GrpcSvc"): handle UNAVAILABLE'), "kind-first routing reaches the gRPC branch");
  assert(!doc.includes('HTTP errors from GrpcSvc'), "grpc contract no longer collapses into the generic HTTP line");
});

Deno.test("websocket protocol guidance is reachable despite interactionKind 'event'", () => {
  const graph = buildGraph();
  const doc = generateTaskDocument({ node: graph.nodes[S], graph, catalogs, requirements: [] });
  assert(doc.includes('WebSocket failures for WsHub'), "kind-first routing reaches the WebSocket branch");
  assert(!doc.includes('Event delivery failures to WsHub'), "websocket contract is not treated as fire-and-forget event delivery");
});

Deno.test("outgoing websocket orders the SERVER as a startup dependency (connection-oriented)", () => {
  const graph = buildGraph();
  const doc = generateTaskDocument({ node: graph.nodes[S], graph, catalogs, requirements: [] });
  const mustSection = doc.split("**Must be available BEFORE this node starts:**")[1]?.split("**Depends on THIS node")[0] ?? "";
  assert(mustSection.includes("WsHub"), "you connect TO a websocket server — it must exist first");
  assert(!mustSection.includes("Bus"), "kafka stays async — the broker target is a consumer, not a startup dependency");
});

Deno.test("outgoing kafka event keeps its async semantics end-to-end", () => {
  const graph = buildGraph();
  const doc = generateTaskDocument({ node: graph.nodes[S], graph, catalogs, requirements: [] });
  assert(doc.includes('Event delivery failures to Bus'), "kafka event contract keeps DLQ/backoff guidance");
  const dependsSection = doc.split("**Depends on THIS node being available:**")[1] ?? "";
  assert(dependsSection.includes("Bus"), "kafka target consumes this node's output");
});

Deno.test("incoming grpc emits gRPC status-code guidance", () => {
  const graph = buildGraph();
  // reverse the grpc edge: GrpcSvc calls Api
  graph.edges.e1 = { id: "e1", source: G, target: S, contractId: "c1" };
  const doc = generateTaskDocument({ node: graph.nodes[S], graph, catalogs, requirements: [] });
  assert(doc.includes('gRPC error responses to GrpcSvc'), "incoming grpc reaches the emit branch");
  assert(!doc.includes('HTTP error responses to GrpcSvc'), "incoming grpc does not collapse into the HTTP line");
});
