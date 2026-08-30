import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { getTechnologyLogo, getTechnologyColors, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';

interface TemplatePreviewNodeProps {
  data: RFNodeData;
}

function TemplatePreviewNodeComponent({ data }: TemplatePreviewNodeProps) {
  const iconSrc = (data.icon as string | undefined) || getTechnologyLogo(data.technology);
  const techColors = getTechnologyColors(data.technology);
  const borderColor = (data.color as string) || techColors?.primary || '#94a3b8';
  const techName = getTechnologyDisplayName(data.technology);
  const tooltipLabel = techName ? `${data.label} (${techName})` : data.label;

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  return (
    <div
      title={tooltipLabel}
      style={{
        width: '44px',
        height: '44px',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        border: `2px solid ${borderColor}`,
        boxShadow: '0 3px 10px rgba(0, 0, 0, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {inputPorts.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            width: '8px',
            height: '8px',
            backgroundColor: '#ffffff',
            border: `2px solid ${borderColor}`,
            top: '50%',
            left: '-4px',
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
            backgroundColor: '#ffffff',
            border: `2px solid ${borderColor}`,
            top: '50%',
            right: '-4px',
          }}
        />
      ))}

      {inputPorts.length === 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="target-default"
          style={{
            width: '8px',
            height: '8px',
            backgroundColor: '#ffffff',
            border: `2px solid ${borderColor}`,
            top: '50%',
            left: '-4px',
            opacity: 0,
          }}
        />
      )}

      {outputPorts.length === 0 && (
        <Handle
          type="source"
          position={Position.Right}
          id="source-default"
          style={{
            width: '8px',
            height: '8px',
            backgroundColor: '#ffffff',
            border: `2px solid ${borderColor}`,
            top: '50%',
            right: '-4px',
            opacity: 0,
          }}
        />
      )}

      {iconSrc ? (
        <img
          src={iconSrc}
          alt={data.technology || data.nodeType}
          style={{ width: '28px', height: '28px', objectFit: 'contain' }}
        />
      ) : (
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '6px',
          backgroundColor: `${borderColor}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: borderColor }}>
            {(data.label || '?').slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}

export const TemplatePreviewNode = memo(TemplatePreviewNodeComponent);
