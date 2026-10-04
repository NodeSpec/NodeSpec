// AA.6 (owner 2026-09-23): a node's context is its own slice, measured.
//
// get_project_context(view: 'slice') answers for one node with what working
// on that node needs and nothing else:
//
//   node          what it is, where it sits, the configuration to honour.
//   edges         every edge separately (a second edge to the same neighbour
//                 is its own entry), with the full contract, schema included.
//                 Each neighbour stands on a side, by the packet's own
//                 dependency rule (dependencySide): upstream (this node
//                 depends on it), consumer (it depends on this node), peer.
//   beyond        one hop past the upstream neighbours: name and schema hash.
//   consumers     each consumer's criteria that name this node or the
//                 contract between them: what it expects of this node.
//   requirements  only the node's mapped requirements, with criteria state.
//   tasks         the task document's work orders with their state and the
//                 commit that ticked them.
//   tests         the tests on those requirements, last result and commit.
//   leases        on the node and its neighbours.
//   constraints   the ones that apply here.
//   vision        the sentences its outcomes cite (served-vision.ts).
//   memory        (AA.7) the node's own memory, newest first: decisions,
//                 a person's changes, hand-offs, the authored learning and
//                 criteria proven at a commit, each with who, which
//                 proposal and which commit, flagged for review when the
//                 node's fingerprint flipped after it (node-memory.ts).
//
// Every answer reports its size and what it left out, with where to read it.
// A `budget` (approximate tokens) trims in a fixed order, lowest value first,
// and names each cut. Every section carries a hash; the answer's fingerprint
// joins them, and a read with `since` set to an earlier fingerprint returns
// only the sections that changed.
//
// Pure past the loader at the bottom: the tool reads, this file decides.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fnv1a32 } from "./criterion-identity.ts";
import { dependencySide, simpleHash } from "./task-document-generator.ts";
import { collectInheritedScopes, type InheritedScope } from "./inherited-context.ts";
import { resolveConfigChoice } from "./config-choice.ts";
import { parseTaskDocTasks } from "./task-deltas.ts";
import { taskDone, testDone } from "./done-state.ts";
import type { ServedVision } from "./served-vision.ts";
import type { NodeConstraint } from "./node-constraints.ts";
import { constraintRef, loadNodeConstraints } from "./node-constraints.ts";
import { loadServedVision } from "./served-vision.ts";
import { liveNodeIdSet } from "./mapping-liveness.ts";
import { nodeMemory, rawNodeMemory, type RawNodeMemory } from "./node-memory.ts";
import type { CatalogData } from "./catalog-loader.ts";
import { holdingLine } from "./role-registry.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export const SLICE_VERSION = "slice1";
/** Silent minutes after which a lease reads stale (the claim RPC's default). */
const LEASE_STALE_MS = 30 * 60 * 1000;

export interface SliceGraph {
  nodes: Record<string, AnyRecord>;
  edges: Record<string, AnyRecord>;
  contracts: Record<string, AnyRecord>;
  artifacts?: Record<string, AnyRecord>;
}

export interface SliceRequirementRow {
  id: string;
  requirement_id: string;
  name: string;
  status: string;
  mark?: string | null;
  acceptance_criteria: Array<AnyRecord> | null;
}

export interface SliceInputs {
  graph: SliceGraph;
  nodeId: string;
  /** Every live requirement of the specification (a consumer's are read too). */
  requirements: SliceRequirementRow[];
  /** Live mappings: requirement ROW uuid → node id. */
  mappings: Array<{ requirement_id: string; node_id: string }>;
  taskItems: Array<AnyRecord>;
  tests: Array<AnyRecord>;
  leases: Array<AnyRecord>;
  /** AC: null when the project carries no constraints (below Indie): no section, no note. */
  constraints: NodeConstraint[] | null;
  vision: ServedVision | null;
  /** AA.7: what node_memory returned for this node (null when unread). */
  memory?: RawNodeMemory | null;
  /** AG.12a: the catalog, for how the node and its parent hold (absent: no holding lines). */
  catalogs?: CatalogData | null;
  now: number;
}

export type SliceSection =
  | "node" | "edges" | "beyond" | "consumers" | "requirements" | "tasks" | "tests" | "leases" | "constraints" | "vision" | "memory";

