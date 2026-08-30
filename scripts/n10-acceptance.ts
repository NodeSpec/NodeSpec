// N10(e) — the ACCEPTANCE RUNS. Three fixed scenario projects (greenfield SaaS,
// brownfield service modernization, variety: game + ML) rendered end-to-end against
// the LIVE catalog. Two outputs from one run:
//   1. Mechanized structural scoring (the sweep rubric, applied per node) — exit 2 on
//      any structural fail, because a fail here is a bug.
//   2. docs/N10_ACCEPTANCE_PACKETS.md — every packet in full, for COLD judging: hand
//      the file (or one scenario) to a fresh AI or reviewer with zero project context
//      and ask the five judge questions in its header. The cold judge's verdict is the
//      acceptance gate; this script only proves the packets are structurally whole.
//
//   npm run n10:acceptance
//   (reads scripts/bench/.env.bench like the bench harness; env vars win)

import {
  classifyNodeDeliverable,
  generateTaskDocument,
  IMPLEMENTATION_CONTEXT_HEADING,
} from "../supabase/functions/_shared/task-document-generator.ts";
import { registerProviderFamilies } from "../supabase/functions/_shared/provider-inference.ts";
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
registerProviderFamilies(roleRows.map((r) => r.provider as string | null));

// ── fixed scenarios ──────────────────────────────────────────────────────────────────
// Node ids are stable so re-runs diff cleanly. Roles/technologies are validated against
// the live catalog before rendering — an unknown id is a FAIL row, not a silent skip.

interface ScenarioNode {
  id: string;
  type: string;
  label: string;
  technology?: string;
  parentId?: string;
  placementKind?: string;
  metadata?: Record<string, unknown>;
}
interface ScenarioEdge { id: string; source: string; target: string; contractId: string; kind?: string; interaction?: string }
interface Scenario {
  name: string;
  vision: string;
  nodes: ScenarioNode[];
  edges: ScenarioEdge[];
  requirements: Array<{ requirementId: string; name: string; description: string; category: string; status: string; acceptanceCriteria: Array<{ text: string; met: boolean }>; nodeIds: string[] }>;
}

const uid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

