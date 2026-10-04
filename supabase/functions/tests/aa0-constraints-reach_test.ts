// AA.0 (R.2a, owner 2026-09-23): constraints reach the agent, from the one
// store. The task document carries a "Constraints That Apply Here" block (a
// one-line note when there are none; marked constraints counted, never
// written into a file committed to git); the packet fingerprint moves when a
// constraint or an ancestor's configuration changes; the node context reads
// the table and carries only the node's own requirements; spec.json
// serializes the table; an update_edge that moves an endpoint must name a
// node that exists.
import {
  loadNodeConstraints,
  renderConstraintsSection,
  constraintsSignature,
  constraintRef,
  CONSTRAINTS_HEADING,
  type NodeConstraint,
} from "../_shared/node-constraints.ts";
import { generateTaskDocument, computeTaskContextFingerprint } from "../_shared/task-document-generator.ts";
import { loadSpecificationContext } from "../_shared/mcp-context-assembly.ts";
import { loadSpecPlane } from "../_shared/spec-anchor.ts";
import { findBatchReferenceGaps } from "../mcp-server/tools/proposals.ts";
import { assert, assertEquals, FakeSupabase, scriptOwnerPlan } from "./helpers.ts";

const P = "11111111-1111-4111-8111-111111111111";
const N1 = "a1111111-1111-4111-8111-111111111111";
const N2 = "a2222222-2222-4222-8222-222222222222";
const WF = "w1111111-1111-4111-8111-111111111111";

const c = (over: Partial<NodeConstraint>): NodeConstraint => ({
  id: "c0000000-0000-4000-8000-000000000001", ctype: "security", title: null, description: "Sessions expire after 15 minutes idle",
  rationale: null, workflowId: null, workflowName: null, mark: null, ...over,
});

Deno.test("AA.0 loader: a node gets the project-wide constraints plus those of the workflows its requirements' outcomes are homed on", async () => {
  const sb = scriptOwnerPlan(new FakeSupabase());
  sb.script("project_constraints", "select", { data: [
    { id: "c1", ctype: "cost", title: null, description: "Under 40 dollars a month", rationale: null, workflow_id: null, mark: null },
    { id: "c2", ctype: "performance", title: "Fast checkout", description: "Checkout answers in 300 ms", rationale: "Carts abandon", workflow_id: WF, mark: null },
    { id: "c3", ctype: "security", title: null, description: "Returns keep an audit trail", rationale: null, workflow_id: "w-other", mark: null },
  ], error: null });
  sb.script("workflows", "select", { data: [{ id: WF, name: "Checkout" }, { id: "w-other", name: "Returns" }], error: null });
  sb.script("project_specifications", "select", { data: { id: "spec-1" }, error: null });
  sb.script("specification_mappings", "select", { data: [{ requirement_id: "r1", node_id: N1 }], error: null });
  sb.script("outcome_derivations", "select", { data: [{ candidate_id: "o1", requirement_row_id: "r1" }], error: null });
  sb.script("requirement_candidates", "select", { data: [{ id: "o1", workflow_id: WF }], error: null });

  const byNode = await loadNodeConstraints(sb as never, P, [N1, N2]);
  assertEquals(byNode.get(N1)!.map((x) => x.id), ["c2", "c1"], "the rail's type order: performance before cost");
  assertEquals(byNode.get(N1)![0].workflowName, "Checkout");
  assertEquals(byNode.get(N2)!.map((x) => x.id), ["c1"], "a node serving no workflow gets the project-wide ones only");
});

Deno.test("AA.0 loader: no constraints costs one read and every node asked for gets an empty list", async () => {
  const sb = scriptOwnerPlan(new FakeSupabase());
  sb.script("project_constraints", "select", { data: [], error: null });
  const byNode = await loadNodeConstraints(sb as never, P, [N1]);
  assertEquals(byNode.get(N1), []);
  assertEquals(sb.callsTo("project_constraints").length, 1);
});

