/**
 * Visual enhancements for container nodes to improve clarity when multiple nested containers are present
 * These are purely frontend display improvements that don't affect the underlying data structure
 */

import type { SpecGraphRFNode } from '../adapters/graph-to-reactflow.js';

export interface VisualEnhancement {
  opacity: number;
  scale: number;
  zIndex: number;
  blur: number;
  offset: { x: number; y: number };
}

/**
 * Calculate visual enhancements based on selection state and nesting depth
 */
export function calculateContainerVisualEnhancements(
  nodes: SpecGraphRFNode[],
  selectedNodeIds: Set<string>
): Map<string, VisualEnhancement> {
  const enhancements = new Map<string, VisualEnhancement>();

  // Find all container nodes
  const containerNodes = nodes.filter(
    n => n.type === 'container' || n.type === 'group'
  );

  // If nothing selected, show everything normally
  if (selectedNodeIds.size === 0) {
    containerNodes.forEach(node => {
      enhancements.set(node.id, {
        opacity: 1,
        scale: 1,
        zIndex: getDepthZIndex(node, nodes),
        blur: 0,
        offset: { x: 0, y: 0 },
      });
    });
    return enhancements;
  }

  // Build parent-child relationships
  const selectedWithAncestors = new Set(selectedNodeIds);
  const selectedWithDescendants = new Set(selectedNodeIds);

  // Add all ancestors of selected nodes
  selectedNodeIds.forEach(id => {
    let current = nodes.find(n => n.id === id);
    while (current?.parentId) {
      selectedWithAncestors.add(current.parentId);
      current = nodes.find(n => n.id === current!.parentId);
    }
  });

  // Add all descendants of selected nodes
  function addDescendants(nodeId: string) {
    nodes.forEach(node => {
      if (node.parentId === nodeId) {
        selectedWithDescendants.add(node.id);
        addDescendants(node.id);
      }
    });
  }

  selectedNodeIds.forEach(id => addDescendants(id));

  // Apply visual enhancements
  containerNodes.forEach(node => {
    const isSelected = selectedNodeIds.has(node.id);
    const isAncestor = selectedWithAncestors.has(node.id) && !isSelected;
    const isDescendant = selectedWithDescendants.has(node.id) && !isSelected;

    // Calculate depth-based z-index
    const baseZIndex = getDepthZIndex(node, nodes);

    if (isSelected) {
      // Selected containers: full opacity, slight emphasis
      enhancements.set(node.id, {
        opacity: 1,
        scale: 1,
        zIndex: baseZIndex + 1000, // Bring to front
        blur: 0,
        offset: { x: 0, y: 0 },
      });
    } else if (isAncestor) {
      // Ancestor containers: slightly dimmed but visible
      enhancements.set(node.id, {
        opacity: 0.7,
        scale: 1,
        zIndex: baseZIndex + 500,
        blur: 0,
        offset: { x: 0, y: 0 },
      });
    } else if (isDescendant) {
      // Descendant containers: highlighted
      enhancements.set(node.id, {
        opacity: 0.9,
        scale: 1,
        zIndex: baseZIndex + 800,
        blur: 0,
        offset: { x: 0, y: 0 },
      });
    } else {
      // Unrelated containers: significantly dimmed
      enhancements.set(node.id, {
        opacity: 0.25,
        scale: 0.98,
        zIndex: baseZIndex - 100,
        blur: 1,
        offset: { x: 0, y: 0 },
      });
    }
  });

  return enhancements;
}

/**
 * Calculate z-index based on nesting depth (deeper = higher z-index)
 */
function getDepthZIndex(node: SpecGraphRFNode, allNodes: SpecGraphRFNode[]): number {
  let depth = 0;
  let current = node;

  while (current.parentId) {
    depth++;
    const parent = allNodes.find(n => n.id === current.parentId);
    if (!parent) break;
    current = parent;
  }

  // Base z-index of 1, with 10 per depth level
  // Top-level containers: z-index 1
  // First level nested: z-index 11
  // Second level nested: z-index 21, etc.
  return 1 + (depth * 10);
}

/**
 * Calculate improved spacing for containers based on nesting and relationships
 */
export function calculateImprovedContainerSpacing(
  nodes: SpecGraphRFNode[]
): Map<string, { x: number; y: number }> {
  const adjustments = new Map<string, { x: number; y: number }>();

  // Group containers by nesting level
  const containersByLevel = new Map<number, SpecGraphRFNode[]>();

  nodes
    .filter(n => n.type === 'container' || n.type === 'group')
    .forEach(node => {
      const depth = getNodeDepth(node, nodes);
      const containers = containersByLevel.get(depth) || [];
      containers.push(node);
      containersByLevel.set(depth, containers);
    });

  // Apply cascading offsets based on depth
  nodes.forEach(node => {
    if (node.type !== 'container' && node.type !== 'group') {
      adjustments.set(node.id, { x: 0, y: 0 });
      return;
    }

    const depth = getNodeDepth(node, nodes);

    // Add subtle cascade effect for nested containers
    const cascadeOffset = depth * 20;

    adjustments.set(node.id, {
      x: cascadeOffset,
      y: cascadeOffset,
    });
  });

  return adjustments;
}

function getNodeDepth(node: SpecGraphRFNode, allNodes: SpecGraphRFNode[]): number {
  let depth = 0;
  let current = node;

  while (current.parentId) {
    depth++;
    const parent = allNodes.find(n => n.id === current.parentId);
    if (!parent) break;
    current = parent;
  }

  return depth;
}

/**
 * Get improved container dimensions that reduce clutter
 */
export function getOptimizedContainerSize(
  node: SpecGraphRFNode,
  childCount: number
): { width: number; height: number } {
  // If user has set custom dimensions, respect them
  const customWidth = node.measured?.width || node.width;
  const customHeight = node.measured?.height || node.height;

  if (customWidth && customHeight) {
    return {
      width: customWidth as number,
      height: customHeight as number,
    };
  }

  // Otherwise calculate smart defaults based on child count
  const baseWidth = 400;
  const baseHeight = 300;

  if (childCount === 0) {
    return {
      width: baseWidth,
      height: baseHeight * 0.8, // Smaller for empty containers
    };
  }

  // Calculate size based on children in a grid layout
  const cols = Math.min(Math.ceil(Math.sqrt(childCount)), 3);
  const rows = Math.ceil(childCount / cols);

  const nodeWidth = 180;
  const nodeHeight = 100;
  const padding = 80;
  const spacing = 40;

  return {
    width: Math.max(baseWidth, (nodeWidth * cols) + (spacing * (cols - 1)) + (padding * 2)),
    height: Math.max(baseHeight, (nodeHeight * rows) + (spacing * (rows - 1)) + padding + 80),
  };
}