export const SLICE_SECTIONS: readonly SliceSection[] = [
  "node", "edges", "beyond", "consumers", "requirements", "tasks", "tests", "leases", "constraints", "vision", "memory",
];
/** AA.7: the memory entries a budget keeps when it has to cut memory. */
const MEMORY_KEPT_UNDER_BUDGET = 10;

export interface LeftOut { what: string; count?: number; readWith: string; why: "by design" | "budget" }

export interface NodeSlice {
  sections: Partial<Record<SliceSection, unknown>>;
  notes: string[];
}

const nodeRef = (n: AnyRecord | undefined, id: string) => ({ id, label: String(n?.label ?? id) });

function schemaOf(contract: AnyRecord | undefined, graph: SliceGraph): string | null {
  if (!contract) return null;
  if (contract.schema && typeof contract.schema === "object" && Object.keys(contract.schema).length > 0) {
    return JSON.stringify(contract.schema, null, 2);
  }
  if (contract.schemaRef) {
    const a = graph.artifacts?.[contract.schemaRef];
    if (a?.content) return typeof a.content === "string" ? a.content : JSON.stringify(a.content, null, 2);
  }
  return null;
}

interface EdgeView {
  edge: AnyRecord;
  contract: AnyRecord | undefined;
  direction: "incoming" | "outgoing";
  neighbourId: string;
  side: "upstream" | "consumer" | "peer";
}

function edgesOf(graph: SliceGraph, nodeId: string): EdgeView[] {
  const out: EdgeView[] = [];
  for (const edge of Object.values(graph.edges ?? {})) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    const direction = edge.source === nodeId ? "outgoing" : "incoming";
    const contract = graph.contracts?.[edge.contractId];
    out.push({
      edge,
      contract,
      direction,
      neighbourId: direction === "outgoing" ? String(edge.target) : String(edge.source),
      side: dependencySide({ direction, contractKind: contract?.kind ?? null, interactionKind: contract?.interactionKind ?? null }),
    });
  }
  return out.sort((a, b) => String(a.edge.id).localeCompare(String(b.edge.id)));
}

