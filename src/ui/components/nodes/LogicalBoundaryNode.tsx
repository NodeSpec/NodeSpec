import { memo, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, NodeResizer, useStore } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { NodeIcon } from '../common/index.js';
import { ContainerConnectionBadge } from './ContainerConnectionBadge.js';

interface LogicalBoundaryNodeProps {
  data: RFNodeData;
  selected?: boolean;
  id: string;
}

function LogicalBoundaryNodeComponent({ data, selected, id }: LogicalBoundaryNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';

  const metadataSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMetadataUpdatesRef = useRef<Record<string, unknown>>({});

  const node = useStore((state) => {
    const nodes = state.nodes || [];
    return nodes.find(n => n.id === id);
  });

  useEffect(() => {
    return () => {
      if (metadataSaveTimerRef.current) {
        clearTimeout(metadataSaveTimerRef.current);
        metadataSaveTimerRef.current = null;
      }
    };
  }, []);

  const debouncedMetadataSave = useCallback((updates: Record<string, unknown>) => {
    pendingMetadataUpdatesRef.current = {
      ...pendingMetadataUpdatesRef.current,
      ...updates,
    };
    if (metadataSaveTimerRef.current) {
      clearTimeout(metadataSaveTimerRef.current);
    }
    metadataSaveTimerRef.current = setTimeout(() => {
      const batchedUpdates = { ...pendingMetadataUpdatesRef.current };
      if (data.onUpdateMetadata && Object.keys(batchedUpdates).length > 0) {
        data.onUpdateMetadata(batchedUpdates);
      }
      pendingMetadataUpdatesRef.current = {};
      metadataSaveTimerRef.current = null;
    }, 300);
  }, [data]);

  const handleResize = useCallback(
    (_event: unknown, params: { width?: number; height?: number }) => {
      if (!params.width || !params.height || params.width <= 0 || params.height <= 0) return;
      debouncedMetadataSave({ width: params.width, height: params.height });
    },
    [debouncedMetadataSave]
  );

  const isExpanded = (data.metadata?.containerExpanded as boolean | undefined) ?? true;
  const isCollapsed = !isExpanded;

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!data.onUpdateMetadata || !node) return;

    if (isExpanded) {
      const currentWidth = node.width ?? 400;
      const currentHeight = node.height ?? 300;
      data.onUpdateMetadata({
        containerExpanded: false,
        width: currentWidth,
        height: currentHeight,
      });
    } else {
      data.onUpdateMetadata({ containerExpanded: true });
    }
  }, [data, isExpanded, node]);

  const containerDef = getContainerTypeById(data.nodeType);
  const childCount = (data.metadata?.childCount as number) ?? 0;
  const accentColor = isDark ? '#64748b' : '#94a3b8';
  const isDropTarget = data.isDropTarget || false;
  const DROP_TARGET_COLOR = '#22c55e';

  const currentTransitionPhase = data.transitionPhase ?? 'idle';
  const isEntering = currentTransitionPhase === 'entering-nested';
  const isExiting = currentTransitionPhase === 'exiting-nested';
  const transitionAnimationName = isEntering ? 'containerEnter' : isExiting ? 'containerExit' : 'none';
  const transitionDuration = isEntering ? '300ms' : isExiting ? '250ms' : '0ms';

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  if (isCollapsed) {
    return (
      <div style={{
        width: '220px',
        height: '56px',
        padding: '10px 16px',
        borderRadius: '28px',
        border: isDropTarget
          ? `2px solid ${DROP_TARGET_COLOR}`
          : `1.5px dashed ${selected ? c.primary : accentColor}`,
        backgroundColor: isDark ? 'rgba(55, 62, 85, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        position: 'relative',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.25s ease',
        boxShadow: selected
          ? `0 0 0 3px ${c.primary}25`
          : `0 1px 4px rgba(0, 0, 0, ${isDark ? '0.3' : '0.08'})`,
        pointerEvents: 'auto',
        animationName: transitionAnimationName,
        animationDuration: transitionDuration,
        animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
        animationFillMode: 'both',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          flex: 1,
          minWidth: 0,
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: c.text,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <NodeIcon
              nodeType={data.nodeType}
              technology={data.technology}
              emojiIcon={containerDef?.icon}
              size={12}
              position="center"
            />
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{data.label}</span>
          </div>
          {childCount > 0 && (
            <div style={{ fontSize: '9px', fontWeight: 500, color: c.textMuted, paddingLeft: '18px' }}>
              {childCount} {childCount === 1 ? 'member' : 'members'}
            </div>
          )}
        </div>

        <button
          type="button"
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            border: `1.5px dashed ${accentColor}60`,
            backgroundColor: isDark ? 'rgba(50, 56, 78, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            color: accentColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            transition: 'all 0.15s ease',
            zIndex: 11000,
            pointerEvents: 'auto',
            flexShrink: 0,
          }}
          onClick={(e) => { e.stopPropagation(); handleToggleExpand(e); }}
          title="Expand boundary"
          className="nodrag nopan"
        >
          +
        </button>

        {inputPorts.map((port) => (
          <Handle
            key={port.id}
            type="target"
            position={Position.Left}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: accentColor,
              border: `2px solid ${isDark ? '#1e293b' : '#ffffff'}`,
              top: '50%',
            }}
          />
        ))}

        {outputPorts.map((port) => (
          <Handle
            key={port.id}
            type="source"
            position={Position.Right}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: accentColor,
              border: `2px solid ${isDark ? '#1e293b' : '#ffffff'}`,
              top: '50%',
            }}
          />
        ))}
      </div>
    );
  }

  const wrapperStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minWidth: '300px',
    minHeight: '180px',
    padding: '40px 20px 20px 20px',
    borderRadius: '10px',
    border: isDropTarget
      ? `2px solid ${DROP_TARGET_COLOR}`
      : `1.5px dashed ${selected ? c.primary : accentColor}`,
    backgroundColor: isDropTarget
      ? (isDark ? 'rgba(34, 197, 94, 0.04)' : 'rgba(34, 197, 94, 0.03)')
      : (isDark ? 'rgba(148, 163, 184, 0.04)' : 'rgba(148, 163, 184, 0.03)'),
    position: 'relative',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    boxShadow: isDropTarget
      ? `0 0 0 3px ${DROP_TARGET_COLOR}30`
      : selected
        ? `0 0 0 3px ${c.primary}25`
        : 'none',
    pointerEvents: 'auto',
    animationName: transitionAnimationName,
    animationDuration: transitionDuration,
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    animationFillMode: 'both',
  };

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={300}
        minHeight={180}
        maxWidth={2000}
        maxHeight={1800}
        keepAspectRatio={false}
        color={accentColor}
        onResize={(event, params) => handleResize(event, params)}
        handleStyle={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: isDark ? '#1e293b' : '#ffffff',
          border: `2px solid ${accentColor}`,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
          pointerEvents: 'auto',
          cursor: 'nwse-resize',
        }}
        lineStyle={{
          borderColor: `${accentColor}40`,
          borderWidth: '1px',
          borderStyle: 'dashed',
          pointerEvents: 'none',
        }}
      />
      <div style={wrapperStyles}>
        <div style={{
          position: 'absolute',
          top: '-1px',
          left: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: 600,
          color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.55)',
          backgroundColor: isDark ? 'rgba(55, 62, 85, 0.95)' : 'rgba(255, 255, 255, 0.92)',
          border: `1px solid ${accentColor}40`,
          borderRadius: '0 0 6px 6px',
          letterSpacing: '0.2px',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <NodeIcon
            nodeType={data.nodeType}
            technology={data.technology}
            emojiIcon={containerDef?.icon}
            size={12}
            position="center"
          />
          <span>{data.label}</span>
        </div>

        <div style={{
          position: 'absolute',
          top: '6px',
          right: '40px',
          fontSize: '8px',
          fontWeight: 600,
          padding: '2px 6px',
          color: accentColor,
          backgroundColor: isDark ? 'rgba(55, 62, 85, 0.85)' : 'rgba(255, 255, 255, 0.85)',
          border: `1px solid ${accentColor}30`,
          borderRadius: '3px',
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          {containerDef?.label || data.nodeTypeLabel || 'boundary'}
        </div>

        <button
          type="button"
          style={{
            position: 'absolute',
            top: '4px',
            right: '8px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: `1.5px dashed ${accentColor}60`,
            backgroundColor: isDark ? 'rgba(50, 56, 78, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            color: accentColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            transition: 'all 0.15s ease',
            zIndex: 11000,
            pointerEvents: 'auto',
          }}
          onClick={(e) => { e.stopPropagation(); handleToggleExpand(e); }}
          title="Collapse boundary"
          className="nodrag nopan"
        >
          {'\u2212'}
        </button>

        {childCount > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '6px',
            right: '10px',
            fontSize: '9px',
            fontWeight: 500,
            color: c.textMuted,
            opacity: 0.6,
          }}>
            {childCount} {childCount === 1 ? 'member' : 'members'}
          </div>
        )}

        {data.layerMode === 'nested' && data.crossContainerSummaries && data.crossContainerSummaries.length > 0 && (
          <ContainerConnectionBadge
            summaries={data.crossContainerSummaries}
            layerColor={accentColor}
          />
        )}

        {inputPorts.map((port) => (
          <Handle
            key={port.id}
            type="target"
            position={Position.Left}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: accentColor,
              border: `2px solid ${isDark ? '#1e293b' : '#ffffff'}`,
              top: `${40 + inputPorts.indexOf(port) * 24}px`,
            }}
          />
        ))}

        {outputPorts.map((port) => (
          <Handle
            key={port.id}
            type="source"
            position={Position.Right}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: accentColor,
              border: `2px solid ${isDark ? '#1e293b' : '#ffffff'}`,
              top: `${40 + outputPorts.indexOf(port) * 24}px`,
            }}
          />
        ))}
      </div>
    </>
  );
}

LogicalBoundaryNodeComponent.displayName = 'LogicalBoundaryNode';

export const LogicalBoundaryNode = memo(LogicalBoundaryNodeComponent);
