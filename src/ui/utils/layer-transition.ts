import type { Graph } from '@nodespec/core/types.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import type { SpecGraphRFNode, SpecGraphRFEdge, ArchitectureLayerMode } from '../adapters/graph-to-reactflow.js';
import { isContainerType, isLogicalBoundaryType } from '../adapters/rf-visual-type-resolver.js';
import { computeAllContainerLayouts, layoutContainerChildren } from './container-child-layout.js';
import { calculateAutoLayout } from './auto-layout.js';
import { saveModePositions, loadModePositions, hasModePositions, type CachedPosition } from './mode-position-cache.js';

export type TransitionPhase =
  | 'idle'
  | 'entering-nested'
  | 'exiting-nested';

export const ENTER_DURATION_MS = 300;
export const EXIT_DURATION_MS = 250;
export const SETTLE_DELAY_MS = 80;

export interface TransitionPlan {
  targetMode: ArchitectureLayerMode;
  phase: TransitionPhase;
  targetPositions: Map<string, CachedPosition>;
  containerIds: Set<string>;
}

export function snapshotCurrentPositions(
  nodes: SpecGraphRFNode[],
  localPositions: Map<string, { x: number; y: number }>,
): Map<string, CachedPosition> {
  const snapshot = new Map<string, CachedPosition>();
  for (const node of nodes) {
    const pos = localPositions.get(node.id) ?? node.position;
    snapshot.set(node.id, { x: pos.x, y: pos.y });
  }
  return snapshot;
}

export function identifyContainerIds(
  graph: Graph,
  catalog?: CatalogResolver | null,
): Set<string> {
  const ids = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (isContainerType(node.type, catalog)) {
      ids.add(node.id);
    }
  }
  return ids;
}

export function planFlatToNested(
  graph: Graph,
  catalog: CatalogResolver | null,
  currentNodes: SpecGraphRFNode[],
  _currentEdges: SpecGraphRFEdge[],
  currentPositions: Map<string, { x: number; y: number }>,
): TransitionPlan {
  saveModePositions('flat', snapshotCurrentPositions(currentNodes, currentPositions));

  let targetPositions: Map<string, CachedPosition>;

  if (hasModePositions('nested')) {
    targetPositions = loadModePositions('nested');
    const currentNodeIds = new Set(currentNodes.map(n => n.id));
    for (const id of targetPositions.keys()) {
      if (!currentNodeIds.has(id)) targetPositions.delete(id);
    }

    const allLayouts = computeAllContainerLayouts(graph, catalog);
    for (const [, layout] of allLayouts) {
      for (const pos of layout.positions) {
        targetPositions.set(pos.id, { x: pos.x, y: pos.y });
      }
    }
  } else {
    targetPositions = new Map(currentPositions);
    const allLayouts = computeAllContainerLayouts(graph, catalog);
    for (const [, layout] of allLayouts) {
      for (const pos of layout.positions) {
        targetPositions.set(pos.id, { x: pos.x, y: pos.y });
      }
    }
  }

  return {
    targetMode: 'nested',
    phase: 'entering-nested',
    targetPositions,
    containerIds: identifyContainerIds(graph, catalog),
  };
}

function applyLogicalBoundaryChildLayouts(
  graph: Graph,
  catalog: CatalogResolver | null,
  positions: Map<string, CachedPosition>,
): void {
  for (const node of Object.values(graph.nodes)) {
    if (!isLogicalBoundaryType(node.type, catalog)) continue;
    const hasChildren = Object.values(graph.nodes).some(n => n.parentId === node.id);
    if (!hasChildren) continue;

    const layout = layoutContainerChildren(node.id, graph, catalog);
    for (const pos of layout.positions) {
      positions.set(pos.id, { x: pos.x, y: pos.y });
    }
  }
}

export function planNestedToFlat(
  graph: Graph,
  catalog: CatalogResolver | null,
  currentNodes: SpecGraphRFNode[],
  currentEdges: SpecGraphRFEdge[],
  currentPositions: Map<string, { x: number; y: number }>,
): TransitionPlan {
  saveModePositions('nested', snapshotCurrentPositions(currentNodes, currentPositions));

  let targetPositions: Map<string, CachedPosition>;

  if (hasModePositions('flat')) {
    targetPositions = loadModePositions('flat');
    const currentNodeIds = new Set(currentNodes.map(n => n.id));
    for (const id of targetPositions.keys()) {
      if (!currentNodeIds.has(id)) targetPositions.delete(id);
    }

    for (const node of currentNodes) {
      if (!targetPositions.has(node.id)) {
        const pos = currentPositions.get(node.id) ?? node.position;
        targetPositions.set(node.id, { x: pos.x, y: pos.y });
      }
    }
  } else {
    const visibleFlatNodes = currentNodes.filter(n => {
      if (isLogicalBoundaryType(n.data.nodeType, catalog)) return true;
      return !isContainerType(n.data.nodeType, catalog);
    });
    const flatLayout = calculateAutoLayout(visibleFlatNodes, currentEdges, {
      direction: 'LR',
      graph,
      catalog,
    });

    targetPositions = new Map<string, CachedPosition>();
    for (const pos of flatLayout) {
      targetPositions.set(pos.id, { x: pos.x, y: pos.y });
    }

    const containerIds = identifyContainerIds(graph, catalog);
    for (const node of currentNodes) {
      if (containerIds.has(node.id) && !targetPositions.has(node.id)) {
        const pos = currentPositions.get(node.id) ?? node.position;
        targetPositions.set(node.id, { x: pos.x, y: pos.y });
      }
    }
  }

  applyLogicalBoundaryChildLayouts(graph, catalog, targetPositions);

  return {
    targetMode: 'flat',
    phase: 'exiting-nested',
    targetPositions,
    containerIds: identifyContainerIds(graph, catalog),
  };
}