Deno.test("AC loader: below Indie nothing is read and no node gets an entry, so nothing is rendered or hashed", async () => {
  const sb = scriptOwnerPlan(new FakeSupabase(), "community");
  sb.script("project_constraints", "select", { data: [{ id: "c1", ctype: "cost", title: null, description: "Under 40 dollars a month", rationale: null, workflow_id: null, mark: null }], error: null });
  const byNode = await loadNodeConstraints(sb as never, P, [N1]);
  assertEquals(byNode.get(N1), undefined);
  assertEquals(sb.callsTo("project_constraints").length, 0, "rows kept from a paid plan are not read");
  const g = graph();
  assertEquals(
    computeTaskContextFingerprint(g.nodes[N1], g, [], "v", catalogs, byNode.get(N1)).fingerprint,
    computeTaskContextFingerprint(g.nodes[N1], g, [], "v", catalogs, undefined).fingerprint,
    "a Community packet hashes as one that never loaded constraints",
  );
  assert(!generateTaskDocument({ node: g.nodes[N1], graph: g, catalogs, requirements: [], constraints: byNode.get(N1) }).includes(CONSTRAINTS_HEADING), "no block");

  const orphan = new FakeSupabase(); // the project row does not read: a no
  assertEquals((await loadNodeConstraints(orphan as never, P, [N1])).size, 0);
});

Deno.test("AA.0 doc block: none is a one-line note; open ones carry type, title, id, reason and scope; marked ones are counted, never written", () => {
  assertEquals(renderConstraintsSection(undefined), [], "a caller that did not load them renders nothing");
  const none = renderConstraintsSection([]).join("\n");
  assert(none.startsWith(CONSTRAINTS_HEADING));
  assert(none.includes("None recorded for this node."));
  const lines = renderConstraintsSection([
    c({ title: "Short sessions", rationale: "Stolen sessions die fast" }),
    c({ id: "c0000000-0000-4000-8000-000000000002", ctype: "performance", description: "Checkout answers in 300 ms", workflowId: WF, workflowName: "Checkout" }),
    c({ id: "c0000000-0000-4000-8000-000000000003", description: "The CUI enclave is air-gapped", mark: "CUI" }),
  ]).join("\n");
  assert(lines.includes(`- **[security] Short sessions** (${constraintRef("c0000000-0000-4000-8000-000000000001")}): Sessions expire after 15 minutes idle Why: Stolen sessions die fast (holds for the whole project)`), lines);
  assert(lines.includes('(holds for the "Checkout" workflow)'), lines);
  assert(!lines.includes("air-gapped"), "a marked constraint never lands in the file");
  assert(lines.includes("1 more constraint carries a classification mark"), lines);
  assertEquals(constraintRef("c0000000-0000-4000-8000-000000000001"), "c:c0000000");
});

// deno-lint-ignore no-explicit-any
const catalogs: any = { nodeRoles: { "backend-service": { id: "backend-service", label: "Backend Service", nature: "build", is_container: false } }, technologies: {} };
// deno-lint-ignore no-explicit-any
const graph = (): any => ({
  nodes: {
    [N2]: { id: N2, type: "backend-service", label: "Platform", metadata: { config: { region: "eu-west-1" } }, ports: [] },
    [N1]: { id: N1, type: "backend-service", label: "API", parentId: N2, metadata: {}, ports: [] },
  },
  edges: {}, contracts: {}, artifacts: {},
});

Deno.test("AA.0 generator: the block sits before the work orders, for the node's own constraints", () => {
  const g = graph();
  const doc = generateTaskDocument({ node: g.nodes[N1], graph: g, catalogs, requirements: [], constraints: [c({ title: "Short sessions" })] });
  const at = doc.indexOf(CONSTRAINTS_HEADING);
  assert(at > doc.indexOf("## Your Deliverable"), "after the deliverable");
  assert(at < doc.indexOf("## Implementation Tasks"), "before the work orders");
  assert(doc.includes("Short sessions"));
  const without = generateTaskDocument({ node: g.nodes[N1], graph: g, catalogs, requirements: [] });
  assert(!without.includes(CONSTRAINTS_HEADING), "older callers that pass none render no block");
});

Deno.test("AA.0 fingerprint: a constraint change re-stales the packet; so does an ancestor's configuration", () => {
  const g = graph();
  const base = computeTaskContextFingerprint(g.nodes[N1], g, [], "v", catalogs, [c({})]).fingerprint;
  assertEquals(computeTaskContextFingerprint(g.nodes[N1], g, [], "v", catalogs, [c({})]).fingerprint, base, "stable");
  assert(computeTaskContextFingerprint(g.nodes[N1], g, [], "v", catalogs, [c({ description: "Sessions expire after 5 minutes idle" })]).fingerprint !== base, "reworded");
  assert(computeTaskContextFingerprint(g.nodes[N1], g, [], "v", catalogs, []).fingerprint !== base, "removed");
  assertEquals(constraintsSignature([]), constraintsSignature(undefined), "none loaded and none recorded hash alike");
  const g2 = graph();
  g2.nodes[N2].metadata = { config: { region: "us-east-1" } };
  assert(computeTaskContextFingerprint(g2.nodes[N1], g2, [], "v", catalogs, [c({})]).fingerprint !== base, "the parent's config reaches the child");
});

