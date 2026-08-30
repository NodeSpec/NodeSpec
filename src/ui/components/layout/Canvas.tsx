import { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type NodeChange,
  type EdgeChange,
  ReactFlowProvider,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Graph, PatchOperation, ActorType } from '@nodespec/core/types.js';
import type { SpecificationData } from '../../hooks/useRealtimeSpecification.js';
import type { ProjectExportTestCase } from '../../utils/export-context.js';
import { deriveRFState, computeCrossContainerSummaries, generateContainerSummaryEdges, enrichNodesWithCriteriaProgress, enrichNodesWithTestSummary, type TestSummaryByNodeId, type SpecGraphRFNode, type SpecGraphRFEdge, type ArchitectureLayerMode, type DeriveRFStateOptions } from '../../adapters/graph-to-reactflow.js';
import { isContainerType, isLogicalBoundaryType } from '../../adapters/rf-visual-type-resolver.js';
import { layoutContainerChildren, computeAllContainerLayouts } from '../../utils/container-child-layout.js';
import { providerOfNode } from '@nodespec/core/container-types.js';
import {
  planFlatToNested,
  planNestedToFlat,
  ENTER_DURATION_MS,
  EXIT_DURATION_MS,
  SETTLE_DELAY_MS,
  type TransitionPhase,
} from '../../utils/layer-transition.js';
import {
  mapNodeChangesToPatches,
  mapEdgeChangesToPatches,
  mapConnectionToPatches,
  mapDeleteSelectionToPatches,
} from '../../adapters/interaction-to-patch.js';
import { nodeTypes } from '../nodes/index.js';
import { edgeTypes } from '../edges/index.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { buildRemoveNodePatch, buildRemoveEdgePatch } from '../../builders/patchBuilders.js';
import { createAddNodePatch, createNodeFromTemplatePatch, createRemoveArtifactPatch, createUpdateArtifactPatch, createUpdateNodePatch } from '@nodespec/core/patch-factory.js';
import { generateUUID } from '@nodespec/core/utils.js';
import { getNodeTypeById } from '@nodespec/core/node-types.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { Trash2 } from 'lucide-react';
import { calculateAutoLayout } from '../../utils/auto-layout.js';
import { calculateElkLayout } from '../../utils/elk-layout.js';
import { ViewToggle, CanvasDock, type CanvasViewMode } from '../common/index.js';
import type { NodeSizeMode } from '../common/CanvasDock.js';
import { DecompositionCanvas } from './DecompositionCanvas.js';
import { SpecificationMarkdownView } from './SpecificationMarkdownView.js';
import type { ProjectSpecification } from '../../services/SpecificationService.js';
import { CatalogService } from '../../services/CatalogService.js';
import type { CatalogResolver, TechnologyCatalogEntry, NodeRole } from '../../../persistence/supabase/catalog-repository.js';
import { TechnologyPicker } from '../common/TechnologyPicker.js';
import { UsagePicker, type UsageOption } from '../common/UsagePicker.js';
import { usagePhraseForRole, providerPlatformRoleId } from '../../utils/node-nature.js';
import { resolveNodeCreationParams } from '../../utils/palette-roles.js';
import { liveDropAffinities } from '../../utils/palette-list.js';
import { isCustomDependencyRole } from '../../utils/node-nature.js';
import { buildNodePatchesFromRole } from '../../utils/node-creation.js';
import { useDragReparent } from '../../hooks/useDragReparent.js';
import { zoomBandForZoom, demotesToIcon, type ZoomBand } from '../../utils/semantic-zoom.js';

interface CanvasProps {
  graph: Graph;
  onPatchesGenerated?: (patches: PatchOperation[]) => void;
  onWarning?: (message: string) => void;
  onError?: (message: string) => void;
  onNodeSelect?: (nodeId: string) => void;
  onEdgeSelect?: (edgeId: string) => void;
  /** P1-7 C2: node context-menu export of the anchor-slice context JSON. */
  onBackgroundClick?: () => void;
  actorType?: ActorType;
  highlightedNodeIds?: Set<string>;
  projectId?: string | null;
  specification?: ProjectSpecification;
  onEditSpecification?: (spec: ProjectSpecification) => void;
  viewMode?: CanvasViewMode;
  onViewModeChange?: (mode: CanvasViewMode) => void;
  isRefreshing?: boolean;
  refreshCounter?: number;
  workflowOrigin?: 'idea' | 'code' | 'import-spec';
  onNodeExport?: (nodeId: string) => void;
  criteriaByNodeId?: Map<string, Array<{ text: string; met?: boolean; testId?: string }>>;
  testSummaryByNodeId?: TestSummaryByNodeId;
  testRefreshCounter?: number;
  onExportProject?: () => void;
  specRealtimeData?: SpecificationData;
  projectName?: string;
  testSuiteData?: ProjectExportTestCase[];
  onSpecDirtyChange?: (dirty: boolean) => void;
  branchId?: string | null;
  onSpecImportComplete?: () => void;
}

const POSITIONS_STORAGE_KEY = 'specgraph_node_positions';
const VISUAL_META_STORAGE_KEY = 'specgraph_visual_metadata';
const FOCUS_MODE_STORAGE_KEY = 'specgraph_focus_mode';

type FocusMode = 'off' | 'highlight' | 'isolate';

const VISUAL_META_KEYS = new Set([
  'containerExpanded',
  'width',
  'height',
  'expandedWidth',
  'expandedHeight',
]);

function positionsStorageKey(projectId?: string | null): string {
  return projectId ? `${POSITIONS_STORAGE_KEY}_${projectId}` : POSITIONS_STORAGE_KEY;
}

function visualMetaStorageKey(projectId?: string | null): string {
  return projectId ? `${VISUAL_META_STORAGE_KEY}_${projectId}` : VISUAL_META_STORAGE_KEY;
}

function loadPositionsFromStorage(projectId?: string | null): Map<string, { x: number; y: number }> {
  try {
    const stored = localStorage.getItem(positionsStorageKey(projectId));
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.warn('Failed to load node positions from storage:', e);
  }
  return new Map();
}

