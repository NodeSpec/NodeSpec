// N10(d) — context-surface consistency: every surface an AI builds or designs from
// renders the same enrichment doctrine. The lifecycle vocabulary (migrationTarget /
// retired, shipped in B10) must STEER on all of them: search never surfaces a
// superseded row, lookup and context name the successor first, and the packet warns
// before its curated content invites building on it. securityGuidance and the docsUrl
// pointer (the externals currency mechanism) reach get_node_context, not just the
// committed packet.
import { assert, assertEquals } from "./helpers.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";
import { lookupCatalog } from "../_shared/role-registry.ts";
import { searchCatalog } from "../_shared/catalog-search.ts";
import { buildNodeContext, formatPromptDocument } from "../_shared/mcp-context-assembly.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// deno-lint-ignore no-explicit-any
function catalogsWith(aiContext: Record<string, unknown>): any {
  return {
    nodeRoles: {
      "inference-service": {
        id: "inference-service", label: "Inference Service", nature: "build",
        interface_kind: "service", description: "Model serving", is_container: false,
      },
    },
    technologies: {
      torchserve: {
        id: "torchserve", name: "TorchServe", role_affinities: ["inference-service"],
        ai_context: aiContext, metadata_schema: {}, suggested_files: [], common_connections: [],
      },
    },
    deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
  };
}

Deno.test("N10(d) lookup: a migrated row names its successor FIRST; retired refuses recommendation", () => {
  const migrated = lookupCatalog(
    catalogsWith({ purpose: "PyTorch serving", migrationTarget: "triton" }),
    { technologyId: "torchserve" },
  );
  const lines = migrated.split("\n");
  assert(lines[2].includes("MIGRATED") && lines[2].includes("triton"), "successor named before any content");
  assert(lines.findIndex((l) => l.startsWith("Purpose:")) > 2, "purpose renders after the status line");

  const retired = lookupCatalog(
    catalogsWith({ purpose: "PyTorch serving", lifecycle: "retired" }),
    { technologyId: "torchserve" },
  );
  assert(retired.includes("RETIRED"), "retired status renders");
  assert(retired.includes("Do not recommend"), "retired steers away");
});

Deno.test("N10(d) lookup: docsUrl + configMode render; externals carry the live-docs-win note", () => {
  const external = lookupCatalog(
    catalogsWith({
      purpose: "SaaS row", configMode: "external",
      apiReference: { docsUrl: "https://vendor.example/docs" },
    }),
    { technologyId: "torchserve" },
  );
  assert(external.includes("Docs: https://vendor.example/docs"), "docs pointer renders in lookup");
  assert(external.includes("the live docs win"), "externals authority order stated in lookup");
  assert(external.includes("Config mode: external"), "the row's own configMode renders, not just the legend");

  const sdk = lookupCatalog(
    catalogsWith({ purpose: "SDK row", configMode: "code", apiReference: { docsUrl: "https://sdk.example/docs" } }),
    { technologyId: "torchserve" },
  );
  assert(sdk.includes("Docs: https://sdk.example/docs"), "non-external docs pointer renders plainly");
  assert(!sdk.includes("live docs win"), "no currency note for non-externals");
});

Deno.test("N10(d) search: migrated and retired technologies never surface; healthy rows do", async () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = catalogsWith({ purpose: "PyTorch serving", migrationTarget: "triton" });
  catalogs.technologies.triton = {
    id: "triton", name: "Triton", role_affinities: ["inference-service"],
    ai_context: { purpose: "GPU serving" }, metadata_schema: {}, suggested_files: [], common_connections: [],
  };
  catalogs.technologies.tecton = {
    id: "tecton", name: "Tecton", role_affinities: ["inference-service"],
    ai_context: { purpose: "Feature platform", lifecycle: "retired" }, metadata_schema: {}, suggested_files: [], common_connections: [],
  };
  // deno-lint-ignore no-explicit-any
  const supabase: any = {
    rpc: () => Promise.resolve({
      data: [
        { tech_id: "torchserve", rank: 0.9 },
        { tech_id: "tecton", rank: 0.8 },
        { tech_id: "triton", rank: 0.7 },
      ],
      error: null,
    }),
  };
  const result = await searchCatalog(supabase, catalogs, "serving", 10);
  assert(result.success, "search succeeds");
  const ids = result.success ? result.data.technologies.map((t: { id: string }) => t.id) : [];
  assertEquals(ids, ["triton"], "only the healthy successor surfaces");
});

Deno.test("N10(d) get_node_context: security posture, docs pointer, and lifecycle steering render", () => {
  // deno-lint-ignore no-explicit-any
  const graph: any = {
    nodes: { [A]: { id: A, type: "inference-service", label: "Serving", technology: "torchserve", metadata: {}, ports: [] } },
    edges: {}, contracts: {}, artifacts: {},
  };
  const catalogs = catalogsWith({
    purpose: "SaaS row", configMode: "external", migrationTarget: "triton",
    securityGuidance: "Keys server-side only.",
    apiReference: { docsUrl: "https://vendor.example/docs" },
  });
  const nodeCtx = buildNodeContext(graph.nodes[A], graph, catalogs);
  assertEquals(nodeCtx.technologyContext?.securityGuidance, "Keys server-side only.", "plumbed into the context object");
  assertEquals(nodeCtx.technologyContext?.migrationTarget, "triton", "lifecycle plumbed");
  // deno-lint-ignore no-explicit-any
  const doc = formatPromptDocument({
    projectName: "P", branchName: "main", specification: null,
    target: { id: A, node: nodeCtx },
    architecture: { connectedNodes: [], patterns: [], summary: "" },
    existingArtifacts: [], promptDocument: "", untrustedDataAdvisory: "",
  } as any);
  assert(doc.includes("MIGRATED") && doc.includes("triton"), "context steers to the successor");
  assert(doc.includes("Security: Keys server-side only."), "security posture reaches get_node_context");
  assert(doc.includes("Docs: https://vendor.example/docs"), "docs pointer reaches get_node_context");
  assert(doc.includes("the live docs win"), "externals currency note reaches get_node_context");
});

Deno.test("N10(d) packet: migration banner renders at the top of Technology Guidance", () => {
  // deno-lint-ignore no-explicit-any
  const graph: any = {
    nodes: { [A]: { id: A, type: "inference-service", label: "Serving", technology: "torchserve", metadata: {}, ports: [] } },
    edges: {}, contracts: {}, artifacts: {},
  };
  const doc = generateTaskDocument({
    node: graph.nodes[A], graph,
    catalogs: catalogsWith({ purpose: "PyTorch serving", migrationTarget: "triton" }),
    requirements: [] as never, projectVision: "Bench.",
  });
  assert(doc.includes("Catalog status — migrated"), "packet carries the migration banner");
  assert(doc.includes("superseded by `triton`"), "packet names the successor");
});
