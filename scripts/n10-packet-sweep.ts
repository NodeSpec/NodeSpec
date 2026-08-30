// N10(a) — the PACKET-QUALITY SWEEP. The generator is pure and renders offline, so
// packet quality is a script, not an opinion: for EVERY live role × its best
// representative technology, render the packet against a canonical scratch graph and
// score it against the fixed rubric. Output: docs/N10_PACKET_QUALITY.md.
// Every `fail` is a bug; every `weak` is an enrichment item.
//
//   npm run n10:sweep
//   (reads scripts/bench/.env.bench like the bench harness; env vars win)
//
// Rubric (the board's five lines, mechanized):
//   1. deliverable classified correctly — cross-rules, not re-derivation: a managed
//      service never gets "working code", a hosted framework never gets IaC,
//      hosting containers provision, logical Structure is excluded entirely
//   2. Implementation Tasks present with ordered work-order boxes
//   3. Manual Steps present exactly where the rule demands (external-config /
//      connection-only deliverables)
//   4. Technology Guidance present, or the row is flagged as data-thin (weak)
//   5. zero fabricated specifics — no TODO/FIXME/TBD tokens; every gap the
//      standardized [PLACEHOLDER: …]; N5.17 Implementation Context scaffold present

import {
  assessNodeReadiness,
  classifyNodeDeliverable,
  generateTaskDocument,
  IMPLEMENTATION_CONTEXT_HEADING,
} from "../supabase/functions/_shared/task-document-generator.ts";
import { registerProviderFamilies } from "../supabase/functions/_shared/provider-inference.ts";
import { assessTechnologyGtmReadiness } from "../supabase/functions/_shared/catalog-schemas.ts";
import { resolveSweepEnv } from "./n10-lib.ts";

const { SUPABASE_URL, KEY } = resolveSweepEnv(import.meta.url);

