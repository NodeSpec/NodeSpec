import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { Code2 } from 'lucide-react';
import { getTechnologyLogo, getTechnologyColors } from '../../utils/technology-logo-map.js';

interface ArchitectureExplanationNodeProps {
  data: RFNodeData;
  selected?: boolean;
  highlighted?: boolean;
}

function ArchitectureExplanationNodeComponent({ data, selected, highlighted }: ArchitectureExplanationNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const metadata = data.metadata || {};
  const rationale = metadata.rationale as string || '';
  const technology = data.technology as string || '';
  const nodeTypeLabel = data.nodeTypeLabel as string || 'Node';
  const artifactCount = (data.artifacts || []).length;
  const onClick = metadata.onClick as (() => void) | undefined;
  // Unmapped = this architecture node is not traced to any requirement (a coverage gap). It
  // still renders, but muted + badged so the traceability view reads at a glance.
  const isUnmapped = Boolean((metadata as Record<string, unknown>).unmapped);

  const HIGHLIGHT_COLOR = '#22c55e';
  const techLogo = getTechnologyLogo(technology);
  const techColors = getTechnologyColors(technology);
  const accentColor = techColors?.primary || '#10b981';

  const containerStyles: React.CSSProperties = {
    padding: '0',
    borderRadius: '10px',
    border: isUnmapped && !selected && !highlighted
      ? `2px dashed ${c.border}`
      : `2px solid ${selected ? c.primary : highlighted ? HIGHLIGHT_COLOR : accentColor}`,
    backgroundColor: c.surface,
    opacity: isUnmapped && !selected && !highlighted ? 0.6 : 1,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    cursor: onClick ? 'pointer' : 'default',
    boxShadow: selected
      ? `0 4px 12px ${c.primary}30, 0 0 0 2px ${c.primary}20`
      : highlighted
      ? `0 4px 12px ${HIGHLIGHT_COLOR}30, 0 0 0 2px ${HIGHLIGHT_COLOR}20`
      : theme.mode === 'dark'
        ? '0 2px 8px rgba(0, 0, 0, 0.3)'
        : '0 2px 8px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
  };

  const headerStyles: React.CSSProperties = {
    padding: '8px 10px',
    backgroundColor: `${accentColor}12`,
    borderBottom: `2px solid ${accentColor}`,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const iconStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    borderRadius: '5px',
    backgroundColor: `${accentColor}20`,
    flexShrink: 0,
  };

  const bodyStyles: React.CSSProperties = {
    padding: '8px 10px',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: c.text,
    marginBottom: '4px',
    lineHeight: '1.3',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const rationaleStyles: React.CSSProperties = {
    fontSize: '10px',
    color: c.textMuted,
    lineHeight: '1.4',
    marginBottom: '6px',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const footerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '8px',
    borderTop: `1px solid ${c.border}`,
  };

  const handleStyles: React.CSSProperties = {
    width: '8px',
    height: '8px',
    backgroundColor: accentColor,
    border: `2px solid ${accentColor}`,
  };

  const inputPorts = data.ports?.filter(p => p.direction === 'in') || [];
  const outputPorts = data.ports?.filter(p => p.direction === 'out') || [];

  return (
    <div style={containerStyles} onClick={onClick}>
      {inputPorts.map((_, index) => (
        <Handle
          key={`in-${index}`}
          type="target"
          position={Position.Left}
          id={`in-${index}`}
          style={{
            ...handleStyles,
            top: `${((index + 1) * 100) / (inputPorts.length + 1)}%`,
          }}
        />
      ))}

      <div style={headerStyles}>
        <div style={iconStyles}>
          {techLogo ? (
            <img
              src={techLogo}
              alt={technology || data.nodeType}
              style={{ width: '14px', height: '14px', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: '12px', lineHeight: 1 }}>{data.icon || '\u{1F4E6}'}</span>
          )}
        </div>
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          color: accentColor,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {nodeTypeLabel}
        </span>
        {technology && (
          <span style={{
            fontSize: '9px',
            fontWeight: 600,
            color: accentColor,
            backgroundColor: `${accentColor}15`,
            padding: '2px 5px',
            borderRadius: '4px',
          }}>
            {technology}
          </span>
        )}
        {isUnmapped && (
          <span
            title="Not mapped to any requirement"
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: c.textMuted,
              backgroundColor: `${c.textMuted}18`,
              border: `1px dashed ${c.border}`,
              padding: '2px 5px',
              borderRadius: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            No requirement
          </span>
        )}
      </div>

      <div style={bodyStyles}>
        <div style={titleStyles} title={data.label}>
          {data.label}
        </div>

        {rationale && (
          <div style={rationaleStyles} title={rationale}>
            {rationale}
          </div>
        )}

        {artifactCount > 0 && (
          <div style={footerStyles}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: c.textSecondary,
              fontWeight: 500,
            }}>
              <Code2 size={11} />
              <span>{artifactCount} file{artifactCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
        )}
      </div>

      {outputPorts.map((_, index) => (
        <Handle
          key={`out-${index}`}
          type="source"
          position={Position.Right}
          id={`out-${index}`}
          style={{
            ...handleStyles,
            top: `${((index + 1) * 100) / (outputPorts.length + 1)}%`,
          }}
        />
      ))}
    </div>
  );
}

export const ArchitectureExplanationNode = memo(ArchitectureExplanationNodeComponent);
