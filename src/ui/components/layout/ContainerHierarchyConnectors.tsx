import { useNodes } from '@xyflow/react';
import { useTheme } from '../../theme/ThemeContext.js';
import { getCanContainRoleIds, getContainerTypeById } from '@nodespec/core/container-types.js';
import type { Graph } from '@nodespec/core/types.js';

interface ContainerHierarchyConnectorsProps {
  graph: Graph;
}

function getLayerColor(layer?: string, mode?: 'light' | 'dark'): string {
  const isDark = mode === 'dark';
  switch (layer) {
    case 'infrastructure':
      return isDark ? '#3b82f6' : '#2563eb';
    case 'orchestration':
      return isDark ? '#8b5cf6' : '#7c3aed';
    case 'runtime':
      return isDark ? '#10b981' : '#059669';
    case 'logical':
      return isDark ? '#f59e0b' : '#d97706';
    default:
      return isDark ? '#64748b' : '#475569';
  }
}

export function ContainerHierarchyConnectors({ graph }: ContainerHierarchyConnectorsProps) {
  const { theme } = useTheme();
  const allNodes = useNodes();

  // Helper to calculate absolute position (accounting for parent offsets)
  const getAbsolutePosition = (nodeId: string): { x: number; y: number } | null => {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node) return null;

    let absX = node.position.x;
    let absY = node.position.y;
    let currentParentId = node.parentId;

    // Traverse up the parent chain and accumulate positions
    while (currentParentId) {
      const parentNode = allNodes.find(n => n.id === currentParentId);
      if (!parentNode) break;

      absX += parentNode.position.x;
      absY += parentNode.position.y;
      currentParentId = parentNode.parentId;
    }

    return { x: absX, y: absY };
  };

  // Find all parent-child container relationships
  const containerRelationships: Array<{
    parentId: string;
    childId: string;
    depth: number;
  }> = [];

  Object.values(graph.nodes).forEach(node => {
    if (node.parentId) {
      const parentNode = graph.nodes[node.parentId];
      const nodeContainerDef = getContainerTypeById(node.type);
      const parentContainerDef = parentNode ? getContainerTypeById(parentNode.type) : null;

      // Only create connectors between container nodes
      if (nodeContainerDef && parentContainerDef &&
          getCanContainRoleIds(nodeContainerDef).length > 0 &&
          getCanContainRoleIds(parentContainerDef).length > 0) {

        // Calculate nesting depth
        let depth = 1;
        let current = parentNode;
        while (current?.parentId) {
          depth++;
          current = graph.nodes[current.parentId];
        }

        containerRelationships.push({
          parentId: node.parentId,
          childId: node.id,
          depth,
        });
      }
    }
  });

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <defs>
        {/* Gradient for depth indication */}
        <linearGradient id="depthGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={theme.mode === 'dark' ? '#3b82f6' : '#2563eb'} stopOpacity="0.6" />
          <stop offset="100%" stopColor={theme.mode === 'dark' ? '#8b5cf6' : '#7c3aed'} stopOpacity="0.3" />
        </linearGradient>

        {/* Arrow marker */}
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon
            points="0 0, 10 3, 0 6"
            fill={theme.mode === 'dark' ? '#8b5cf6' : '#7c3aed'}
            opacity="0.7"
          />
        </marker>
      </defs>

      {containerRelationships.map(({ parentId, childId, depth }) => {
        const parentRFNode = allNodes.find(n => n.id === parentId);
        const childRFNode = allNodes.find(n => n.id === childId);

        if (!parentRFNode || !childRFNode) return null;

        const parentNode = graph.nodes[parentId];
        const childNode = graph.nodes[childId];

        const parentContainerDef = getContainerTypeById(parentNode.type);
        const childContainerDef = getContainerTypeById(childNode.type);

        if (!parentContainerDef || !childContainerDef) return null;

        // Check if containers are expanded
        const parentExpanded = (parentNode.metadata?.containerExpanded as boolean | undefined) ?? true;
        const childExpanded = (childNode.metadata?.containerExpanded as boolean | undefined) ?? true;

        if (!parentExpanded || !childExpanded) return null;

        const parentLayerColor = getLayerColor(parentContainerDef.layer, theme.mode);
        const childLayerColor = getLayerColor(childContainerDef.layer, theme.mode);

        // Calculate absolute positions
        const parentAbsPos = getAbsolutePosition(parentId);
        const childAbsPos = getAbsolutePosition(childId);

        if (!parentAbsPos || !childAbsPos) return null;

        const parentWidth = parentRFNode.measured?.width ?? parentRFNode.width ?? 500;
        const parentHeight = parentRFNode.measured?.height ?? parentRFNode.height ?? 400;
        const childWidth = childRFNode.measured?.width ?? childRFNode.width ?? 500;
        const childHeight = childRFNode.measured?.height ?? childRFNode.height ?? 400;

        // Only show connectors if child is positioned significantly outside parent bounds
        // This indicates an "expanded out" relationship rather than traditional nesting
        const childCenterX = childAbsPos.x + (childWidth / 2);
        const childCenterY = childAbsPos.y + (childHeight / 2);

        const parentBounds = {
          left: parentAbsPos.x,
          right: parentAbsPos.x + parentWidth,
          top: parentAbsPos.y,
          bottom: parentAbsPos.y + parentHeight,
        };

        // Child is outside if its center is outside the parent bounds with some margin
        const margin = 80;
        const childIsOutsideParent =
          childCenterX > parentBounds.right + margin ||
          childCenterX < parentBounds.left - margin ||
          childCenterY > parentBounds.bottom + margin ||
          childCenterY < parentBounds.top - margin;

        if (!childIsOutsideParent) return null;

        // Calculate connection points using absolute positions
        // Determine which edges to connect based on relative positions
        let parentX: number, parentY: number;
        let childX: number, childY: number;

        if (childCenterX > parentBounds.right) {
          // Child is to the right
          parentX = parentAbsPos.x + parentWidth;
          parentY = parentAbsPos.y + (parentHeight / 2);
          childX = childAbsPos.x;
          childY = childAbsPos.y + (childHeight / 2);
        } else if (childCenterX < parentBounds.left) {
          // Child is to the left
          parentX = parentAbsPos.x;
          parentY = parentAbsPos.y + (parentHeight / 2);
          childX = childAbsPos.x + childWidth;
          childY = childAbsPos.y + (childHeight / 2);
        } else if (childCenterY > parentBounds.bottom) {
          // Child is below
          parentX = parentAbsPos.x + (parentWidth / 2);
          parentY = parentAbsPos.y + parentHeight;
          childX = childAbsPos.x + (childWidth / 2);
          childY = childAbsPos.y;
        } else {
          // Child is above
          parentX = parentAbsPos.x + (parentWidth / 2);
          parentY = parentAbsPos.y;
          childX = childAbsPos.x + (childWidth / 2);
          childY = childAbsPos.y + childHeight;
        }

        // Create a curved path from parent to child
        const midX = (parentX + childX) / 2;
        const curveOffset = Math.min(Math.abs(childX - parentX) * 0.3, 100);

        const path = `
          M ${parentX},${parentY}
          C ${parentX + curveOffset},${parentY}
            ${childX - curveOffset},${childY}
            ${childX},${childY}
        `;

        // Calculate bracket points for visual hierarchy
        const bracketHeight = 40;
        const bracketWidth = 30;
        const bracketPath = `
          M ${parentX},${parentY - bracketHeight}
          L ${parentX + bracketWidth},${parentY - bracketHeight}
          L ${parentX + bracketWidth},${parentY + bracketHeight}
          L ${parentX},${parentY + bracketHeight}
        `;

        return (
          <g key={`${parentId}-${childId}`}>
            {/* Main connector curve */}
            <path
              d={path}
              stroke={childLayerColor}
              strokeWidth={3}
              strokeDasharray="8 4"
              fill="none"
              opacity={0.5}
              markerEnd="url(#arrowhead)"
            />

            {/* Bracket on parent side */}
            <path
              d={bracketPath}
              stroke={parentLayerColor}
              strokeWidth={2.5}
              fill="none"
              opacity={0.6}
            />

            {/* Depth indicator badge */}
            <g transform={`translate(${midX - 20}, ${(parentY + childY) / 2 - 15})`}>
              <rect
                x="0"
                y="0"
                width="40"
                height="30"
                rx="6"
                fill={theme.mode === 'dark' ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)'}
                stroke={childLayerColor}
                strokeWidth="2"
              />
              <text
                x="20"
                y="20"
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={childLayerColor}
              >
                L{depth}
              </text>
            </g>

            {/* Connection point indicators */}
            <circle
              cx={parentX}
              cy={parentY}
              r="6"
              fill={parentLayerColor}
              stroke={theme.mode === 'dark' ? '#1e293b' : '#ffffff'}
              strokeWidth="2"
            />
            <circle
              cx={childX}
              cy={childY}
              r="6"
              fill={childLayerColor}
              stroke={theme.mode === 'dark' ? '#1e293b' : '#ffffff'}
              strokeWidth="2"
            />
          </g>
        );
      })}
    </svg>
  );
}
