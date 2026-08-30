import type { SpecGraphRFNode, SpecGraphRFEdge } from '../adapters/graph-to-reactflow.js';
import { layoutContainerChildren } from './container-child-layout.js';
import type { Graph } from '@nodespec/core/types.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';

interface LayoutOptions {
  direction?: 'LR' | 'TB';
  nodeSpacing?: number;
  rankSpacing?: number;
  graph?: Graph;
  catalog?: CatalogResolver | null;
}

interface NodePosition {
  id: string;
  x: number;
  y: number;
}

export function calculateAutoLayout(
  nodes: SpecGraphRFNode[],
  edges: SpecGraphRFEdge[],
  options: LayoutOptions = {}
): NodePosition[] {
  const {
    direction = 'LR',
    nodeSpacing = 80,
    rankSpacing = 200,
    graph,
    catalog,
  } = options;

  if (nodes.length === 0) return [];

  // Separate top-level containers, nested containers, regular nodes
  const containerTypes = new Set(['container', 'group', 'logicalBoundary']);
  const topLevelContainers = nodes.filter(n => !n.parentId && containerTypes.has(n.type ?? ''));
  const topLevelNodes = nodes.filter(n => !n.parentId && !containerTypes.has(n.type ?? ''));

  // Build parent-child maps
  const childNodesMap = new Map<string, SpecGraphRFNode[]>();
  const nestedContainersMap = new Map<string, SpecGraphRFNode[]>();

  nodes.forEach(node => {
    if (node.parentId) {
      const isContainer = containerTypes.has(node.type ?? '');

      if (isContainer) {
        // This is a nested container
        const existing = nestedContainersMap.get(node.parentId) || [];
        nestedContainersMap.set(node.parentId, [...existing, node]);
      } else {
        // This is a regular node
        const existing = childNodesMap.get(node.parentId) || [];
        childNodesMap.set(node.parentId, [...existing, node]);
      }
    }
  });

  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  const relevantNodeIds = new Set(topLevelNodes.map(n => n.id));

  for (const id of relevantNodeIds) {
    adjacency.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (relevantNodeIds.has(edge.source) && relevantNodeIds.has(edge.target)) {
      adjacency.get(edge.source)?.add(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  const ranks: string[][] = [];
  const placed = new Set<string>();
  const queue: string[] = [];

  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0 || placed.size < relevantNodeIds.size) {
    const currentRank: string[] = [];

    if (queue.length === 0) {
      for (const id of relevantNodeIds) {
        if (!placed.has(id)) {
          queue.push(id);
          break;
        }
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (!placed.has(nodeId)) {
        currentRank.push(nodeId);
        placed.add(nodeId);
      }
    }

    if (currentRank.length > 0) {
      ranks.push(currentRank);
    }

    for (const nodeId of currentRank) {
      const neighbors = adjacency.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!placed.has(neighbor)) {
          const newDegree = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDegree);
          if (newDegree <= 0) {
            queue.push(neighbor);
          }
        }
      }
    }
  }

  // Reduce edge crossings by ordering nodes within each rank using the
  // barycenter heuristic (average position of connected neighbors).
  if (ranks.length > 1) {
    const predecessors = new Map<string, string[]>();
    const successors = new Map<string, string[]>();
    for (const id of relevantNodeIds) {
      predecessors.set(id, []);
      successors.set(id, []);
    }
    for (const edge of edges) {
      if (relevantNodeIds.has(edge.source) && relevantNodeIds.has(edge.target)) {
        successors.get(edge.source)?.push(edge.target);
        predecessors.get(edge.target)?.push(edge.source);
      }
    }

    const orderMaps = ranks.map(rank => new Map(rank.map((id, i) => [id, i])));

    const barycenter = (
      neighborOrder: Map<string, number>,
      neighbors: string[],
      fallback: number
    ): number => {
      const vals = neighbors
        .map(n => neighborOrder.get(n))
        .filter((v): v is number => v !== undefined);
      if (vals.length === 0) return fallback;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const SWEEPS = 4;
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      for (let ri = 1; ri < ranks.length; ri++) {
        const prevOrder = orderMaps[ri - 1];
        const scored = ranks[ri].map((id, i) => ({
          id,
          key: barycenter(prevOrder, predecessors.get(id) || [], i),
        }));
        scored.sort((a, b) => a.key - b.key);
        ranks[ri] = scored.map(s => s.id);
        orderMaps[ri] = new Map(ranks[ri].map((id, i) => [id, i]));
      }
      for (let ri = ranks.length - 2; ri >= 0; ri--) {
        const nextOrder = orderMaps[ri + 1];
        const scored = ranks[ri].map((id, i) => ({
          id,
          key: barycenter(nextOrder, successors.get(id) || [], i),
        }));
        scored.sort((a, b) => a.key - b.key);
        ranks[ri] = scored.map(s => s.id);
        orderMaps[ri] = new Map(ranks[ri].map((id, i) => [id, i]));
      }
    }
  }

  const positions: NodePosition[] = [];
  const nodeWidthEstimate = 200;
  const nodeHeightEstimate = 100;

  let containerX = 100;
  const containerY = 100;
  const containerPadding = 100; // Generous padding for visual breathing room
  const headerHeight = 90; // Space for container header
  const containerSpacing = 300;
  const nestedContainerOffset = 200; // Horizontal offset for nested containers

  // Helper function to recursively position containers and their children
  function positionContainer(
    container: SpecGraphRFNode,
    x: number,
    y: number,
    depth: number = 0
  ): number {
    const children = childNodesMap.get(container.id) || [];
    const nestedContainers = nestedContainersMap.get(container.id) || [];
    const containerWidth = (container.width as number) || 500;
    const containerHeight = (container.height as number) || 400;

    // Position the container itself
    positions.push({
      id: container.id,
      x,
      y,
    });

    if ((children.length > 0 || nestedContainers.length > 0) && graph) {
      const flowLayout = layoutContainerChildren(container.id, graph, catalog);
      for (const pos of flowLayout.positions) {
        positions.push(pos);
      }
    } else if (children.length > 0) {
      const childCols = Math.min(Math.ceil(Math.sqrt(children.length)), 2);
      const childRows = Math.ceil(children.length / childCols);

      const availableWidth = containerWidth - (containerPadding * 2);
      const availableHeight = containerHeight - headerHeight - containerPadding;

      const minSpacing = 60;
      const childSpacingX = Math.max(availableWidth / childCols, nodeWidthEstimate + minSpacing);
      const childSpacingY = Math.max(availableHeight / childRows, nodeHeightEstimate + minSpacing);

      children.forEach((child, i) => {
        const col = i % childCols;
        const row = Math.floor(i / childCols);

        positions.push({
          id: child.id,
          x: containerPadding + col * childSpacingX + (childSpacingX - nodeWidthEstimate) / 2,
          y: headerHeight + row * childSpacingY + (childSpacingY - nodeHeightEstimate) / 2,
        });
      });
    }

    if (!graph) {
      let nestedY = y;
      nestedContainers.forEach((nestedContainer) => {
        const nestedX = x + containerWidth + nestedContainerOffset;
        const nestedHeight = positionContainer(nestedContainer, nestedX, nestedY, depth + 1);
        nestedY += nestedHeight + 100;
      });
    }

    // Return the height consumed by this container and its nested containers
    const totalNestedHeight = nestedContainers.reduce((sum, nc) => {
      return sum + ((nc.height as number) || 400) + 100;
    }, 0);

    return Math.max(containerHeight, totalNestedHeight);
  }

  // Position all top-level containers
  for (const container of topLevelContainers) {
    positionContainer(container, containerX, containerY);
    const containerWidth = (container.width as number) || 500;
    containerX += containerWidth + containerSpacing; // Generous spacing to reduce clutter
  }

  const topLevelStartX = topLevelContainers.length > 0 ? containerX : 50;
  const topLevelStartY = 50;

  if (direction === 'LR') {
    ranks.forEach((rank, rankIndex) => {
      const rankX = topLevelStartX + rankIndex * rankSpacing;
      const rankHeight = rank.length * (nodeHeightEstimate + nodeSpacing);
      const startY = topLevelStartY + (topLevelContainers.length > 0 ? 0 : -rankHeight / 2 + 200);

      rank.forEach((nodeId, nodeIndex) => {
        positions.push({
          id: nodeId,
          x: rankX,
          y: startY + nodeIndex * (nodeHeightEstimate + nodeSpacing),
        });
      });
    });
  } else {
    ranks.forEach((rank, rankIndex) => {
      const rankY = topLevelStartY + rankIndex * rankSpacing;
      const rankWidth = rank.length * (nodeWidthEstimate + nodeSpacing);
      const startX = topLevelStartX + 200 - rankWidth / 2;

      rank.forEach((nodeId, nodeIndex) => {
        positions.push({
          id: nodeId,
          x: startX + nodeIndex * (nodeWidthEstimate + nodeSpacing),
          y: rankY,
        });
      });
    });
  }

  return positions;
}
