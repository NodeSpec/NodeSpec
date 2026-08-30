import { memo, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { ArchitectureLayerMode } from '../../adapters/graph-to-reactflow.js';
import { CONTRACT_KIND_EDGE_COLORS, INTERACTION_KIND_DASH } from '../panels/inspector/kind-maps.js';

// Design import B.2d ("Canvas Simplification", Section B, owner 2026-07-29):
// zoom, fit, layer mode, view toggle, and the edge legend collapse into ONE
// bottom dock; the legend expands in place (upward) on hover instead of
// flying out. Supersedes the separate RF <Controls/>, the floating
// LayerModeToggle pill stack, and the bottom-left EdgeLegend button.
// Owner follow-up 2026-07-29: the edge-visibility toggle (all/summary/minimal)
// and the Contract Types filters are retired outright — deployment view always
// uses summary visibility; the dock carries no popover for it.

export type NodeSizeMode = 'regular' | 'compact';

interface CanvasDockProps {
  mode: ArchitectureLayerMode;
  onToggle: (mode: ArchitectureLayerMode) => void;
  disabled?: boolean;
  nodeSize?: NodeSizeMode;
  onNodeSizeChange?: (size: NodeSizeMode) => void;
  availableContractKinds?: string[];
  availableInteractionKinds?: string[];
}

// Legend wording is concept-first (kafka → "Event Stream") — a deliberate
// display choice, not a vocabulary copy (same stance the retired EdgeLegend
// documented); colors/dashes come from THE shared tables in kind-maps.
const CONTRACT_LABELS: Record<string, string> = {
  rest: 'REST',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  websocket: 'WebSocket',
  sse: 'SSE',
  kafka: 'Event Stream',
  amqp: 'AMQP',
  sql: 'SQL',
  nosql: 'NoSQL',
  ipc: 'IPC',
  dependency: 'Dependency',
  custom: 'Custom',
};

const INTERACTION_LABELS: Record<string, string> = {
  request_response: 'Request/Response',
  event: 'Event',
  queue: 'Queue',
  data_read: 'Data Read/Write',
  file_transfer: 'File Transfer',
  auth: 'Auth',
  telemetry: 'Telemetry',
  dependency: 'Dependency',
};

const DEFAULT_CONTRACTS = ['rest', 'graphql', 'grpc', 'websocket', 'kafka', 'sql', 'amqp'];
const DEFAULT_INTERACTIONS = ['request_response', 'event', 'queue', 'data_read', 'file_transfer', 'auth'];

function CanvasDockComponent({
  mode,
  onToggle,
  disabled = false,
  nodeSize = 'regular',
  onNodeSizeChange,
  availableContractKinds,
  availableInteractionKinds,
}: CanvasDockProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Selector returns a primitive so the dock re-renders only when the
  // ROUNDED percent changes, not on every viewport frame.
  const zoomPercent = useStore((s) => Math.round(s.transform[2] * 100));
  const [legendOpen, setLegendOpen] = useState(false);

  const isFlat = mode === 'flat';

  const iconButton: React.CSSProperties = {
    width: '30px',
    height: '30px',
    borderRadius: '7px',
    border: 'none',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: c.textMuted,
    cursor: 'pointer',
    fontSize: '16px',
    padding: 0,
  };

  const segmentPill = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 9px',
    borderRadius: '7px',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '11px',
    fontWeight: active ? 600 : 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: active ? `${c.primary}1f` : 'transparent',
    color: active ? c.primary : c.textMuted,
    opacity: disabled ? 0.5 : 1,
    pointerEvents: disabled ? ('none' as const) : ('auto' as const),
    userSelect: 'none',
    outline: 'none',
  });

  const divider = (
    <div style={{ width: '1px', alignSelf: 'stretch', backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#eef0f3', margin: '6px 0' }} />
  );

  const activeContracts = availableContractKinds && availableContractKinds.length > 0 ? availableContractKinds : DEFAULT_CONTRACTS;
  const activeInteractions = availableInteractionKinds && availableInteractionKinds.length > 0 ? availableInteractionKinds : DEFAULT_INTERACTIONS;

  const contractEntries = activeContracts
    .filter(k => CONTRACT_KIND_EDGE_COLORS[k])
    .map(k => [k, CONTRACT_KIND_EDGE_COLORS[k]] as const);

  const interactionEntries = activeInteractions
    .filter(k => k in INTERACTION_KIND_DASH)
    .map(k => [k, INTERACTION_KIND_DASH[k]] as const);

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '22px',
        transform: 'translateX(-50%)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-end',
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : '#ffffff',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb'}`,
        borderRadius: '12px',
        boxShadow: isDark
          ? '0 6px 22px rgba(0, 0, 0, 0.5)'
          : '0 6px 22px rgba(0, 0, 0, 0.12)',
      }}
    >
      {/* zoom cluster */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', gap: '2px' }}>
        <button type="button" style={iconButton} onClick={() => zoomIn({ duration: 150 })} title="Zoom in">+</button>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: c.textMuted,
          minWidth: '38px',
          textAlign: 'center',
        }}>
          {zoomPercent}%
        </span>
        <button type="button" style={iconButton} onClick={() => zoomOut({ duration: 150 })} title="Zoom out">−</button>
        <button type="button" style={iconButton} onClick={() => fitView({ duration: 300, padding: 0.15 })} title="Fit view">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          </svg>
        </button>
      </div>

      {divider}

      {/* layer mode + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', gap: '4px' }}>
        <button
          type="button"
          style={segmentPill(isFlat)}
          onClick={() => onToggle('flat')}
          title="Functional view (F)"
          disabled={disabled}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="14" y2="12" />
          </svg>
          Functional
        </button>
        <button
          type="button"
          style={segmentPill(!isFlat)}
          onClick={() => onToggle('nested')}
          title="Deployment view (N)"
          disabled={disabled}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="14" height="14" rx="2" />
            <rect x="4" y="5" width="3.5" height="3.5" rx="0.75" />
            <rect x="8.5" y="5" width="3.5" height="3.5" rx="0.75" />
          </svg>
          Deployment
        </button>

        {isFlat && onNodeSizeChange && (
          <>
            <div style={{ width: '1px', height: '18px', backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#eef0f3', margin: '0 2px' }} />
            <button
              type="button"
              style={segmentPill(nodeSize === 'regular')}
              onClick={() => onNodeSizeChange('regular')}
              title="Regular sized nodes"
            >
              Regular
            </button>
            <button
              type="button"
              style={segmentPill(nodeSize === 'compact')}
              onClick={() => onNodeSizeChange('compact')}
              title="Compact icon nodes (S)"
            >
              Compact
            </button>
          </>
        )}

      </div>

      {divider}

      {/* legend segment — expands in place on hover */}
      <div
        style={{ padding: '6px 12px 6px 10px' }}
        onMouseEnter={() => setLegendOpen(true)}
        onMouseLeave={() => setLegendOpen(false)}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '30px',
          color: c.textMuted,
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          cursor: 'default',
          userSelect: 'none',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
          Legend
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transition: 'transform 0.2s ease', transform: legendOpen ? 'rotate(180deg)' : 'none' }}
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </div>
        <div style={{
          maxHeight: legendOpen ? '260px' : '0px',
          opacity: legendOpen ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.22s ease, opacity 0.18s ease',
        }}>
          <div style={{ padding: '8px 2px 4px', width: '180px' }}>
            <div style={{
              fontSize: '9px',
              fontWeight: 700,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: c.textMuted,
              letterSpacing: '0.05em',
              marginBottom: '5px',
              textTransform: 'uppercase',
            }}>
              Contract
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              {contractEntries.map(([kind, colors]) => (
                <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="26" height="6" viewBox="0 0 26 6">
                    <path d="M0 3H26" stroke={isDark ? colors.dark : colors.light} strokeWidth="2.4" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: c.text }}>{CONTRACT_LABELS[kind] ?? kind}</span>
                </div>
              ))}
            </div>
            <div style={{
              fontSize: '9px',
              fontWeight: 700,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: c.textMuted,
              letterSpacing: '0.05em',
              marginBottom: '5px',
              textTransform: 'uppercase',
            }}>
              Interaction
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {interactionEntries.map(([kind, dash]) => (
                <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="26" height="6" viewBox="0 0 26 6">
                    <path d="M0 3H26" stroke={c.text} strokeWidth="2" strokeDasharray={dash ?? undefined} />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: c.text }}>{INTERACTION_LABELS[kind] ?? kind}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const CanvasDock = memo(CanvasDockComponent);
