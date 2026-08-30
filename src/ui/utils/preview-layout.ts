import type { SpecGraphRFNode, SpecGraphRFEdge } from '../adapters/graph-to-reactflow.js';

interface NodePosition {
  id: string;
  x: number;
  y: number;
}

interface SizeOverride {
  id: string;
  width: number;
  height: number;
}

interface LayoutResult {
  positions: NodePosition[];
  sizes: SizeOverride[];
}

const CONTAINER_TYPES = new Set(['container', 'group', 'logicalBoundary']);

const ICON_W = 44;
const ICON_H = 44;
const ICON_GAP_X = 32;
const ICON_GAP_Y = 24;
const CONTAINER_PAD_X = 40;
const CONTAINER_PAD_TOP = 48;
const CONTAINER_PAD_BOTTOM = 32;
const CONTAINER_GAP = 60;
const TOP_LEVEL_GAP = 120;

function isContainer(node: SpecGraphRFNode): boolean {
  return CONTAINER_TYPES.has(node.type ?? '');
}

function buildHierarchy(nodes: SpecGraphRFNode[]) {
  const byId = new Map<string, SpecGraphRFNode>();
  const childContainers = new Map<string, SpecGraphRFNode[]>();
  const childLeaves = new Map<string, SpecGraphRFNode[]>();
  const topLevel: SpecGraphRFNode[] = [];

  for (const n of nodes) {
    byId.set(n.id, n);
  }

  for (const n of nodes) {
    if (!n.parentId) {
      topLevel.push(n);
    } else {
      const map = isContainer(n) ? childContainers : childLeaves;
      const arr = map.get(n.parentId) || [];
      arr.push(n);
      map.set(n.parentId, arr);
    }
  }

  return { byId, childContainers, childLeaves, topLevel };
}

function layoutLeaves(
  leaves: SpecGraphRFNode[],
  edges: SpecGraphRFEdge[],
): { positions: NodePosition[]; width: number; height: number } {
  if (leaves.length === 0) return { positions: [], width: 0, height: 0 };

  const leafIds = new Set(leaves.map(n => n.id));
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
  const positions: NodePosition[] = [];
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
  container: SpecGraphRFNode,
  childContainers: Map<string, SpecGraphRFNode[]>,
  childLeaves: Map<string, SpecGraphRFNode[]>,
  edges: SpecGraphRFEdge[],
): { positions: NodePosition[]; sizes: SizeOverride[]; width: number; height: number } {
  const leaves = childLeaves.get(container.id) || [];
  const nested = childContainers.get(container.id) || [];
  const positions: NodePosition[] = [];
  const sizes: SizeOverride[] = [];

  const leafResult = layoutLeaves(leaves, edges);
  positions.push(...leafResult.positions);

  let leafBlockWidth = leafResult.width;
  let leafBlockHeight = leafResult.height;

  const nestedResults: Array<{ node: SpecGraphRFNode; w: number; h: number }> = [];
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

  if (leaves.length > 0 && nested.length === 0) {
    const leftoverLeaves = childLeaves.get(container.id) || [];
    if (leftoverLeaves.length > 0) {
      leafBlockWidth = leafResult.width;
      leafBlockHeight = leafResult.height;
    }
  }

  return {
    positions,
    sizes,
    width: Math.max(300, leafBlockWidth),
    height: Math.max(250, leafBlockHeight),
  };
}

export function computePreviewLayout(
  nodes: SpecGraphRFNode[],
  edges: SpecGraphRFEdge[],
): LayoutResult {
  const { childContainers, childLeaves, topLevel } = buildHierarchy(nodes);
  const positions: NodePosition[] = [];
  const sizes: SizeOverride[] = [];

  const topContainers = topLevel.filter(n => isContainer(n));
  const topNodes = topLevel.filter(n => !isContainer(n));

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
