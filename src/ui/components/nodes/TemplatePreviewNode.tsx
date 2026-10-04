import { memo } from 'react';
import { LeafHandles } from './LeafHandles.js';
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
      <LeafHandles
        style={{
          width: '8px',
          height: '8px',
          backgroundColor: '#ffffff',
          border: `2px solid ${borderColor}`,
          top: '50%',
        }}
        targetStyle={{ left: '-4px' }}
        sourceStyle={{ right: '-4px' }}
      />

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