/** The whole slice, before any budget. */
export function buildNodeSlice(input: SliceInputs): NodeSlice {
  const { graph, nodeId } = input;
  const node = graph.nodes[nodeId];
  const notes: string[] = [];
  const sections: NodeSlice["sections"] = {};

  const meta = (node?.metadata ?? {}) as AnyRecord;
  const choice = resolveConfigChoice(meta);
  const config = meta.config && typeof meta.config === "object" && Object.keys(meta.config).length > 0 ? meta.config : null;
  const inherited: InheritedScope[] = collectInheritedScopes(graph as never, nodeId);
  const parent = node?.parentId ? graph.nodes[node.parentId] : undefined;
  const holds = (roleId: unknown) =>
    (input.catalogs && typeof roleId === "string" && input.catalogs.nodeRoles[roleId] ? holdingLine(input.catalogs, roleId) : null);
  sections.node = {
    id: nodeId,
    label: String(node?.label ?? nodeId),
    role: String(node?.type ?? "unknown"),
    technology: node?.technology ?? null,
    // AG.12a: what the node may hold, and how its parent holds it and what else it may hold.
    ...(holds(node?.type) ? { holds: holds(node?.type) } : {}),
    parent: node?.parentId
      ? {
        ...nodeRef(parent, String(node.parentId)),
        role: String(parent?.type ?? "unknown"),
        placementKind: node.placementKind ?? null,
        ...(holds(parent?.type) ? { holds: holds(parent?.type) } : {}),
      }
      : null,
    children: Object.values(graph.nodes).filter((n) => n.parentId === nodeId).map((n) => nodeRef(n, String(n.id))),
    configuration: choice === "delegated" ? null : config,
    configurationSource: choice === "delegated" ? "delegated-to-ai" : config ? "user-specified" : null,
    ...(inherited.length > 0 ? { inherited: inherited.map((s) => ({ container: s.containerLabel, values: s.values })) } : {}),
  };

  // ── edges, every one ──
  const edges = edgesOf(graph, nodeId);
  sections.edges = edges.map((e) => {
    const n = graph.nodes[e.neighbourId];
    const schema = schemaOf(e.contract, graph);
    return {
      id: String(e.edge.id),
      side: e.side,
      direction: e.direction === "outgoing" ? "out" : "in",
      neighbour: { id: e.neighbourId, label: String(n?.label ?? e.neighbourId), role: String(n?.type ?? "unknown"), technology: n?.technology ?? null },
      criticality: e.edge.criticality ?? null,
      contract: e.contract
        ? {
          id: String(e.contract.id),
          name: String(e.contract.name ?? ""),
          kind: String(e.contract.kind ?? ""),
          interactionKind: e.contract.interactionKind ?? null,
          transport: e.contract.transport ?? null,
          specFormat: e.contract.specFormat ?? null,
          schemaHash: schema ? simpleHash(schema) : null,
          schema,
        }
        : null,
    };
  });
  const schemaless = edges.filter((e) => e.contract && !schemaOf(e.contract, graph)).length;
  if (schemaless > 0) notes.push(`${schemaless} of ${edges.length} edge contract${edges.length === 1 ? "" : "s"} carr${schemaless === 1 ? "ies" : "y"} no schema.`);

  // ── beyond: one hop past the upstream neighbours ──
  const beyond: AnyRecord[] = [];
  const seenBeyond = new Set<string>();
  for (const up of edges.filter((e) => e.side === "upstream")) {
    for (const next of edgesOf(graph, up.neighbourId)) {
      if (next.side !== "upstream" || next.neighbourId === nodeId) continue;
      const key = `${up.neighbourId}:${next.edge.id}`;
      if (seenBeyond.has(key)) continue;
      seenBeyond.add(key);
      const schema = schemaOf(next.contract, graph);
      beyond.push({
        via: nodeRef(graph.nodes[up.neighbourId], up.neighbourId),
        node: nodeRef(graph.nodes[next.neighbourId], next.neighbourId),
        contract: next.contract ? { id: String(next.contract.id), name: String(next.contract.name ?? ""), schemaHash: schema ? simpleHash(schema) : null } : null,
      });
    }
  }
  sections.beyond = beyond;

  // ── requirements: the node's own ──
  const rowsByNode = new Map<string, Set<string>>();
  for (const m of input.mappings) {
    const set = rowsByNode.get(m.node_id) ?? new Set<string>();
    set.add(m.requirement_id);
    rowsByNode.set(m.node_id, set);
  }
  const ownRows = rowsByNode.get(nodeId) ?? new Set<string>();
  const reqByRow = new Map(input.requirements.map((r) => [r.id, r]));
  const own = [...ownRows].map((id) => reqByRow.get(id)).filter((r): r is SliceRequirementRow => !!r)
    .sort((a, b) => a.requirement_id.localeCompare(b.requirement_id, undefined, { numeric: true }));
  sections.requirements = own.map((r) => {
    const criteria = r.acceptance_criteria ?? [];
    return {
      requirementId: r.requirement_id,
      name: r.name,
      status: r.status,
      ...(r.mark ? { mark: r.mark } : {}),
      proven: criteria.filter((c) => c.met === true).length,
      total: criteria.length,
      criteria: criteria.map((c) => ({
        text: String(c.text ?? ""),
        met: c.met === true,
        ...(c.verification ? { verification: c.verification } : {}),
        ...(c.evidenceStale ? { evidenceStale: true } : {}),
      })),
    };
  });
  if (own.length === 0) notes.push("No requirement is mapped to this node: its work traces to nothing yet (map_requirement).");

  // ── consumers: what their criteria expect of this node ──
  const consumers: AnyRecord[] = [];
  const byConsumer = new Map<string, EdgeView[]>();
  for (const e of edges.filter((x) => x.side === "consumer")) {
    byConsumer.set(e.neighbourId, [...(byConsumer.get(e.neighbourId) ?? []), e]);
  }
  const label = String(node?.label ?? "").toLowerCase();
  for (const [consumerId, via] of byConsumer) {
    const phrases = [label, ...via.map((e) => String(e.contract?.name ?? "").toLowerCase())].filter((p) => p.length > 2);
    const theirs = [...(rowsByNode.get(consumerId) ?? [])].filter((id) => !ownRows.has(id)).map((id) => reqByRow.get(id)).filter((r): r is SliceRequirementRow => !!r);
    let total = 0;
    const expects: AnyRecord[] = [];
    for (const r of theirs) {
      for (const c of r.acceptance_criteria ?? []) {
        total++;
        const text = String(c.text ?? "");
        if (phrases.some((p) => text.toLowerCase().includes(p))) {
          expects.push({ requirementId: r.requirement_id, text, met: c.met === true, ...(r.mark ? { mark: r.mark } : {}) });
        }
      }
    }
    consumers.push({ node: nodeRef(graph.nodes[consumerId], consumerId), edges: via.map((e) => String(e.edge.id)), expects, criteria: total });
  }
  sections.consumers = consumers;

  // ── tasks: the work orders, their state and commit ──
  const doc = Object.values(graph.artifacts ?? {}).find((a) => a?.nodeId === nodeId && a?.kind === "task" && a?.content);
  const itemByKey = new Map(input.taskItems.filter((t) => t.node_id === nodeId).map((t) => [String(t.task_key), t]));
  const heldTaskIds = new Set(input.leases.filter((l) => l.task_item_id).map((l) => String(l.task_item_id)));
  if (!doc) {
    sections.tasks = [];
    notes.push("This node has no task document yet: generate_task_docs writes one.");
  } else {
    const parsed = parseTaskDocTasks(String(doc.content)).tasks;
    sections.tasks = parsed.map((t) => {
      const row = t.key ? itemByKey.get(t.key) : undefined;
      const done = row ? row.done === true : t.checked;
      const verdict = taskDone({ done, orphaned: false, held: !!row && heldTaskIds.has(String(row.id)) });
      const commit = row?.provenance?.commitSha ?? null;
      return {
        id: t.displayId,
        title: t.title,
        state: verdict.word,
        ...(commit ? { commit: String(commit) } : {}),
        ...(row?.mark ? { mark: row.mark } : {}),
      };
    });
  }

  // ── tests: last result and the commit it was proven at ──
  const commitByCase = new Map<string, string>();
  for (const r of own) {
    for (const c of r.acceptance_criteria ?? []) {
      const p = c.provenance as AnyRecord | undefined;
      if (p?.testCaseId && p.commitSha) commitByCase.set(String(p.testCaseId), String(p.commitSha));
    }
  }
  const humanByRow = new Map(own.map((r) => [r.id, r.requirement_id]));
  sections.tests = input.tests
    .filter((t) => humanByRow.has(String(t.requirement_id)))
    .sort((a, b) => String(a.test_id).localeCompare(String(b.test_id), undefined, { numeric: true }))
    .map((t) => {
      const verdict = testDone({ status: String(t.status ?? ""), stale: t.stale, retiredAt: t.retired_at ?? null });
      const commit = commitByCase.get(String(t.id));
      return {
        testId: String(t.test_id),
        name: String(t.name ?? ""),
        requirementId: humanByRow.get(String(t.requirement_id)),
        state: verdict.word,
        lastResult: String(t.status ?? ""),
        ...(t.status && t.status !== "not_started" && t.updated_at ? { at: String(t.updated_at) } : {}),
        ...(commit ? { commit } : {}),
        ...(t.mark ? { mark: t.mark } : {}),
      };
    });

  // ── leases on the node and its neighbours ──
  const near = new Set([nodeId, ...edges.map((e) => e.neighbourId)]);
  sections.leases = input.leases
    .filter((l) => l.node_id && near.has(String(l.node_id)))
    .sort((a, b) => String(a.since).localeCompare(String(b.since)))
    .map((l) => {
      const reach = Array.isArray(l.meta?.reach) ? (l.meta.reach as unknown[]).map(String) : null;
      return {
        node: nodeRef(graph.nodes[String(l.node_id)], String(l.node_id)),
        onThisNode: String(l.node_id) === nodeId,
        level: String(l.level),
        holder: String(l.holder_label ?? ""),
        since: String(l.since ?? ""),
        stale: !!l.heartbeat_at && input.now - new Date(String(l.heartbeat_at)).getTime() > LEASE_STALE_MS,
        ...(reach ? { reach } : {}),
      };
    });

  if (input.constraints) {
    sections.constraints = input.constraints.map((c) => ({
      ref: constraintRef(c.id),
      ctype: c.ctype,
      ...(c.title ? { title: c.title } : {}),
      description: c.description,
      ...(c.mark ? { mark: c.mark } : {}),
    }));
    if (input.constraints.length === 0) notes.push("No constraint applies to this node.");
  }

  if (input.vision?.recorded) {
    sections.vision = { sentences: input.vision.sentences.map((s) => ({ id: s.id, text: s.text })) };
    if (input.vision.sentences.length === 0) notes.push("No outcome behind this node's requirements cites the vision.");
  }

  // ── memory: the node's own, newest first (AA.7) ──
  if (input.memory !== undefined) {
    const taskDoc = Object.values(graph.artifacts ?? {}).find((a) => a?.nodeId === nodeId && a?.kind === "task");
    const memory = nodeMemory(input.memory, taskDoc ?? null);
    sections.memory = memory.entries;
    if (memory.flagged > 0) {
      notes.push(`${memory.flagged} memory entr${memory.flagged === 1 ? "y is" : "ies are"} flagged for review: the node's context changed after ${memory.flagged === 1 ? "it" : "them"} (each says why).`);
    }
  }

  return { sections, notes };
}

