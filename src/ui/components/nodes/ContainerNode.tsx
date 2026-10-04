import { memo, useCallback, useEffect, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { FallbackHandles } from './FallbackHandles.js';
import { LeafHandles } from './LeafHandles.js';
import { NodeResizer, useStore } from '@xyflow/react';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { dataShapeCounts } from '../../adapters/data-shape.js';
import { NodeIcon } from '../common/index.js';
import { ContainerConnectionBadge } from './ContainerConnectionBadge.js';
import { getTechnologyLogo } from '../../utils/technology-logo-map.js';

interface ContainerNodeProps {
  data: RFNodeData;
  selected?: boolean;
  highlighted?: boolean;
  id: string;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  nodeId: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ContainerNodeErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ContainerNode] Error rendering node ${this.props.nodeId}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '20px',
            borderRadius: '8px',
            border: '2px solid #ef4444',
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            fontSize: '14px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <strong>Container Node Error</strong>
          <br />
          {this.state.error?.message}
        </div>
      );
    }

    return this.props.children;
  }
}

const LAYER_COLORS = {
  infrastructure: { dark: '#3b82f6', light: '#2563eb' },
  orchestration: { dark: '#0ea5e9', light: '#0284c7' },
  runtime: { dark: '#10b981', light: '#059669' },
  logical: { dark: '#f59e0b', light: '#d97706' },
} as const;

