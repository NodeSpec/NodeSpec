import { memo } from 'react';
import { FallbackHandles } from './FallbackHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { ContainerBadge } from './ContainerBadge.js';
import { getTechnologyLogo, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';

interface EventBusNodeProps {
  data: RFNodeData;
  selected?: boolean;
}

const BUS_COLORS: Record<string, string> = {
  'rabbitmq': '#FF6600',
  'kafka': '#231F20',
  'nats': '#27AAE1',
  'sqs': '#FF4F8B',
  'redis': '#DC382D',
};

const FALLBACK_ICONS: Record<string, string> = {
  'kafka': '\u{1F4CA}',
  'rabbitmq': '\u{1F430}',
  'nats': '\u{26A1}',
  'redis': '\u{1F534}',
  'sqs': '\u{1F4EC}',
};

function EventBusNodeComponent({ data, selected }: EventBusNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;

  const busType = data.technology ||
                  (data.metadata?.provider as string) ||
                  (data.nodeType.includes('kafka') ? 'kafka' :
                   data.nodeType.includes('rabbitmq') ? 'rabbitmq' :
                   data.nodeType.includes('nats') ? 'nats' :
                   data.nodeType.includes('sqs') ? 'sqs' : 'default');

  const accentColor = BUS_COLORS[busType.toLowerCase()] || '#64748b';
  const HIGHLIGHT_COLOR = '#22c55e';

  const techLogo = getTechnologyLogo(data.technology);
  const techDisplayName = getTechnologyDisplayName(data.technology) || busType;

  const containerStyles: React.CSSProperties = {
    minWidth: '180px',
    backgroundColor: c.surface,
    borderRadius: '16px',
    border: `2px solid ${accentColor}`,
    boxShadow: selected
      ? `0 0 0 3px ${c.primary}40, 0 8px 24px rgba(0, 0, 0, 0.15)`
      : data.highlighted
        ? `0 0 0 3px ${HIGHLIGHT_COLOR}30, 0 8px 24px rgba(0, 0, 0, 0.15)`
        : '0 4px 12px rgba(0, 0, 0, 0.1)',
    position: 'relative',
    overflow: 'visible',
  };

  const headerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 16px',
  };

  const iconContainerStyles: React.CSSProperties = {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    backgroundColor: `${accentColor}12`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  return (
    <div style={containerStyles} className="event-bus-node" {...toolbarHover.nodeHoverProps}>
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />

      <FallbackHandles showTarget={inputPorts.length === 0} showSource={outputPorts.length === 0} />
      {inputPorts.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            width: '14px',
            height: '14px',
            backgroundColor: c.surface,
            border: `3px solid ${accentColor}`,
            top: '50%',
            left: '-7px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
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
            width: '14px',
            height: '14px',
            backgroundColor: c.surface,
            border: `3px solid ${accentColor}`,
            top: '50%',
            right: '-7px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
          title={port.name}
        />
      ))}

      <div style={headerStyles}>
        <div style={iconContainerStyles}>
          {techLogo ? (
            <img
              src={techLogo}
              alt={techDisplayName}
              style={{ width: '22px', height: '22px', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: '18px' }}>
              {FALLBACK_ICONS[busType.toLowerCase()] || '\u{1F4E8}'}
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: '13px',
            color: c.text,
            marginBottom: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {data.label}
          </div>
          <span style={{
            fontSize: '10px',
            color: accentColor,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {techDisplayName}
          </span>
        </div>
      </div>

      {data.containerParentLabel && (
        <div style={{ padding: '0 16px 10px' }}>
          <ContainerBadge label={data.containerParentLabel} placementKind={data.containerPlacementKind} />
        </div>
      )}
    </div>
  );
}

export const EventBusNode = memo(EventBusNodeComponent);
