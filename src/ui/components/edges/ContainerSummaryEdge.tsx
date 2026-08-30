import { memo, useState, useRef, useEffect, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { ContainerSummaryEdgeData } from '../../adapters/graph-to-reactflow.js';
// M6: one label table, in core, typed against the enum (was one of three copies).
import { contractKindLabel } from '@nodespec/core/contract-labels.js';


function formatContractKinds(kinds: string[]): string {
  if (kinds.length === 0) return 'Data';
  return kinds.map(contractKindLabel).join(' / ');
}

export const ContainerSummaryEdge = memo((props: EdgeProps) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;

  const { theme } = useTheme();
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const summaryData = data as ContainerSummaryEdgeData | undefined;
  const edgeCount = summaryData?.edgeCount ?? 0;
  const dominantKinds = summaryData?.dominantContractKinds ?? [];
  const edgeDetails = summaryData?.edges ?? [];

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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.3,
  });

  const accentColor = theme.mode === 'dark'
    ? 'rgba(56, 189, 248, 0.5)'
    : 'rgba(14, 116, 144, 0.45)';

  const accentHover = theme.mode === 'dark'
    ? 'rgba(56, 189, 248, 0.8)'
    : 'rgba(14, 116, 144, 0.7)';

  const accentSolid = theme.mode === 'dark' ? '#38bdf8' : '#0e7490';

  const isActive = hovered || expanded;

  const edgeStyle: CSSProperties = {
    stroke: isActive ? accentHover : accentColor,
    strokeWidth: isActive ? 3.5 : 2.5,
    strokeDasharray: '8,6',
    transition: 'stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease, filter 0.25s ease',
    opacity: isActive ? 0.9 : 0.45,
    filter: isActive
      ? `drop-shadow(0 0 5px ${theme.mode === 'dark' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(14, 116, 144, 0.25)'})`
      : 'none',
  };

  const hitAreaStyle: CSSProperties = {
    stroke: 'transparent',
    strokeWidth: 28,
    fill: 'none',
    cursor: 'pointer',
  };

  const pillStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 12px',
    borderRadius: '14px',
    backgroundColor: theme.mode === 'dark'
      ? 'rgba(15, 23, 42, 0.92)'
      : 'rgba(255, 255, 255, 0.95)',
    border: `1.5px solid ${isActive ? accentHover : accentColor}`,
    fontSize: '11px',
    fontWeight: 600,
    color: accentSolid,
    cursor: 'pointer',
    pointerEvents: 'all',
    boxShadow: theme.mode === 'dark'
      ? `0 2px 12px rgba(0, 0, 0, 0.4)${isActive ? `, 0 0 12px rgba(56, 189, 248, 0.15)` : ''}`
      : `0 2px 12px rgba(0, 0, 0, 0.08)${isActive ? `, 0 0 12px rgba(14, 116, 144, 0.08)` : ''}`,
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
    zIndex: 10,
    backdropFilter: 'blur(8px)',
  };

  const popoverStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, 0) translate(${labelX}px,${labelY + 20}px)`,
    minWidth: '280px',
    maxWidth: '380px',
    backgroundColor: theme.mode === 'dark'
      ? 'rgba(15, 23, 42, 0.96)'
      : 'rgba(255, 255, 255, 0.98)',
    border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
    borderRadius: '12px',
    boxShadow: theme.mode === 'dark'
      ? '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)'
      : '0 8px 32px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.04)',
    padding: '14px',
    maxHeight: '340px',
    overflowY: 'auto',
    pointerEvents: 'all',
    zIndex: 1000,
    backdropFilter: 'blur(12px)',
    animation: 'sgSummaryPopoverIn 0.15s ease-out',
  };

  return (
    <>
      <path
        d={edgePath}
        style={hitAreaStyle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {isActive && (
        <path
          d={edgePath}
          className="sg-summary-flow"
          style={{
            stroke: theme.mode === 'dark' ? 'rgba(56, 189, 248, 0.5)' : 'rgba(14, 116, 144, 0.35)',
            strokeWidth: 4,
            strokeDasharray: '3,17',
            strokeLinecap: 'round',
            fill: 'none',
            opacity: 0.8,
            pointerEvents: 'none',
          }}
        />
      )}

      <BaseEdge id={id} path={edgePath} style={edgeStyle} />

      <EdgeLabelRenderer>
        <div
          style={pillStyle}
          className="nodrag nopan"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 8h12M12 4l4 4-4 4" />
          </svg>
          <span>{edgeCount} {edgeCount === 1 ? 'connection' : 'connections'}</span>
          <span style={{
            fontSize: '10px',
            fontWeight: 500,
            opacity: 0.7,
            borderLeft: `1px solid ${accentColor}`,
            paddingLeft: '6px',
          }}>
            {formatContractKinds(dominantKinds)}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            style={{
              transition: 'transform 0.2s ease',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              opacity: 0.6,
            }}
          >
            <path d="M2 4l3 3 3-3" />
          </svg>
        </div>

        {expanded && (
          <div
            ref={popoverRef}
            style={popoverStyle}
            className="nodrag nopan"
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              padding: '0 2px',
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                color: c.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Connection Details
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: theme.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'rgba(0, 0, 0, 0.06)',
                  color: c.textMuted,
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'background-color 0.15s ease',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
            {edgeDetails.map((edge: ContainerSummaryEdgeData['edges'][number]) => (
              <div
                key={edge.edgeId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 8px',
                  borderRadius: '8px',
                  marginBottom: '4px',
                  backgroundColor: theme.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.03)'
                    : 'rgba(0, 0, 0, 0.02)',
                  transition: 'background-color 0.15s ease',
                }}
              >
                <span style={{ fontSize: '12px', color: c.text, fontWeight: 500 }}>
                  {edge.sourceNodeLabel}
                </span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={accentSolid} strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 8h12M12 5l3 3-3 3" />
                </svg>
                <span style={{ fontSize: '12px', color: c.text, fontWeight: 500 }}>
                  {edge.targetNodeLabel}
                </span>
                <span style={{ display: 'flex', gap: '4px', marginLeft: 'auto', alignItems: 'center' }}>
                  {edge.contractKind && (
                    <span style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      backgroundColor: theme.mode === 'dark'
                        ? 'rgba(56, 189, 248, 0.1)'
                        : 'rgba(14, 116, 144, 0.06)',
                      color: accentSolid,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}>
                      {contractKindLabel(edge.contractKind)}
                    </span>
                  )}
                  {edge.transport && (
                    <span style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: theme.mode === 'dark'
                        ? 'rgba(52, 211, 153, 0.08)'
                        : 'rgba(5, 150, 105, 0.05)',
                      color: theme.mode === 'dark' ? '#6ee7b7' : '#047857',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}>
                      {edge.transport}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        <style>{`
          @keyframes sgSummaryPopoverIn {
            from { opacity: 0; transform: translate(-50%, 0) translate(${labelX}px,${labelY + 28}px); }
            to   { opacity: 1; transform: translate(-50%, 0) translate(${labelX}px,${labelY + 20}px); }
          }
        `}</style>
      </EdgeLabelRenderer>
    </>
  );
});

ContainerSummaryEdge.displayName = 'ContainerSummaryEdge';