const SCENARIOS: Scenario[] = [
  {
    name: "Greenfield SaaS — TeamBoard (project tracking)",
    vision: "TeamBoard is a project-tracking SaaS for small agencies: boards, tasks, comments, and paid workspaces. Solo founder, ships fast, Stripe-billed subscriptions.",
    nodes: [
      { id: uid(11), type: "frontend-app", label: "Web App", technology: "react" },
      { id: uid(12), type: "backend-service", label: "API Service", technology: "nodejs" },
      { id: uid(13), type: "database", label: "Primary Database", technology: "postgresql" },
      { id: uid(14), type: "cache", label: "Session Cache", technology: "redis" },
      { id: uid(15), type: "external-service", label: "Billing", technology: "stripe" },
      { id: uid(16), type: "auth-provider", label: "Auth", technology: "supabase-auth" },
    ],
    edges: [
      { id: "e1", source: uid(11), target: uid(12), contractId: "c1" },
      { id: "e2", source: uid(12), target: uid(13), contractId: "c2", kind: "sql", interaction: "data_write" },
      { id: "e3", source: uid(12), target: uid(14), contractId: "c3", kind: "nosql", interaction: "data_read" },
      { id: "e4", source: uid(12), target: uid(15), contractId: "c4" },
      { id: "e5", source: uid(11), target: uid(16), contractId: "c5" },
    ],
    requirements: [
      { requirementId: "REQ-001", name: "Board CRUD", description: "Users create boards and move tasks between columns.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "board create/rename/delete round-trips", met: false }, { text: "task drag persists column + order", met: false }], nodeIds: [uid(11), uid(12), uid(13)] },
      { requirementId: "REQ-002", name: "Paid workspaces", description: "Workspace upgrade via Stripe subscription; entitlements flip on verified webhooks.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "checkout completes and webhook flips the plan", met: false }, { text: "failed payment downgrades after grace period", met: false }], nodeIds: [uid(12), uid(15)] },
      { requirementId: "REQ-003", name: "Session performance", description: "Hot session lookups served from cache.", category: "non-functional", status: "draft", acceptanceCriteria: [{ text: "p95 session lookup under 20ms", met: false }], nodeIds: [uid(14)] },
    ],
  },
  {
    name: "Brownfield modernization — OrderFlow (order pipeline)",
    vision: "OrderFlow is a ten-year-old order pipeline being modernized in place: the JVM monolith splits into services on Kubernetes, orders flow through Kafka, and ops finally gets real observability.",
    nodes: [
      { id: uid(21), type: "k8s-cluster", label: "Cluster", technology: "kubernetes" },
      { id: uid(22), type: "backend-service", label: "Order Service", technology: "java-backend", parentId: uid(21), placementKind: "hosts" },
      { id: uid(23), type: "worker", label: "Fulfillment Worker", technology: "kotlin-backend", parentId: uid(21), placementKind: "hosts" },
      { id: uid(24), type: "event-stream", label: "Order Events", technology: "kafka" },
      { id: uid(25), type: "database", label: "Orders DB", technology: "postgresql" },
      { id: uid(26), type: "api-gateway", label: "Edge Gateway", technology: "kong" },
      { id: uid(27), type: "monitoring", label: "Metrics", technology: "prometheus" },
    ],
    edges: [
      { id: "e1", source: uid(26), target: uid(22), contractId: "c1" },
      { id: "e2", source: uid(22), target: uid(24), contractId: "c2", kind: "kafka", interaction: "event" },
      { id: "e3", source: uid(24), target: uid(23), contractId: "c3", kind: "kafka", interaction: "queue" },
      { id: "e4", source: uid(22), target: uid(25), contractId: "c4", kind: "sql", interaction: "data_write" },
      { id: "e5", source: uid(23), target: uid(25), contractId: "c5", kind: "sql", interaction: "data_write" },
    ],
    requirements: [
      { requirementId: "REQ-001", name: "Order intake", description: "Orders enter via the gateway and persist before any downstream work.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "accepted order is durable before ack", met: false }, { text: "duplicate submission is idempotent", met: false }], nodeIds: [uid(26), uid(22), uid(25)] },
      { requirementId: "REQ-002", name: "Async fulfillment", description: "Fulfillment consumes order events with bounded retries and a dead-letter lane.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "poison event lands in DLQ after N attempts", met: false }, { text: "replay from DLQ is idempotent", met: false }], nodeIds: [uid(24), uid(23)] },
      { requirementId: "REQ-003", name: "Golden signals", description: "Latency, traffic, errors, saturation visible per service.", category: "non-functional", status: "draft", acceptanceCriteria: [{ text: "each service exports the four golden signals", met: false }], nodeIds: [uid(27)] },
    ],
  },
  {
    name: "Variety — PixelForge (multiplayer game + ML)",
    vision: "PixelForge is a session-based multiplayer game with an ML-assisted level generator: a Godot client, an authoritative game server, and an inference lane that proposes levels rated by a vector search over past matches.",
    nodes: [
      { id: uid(31), type: "game-client", label: "Game Client", technology: "godot" },
      { id: uid(32), type: "game-server", label: "Match Server", technology: "colyseus" },
      { id: uid(33), type: "inference-service", label: "Level Generator", technology: "ollama" },
      { id: uid(34), type: "vector-database", label: "Match Memory", technology: "qdrant" },
      { id: uid(35), type: "database", label: "Player DB", technology: "postgresql" },
      { id: uid(36), type: "external-service", label: "LLM Narrative", technology: "anthropic" },
    ],
    edges: [
      { id: "e1", source: uid(31), target: uid(32), contractId: "c1", kind: "websocket", interaction: "event" },
      { id: "e2", source: uid(32), target: uid(35), contractId: "c2", kind: "sql", interaction: "data_write" },
      { id: "e3", source: uid(32), target: uid(33), contractId: "c3" },
      { id: "e4", source: uid(33), target: uid(34), contractId: "c4" },
      { id: "e5", source: uid(33), target: uid(36), contractId: "c5" },
    ],
    requirements: [
      { requirementId: "REQ-001", name: "Authoritative matches", description: "The server owns simulation; clients send intent only.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "client-reported position is never trusted", met: false }, { text: "reconnect rejoins the running match", met: false }], nodeIds: [uid(31), uid(32)] },
      { requirementId: "REQ-002", name: "Level proposals", description: "The generator proposes levels seeded by similar past matches.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "proposal cites its nearest-match seeds", met: false }, { text: "generation stays under 2s p95", met: false }], nodeIds: [uid(33), uid(34)] },
      { requirementId: "REQ-003", name: "Narrative flavor", description: "Match summaries get LLM-written flavor text.", category: "functional", status: "draft", acceptanceCriteria: [{ text: "summary renders without blocking match end", met: false }], nodeIds: [uid(36)] },
    ],
  },
];

// ── render + mechanized rubric ───────────────────────────────────────────────────────
const now = new Date().toISOString();
interface Verdict { scenario: string; node: string; tech: string; deliverable: string; score: "pass" | "weak" | "fail" | "excluded"; reasons: string[] }
const verdicts: Verdict[] = [];
const packetSections: string[] = [];

for (const sc of SCENARIOS) {
  // deno-lint-ignore no-explicit-any
  const graph: any = { nodes: {}, edges: {}, contracts: {}, artifacts: {} };
  for (const n of sc.nodes) graph.nodes[n.id] = { ...n, metadata: n.metadata ?? {}, ports: [] };
  for (const e of sc.edges) {
    graph.edges[e.id] = e;
    const src = graph.nodes[e.source], tgt = graph.nodes[e.target];
    graph.contracts[e.contractId] = { id: e.contractId, kind: e.kind ?? "rest", name: `${src.label} → ${tgt.label}`, interactionKind: e.interaction ?? "request_response", schema: {} };
  }
  const requirementNodeMap: Record<string, string[]> = {};
  for (const r of sc.requirements) requirementNodeMap[r.requirementId] = r.nodeIds;

  packetSections.push(`\n---\n\n# Scenario: ${sc.name}\n\n> ${sc.vision}\n`);

  for (const n of sc.nodes) {
    const role = catalogs.nodeRoles[n.type];
    const tech = n.technology ? catalogs.technologies[n.technology] : null;
    if (!role) { verdicts.push({ scenario: sc.name, node: n.label, tech: n.technology ?? "—", deliverable: "?", score: "fail", reasons: [`unknown role id '${n.type}'`] }); continue; }
    if (n.technology && !tech) { verdicts.push({ scenario: sc.name, node: n.label, tech: n.technology, deliverable: "?", score: "fail", reasons: [`unknown technology id '${n.technology}'`] }); continue; }

    const parentRole = n.parentId ? catalogs.nodeRoles[graph.nodes[n.parentId]?.type] ?? null : null;
    const deliverable = classifyNodeDeliverable(role as never, (tech?.ai_context ?? undefined) as never, graph.nodes[n.id], parentRole as never);
    if (deliverable === "none") {
      verdicts.push({ scenario: sc.name, node: n.label, tech: n.technology ?? "—", deliverable, score: "excluded", reasons: [] });
      continue;
    }

    const reqs = sc.requirements.filter((r) => r.nodeIds.includes(n.id));
    let doc: string;
    try {
      doc = generateTaskDocument({ node: graph.nodes[n.id], graph, catalogs, requirements: reqs as never, projectVision: sc.vision, requirementNodeMap });
    } catch (e) {
      verdicts.push({ scenario: sc.name, node: n.label, tech: n.technology ?? "—", deliverable, score: "fail", reasons: [`generator threw: ${String(e).slice(0, 120)}`] });
      continue;
    }

    const reasons: string[] = [];
    let score: Verdict["score"] = "pass";
    if (!doc.includes("## Your Deliverable")) { score = "fail"; reasons.push("no Your Deliverable"); }
    if (!doc.includes("## Implementation Tasks")) { score = "fail"; reasons.push("no Implementation Tasks"); }
    if (!doc.includes(IMPLEMENTATION_CONTEXT_HEADING)) { score = "fail"; reasons.push("no Implementation Context scaffold"); }
    for (const tok of ["TODO", "FIXME", "TBD"]) {
      if (new RegExp(`(^|\\s)${tok}(\\s|$|:)`, "m").test(doc)) { score = "fail"; reasons.push(`gap token '${tok}'`); }
    }
    if (score !== "fail" && n.technology && !doc.includes("## Technology Guidance")) { score = "weak"; reasons.push("no Technology Guidance despite bound technology"); }

    verdicts.push({ scenario: sc.name, node: n.label, tech: n.technology ?? "—", deliverable, score, reasons });
    packetSections.push(`\n## Packet: ${n.label} (${n.type} / ${n.technology ?? "no tech"}) — ${deliverable}\n\n\`\`\`\`markdown\n${doc}\n\`\`\`\`\n`);
  }
}

// ── outputs ──────────────────────────────────────────────────────────────────────────
const counts = { pass: 0, weak: 0, fail: 0, excluded: 0 };
for (const v of verdicts) counts[v.score]++;

const lines: string[] = [];
lines.push("# N10(e) — Acceptance Packets (cold-judge artifact)");
lines.push("");
lines.push(`> Generated by \`scripts/n10-acceptance.ts\` against ${SUPABASE_URL} on ${now}.`);
lines.push("> Do not hand-edit — re-run after catalog or generator changes.");
lines.push("");
lines.push("## How to judge (COLD — no project context beyond this file)");
lines.push("");
lines.push("Give one scenario's packets to a fresh AI or reviewer and ask, per packet:");
lines.push("1. Could you start building from this packet alone — is the deliverable unambiguous?");
lines.push("2. Do the acceptance criteria map to the work the packet actually orders?");
lines.push("3. Is the technology guidance specific to THIS technology (not boilerplate), and does the security doctrine constrain the obvious mistakes?");
lines.push("4. Does anything contradict — deliverable vs role, guidance vs configMode, criteria vs tasks?");
lines.push("5. Is every knowledge gap an explicit [PLACEHOLDER: …] rather than an invented specific?");
lines.push("");
lines.push("A scenario ACCEPTS when every packet gets yes/yes/yes/no-contradictions/yes.");
lines.push("");
lines.push(`## Mechanized structural scores — ${counts.pass} pass · ${counts.weak} weak · ${counts.fail} fail · ${counts.excluded} excluded`);
lines.push("");
lines.push("| scenario | node | tech | deliverable | score | reasons |");
lines.push("|---|---|---|---|---|---|");
for (const v of verdicts) {
  lines.push(`| ${v.scenario.split(" — ")[0]} | ${v.node} | ${v.tech} | ${v.deliverable} | ${v.score} | ${v.reasons.join("; ") || "—"} |`);
}
lines.push(...packetSections);

await Deno.writeTextFile(new URL("../docs/N10_ACCEPTANCE_PACKETS.md", import.meta.url), lines.join("\n"));
console.log(`Acceptance render: ${counts.pass} pass, ${counts.weak} weak, ${counts.fail} fail, ${counts.excluded} excluded → docs/N10_ACCEPTANCE_PACKETS.md`);
if (counts.fail > 0) {
  console.log("FAIL rows (each is a bug):");
  for (const v of verdicts.filter((x) => x.score === "fail")) console.log(`  [${v.scenario}] ${v.node}: ${v.reasons.join("; ")}`);
  Deno.exit(2);
}
