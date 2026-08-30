/*
  P1-7 C2: the node anchor slice — the ONE serialization contract for handing a single
  node's context to an external AI. The exported JSON is a strict per-node SLICE of the
  repo anchor (`.nodespec/model.json`, produced server-side by
  supabase/functions/_shared/model-anchor.ts): identical field names, identical optional-
  field handling, identical sorting, identical per-element sha256 contentHash. A node in
  the export deep-equals the same node in the anchor at HEAD — pinned by a cross-runtime
  golden fixture (supabase/functions/tests/fixtures/anchor-slice-golden.json) asserted by
  BOTH the Deno suite (anchor side) and vitest (slice side).

  On top of the slice the export carries only spec-plane references and the packet pointer:
  REQ-### ids and the node's task-doc path. Deliberately NO catalog guidance — L2/L3
  catalog content never crosses into exportable files (IP boundary, V2_PLAN §1.C).

  The serialization rules are duplicated from model-anchor.ts by necessity (core is a
  browser/node package; _shared is Deno-only) — the golden fixture is what keeps the two
  implementations byte-compatible. If you change one, regenerate the fixture and the other
  side's test will tell you.
*/

import type { Graph } from './types.js';

export const NODE_SLICE_VERSION = 1;
export const SLICE_MODEL_VERSION = 1; // must track MODEL_ANCHOR_VERSION in model-anchor.ts

export interface SlicePort {
  id: string;
  name: string;
  direction: string;
}

export interface SliceNode {
  id: string;
  type: string;
  label: string;
  technology?: string;
  parentId?: string;
  placementKind?: string;
  ports: SlicePort[];
  contentHash: string;
}

export interface SliceEdge {
  id: string;
  source: string;
  target: string;
  contractId: string;
  sourcePortId?: string;
  targetPortId?: string;
  label?: string;
  /** N8.6(C): behavior fields are anchor content — present-only, so slices of
   *  graphs that never set them hash byte-identically to pre-(C) slices. */
  direction?: string;
  criticality?: string;
  contentHash: string;
}

export interface SliceContract {
  id: string;
  kind: string;
  name: string;
  interactionKind?: string;
  transport?: string;
  specFormat?: string;
  schemaHash?: string;
  contentHash: string;
}

export interface SliceArtifact {
  id: string;
  nodeId: string;
  path: string;
  kind: string;
  contentHash?: string;
}

