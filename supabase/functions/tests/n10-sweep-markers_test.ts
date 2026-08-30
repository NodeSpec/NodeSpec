// N10(a) — the packet-sweep RUBRIC MARKERS, pinned offline. scripts/n10-packet-sweep.ts
// scores rendered packets by grepping for these exact strings/patterns; if the generator
// ever renames a section or the work-order box format, this pin fails HERE instead of
// the sweep silently mis-scoring every role.
import { assert, assertEquals } from "./helpers.ts";
import {
  classifyNodeDeliverable,
  generateTaskDocument,
  IMPLEMENTATION_CONTEXT_HEADING,
} from "../_shared/task-document-generator.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// deno-lint-ignore no-explicit-any
function graph(techId: string | null): any {
  return {
    nodes: {
      [A]: { id: A, type: "backend-service", label: "Node Under Test", technology: techId ?? undefined, metadata: {}, ports: [] },
      [B]: { id: B, type: "backend-service", label: "Neighbor Service", metadata: {}, ports: [] },
    },
    edges: { e1: { id: "e1", source: A, target: B, contractId: "c1" } },
    contracts: { c1: { id: "c1", kind: "rest", name: "Node Under Test → Neighbor Service", interactionKind: "request_response", schema: {} } },
    artifacts: {},
  };
}

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    "backend-service": { id: "backend-service", label: "Backend Service", nature: "build", interface_kind: "service", description: "Server-side service" },
  },
  technologies: {
    express: { id: "express", name: "Express", role_affinities: ["backend-service"], ai_context: { purpose: "Web framework", bestPractices: ["validate input"], configMode: "code" }, metadata_schema: {}, suggested_files: [] },
  },
  deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
};

const REQS = [{
  requirementId: "REQ-001", name: "Primary capability", description: "", category: "functional",
  acceptanceCriteria: [{ text: "primary path succeeds", met: false }],
}];

Deno.test("sweep markers: a canonical render carries every section the rubric greps for", () => {
  const g = graph("express");
  const doc = generateTaskDocument({ node: g.nodes[A], graph: g, catalogs, requirements: REQS as never, projectVision: "A bench project.", requirementNodeMap: { "REQ-001": [A] } });
  assert(doc.includes("## Your Deliverable"), "Your Deliverable heading");
  assert(doc.includes("## Implementation Tasks"), "Implementation Tasks heading");
  assert(/- \[ \] \*\*T\d+ — /.test(doc), "work-order box format '- [ ] **T1 — …**'");
  assert(doc.includes(IMPLEMENTATION_CONTEXT_HEADING), "N5.17 Implementation Context scaffold");
  assert(doc.includes("## Technology Guidance"), "Technology Guidance renders when ai_context is non-empty");
  assert(doc.includes("[PLACEHOLDER:"), "gaps use the standardized placeholder form");
});

Deno.test("sweep markers: classifier vocabulary the cross-rules key on stays stable", () => {
  // The sweep's cross-rules compare classifyNodeDeliverable output against role axes;
  // these are the exact (input → kind) pairs it relies on.
  assertEquals(classifyNodeDeliverable({ nature: "build" }, undefined, { }, null), "code");
  assertEquals(classifyNodeDeliverable({ nature: "build", is_container: true, container_style: "logical-boundary" }, undefined, {}, null), "none");
  assertEquals(classifyNodeDeliverable({ nature: "build", is_container: true, container_style: "hosting" }, undefined, {}, null), "declarative");
  // 'call' is a boundary NATURE (N2.3): treatment wins before ownership, so the class
  // is boundary 'config' — the sweep's cross-rule only demands it is never 'code'.
  assertEquals(classifyNodeDeliverable({ nature: "call" }, undefined, {}, null), "config");
  assertEquals(classifyNodeDeliverable({ nature: "build" }, { configMode: "external" }, {}, null), "external-config");
});

Deno.test("N10(a) first live sweep catch: a logical group's bound technology can NEVER buy it a packet", () => {
  // The service-mesh shape: logical-boundary container + istio-class configMode
  // 'declarative' short-circuited into a deliverable doc. N5.16 is structural — the
  // exclusion wins over ANY configMode.
  for (const mode of ["code", "definition-as-code", "declarative", "external"]) {
    assertEquals(
      classifyNodeDeliverable({ nature: "build", is_container: true, container_style: "logical-boundary" }, { configMode: mode }, {}, null),
      "none",
      `configMode '${mode}' must not override the logical-boundary exclusion`,
    );
  }
  // Hosting containers keep the refinement: compose-style configMode still applies.
  assertEquals(
    classifyNodeDeliverable({ nature: "build", is_container: true, container_style: "hosting" }, { configMode: "definition-as-code" }, {}, null),
    "definition-as-code",
  );
});
