// P1-7 R1: the model anchor — `.nodespec/model.json`, written into the user's repo on every
// push. A deterministic, content-addressed serialization of the design model that makes git the
// durable store of authored design truth:
//   - branch mirror = read model.json at a ref (git holds per-branch design state);
//   - adopt-on-connect = a repo carrying model.json materializes WITHOUT inference (ids and
//     relationships are READ, not re-inferred — the provenance ratchet that prevents the
//     reverse-visualization collision);
//   - git-side merges of design = file merges of model.json (deterministic, sorted,
//     element-per-line rendering keeps conflicts rare and legible).
// Requirement CONTENT stays in the DB (global, per the Model C decision); the anchor carries
// requirement REFERENCES (REQ-### ids) via the mappings section.
//
// Determinism contract: same graph + mappings => byte-identical output (arrays sorted by id,
// stable key order, no timestamps). Hashes are sha256 (matching the P0-5 integrity primitive),
// computed per element and over the whole content (modelHash excludes itself).

export const MODEL_ANCHOR_PATH = ".nodespec/model.json";
export const MODEL_ANCHOR_VERSION = 1;

export interface AnchorPort {
  id: string;
  name: string;
  direction: string;
}

export interface AnchorNode {
  id: string;
  type: string;
  label: string;
  technology?: string;
  parentId?: string;
  placementKind?: string;
  ports: AnchorPort[];
  contentHash: string;
}

export interface AnchorEdge {
  id: string;
  source: string;
  target: string;
  contractId: string;
  sourcePortId?: string;
  targetPortId?: string;
  label?: string;
  /** N8.6(C): behavior fields are anchor content — present-only, so anchors from
   *  graphs that never set them stay byte-identical. */
  direction?: string;
  criticality?: string;
  contentHash: string;
}

export interface AnchorContract {
  id: string;
  kind: string;
  name: string;
  interactionKind?: string;
  transport?: string;
  specFormat?: string;
  schemaHash?: string;
  contentHash: string;
}

export interface AnchorArtifact {
  id: string;
  nodeId: string;
  path: string;
  kind: string;
  contentHash?: string;
}

export interface AnchorMapping {
  requirementId: string; // human id, e.g. REQ-001 (portable across databases)
  nodeIds: string[];
}

