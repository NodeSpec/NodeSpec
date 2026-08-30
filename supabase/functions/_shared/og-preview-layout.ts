// Server-side copy of src/ui/utils/preview-layout.ts computePreviewLayout
// for og:image rendering. The original is pure but typed against React Flow
// node shapes and an adapter (mapGraphToRFNodes) that drags in catalog and
// core imports — not portable. This copy retypes against a slim structural
// shape and derives container-ness from graph truth (a node is a container
// iff another node's parentId references it), which is the right
// approximation for a share card where a childless container reads fine as
// a leaf tile.
//
// LOCKSTEP: the layout constants and algorithm must match the client copy —
// tests/fixtures/og-preview-layout-fixture.json is asserted byte-for-byte
// by BOTH this side's Deno test and src/tests/preview-layout-parity.test.ts
// running the original. Change one, regenerate the fixture, expect both
// suites to need updating.

export interface OgLayoutNode {
  id: string;
  parentId?: string;
  isContainer: boolean;
}

export interface OgLayoutEdge {
  source: string;
  target: string;
}

export interface OgNodePosition {
  id: string;
  x: number;
  y: number;
}

export interface OgSizeOverride {
  id: string;
  width: number;
  height: number;
}

export interface OgLayoutResult {
  positions: OgNodePosition[];
  sizes: OgSizeOverride[];
}

export const ICON_W = 44;
export const ICON_H = 44;
const ICON_GAP_X = 32;
const ICON_GAP_Y = 24;
const CONTAINER_PAD_X = 40;
const CONTAINER_PAD_TOP = 48;
const CONTAINER_PAD_BOTTOM = 32;
const CONTAINER_GAP = 60;
const TOP_LEVEL_GAP = 120;

/** Graph-truth container detection: referenced as someone's parentId. */
export function toLayoutNodes(
  nodes: Array<{ id: string; parentId?: string }>
): OgLayoutNode[] {
  const parentIds = new Set(
    nodes.map((n) => n.parentId).filter((p): p is string => typeof p === "string")
  );
  return nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    isContainer: parentIds.has(n.id),
  }));
}

function buildHierarchy(nodes: OgLayoutNode[]) {
  const childContainers = new Map<string, OgLayoutNode[]>();
  const childLeaves = new Map<string, OgLayoutNode[]>();
  const topLevel: OgLayoutNode[] = [];

  for (const n of nodes) {
    if (!n.parentId) {
      topLevel.push(n);
    } else {
      const map = n.isContainer ? childContainers : childLeaves;
      const arr = map.get(n.parentId) || [];
      arr.push(n);
      map.set(n.parentId, arr);
    }
  }

  return { childContainers, childLeaves, topLevel };
}

function layoutLeaves(
  leaves: OgLayoutNode[],
  edges: OgLayoutEdge[]
): { positions: OgNodePosition[]; width: number; height: number } {
  if (leaves.length === 0) return { positions: [], width: 0, height: 0 };

  const leafIds = new Set(leaves.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of leafIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (leafIds.has(e.source) && leafIds.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const ranks: string[][] = [];
  const placed = new Set<string>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  while (placed.size < leafIds.size) {
    if (queue.length === 0) {
      for (const id of leafIds) {
        if (!placed.has(id)) { queue.push(id); break; }
      }
    }
    const rank: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (placed.has(id)) continue;
      rank.push(id);
      placed.add(id);
    }
    if (rank.length > 0) ranks.push(rank);
    for (const id of rank) {
      for (const nb of adj.get(id) ?? []) {
        if (placed.has(nb)) continue;
        const nd = (inDegree.get(nb) ?? 1) - 1;
        inDegree.set(nb, nd);
        if (nd <= 0) queue.push(nb);
      }
    }
  }

  const ordered = ranks.flat();
  const maxCols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(ordered.length * 1.8))));
  const positions: OgNodePosition[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const col = i % maxCols;
    const row = Math.floor(i / maxCols);
    positions.push({
      id: ordered[i],
      x: CONTAINER_PAD_X + col * (ICON_W + ICON_GAP_X),
      y: CONTAINER_PAD_TOP + row * (ICON_H + ICON_GAP_Y),
    });
  }

  const cols = Math.min(ordered.length, maxCols);
  const rows = Math.ceil(ordered.length / maxCols);
  const width = CONTAINER_PAD_X * 2 + cols * ICON_W + (cols - 1) * ICON_GAP_X;
  const height = CONTAINER_PAD_TOP + rows * ICON_H + (rows - 1) * ICON_GAP_Y + CONTAINER_PAD_BOTTOM;
  return { positions, width, height };
}

