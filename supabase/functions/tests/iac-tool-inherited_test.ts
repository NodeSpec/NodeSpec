// N8.4i-1 (owner IaC ruling): the IaC tool is inherited platform scope, named
// verbatim in declarative packets — and NEVER guessed. Unset → the packet instructs
// confirmation instead of offering a grab-bag (the hallucination guard).
import { assert } from "./helpers.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";

const PLAT = "11111111-1111-1111-1111-111111111111";
const RDS = "22222222-2222-2222-2222-222222222222";

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    aws: { id: "aws", label: "AWS", kind: "platform", is_container: true, treatment_mode: "container" },
    database: { id: "database", label: "Database", kind: "data_store", is_container: false, treatment_mode: "leaf" },
  },
  technologies: {
    "aws-rds": {
      id: "aws-rds", name: "AWS RDS", role_affinities: ["database"],
      ai_context: { configMode: "declarative" },
      suggested_files: [], metadata_schema: {}, common_connections: [],
    },
  },
};

// deno-lint-ignore no-explicit-any
const graphWith = (platformConfig: Record<string, unknown>): any => ({
  nodes: {
    [PLAT]: { id: PLAT, type: "aws", label: "AWS Project", metadata: { config: platformConfig }, ports: [] },
    [RDS]: { id: RDS, type: "database", label: "Primary DB", technology: "aws-rds", parentId: PLAT, metadata: {}, ports: [] },
  },
  edges: {}, contracts: {}, artifacts: {},
});

Deno.test("iacTool set on the platform → the packet names exactly that tool", () => {
  const graph = graphWith({ iacTool: "opentofu" });
  const doc = generateTaskDocument({ node: graph.nodes[RDS], graph, catalogs, requirements: [] });
  assert(doc.includes("IaC — opentofu"), "tool named verbatim");
  assert(doc.includes("do not switch tools per node"), "consistency directive present");
  assert(!doc.includes("do NOT assume one"), "no confirm-fallback when the tool is declared");
});

Deno.test("iacTool unset → the packet instructs confirmation, never a guess", () => {
  const graph = graphWith({});
  const doc = generateTaskDocument({ node: graph.nodes[RDS], graph, catalogs, requirements: [] });
  assert(doc.includes("CONFIRM the tool with the user"), "confirmation directive present");
  assert(doc.includes("do NOT assume one"), "anti-hallucination clause present");
  assert(!doc.includes("IaC — "), "no tool named when none declared");
});