// ── measure, budget, fingerprint, delta ─────────────────────────────────────

export const approxTokens = (chars: number) => Math.ceil(chars / 4);
export const sizeOf = (value: unknown) => JSON.stringify(value ?? null).length;

/** What the slice never carries, and where it is. */
export function byDesignLeftOut(opts: { hasTaskDoc: boolean; visionRecorded: boolean; files: number }): LeftOut[] {
  const out: LeftOut[] = [];
  if (opts.hasTaskDoc) out.push({ what: "the task document's body (work orders in full, the dependency chain, the build directive)", readWith: "view 'brief'", why: "by design" });
  out.push({ what: "technology guidance from the catalog (best practices, setup steps)", readWith: "view 'brief'", why: "by design" });
  if (opts.files > 0) out.push({ what: "files bound to this node", count: opts.files, readWith: "view 'structured'", why: "by design" });
  if (opts.visionRecorded) out.push({ what: "the vision sentences this node does not serve", readWith: "get_outcome_board", why: "by design" });
  return out;
}

interface Cut {
  what: string;
  readWith: string;
  apply: (s: NodeSlice["sections"]) => number;
}

/** The cuts, lowest value first. Each returns how many items it removed (0 = nothing to cut). */
const CUTS: Cut[] = [
  {
    what: "the contracts one hop past the upstream neighbours",
    readWith: "view 'slice' on the neighbour",
    apply: (s) => { const n = (s.beyond as unknown[] | undefined)?.length ?? 0; if (n) s.beyond = []; return n; },
  },
  {
    what: "what consumers' criteria expect of this node",
    readWith: "view 'slice' on the consumer",
    apply: (s) => {
      const list = (s.consumers as AnyRecord[] | undefined) ?? [];
      const n = list.reduce((k, c) => k + (c.expects?.length ?? 0), 0);
      if (n) s.consumers = list.map((c) => ({ ...c, expects: [] }));
      return n;
    },
  },
  {
    what: "tasks already done",
    readWith: "view 'brief' (the task document)",
    apply: (s) => {
      const list = (s.tasks as AnyRecord[] | undefined) ?? [];
      const kept = list.filter((t) => t.state !== "done");
      if (kept.length !== list.length) s.tasks = kept;
      return list.length - kept.length;
    },
  },
  {
    what: "tests that passed",
    readWith: "get_test_plan",
    apply: (s) => {
      const list = (s.tests as AnyRecord[] | undefined) ?? [];
      const kept = list.filter((t) => t.state !== "done");
      if (kept.length !== list.length) s.tests = kept;
      return list.length - kept.length;
    },
  },
  {
    what: `memory entries past the ${MEMORY_KEPT_UNDER_BUDGET} newest`,
    readWith: "view 'slice' with a larger budget",
    apply: (s) => {
      const list = (s.memory as unknown[] | undefined) ?? [];
      if (list.length <= MEMORY_KEPT_UNDER_BUDGET) return 0;
      s.memory = list.slice(0, MEMORY_KEPT_UNDER_BUDGET);
      return list.length - MEMORY_KEPT_UNDER_BUDGET;
    },
  },
  {
    what: "contract schema bodies (each edge keeps its schemaHash)",
    readWith: "view 'full', or this view with a larger budget",
    apply: (s) => {
      let n = 0;
      s.edges = ((s.edges as AnyRecord[] | undefined) ?? []).map((e) => {
        if (!e.contract?.schema) return e;
        n++;
        return { ...e, contract: { ...e.contract, schema: null } };
      });
      return n;
    },
  },
  {
    what: "open tasks",
    readWith: "view 'brief' (the task document)",
    apply: (s) => { const n = (s.tasks as unknown[] | undefined)?.length ?? 0; if (n) s.tasks = []; return n; },
  },
  {
    what: "open tests",
    readWith: "get_test_plan",
    apply: (s) => { const n = (s.tests as unknown[] | undefined)?.length ?? 0; if (n) s.tests = []; return n; },
  },
  {
    what: "the text of criteria already met (each requirement keeps its proven count)",
    readWith: "list_requirements",
    apply: (s) => {
      let n = 0;
      s.requirements = ((s.requirements as AnyRecord[] | undefined) ?? []).map((r) => {
        const kept = (r.criteria as AnyRecord[]).filter((c) => !c.met);
        n += r.criteria.length - kept.length;
        return { ...r, criteria: kept };
      });
      return n;
    },
  },
];

