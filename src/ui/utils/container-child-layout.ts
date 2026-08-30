import type { Graph } from '@nodespec/core/types.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import { isContainerType } from '../adapters/rf-visual-type-resolver.js';

export interface ChildPosition {
  id: string;
  x: number;
  y: number;
}

export interface ContainerSizing {
  width: number;
  height: number;
}

export interface LayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  horizontalGap: number;
  verticalGap: number;
  containerPaddingX: number;
  containerPaddingTop: number;
  containerPaddingBottom: number;
}

export const DEFAULT_CONFIG: LayoutConfig = {
  nodeWidth: 80,
  nodeHeight: 80,
  horizontalGap: 40,
  verticalGap: 40,
  containerPaddingX: 50,
  containerPaddingTop: 72,
  containerPaddingBottom: 50,
};

export const NESTED_CONTAINER_CONFIG: LayoutConfig = {
  nodeWidth: 350,
  nodeHeight: 280,
  horizontalGap: 80,
  verticalGap: 60,
  containerPaddingX: 60,
  containerPaddingTop: 80,
  containerPaddingBottom: 50,
};

function buildChildAdjacency(
  childIds: Set<string>,
  graph: Graph,
): { adjacency: Map<string, string[]>; inDegree: Map<string, number> } {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of childIds) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }

  for (const edge of Object.values(graph.edges)) {
    if (childIds.has(edge.source) && childIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  return { adjacency, inDegree };
}

function topologicalRanks(
  childIds: Set<string>,
  adjacency: Map<string, string[]>,
  inDegree: Map<string, number>,
): string[][] {
  const ranks: string[][] = [];
  const placed = new Set<string>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (placed.size < childIds.size) {
    if (queue.length === 0) {
      for (const id of childIds) {
        if (!placed.has(id)) {
          queue.push(id);
          break;
        }
      }
    }

    const rank: string[] = [];
    const nextQueue: string[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (placed.has(nodeId)) continue;
      rank.push(nodeId);
      placed.add(nodeId);
    }

    if (rank.length > 0) {
      ranks.push(rank);
    }

    for (const nodeId of rank) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (placed.has(neighbor)) continue;
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg <= 0) {
          nextQueue.push(neighbor);
        }
      }
    }

    for (const id of nextQueue) {
      queue.push(id);
    }
  }

  return ranks;
}

export function layoutContainerChildren(
  containerId: string,
  graph: Graph,
  catalog?: CatalogResolver | null,
): { positions: ChildPosition[]; sizing: ContainerSizing } {
  const children = Object.values(graph.nodes).filter(n => n.parentId === containerId);
  if (children.length === 0) {
    return {
      positions: [],
      sizing: { width: 500, height: 350 },
    };
  }

  const regularChildren = children.filter(c => !isContainerType(c.type, catalog));
  const nestedContainers = children.filter(c => isContainerType(c.type, catalog));

  const positions: ChildPosition[] = [];
  let totalContentWidth = 0;
  let totalContentHeight = 0;

  if (regularChildren.length > 0) {
    const childIds = new Set(regularChildren.map(c => c.id));
    const { adjacency, inDegree } = buildChildAdjacency(childIds, graph);
    const ranks = topologicalRanks(childIds, adjacency, inDegree);

    const cfg = DEFAULT_CONFIG;
    const flatChildren = ranks.flat();
    const maxColumns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(flatChildren.length * 1.5))));

    for (let i = 0; i < flatChildren.length; i++) {
      const col = i % maxColumns;
      const row = Math.floor(i / maxColumns);
      positions.push({
        id: flatChildren[i],
        x: cfg.containerPaddingX + col * (cfg.nodeWidth + cfg.horizontalGap),
        y: cfg.containerPaddingTop + row * (cfg.nodeHeight + cfg.verticalGap),
      });
    }

    const cols = Math.min(flatChildren.length, maxColumns);
    const rows = Math.ceil(flatChildren.length / maxColumns);
    totalContentWidth = cfg.containerPaddingX * 2 + cols * (cfg.nodeWidth + cfg.horizontalGap) - cfg.horizontalGap;
    totalContentHeight = cfg.containerPaddingTop + rows * (cfg.nodeHeight + cfg.verticalGap) - cfg.verticalGap + cfg.containerPaddingBottom;
  }

  if (nestedContainers.length > 0) {
    const cfg = NESTED_CONTAINER_CONFIG;
    const startX = totalContentWidth > 0
      ? totalContentWidth + cfg.horizontalGap
      : cfg.containerPaddingX;

    let currentX = startX;

    for (const container of nestedContainers) {
      const childLayout = layoutContainerChildren(container.id, graph, catalog);
      const nestedWidth = Math.max(cfg.nodeWidth, childLayout.sizing.width);
      const nestedHeight = Math.max(cfg.nodeHeight, childLayout.sizing.height);

      positions.push({
        id: container.id,
        x: currentX,
        y: cfg.containerPaddingTop,
      });

      currentX += nestedWidth + cfg.horizontalGap;
      totalContentHeight = Math.max(totalContentHeight, cfg.containerPaddingTop + nestedHeight + cfg.containerPaddingBottom);
    }

    totalContentWidth = currentX - cfg.horizontalGap + cfg.containerPaddingX;
  }

  if (regularChildren.length > 0 && nestedContainers.length === 0) {
    const cfg = DEFAULT_CONFIG;
    totalContentWidth = Math.max(totalContentWidth, cfg.containerPaddingX * 2 + cfg.nodeWidth);
  }

  const sizing: ContainerSizing = {
    width: Math.max(300, totalContentWidth),
    height: Math.max(250, totalContentHeight),
  };

  return { positions, sizing };
}