function savePositionsToStorage(positions: Map<string, { x: number; y: number }>, projectId?: string | null) {
  try {
    const obj = Object.fromEntries(positions);
    localStorage.setItem(positionsStorageKey(projectId), JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to save node positions to storage:', e);
  }
}

function loadVisualMetaFromStorage(projectId?: string | null): Map<string, Record<string, unknown>> {
  try {
    const stored = localStorage.getItem(visualMetaStorageKey(projectId));
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.warn('Failed to load visual metadata from storage:', e);
  }
  return new Map();
}

function saveVisualMetaToStorage(meta: Map<string, Record<string, unknown>>, projectId?: string | null) {
  try {
    const obj = Object.fromEntries(meta);
    localStorage.setItem(visualMetaStorageKey(projectId), JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to save visual metadata to storage:', e);
  }
}

function CanvasInner({
  graph,
  onPatchesGenerated,
  onWarning,
  onError,
  onNodeSelect,
  onEdgeSelect,
  onBackgroundClick,
  actorType = 'human',
  highlightedNodeIds = new Set(),
  projectId,
  specification,
  onEditSpecification,
  viewMode: externalViewMode = 'decomposition',
  onViewModeChange,
  isRefreshing = false,
  refreshCounter,
  workflowOrigin,
  onNodeExport,
  criteriaByNodeId,
  testSummaryByNodeId,
  testRefreshCounter,
  onExportProject,
  specRealtimeData,
  projectName: canvasProjectName,
  testSuiteData,
  onSpecDirtyChange,
  branchId,
  onSpecImportComplete,
}: CanvasProps) {
  const { theme } = useTheme();
  const reactFlowInstance = useReactFlow();
  const previousGraphRef = useRef<Graph>(graph);
  const savedPositions = useRef<Map<string, { x: number; y: number }>>(loadPositionsFromStorage(projectId));
  const savedVisualMeta = useRef<Map<string, Record<string, unknown>>>(loadVisualMetaFromStorage(projectId));
  const handleAutoLayoutRef = useRef<(() => void) | null>(null);
  // Owner 2026-07-29: nodes that arrive WITHOUT any position (no saved, no
  // metadata — i.e. patch-proposal / MCP-pushed nodes that would land at a
  // random spot) are tracked here; the next refresh in architecture view
  // auto-arranges the canvas as if the auto-layout button was clicked.
  const randomSeededIdsRef = useRef<Set<string>>(new Set());
  const [localPositions, setLocalPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [localVisualMeta, setLocalVisualMeta] = useState<Map<string, Record<string, unknown>>>(savedVisualMeta.current);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [focusedEdgeId, setFocusedEdgeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [lockedFocusNodeId, setLockedFocusNodeId] = useState<string | null>(null);
  const [focusMode, setFocusModeRaw] = useState<FocusMode>(() => {
    try {
      const stored = localStorage.getItem(FOCUS_MODE_STORAGE_KEY);
      if (stored === 'off' || stored === 'highlight' || stored === 'isolate') return stored;
    } catch {}
    return 'off';
  });
  const setFocusMode = useCallback((m: FocusMode) => {
    setFocusModeRaw(m);
    try { localStorage.setItem(FOCUS_MODE_STORAGE_KEY, m); } catch {}
    if (m === 'off') setLockedFocusNodeId(null);
  }, []);
  const [catalog, setCatalog] = useState<CatalogResolver | null>(null);
  const [techPickerState, setTechPickerState] = useState<{
    position: { x: number; y: number };
    role: NodeRole;
    technologies: TechnologyCatalogEntry[];
    flowPosition: { x: number; y: number };
    parentContainerId: string | undefined;
  } | null>(null);
  // N3.7: role disambiguation for a multi-affinity technology drop, asked in usage terms.
  const [usagePickerState, setUsagePickerState] = useState<{
    position: { x: number; y: number };
    technologyId: string;
    technologyName: string;
    options: UsageOption[];
    flowPosition: { x: number; y: number };
    parentContainerId: string | undefined;
  } | null>(null);
  const viewMode = externalViewMode;
  const setViewMode = onViewModeChange || (() => {});
  const [layerMode, setLayerMode] = useState<ArchitectureLayerMode>('flat');
  const [nodeSize, setNodeSizeRaw] = useState<NodeSizeMode>(() => {
    try {
      const stored = localStorage.getItem('specgraph_node_size');
      if (stored === 'regular' || stored === 'compact') return stored;
    } catch {}
    return 'regular';
  });
  const setNodeSize = useCallback((s: NodeSizeMode) => {
    setNodeSizeRaw(s);
    try { localStorage.setItem('specgraph_node_size', s); } catch {}
  }, []);
  const [autoCollapseNotified, setAutoCollapseNotified] = useState(false);
  // N4 semantic zoom: discrete band derived from viewport zoom at gesture end (no
  // per-frame churn). Drives icon demotion only — container collapse is manual (N4.5).
  const [zoomBand, setZoomBand] = useState<ZoomBand>('detail');
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('idle');
  const transitionTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    CatalogService.getResolver().then(setCatalog).catch(() => {});
  }, []);

  const {
    dropTargetId,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
  } = useDragReparent(graph, catalog, actorType, onPatchesGenerated, onWarning);

  const dimensionSaveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pendingDimensionUpdatesRef = useRef<Map<string, { width: number; height: number }>>(new Map());

  const canvasStyles: React.CSSProperties = useMemo(() => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: theme.colors.backgroundTertiary,
  }), [theme.colors.backgroundTertiary]);

  // The canvas renders the CANONICAL graph — never an inferred variant. applyInferredNesting
  // used to fake parentIds here from edges+canContain (nested mode only), which made
  // unparented nodes RENDER inside containers they weren't part of: drag-out "worked", the
  // collapsed count included phantom children, and the visual disagreed with model.json —
  // a truth violation under the authority model (bench-found 2026-07-21). If nesting is
  // ever suggested again, it goes through proposals (real patches), not the renderer.
  // `nestedGraph` stays as an alias so every downstream consumer (summary edges, layer
  // transitions, container layouts) reads the same canonical structure.
  const nestedGraph = graph;
  const baseEffectiveGraph = graph;

  const effectiveGraph = useMemo(() => {
    if (localVisualMeta.size === 0) return baseEffectiveGraph;
    let changed = false;
    const mergedNodes: Record<string, typeof baseEffectiveGraph.nodes[string]> = {};
    for (const [id, node] of Object.entries(baseEffectiveGraph.nodes)) {
      const overlay = localVisualMeta.get(id);
      if (overlay) {
        changed = true;
        mergedNodes[id] = { ...node, metadata: { ...node.metadata, ...overlay } };
      } else {
        mergedNodes[id] = node;
      }
    }
    if (!changed) return baseEffectiveGraph;
    return { ...baseEffectiveGraph, nodes: mergedNodes };
  }, [baseEffectiveGraph, localVisualMeta]);

  const deriveOptions = useMemo<DeriveRFStateOptions>(() => ({
    maxDepth: undefined,
    autoCollapseDepth: 3,
  }), []);

  const rawRfState = useMemo(() => deriveRFState(effectiveGraph, layerMode, catalog, deriveOptions), [effectiveGraph, layerMode, catalog, deriveOptions]);

  const rfState = useMemo(() => {
    let nodes = rawRfState.nodes;
    if (criteriaByNodeId && criteriaByNodeId.size > 0) {
      nodes = enrichNodesWithCriteriaProgress(nodes, criteriaByNodeId);
    }
    if (testSummaryByNodeId && Object.keys(testSummaryByNodeId).length > 0) {
      nodes = enrichNodesWithTestSummary(nodes, testSummaryByNodeId);
    }
    if (nodes === rawRfState.nodes) return rawRfState;
    return { ...rawRfState, nodes };
  }, [rawRfState, criteriaByNodeId, testSummaryByNodeId]);

  const updateVisualMeta = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    setLocalVisualMeta(prev => {
      const next = new Map(prev);
      const existing = next.get(nodeId) || {};
      next.set(nodeId, { ...existing, ...updates });
      savedVisualMeta.current = next;
      saveVisualMetaToStorage(next, projectId);
      return next;
    });
  }, [projectId]);

  useEffect(() => {
    if (rawRfState.autoCollapsedNodeIds.length === 0 || autoCollapseNotified) return;

    let collapsed = 0;
    for (const nodeId of rawRfState.autoCollapsedNodeIds) {
      const node = effectiveGraph.nodes[nodeId];
      if (!node) continue;
      const currentMetadata = node.metadata || {};
      if (currentMetadata.containerExpanded !== undefined) continue;

      updateVisualMeta(nodeId, { containerExpanded: false });
      collapsed++;
    }

    if (collapsed > 0) {
      onWarning?.('Deep nesting detected -- inner layers collapsed. Click any container to expand.');
      setAutoCollapseNotified(true);
    }
  }, [rawRfState.autoCollapsedNodeIds, autoCollapseNotified, effectiveGraph.nodes, updateVisualMeta, onWarning]);

  useEffect(() => {
    setLocalPositions((prev) => {
      const updated = new Map(prev);
      let changed = false;

      for (const node of rfState.nodes) {
        if (!updated.has(node.id)) {
          const metadataPosition = node.data?.metadata?.position as { x: number; y: number } | undefined;
          const knownPosition = savedPositions.current.get(node.id) ?? metadataPosition;
          if (!knownPosition) {
            randomSeededIdsRef.current.add(node.id);
          }
          const position = knownPosition
            ?? { x: Math.random() * 400, y: Math.random() * 400 };
          updated.set(node.id, position);
          changed = true;
        }
      }

      const currentNodeIds = new Set(rfState.nodes.map(n => n.id));
      for (const id of updated.keys()) {
        if (!currentNodeIds.has(id)) {
          updated.delete(id);
          changed = true;
        }
      }

      return changed ? updated : prev;
    });
  }, [rfState.nodes]);

  // Section 9: Cleanup dimension save timers on unmount
  useEffect(() => {
    return () => {
      dimensionSaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      dimensionSaveTimersRef.current.clear();
    };
  }, []);

  const handleUpdateNodeMetadata = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    const node = effectiveGraph.nodes[nodeId];
    if (!node) return;

    const currentMetadata = node.metadata || {};

    const visualUpdates: Record<string, unknown> = {};
    const structuralUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (VISUAL_META_KEYS.has(key)) {
        visualUpdates[key] = value;
      } else {
        structuralUpdates[key] = value;
      }
    }

    if ('containerExpanded' in visualUpdates) {
      const isExpanding = visualUpdates.containerExpanded === true;

      const rfNode = reactFlowInstance.getNode(nodeId);
      const currentWidth = rfNode?.width || (currentMetadata.width as number) || 600;
      const currentHeight = rfNode?.height || (currentMetadata.height as number) || 450;

      if (!isExpanding) {
        visualUpdates.expandedWidth = currentWidth;
        visualUpdates.expandedHeight = currentHeight;
        visualUpdates.width = 240;
        visualUpdates.height = 80;
      } else {
        const expandedWidth = (typeof currentMetadata.expandedWidth === 'number' ? currentMetadata.expandedWidth : 600);
        const expandedHeight = (typeof currentMetadata.expandedHeight === 'number' ? currentMetadata.expandedHeight : 450);
        visualUpdates.width = expandedWidth;
        visualUpdates.height = expandedHeight;
      }
    }

    if (Object.keys(visualUpdates).length > 0) {
      updateVisualMeta(nodeId, visualUpdates);
    }

    if (Object.keys(structuralUpdates).length > 0) {
      const patch = createUpdateNodePatch(
        nodeId,
        { metadata: { ...currentMetadata, ...structuralUpdates } },
        {
          actorType,
          summary: `Update ${node.label} metadata`,
        }
      );
      onPatchesGenerated?.([patch]);
    }
  }, [effectiveGraph.nodes, actorType, onPatchesGenerated, reactFlowInstance, updateVisualMeta]);

  const debouncedDimensionSave = useCallback((nodeId: string, width: number, height: number) => {
    pendingDimensionUpdatesRef.current.set(nodeId, { width, height });

    const existingTimer = dimensionSaveTimersRef.current.get(nodeId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const pendingUpdate = pendingDimensionUpdatesRef.current.get(nodeId);
      if (pendingUpdate) {
        updateVisualMeta(nodeId, pendingUpdate);
        pendingDimensionUpdatesRef.current.delete(nodeId);
        dimensionSaveTimersRef.current.delete(nodeId);
      }
    }, 300);

    dimensionSaveTimersRef.current.set(nodeId, timer);
  }, [updateVisualMeta]);

  const handleToggleLock = useCallback((nodeId: string) => {
    if (!specification || !onEditSpecification) {
      return;
    }

    const lockedNodes = specification.lockedNodes || [];
    const isCurrentlyLocked = lockedNodes.includes(nodeId);

    const updatedLockedNodes = isCurrentlyLocked
      ? lockedNodes.filter((id: string) => id !== nodeId)
      : [...lockedNodes, nodeId];

    onEditSpecification({
      ...specification,
      lockedNodes: updatedLockedNodes,
    });
  }, [specification, onEditSpecification]);

  const lockedNodesSet = useMemo(() => {
    return new Set(specification?.lockedNodes || []);
  }, [specification?.lockedNodes]);

  // Owner merge ruling 2026-08-13: the scaffold action is retired (its chat
  // pane went with the internal agent), and delete/undock move INTO the node
  // pane. Both handlers are declared here — above the nodes useMemo that
  // closes over them — because a useCallback const below it would still be in
  // its temporal dead zone when the memo body runs on first render.
  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = graph.nodes[nodeId];
    if (!node) {
      onError?.('Node not found');
      return;
    }

    const connectedEdges = Object.values(graph.edges).filter(
      (edge) => edge.source === nodeId || edge.target === nodeId
    );

    if (connectedEdges.length > 0) {
      onError?.(`Cannot delete node "${node.label}": it has ${connectedEdges.length} connected edge(s). Delete edges first.`);
      return;
    }

    try {
      const patches: PatchOperation[] = [];

      const ownedArtifacts = Object.entries(graph.artifacts).filter(
        ([_, artifact]) => artifact.nodeId === nodeId
      );

      for (const [artifactId, artifact] of ownedArtifacts) {
        if (artifact.status === 'complete') {
          patches.push(
            createUpdateArtifactPatch(artifactId, { status: 'draft' }, {
              actorType,
              summary: `Revert artifact "${artifact.path}" to draft (cascade from node "${node.label}")`,
            })
          );
        }
        const artifactPatch = createRemoveArtifactPatch(artifactId, {
          actorType,
          summary: `Delete artifact "${artifact.path}" (cascade from node "${node.label}")`,
        });
        patches.push(artifactPatch);
      }

      const nodePatch = buildRemoveNodePatch({
        nodeId,
        actor: actorType,
        summary: `Delete node "${node.label}"`,
      });
      patches.push(nodePatch);

      onPatchesGenerated?.(patches);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to delete node');
    }
  }, [graph, actorType, onPatchesGenerated, onError]);

  const handleUndockNode = useCallback((nodeId: string) => {
    const node = graph.nodes[nodeId];
    if (!node || !node.parentId) {
      onWarning?.('Node is not docked to a container');
      return;
    }

    const patch = createUpdateNodePatch(
      nodeId,
      { parentId: undefined },
      {
        actorType,
        summary: `Undock ${node.label} from container`,
      }
    );

    onPatchesGenerated?.([patch]);
  }, [graph.nodes, onPatchesGenerated, onWarning, actorType]);

  // UX-1.3: defined ABOVE the nodes memo that injects it into node data
  // (the toolbar's Dock popover) — a later definition would be TDZ at the
  // memo's first run.
  const handleAssignToContainer = useCallback((nodeId: string, containerId: string) => {
    const node = graph.nodes[nodeId];
    const container = graph.nodes[containerId];

    if (!node || !container) {
      onWarning?.('Node or container not found');
      return;
    }

    const patch = createUpdateNodePatch(
      nodeId,
      { parentId: containerId },
      {
        actorType,
        summary: `Assign ${node.label} to ${container.label}`,
      }
    );

    onPatchesGenerated?.([patch]);
  }, [graph.nodes, onPatchesGenerated, onWarning, actorType]);

  const crossContainerMap = useMemo(() => {
    if (layerMode !== 'nested') return new Map();
    return computeCrossContainerSummaries(nestedGraph, catalog);
  }, [nestedGraph, catalog, layerMode]);

  const containerSummaryEdges = useMemo(() => {
    if (layerMode !== 'nested') return [];
    return generateContainerSummaryEdges(nestedGraph, catalog);
  }, [nestedGraph, catalog, layerMode]);

  const handleFitChildren = useCallback((containerId: string) => {
    void (async () => {
      // ELK lays out the whole hierarchy; we apply only this container's
      // children (parent-relative coords) and its fitted size. Falls back
      // to the legacy per-container grid on failure.
      let childPositions: Array<{ id: string; x: number; y: number }> = [];
      let sizing: { width: number; height: number } | null = null;

      try {
        const childIds = new Set(
          Object.values(effectiveGraph.nodes)
            .filter((n) => n.parentId === containerId)
            .map((n) => n.id),
        );
        if (childIds.size > 0 && reactFlowInstance) {
          // Pull live nodes/edges (with measured dimensions) from the RF
          // instance -- the nodes/edges memos are declared later in this
          // component and can't be captured here.
          const liveNodes = reactFlowInstance.getNodes() as Parameters<typeof calculateElkLayout>[0];
          const liveEdges = reactFlowInstance.getEdges() as Parameters<typeof calculateElkLayout>[1];
          const elkResult = await calculateElkLayout(liveNodes, liveEdges, { direction: 'LR', catalog });
          childPositions = elkResult.positions.filter((p) => childIds.has(p.id));
          sizing = elkResult.containerSizes.get(containerId) ?? null;
        }
      } catch (err) {
        console.warn('[fit-children] ELK layout failed, using legacy layout:', err);
      }

      if (childPositions.length === 0 || !sizing) {
        const layout = layoutContainerChildren(containerId, effectiveGraph, catalog);
        if (layout.positions.length === 0) return;
        childPositions = layout.positions;
        sizing = layout.sizing;
      }

      const updatedPositions = new Map(localPositions);
      for (const pos of childPositions) {
        updatedPositions.set(pos.id, { x: pos.x, y: pos.y });
        savedPositions.current.set(pos.id, { x: pos.x, y: pos.y });
      }

      setLocalPositions(updatedPositions);
      savePositionsToStorage(savedPositions.current, projectId);

      handleUpdateNodeMetadata(containerId, {
        width: sizing.width,
        height: sizing.height,
      });
    })();
  }, [effectiveGraph, catalog, localPositions, handleUpdateNodeMetadata, reactFlowInstance]);

  const handleCollapseExpandAll = useCallback((expand: boolean) => {
    const containerNodeIds = Object.entries(effectiveGraph.nodes)
      .filter(([_, n]) => isContainerType(n.type, catalog) || isLogicalBoundaryType(n.type, catalog))
      .map(([id]) => id);

    if (containerNodeIds.length === 0) return;

    setLocalVisualMeta(prev => {
      const next = new Map(prev);
      for (const nodeId of containerNodeIds) {
        const node = effectiveGraph.nodes[nodeId];
        if (!node) continue;
        const currentMetadata = node.metadata || {};
        const isCurrentlyExpanded = (currentMetadata.containerExpanded as boolean | undefined) ?? true;
        if (isCurrentlyExpanded === expand) continue;

        const rfNode = reactFlowInstance.getNode(nodeId);
        const currentWidth = rfNode?.width || (currentMetadata.width as number) || 600;
        const currentHeight = rfNode?.height || (currentMetadata.height as number) || 450;

        const existing = next.get(nodeId) || {};
        if (!expand) {
          next.set(nodeId, {
            ...existing,
            containerExpanded: false,
            expandedWidth: currentWidth,
            expandedHeight: currentHeight,
            width: isLogicalBoundaryType(node.type, catalog) ? 220 : 240,
            height: isLogicalBoundaryType(node.type, catalog) ? 56 : 80,
          });
        } else {
          const expandedWidth = (typeof currentMetadata.expandedWidth === 'number' ? currentMetadata.expandedWidth : 600);
          const expandedHeight = (typeof currentMetadata.expandedHeight === 'number' ? currentMetadata.expandedHeight : 450);
          next.set(nodeId, {
            ...existing,
            containerExpanded: true,
            width: expandedWidth,
            height: expandedHeight,
          });
        }
      }
      savedVisualMeta.current = next;
      saveVisualMetaToStorage(next, projectId);
      return next;
    });
  }, [effectiveGraph.nodes, catalog, reactFlowInstance, projectId]);

  // N4.5 (owner 2026-07-23): the zoom-out container AUTO-collapse was removed — "doesn't
  // add value". The zoom bands + icon demotion stay (level-of-detail); collapsing
  // containers is manual only (per-container button / collapse-all), and the
  // representative chip renders on any collapsed container regardless of how it got
  // collapsed.

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

  const handleLayerModeToggle = useCallback((targetMode: ArchitectureLayerMode) => {
    if (targetMode === layerMode || transitionPhase !== 'idle') return;

    if (targetMode === 'nested') {
      const plan = planFlatToNested(nestedGraph, catalog, rfState.nodes, rfState.edges, localPositions);

      setTransitionPhase('entering-nested');
      setLayerMode('nested');

      const updatedPositions = new Map(localPositions);
      for (const [id, pos] of plan.targetPositions) {
        updatedPositions.set(id, pos);
        savedPositions.current.set(id, pos);
      }
      setLocalPositions(updatedPositions);
      savePositionsToStorage(savedPositions.current, projectId);

      transitionTimerRef.current = setTimeout(() => {
        setTransitionPhase('idle');

        const allLayouts = computeAllContainerLayouts(nestedGraph, catalog);
        for (const [containerId, layout] of allLayouts) {
          handleUpdateNodeMetadata(containerId, {
            width: layout.sizing.width,
            height: layout.sizing.height,
          });
        }

        setLocalPositions(prev => {
          const updated = new Map(prev);
          for (const [, layout] of allLayouts) {
            for (const pos of layout.positions) {
              updated.set(pos.id, { x: pos.x, y: pos.y });
              savedPositions.current.set(pos.id, { x: pos.x, y: pos.y });
            }
          }
          return updated;
        });
        savePositionsToStorage(savedPositions.current, projectId);

        setTimeout(() => {
          reactFlowInstance?.fitView({ duration: 400, padding: 0.15 });
        }, SETTLE_DELAY_MS);
      }, ENTER_DURATION_MS);
    } else {
      const plan = planNestedToFlat(nestedGraph, catalog, rfState.nodes, rfState.edges, localPositions);

      setTransitionPhase('exiting-nested');

      transitionTimerRef.current = setTimeout(() => {
        setLayerMode('flat');

        const updatedPositions = new Map(localPositions);
        for (const [id, pos] of plan.targetPositions) {
          updatedPositions.set(id, pos);
          savedPositions.current.set(id, pos);
        }
        setLocalPositions(updatedPositions);
        savePositionsToStorage(savedPositions.current, projectId);

        setTransitionPhase('idle');

        setTimeout(() => {
          reactFlowInstance?.fitView({ duration: 400, padding: 0.15 });
        }, SETTLE_DELAY_MS);
      }, EXIT_DURATION_MS);
    }
  }, [layerMode, transitionPhase, nestedGraph, catalog, rfState.nodes, rfState.edges, localPositions, reactFlowInstance]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === 'INPUT' ||
          (event.target as HTMLElement).tagName === 'TEXTAREA') {
        return;
      }

      if (event.key === 'f' && viewMode === 'architecture') {
        handleLayerModeToggle('flat');
      } else if (event.key === 'n' && viewMode === 'architecture') {
        handleLayerModeToggle('nested');
      } else if (event.key === 'Tab' && viewMode === 'architecture') {
        event.preventDefault();
        handleLayerModeToggle(layerMode === 'flat' ? 'nested' : 'flat');
      } else if (event.key === 's' && viewMode === 'architecture' && layerMode === 'flat') {
        setNodeSize(nodeSize === 'regular' ? 'compact' : 'regular');
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [viewMode, layerMode, handleLayerModeToggle, nodeSize, setNodeSize]);

  const effectiveNodeSize = layerMode === 'flat' ? nodeSize : 'regular';
  const nonCompactableTypes = new Set(['container', 'logicalBoundary', 'group', 'requirement', 'addSectionButton', 'architectureExplanation']);

  const focusRelatedNodeIds = useMemo(() => {
    if (focusMode === 'off' || !lockedFocusNodeId) return null;
    const nodeById = new Map(rfState.nodes.map(n => [n.id, n]));
    const related = new Set<string>();
    const addWithParents = (id: string) => {
      let cur: string | undefined = id;
      while (cur && !related.has(cur)) {
        related.add(cur);
        cur = nodeById.get(cur)?.parentId;
      }
    };
    addWithParents(lockedFocusNodeId);
    for (const e of rfState.edges) {
      if (e.source === lockedFocusNodeId) addWithParents(e.target);
      if (e.target === lockedFocusNodeId) addWithParents(e.source);
    }
    return related;
  }, [focusMode, lockedFocusNodeId, rfState.edges, rfState.nodes]);

  const nodes: SpecGraphRFNode[] = useMemo(() => {
    const result = rfState.nodes.map(node => {
      const metadataPos = node.data?.metadata?.position as { x: number; y: number } | undefined;
      // N4: zoom-band icon demotion rides the SAME type-swap seam as manual compact.
      // Sealed-boundary nodes are exempt (never explode, never dissolve to an icon).
      const zoomDemoted = demotesToIcon(zoomBand, {
        isContainer: nonCompactableTypes.has(node.type || ''),
        sealedBoundary: node.data?.sealedBoundary,
      });
      const shouldCompact = (effectiveNodeSize === 'compact' || zoomDemoted) && !nonCompactableTypes.has(node.type || '');
      const isDimmed = focusRelatedNodeIds !== null && !focusRelatedNodeIds.has(node.id);
      const resultNode: SpecGraphRFNode = {
        ...node,
        type: shouldCompact ? 'icon' : node.type,
        style: isDimmed
          ? { ...node.style, opacity: 0.2, transition: 'opacity 0.25s ease' }
          : { ...node.style, opacity: 1, transition: 'opacity 0.25s ease' },
        position: localPositions.get(node.id)
          ?? savedPositions.current.get(node.id)
          ?? metadataPos
          ?? { x: Math.random() * 400, y: Math.random() * 400 },
        data: {
          ...node.data,
          highlighted: highlightedNodeIds.has(node.id),
          isLocked: lockedNodesSet.has(node.id),
          isDropTarget: dropTargetId === node.id,
          crossContainerSummaries: crossContainerMap.get(node.id),
          layerMode,
          nodeSize: effectiveNodeSize,
          transitionPhase,
          onToggleLock: () => handleToggleLock(node.id),
          onUpdateMetadata: (updates: Record<string, unknown>) => handleUpdateNodeMetadata(node.id, updates),
          onFitChildren: () => handleFitChildren(node.id),
          onExport: onNodeExport ? () => onNodeExport(node.id) : undefined,
          onUndock: graph.nodes[node.id]?.parentId ? () => handleUndockNode(node.id) : undefined,
          onDelete: () => handleDeleteNode(node.id),
          // UX-1.3: Add-to-Container moved from the deprecated right-click
          // menu into the toolbar's Dock popover — same rules the menu used:
          // non-container nodes only; options exclude self and current parent.
          containerOptions: !getContainerTypeById(graph.nodes[node.id]?.type ?? '')
            ? Object.values(graph.nodes)
                .filter(n => !!getContainerTypeById(n.type) && n.id !== node.id && n.id !== graph.nodes[node.id]?.parentId)
                .map(n => ({ id: n.id, label: n.label }))
            : undefined,
          onAssignToContainer: (containerId: string) => handleAssignToContainer(node.id, containerId),
        },
      };

      return resultNode;
    });

    return result;
  }, [rfState.nodes, localPositions, highlightedNodeIds, lockedNodesSet, handleToggleLock, handleUpdateNodeMetadata, crossContainerMap, layerMode, effectiveNodeSize, transitionPhase, handleFitChildren, dropTargetId, handleUndockNode, handleDeleteNode, handleAssignToContainer, graph.nodes, onNodeExport, focusRelatedNodeIds, zoomBand]);

  const edges = useMemo(() => {
    const effectiveFocusNodeId = lockedFocusNodeId ?? focusedNodeId;
    const injectFocusData = (e: SpecGraphRFEdge): SpecGraphRFEdge => ({
      ...e,
      data: {
        ...e.data!,
        focusedEdgeId,
        focusedNodeId: effectiveFocusNodeId,
        sourceNodeId: e.source,
        targetNodeId: e.target,
      },
    });

    let result: SpecGraphRFEdge[];

    if (layerMode !== 'nested') {
      result = rfState.edges;
    } else {
      // Deployment view always uses SUMMARY visibility (owner 2026-07-29: the
      // all/summary/minimal toggle and its contract-type filters are retired):
      // cross-container detail edges hide behind container summary chips.
      const filtered = rfState.edges.map(e => {
        const vis = e.data?.edgeVisibility;
        if (vis === 'cross-container') {
          return { ...e, hidden: true };
        }
        return e;
      });
      result = [...filtered, ...containerSummaryEdges] as SpecGraphRFEdge[];
    }

    return result.map(injectFocusData);
  }, [rfState.edges, layerMode, containerSummaryEdges, focusedEdgeId, focusedNodeId, lockedFocusNodeId]);

  const availableContractKinds = useMemo(() => {
    const kinds = new Set<string>();
    for (const contract of Object.values(graph.contracts)) {
      if (contract.kind) kinds.add(contract.kind);
    }
    return [...kinds].sort();
  }, [graph.contracts]);

  const availableInteractionKinds = useMemo(() => {
    const kinds = new Set<string>();
    for (const contract of Object.values(graph.contracts)) {
      if (contract.interactionKind) kinds.add(contract.interactionKind);
    }
    return [...kinds].sort();
  }, [graph.contracts]);

  const filteredEdges = useMemo(() => {
    const isolate = focusMode === 'isolate' && lockedFocusNodeId !== null;
    if (!isolate) return edges;
    return edges.map(e => {
      if (e.source !== lockedFocusNodeId && e.target !== lockedFocusNodeId) {
        return { ...e, hidden: true };
      }
      return e;
    }) as SpecGraphRFEdge[];
  }, [edges, focusMode, lockedFocusNodeId]);

  useEffect(() => {
    rfState.warnings.forEach((warning) => onWarning?.(warning));
  }, [rfState.warnings, onWarning]);

  const patchOptions = useMemo(() => ({ actorType }), [actorType]);

  const handleNodesChange: OnNodesChange<SpecGraphRFNode> = useCallback(
    (changes) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          // Section 6: Validate child nodes stay within parent bounds
          const node = reactFlowInstance.getNode(change.id);
          if (node?.parentId) {
            const parent = reactFlowInstance.getNode(node.parentId);
            if (parent) {
              const parentWidth = parent.width ?? 600;
              const parentHeight = parent.height ?? 400;
              const nodeWidth = node.width ?? 200;
              const nodeHeight = node.height ?? 100;

              // Calculate boundaries (accounting for parent padding)
              const padding = 48; // Match container padding
              const minX = padding;
              const minY = padding;
              const maxX = parentWidth - nodeWidth - padding;
              const maxY = parentHeight - nodeHeight - padding;

              // Clamp position to parent bounds
              const clampedPosition = {
                x: Math.max(minX, Math.min(maxX, change.position.x)),
                y: Math.max(minY, Math.min(maxY, change.position.y)),
              };

              change.position = clampedPosition;
            }
          }

          // ALWAYS update position immediately for live drag feedback. Functional update:
          // a multi-select drag delivers several position changes in ONE batch, and
          // rebuilding from the closure-captured map made each iteration clobber the
          // previous one — only the last node kept its position (bench: nodes snapping
          // away/"disappearing" during drag, 2026-07-21).
          const changedPosition = change.position;
          setLocalPositions(prev => {
            const next = new Map(prev);
            next.set(change.id, changedPosition);
            return next;
          });

          // Save to storage when drag completes
          if (change.dragging === false) {
            savedPositions.current.set(change.id, change.position);
            savePositionsToStorage(savedPositions.current, projectId);
          }
        } else if (change.type === 'dimensions' && change.dimensions) {
          // Section 8: Validate dimensions
          const { width, height } = change.dimensions;
          if (width <= 0 || height <= 0) {
            continue;
          }

          if (change.resizing === false) {
            debouncedDimensionSave(change.id, width, height);
          }
        }
      }

      // Handle remove changes with patches
      const removeChanges = changes.filter((c) => c.type === 'remove');
      if (removeChanges.length > 0) {
        const result = mapNodeChangesToPatches(
          removeChanges as unknown as NodeChange[],
          graph,
          patchOptions
        );

        if (result.blocked && result.blockReason) {
          onError?.(result.blockReason);
          return;
        }

        result.warnings.forEach((w) => onWarning?.(w));

        if (result.patches.length > 0) {
          onPatchesGenerated?.(result.patches);
        }
      }
    },
    [graph, patchOptions, localPositions, onPatchesGenerated, onWarning, onError, reactFlowInstance, debouncedDimensionSave]
  );

  const handleEdgesChange: OnEdgesChange<SpecGraphRFEdge> = useCallback(
    (changes) => {
      const removeChanges = changes.filter((c) => c.type === 'remove');

      if (removeChanges.length === 0) {
        return;
      }

      const result = mapEdgeChangesToPatches(
        removeChanges as unknown as EdgeChange[],
        graph,
        patchOptions
      );

      result.warnings.forEach((w) => onWarning?.(w));

      if (result.patches.length > 0) {
        onPatchesGenerated?.(result.patches);
      }
    },
    [graph, patchOptions, onPatchesGenerated, onWarning]
  );

  const handleConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const result = mapConnectionToPatches(connection, graph, patchOptions);

      if (result.blocked && result.blockReason) {
        onError?.(result.blockReason);
        return;
      }

      result.warnings.forEach((w) => onWarning?.(w));

      if (result.patches.length > 0) {
        onPatchesGenerated?.(result.patches);
      }
    },
    [graph, patchOptions, onPatchesGenerated, onWarning, onError]
  );

  const handleNodeClick: NodeMouseHandler<SpecGraphRFNode> = useCallback(
    (event, node) => {
      if ((event as any).button === 2) {
        return;
      }
      if (focusMode !== 'off') {
        setLockedFocusNodeId(prev => (prev === node.id ? null : node.id));
        reactFlowInstance?.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.35 });
      }
      onNodeSelect?.(node.id);
    },
    [onNodeSelect, focusMode, reactFlowInstance]
  );

  const handleEdgeClick: EdgeMouseHandler<SpecGraphRFEdge> = useCallback(
    (event, edge) => {
      if ((event as any).button === 2) {
        return;
      }
      onEdgeSelect?.(edge.id);
    },
    [onEdgeSelect]
  );

  const handleEdgeMouseEnter: EdgeMouseHandler<SpecGraphRFEdge> = useCallback(
    (_event, edge) => { setFocusedEdgeId(edge.id); },
    []
  );

  const handleEdgeMouseLeave: EdgeMouseHandler<SpecGraphRFEdge> = useCallback(
    () => { setFocusedEdgeId(null); },
    []
  );

  const handleNodeMouseEnter: NodeMouseHandler<SpecGraphRFNode> = useCallback(
    (_event, node) => { setFocusedNodeId(node.id); },
    []
  );

  const handleNodeMouseLeave: NodeMouseHandler<SpecGraphRFNode> = useCallback(
    () => { setFocusedNodeId(null); },
    []
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setLockedFocusNodeId(null);
    onBackgroundClick?.();
  }, [onBackgroundClick]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    const edge = graph.edges[edgeId];
    if (!edge) {
      onError?.('Edge not found');
      return;
    }

    const sourceNode = graph.nodes[edge.source];
    const targetNode = graph.nodes[edge.target];
    const edgeLabel = edge.label || `${sourceNode?.label || 'Unknown'} → ${targetNode?.label || 'Unknown'}`;

    try {
      const patch = buildRemoveEdgePatch({
        edgeId,
        actor: actorType,
        summary: `Delete edge "${edgeLabel}"`,
      });

      onPatchesGenerated?.([patch]);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to delete edge');
    }
  }, [graph, actorType, onPatchesGenerated, onError]);

  const handleNodesSelection = useCallback((nodes: SpecGraphRFNode[]) => {
    setSelectedNodes(new Set(nodes.map(n => n.id)));
  }, []);

  const handleEdgesSelection = useCallback((edges: SpecGraphRFEdge[]) => {
    setSelectedEdges(new Set(edges.map(e => e.id)));
  }, []);

  const notifyLayerMismatch = useCallback((role: NodeRole) => {
    if (!onWarning) return;
    if (layerMode === 'flat' && role.isContainer) {
      onWarning(`"${role.label}" is a deployment node. Switch to Nested view to see it in context.`);
    } else if (layerMode === 'nested' && !role.isContainer) {
      onWarning(`"${role.label}" is a functional node. Switch to Flat view to see it in context.`);
    }
  }, [layerMode, onWarning]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const createNodeFromDrop = useCallback((
    nodeType: string,
    displayName: string,
    _flowPosition: { x: number; y: number },
    parentContainerId: string | undefined,
    technology?: string,
    customTechnology?: string,
  ) => {
    const metadata: Record<string, unknown> = {};
    // N3.5 custom nodes: NODE-LOCAL identity, zero catalog writes. The name defaults into
    // the label (labels cross the git anchor; metadata does not — anchor-v2 candidate).
    // Rectification: the custom-dependency tag applies ONLY on non-build roles — a custom
    // name on a build role ("My Billing App" on backend-service) is just the node's label,
    // and its task doc stays a normal build brief (no misleading "don't invent specifics"
    // line about the user's own app).
    if (customTechnology) {
      const customRole = catalog?.getRole(nodeType);
      if (!customRole || isCustomDependencyRole(customRole)) {
        metadata.customTechnology = customTechnology;
      }
    }
    // N5 (one identity system): the domainMetadata creation-defaults block is GONE.
    // It was keyed entirely on dotted node types (frontend./database.), so post-N9a it
    // was dead code for every canvas-created node — and the generator never read
    // domainMetadata anyway (assessment 2026-07-22). Configuration now lives in
    // metadata.config, schema-driven via DynamicMetadataForm in the inspector.

    // N3.8 (owner rule): a provider-branded managed service (aws-s3, gcp-*, azure-*, …)
    // is only meaningful INSIDE its provider's platform — the platform is the MINIMUM
    // container, keeping parent/child semantics correct for any AI reading the graph
    // (ownership derives to `integrate` from the platform parent). Applied only when the user
    // didn't drop into an explicit container: reuse an existing platform node, else
    // create one in the same patch batch.
    let effectiveParentId = parentContainerId;
    const platformPatches: PatchOperation[] = [];
    const providerRoleId = providerPlatformRoleId(technology);
    // The dropped node may BE the provider platform (the `azure` technology maps to
    // the `azure` role): the minimum-container rule must never apply to the platform
    // itself — it would parent the platform under its own family's node, or spawn a
    // second platform. A graph has ONE platform node per provider family: dropping
    // the platform again at root REUSES the existing node (owner-reported: an
    // auto-created "Azure" container coexisting with a palette-added "Microsoft
    // Azure" — duplicate identity, different logo).
    if (providerRoleId && providerRoleId === nodeType) {
      if (!parentContainerId) {
        const existingPlatform = Object.values(graph.nodes).find(n => n.type === providerRoleId);
        if (existingPlatform) {
          onWarning?.(`"${existingPlatform.label}" already exists — this project's ${displayName} services live inside it.`);
          return;
        }
      }
    } else if (providerRoleId && !effectiveParentId && catalog) {
      const existingPlatform = Object.values(graph.nodes).find(n => n.type === providerRoleId);
      if (existingPlatform) {
        effectiveParentId = existingPlatform.id;
      } else {
        const platformRole = catalog.getRole(providerRoleId);
        if (platformRole) {
          const platformId = generateUUID();
          // Bind the platform TECHNOLOGY too (second half of the same report: the
          // auto-created platform carried role identity only, so it rendered the
          // role fallback icon and the bare role label — visibly a DIFFERENT thing
          // from a palette-created platform). With the technology bound, icon and
          // label match a palette-created platform exactly.
          const platformTech = catalog.getTechnology(providerRoleId);
          platformPatches.push(...buildNodePatchesFromRole(
            platformRole, platformId, platformTech?.name ?? platformRole.label,
            { actorType, ...(platformTech ? { technology: platformTech.id } : {}) },
          ));
          effectiveParentId = platformId;
          // N8.4b-1b: the auto-created platform had NO recorded position, so it rendered
          // wherever layout defaulted — on the owner's bench that was on top of the
          // existing AWS platform, reading as "the Azure project is inside AWS". Anchor
          // it at the drop point; existing platforms already carry saved positions.
          savedPositions.current.set(platformId, { x: _flowPosition.x, y: _flowPosition.y });
          savePositionsToStorage(savedPositions.current, projectId);
        }
      }
    }

    try {
      const nodeId = generateUUID();
      const patches: PatchOperation[] = [...platformPatches];

      const template = getNodeTypeById(nodeType);
      if (template) {
        patches.push(createNodeFromTemplatePatch(
          nodeType,
          nodeId,
          displayName,
          { actorType, summary: `Add ${displayName} node` },
          Object.keys(metadata).length > 0 ? metadata : undefined,
          effectiveParentId,
        ));
      } else {
        const role = catalog?.getRole(nodeType);
        if (role) {
          const rolePatches = buildNodePatchesFromRole(role, nodeId, displayName, {
            actorType,
            technology,
            parentContainerId: effectiveParentId,
          });
          patches.push(...rolePatches);
        } else {
          patches.push(createAddNodePatch(
            {
              id: nodeId,
              type: nodeType,
              label: displayName,
              technology,
              ports: [],
              data: {},
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
              status: 'draft',
              parentId: effectiveParentId,
            },
            { actorType, summary: `Add ${displayName} node` },
          ));
        }
      }

      if (technology) {
        patches.push(createUpdateNodePatch(
          nodeId,
          { technology },
          { actorType, summary: `Set technology to ${technology}` },
        ));
      }

      onPatchesGenerated?.(patches);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to create node');
    }
  }, [actorType, catalog, graph.nodes, onPatchesGenerated, onError, onWarning]);

  const handleTechSelect = useCallback((technologyId: string | null) => {
    if (!techPickerState || !catalog) {
      setTechPickerState(null);
      return;
    }

    const { role, flowPosition, parentContainerId } = techPickerState;
    const resolved = resolveNodeCreationParams(role.id, technologyId, catalog);

    createNodeFromDrop(
      resolved.nodeType,
      resolved.displayName,
      flowPosition,
      parentContainerId,
      resolved.technology,
    );

    setTechPickerState(null);
  }, [techPickerState, catalog, createNodeFromDrop]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    const droppedType = event.dataTransfer.getData('application/specgraph-node');
    // N3.5: search-first payloads — a technology-bound drag skips the picker; a custom
    // drag creates a node-local custom node (no catalog entry).
    const droppedTech = event.dataTransfer.getData('application/specgraph-tech') || undefined;
    const droppedCustomRaw = event.dataTransfer.getData('application/specgraph-custom') || undefined;
    // N3.7: multi-affinity technology drags carry ONLY specgraph-tech (role resolved at
    // drop via UsagePicker) — the guard must admit them (bench-found 2026-07-22: n8n and
    // Amazon Athena drops silently did nothing).
    if (!droppedType && !droppedCustomRaw && !droppedTech) return;

    const position = reactFlowInstance?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const droppedOnNode = reactFlowInstance?.getNodes().find(node => {
      if (!position) return false;
      const nodeElement = document.querySelector(`[data-id="${node.id}"]`);
      if (!nodeElement) return false;
      const rect = nodeElement.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    });

    // N8.4b-1b (owner CRITICAL 2026-07-27): a PLATFORM never nests inside another
    // platform — dropping an azure-* thing onto the AWS container must not put an Azure
    // account inside an AWS one. Narrow, targeted gate: the general drop-path
    // containment hole (Discovered 2026-07-26 #4) stays with N8.2, because enforcing
    // every rule here would also refuse legitimate generic drops (a plain backend
    // service onto a platform container) that today's rule objects don't enumerate.
    const dropTargetId = droppedOnNode?.type === 'container' ? droppedOnNode.id : undefined;
    const dropTargetNode = dropTargetId ? graph.nodes[dropTargetId] : undefined;
    const childRoleForDrop = droppedType
      || (droppedTech ? catalog?.getTechnology(droppedTech)?.roleAffinities?.[0] : undefined)
      || (droppedTech ? providerPlatformRoleId(droppedTech) : undefined);
    // N8.4b-1c: PROVIDER COHERENCE at the drop — an azure-* thing dropped onto an
    // aws-* container (AWS VPC, an AWS platform, an aws-bound k8s cluster…) falls back
    // to root placement, where the N3.8 rule creates/reuses ITS OWN provider platform.
    // Still narrow by design: only cross-provider + platform-in-platform refuse here;
    // the full drop-path containment check remains N8.2 (Discovered #4), since the
    // generic role rules would also refuse legitimate technology-less drops.
    const childProviderForDrop = providerOfNode(
      childRoleForDrop ? catalog?.getRole(childRoleForDrop) : null, droppedTech);
    const targetProvider = dropTargetNode
      ? providerOfNode(catalog?.getRole(dropTargetNode.type), dropTargetNode.technology)
      : null;
    const crossProviderDrop = !!childProviderForDrop && !!targetProvider && childProviderForDrop !== targetProvider;
    const targetIsPlatform = dropTargetNode ? catalog?.getRole(dropTargetNode.type)?.nature === 'host' : false;
    const childIsPlatform = childRoleForDrop ? catalog?.getRole(childRoleForDrop)?.nature === 'host' : false;
    const parentContainerId = (crossProviderDrop || (targetIsPlatform && childIsPlatform)) ? undefined : dropTargetId;
    const flowPosition = position || { x: 100, y: 100 };

    if (droppedCustomRaw) {
      try {
        const custom = JSON.parse(droppedCustomRaw) as { roleId: string; name: string };
        const customRole = catalog?.getRole(custom.roleId);
        if (custom.name && customRole) {
          notifyLayerMismatch(customRole);
          createNodeFromDrop(customRole.id, custom.name, flowPosition, parentContainerId, undefined, custom.name);
          return;
        }
      } catch { /* malformed payload — fall through to normal handling */ }
    }

    // N3.7: a technology dragged WITHOUT a role (multi-affinity — the palette shows one
    // row per thing). Ask the ONE usage-phrased question; the role is the system's filing.
    if (!droppedType && droppedTech && catalog) {
      const tech = catalog.getTechnology(droppedTech);
      if (tech) {
        // N8.4s (owner bench 2026-07-27: "VPC nodes are not even adding to the canvas"):
        // this used to filter `!r.isContainer` with its own copy of the rule, while the
        // PALETTE listed rows via liveDropAffinities, which allows containers. So
        // aws-vpc / azure-vnet / gcp-vpc (affinities vpc+subnet — both containers) and
        // the branded platform rows listed in the sidebar and then produced NOTHING on
        // drop: liveRoles came back empty and the handler returned silently. One rule,
        // imported from the one place that defines it.
        const liveRoles = liveDropAffinities(tech, catalog);
        if (liveRoles.length === 1) {
          const resolved = resolveNodeCreationParams(liveRoles[0].id, tech.id, catalog);
          createNodeFromDrop(resolved.nodeType, resolved.displayName, flowPosition, parentContainerId, resolved.technology);
          return;
        }
        if (liveRoles.length > 1) {
          setUsagePickerState({
            position: { x: event.clientX, y: event.clientY },
            technologyId: tech.id,
            technologyName: tech.displayName || tech.name,
            options: liveRoles.map(r => ({ roleId: r.id, phrase: usagePhraseForRole(r) })),
            flowPosition,
            parentContainerId,
          });
          return;
        }
      }
      return;
    }

    const role = catalog?.getRole(droppedType);
    if (role && catalog) {
      notifyLayerMismatch(role);

      // Technology already chosen in the palette search — bind directly, no picker.
      if (droppedTech && catalog.getTechnology(droppedTech)) {
        const resolved = resolveNodeCreationParams(role.id, droppedTech, catalog);
        createNodeFromDrop(resolved.nodeType, resolved.displayName, flowPosition, parentContainerId, resolved.technology);
        return;
      }

      const technologies = catalog.getTechnologiesForRole(role.id);

      if (technologies.length >= 2) {
        setTechPickerState({
          position: { x: event.clientX, y: event.clientY },
          role,
          technologies,
          flowPosition,
          parentContainerId,
        });
        return;
      }

      const singleTech = technologies.length === 1
        ? technologies[0].id
        : (role.defaultTechnology || null);
      const resolved = resolveNodeCreationParams(role.id, singleTech, catalog);

      createNodeFromDrop(
        resolved.nodeType,
        resolved.displayName,
        flowPosition,
        parentContainerId,
        resolved.technology,
      );
      return;
    }

    createNodeFromDrop(droppedType, droppedType, flowPosition, parentContainerId);
  }, [reactFlowInstance, catalog, createNodeFromDrop, notifyLayerMismatch]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' ||
                       target.tagName === 'TEXTAREA' ||
                       target.isContentEditable ||
                       target.closest('.monaco-editor');

      if (isTyping) {
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') &&
          (selectedNodes.size > 0 || selectedEdges.size > 0)) {
        event.preventDefault();

        const result = mapDeleteSelectionToPatches(
          Array.from(selectedNodes),
          Array.from(selectedEdges),
          graph,
          { actorType }
        );

        if (result.blocked && result.blockReason) {
          onError?.(result.blockReason);
          return;
        }

        result.warnings.forEach((w) => onWarning?.(w));

        if (result.patches.length > 0) {
          onPatchesGenerated?.(result.patches);
          setSelectedNodes(new Set());
          setSelectedEdges(new Set());
        }
      }
    };

    const handleAutoLayoutShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'l') {
        event.preventDefault();
        handleAutoLayoutRef.current?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keydown', handleAutoLayoutShortcut);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keydown', handleAutoLayoutShortcut);
    };
  }, [selectedNodes, selectedEdges, graph, actorType, onPatchesGenerated, onWarning, onError]);

  const handleAutoLayout = useCallback(() => {
    void (async () => {
      let newPositions: Array<{ id: string; x: number; y: number }>;
      let containerSizes: Map<string, { width: number; height: number }> | null = null;

      try {
        const elkResult = await calculateElkLayout(nodes, edges, { direction: 'LR', catalog });
        newPositions = elkResult.positions;
        containerSizes = elkResult.containerSizes;
      } catch (err) {
        // ELK failure should never strand the user without a layout.
        console.warn('[auto-layout] ELK layout failed, using legacy layout:', err);
        newPositions = calculateAutoLayout(nodes, edges, { direction: 'LR', graph, catalog });
      }

      const updatedPositions = new Map(localPositions);
      for (const pos of newPositions) {
        updatedPositions.set(pos.id, { x: pos.x, y: pos.y });
        savedPositions.current.set(pos.id, { x: pos.x, y: pos.y });
      }

      setLocalPositions(updatedPositions);
      savePositionsToStorage(savedPositions.current, projectId);
      // Every node now has a real, saved position — nothing is random-seeded.
      randomSeededIdsRef.current.clear();

      if (containerSizes) {
        for (const [containerId, sizing] of containerSizes) {
          handleUpdateNodeMetadata(containerId, {
            width: sizing.width,
            height: sizing.height,
          });
        }
      }

      setTimeout(() => {
        reactFlowInstance?.fitView({ padding: 0.2, duration: 300 });
      }, 50);
    })();
  }, [nodes, edges, localPositions, reactFlowInstance, graph, catalog, handleUpdateNodeMetadata]);

  handleAutoLayoutRef.current = handleAutoLayout;

  // Owner 2026-07-29: after a patch proposal lands (any refreshGraph — accepted
  // proposal, MCP push, restore), nodes that arrived without a position would
  // scatter at random spots. When such nodes exist, arrange the canvas exactly
  // as if the auto-layout button was clicked. Runs only in architecture view;
  // switching INTO architecture view later triggers it too (viewMode dep).
  useEffect(() => {
    if (viewMode !== 'architecture') return;
    if (randomSeededIdsRef.current.size === 0) return;
    const timer = setTimeout(() => {
      handleAutoLayoutRef.current?.();
    }, 120);
    return () => clearTimeout(timer);
  }, [refreshCounter, viewMode]);

  useEffect(() => {
    if (nodes.length > 0 && localPositions.size === 0 && savedPositions.current.size === 0) {
      setTimeout(() => {
        handleAutoLayout();
      }, 100);
    }
  }, []);

  // Smooth animation when graph updates after refresh
  useEffect(() => {
    const previousNodeCount = Object.keys(previousGraphRef.current.nodes).length;
    const currentNodeCount = Object.keys(graph.nodes).length;

    if (!isRefreshing && currentNodeCount !== previousNodeCount && currentNodeCount > 0) {
      // Graph has changed, trigger smooth fit view animation
      setTimeout(() => {
        reactFlowInstance?.fitView({
          duration: 600,
          padding: 0.15,
          maxZoom: 1.2,
        });
      }, 100);
    }

    previousGraphRef.current = graph;
  }, [graph, isRefreshing, reactFlowInstance]);

  return (
    <div
      style={canvasStyles}
      onDragOver={viewMode === 'architecture' ? handleDragOver : undefined}
      onDrop={viewMode === 'architecture' ? handleDrop : undefined}
    >
      <ViewToggle
        viewMode={viewMode}
        onToggle={(mode) => {
          setViewMode(mode);
          if (mode === 'architecture') {
            setTimeout(() => {
              reactFlowInstance.fitView({ duration: 400, padding: 0.1 });
            }, 100);
          }
        }}
        onExport={onExportProject}
      />
      {viewMode === 'specification' && specRealtimeData && projectId ? (
        <SpecificationMarkdownView
          projectId={projectId}
          branchId={branchId ?? undefined}
          specRealtimeData={specRealtimeData}
          graph={graph}
          projectName={canvasProjectName || 'Untitled Project'}
          testSuite={testSuiteData}
          onWarning={onWarning}
          onDirtyChange={onSpecDirtyChange}
          workflowOrigin={workflowOrigin}
          onSpecImportComplete={onSpecImportComplete}
        />
      ) : viewMode === 'decomposition' ? (
        <DecompositionCanvas
          projectId={projectId || null}
          hasEmptyState={Object.keys(graph.nodes).length === 0}
          refreshCounter={refreshCounter}
          workflowOrigin={workflowOrigin}
          testRefreshCounter={testRefreshCounter}
          liveGraph={graph}
        />
      ) : (
      <>
      <ReactFlow
        nodes={nodes}
        edges={filteredEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeDragStart={handleNodeDragStart as any}
        onNodeDrag={handleNodeDrag as any}
        onNodeDragStop={handleNodeDragStop as any}
        onPaneClick={handlePaneClick}
        onSelectionChange={({ nodes, edges }) => {
          handleNodesSelection(nodes as SpecGraphRFNode[]);
          handleEdgesSelection(edges as SpecGraphRFEdge[]);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        // N4 semantic zoom: minZoom low enough to reach the system band; band sampled
        // at gesture end only (natural hysteresis, no per-frame re-render).
        minZoom={0.15}
        onMoveEnd={(_event, viewport) => {
          const band = zoomBandForZoom(viewport.zoom);
          setZoomBand(prev => (prev === band ? prev : band));
        }}
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{
          type: 'default',
          animated: false,
          zIndex: 4,
        }}
        // Owner 2026-07-29: nodes above edges, ALWAYS — selecting an edge
        // must not hoist its line back over the nodes (and its own label).
        elevateEdgesOnSelect={false}
        // Section 7: Control node interactivity
        nodesDraggable={true}
        nodesConnectable={true}
        nodesFocusable={true}
        edgesFocusable={true}
      >
        <Background color={theme.colors.border} gap={16} />
        <div style={{
          position: 'absolute',
          left: '10px',
          bottom: '120px',
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <button
            onClick={handleAutoLayout}
            title="Auto-layout nodes (Ctrl+L)"
            style={{
              width: '26px',
              height: '26px',
              backgroundColor: theme.colors.surface,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              color: theme.colors.text,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="3" width="6" height="6" rx="1" />
              <rect x="9" y="15" width="6" height="6" rx="1" />
              <path d="M6 9v3c0 1 1 2 2 2h2" />
              <path d="M18 9v3c0 1-1 2-2 2h-2" />
            </svg>
          </button>
          <button
            onClick={() => setFocusMode(focusMode === 'off' ? 'highlight' : focusMode === 'highlight' ? 'isolate' : 'off')}
            title={
              focusMode === 'off'
                ? 'Focus mode: off — click to highlight a node and its connections'
                : focusMode === 'highlight'
                  ? 'Focus mode: highlight — click a node to spotlight it. Click again for isolate.'
                  : 'Focus mode: isolate — click a node to hide unrelated edges. Click again to turn off.'
            }
            style={{
              width: '26px',
              height: '26px',
              backgroundColor: focusMode !== 'off' ? theme.colors.primary : theme.colors.surface,
              border: `1px solid ${focusMode !== 'off' ? theme.colors.primary : theme.colors.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: focusMode !== 'off' ? '#ffffff' : theme.colors.text,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              position: 'relative',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
            {focusMode === 'isolate' && (
              <span style={{
                position: 'absolute',
                bottom: '2px',
                right: '2px',
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
              }} />
            )}
          </button>
          {layerMode === 'nested' && (
            <>
              <button
                onClick={() => handleCollapseExpandAll(false)}
                title="Collapse all containers"
                style={{
                  width: '26px',
                  height: '26px',
                  backgroundColor: theme.colors.surface,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  color: theme.colors.text,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
              <button
                onClick={() => handleCollapseExpandAll(true)}
                title="Expand all containers"
                style={{
                  width: '26px',
                  height: '26px',
                  backgroundColor: theme.colors.surface,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  color: theme.colors.text,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            </>
          )}
        </div>
        <MiniMap
          nodeColor={theme.colors.border}
          maskColor={theme.colors.backgroundSecondary + '99'}
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
          }}
        />
        <CanvasDock
          mode={layerMode}
          onToggle={handleLayerModeToggle}
          disabled={transitionPhase !== 'idle'}
          nodeSize={nodeSize}
          onNodeSizeChange={setNodeSize}
          availableContractKinds={availableContractKinds}
          availableInteractionKinds={availableInteractionKinds}
        />
      </ReactFlow>
      </>
      )}
      {/* UX-1.3 (owner ruling 2026-08-21): the right-click menu is gone —
          the edge verb it carried lives here. Select a connection (click it)
          and the chip appears; multi-select deletes them all. */}
      {viewMode === 'architecture' && selectedEdges.size > 0 && (
        <div style={{
          position: 'absolute', bottom: '86px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 12,
        }}>
          <button
            type="button"
            onClick={() => { Array.from(selectedEdges).forEach(id => handleDeleteEdge(id)); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '8px 14px', borderRadius: '999px',
              border: '1px solid rgba(220,38,38,0.4)',
              backgroundColor: 'rgba(220,38,38,0.92)', color: '#fff',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 8px 22px rgba(0,0,0,0.25)',
            }}
          >
            <Trash2 size={13} />
            Delete {selectedEdges.size === 1 ? 'connection' : `${selectedEdges.size} connections`}
          </button>
        </div>
      )}
      {usagePickerState && (
        <UsagePicker
          position={usagePickerState.position}
          technologyName={usagePickerState.technologyName}
          options={usagePickerState.options}
          onCancel={() => setUsagePickerState(null)}
          onSelect={(roleId) => {
            if (!catalog) { setUsagePickerState(null); return; }
            const { technologyId, flowPosition, parentContainerId } = usagePickerState;
            const resolved = resolveNodeCreationParams(roleId, technologyId, catalog);
            createNodeFromDrop(resolved.nodeType, resolved.displayName, flowPosition, parentContainerId, resolved.technology);
            setUsagePickerState(null);
          }}
        />
      )}
      {techPickerState && (
        <TechnologyPicker
          position={techPickerState.position}
          roleId={techPickerState.role.id}
          roleLabel={techPickerState.role.label}
          roleColor={techPickerState.role.color}
          roleIconName={techPickerState.role.iconName}
          technologies={techPickerState.technologies}
          onSelect={handleTechSelect}
          onCancel={() => setTechPickerState(null)}
          defaultTechnologyId={techPickerState.role.defaultTechnology}
          onCustom={(name) => {
            const { role, flowPosition, parentContainerId } = techPickerState;
            const customName = name || role.label;
            createNodeFromDrop(role.id, customName, flowPosition, parentContainerId, undefined, customName);
            setTechPickerState(null);
          }}
        />
      )}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export const Canvas = memo((props: CanvasProps) => (
  <ReactFlowProvider>
    <CanvasInner {...props} />
  </ReactFlowProvider>
));

Canvas.displayName = 'Canvas';