/**
 * Trim to the budget (approximate tokens over the whole answer, `overhead`
 * chars of which are not the sections). Cuts run in order until it fits; the
 * node, its edges, its leases, its constraints and its vision are never cut.
 */
export function fitToBudget(slice: NodeSlice, budget: number | null, overhead: number): { slice: NodeSlice; cuts: LeftOut[]; fits: boolean } {
  const sections = structuredClone(slice.sections);
  const cuts: LeftOut[] = [];
  const size = () => overhead + sizeOf(sections) + sizeOf(slice.notes);
  if (budget === null || approxTokens(size()) <= budget) return { slice: { sections, notes: slice.notes }, cuts, fits: true };
  for (const cut of CUTS) {
    const removed = cut.apply(sections);
    if (removed > 0) cuts.push({ what: cut.what, count: removed, readWith: cut.readWith, why: "budget" });
    if (approxTokens(size()) <= budget) return { slice: { sections, notes: slice.notes }, cuts, fits: true };
  }
  return { slice: { sections, notes: slice.notes }, cuts, fits: false };
}

/** Each section's hash, over what is sent. */
export function sectionHashes(sections: NodeSlice["sections"]): Partial<Record<SliceSection, string>> {
  const out: Partial<Record<SliceSection, string>> = {};
  for (const name of SLICE_SECTIONS) {
    if (name in sections) out[name] = fnv1a32(JSON.stringify(sections[name]));
  }
  return out;
}