Deno.test("AA.0 node context: a node with no requirement mapped gets none (not the project's first ten), and its constraints from the table", async () => {
  const sb = scriptOwnerPlan(new FakeSupabase());
  sb.script("project_specifications", "select", { data: { id: "spec-1", vision: "v", constraints: [{ type: "legacy", description: "never read" }], preferences: {} }, error: null });
  sb.script("specification_requirements", "select", { data: [
    { id: "r1", requirement_id: "REQ-001", name: "Sign in", description: "", category: "functional", status: "pending", acceptance_criteria: [] },
  ], error: null });
  sb.script("specification_mappings", "select", { data: [], error: null });
  sb.script("project_constraints", "select", { data: [{ id: "c1", ctype: "cost", title: null, description: "Under 40 dollars a month", rationale: null, workflow_id: null, mark: null }], error: null });
  const ctx = await loadSpecificationContext(sb as never, P, N1);
  assertEquals(ctx!.relevantRequirements, []);
  assertEquals(ctx!.constraints!.map((x) => [x.ctype, x.description, x.ref]), [["cost", "Under 40 dollars a month", "c:c1"]]);

  // AC: below Indie the context carries no constraints field at all
  const community = scriptOwnerPlan(new FakeSupabase(), "community");
  community.script("project_specifications", "select", { data: { id: "spec-1", vision: "v", preferences: {} }, error: null });
  community.script("specification_requirements", "select", { data: [], error: null });
  community.script("specification_mappings", "select", { data: [], error: null });
  const none = await loadSpecificationContext(community as never, P, N1);
  assert(!("constraints" in none!), "not an empty list: the field is left out");
  assertEquals(community.callsTo("project_constraints").length, 0);
});

Deno.test("AA.0 spec.json: constraints come from the table, marked ones stay out, the workflow travels by name", async () => {
  const sb = new FakeSupabase();
  sb.script("project_specifications", "select", { data: { id: "spec-1", vision: "v", preferences: {} }, error: null });
  sb.script("specification_requirements", "select", { data: [], error: null });
  sb.script("specification_mappings", "select", { data: [], error: null });
  sb.script("project_constraints", "select", { data: [
    { ctype: "security", title: "Short sessions", description: "Sessions expire after 15 minutes idle", rationale: null, workflow_id: null, mark: null, workflows: null },
    { ctype: "performance", title: null, description: "Checkout answers in 300 ms", rationale: "Carts abandon", workflow_id: WF, mark: null, workflows: { name: "Checkout" } },
    { ctype: "security", title: null, description: "The enclave is air-gapped", rationale: null, workflow_id: null, mark: "CUI", workflows: null },
  ], error: null });
  const plane = await loadSpecPlane(sb as never, P, { constraintsCarried: true });
  assertEquals(plane!.spec.constraints, [
    { type: "performance", description: "Checkout answers in 300 ms", rationale: "Carts abandon", workflow: "Checkout" },
    { type: "security", description: "Sessions expire after 15 minutes idle", title: "Short sessions" },
  ]);

  // AC: below Indie (the caller asked the owner's plan) spec.json carries none, and the rows are not read
  const community = new FakeSupabase();
  community.script("project_specifications", "select", { data: { id: "spec-1", vision: "v", preferences: {} }, error: null });
  community.script("specification_requirements", "select", { data: [], error: null });
  community.script("specification_mappings", "select", { data: [], error: null });
  const bare = await loadSpecPlane(community as never, P, { constraintsCarried: false });
  assertEquals(bare!.spec.constraints, []);
  assertEquals(community.callsTo("project_constraints").length, 0);
});

Deno.test("AA.0 batch references: an update_edge that moves an endpoint must name a node that exists or that the batch creates", () => {
  const existing = { nodes: [N1], contracts: [], edges: ["e1"] };
  const gaps = findBatchReferenceGaps([
    { type: "update_edge", payload: { id: "e1", changes: { source: N2 } } },
  ], existing as never);
  assertEquals(gaps.map((g) => [g.field, g.missingId]), [["changes.source", N2]]);
  assertEquals(findBatchReferenceGaps([
    { type: "add_node", payload: { id: N2, type: "backend-service", label: "Part" } },
    { type: "update_edge", payload: { id: "e1", changes: { target: N2 } } },
  ], existing as never), [], "a part the batch adds resolves");
});
