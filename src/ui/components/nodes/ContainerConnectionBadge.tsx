import { memo, useState, useRef, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { CrossContainerSummary } from '../../adapters/graph-to-reactflow.js';

interface ContainerConnectionBadgeProps {
  summaries: CrossContainerSummary[];
  layerColor: string;
}

function ContainerConnectionBadgeComponent({ summaries, layerColor }: ContainerConnectionBadgeProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const totalEdges = summaries.reduce((sum, s) => sum + s.edges.length, 0);

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expanded]);

  if (totalEdges === 0) return null;

  const badgeStyles: React.CSSProperties = {
    position: 'absolute',
    bottom: '12px',
    left: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 12px',
    borderRadius: '16px',
    backgroundColor: theme.mode === 'dark' ? 'rgba(55, 62, 85, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    border: `1.5px solid ${layerColor}60`,
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    color: layerColor,
    boxShadow: theme.mode === 'dark'
      ? '0 2px 8px rgba(0, 0, 0, 0.3)'
      : '0 2px 8px rgba(0, 0, 0, 0.1)',
    transition: 'all 0.2s ease',
    zIndex: 20,
    userSelect: 'none',
  };

  const popoverStyles: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    marginBottom: '8px',
    minWidth: '260px',
    maxWidth: '360px',
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '12px',
    boxShadow: theme.mode === 'dark'
      ? '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)'
      : '0 8px 24px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
    padding: '12px',
    zIndex: 1000,
    maxHeight: '320px',
    overflowY: 'auto',
  };

  const headerStyles: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: c.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
    padding: '0 4px',
  };

  const groupStyles: React.CSSProperties = {
    marginBottom: '8px',
  };

  const groupHeaderStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px',
    borderRadius: '6px',
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)',
    marginBottom: '4px',
  };

  const groupLabelStyles: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: c.text,
  };

  const edgeItemStyles: React.CSSProperties = {
    padding: '4px 8px 4px 24px',
    fontSize: '11px',
    color: c.textMuted,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };

  return (
    <div style={{ position: 'relative' }} className="nodrag nopan" ref={popoverRef}>
      <div
        style={badgeStyles}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = theme.mode === 'dark'
            ? 'rgba(55, 62, 85, 1)'
            : 'rgba(255, 255, 255, 1)';
          (e.currentTarget as HTMLDivElement).style.borderColor = layerColor;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = theme.mode === 'dark'
            ? 'rgba(55, 62, 85, 0.95)'
            : 'rgba(255, 255, 255, 0.95)';
          (e.currentTarget as HTMLDivElement).style.borderColor = `${layerColor}60`;
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 8h12M12 4l4 4-4 4" />
        </svg>
        <span>{totalEdges} connection{totalEdges !== 1 ? 's' : ''}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>

      {expanded && (
        <div style={popoverStyles}>
          <div style={headerStyles}>Cross-Container Connections</div>
          {summaries.map((summary) => (
            <div key={summary.targetContainerId} style={groupStyles}>
              <div style={groupHeaderStyles}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={layerColor} strokeWidth="1.5">
                  <rect x="1" y="1" width="14" height="14" rx="2" />
                </svg>
                <span style={groupLabelStyles}>{summary.targetContainerLabel}</span>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: c.textMuted,
                  marginLeft: 'auto',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                  padding: '2px 6px',
                  borderRadius: '8px',
                }}>
                  {summary.edges.length}
                </span>
              </div>
              {summary.edges.map((edge) => (
                <div key={edge.edgeId} style={edgeItemStyles}>
                  <span style={{ color: c.textSecondary }}>{edge.sourceNodeLabel}</span>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke={c.textMuted} strokeWidth="1.5">
                    <path d="M2 8h12M12 5l3 3-3 3" />
                  </svg>
                  <span style={{ color: c.textSecondary }}>{edge.targetNodeLabel}</span>
                  {edge.label && (
                    <span style={{
                      fontSize: '10px',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                      color: c.textMuted,
                      marginLeft: '4px',
                    }}>
                      {edge.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ContainerConnectionBadge = memo(ContainerConnectionBadgeComponent);