/** `slice1:node=1a2b3c4d,edges=...`: what a later read passes back as `since`. */
export function sliceFingerprint(hashes: Partial<Record<SliceSection, string>>): string {
  return `${SLICE_VERSION}:${SLICE_SECTIONS.filter((s) => hashes[s]).map((s) => `${s}=${hashes[s]}`).join(",")}`;
}

/** The hashes an earlier fingerprint carried; null when it is not one this version wrote. */
export function parseSliceFingerprint(fp: string | null | undefined): Partial<Record<SliceSection, string>> | null {
  const m = /^slice1:(.*)$/.exec(String(fp ?? "").trim());
  if (!m) return null;
  const out: Partial<Record<SliceSection, string>> = {};
  for (const part of m[1].split(",").filter(Boolean)) {
    const [k, v] = part.split("=");
    if (!(SLICE_SECTIONS as readonly string[]).includes(k) || !/^[0-9a-f]{8}$/.test(v ?? "")) return null;
    out[k as SliceSection] = v;
  }
  return out;
}

/** Only the sections whose hash moved since `previous`; the rest are named unchanged. */
export function deltaSince(
  sections: NodeSlice["sections"],
  hashes: Partial<Record<SliceSection, string>>,
  previous: Partial<Record<SliceSection, string>>,
): { sections: NodeSlice["sections"]; unchanged: SliceSection[]; gone: SliceSection[] } {
  const out: NodeSlice["sections"] = {};
  const unchanged: SliceSection[] = [];
  for (const name of SLICE_SECTIONS) {
    if (!(name in sections)) continue;
    if (previous[name] && previous[name] === hashes[name]) unchanged.push(name);
    else out[name] = sections[name];
  }
  const gone = SLICE_SECTIONS.filter((s) => previous[s] && !(s in sections));
  return { sections: out, unchanged, gone };
}