export interface NodeAnchorSlice {
  sliceVersion: number;
  modelVersion: number;
  generatedBy: 'nodespec';
  nodeId: string;
  node: SliceNode;
  edges: SliceEdge[];
  contracts: SliceContract[];
  artifacts: SliceArtifact[];
  neighbors: Array<{ id: string; type: string; label: string }>;
  /** Human requirement ids (REQ-###) mapped to this node — references, never content. */
  requirements: string[];
  /** Repo path of this node's task-doc packet, when one exists. */
  taskDocPath: string | null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Stable stringify: object keys in insertion order of our own literal construction only. */
function stable(o: unknown): string {
  return JSON.stringify(o);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export interface NodeSliceExtras {
  requirements?: string[];
  taskDocPath?: string | null;
}

/**
 * Build the anchor slice for one node. Field construction below mirrors
 * model-anchor.ts `serializeModel` literal-for-literal — do not reorder keys.
 */
export async function buildNodeAnchorSlice(
  graph: Graph,
  nodeId: string,
  extras: NodeSliceExtras = {},
): Promise<NodeAnchorSlice | null> {
  const g = graph as unknown as AnyRecord;
  const n = (g.nodes ?? {})[nodeId] as AnyRecord | undefined;
  if (!n) return null;

  const makeNode = async (raw: AnyRecord): Promise<SliceNode> => {
    const ports: SlicePort[] = ((raw.ports ?? []) as AnyRecord[])
      .map(p => ({ id: String(p.id), name: String(p.name ?? ''), direction: String(p.direction ?? '') }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const core = {
      id: String(raw.id),
      type: String(raw.type ?? ''),
      label: String(raw.label ?? ''),
      ...(raw.technology ? { technology: String(raw.technology) } : {}),
      ...(raw.parentId ? { parentId: String(raw.parentId) } : {}),
      ...(raw.placementKind ? { placementKind: String(raw.placementKind) } : {}),
      ports,
    };
    return { ...core, contentHash: await sha256Hex(stable(core)) };
  };

  const node = await makeNode(n);

  const edges: SliceEdge[] = [];
  const contractIds = new Set<string>();
  const neighborIds = new Set<string>();
  for (const e of Object.values((g.edges ?? {}) as AnyRecord) as AnyRecord[]) {
    if (e.source !== nodeId && e.target !== nodeId) continue;
    const core = {
      id: String(e.id),
      source: String(e.source ?? ''),
      target: String(e.target ?? ''),
      contractId: String(e.contractId ?? ''),
      ...(e.sourcePortId ? { sourcePortId: String(e.sourcePortId) } : {}),
      ...(e.targetPortId ? { targetPortId: String(e.targetPortId) } : {}),
      ...(e.label ? { label: String(e.label) } : {}),
      ...(e.direction ? { direction: String(e.direction) } : {}),
      ...(e.criticality ? { criticality: String(e.criticality) } : {}),
    };
    edges.push({ ...core, contentHash: await sha256Hex(stable(core)) });
    if (e.contractId) contractIds.add(String(e.contractId));
    neighborIds.add(String(e.source === nodeId ? e.target : e.source));
  }
  edges.sort((a, b) => a.id.localeCompare(b.id));

  const contracts: SliceContract[] = [];
  for (const id of contractIds) {
    const c = (g.contracts ?? {})[id] as AnyRecord | undefined;
    if (!c) continue;
    const schemaHash = c.schema !== undefined && c.schema !== null
      ? await sha256Hex(stable(c.schema))
      : undefined;
    const core = {
      id: String(c.id),
      kind: String(c.kind ?? ''),
      name: String(c.name ?? ''),
      ...(c.interactionKind ? { interactionKind: String(c.interactionKind) } : {}),
      ...(c.transport ? { transport: String(c.transport) } : {}),
      ...(c.specFormat ? { specFormat: String(c.specFormat) } : {}),
      ...(schemaHash ? { schemaHash } : {}),
    };
    contracts.push({ ...core, contentHash: await sha256Hex(stable(core)) });
  }
  contracts.sort((a, b) => a.id.localeCompare(b.id));

  const artifacts: SliceArtifact[] = [];
  for (const a of Object.values((g.artifacts ?? {}) as AnyRecord) as AnyRecord[]) {
    if (a.nodeId !== nodeId || !a.path) continue;
    artifacts.push({
      id: String(a.id),
      nodeId: String(a.nodeId ?? ''),
      path: String(a.path).replace(/^\//, ''),
      kind: String(a.kind ?? ''),
      ...(a.contentHash ? { contentHash: String(a.contentHash) } : {}),
    });
  }
  artifacts.sort((a, b) => a.id.localeCompare(b.id));

  const neighbors = [...neighborIds]
    .map(id => (g.nodes ?? {})[id] as AnyRecord | undefined)
    .filter(Boolean)
    .map(nb => ({ id: String(nb!.id), type: String(nb!.type ?? ''), label: String(nb!.label ?? '') }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    sliceVersion: NODE_SLICE_VERSION,
    modelVersion: SLICE_MODEL_VERSION,
    generatedBy: 'nodespec',
    nodeId,
    node,
    edges,
    contracts,
    artifacts,
    neighbors,
    requirements: [...(extras.requirements ?? [])].sort(),
    taskDocPath: extras.taskDocPath ?? null,
  };
}

/** Canonical file rendering of a slice (2-space indent + trailing newline, like the anchor). */
export function serializeNodeAnchorSlice(slice: NodeAnchorSlice): string {
  return JSON.stringify(slice, null, 2) + '\n';
}
