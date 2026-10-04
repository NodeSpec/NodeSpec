// AG.12b (owner 2026-09-28, "fine"): the packet says where a node runs.
//  - Every placed node's packet carries a Runs on line: the chain up to the account, the
//    host that runs the code with its type and technology, where the host's recorded
//    choices are, and that the rest is in the host's packet.
//  - A host's packet lists each node it runs with its technology, so its deploy
//    definition is written for the right framework.
//  - Code written against a platform's own API, with no host, reads that its platform
//    configuration is its own.
//  - The fingerprint moves when the chain above a node, or a node a host runs, changes.
import { assert, assertEquals, completeRole } from "./helpers.ts";
import type { CatalogData, NodeRoleRow } from "../_shared/catalog-loader.ts";
import { computeTaskContextFingerprint, generateTaskDocument } from "../_shared/task-document-generator.ts";

const role = (id: string, label: string, extra: Partial<NodeRoleRow> = {}): NodeRoleRow => completeRole({
  id, label, description: "", palette_category: "Services", nature: "build", interface_kind: "service", provider: null,
  is_container: false, container_layer: null, container_style: null, can_contain: [], capability_tags: [],
  metadata_schema: {}, suggested_contracts: [], default_technology: null, when_to_use: null, deprecated: false, sort_order: 1,
  ...extra,
} as Record<string, unknown>) as unknown as NodeRoleRow;
const box = (id: string, label: string, layer: string, extra: Partial<NodeRoleRow> = {}) =>
  role(id, label, { is_container: true, container_layer: layer, container_style: "hosting", palette_category: "Infrastructure", can_contain: ["backend-service"], ...extra });

const catalogs = {
  nodeRoles: Object.fromEntries([
    role("backend-service", "Backend Service"),
    role("serverless-function", "Serverless Function"),
    box("docker-container", "Container or App Runtime", "runtime"),
    box("vpc", "VPC / Virtual Network", "infrastructure"),
    box("gcp", "Google Cloud", "infrastructure", { nature: "host", provider: "gcp", palette_category: "Platform" }),
    box("aws", "AWS", "infrastructure", { nature: "host", provider: "aws", palette_category: "Platform" }),
  ].map((r) => [r.id, r])),
  technologies: {
    express: { id: "express", name: "Express", role_affinities: ["backend-service"], ai_context: { configMode: "code" } },
    fastapi: { id: "fastapi", name: "FastAPI", role_affinities: ["backend-service"], ai_context: { configMode: "code" } },
    "gcp-app-engine": { id: "gcp-app-engine", name: "Google App Engine", role_affinities: ["docker-container"], ai_context: {} },
    "aws-lambda": { id: "aws-lambda", name: "AWS Lambda", role_affinities: ["serverless-function"], ai_context: { configMode: "code" } },
  },
  deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {}, catalogIssues: [],
} as unknown as CatalogData;

const node = (id: string, type: string, label: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, label, metadata: {}, ...extra });
function graph() {
  return {
    nodes: {
      g: node("g", "gcp", "Google Cloud"),
      v: node("v", "vpc", "Production VPC", { parentId: "g", placementKind: "contains" }),
      h: node("h", "docker-container", "App Engine", { parentId: "v", placementKind: "contains", technology: "gcp-app-engine", metadata: { config: { runtime: "nodejs20", instanceClass: "F2" } } }),
      api: node("api", "backend-service", "Orders API", { parentId: "h", placementKind: "hosts", technology: "express" }),
      a: node("a", "aws", "AWS"),
      fn: node("fn", "serverless-function", "Resize", { parentId: "a", placementKind: "contains", technology: "aws-lambda" }),
      solo: node("solo", "backend-service", "Loose"),
    },
    edges: {}, contracts: {}, artifacts: {},
  };
}
// deno-lint-ignore no-explicit-any
const doc = (g: any, id: string) => generateTaskDocument({ node: g.nodes[id], graph: g, catalogs, requirements: [] } as never);

Deno.test("AG.12b: a service on App Engine carries its Runs on line, naming the host, its technology and its choices", () => {
  const d = doc(graph(), "api");
  assert(d.includes("**Runs on:** Orders API in App Engine in Production VPC in Google Cloud."), d);
  assert(d.includes("**Host:** App Engine (Container or App Runtime, Google App Engine) runs this code; write it for that runtime. " +
    "The host's recorded choices are under Inherited Context below; the rest of its setup is in App Engine's own task document."), d);
  assert(d.includes("From **App Engine** (docker-container): runtime: nodejs20"), "the host's choices render where the line says");
  assert(!d.includes("**Parent Container:**"), "the parent is not said twice");
});

Deno.test("AG.12b: the host's packet names each service it runs with its framework, and where it sits", () => {
  const d = doc(graph(), "h");
  assert(d.includes("**Sits in:** Production VPC in Google Cloud."), d);
  assert(d.includes("**Runs (write this host's deploy definition for each one's technology):**"), d);
  assert(d.includes("- Orders API (Backend Service): Express"), d);
  // a network places what it holds: its list stays a plain Contains
  const vpc = doc(graph(), "v");
  assert(vpc.includes("**Contains:**") && vpc.includes("- App Engine (Container or App Runtime): Google App Engine"), vpc);
});

Deno.test("AG.12b: a function with no host reads that its platform configuration is its own; a host with no choices says so", () => {
  const d = doc(graph(), "fn");
  assert(d.includes("**Runs on:** AWS Lambda, in AWS. Its platform configuration (runtime, memory, timeout, triggers, permissions) is this node's own, not a host's."), d);
  const g = graph();
  g.nodes.h.metadata = {};
  assert(doc(g, "api").includes("The host records no choices yet; the rest of its setup is in App Engine's own task document."), "no choices recorded");
  assert(!doc(graph(), "solo").includes("**Runs on:**"), "a node placed nowhere has no Runs on line");
});

Deno.test("AG.12b: the fingerprint moves with the chain above a node and with what a host runs, and only then", () => {
  const fp = (g: ReturnType<typeof graph>, id: string) =>
    computeTaskContextFingerprint(g.nodes[id as keyof typeof g.nodes] as never, g as never, [], undefined, catalogs).fingerprint;
  const base = graph();
  const renamed = graph();
  renamed.nodes.v.label = "Main VPC";
  assert(fp(base, "api") !== fp(renamed, "api"), "renaming the VPC re-stales the service's packet");
  const reframed = graph();
  reframed.nodes.api.technology = "fastapi";
  assert(fp(base, "h") !== fp(reframed, "h"), "a new framework on the service re-stales the host's packet");
  assertEquals(fp(base, "solo"), fp(renamed, "solo"), "a node with no chain and no children is untouched");
  // deno-lint-ignore no-explicit-any
  const fields = computeTaskContextFingerprint(base.nodes.solo as never, base as never, [], undefined, catalogs).fields as any;
  assertEquals(fields.placementSignature, undefined, "no field for an unplaced leaf, so its stored fingerprint stands");
});
