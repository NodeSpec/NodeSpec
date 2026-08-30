import { useReactFlow } from '@xyflow/react';
import { useTheme } from '../../theme/ThemeContext.js';
import { getCanContainRoleIds, getContainerTypeById } from '@nodespec/core/container-types.js';
import type { Graph } from '@nodespec/core/types.js';

interface ContainerLayerProps {
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

export function ContainerLayer({ graph }: ContainerLayerProps) {
  const { theme } = useTheme();
  const reactFlowInstance = useReactFlow();

  // Get selected nodes to apply visual enhancements
  const selectedNodeIds = new Set(
    reactFlowInstance.getNodes()
      .filter(n => n.selected)
      .map(n => n.id)
  );

  // Find all container nodes that are expanded
  const containerNodes = Object.values(graph.nodes).filter(node => {
    const containerDef = getContainerTypeById(node.type);
    if (!containerDef || getCanContainRoleIds(containerDef).length === 0) {
      return false;
    }

    // Only render expanded containers
    const isExpanded = (node.metadata?.containerExpanded as boolean | undefined) ?? true;
    return isExpanded;
  });

  return (
    <>
      {containerNodes.map(container => {
        const rfNode = reactFlowInstance.getNode(container.id);
        if (!rfNode) return null;

        const containerDef = getContainerTypeById(container.type);
        if (!containerDef) return null;

        const layerColor = getLayerColor(containerDef.layer, theme.mode);
        const isDraft = container.status === 'draft' || container.status === undefined;
        const isLogicalBoundary = containerDef.containerStyle === 'logical-boundary';

        const width = rfNode.width ?? 600;
        const height = rfNode.height ?? 400;

        const strokeWidth = isLogicalBoundary ? 2 : 4;
        const borderRadius = isLogicalBoundary ? 12 : 16;
        const padding = 20;

        // Calculate child count for display
        const childCount = Object.values(graph.nodes).filter(n => n.parentId === container.id).length;

        // Calculate opacity based on selection state
        let opacity = 1;
        if (selectedNodeIds.size > 0) {
          const isSelected = selectedNodeIds.has(container.id);
          const isAncestorOfSelected = Array.from(selectedNodeIds).some(selectedId => {
            let current = graph.nodes[selectedId];
            while (current?.parentId) {
              if (current.parentId === container.id) return true;
              current = graph.nodes[current.parentId];
            }
            return false;
          });
          const isDescendantOfSelected = (() => {
            let current = container;
            while (current?.parentId) {
              if (selectedNodeIds.has(current.parentId)) return true;
              current = graph.nodes[current.parentId];
            }
            return false;
          })();

          if (isSelected) {
            opacity = 1;
          } else if (isAncestorOfSelected || isDescendantOfSelected) {
            opacity = 0.8;
          } else {
            opacity = 0.3;
          }
        }

        return (
          <div
            key={container.id}
            className="react-flow__node-default"
            style={{
              position: 'absolute',
              left: rfNode.position.x,
              top: rfNode.position.y,
              width,
              height,
              padding: '48px 24px 24px 24px',
              borderRadius: borderRadius,
              border: (isDraft || isLogicalBoundary) ? `${strokeWidth}px dashed ${layerColor}` : `${strokeWidth}px solid ${layerColor}`,
              backgroundColor: isLogicalBoundary
                ? (theme.mode === 'dark' ? 'rgba(30, 41, 59, 0.2)' : 'rgba(241, 245, 249, 0.35)')
                : (theme.mode === 'dark' ? 'rgba(30, 41, 59, 0.4)' : 'rgba(241, 245, 249, 0.6)'),
              backdropFilter: opacity < 1 ? 'blur(4px)' : (isLogicalBoundary ? 'none' : 'blur(8px)'),
              pointerEvents: 'none',
              zIndex: 0,
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.10)',
              opacity,
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: opacity < 1 ? 'scale(0.98)' : 'scale(1)',
            }}
          >
            {/* Top label bar */}
            <div
              style={{
                position: 'absolute',
                top: -2,
                left: padding,
                fontSize: 13,
                fontWeight: 700,
                padding: '6px 16px',
                borderRadius: '8px 8px 0 0',
                backgroundColor: layerColor,
                color: '#ffffff',
                letterSpacing: '0.3px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                zIndex: 10,
              }}
            >
              <span>{containerDef.icon}</span>
              <span>{container.label}</span>
            </div>

            {/* Layer badge (top right) */}
            <div
              style={{
                position: 'absolute',
                top: -2,
                right: padding,
                fontSize: 10,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: '8px 8px 0 0',
                backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
                color: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                border: `1px solid ${layerColor}`,
                borderBottom: 'none',
              }}
            >
              {isLogicalBoundary ? 'boundary' : containerDef.layer}
            </div>

            {/* Child count badge (bottom right) */}
            {childCount > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  right: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 12,
                  backgroundColor: layerColor,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>📦</span>
                <span>{childCount}</span>
              </div>
            )}

            {/* Draft badge */}
            {isDraft && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 12,
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '4px 8px',
                  borderRadius: 6,
                  backgroundColor: theme.mode === 'dark' ? '#fef3c7' : '#fef3c7',
                  color: theme.mode === 'dark' ? '#d97706' : '#d97706',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  border: `1px solid ${theme.mode === 'dark' ? '#fcd34d' : '#f59e0b'}`,
                }}
              >
                DRAFT
              </div>
            )}

            {/* Description */}
            {containerDef.description && containerDef.description.length < 100 && (
              <div
                style={{
                  fontSize: 12,
                  color: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
                  marginTop: isDraft ? 40 : 8,
                  lineHeight: '1.5',
                }}
              >
                {containerDef.description}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