export function calculateFlowAwareContainerSize(
  childCount: number,
  hasNestedContainers: boolean,
  nestedContainerCount: number = 0,
): ContainerSizing {
  if (childCount === 0 && !hasNestedContainers) {
    return { width: 300, height: 250 };
  }

  const cfg = DEFAULT_CONFIG;
  const regularCount = childCount - nestedContainerCount;

  if (regularCount <= 0 && hasNestedContainers) {
    const ncfg = NESTED_CONTAINER_CONFIG;
    const width = ncfg.containerPaddingX * 2 + nestedContainerCount * (ncfg.nodeWidth + ncfg.horizontalGap) - ncfg.horizontalGap;
    const height = ncfg.containerPaddingTop + ncfg.nodeHeight + ncfg.containerPaddingBottom;
    return {
      width: Math.max(400, width),
      height: Math.max(350, height),
    };
  }

  const maxColumns = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(regularCount * 1.5))));
  const rows = Math.ceil(regularCount / maxColumns);

  const contentWidth = maxColumns * (cfg.nodeWidth + cfg.horizontalGap) - cfg.horizontalGap;
  const contentHeight = rows * (cfg.nodeHeight + cfg.verticalGap) - cfg.verticalGap;

  let width = cfg.containerPaddingX * 2 + contentWidth;
  let height = cfg.containerPaddingTop + contentHeight + cfg.containerPaddingBottom;

  if (hasNestedContainers) {
    const ncfg = NESTED_CONTAINER_CONFIG;
    width += nestedContainerCount * (ncfg.nodeWidth + ncfg.horizontalGap);
    height = Math.max(height, ncfg.containerPaddingTop + ncfg.nodeHeight + ncfg.containerPaddingBottom);
  }

  return {
    width: Math.max(300, width),
    height: Math.max(250, height),
  };
}

export function computeAllContainerLayouts(
  graph: Graph,
  catalog?: CatalogResolver | null,
): Map<string, { positions: ChildPosition[]; sizing: ContainerSizing }> {
  const result = new Map<string, { positions: ChildPosition[]; sizing: ContainerSizing }>();

  for (const node of Object.values(graph.nodes)) {
    if (!isContainerType(node.type, catalog)) continue;
    const hasChildren = Object.values(graph.nodes).some(n => n.parentId === node.id);
    if (!hasChildren) continue;

    const layout = layoutContainerChildren(node.id, graph, catalog);
    result.set(node.id, layout);
  }

  return result;
}