async function rest(table: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1000`, {
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return await res.json();
}

let roleRows: Record<string, unknown>[];
let techRows: Record<string, unknown>[];
let targetRows: Record<string, unknown>[];
try {
  [roleRows, techRows, targetRows] = await Promise.all([
    rest("node_roles"), rest("technology_catalog"), rest("deployment_targets"),
  ]);
} catch (e) {
  // Fetch-level failure = unreachable; HTTP error = the stack answered and the QUERY
  // is wrong — opposite fixes, so say which.
  if (e instanceof TypeError) {
    console.error(`Could not reach ${SUPABASE_URL} — is the local Supabase stack running?`);
  } else {
    console.error(`The stack at ${SUPABASE_URL} answered but the query failed (a script bug, not your setup):`);
  }
  console.error(String(e));
  Deno.exit(1);
}

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: Object.fromEntries(roleRows.map((r) => [r.id, r])),
  technologies: Object.fromEntries(techRows.map((t) => [t.id, t])),
  deploymentTargets: Object.fromEntries(targetRows.map((d) => [d.id, d])),
  cloudProviderPatterns: [],
  scopeArchetypes: {},
};
// Mirror loadCatalogs: DB provider stamps register as families (N8.5″(d)).
registerProviderFamilies(roleRows.map((r) => r.provider as string | null));

const now = new Date().toISOString();
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Representative technology per role: the row closest to the GTM bar (fewest gaps).
function representativeTech(roleId: string): Record<string, unknown> | null {
  const candidates = techRows.filter((t) => Array.isArray(t.role_affinities) && (t.role_affinities as string[]).includes(roleId));
  if (candidates.length === 0) return null;
  return candidates
    .map((t) => ({ t, gaps: assessTechnologyGtmReadiness(t as never, { now }).missing.length }))
    .sort((a, b) => a.gaps - b.gaps || String(a.t.id).localeCompare(String(b.t.id)))[0].t;
}

// Canonical scratch: node under test → one REST dependency, one mapped requirement.
// deno-lint-ignore no-explicit-any
function scratchGraph(roleId: string, techId: string | null): any {
  return {
    nodes: {
      [A]: { id: A, type: roleId, label: "Node Under Test", technology: techId ?? undefined, metadata: {}, ports: [] },
      [B]: { id: B, type: "backend-service", label: "Neighbor Service", metadata: {}, ports: [] },
    },
    edges: { e1: { id: "e1", source: A, target: B, contractId: "c1" } },
    contracts: { c1: { id: "c1", kind: "rest", name: "Node Under Test → Neighbor Service", interactionKind: "request_response", schema: {} } },
    artifacts: {},
  };
}

const REQS = [{
  requirementId: "REQ-001", name: "Primary capability", description: "The node performs its primary function.",
  category: "functional",
  acceptanceCriteria: [{ text: "primary path succeeds", met: false }, { text: "failures surface to the caller", met: false }],
}];

interface Row {
  roleId: string;
  tech: string;
  deliverable: string;
  score: "pass" | "weak" | "fail" | "excluded";
  reasons: string[];
  placeholders: number;
}

const rows: Row[] = [];
const PROVISIONING = new Set(["declarative", "definition-as-code", "config", "external-config", "connection-only"]);

for (const role of roleRows.filter((r) => r.deprecated !== true).sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  const roleId = String(role.id);
  const tech = representativeTech(roleId);
  const techId = tech ? String(tech.id) : null;
  const graph = scratchGraph(roleId, techId);
  const node = graph.nodes[A];
  const techAi = (tech?.ai_context ?? undefined) as Record<string, unknown> | undefined;
  const deliverable = classifyNodeDeliverable(role as never, techAi, node, null);
  const reasons: string[] = [];
  let score: Row["score"] = "pass";

  // ── rubric line 1: classification cross-rules ─────────────────────────────────────
  if (role.is_container === true && role.container_style === "logical-boundary") {
    if (deliverable !== "none") { score = "fail"; reasons.push(`logical Structure classified '${deliverable}' — must be excluded`); }
  } else if (role.is_container === true) {
    if (!PROVISIONING.has(deliverable)) { score = "fail"; reasons.push(`hosting container classified '${deliverable}' — containers provision`); }
  } else if (role.nature === "call") {
    if (deliverable === "code") { score = "fail"; reasons.push("external/call node classified 'code' — nothing to author"); }
  } else if (role.nature === "integrate" && deliverable === "code" && techAi?.configMode !== "code") {
    score = "fail"; reasons.push("managed capability classified 'code' without configMode:code");
  }

  if (deliverable === "none") {
    rows.push({ roleId, tech: techId ?? "—", deliverable, score: score === "fail" ? "fail" : "excluded", reasons, placeholders: 0 });
    continue;
  }

  // ── render + section rubric ───────────────────────────────────────────────────────
  let doc: string;
  try {
    doc = generateTaskDocument({ node, graph, catalogs, requirements: REQS as never, projectVision: "A bench project.", requirementNodeMap: { "REQ-001": [A] } });
  } catch (e) {
    rows.push({ roleId, tech: techId ?? "—", deliverable, score: "fail", reasons: [`generator threw: ${String(e).slice(0, 120)}`], placeholders: 0 });
    continue;
  }

  if (!doc.includes("## Your Deliverable")) { score = "fail"; reasons.push("no Your Deliverable section"); }
  if (!doc.includes("## Implementation Tasks")) { score = "fail"; reasons.push("no Implementation Tasks section"); }
  else if (!/- \[ \] \*\*T\d+/.test(doc) && !/- \[ \] \*\*/.test(doc)) { score = "fail"; reasons.push("Implementation Tasks carries no ordered work-order boxes"); }
  if (!doc.includes(IMPLEMENTATION_CONTEXT_HEADING)) { score = "fail"; reasons.push("no Implementation Context scaffold (N5.17)"); }
  const needsManual = deliverable === "external-config" || deliverable === "connection-only";
  if (needsManual && !doc.includes("## Manual Steps")) { score = "fail"; reasons.push(`deliverable '${deliverable}' demands Manual Steps — absent`); }

  for (const tok of ["TODO", "FIXME", "TBD"]) {
    if (new RegExp(`(^|\\s)${tok}(\\s|$|:)`, "m").test(doc)) { score = "fail"; reasons.push(`unstandardized gap token '${tok}' — every gap must be [PLACEHOLDER: …]`); }
  }

  const placeholders = (doc.match(/\[PLACEHOLDER:/g) ?? []).length;
  if (score !== "fail") {
    if (techId && (!techAi || Object.keys(techAi).length === 0)) { score = "weak"; reasons.push("technology bound but ai_context EMPTY — no Technology Guidance renders"); }
    else if (techId && !doc.includes("## Technology Guidance")) { score = "weak"; reasons.push("technology bound but no Technology Guidance section rendered"); }
    if (!techId) { score = "weak"; reasons.push("starved role — no technology to represent it (KEEP-ruled families excepted)"); }
    if (placeholders >= 6) { score = "weak"; reasons.push(`${placeholders} placeholders — thin catalog data leaves most gaps to the user`); }
  }

  // Readiness assessor must agree the doc plane works end to end (no throw = pass).
  try {
    assessNodeReadiness({ node, graph, catalogs, requirements: REQS as never, requirementNodeMap: { "REQ-001": [A] } });
  } catch (e) {
    score = "fail"; reasons.push(`assessNodeReadiness threw: ${String(e).slice(0, 120)}`);
  }

  rows.push({ roleId, tech: techId ?? "—", deliverable, score, reasons, placeholders });
}

const counts = { pass: 0, weak: 0, fail: 0, excluded: 0 };
for (const r of rows) counts[r.score]++;

const lines: string[] = [];
lines.push("# N10(a) — Packet Quality Matrix");
lines.push("");
lines.push(`> Generated by \`scripts/n10-packet-sweep.ts\` against ${SUPABASE_URL} on ${now}.`);
lines.push("> Re-run after every catalog or generator change — do not hand-edit.");
lines.push("> **Every `fail` is a bug; every `weak` is an enrichment item.**");
lines.push("");
lines.push(`## Summary — ${counts.pass} pass · ${counts.weak} weak · ${counts.fail} fail · ${counts.excluded} excluded (taskless by design)`);
lines.push("");
for (const bucket of ["fail", "weak", "pass", "excluded"] as const) {
  const subset = rows.filter((r) => r.score === bucket);
  if (subset.length === 0) continue;
  lines.push(`## ${bucket.toUpperCase()} (${subset.length})`);
  lines.push("");
  lines.push("| role | representative tech | deliverable | placeholders | reasons |");
  lines.push("|---|---|---|---|---|");
  for (const r of subset) {
    lines.push(`| ${r.roleId} | ${r.tech} | ${r.deliverable} | ${r.placeholders} | ${r.reasons.join("; ") || "—"} |`);
  }
  lines.push("");
}

await Deno.writeTextFile(new URL("../docs/N10_PACKET_QUALITY.md", import.meta.url), lines.join("\n"));
console.log(`Packet sweep: ${counts.pass} pass, ${counts.weak} weak, ${counts.fail} fail, ${counts.excluded} excluded → docs/N10_PACKET_QUALITY.md`);
if (counts.fail > 0) {
  console.log("FAIL rows (each is a bug):");
  for (const r of rows.filter((x) => x.score === "fail")) console.log(`  ${r.roleId}: ${r.reasons.join("; ")}`);
  Deno.exit(2);
}
