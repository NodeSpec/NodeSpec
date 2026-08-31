// N5.17 (owner ruling 2026-08-08): the packet's ONE AI-authored section.
//
// The packet is a hybrid document — derived sections regenerate freely; the
// "Implementation Context" section belongs to the CONSUMING AI (project-specific
// integration/config context no catalog can know) and survives regeneration
// verbatim. The inversion holds: NodeSpec emits the scaffold and preserves prose,
// it never writes the prose. The section is structurally excluded from the
// fingerprint (computeTaskContextFingerprint hashes derived inputs, never doc
// content), so authoring it can never re-stale the packet it lives in.
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";
import {
  generateTaskDocument,
  computeTaskContextFingerprint,
  preserveImplementationContextSection,
  IMPLEMENTATION_CONTEXT_HEADING,
  IMPLEMENTATION_CONTEXT_PLACEHOLDER,
  IMPLEMENTATION_CONTEXT_REVIEW_MARKER,
  implementationContextScaffold,
} from "../_shared/task-document-generator.ts";
import { refreshTaskPackets } from "../_shared/packet-freshness.ts";

const N1 = "11111111-1111-1111-1111-111111111111";

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    "backend-service": { id: "backend-service", label: "Backend Service", nature: "build", is_container: false },
    "application-module": { id: "application-module", label: "Module", nature: "build", is_container: true, container_style: "logical-boundary" },
  },
  technologies: {},
};

// deno-lint-ignore no-explicit-any
const graphWith = (type: string): any => ({
  nodes: { [N1]: { id: N1, type, label: "API Service", metadata: {}, ports: [] } },
  edges: {}, contracts: {}, artifacts: {},
});

Deno.test("N5.17: packet emits the Implementation Context scaffold — heading, placeholder, author-before-building directive, both entry lanes named", () => {
  const graph = graphWith("backend-service");
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes(IMPLEMENTATION_CONTEXT_HEADING), "section present");
  assert(doc.includes(IMPLEMENTATION_CONTEXT_PLACEHOLDER), "placeholder present at birth");
  assert(doc.includes("author this section BEFORE building"), "directive present");
  assert(doc.includes("change card") && doc.includes("update_artifact"), "both entry lanes named — no new tools");
  const sectionIdx = doc.indexOf(IMPLEMENTATION_CONTEXT_HEADING);
  const tasksIdx = doc.indexOf("## Implementation Tasks");
  assert(sectionIdx !== -1 && tasksIdx !== -1 && sectionIdx < tasksIdx, "context precedes the work orders");
});

Deno.test("N5.17: a taskless node (logical-boundary container, deliverable none) emits NO section", () => {
  const graph = graphWith("application-module");
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(!doc.includes(IMPLEMENTATION_CONTEXT_HEADING), "no deliverable → nothing to contextualize");
});

// ── preserveImplementationContextSection pins ─────────────────────────────────────

function docWithSection(body: string[]): string {
  return [
    "# Task: API Service",
    "",
    IMPLEMENTATION_CONTEXT_HEADING,
    "",
    ...body,
    "",
    "## Implementation Tasks",
    "",
    "- [ ] T1 derived work order",
  ].join("\n");
}

const AUTHORED = ["This service composes Express with the Store via the SQL contract; pool size 5 because of bench findings."];

Deno.test("N5.17 preserve: authored prose is carried VERBATIM into the regenerated doc; derived sections come from the regeneration", () => {
  const stored = docWithSection(AUTHORED).replace("T1 derived work order", "T1 OLD order");
  const regenerated = docWithSection([`${IMPLEMENTATION_CONTEXT_PLACEHOLDER} directive text`]);
  const out = preserveImplementationContextSection(regenerated, stored);
  assert(out.includes(AUTHORED[0]), "authored prose survived");
  assert(!out.includes(IMPLEMENTATION_CONTEXT_PLACEHOLDER), "placeholder replaced by the authored prose");
  assert(out.includes("T1 derived work order"), "derived sections are the REGENERATED ones");
});

Deno.test("N5.17 preserve: an unedited scaffold is NOT preserved — the fresh scaffold wins (directive wording may improve)", () => {
  const stored = docWithSection([`${IMPLEMENTATION_CONTEXT_PLACEHOLDER} OLD directive wording`]);
  const regenerated = docWithSection([`${IMPLEMENTATION_CONTEXT_PLACEHOLDER} NEW directive wording`]);
  const out = preserveImplementationContextSection(regenerated, stored);
  assert(out.includes("NEW directive wording"), "fresh scaffold kept");
  assert(!out.includes("OLD directive wording"));
});

Deno.test("N5.17 preserve: flagReview inserts the REVIEW-NEEDED line ONCE under the heading — never duplicated, never wiped", () => {
  const stored = docWithSection(AUTHORED);
  const regenerated = docWithSection([`${IMPLEMENTATION_CONTEXT_PLACEHOLDER} directive`]);
  const flagged = preserveImplementationContextSection(regenerated, stored, { flagReview: true });
  assert(flagged.includes(IMPLEMENTATION_CONTEXT_REVIEW_MARKER), "marker inserted");
  assert(flagged.indexOf(IMPLEMENTATION_CONTEXT_REVIEW_MARKER) < flagged.indexOf(AUTHORED[0]), "marker sits above the prose");
  // Second regeneration around the already-flagged doc: still exactly one marker.
  const again = preserveImplementationContextSection(regenerated, flagged, { flagReview: true });
  assertEquals(again.split(IMPLEMENTATION_CONTEXT_REVIEW_MARKER).length - 1, 1, "idempotent — one marker");
  assert(again.includes(AUTHORED[0]), "prose still intact");
});