// ── the reads ────────────────────────────────────────────────────────────────

/**
 * Everything buildNodeSlice needs for one node, in eight reads past the
 * graph. Throws on a read the slice cannot do without (the specification,
 * its requirements, the constraints, the served vision); the rest degrade to
 * empty with a note, the way a warning surface never breaks the read it
 * rides on.
 */
export async function loadSliceInputs(
  supabase: SupabaseClient,
  projectId: string,
  branchId: string,
  graph: SliceGraph,
  nodeId: string,
): Promise<{ inputs: SliceInputs; notes: string[] }> {
  const notes: string[] = [];
  const { data: spec, error: specErr } = await supabase
    .from("project_specifications")
    .select("id, vision")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (specErr) throw new Error(`specification: ${specErr.message}`);

  let requirements: SliceRequirementRow[] = [];
  let mappings: Array<{ requirement_id: string; node_id: string }> = [];
  if (spec) {
    const [reqRes, mapRes] = await Promise.all([
      supabase.from("specification_requirements")
        .select("id, requirement_id, name, status, mark, acceptance_criteria, archived_at")
        .eq("specification_id", (spec as AnyRecord).id),
      supabase.from("specification_mappings")
        .select("requirement_id, node_id")
        .eq("specification_id", (spec as AnyRecord).id),
    ]);
    if (reqRes.error) throw new Error(`requirements: ${reqRes.error.message}`);
    if (mapRes.error) throw new Error(`mappings: ${mapRes.error.message}`);
    requirements = ((reqRes.data ?? []) as AnyRecord[]).filter((r) => !r.archived_at) as SliceRequirementRow[];
    const live = liveNodeIdSet(graph.nodes);
    mappings = ((mapRes.data ?? []) as Array<{ requirement_id: string; node_id: string }>).filter((m) => live.has(m.node_id));
  }
  const ownRows = mappings.filter((m) => m.node_id === nodeId).map((m) => m.requirement_id);

  const constraints = (await loadNodeConstraints(supabase, projectId, [nodeId], undefined, graph)).get(nodeId) ?? null;
  const vision = spec
    ? (await loadServedVision(supabase, projectId, branchId, (spec as AnyRecord).vision, new Map([[nodeId, ownRows]]))).get(nodeId) ?? null
    : null;

  const neighbours = new Set<string>([nodeId]);
  for (const e of Object.values(graph.edges ?? {})) {
    if (e.source === nodeId) neighbours.add(String(e.target));
    if (e.target === nodeId) neighbours.add(String(e.source));
  }

  const [taskRes, testRes, leaseRes, memoryRes] = await Promise.all([
    supabase.from("task_items")
      .select("id, node_id, task_key, done, provenance, display_id, title, orphaned, mark")
      .eq("project_id", projectId)
      .eq("node_id", nodeId),
    ownRows.length > 0
      ? supabase.from("test_cases")
        .select("id, requirement_id, test_id, name, status, stale, updated_at, retired_at, mark")
        .in("requirement_id", ownRows)
        .is("retired_at", null)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("agent_checkouts")
      .select("id, level, node_id, task_item_id, holder_label, since, heartbeat_at, meta")
      .eq("project_id", projectId)
      .is("released_at", null)
      .in("node_id", [...neighbours]),
    // AA.7: the node's memory (migration 20260923210000).
    supabase.rpc("node_memory", { p_project_id: projectId, p_branch_id: branchId, p_node_id: nodeId, p_limit: 20 }),
  ]);
  if (taskRes.error) notes.push("Task state could not be read; tasks show as their document last rendered them.");
  if (testRes.error) notes.push("Tests could not be read.");
  if (leaseRes.error) notes.push("Leases could not be read.");
  if (memoryRes.error) notes.push("The node's memory could not be read.");

  return {
    inputs: {
      graph,
      nodeId,
      requirements,
      mappings,
      taskItems: (taskRes.data ?? []) as AnyRecord[],
      tests: (testRes.data ?? []) as AnyRecord[],
      leases: (leaseRes.data ?? []) as AnyRecord[],
      constraints,
      vision,
      memory: memoryRes.error ? null : rawNodeMemory(memoryRes.data),
      now: Date.now(),
    },
    notes,
  };
}
