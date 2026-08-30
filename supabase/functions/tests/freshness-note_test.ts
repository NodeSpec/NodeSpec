// N8.4g: ai_context.freshnessNote is a RENDERED surface (the assistantsApiNote
// lesson — notes that render nowhere are dead data). Dated deprecation/license/
// ownership facts must reach the packet's Technology Guidance and the MCP lookup.
import { assert } from "./helpers.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";

const N1 = "11111111-1111-1111-1111-111111111111";

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    "message-broker": {
      id: "message-broker", label: "Message Broker", kind: "infrastructure",
      is_container: false, treatment_mode: "leaf",
    },
  },
  technologies: {
    kafka: {
      id: "kafka", name: "Apache Kafka", role_affinities: ["message-broker"],
      ai_context: {
        purpose: "Distributed event streaming.",
        freshnessNote: "Kafka 4.x is KRaft-ONLY — ZooKeeper was removed in 4.0.",
      },
      suggested_files: [], metadata_schema: {}, common_connections: [],
    },
    nats: {
      id: "nats", name: "NATS", role_affinities: ["message-broker"],
      ai_context: { purpose: "Lightweight messaging." },
      suggested_files: [], metadata_schema: {}, common_connections: [],
    },
  },
};

// deno-lint-ignore no-explicit-any
const graphWith = (technology: string): any => ({
  nodes: { [N1]: { id: N1, type: "message-broker", label: "Bus", technology, metadata: {}, ports: [] } },
  edges: {}, contracts: {}, artifacts: {},
});

Deno.test("freshnessNote renders in the packet's Technology Guidance", () => {
  const graph = graphWith("kafka");
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("**Freshness:** Kafka 4.x is KRaft-ONLY"), "dated fact reaches the packet");
});

Deno.test("no freshnessNote → no Freshness line", () => {
  const graph = graphWith("nats");
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(!doc.includes("**Freshness:**"), "line absent when the key is absent");
});
