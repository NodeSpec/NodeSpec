import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { getTechnologyLogo, getTechnologyColors } from '../../utils/technology-logo-map.js';

interface Props {
  data: RFNodeData;
}

function TemplatePreviewContainerNodeComponent({ data }: Props) {
  const iconSrc = (data.icon as string | undefined) || getTechnologyLogo(data.technology);
  const techColors = getTechnologyColors(data.technology);
  const borderColor = (data.color as string) || techColors?.primary || '#94a3b8';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      borderRadius: '12px',
      backgroundColor: `${borderColor}06`,
      border: `1.5px solid ${borderColor}40`,
      position: 'relative',
      overflow: 'visible',
    }}>
      <Handle
        type="target"
        position={Position.Left}
        id="target-default"
        style={{ width: '6px', height: '6px', backgroundColor: '#fff', border: `1.5px solid ${borderColor}`, top: '50%', left: '-3px', opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source-default"
        style={{ width: '6px', height: '6px', backgroundColor: '#fff', border: `1.5px solid ${borderColor}`, top: '50%', right: '-3px', opacity: 0 }}
      />

      <div style={{
        position: 'absolute',
        top: '8px',
        left: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        zIndex: 5,
      }}>
        {iconSrc && (
          <img
            src={iconSrc}
            alt={data.technology || ''}
            style={{ width: '14px', height: '14px', objectFit: 'contain' }}
          />
        )}
        <span style={{
          fontSize: '9px',
          fontWeight: 700,
          color: borderColor,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          opacity: 0.9,
        }}>
          {data.label}
        </span>
      </div>
    </div>
  );
}

export const TemplatePreviewContainerNode = memo(TemplatePreviewContainerNodeComponent);