Deno.test("N5.17 preserve: regenerated doc without the section (node became taskless) is returned unchanged — no resurrection", () => {
  const stored = docWithSection(AUTHORED);
  const regenerated = "# Task: API Service\n\n**No implementation task.**";
  assertEquals(preserveImplementationContextSection(regenerated, stored), regenerated);
});

// ── Fingerprint exclusion + the C1 freshness path, end to end ────────────────────

Deno.test("N5.17 fingerprint exclusion: authoring the section changes NO fingerprint input — a fresh packet with authored prose is untouched by the gate", async () => {
  const sb = new FakeSupabase();
  for (const t of ["node_roles", "technology_catalog", "deployment_targets", "legacy_type_mappings", "cloud_provider_patterns", "scope_archetypes"]) {
    sb.script(t, "select", { data: [], error: null });
  }
  sb.script("project_specifications", "select", { data: null, error: null });
  const graph = graphWith("backend-service");
  const node = graph.nodes[N1];
  const fp = computeTaskContextFingerprint(
    { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports },
    graph, [],
    // N10(b): stamp against the same empty catalogs the gate loads — the point of
    // this pin is that CONTENT is excluded, so the fingerprint must otherwise match.
    undefined,
    { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} } as never,
  );
  const authoredContent = docWithSection(AUTHORED);
  graph.artifacts["task-1"] = {
    id: "task-1", nodeId: N1, kind: "task", path: ".nodespec/tasks/api-service.task.md",
    content: authoredContent, metadata: { taskContextFingerprint: fp },
  };
  const r = await refreshTaskPackets(sb as never, "proj-1", graph);
  assertEquals(r.checked, 1);
  assertEquals(r.refreshed, 0, "content is not a fingerprint input — authored edit alone never re-stales");
  assertEquals(graph.artifacts["task-1"].content, authoredContent, "byte-identical");
});

Deno.test("N5.17 freshness path: a REAL fingerprint flip regenerates the doc AROUND the authored section and flags it REVIEW-NEEDED", async () => {
  const sb = new FakeSupabase();
  // Catalog/spec loads the gate performs before regenerating (same script shape as
  // packet-freshness_test.ts).
  for (const t of ["node_roles", "technology_catalog", "deployment_targets", "legacy_type_mappings", "cloud_provider_patterns", "scope_archetypes"]) {
    sb.script(t, "select", { data: [], error: null });
  }
  sb.script("project_specifications", "select", { data: null, error: null });

  // Graph gains an edge+contract the stored fingerprint never saw → stale on
  // arrival (same staleness construction as packet-freshness_test.ts).
  const graph = graphWith("backend-service");
  const N2 = "22222222-2222-2222-2222-222222222222";
  const node = graph.nodes[N1];
  const staleFp = computeTaskContextFingerprint(
    { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports },
    graph, [],
  );
  graph.nodes[N2] = { id: N2, type: "database", label: "Store", metadata: {}, ports: [] };
  graph.edges["e1"] = { id: "e1", source: N1, target: N2, contractId: "c1" };
  graph.contracts["c1"] = { id: "c1", kind: "sql", name: "API to Store" };
  graph.artifacts["task-1"] = {
    id: "task-1", nodeId: N1, kind: "task", path: ".nodespec/tasks/api-service.task.md",
    content: docWithSection(AUTHORED), metadata: { taskContextFingerprint: staleFp },
  };
  const r = await refreshTaskPackets(sb as never, "proj-1", graph);
  assertEquals(r.refreshed, 1);
  const out = String(graph.artifacts["task-1"].content);
  assert(out.includes(AUTHORED[0]), "authored prose survived the regeneration");
  assert(out.includes(IMPLEMENTATION_CONTEXT_REVIEW_MARKER), "fingerprint flip flagged the section");
  assert(out.includes("## Your Deliverable"), "derived sections are the real regenerated doc");
});

Deno.test("marker spelling is ONE string everywhere the doc teaches it (dogfood find 2026-09-02)", async () => {
  // The Godot project's AI grepped the spelling the placeholder taught
  // ("REVIEW-NEEDED") and got a false zero: the real marker says
  // "REVIEW NEEDED". Every occurrence in emitted document text must use the
  // marker's own spelling.
  const src = await Deno.readTextFile(new URL("../_shared/task-document-generator.ts", import.meta.url));
  assert(src.includes("REVIEW NEEDED:"), "marker spelling present");
  const emitted = implementationContextScaffold().join("\n");
  assert(emitted.includes("REVIEW NEEDED"), "scaffold teaches the real spelling");
  assert(!emitted.includes("REVIEW-NEEDED"), "hyphenated variant must not survive in emitted text");
});