function ContainerNodeComponent({ data, selected, highlighted, id }: ContainerNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';

  const metadataSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMetadataUpdatesRef = useRef<Record<string, unknown>>({});

  const { node, allNodes, selectedNodes } = useStore((state) => {
    const nodes = state.nodes || [];
    const sel = nodes.filter(n => n.selected);
    return {
      node: nodes.find(n => n.id === id),
      allNodes: nodes,
      selectedNodes: sel,
    };
  });

  // AB.7: an exploded node (functional view only) opens by its own toggle and
  // is closed until opened; a container keeps its expanded default.
  const isExpanded = data.exploded
    ? data.metadata?.partsShown === true
    : ((data.metadata?.containerExpanded as boolean | undefined) ?? true);
  const isCollapsed = !isExpanded;
  const isDropTarget = data.isDropTarget || false;

  const containerDef = getContainerTypeById(data.nodeType);
  const childCount = data.metadata?.childCount as number | undefined || 0;
  const isLogicalBoundary = containerDef?.containerStyle === 'logical-boundary';

  // N4.1 representative chip (N4.4 bench fix): dominant child technologies come from
  // the ADAPTER (graph truth, data.metadata.childTechnologies) — collapsed children
  // carry no parentId in the RF store, so a store lookup is empty exactly when the
  // chip is visible.
  const childTechIds = (isCollapsed && Array.isArray(data.metadata?.childTechnologies))
    ? (data.metadata.childTechnologies as string[])
    : [];

  const HIGHLIGHT_COLOR = '#22c55e';
  const DROP_TARGET_COLOR = '#22c55e';

  const calculateDepth = useCallback(() => {
    let depth = 0;
    let current = node;
    while (current?.parentId) {
      depth++;
      current = allNodes.find(n => n.id === current!.parentId);
      if (!current || depth > 10) break;
    }
    return depth;
  }, [node, allNodes]);

  const nestingDepth = calculateDepth();

  const visualEnhancement = useCallback(() => {
    if (selectedNodes.length === 0) {
      return { opacity: 1, dimOthers: false };
    }
    if (selected) {
      return { opacity: 1, dimOthers: true };
    }
    const isAncestorOfSelected = selectedNodes.some(selectedNode => {
      let current: typeof selectedNode | undefined = selectedNode;
      while (current?.parentId) {
        if (current.parentId === id) return true;
        current = allNodes.find(n => n.id === current!.parentId);
      }
      return false;
    });
    if (isAncestorOfSelected) {
      return { opacity: 0.85, dimOthers: true };
    }
    const isDescendantOfSelected = selectedNodes.some(selectedNode => {
      let current = node;
      while (current?.parentId) {
        if (current.parentId === selectedNode.id) return true;
        current = allNodes.find(n => n.id === current!.parentId);
      }
      return false;
    });
    if (isDescendantOfSelected) {
      return { opacity: 0.9, dimOthers: true };
    }
    return { opacity: 0.35, dimOthers: true };
  }, [selectedNodes, selected, allNodes, node, id]);

  const { opacity: containerOpacity, dimOthers } = visualEnhancement();

  const layer = containerDef?.layer ?? 'infrastructure';
  const layerEntry = LAYER_COLORS[layer as keyof typeof LAYER_COLORS] ?? LAYER_COLORS.infrastructure;
  // AA.3: an exploded node keeps its own colour; it is the node, not a hosting layer.
  const layerColor = data.exploded && typeof data.color === 'string' && data.color
    ? data.color
    : (isDark ? layerEntry.dark : layerEntry.light);
  const childNoun = data.exploded ? 'part' : 'node';
  // AA.3b: an exploded data store carries its model and counts.
  const dataShape = data.dataShape;

  const currentTransitionPhase = data.transitionPhase ?? 'idle';
  const isEntering = currentTransitionPhase === 'entering-nested';
  const isExiting = currentTransitionPhase === 'exiting-nested';
  const transitionAnimationName = isEntering ? 'containerEnter' : isExiting ? 'containerExit' : 'none';
  const transitionDuration = isEntering ? '300ms' : isExiting ? '250ms' : '0ms';

  const containerStyles: React.CSSProperties = isCollapsed ? {
    padding: '14px 18px',
    borderRadius: '10px',
    border: `2px solid ${layerColor}`,
    backgroundColor: isDark ? 'rgba(55, 62, 85, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    color: c.text,
    width: '220px',
    height: '70px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    boxShadow: selected
      ? `0 0 0 3px ${c.primary}35`
      : `0 1px 4px rgba(0, 0, 0, ${isDark ? '0.3' : '0.08'})`,
    overflow: 'visible',
    transition: 'all 0.25s ease',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
    opacity: containerOpacity,
    animationName: transitionAnimationName,
    animationDuration: transitionDuration,
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    animationFillMode: 'both',
  } : {
    padding: '48px 24px 24px 24px',
    borderRadius: isLogicalBoundary ? '10px' : '12px',
    border: isLogicalBoundary
      ? `1.5px dashed ${layerColor}90`
      : `2px solid ${isDark ? layerColor + '90' : layerColor + '50'}`,
    borderTop: isLogicalBoundary
      ? `1.5px dashed ${layerColor}90`
      : `3px solid ${layerColor}`,
    backgroundColor: isLogicalBoundary
      ? (isDark ? 'rgba(55, 62, 85, 0.65)' : 'rgba(248, 250, 252, 0.4)')
      : (isDark ? 'rgba(55, 62, 85, 0.8)' : 'rgba(248, 250, 252, 0.65)'),
    color: c.text,
    width: '100%',
    height: '100%',
    minWidth: '350px',
    minHeight: isLogicalBoundary ? '200px' : '260px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    borderColor: isDropTarget
      ? DROP_TARGET_COLOR
      : selected
        ? c.primary
        : highlighted
          ? HIGHLIGHT_COLOR
          : undefined,
    borderWidth: isDropTarget || selected || highlighted
      ? (isLogicalBoundary ? '2px' : '3px')
      : undefined,
    borderStyle: isDropTarget ? 'solid' : undefined,
    boxShadow: isDropTarget
      ? `0 0 0 3px ${DROP_TARGET_COLOR}40, 0 0 16px ${DROP_TARGET_COLOR}20`
      : selected
        ? `0 0 0 3px ${c.primary}30`
        : highlighted
          ? `0 0 0 3px ${HIGHLIGHT_COLOR}25`
          : `0 1px 3px rgba(0, 0, 0, ${isDark ? '0.15' : '0.06'})`,
    overflow: 'visible',
    transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
    opacity: containerOpacity,
    filter: dimOthers && containerOpacity < 0.5 ? 'grayscale(0.2)' : 'none',
    animationName: transitionAnimationName,
    animationDuration: transitionDuration,
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    animationFillMode: 'both',
  };

  useEffect(() => {
    return () => {
      if (metadataSaveTimerRef.current) {
        clearTimeout(metadataSaveTimerRef.current);
        metadataSaveTimerRef.current = null;
      }
    };
  }, []);

  const debouncedMetadataSave = useCallback((updates: Record<string, unknown>) => {
    pendingMetadataUpdatesRef.current = {
      ...pendingMetadataUpdatesRef.current,
      ...updates,
    };
    if (metadataSaveTimerRef.current) {
      clearTimeout(metadataSaveTimerRef.current);
    }
    metadataSaveTimerRef.current = setTimeout(() => {
      const batchedUpdates = { ...pendingMetadataUpdatesRef.current };
      if (data.onUpdateMetadata && Object.keys(batchedUpdates).length > 0) {
        data.onUpdateMetadata(batchedUpdates);
      }
      pendingMetadataUpdatesRef.current = {};
      metadataSaveTimerRef.current = null;
    }, 300);
  }, [data]);

  // AB.7: say what opens. A data store opens into its schema, any other
  // exploded node into its parts.
  const toggleWords = data.exploded
    ? `${isExpanded ? 'Hide' : 'Show'} ${data.dataShape ? 'schema' : 'parts'}`
    : isExpanded ? 'Collapse container' : 'Expand container';

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!data.onUpdateMetadata) return;
    if (data.exploded) {
      data.onUpdateMetadata({ partsShown: !isExpanded });
      return;
    }
    if (!node) return;
    if (isExpanded) {
      const currentWidth = node.width ?? 600;
      const currentHeight = node.height ?? 400;
      data.onUpdateMetadata({
        containerExpanded: false,
        width: currentWidth,
        height: currentHeight,
      });
    } else {
      data.onUpdateMetadata({ containerExpanded: true });
    }
  }, [data, isExpanded, node]);

  const handleResize = useCallback(
    (_event: unknown, params: { width?: number; height?: number }) => {
      if (!params.width || !params.height || params.width <= 0 || params.height <= 0) return;
      debouncedMetadataSave({ width: params.width, height: params.height });
    },
    [debouncedMetadataSave]
  );

  const resizerVisible = selected && isExpanded && !isLogicalBoundary;

  const layerLabel = data.exploded ? (data.nodeTypeLabel ?? '') : isLogicalBoundary ? 'boundary' : (containerDef?.layer ?? '');

  return (
    <>
      <NodeResizer
        isVisible={resizerVisible}
        minWidth={350}
        minHeight={260}
        maxWidth={3000}
        maxHeight={2400}
        keepAspectRatio={false}
        color={layerColor}
        onResize={(event, params) => handleResize(event, params)}
        handleStyle={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: isDark ? '#1e293b' : '#ffffff',
          border: `2px solid ${layerColor}`,
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)',
          pointerEvents: 'auto',
          cursor: 'nwse-resize',
        }}
        lineStyle={{
          borderColor: `${layerColor}50`,
          borderWidth: '1px',
          borderStyle: 'dashed',
          pointerEvents: 'none',
        }}
      />
      <div style={containerStyles} {...toolbarHover.nodeHoverProps}>
        {!isCollapsed && (
          <div style={{
            position: 'absolute',
            top: '-1px',
            left: '16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 14px',
            fontSize: '12px',
            fontWeight: 600,
            color: '#ffffff',
            backgroundColor: layerColor,
            borderRadius: '0 0 8px 8px',
            letterSpacing: '0.2px',
            whiteSpace: 'nowrap',
            zIndex: 10,
            boxShadow: `0 2px 4px ${layerColor}30`,
          }}>
            <NodeIcon
              nodeType={data.nodeType}
              technology={data.technology}
              emojiIcon={containerDef?.icon}
              size={14}
              position="center"
            />
            <span>{data.label}</span>
          </div>
        )}

        {!isCollapsed && dataShape && (
          <div
            data-testid="data-shape-strip"
            style={{
              position: 'absolute',
              top: '36px',
              left: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '8px',
              backgroundColor: isDark ? `${layerColor}1f` : `${layerColor}14`,
              fontSize: '12px',
              whiteSpace: 'nowrap',
              zIndex: 10,
            }}
          >
            {dataShape.model && <span style={{ fontWeight: 600, color: layerColor }}>{dataShape.model}</span>}
            <span style={{ color: c.textMuted }}>{dataShape.model ? '· ' : ''}{dataShapeCounts(dataShape)}</span>
          </div>
        )}

        {!isCollapsed && layerLabel && (
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '48px',
            fontSize: '9px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '4px',
            backgroundColor: isDark ? `${layerColor}15` : `${layerColor}10`,
            color: layerColor,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            border: `1px solid ${layerColor}25`,
          }}>
            {layerLabel}
          </div>
        )}

        {nestingDepth > 0 && !isCollapsed && (
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '12px',
            fontSize: '9px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '4px',
            backgroundColor: `${layerColor}15`,
            color: layerColor,
            letterSpacing: '0.3px',
          }}>
            L{nestingDepth}
          </div>
        )}

        <button
          type="button"
          style={{
            position: 'absolute',
            top: isCollapsed ? '50%' : '6px',
            right: '8px',
            transform: isCollapsed ? 'translateY(-50%)' : 'none',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            border: `1.5px solid ${layerColor}60`,
            backgroundColor: isDark ? 'rgba(50, 56, 78, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            color: layerColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            transition: 'all 0.15s ease',
            zIndex: 11000,
            pointerEvents: 'auto',
          }}
          onClick={(e) => { e.stopPropagation(); handleToggleExpand(e); }}
          title={toggleWords}
          aria-label={`${toggleWords}: ${data.label}`}
          className="nodrag nopan"
        >
          {isCollapsed ? '+' : '\u2212'}
        </button>

        {!isCollapsed && childCount > 0 && (
          <button
            type="button"
            style={{
              position: 'absolute',
              top: '6px',
              right: '36px',
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              border: `1.5px solid ${layerColor}60`,
              backgroundColor: isDark ? 'rgba(50, 56, 78, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              color: layerColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '12px',
              transition: 'all 0.15s ease',
              zIndex: 11000,
              pointerEvents: 'auto',
            }}
            onClick={(e) => { e.stopPropagation(); data.onFitChildren?.(); }}
            title="Auto-layout children"
            className="nodrag nopan"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        )}

        <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />

        {/* AG.13/AG.14: an exploded node's box is a leaf and takes edges; a
            container takes none (an edge ends on the node inside), so it draws
            only the invisible handles its summary edges end on. */}
        {data.exploded ? (
          <LeafHandles
            style={{
              width: isCollapsed ? '8px' : '10px',
              height: isCollapsed ? '8px' : '10px',
              backgroundColor: layerColor,
              border: `2px solid ${isDark ? '#1e293b' : '#ffffff'}`,
              top: isCollapsed ? '50%' : '52px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            }}
          />
        ) : (
          <FallbackHandles showTarget showSource />
        )}

        {!isCollapsed && (
          <>
            {childCount > 0 && (
              <div style={{
                position: 'absolute',
                bottom: '8px',
                right: '12px',
                fontSize: '10px',
                fontWeight: 500,
                color: c.textMuted,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <span style={{ opacity: 0.6 }}>{childCount} {childCount === 1 ? childNoun : `${childNoun}s`}</span>
              </div>
            )}
          </>
        )}

        {isCollapsed && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            alignItems: 'flex-start',
            width: '100%',
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: c.text,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <NodeIcon
                nodeType={data.nodeType}
                technology={data.technology}
                emojiIcon={containerDef?.icon}
                size={14}
                position="center"
              />
              <span>{data.label}</span>
            </div>
            {dataShape && (
              <div data-testid="data-shape-strip" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}>
                {dataShape.model && <span style={{ fontWeight: 600, color: layerColor }}>{dataShape.model}</span>}
                <span style={{ color: c.textMuted }}>{dataShape.model ? '· ' : ''}{dataShapeCounts(dataShape)}</span>
              </div>
            )}
            {childCount > 0 && !dataShape && (
              <div style={{ fontSize: '10px', fontWeight: 500, color: c.textMuted, display: 'flex', alignItems: 'center', gap: '5px' }}>
                {childTechIds.length > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    {childTechIds.map(techId => {
                      const logo = getTechnologyLogo(techId);
                      return logo ? (
                        <img key={techId} src={logo} alt={techId} title={techId} style={{ width: '12px', height: '12px', objectFit: 'contain' }} />
                      ) : (
                        <span key={techId} title={techId} style={{ fontSize: '9px', fontWeight: 700, color: c.text }}>
                          {techId.charAt(0).toUpperCase()}
                        </span>
                      );
                    })}
                  </span>
                )}
                <span>{childCount} {childCount === 1 ? childNoun : `${childNoun}s`}</span>
              </div>
            )}
          </div>
        )}

        {data.layerMode === 'nested' && data.crossContainerSummaries && data.crossContainerSummaries.length > 0 && (
          <ContainerConnectionBadge
            summaries={data.crossContainerSummaries}
            layerColor={layerColor}
          />
        )}

      </div>
    </>
  );
}

const ContainerNodeWithErrorBoundary = memo(({ data, selected, highlighted, id }: ContainerNodeProps) => (
  <ContainerNodeErrorBoundary nodeId={id}>
    <ContainerNodeComponent data={data} selected={selected} highlighted={highlighted} id={id} />
  </ContainerNodeErrorBoundary>
));

ContainerNodeWithErrorBoundary.displayName = 'ContainerNode';

export const ContainerNode = ContainerNodeWithErrorBoundary;