export interface ModelAnchor {
  modelVersion: number;
  generatedBy: "nodespec";
  modelHash: string;
  nodes: AnchorNode[];
  edges: AnchorEdge[];
  contracts: AnchorContract[];
  artifacts: AnchorArtifact[];
  /**
   * R7d (owner 2026-07-31: "you're incorporating the requirements/spec into
   * model.json — this needs to be rectified"): model.json is ARCHITECTURE ONLY.
   * The spec plane — requirement content, criteria, and these mappings — lives
   * solely in `.nodespec/spec.json`. This key survives on the TYPE because
   * anchors written before R7d carry it and must parse forever; new files never
   * have it. Its presence is the legacy-format marker `verifyModelHash` keys on.
   */
  mappings?: AnchorMapping[];
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable stringify: object keys in insertion order of our own literal construction only. */
function stable(o: unknown): string {
  return JSON.stringify(o);
}

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export interface MappingInput {
  requirementId: string; // REQ-###
  nodeId: string;
}

/**
 * Serialize a graph into the canonical model.json string.
 * Pure over its inputs; sorted by id at every level.
 *
 * R7d: ARCHITECTURE ONLY — no requirement mappings. One fact, one file: the
 * spec plane (requirements, criteria, mappings) is `.nodespec/spec.json`'s.
 */
export async function serializeModel(graph: AnyRecord): Promise<string> {
  const nodes: AnchorNode[] = [];
  for (const n of Object.values((graph.nodes ?? {}) as AnyRecord) as AnyRecord[]) {
    const ports: AnchorPort[] = ((n.ports ?? []) as AnyRecord[])
      .map((p) => ({ id: String(p.id), name: String(p.name ?? ""), direction: String(p.direction ?? "") }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const core = {
      id: String(n.id),
      type: String(n.type ?? ""),
      label: String(n.label ?? ""),
      ...(n.technology ? { technology: String(n.technology) } : {}),
      ...(n.parentId ? { parentId: String(n.parentId) } : {}),
      ...(n.placementKind ? { placementKind: String(n.placementKind) } : {}),
      ports,
    };
    nodes.push({ ...core, contentHash: await sha256Hex(stable(core)) });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));

  const edges: AnchorEdge[] = [];
  for (const e of Object.values((graph.edges ?? {}) as AnyRecord) as AnyRecord[]) {
    const core = {
      id: String(e.id),
      source: String(e.source ?? ""),
      target: String(e.target ?? ""),
      contractId: String(e.contractId ?? ""),
      ...(e.sourcePortId ? { sourcePortId: String(e.sourcePortId) } : {}),
      ...(e.targetPortId ? { targetPortId: String(e.targetPortId) } : {}),
      ...(e.label ? { label: String(e.label) } : {}),
      ...(e.direction ? { direction: String(e.direction) } : {}),
      ...(e.criticality ? { criticality: String(e.criticality) } : {}),
    };
    edges.push({ ...core, contentHash: await sha256Hex(stable(core)) });
  }
  edges.sort((a, b) => a.id.localeCompare(b.id));

  // N8.6(C-fix, owner bench 2026-07-28): the anchor carries REACHABLE contracts only —
  // those referenced by an edge. Snapshots accumulate orphans (template-scaffold stubs
  // like "Stub: AMQP In" whose node was deleted, palette-drop suggested-contract
  // materializations like "rest contract" bound only to ports, replaced-edge leftovers)
  // and a one-edge bench graph pushed SIX contracts into git. model.json is the model
  // the AI builds against; unreachable scaffolding is canvas-side state, not model.
  const referencedContractIds = new Set<string>();
  for (const e of Object.values((graph.edges ?? {}) as AnyRecord) as AnyRecord[]) {
    if (e.contractId) referencedContractIds.add(String(e.contractId));
  }
  const contracts: AnchorContract[] = [];
  for (const c of Object.values((graph.contracts ?? {}) as AnyRecord) as AnyRecord[]) {
    if (!referencedContractIds.has(String(c.id))) continue;
    const schemaHash = c.schema !== undefined && c.schema !== null
      ? await sha256Hex(stable(c.schema))
      : undefined;
    const core = {
      id: String(c.id),
      kind: String(c.kind ?? ""),
      name: String(c.name ?? ""),
      ...(c.interactionKind ? { interactionKind: String(c.interactionKind) } : {}),
      ...(c.transport ? { transport: String(c.transport) } : {}),
      ...(c.specFormat ? { specFormat: String(c.specFormat) } : {}),
      ...(schemaHash ? { schemaHash } : {}),
    };
    contracts.push({ ...core, contentHash: await sha256Hex(stable(core)) });
  }
  contracts.sort((a, b) => a.id.localeCompare(b.id));

  const artifacts: AnchorArtifact[] = [];
  for (const a of Object.values((graph.artifacts ?? {}) as AnyRecord) as AnyRecord[]) {
    if (!a.path) continue; // only file-backed artifacts anchor to the repo
    artifacts.push({
      id: String(a.id),
      nodeId: String(a.nodeId ?? ""),
      path: String(a.path).replace(/^\//, ""),
      kind: String(a.kind ?? ""),
      ...(a.contentHash ? { contentHash: String(a.contentHash) } : {}),
    });
  }
  artifacts.sort((a, b) => a.id.localeCompare(b.id));

  const content = { nodes, edges, contracts, artifacts };
  const modelHash = await sha256Hex(stable(content));

  const anchor: ModelAnchor = {
    modelVersion: MODEL_ANCHOR_VERSION,
    generatedBy: "nodespec",
    modelHash,
    ...content,
  };
  return JSON.stringify(anchor, null, 2) + "\n";
}

export type ParseResult =
  | { ok: true; model: ModelAnchor }
  | { ok: false; error: string };

/** Parse + structurally validate a model.json string (catalog validation happens at adopt time). */
export function parseModel(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `model.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const m = raw as AnyRecord;
  if (!m || typeof m !== "object") return { ok: false, error: "model.json root is not an object" };
  if (m.modelVersion !== MODEL_ANCHOR_VERSION) {
    return { ok: false, error: `Unsupported modelVersion: ${m.modelVersion} (expected ${MODEL_ANCHOR_VERSION})` };
  }
  for (const key of ["nodes", "edges", "contracts", "artifacts"]) {
    if (!Array.isArray(m[key])) return { ok: false, error: `model.json ${key} is not an array` };
  }
  // R7d: `mappings` is the LEGACY format's spec-plane section — new anchors never
  // have it (spec.json owns the spec plane). Present = must be an array (old files
  // parse forever); absent = fine.
  if (m.mappings !== undefined && !Array.isArray(m.mappings)) {
    return { ok: false, error: "model.json mappings is present but not an array" };
  }
  for (const n of m.nodes as AnyRecord[]) {
    if (!n.id || !n.type || typeof n.label !== "string") {
      return { ok: false, error: `model.json node missing id/type/label: ${stable(n).slice(0, 120)}` };
    }
  }
  for (const e of m.edges as AnyRecord[]) {
    if (!e.id || !e.source || !e.target || !e.contractId) {
      return { ok: false, error: `model.json edge missing id/source/target/contractId: ${stable(e).slice(0, 120)}` };
    }
  }
  return { ok: true, model: m as ModelAnchor };
}

/**
 * Recompute the model hash of a parsed anchor (integrity check for adopt paths).
 * R7d: hashes the content shape the file ACTUALLY has — a legacy anchor hashed
 * its `mappings` section, a current one has no such section — so files of both
 * formats integrity-verify forever.
 */
export async function verifyModelHash(model: ModelAnchor): Promise<boolean> {
  const content = {
    nodes: model.nodes,
    edges: model.edges,
    contracts: model.contracts,
    artifacts: model.artifacts,
    ...(model.mappings !== undefined ? { mappings: model.mappings } : {}),
  };
  return (await sha256Hex(stable(content))) === model.modelHash;
}

/**
 * R7d: the ARCHITECTURE-ONLY hash, computed fresh from parsed content — the one
 * hash that is comparable ACROSS formats. Every "does the canvas equal the repo
 * anchor?" comparison must use this, never the stored `modelHash`: a legacy repo
 * anchor's stored hash covers a mappings section today's serialization no longer
 * emits, so comparing stored hashes would raise a spurious drift card on every
 * project connected before R7d. Same architecture ⇒ same coreModelHash, whatever
 * the file format.
 */
export async function coreModelHash(model: ModelAnchor): Promise<string> {
  return await sha256Hex(stable({
    nodes: model.nodes,
    edges: model.edges,
    contracts: model.contracts,
    artifacts: model.artifacts,
  }));
}

// ── P1-7 R2: adopt-on-connect — materialize an anchor as ordinary NodeSpec patches ────
// A repo carrying model.json is ADOPTED, never re-inferred (the provenance ratchet). Adoption
// reuses the normal proposal → accept → patch pipeline: this converts the anchor into a patch
// batch (contracts → parents → children → edges → artifacts, so references always precede use)
// that the existing apply path validates and hash-chains like any other change. Requirement
// mappings are NOT patched here (spec plane is DB-global; carried in proposal metadata for a
// later slice).

// deno-lint-ignore no-explicit-any
type PatchOp = { type: string; metadata: Record<string, any>; payload: Record<string, any> };

// ── R3-2: entity-level anchor diff — the easy-reconciliation surface ────────────────
// The anchor content-hashes every node/edge/contract precisely so divergence is
// deterministic SET ARITHMETIC, never a text merge. Direction convention: diff FROM
// the project's model TO the repo's — buckets read as "what LOADING the repo would do
// to your canvas" (added = repo-only, removed = project-only, changed = both sides,
// different contentHash). Keeping your model inverts the reading (your push removes
// the added, restores the removed, overwrites the changed).
export interface AnchorEntityDelta {
  id: string;
  label: string;
}

export interface AnchorDiffBucket {
  added: AnchorEntityDelta[];
  removed: AnchorEntityDelta[];
  changed: AnchorEntityDelta[];
}

export interface AnchorDiff {
  identical: boolean;
  nodes: AnchorDiffBucket;
  edges: AnchorDiffBucket;
  contracts: AnchorDiffBucket;
  artifacts: AnchorDiffBucket;
}

function diffBucket<T extends { id: string; contentHash: string }>(
  ours: T[],
  theirs: T[],
  labelOf: (e: T) => string,
): AnchorDiffBucket {
  const oursById = new Map(ours.map((e) => [e.id, e]));
  const theirsById = new Map(theirs.map((e) => [e.id, e]));
  const added: AnchorEntityDelta[] = [];
  const removed: AnchorEntityDelta[] = [];
  const changed: AnchorEntityDelta[] = [];
  for (const t of theirs) {
    const o = oursById.get(t.id);
    if (!o) added.push({ id: t.id, label: labelOf(t) });
    else if (o.contentHash !== t.contentHash) changed.push({ id: t.id, label: labelOf(t) });
  }
  for (const o of ours) {
    if (!theirsById.has(o.id)) removed.push({ id: o.id, label: labelOf(o) });
  }
  return { added, removed, changed };
}

export function diffAnchors(ours: ModelAnchor, theirs: ModelAnchor): AnchorDiff {
  // Edge labels resolve endpoint NAMES from whichever side carries the edge.
  const nodeLabel = new Map<string, string>();
  for (const n of [...ours.nodes, ...theirs.nodes]) nodeLabel.set(n.id, n.label);
  const edgeLabel = (e: AnchorEdge) =>
    e.label || `${nodeLabel.get(e.source) ?? e.source.slice(0, 8)} → ${nodeLabel.get(e.target) ?? e.target.slice(0, 8)}`;

  const nodes = diffBucket(ours.nodes, theirs.nodes, (n) => n.label);
  const edges = diffBucket(ours.edges, theirs.edges, edgeLabel);
  const contracts = diffBucket(ours.contracts, theirs.contracts, (c) => c.name);
  // Anchor artifacts carry no contentHash (path/kind only) — synthesize one from the
  // serialized fields so moved/re-kinded artifacts read as changed.
  const artHash = (a: AnchorArtifact) => ({ ...a, contentHash: `${a.nodeId}:${a.path}:${a.kind}` });
  const artifacts = diffBucket(
    ours.artifacts.map(artHash),
    theirs.artifacts.map(artHash),
    (a) => a.path,
  );

  const identical =
    [nodes, edges, contracts, artifacts].every(
      (b) => b.added.length === 0 && b.removed.length === 0 && b.changed.length === 0,
    );
  return { identical, nodes, edges, contracts, artifacts };
}

/** Card-metadata form: caps each list so a big graph can't bloat the event row —
 *  full counts survive even when the name lists truncate. */
// Debt audit 2026-07-29: this return shape crosses the wire into the client's
// hand-mirrored CappedModelDiff/CappedDiffBucket (src/ui/services/GitService.ts) —
// the old `[k: string]: any` signature made that pair silently driftable. Change
// these two interfaces TOGETHER with the client copies.
export interface CappedDiffBucket {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface CappedAnchorDiff {
  identical: boolean;
  nodes: CappedDiffBucket;
  edges: CappedDiffBucket;
  contracts: CappedDiffBucket;
  artifacts: CappedDiffBucket;
}

export function capAnchorDiff(diff: AnchorDiff, maxPerList = 8): CappedAnchorDiff {
  const cap = (b: AnchorDiffBucket) => ({
    addedCount: b.added.length,
    removedCount: b.removed.length,
    changedCount: b.changed.length,
    added: b.added.slice(0, maxPerList).map((e) => e.label),
    removed: b.removed.slice(0, maxPerList).map((e) => e.label),
    changed: b.changed.slice(0, maxPerList).map((e) => e.label),
  });
  return {
    identical: diff.identical,
    nodes: cap(diff.nodes),
    edges: cap(diff.edges),
    contracts: cap(diff.contracts),
    artifacts: cap(diff.artifacts),
  };
}

// ── R3-3b: the entity diff AS the pull request body ────────────────────────────────
// Design review lands where code review happens: the PR opened by a design merge
// carries the R3-2 entity-level delta (+added / −removed / ~changed per bucket),
// rendered as markdown. Direction convention: the diff is diffAnchors(target,
// source) — "what merging the source INTO the target does to the target".
export function renderAnchorDiffMarkdown(
  diff: AnchorDiff,
  sourceName: string,
  targetName: string,
  maxPerList = 20,
): string {
  const lines: string[] = [];
  lines.push("## NodeSpec design change");
  lines.push("");
  lines.push(`Merging design branch \`${sourceName}\` into \`${targetName}\`.`);
  lines.push("");
  if (diff.identical) {
    lines.push("No model changes — both branches carry the same design model.");
  } else {
    const section = (title: string, b: AnchorDiffBucket) => {
      if (b.added.length === 0 && b.removed.length === 0 && b.changed.length === 0) return;
      lines.push(`### ${title} (+${b.added.length} / −${b.removed.length} / ~${b.changed.length})`);
      lines.push("");
      const list = (prefix: string, entries: AnchorEntityDelta[]) => {
        for (const e of entries.slice(0, maxPerList)) lines.push(`- ${prefix} ${e.label}`);
        if (entries.length > maxPerList) lines.push(`- ${prefix} … and ${entries.length - maxPerList} more`);
      };
      list("+", b.added);
      list("−", b.removed);
      list("~", b.changed);
      lines.push("");
    };
    section("Nodes", diff.nodes);
    section("Connections", diff.edges);
    section("Contracts", diff.contracts);
    section("Files", diff.artifacts);
  }
  lines.push("");
  lines.push("_Generated by NodeSpec from `.nodespec/model.json` — an entity-level design diff, not a text diff._");
  return lines.join("\n");
}

// ── R3-1: THE LOADER — anchor → whole graph (the inverse of serializeModel) ─────────
// Replace-graph restore for git-native branching: a git ref's model.json IS that
// ref's graph. Produces a snapshot-ready graph_data object (the N6.1 snapshot-only
// persist precedent — graph_patches are NEVER rewritten; the log keeps forward
// history, the snapshot moves). Honest limits, by construction of the anchor:
// contract schema CONTENT and artifact file CONTENT are not in the anchor (only
// hashes/paths) — restored contracts carry empty schemas and restored artifacts
// hydrate on demand through the R2.1 load-from-repo lane. THE invariant (pinned):
// serializeModel(anchorToGraph(model)) reproduces the same modelHash.
export interface RestoredGraphResult {
  // deno-lint-ignore no-explicit-any
  graph: Record<string, any>;
  counts: { nodes: number; edges: number; contracts: number; artifacts: number };
}

export function anchorToGraph(
  model: ModelAnchor,
  // R3-4b (owner bench 2026-07-30: "anchor-restore provenance_detail is NULL"):
  // `sourceCommit` is the ref HEAD the anchor was read from, so restored artifacts
  // carry the same {origin, commitSha, at} detail every other lane writes. Optional
  // — a caller without a resolved sha still gets origin + timestamp, never NULL.
  opts: { graphId: string; version: number; nowIso: string; sourceCommit?: string },
): RestoredGraphResult {
  // deno-lint-ignore no-explicit-any
  const nodes: Record<string, any> = {};
  const artifactsByNode = new Map<string, string[]>();
  for (const a of model.artifacts) {
    if (!artifactsByNode.has(a.nodeId)) artifactsByNode.set(a.nodeId, []);
    artifactsByNode.get(a.nodeId)!.push(a.id);
  }
  for (const n of model.nodes) {
    nodes[n.id] = {
      id: n.id,
      type: n.type,
      label: n.label,
      ...(n.technology ? { technology: n.technology } : {}),
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.placementKind ? { placementKind: n.placementKind } : {}),
      ports: n.ports.map((p) => ({ id: p.id, name: p.name, direction: p.direction })),
      data: {},
      artifacts: artifactsByNode.get(n.id) ?? [],
      metadata: {},
      status: "draft",
    };
  }

  // deno-lint-ignore no-explicit-any
  const edges: Record<string, any> = {};
  for (const e of model.edges) {
    edges[e.id] = {
      id: e.id,
      source: e.source,
      target: e.target,
      contractId: e.contractId,
      ...(e.sourcePortId ? { sourcePortId: e.sourcePortId } : {}),
      ...(e.targetPortId ? { targetPortId: e.targetPortId } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.direction ? { direction: e.direction } : {}),
      ...(e.criticality ? { criticality: e.criticality } : {}),
      metadata: {},
    };
  }

  // deno-lint-ignore no-explicit-any
  const contracts: Record<string, any> = {};
  for (const c of model.contracts) {
    contracts[c.id] = {
      id: c.id,
      kind: c.kind,
      name: c.name,
      ...(c.interactionKind ? { interactionKind: c.interactionKind } : {}),
      ...(c.transport ? { transport: c.transport } : {}),
      ...(c.specFormat ? { specFormat: c.specFormat } : {}),
      schema: {},
      metadata: {},
      status: "draft",
    };
  }

  // deno-lint-ignore no-explicit-any
  const artifacts: Record<string, any> = {};
  for (const a of model.artifacts) {
    artifacts[a.id] = {
      id: a.id,
      nodeId: a.nodeId,
      path: a.path,
      kind: a.kind,
      content: "",
      createdAt: opts.nowIso,
      updatedAt: opts.nowIso,
      metadata: {
        restoredFromAnchor: true,
        restoredModelHash: model.modelHash,
        // R3-4b: BOTH halves of the convention — the string names the lane, the
        // detail says which commit and when. This half was missing, so every
        // anchor-restored artifact read as provenance_detail = NULL while the
        // git-accept / residue-bind lanes carried the full record.
        provenance: {
          origin: "anchor-restore",
          ...(opts.sourceCommit ? { commitSha: opts.sourceCommit } : {}),
          at: opts.nowIso,
        },
      },
      // R3-4b: one provenance convention across every lane that materializes
      // external content — sourceProvenance names the origin lane.
      sourceProvenance: "anchor-restore",
      status: "draft",
    };
  }

  const graph = {
    id: opts.graphId,
    // Must satisfy the CLIENT's GraphSchema on its next save (schemaVersion is
    // required there) — keep in lockstep with core CURRENT_GRAPH_SCHEMA_VERSION.
    schemaVersion: 8,
    version: opts.version,
    hash: model.modelHash,
    nodes,
    edges,
    contracts,
    artifacts,
    metadata: { restoredFromAnchor: model.modelHash, restoredAt: opts.nowIso },
  };

  return {
    graph,
    counts: {
      nodes: model.nodes.length,
      edges: model.edges.length,
      contracts: model.contracts.length,
      artifacts: model.artifacts.length,
    },
  };
}

export function anchorToPatches(model: ModelAnchor, actorId = "git-adopt", sourceCommit?: string): PatchOp[] {
  const now = new Date().toISOString();
  const meta = (summary: string) => ({
    id: crypto.randomUUID(),
    timestamp: now,
    actorType: "system",
    actorId,
    summary,
  });

  const patches: PatchOp[] = [];

  for (const c of model.contracts) {
    patches.push({
      type: "add_contract",
      metadata: meta(`Adopt contract from anchor: ${c.name}`),
      payload: {
        id: c.id, kind: c.kind, name: c.name,
        ...(c.interactionKind ? { interactionKind: c.interactionKind } : {}),
        ...(c.transport ? { transport: c.transport } : {}),
        ...(c.specFormat ? { specFormat: c.specFormat } : {}),
      },
    });
  }

  // Parents before children so parentId references always exist when applied in order.
  const ordered = [...model.nodes].sort((a, b) =>
    (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || a.id.localeCompare(b.id)
  );
  for (const n of ordered) {
    patches.push({
      type: "add_node",
      metadata: meta(`Adopt node from anchor: ${n.label}`),
      payload: {
        id: n.id, type: n.type, label: n.label,
        ...(n.technology ? { technology: n.technology } : {}),
        ...(n.parentId ? { parentId: n.parentId } : {}),
        ...(n.placementKind ? { placementKind: n.placementKind } : {}),
        ports: n.ports ?? [],
        status: "draft",
      },
    });
  }

  for (const e of model.edges) {
    patches.push({
      type: "add_edge",
      metadata: meta(`Adopt edge from anchor`),
      payload: {
        id: e.id, source: e.source, target: e.target, contractId: e.contractId,
        ...(e.sourcePortId ? { sourcePortId: e.sourcePortId } : {}),
        ...(e.targetPortId ? { targetPortId: e.targetPortId } : {}),
        ...(e.label ? { label: e.label } : {}),
        ...(e.direction ? { direction: e.direction } : {}),
        ...(e.criticality ? { criticality: e.criticality } : {}),
      },
    });
  }

  for (const a of model.artifacts) {
    patches.push({
      type: "add_artifact",
      metadata: meta(`Adopt artifact from anchor: ${a.path}`),
      payload: {
        id: a.id, nodeId: a.nodeId, path: a.path, kind: a.kind,
        ...(a.contentHash ? { contentHash: a.contentHash } : {}),
        createdAt: now, updatedAt: now,
        // R3-4b: same origin as the snapshot restore lane — both materialize
        // bindings from the repo's anchor.
        sourceProvenance: "anchor-restore",
        // …and the same detail record (owner bench 2026-07-30: this lane wrote
        // no metadata at all, so adopted artifacts had NULL provenance detail).
        metadata: {
          provenance: {
            origin: "anchor-restore",
            ...(sourceCommit ? { commitSha: sourceCommit } : {}),
            at: now,
          },
        },
      },
    });
  }

  return patches;
}
