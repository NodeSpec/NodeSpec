import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { NodeResizer, useReactFlow } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { NodeIcon } from '../common/index.js';

interface ContainerVisualNodeProps {
  data: RFNodeData;
  selected?: boolean;
  id: string;
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

function ContainerVisualNodeComponent({ data, selected, id }: ContainerVisualNodeProps) {
  const { theme } = useTheme();
  const reactFlowInstance = useReactFlow();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const metadataSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const containerDef = getContainerTypeById(data.nodeType);
  const layerColor = getLayerColor(containerDef?.layer, theme.mode);

  useEffect(() => {
    return () => {
      if (metadataSaveTimerRef.current) {
        clearTimeout(metadataSaveTimerRef.current);
        metadataSaveTimerRef.current = null;
      }
    };
  }, []);

  const debouncedMetadataSave = useCallback(
    (updates: Record<string, unknown>) => {
      if (metadataSaveTimerRef.current) {
        clearTimeout(metadataSaveTimerRef.current);
      }

      metadataSaveTimerRef.current = setTimeout(() => {
        console.log('[ContainerVisualNode] Saving debounced metadata:', {
          nodeId: id,
          updates,
        });

        if (data.onUpdateMetadata && Object.keys(updates).length > 0) {
          data.onUpdateMetadata(updates);
        }

        metadataSaveTimerRef.current = null;
      }, 300);
    },
    [data, id]
  );

  const handleResize = useCallback(
    (_event: unknown, params: { width?: number; height?: number }) => {
      if (!params.width || !params.height) {
        console.warn('[ContainerVisualNode] Resize event missing dimensions:', params);
        return;
      }

      if (params.width <= 0 || params.height <= 0) {
        console.error('[ContainerVisualNode] Invalid resize dimensions:', params);
        return;
      }

      console.log('[ContainerVisualNode] Manual resize (UI update only):', {
        nodeId: id,
        newDimensions: { width: params.width, height: params.height },
      });

      debouncedMetadataSave({
        width: params.width,
        height: params.height,
      });
    },
    [id, debouncedMetadataSave]
  );

  const handleToggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const node = reactFlowInstance.getNode(id);
      if (!node) {
        console.error('[ContainerVisualNode] Cannot toggle: node not found');
        return;
      }

      const currentWidth = node.width ?? 600;
      const currentHeight = node.height ?? 400;

      console.log('[ContainerVisualNode] Collapsing container:', {
        nodeId: id,
        currentDimensions: { width: currentWidth, height: currentHeight },
      });

      setIsTransitioning(true);

      const updates = {
        containerExpanded: false,
        width: currentWidth,
        height: currentHeight,
      };

      if (data.onUpdateMetadata) {
        data.onUpdateMetadata(updates);
      }

      reactFlowInstance.updateNode(id, {
        width: 150,
        height: 150,
      });

      setTimeout(() => {
        setIsTransitioning(false);
      }, 100);
    },
    [id, data, reactFlowInstance]
  );

  const childCount = (data.metadata?.childCount as number) ?? 0;

  const containerStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    padding: '48px 24px 24px 24px',
    borderRadius: '16px',
    border: `4px solid ${layerColor}`,
    backgroundColor: theme.mode === 'dark' ? 'rgba(55, 62, 85, 0.6)' : 'rgba(241, 245, 249, 0.6)',
    color: theme.colors.text,
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    backdropFilter: 'blur(8px)',
    boxShadow: selected
      ? `0 0 0 4px ${theme.colors.primary}40, 0 12px 32px rgba(0, 0, 0, 0.16)`
      : '0 6px 16px rgba(0, 0, 0, 0.10)',
    transition: isTransitioning ? 'none' : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    pointerEvents: 'auto',
    cursor: 'move',
  };

  const borderLabelStyles: React.CSSProperties = {
    position: 'absolute',
    top: '-2px',
    left: '20px',
    fontSize: '13px',
    fontWeight: 700,
    padding: '6px 16px',
    borderRadius: '8px 8px 0 0',
    backgroundColor: layerColor,
    color: '#ffffff',
    letterSpacing: '0.3px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
    zIndex: 10,
  };

  const layerBadgeStyles: React.CSSProperties = {
    position: 'absolute',
    top: '-2px',
    right: '20px',
    fontSize: '10px',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '8px 8px 0 0',
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
    color: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    border: `1px solid ${layerColor}`,
    borderBottom: 'none',
  };

  const collapseButtonStyles: React.CSSProperties = {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    border: `2px solid ${layerColor}`,
    backgroundColor: theme.mode === 'dark' ? 'rgba(55, 62, 85, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    color: layerColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 700,
    transition: 'all 0.2s ease',
    zIndex: 11000,
    pointerEvents: 'auto',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
  };

  const childCountBadgeStyles: React.CSSProperties = {
    position: 'absolute',
    bottom: '12px',
    right: '12px',
    fontSize: '11px',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '12px',
    backgroundColor: layerColor,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        shouldResize={() => true}
        minWidth={250}
        minHeight={200}
        maxWidth={2000}
        maxHeight={2000}
        keepAspectRatio={false}
        color={layerColor}
        onResize={handleResize}
        handleStyle={{
          width: '16px',
          height: '16px',
          borderRadius: '4px',
          backgroundColor: '#ffffff',
          border: `2px solid ${layerColor}`,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        }}
        lineStyle={{
          borderColor: `${layerColor}80`,
          borderWidth: '2px',
          borderStyle: 'solid',
        }}
      />
      <div style={containerStyles}>
        <div style={borderLabelStyles}>
          <NodeIcon
            nodeType={data.nodeType}
            technology={data.technology}
            emojiIcon={containerDef?.icon}
            size={14}
            position="center"
          />
          <span>{data.label}</span>
        </div>

        {containerDef?.layer && (
          <div style={layerBadgeStyles}>
            {containerDef.layer} layer
          </div>
        )}

        <button
          type="button"
          style={collapseButtonStyles}
          onClick={handleToggleCollapse}
          title="Collapse container"
          className="nodrag nopan"
        >
          −
        </button>

        {childCount > 0 && (
          <div style={childCountBadgeStyles}>
            <span>📦</span>
            <span>{childCount}</span>
          </div>
        )}
      </div>
    </>
  );
}

ContainerVisualNodeComponent.displayName = 'ContainerVisualNode';

export const ContainerVisualNode = memo(ContainerVisualNodeComponent);