function layoutContainerRecursive(
  container: OgLayoutNode,
  childContainers: Map<string, OgLayoutNode[]>,
  childLeaves: Map<string, OgLayoutNode[]>,
  edges: OgLayoutEdge[]
): { positions: OgNodePosition[]; sizes: OgSizeOverride[]; width: number; height: number } {
  const leaves = childLeaves.get(container.id) || [];
  const nested = childContainers.get(container.id) || [];
  const positions: OgNodePosition[] = [];
  const sizes: OgSizeOverride[] = [];

  const leafResult = layoutLeaves(leaves, edges);
  positions.push(...leafResult.positions);

  const leafBlockWidth = leafResult.width;
  const leafBlockHeight = leafResult.height;

  const nestedResults: Array<{ node: OgLayoutNode; w: number; h: number }> = [];
  for (const nc of nested) {
    const r = layoutContainerRecursive(nc, childContainers, childLeaves, edges);
    positions.push(...r.positions);
    sizes.push(...r.sizes);
    nestedResults.push({ node: nc, w: r.width, h: r.height });
  }

  if (nestedResults.length > 0) {
    const nestedStartX = leafBlockWidth > 0
      ? leafBlockWidth + CONTAINER_GAP
      : CONTAINER_PAD_X;

    let curX = nestedStartX;
    let maxNestedH = 0;
    for (const nr of nestedResults) {
      positions.push({ id: nr.node.id, x: curX, y: CONTAINER_PAD_TOP });
      sizes.push({ id: nr.node.id, width: nr.w, height: nr.h });
      curX += nr.w + CONTAINER_GAP;
      maxNestedH = Math.max(maxNestedH, nr.h);
    }

    const totalW = curX - CONTAINER_GAP + CONTAINER_PAD_X;
    const totalH = Math.max(leafBlockHeight, CONTAINER_PAD_TOP + maxNestedH + CONTAINER_PAD_BOTTOM);
    return {
      positions,
      sizes,
      width: Math.max(300, totalW),
      height: Math.max(250, totalH),
    };
  }

  return {
    positions,
    sizes,
    width: Math.max(300, leafBlockWidth),
    height: Math.max(250, leafBlockHeight),
  };
}

export function computeOgPreviewLayout(
  nodes: OgLayoutNode[],
  edges: OgLayoutEdge[]
): OgLayoutResult {
  const { childContainers, childLeaves, topLevel } = buildHierarchy(nodes);
  const positions: OgNodePosition[] = [];
  const sizes: OgSizeOverride[] = [];

  const topContainers = topLevel.filter((n) => n.isContainer);
  const topNodes = topLevel.filter((n) => !n.isContainer);

  let curX = 60;
  const startY = 60;

  for (const container of topContainers) {
    const r = layoutContainerRecursive(container, childContainers, childLeaves, edges);
    positions.push({ id: container.id, x: curX, y: startY });
    sizes.push({ id: container.id, width: r.width, height: r.height });
    positions.push(...r.positions);
    sizes.push(...r.sizes);
    curX += r.width + TOP_LEVEL_GAP;
  }

  if (topNodes.length > 0) {
    const nodeStartX = curX;
    const nodeStartY = startY + 40;
    const maxCols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(topNodes.length * 1.8))));
    for (let i = 0; i < topNodes.length; i++) {
      const col = i % maxCols;
      const row = Math.floor(i / maxCols);
      positions.push({
        id: topNodes[i].id,
        x: nodeStartX + col * (ICON_W + ICON_GAP_X),
        y: nodeStartY + row * (ICON_H + ICON_GAP_Y),
      });
    }
  }

  return { positions, sizes };
}

/**
 * Resolve the parent-relative layout positions (React Flow convention) to
 * absolute canvas coordinates by walking each node's ancestor chain.
 */
export function resolveAbsolutePositions(
  nodes: OgLayoutNode[],
  layout: OgLayoutResult
): Map<string, { x: number; y: number }> {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const relative = new Map(layout.positions.map((p) => [p.id, { x: p.x, y: p.y }]));
  const absolute = new Map<string, { x: number; y: number }>();

  const resolve = (id: string, depth = 0): { x: number; y: number } => {
    const cached = absolute.get(id);
    if (cached) return cached;
    const rel = relative.get(id) ?? { x: 0, y: 0 };
    const parent = parentOf.get(id);
    // Depth cap guards a corrupt parentId cycle from recursing forever.
    const result = parent && depth < 32
      ? (() => {
          const p = resolve(parent, depth + 1);
          return { x: p.x + rel.x, y: p.y + rel.y };
        })()
      : { x: rel.x, y: rel.y };
    absolute.set(id, result);
    return result;
  };

  for (const n of nodes) resolve(n.id);
  return absolute;
}
