import { memo, useState } from 'react';
import { FallbackHandles } from './FallbackHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { NodeIcon } from '../common/index.js';
import { ContainerBadge } from './ContainerBadge.js';
import { getTechnologyLogo, getTechnologyColors, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';

interface IconNodeProps {
  data: RFNodeData;
  selected?: boolean;
}

function CompactNestedNode({ data, selected }: IconNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [hovered, setHovered] = useState(false);
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();

  const iconSrc = getTechnologyLogo(data.technology);
  const colors = getTechnologyColors(data.technology) || { primary: c.primary, secondary: c.primary };
  const artifactCount = data.artifactCount || 0;
  const hasArtifacts = artifactCount > 0;
  const HIGHLIGHT_COLOR = '#22c55e';

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => { setHovered(true); toolbarHover.nodeHoverProps.onMouseEnter(); }}
      onMouseLeave={() => { setHovered(false); toolbarHover.nodeHoverProps.onMouseLeave(); }}
    >
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: '14px',
        backgroundColor: c.surface,
        border: `2.5px solid ${colors.primary}`,
        boxShadow: selected
          ? `0 0 0 3px ${c.primary}40, 0 4px 16px rgba(0, 0, 0, 0.18)`
          : data.highlighted
            ? `0 0 0 3px ${HIGHLIGHT_COLOR}30, 0 4px 12px rgba(0, 0, 0, 0.12)`
            : '0 3px 12px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        cursor: 'pointer',
        position: 'relative',
      }}>
        <FallbackHandles showTarget={inputPorts.length === 0} showSource={outputPorts.length === 0} />
        {inputPorts.map((port) => (
          <Handle
            key={port.id}
            type="target"
            position={Position.Left}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: c.surface,
              border: `2px solid ${colors.primary}`,
              top: '50%',
              left: '-4px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
            title={port.name}
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
              backgroundColor: c.surface,
              border: `2px solid ${colors.primary}`,
              top: '50%',
              right: '-4px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
            title={port.name}
          />
        ))}

        {iconSrc ? (
          <img
            src={iconSrc}
            alt={data.nodeType}
            style={{ width: '32px', height: '32px', objectFit: 'contain' }}
          />
        ) : data.icon && (data.icon.startsWith('http') || data.icon.startsWith('/')) ? (
          <img src={data.icon} alt={data.nodeType} style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        ) : (
          // Owner 2026-07-29: an unrecognized node type falls back to its
          // CATEGORICAL icon (NodeIcon's N4.8 chain: lucide caller icon -> role
          // icon -> palette-category icon), never a generic invented glyph.
          <NodeIcon nodeType={data.nodeType} technology={data.technology} emojiIcon={data.icon} size={22} />
        )}

        {hasArtifacts && (
          <div style={{
            position: 'absolute',
            bottom: '-4px',
            right: '-4px',
            fontSize: '8px',
            fontWeight: 700,
            padding: '1px 4px',
            borderRadius: '6px',
            backgroundColor: theme.mode === 'dark' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.15)',
            color: theme.mode === 'dark' ? '#93c5fd' : '#2563eb',
            border: `1px solid ${theme.mode === 'dark' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.25)'}`,
            zIndex: 10,
          }}>
            {artifactCount}
          </div>
        )}
      </div>

      {(hovered || selected) && (
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '6px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            pointerEvents: 'auto',
          }}
        >
          <div style={{
            backgroundColor: theme.mode === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.97)',
            border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: '10px',
            padding: '8px 12px',
            boxShadow: theme.mode === 'dark'
              ? '0 8px 24px rgba(0, 0, 0, 0.5)'
              : '0 8px 24px rgba(0, 0, 0, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
            minWidth: '100px',
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              color: c.text,
              textAlign: 'center',
              lineHeight: '1.3',
            }}>
              {data.label}
            </div>

            <div style={{
              fontSize: '9px',
              color: colors.primary,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
            }}>
              {data.nodeTypeLabel || getTechnologyDisplayName(data.technology) || data.nodeType.split('.').pop()?.replace(/-/g, ' ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FullIconNode({ data, selected }: IconNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;

  const iconSrc = getTechnologyLogo(data.technology);
  const colors = getTechnologyColors(data.technology) || { primary: c.primary, secondary: c.primary };

  const HIGHLIGHT_COLOR = '#22c55e';

  const containerStyles: React.CSSProperties = {
    borderRadius: '16px',
    padding: '16px 20px',
    minWidth: '180px',
    backgroundColor: c.surface,
    border: `3px solid ${colors.primary}`,
    boxShadow: selected
      ? `0 0 0 4px ${c.primary}40, 0 8px 24px rgba(0, 0, 0, 0.18)`
      : data.highlighted
        ? `0 0 0 4px ${HIGHLIGHT_COLOR}30, 0 8px 24px rgba(0, 0, 0, 0.18)`
        : '0 6px 20px rgba(0, 0, 0, 0.12)',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
  };

  const iconContainerStyles: React.CSSProperties = {
    width: '52px',
    height: '52px',
    borderRadius: '14px',
    backgroundColor: `${colors.primary}15`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `2px solid ${colors.primary}30`,
    boxShadow: `0 4px 12px ${colors.primary}20`,
  };

  const labelStyles: React.CSSProperties = {
    fontWeight: 600,
    fontSize: '13px',
    color: c.text,
    textAlign: 'center',
    maxWidth: '140px',
    lineHeight: '1.3',
  };

  const typeStyles: React.CSSProperties = {
    fontSize: '10px',
    color: colors.primary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '3px 8px',
    backgroundColor: `${colors.primary}15`,
    borderRadius: '6px',
  };

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  const getHandlePosition = (index: number, total: number) => {
    const spacing = 100 / (total + 1);
    return `${(index + 1) * spacing}%`;
  };

  return (
    <div style={containerStyles} {...toolbarHover.nodeHoverProps}>
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />

      <FallbackHandles showTarget={inputPorts.length === 0} showSource={outputPorts.length === 0} />
      {inputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: c.surface,
            border: `3px solid ${colors.primary}`,
            top: getHandlePosition(index, inputPorts.length),
            left: '-6px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
          title={port.name}
        />
      ))}

      {outputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: c.surface,
            border: `3px solid ${colors.primary}`,
            top: getHandlePosition(index, outputPorts.length),
            right: '-6px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
          title={port.name}
        />
      ))}

      <div style={iconContainerStyles}>
        {iconSrc ? (
          <img
            src={iconSrc}
            alt={data.nodeType}
            style={{ width: '36px', height: '36px', objectFit: 'contain' }}
          />
        ) : data.icon && (data.icon.startsWith('http') || data.icon.startsWith('/')) ? (
          <img src={data.icon} alt={data.nodeType} style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
        ) : (
          // Owner 2026-07-29: unmatched node types fall back to the CATEGORICAL
          // icon (NodeIcon's N4.8 chain), never a generic invented glyph.
          <NodeIcon nodeType={data.nodeType} technology={data.technology} emojiIcon={data.icon} size={28} />
        )}
      </div>

      <div style={labelStyles}>{data.label}</div>

      <div style={typeStyles}>
        {data.nodeTypeLabel || getTechnologyDisplayName(data.technology) || data.nodeType.split('.').pop()?.replace(/-/g, ' ')}
      </div>

      {data.containerParentLabel && (
        <ContainerBadge label={data.containerParentLabel} placementKind={data.containerPlacementKind} />
      )}

      {data.metadata?.version != null && (
        <div style={{
          fontSize: '10px',
          color: c.textMuted,
          marginTop: '4px',
        }}>
          v{String(data.metadata.version)}
        </div>
      )}
    </div>
  );
}

function IconNodeComponent(props: IconNodeProps) {
  if (props.data.layerMode === 'nested' || props.data.isInsideLogicalBoundary || props.data.nodeSize === 'compact') {
    return <CompactNestedNode {...props} />;
  }
  return <FullIconNode {...props} />;
}

export const IconNode = memo(IconNodeComponent);
