import { memo, useState, useCallback, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { Theme } from '../../theme/index.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { InterfaceIcon } from '../common/index.js';
import type { EdgeVisibility, ArchitectureLayerMode } from '../../adapters/graph-to-reactflow.js';
import type { ContractKind, InteractionKind, EdgeCriticality, EdgeDirection } from '@nodespec/core/shared/enums.js';

// ─── Visual Encoding Maps ───────────────────────────────────────────────────
// N8.6(B): color + dash tables live ONCE in kind-maps (this file and EdgeLegend
// each carried a private copy; the legend's dash copy had drifted to a subset).
import { CONTRACT_KIND_EDGE_COLORS, INTERACTION_KIND_DASH } from '../panels/inspector/kind-maps.js';

const CRITICALITY_WIDTH: Record<EdgeCriticality, number> = {
  required: 2.2,
  optional: 1.4,
  fallback: 1,
};

// ─── EdgeLabel ──────────────────────────────────────────────────────────────

const EdgeLabel = memo(({
  label,
  x,
  y,
  hasError,
  hasWarning: _hasWarning,
  contractStatus,
  theme,
  muted,
  hidden,
}: {
  label: string;
  x: number;
  y: number;
  hasError: boolean;
  hasWarning: boolean;
  contractStatus?: 'draft' | 'complete';
  theme: Theme;
  muted?: boolean;
  hidden?: boolean;
}) => {
  const labelStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
    // Owner 2026-07-29: the description sits IN FRONT of its line. Edge
    // layers live at zIndex 4-7 (adapter) and nodes at 10 — 8 puts the
    // label above every line while nodes still cover it.
    zIndex: 8,
    fontSize: '11px',
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: '6px',
    backgroundColor: hasError
      ? theme.colors.errorBg
      : theme.mode === 'dark'
        ? 'rgba(15, 23, 42, 0.92)'
        : 'rgba(255, 255, 255, 0.95)',
    color: hasError ? theme.colors.error : theme.colors.textSecondary,
    border: `1px solid ${hasError ? theme.colors.error : theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
    pointerEvents: 'all',
    boxShadow: theme.mode === 'dark'
      ? '0 2px 8px rgba(0, 0, 0, 0.3)'
      : '0 2px 8px rgba(0, 0, 0, 0.08)',
    transition: 'opacity 0.25s ease, transform 0.2s ease',
    willChange: 'transform, opacity',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    opacity: hidden ? 0 : muted ? 0.45 : 1,
    backdropFilter: 'blur(8px)',
  };

  const knownInterfaces = ['rest', 'graphql', 'grpc', 'websocket', 'mqtt', 'sse', 'amqp', 'kafka', 'http', 'redis', 'sql', 'nats', 'sqs', 'dependency'];
  const labelLower = label.toLowerCase();
  const isKnownInterface = knownInterfaces.some(iface => labelLower.includes(iface));

  const statusColor = contractStatus === 'complete'
    ? (theme.mode === 'dark' ? '#34d399' : '#059669')
    : (theme.mode === 'dark' ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.4)');

  return (
    <div style={labelStyle} className="nodrag nopan">
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: statusColor,
          flexShrink: 0,
        }}
        title={contractStatus === 'complete' ? 'Implemented' : 'Not yet implemented'}
      />
      {isKnownInterface && <InterfaceIcon interfaceType={labelLower.split(' ')[0]} size={14} />}
      {label}
    </div>
  );
});

EdgeLabel.displayName = 'EdgeLabel';

// ─── CustomEdge ─────────────────────────────────────────────────────────────

export const CustomEdge = memo((props: EdgeProps) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    data,
    style,
    markerEnd,
  } = props;

  const { theme } = useTheme();
  const [hovered, setHovered] = useState(false);

  const hasError = Boolean(data && typeof data === 'object' && 'hasError' in data && data.hasError);
  const hasWarning = Boolean(data && typeof data === 'object' && 'hasWarning' in data && data.hasWarning);
  const contractStatus = (data && typeof data === 'object' && 'contractStatus' in data ? data.contractStatus : undefined) as 'draft' | 'complete' | undefined;
  const curveOffset = (data && typeof data === 'object' && 'curveOffset' in data && typeof data.curveOffset === 'number') ? data.curveOffset : 0;
  const edgeVisibility = (data && typeof data === 'object' && 'edgeVisibility' in data ? data.edgeVisibility : 'external') as EdgeVisibility;
  const layerMode = (data && typeof data === 'object' && 'layerMode' in data ? data.layerMode : 'flat') as ArchitectureLayerMode;
  const focusedEdgeId = (data && typeof data === 'object' && 'focusedEdgeId' in data ? data.focusedEdgeId : null) as string | null;
  const focusedNodeId = (data && typeof data === 'object' && 'focusedNodeId' in data ? data.focusedNodeId : null) as string | null;
  const sourceNodeId = (data && typeof data === 'object' && 'sourceNodeId' in data ? data.sourceNodeId : null) as string | null;
  const targetNodeId = (data && typeof data === 'object' && 'targetNodeId' in data ? data.targetNodeId : null) as string | null;

  const contract = (data && typeof data === 'object' && 'contract' in data ? data.contract : null) as { kind?: ContractKind; interactionKind?: InteractionKind } | null;
  const direction = (data && typeof data === 'object' && 'direction' in data ? data.direction : undefined) as EdgeDirection | undefined;
  const criticality = (data && typeof data === 'object' && 'criticality' in data ? data.criticality : undefined) as EdgeCriticality | undefined;

  const isIntraContainer = layerMode === 'nested' && edgeVisibility === 'intra-container';
  const isCrossContainer = layerMode === 'nested' && edgeVisibility === 'cross-container';
  const isExternalToContainer = layerMode === 'nested' && edgeVisibility === 'external';

  const isFocusActive = focusedEdgeId !== null || focusedNodeId !== null;
  const isSelfFocused = focusedEdgeId === id;
  const isNodeRelated = focusedNodeId !== null && (sourceNodeId === focusedNodeId || targetNodeId === focusedNodeId);
  const isRelatedToFocus = isSelfFocused || isNodeRelated;
  const isDimmed = isFocusActive && !isRelatedToFocus;

  const yDelta = Math.abs(targetY - sourceY);
  const sameRow = yDelta < 50;
  const adjacentRow = yDelta >= 50 && yDelta < 200;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isIntraContainer && curveOffset === 0) {
    if (sameRow) {
      [edgePath, labelX, labelY] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
      });
    } else if (adjacentRow) {
      [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 12,
      });
    } else {
      [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        curvature: 0.2,
      });
    }
  } else if (curveOffset !== 0 || isExternalToContainer || isCrossContainer) {
    const effectiveCurvature = isCrossContainer
      ? 0.5 + Math.abs(curveOffset) / 150
      : isExternalToContainer
        ? 0.35 + Math.abs(curveOffset) / 200
        : 0.25 + Math.abs(curveOffset) / 200;
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: effectiveCurvature,
    });
  } else {
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 12,
    });
  }

  // ─── Derive visual encoding from ontology fields ────────────────────────

  const contractKind = contract?.kind as ContractKind | undefined;
  const interactionKind = contract?.interactionKind as InteractionKind | undefined;

  const kindColor = contractKind ? CONTRACT_KIND_EDGE_COLORS[contractKind] : null;

  const getStrokeColor = useCallback(() => {
    if (hasError) return theme.colors.error;

    if (hovered || isSelfFocused) {
      return kindColor
        ? kindColor[theme.mode]
        : theme.mode === 'dark' ? '#38bdf8' : '#0891b2';
    }

    if (isCrossContainer) {
      return theme.mode === 'dark' ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.2)';
    }
    if (isIntraContainer) {
      return theme.mode === 'dark' ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.35)';
    }
    if (isNodeRelated) {
      return kindColor
        ? kindColor[theme.mode]
        : theme.mode === 'dark' ? 'rgba(56, 189, 248, 0.7)' : 'rgba(14, 116, 144, 0.6)';
    }

    if (kindColor) {
      const c = kindColor[theme.mode];
      return theme.mode === 'dark' ? c + 'aa' : c + 'bb';
    }

    return theme.colors.border;
  }, [hasError, hovered, isSelfFocused, isCrossContainer, isIntraContainer, isNodeRelated, theme, kindColor]);

  // Width from criticality (with hover/focus overrides)
  const baseWidth = criticality ? CRITICALITY_WIDTH[criticality] : 1.8;
  const strokeWidth = (hovered || isSelfFocused)
    ? Math.max(baseWidth, 2.5)
    : isNodeRelated
      ? Math.max(baseWidth, 2)
      : isCrossContainer ? Math.min(baseWidth, 1) : isIntraContainer ? Math.min(baseWidth, 1.5) : baseWidth;

  // Dash from interactionKind (with error/container overrides)
  const interactionDash = interactionKind ? INTERACTION_KIND_DASH[interactionKind] : undefined;
  const strokeDasharray = hasError
    ? undefined
    : isCrossContainer
      ? '6,4'
      : isIntraContainer
        ? '4,4'
        : interactionDash;

  const baseOpacity = isCrossContainer
    ? (hovered || isSelfFocused ? 1 : 0.35)
    : isIntraContainer
      ? 0.55
      : 1;

  const resolvedOpacity = isDimmed ? 0.08 : baseOpacity;

  // Marker end for bidirectional edges
  const resolvedMarkerEnd = direction === 'bidirectional' ? undefined : markerEnd;
  const markerStart = direction === 'bidirectional' ? markerEnd : undefined;

  const edgeStyle: CSSProperties = {
    ...(style || {}),
    stroke: getStrokeColor(),
    strokeWidth,
    strokeDasharray,
    transition: 'stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease, filter 0.25s ease',
    opacity: resolvedOpacity,
    filter: (hovered || isSelfFocused)
      ? `drop-shadow(0 0 4px ${kindColor ? kindColor[theme.mode] + '80' : theme.mode === 'dark' ? 'rgba(56, 189, 248, 0.5)' : 'rgba(14, 116, 144, 0.35)'})`
      : 'none',
  };

  const hitAreaStyle: CSSProperties = {
    stroke: 'transparent',
    strokeWidth: 24,
    fill: 'none',
    cursor: 'pointer',
  };

  const showLabel = (hovered || isSelfFocused || isNodeRelated) && !isDimmed;
  const showLabelMuted = isIntraContainer && !hovered && !isSelfFocused;

  return (
    <>
      <path
        d={edgePath}
        style={hitAreaStyle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {(hovered || isSelfFocused) && !hasError && (
        <path
          d={edgePath}
          className="sg-edge-flow"
          style={{
            stroke: kindColor
              ? kindColor[theme.mode] + '99'
              : theme.mode === 'dark' ? 'rgba(56, 189, 248, 0.6)' : 'rgba(14, 116, 144, 0.4)',
            strokeWidth: 3,
            strokeDasharray: '2,12',
            strokeLinecap: 'round',
            fill: 'none',
            opacity: resolvedOpacity,
            pointerEvents: 'none',
          }}
        />
      )}

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={resolvedMarkerEnd}
        markerStart={markerStart}
        style={edgeStyle}
      />

      {label && typeof label === 'string' && (
        <EdgeLabelRenderer>
          <EdgeLabel
            label={label}
            x={labelX}
            y={labelY}
            hasError={hasError}
            hasWarning={hasWarning}
            contractStatus={contractStatus}
            theme={theme}
            muted={showLabelMuted}
            hidden={!showLabel && !hasError}
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
});

CustomEdge.displayName = 'CustomEdge';
