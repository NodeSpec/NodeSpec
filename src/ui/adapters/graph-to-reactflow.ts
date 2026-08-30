/**
 * Graph -> React Flow Adapter
 *
 * ARCHITECTURE NOTES:
 * - React Flow is VIEW ONLY - no business logic here
 * - All state derives from canonical Graph
 * - Interactions emit PatchOperations, never mutate directly
 * - RF visual type is determined by the catalog's rfVisualType on node_roles
 *
 * PERFORMANCE STRATEGY:
 * - Memoize conversion functions at component level
 * - Only recompute nodes/edges when graph reference changes
 * - Use stable IDs to prevent unnecessary React Flow re-renders
 */

import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import type { Graph, Node, Edge, Contract, Port, EntityStatus, NodeGroup } from '@nodespec/core/types.js';
import { deriveArchitecturalObligations } from '@nodespec/core/obligations.js';
import { effectiveTreatmentForRole } from '@nodespec/core/ontology.js';
import { dominantChildTechnologies } from '../utils/semantic-zoom.js';
import { getNodeTypeById } from '@nodespec/core/node-types.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import { resolveRFVisualType, isContainerType, isLogicalBoundaryType } from './rf-visual-type-resolver.js';
import { calculateFlowAwareContainerSize } from '../utils/container-child-layout.js';

export interface RFNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  technology?: string;
  deploymentTarget?: string;
  nodeTypeLabel?: string;
  domain?: string;
  icon?: string;
  color?: string;
  artifacts: string[];
  ports: Port[];
  metadata: Record<string, unknown>;
  hasError: boolean;
  errorMessage?: string;
  status?: EntityStatus;
  isDraft: boolean;
  highlighted?: boolean;
  isLocked?: boolean;
  isDropTarget?: boolean;
  containerParentLabel?: string;
  containerPlacementKind?: string;
  /** N4: effectiveTreatment(role, tech) === 'boundary' — never explodes, never
   *  icon-demoted (its name+tech card IS its interface). */
  sealedBoundary?: boolean;
  crossContainerSummaries?: CrossContainerSummary[];
  layerMode?: ArchitectureLayerMode;
  nodeSize?: 'regular' | 'compact';
  transitionPhase?: 'idle' | 'entering-nested' | 'exiting-nested';
  artifactCount?: number;
  isInsideLogicalBoundary?: boolean;
  onToggleLock?: () => void;
  onUpdateMetadata?: (updates: Record<string, unknown>) => void;
  onFitChildren?: () => void;
  onExport?: () => void;
  /** Owner merge ruling 2026-08-13: the node pane absorbs the right-click
   * verbs — undock (present only when the node is docked) and delete.
   * UX-1.3 (2026-08-21): the menu is deprecated COMPLETELY — Add-to-Container
   * moved here too, as the Dock popover (options exclude self, containers,
   * and the current parent). */
  onUndock?: () => void;
  onDelete?: () => void;
  containerOptions?: Array<{ id: string; label: string }>;
  onAssignToContainer?: (containerId: string) => void;
}

export type EdgeVisibility = 'intra-container' | 'cross-container' | 'containment' | 'external';

export interface CrossContainerSummary {
  targetContainerId: string;
  targetContainerLabel: string;
  edges: Array<{
    edgeId: string;
    label?: string;
    sourceNodeLabel: string;
    targetNodeLabel: string;
  }>;
}

export type NestedEdgeMode = 'all' | 'summary' | 'minimal';

export interface ContainerSummaryEdgeData extends Record<string, unknown> {
  sourceContainerId: string;
  targetContainerId: string;
  sourceContainerLabel: string;
  targetContainerLabel: string;
  edgeCount: number;
  dominantContractKinds: string[];
  edges: Array<{
    edgeId: string;
    label?: string;
    sourceNodeLabel: string;
    targetNodeLabel: string;
    contractKind?: string;
    interactionKind?: string;
    transport?: string;
    specFormat?: string;
  }>;
}

export interface RFEdgeData extends Record<string, unknown> {
  contract: Contract | null;
  contractStatus?: 'draft' | 'complete';
  hasError: boolean;
  errorMessage?: string;
  hasWarning: boolean;
  warningMessage?: string;
  curveOffset?: number;
  edgeVisibility?: EdgeVisibility;
  layerMode?: ArchitectureLayerMode;
  direction?: 'unidirectional' | 'bidirectional';
  criticality?: 'required' | 'optional' | 'fallback';
}

export type SpecGraphRFNode = RFNode<RFNodeData>;
export type SpecGraphRFEdge = RFEdge<RFEdgeData>;

export type CanvasViewMode = 'decomposition' | 'architecture';
export type ArchitectureLayerMode = 'flat' | 'nested';

export function mapGraphToRFNodes(graph: Graph, layerMode: ArchitectureLayerMode = 'nested', catalog?: CatalogResolver | null, maxDepth?: number): SpecGraphRFNode[] {
  const rfNodes: SpecGraphRFNode[] = [];

  if (graph.nodeGroups) {
    for (const nodeGroup of Object.values(graph.nodeGroups)) {
      rfNodes.push(mapNodeGroupToRFNode(nodeGroup));
    }
  }

  // React Flow requires parents BEFORE children in the nodes array — a child whose
  // parentId points at a node that appears later (or not at all) is silently dropped,
  // which read as "nodes disappear while dragging" on the bench (2026-07-21). Object
  // insertion order carries no such guarantee, so sort by nesting depth (roots first).
  const allNodes = Object.values(graph.nodes)
    .sort((a, b) => computeNestingDepth(a.id, graph) - computeNestingDepth(b.id, graph));

  for (const node of allNodes) {
    const rfNode = mapNodeToRFNode(node, graph, layerMode, catalog);

    if (maxDepth !== undefined && layerMode === 'nested') {
      const depth = computeNestingDepth(node.id, graph);
      if (depth >= maxDepth) {
        rfNode.hidden = true;
      }
    }

    rfNodes.push(rfNode);
  }

  return rfNodes;
}

export function mapNodeToRFNode(node: Node, graph: Graph, layerMode: ArchitectureLayerMode = 'nested', catalog?: CatalogResolver | null): SpecGraphRFNode {
  const hasInvalidArtifacts = node.artifacts?.some(
    (artifactId) => !graph.artifacts[artifactId]
  );
  const isDraft = false;

  const resolved = catalog?.resolveNodeType(node.type) ?? null;
  const nodeTypeInfo = getNodeTypeById(node.type);

  const children = Object.values(graph.nodes).filter(n => n.parentId === node.id);
  const childCount = children.length;
  // N4.4 (bench-found): the collapsed chip's technologies must come from GRAPH truth —
  // children of a collapsed container carry no parentId in the RF store (they're hidden
  // roots there), so an RF-store lookup is empty exactly when the chip renders.
  const childTechnologies = childCount > 0 ? dominantChildTechnologies(children) : undefined;

  const rfNodeType = resolveRFVisualType(node.type, catalog);
  const nodeIsContainer = isContainerType(node.type, catalog);
  const nodeIsLogicalBoundary = rfNodeType === 'logicalBoundary';

  const position = { x: 0, y: 0 };

  let actualRFType = rfNodeType;
  let shouldBeHidden = false;
  let containerParentLabel: string | undefined;

  let isInsideLogicalBoundary = false;

  if (layerMode === 'nested' && !nodeIsContainer && !nodeIsLogicalBoundary) {
    actualRFType = 'icon';
  }

  if (layerMode === 'flat') {
    if (nodeIsContainer && !nodeIsLogicalBoundary) {
      shouldBeHidden = true;
    }
    if (node.parentId) {
      const parent = graph.nodes[node.parentId];
      if (parent && isLogicalBoundaryType(parent.type, catalog)) {
        isInsideLogicalBoundary = true;
        if (!nodeIsContainer && !nodeIsLogicalBoundary) {
          actualRFType = 'icon';
        }
      } else if (parent && isContainerType(parent.type, catalog)) {
        containerParentLabel = parent.label;
      }
    }
  }

  const directTech = (catalog && node.technology) ? catalog.getTechnology(node.technology) : null;

  // N4: thread the semantic-zoom axis onto the RF node (sealed boundary; M1c removed altitude).
  // A boundary-engine technology (aiContext.treatmentOverride) seals a leaf role too —
  // same effectiveTreatment rule as containment/task docs (N2.2).
  const techOverride = (directTech?.aiContext as Record<string, unknown> | undefined)?.treatmentOverride;
  const sealedBoundary = resolved?.role
    ? effectiveTreatmentForRole({ nature: resolved.role.nature, is_container: resolved.role.isContainer }, typeof techOverride === 'string' ? techOverride : undefined) === 'boundary'
    : false;

  const catalogLabel = resolved?.role?.label;
  const catalogIcon = directTech?.iconUrl ?? resolved?.technology?.iconUrl ?? resolved?.role?.iconName;
  const catalogColor = directTech?.brandColor ?? resolved?.technology?.brandColor ?? resolved?.role?.color;

  const rfNode: SpecGraphRFNode = {
    id: node.id,
    type: actualRFType,
    position,
    data: {
      label: node.label,
      nodeType: node.type,
      technology: node.technology,
      deploymentTarget: node.deploymentTarget,
      nodeTypeLabel: catalogLabel ?? nodeTypeInfo?.label,
      domain: resolved?.role?.paletteCategory ?? nodeTypeInfo?.domain,
      icon: catalogIcon ?? nodeTypeInfo?.icon,
      color: catalogColor ?? nodeTypeInfo?.color,
      artifacts: node.artifacts ?? [],
      artifactCount: (node.artifacts ?? []).filter(aid => {
        const art = graph.artifacts[aid];
        return art && art.status !== 'suggested';
      }).length,
      ports: node.ports ?? [],
      metadata: {
        ...node.metadata ?? {},
        childCount,
        ...(childTechnologies && childTechnologies.length > 0 ? { childTechnologies } : {}),
      },
      hasError: hasInvalidArtifacts ?? false,
      errorMessage: hasInvalidArtifacts
        ? 'References missing artifacts'
        : undefined,
      status: node.status,
      isDraft,
      containerParentLabel,
      containerPlacementKind: containerParentLabel ? (node.placementKind || 'contains') : undefined,
      sealedBoundary: sealedBoundary || undefined,
      isInsideLogicalBoundary: isInsideLogicalBoundary || undefined,
    },
    zIndex: nodeIsContainer ? 1 : 10,
    hidden: shouldBeHidden,
  };

  if (node.parentId && layerMode === 'nested') {
    const parent = graph.nodes[node.parentId];
    if (!parent) {
      // Dangling parentId (e.g. the container was deleted without reparenting children):
      // render as a root node. Setting rfNode.parentId to a non-existent node makes React
      // Flow drop the child SILENTLY — the "node vanished until refresh" bench symptom.
    } else {
      const parentIsExpanded = (parent.metadata?.containerExpanded as boolean | undefined) ?? true;

      if (parentIsExpanded && !isAncestorCollapsed(node.parentId, graph)) {
        rfNode.parentId = node.parentId;
        rfNode.extent = 'parent' as const;
        rfNode.zIndex = 10;
      } else {
        rfNode.hidden = true;
      }
    }
  }

  if (node.parentId && layerMode === 'flat') {
    const parent = graph.nodes[node.parentId];
    if (parent && isLogicalBoundaryType(parent.type, catalog)) {
      const parentIsExpanded = (parent?.metadata?.containerExpanded as boolean | undefined) ?? true;
      if (parentIsExpanded) {
        rfNode.parentId = node.parentId;
        rfNode.extent = 'parent' as const;
        rfNode.zIndex = 10;
      } else {
        rfNode.hidden = true;
      }
    }
  }

  if (nodeIsContainer && (layerMode === 'nested' || nodeIsLogicalBoundary)) {
    const nestedContainerCount = Object.values(graph.nodes).filter(
      n => n.parentId === node.id && isContainerType(n.type, catalog),
    ).length;
    const minSize = calculateFlowAwareContainerSize(
      childCount,
      nestedContainerCount > 0,
      nestedContainerCount,
    );

    if (nodeIsLogicalBoundary) {
      const lbExpanded = (node.metadata?.containerExpanded as boolean | undefined) ?? true;
      if (!lbExpanded) {
        rfNode.width = 220;
        rfNode.height = 56;
      } else {
        const metaW = node.metadata?.width as number | undefined;
        const metaH = node.metadata?.height as number | undefined;
        rfNode.width = Math.max(minSize.width, metaW ?? 0);
        rfNode.height = Math.max(minSize.height, metaH ?? 0);
      }
    } else {
      const isExpanded = (node.metadata?.containerExpanded as boolean | undefined) ?? true;

      rfNode.type = 'container';

      if (!isExpanded) {
        rfNode.width = 240;
        rfNode.height = 80;
      } else {
        const metaW = node.metadata?.width as number | undefined;
        const metaH = node.metadata?.height as number | undefined;
        rfNode.width = Math.max(minSize.width, metaW ?? 0);
        rfNode.height = Math.max(minSize.height, metaH ?? 0);
      }
    }
  }

  return rfNode;
}

export function mapNodeGroupToRFNode(nodeGroup: NodeGroup): SpecGraphRFNode {
  return {
    id: nodeGroup.id,
    type: 'group',
    position: nodeGroup.position ?? { x: 0, y: 0 },
    data: {
      label: nodeGroup.label,
      nodeType: 'node_group',
      artifacts: [],
      ports: [],
      metadata: nodeGroup.metadata ?? {},
      hasError: false,
      isDraft: false,
    },
    style: {
      backgroundColor: nodeGroup.style?.backgroundColor ?? 'rgba(240, 240, 240, 0.5)',
      border: `2px solid ${nodeGroup.style?.borderColor ?? '#999999'}`,
      borderRadius: '8px',
      padding: '20px',
      width: 400,
      height: 300,
    },
  };
}

export function computeNestingDepth(nodeId: string, graph: Graph): number {
  let depth = 0;
  const visited = new Set<string>();
  let currentId: string | undefined = graph.nodes[nodeId]?.parentId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    depth++;
    currentId = graph.nodes[currentId]?.parentId;
  }
  return depth;
}

export function computeMaxNestingDepth(graph: Graph): number {
  let max = 0;
  for (const nodeId of Object.keys(graph.nodes)) {
    const depth = computeNestingDepth(nodeId, graph);
    if (depth > max) max = depth;
  }
  return max;
}

export function isAncestorCollapsed(nodeId: string, graph: Graph): boolean {
  const visited = new Set<string>();
  let currentId: string | undefined = graph.nodes[nodeId]?.parentId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const ancestor = graph.nodes[currentId];
    if (!ancestor) break;
    const expanded = (ancestor.metadata?.containerExpanded as boolean | undefined) ?? true;
    if (!expanded) return true;
    currentId = ancestor.parentId;
  }
  return false;
}

export function findRootContainerId(nodeId: string, graph: Graph, catalog?: CatalogResolver | null): string | null {
  const node = graph.nodes[nodeId];
  if (!node) return null;

  let currentId: string | undefined = node.parentId;
  let rootContainerId: string | null = null;

  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = graph.nodes[currentId];
    if (!parent) break;
    if (isContainerType(parent.type, catalog)) {
      rootContainerId = currentId;
    }
    currentId = parent.parentId;
  }

  if (rootContainerId === null && node.parentId) {
    const directParent = graph.nodes[node.parentId];
    if (directParent && isContainerType(directParent.type, catalog)) {
      rootContainerId = node.parentId;
    }
  }

  return rootContainerId;
}

export function findDirectContainerId(nodeId: string, graph: Graph, catalog?: CatalogResolver | null): string | null {
  const node = graph.nodes[nodeId];
  if (!node?.parentId) return null;
  const parent = graph.nodes[node.parentId];
  if (parent && isContainerType(parent.type, catalog)) {
    return node.parentId;
  }
  return null;
}

export function isAncestorOf(ancestorId: string, descendantId: string, graph: Graph): boolean {
  const visited = new Set<string>();
  let currentId: string | undefined = graph.nodes[descendantId]?.parentId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    currentId = graph.nodes[currentId]?.parentId;
  }
  return false;
}

export function classifyEdge(edge: Edge, graph: Graph, catalog?: CatalogResolver | null): EdgeVisibility {
  if (isAncestorOf(edge.source, edge.target, graph) || isAncestorOf(edge.target, edge.source, graph)) {
    return 'containment';
  }

  const sourceContainer = findDirectContainerId(edge.source, graph, catalog);
  const targetContainer = findDirectContainerId(edge.target, graph, catalog);

  if (sourceContainer && targetContainer) {
    if (sourceContainer === targetContainer) return 'intra-container';
    // Owner bench 2026-07-29: NESTED-sibling containers (e.g. CloudFront in
    // "AWS Platform", ALB in "VPC" which sits INSIDE that platform) used to read
    // cross-container — summary mode then hid the detail edge and offered a
    // degenerate parent→own-child summary in its place, so the edge vanished.
    // When one endpoint's container contains the other's, the edge lives inside
    // ONE container's world: keep the detail edge visible.
    if (isAncestorOf(sourceContainer, targetContainer, graph) ||
        isAncestorOf(targetContainer, sourceContainer, graph)) {
      return 'intra-container';
    }
    return 'cross-container';
  }

  return 'external';
}

export function computeCrossContainerSummaries(graph: Graph, catalog?: CatalogResolver | null): Map<string, CrossContainerSummary[]> {
  const summaryMap = new Map<string, Map<string, CrossContainerSummary>>();

  for (const edge of Object.values(graph.edges)) {
    if (classifyEdge(edge, graph, catalog) !== 'cross-container') continue;

    const sourceContainerId = findDirectContainerId(edge.source, graph, catalog);
    const targetContainerId = findDirectContainerId(edge.target, graph, catalog);
    if (!sourceContainerId || !targetContainerId || sourceContainerId === targetContainerId) continue;

    const contract = graph.contracts[edge.contractId];
    const sourceNode = graph.nodes[edge.source];
    const targetNode = graph.nodes[edge.target];
    const edgeEntry = {
      edgeId: edge.id,
      label: edge.label ?? contract?.name,
      sourceNodeLabel: sourceNode?.label ?? edge.source,
      targetNodeLabel: targetNode?.label ?? edge.target,
    };

    for (const [containerId, otherContainerId] of [
      [sourceContainerId, targetContainerId],
      [targetContainerId, sourceContainerId],
    ]) {
      if (!summaryMap.has(containerId)) {
        summaryMap.set(containerId, new Map());
      }
      const containerSummaries = summaryMap.get(containerId)!;
      if (!containerSummaries.has(otherContainerId)) {
        const otherContainer = graph.nodes[otherContainerId];
        containerSummaries.set(otherContainerId, {
          targetContainerId: otherContainerId,
          targetContainerLabel: otherContainer?.label ?? otherContainerId,
          edges: [],
        });
      }
      const existing = containerSummaries.get(otherContainerId)!;
      if (!existing.edges.some(e => e.edgeId === edgeEntry.edgeId)) {
        existing.edges.push(edgeEntry);
      }
    }
  }

  const result = new Map<string, CrossContainerSummary[]>();
  for (const [containerId, map] of summaryMap) {
    result.set(containerId, Array.from(map.values()));
  }
  return result;
}

export function mapGraphToRFEdges(graph: Graph, layerMode: ArchitectureLayerMode = 'nested', catalog?: CatalogResolver | null): SpecGraphRFEdge[] {
  const edges = Object.values(graph.edges);

  const edgeGroups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = `${edge.source}-${edge.target}`;
    if (!edgeGroups.has(key)) {
      edgeGroups.set(key, []);
    }
    edgeGroups.get(key)!.push(edge);
  }

  return edges.map((edge) => {
    const key = `${edge.source}-${edge.target}`;
    const group = edgeGroups.get(key)!;
    const index = group.indexOf(edge);

    const visibility = layerMode === 'nested' ? classifyEdge(edge, graph, catalog) : 'external';
    const staggerPx = visibility === 'intra-container' ? 15 : 30;
    const offset = group.length > 1 ? (index - (group.length - 1) / 2) * staggerPx : 0;

    return mapEdgeToRFEdge(edge, graph, offset, visibility, layerMode);
  });
}

export function mapEdgeToRFEdge(edge: Edge, graph: Graph, curveOffset: number = 0, edgeVisibility: EdgeVisibility = 'external', layerMode: ArchitectureLayerMode = 'flat'): SpecGraphRFEdge {
  const contract = graph.contracts[edge.contractId] ?? null;
  const sourceExists = !!graph.nodes[edge.source];
  const targetExists = !!graph.nodes[edge.target];

  let hasError = !contract || !sourceExists || !targetExists;
  let errorMessage: string | undefined;

  if (!contract) {
    errorMessage = `Missing contract: ${edge.contractId}`;
  } else if (!sourceExists) {
    errorMessage = `Missing source node: ${edge.source}`;
  } else if (!targetExists) {
    errorMessage = `Missing target node: ${edge.target}`;
  }

  if (!hasError && edge.sourcePortId && edge.sourcePortId !== 'null' && edge.targetPortId && edge.targetPortId !== 'null') {
    const sourceNode = graph.nodes[edge.source];
    const targetNode = graph.nodes[edge.target];
    const sourcePort = sourceNode?.ports?.find(p => p.id === edge.sourcePortId);
    const targetPort = targetNode?.ports?.find(p => p.id === edge.targetPortId);

    if (!sourcePort) {
      hasError = true;
      errorMessage = `Missing source port: ${edge.sourcePortId}`;
    } else if (!targetPort) {
      hasError = true;
      errorMessage = `Missing target port: ${edge.targetPortId}`;
    }
  }

  const archObligations = deriveArchitecturalObligations(graph);
  const dismissedWarnings = (edge.metadata?.dismissedWarnings as string[]) || [];
  const edgeWarnings = archObligations.filter(ob => {
    if (ob.kind !== 'architectural_pattern' || ob.edgeId !== edge.id) {
      return false;
    }
    const warningId = `${ob.edgeId}:${ob.message}`;
    return !dismissedWarnings.includes(warningId);
  });
  const hasWarning = edgeWarnings.length > 0;
  const warningMessage = edgeWarnings.length > 0 ? edgeWarnings[0].message : undefined;

  // Owner bench 2026-07-29: React Flow SILENTLY drops an edge whose handle id
  // isn't rendered on the node — and node components render a handle per port,
  // typed by direction. A handle binding is therefore passed through ONLY when the
  // port exists AND its direction matches the role (source needs 'out', target
  // needs 'in'); anything else falls back to undefined, which binds to the node's
  // first matching handle (incl. the new FallbackHandles) — the edge RENDERS
  // instead of vanishing, and hasError above still flags truly-missing ports.
  const rawSourceHandle = edge.sourcePortId === 'null' || edge.sourcePortId === null || !edge.sourcePortId ? undefined : edge.sourcePortId;
  const rawTargetHandle = edge.targetPortId === 'null' || edge.targetPortId === null || !edge.targetPortId ? undefined : edge.targetPortId;
  const sourcePortForHandle = rawSourceHandle ? graph.nodes[edge.source]?.ports?.find(p => p.id === rawSourceHandle) : undefined;
  const targetPortForHandle = rawTargetHandle ? graph.nodes[edge.target]?.ports?.find(p => p.id === rawTargetHandle) : undefined;
  const sourceHandle = sourcePortForHandle && sourcePortForHandle.direction === 'out' ? rawSourceHandle : undefined;
  const targetHandle = targetPortForHandle && targetPortForHandle.direction === 'in' ? rawTargetHandle : undefined;

  const shouldHide = layerMode === 'nested' && edgeVisibility === 'containment';

  // Owner 2026-07-29: NODES draw above EDGES, always. Leaf nodes sit at
  // zIndex 10 and containers at 1, so every edge layer lives strictly
  // between them (>1 keeps edges above container fills, <10 keeps them
  // under nodes). Relative edge ordering is preserved from the old scheme.
  // Edge LABELS ride the edgelabel-renderer at zIndex 8 (CustomEdge) —
  // above every line, still under nodes.
  const zIndexByVisibility: Record<EdgeVisibility, number> = {
    'intra-container': 4,
    'cross-container': 7,
    'containment': 1,
    'external': 5,
  };

  const rfEdge: SpecGraphRFEdge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: sourceHandle ?? undefined,
    targetHandle: targetHandle ?? undefined,
    type: 'default',
    label: edge.label ?? contract?.name,
    animated: hasError,
    zIndex: zIndexByVisibility[edgeVisibility] ?? 100,
    hidden: shouldHide,
    data: {
      contract,
      contractStatus: (contract?.status === 'complete' ? 'complete' : 'draft') as 'draft' | 'complete',
      hasError,
      errorMessage,
      hasWarning,
      warningMessage,
      curveOffset,
      edgeVisibility,
      layerMode,
      direction: edge.direction,
      criticality: edge.criticality,
    },
  };

  return rfEdge;
}

export interface DeriveRFStateOptions {
  maxDepth?: number;
  autoCollapseDepth?: number;
}

export interface DeriveRFStateResult {
  nodes: SpecGraphRFNode[];
  edges: SpecGraphRFEdge[];
  warnings: string[];
  autoCollapsedNodeIds: string[];
  detectedMaxDepth: number;
}

export function deriveRFState(graph: Graph, layerMode: ArchitectureLayerMode = 'nested', catalog?: CatalogResolver | null, options?: DeriveRFStateOptions): DeriveRFStateResult {
  const warnings: string[] = [];
  const autoCollapsedNodeIds: string[] = [];

  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (!graph.contracts[edge.contractId]) {
      warnings.push(`Edge ${edgeId} references missing contract ${edge.contractId}`);
    }
    if (!graph.nodes[edge.source]) {
      warnings.push(`Edge ${edgeId} references missing source ${edge.source}`);
    }
    if (!graph.nodes[edge.target]) {
      warnings.push(`Edge ${edgeId} references missing target ${edge.target}`);
    }
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.artifacts) {
      for (const artifactId of node.artifacts) {
        if (!graph.artifacts[artifactId]) {
          warnings.push(`Node ${nodeId} references missing artifact ${artifactId}`);
        }
      }
    }
  }

  const detectedMaxDepth = layerMode === 'nested' ? computeMaxNestingDepth(graph) : 0;

  if (layerMode === 'nested' && (options?.autoCollapseDepth ?? 3) < detectedMaxDepth) {
    const threshold = options?.autoCollapseDepth ?? 3;
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      const depth = computeNestingDepth(nodeId, graph);
      if (depth >= threshold) {
        const nodeIsContainer = isContainerType(node.type, catalog);
        if (nodeIsContainer && node.metadata?.containerExpanded === undefined) {
          autoCollapsedNodeIds.push(nodeId);
        }
      }
    }
  }

  return {
    nodes: mapGraphToRFNodes(graph, layerMode, catalog, options?.maxDepth),
    edges: mapGraphToRFEdges(graph, layerMode, catalog),
    warnings,
    autoCollapsedNodeIds,
    detectedMaxDepth,
  };
}

export interface RequirementCriteriaData {
  nodeId: string;
  acceptanceCriteria: Array<{ text: string; met?: boolean; testId?: string }>;
}

export function enrichNodesWithCriteriaProgress(
  rfNodes: SpecGraphRFNode[],
  criteriaByNodeId: Map<string, Array<{ text: string; met?: boolean; testId?: string }>>,
): SpecGraphRFNode[] {
  if (criteriaByNodeId.size === 0) return rfNodes;

  return rfNodes.map(node => {
    const criteria = criteriaByNodeId.get(node.id);
    if (!criteria || criteria.length === 0) return node;

    return {
      ...node,
      data: {
        ...node.data,
        metadata: {
          ...node.data.metadata,
          acceptanceCriteria: criteria,
        },
      },
    };
  });
}

export interface TestSummaryByNodeId {
  [nodeId: string]: { total: number; passed: number; failed: number };
}

export function enrichNodesWithTestSummary(
  rfNodes: SpecGraphRFNode[],
  testSummaryByNodeId: TestSummaryByNodeId,
): SpecGraphRFNode[] {
  if (Object.keys(testSummaryByNodeId).length === 0) return rfNodes;

  return rfNodes.map(node => {
    const summary = testSummaryByNodeId[node.id];
    if (!summary || summary.total === 0) return node;

    return {
      ...node,
      data: {
        ...node.data,
        metadata: {
          ...node.data.metadata,
          testSummary: summary,
        },
      },
    };
  });
}

export function generateContainerSummaryEdges(
  graph: Graph,
  catalog?: CatalogResolver | null,
): RFEdge<ContainerSummaryEdgeData>[] {
  const summaryMap = computeCrossContainerSummaries(graph, catalog);
  const seen = new Set<string>();
  const summaryEdges: RFEdge<ContainerSummaryEdgeData>[] = [];

  for (const [containerId, summaries] of summaryMap) {
    for (const summary of summaries) {
      const pairKey = [containerId, summary.targetContainerId].sort().join('::');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const contractKinds = new Map<string, number>();
      for (const edgeInfo of summary.edges) {
        const domainEdge = graph.edges[edgeInfo.edgeId];
        if (domainEdge) {
          const contract = graph.contracts[domainEdge.contractId];
          const kind = contract?.kind ?? 'custom';
          contractKinds.set(kind, (contractKinds.get(kind) ?? 0) + 1);
        }
      }
      const sortedKinds = [...contractKinds.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k);

      const sourceContainer = graph.nodes[containerId];
      const targetContainer = graph.nodes[summary.targetContainerId];

      summaryEdges.push({
        id: `summary::${pairKey}`,
        source: containerId,
        target: summary.targetContainerId,
        type: 'containerSummary',
        zIndex: 6,
        data: {
          sourceContainerId: containerId,
          targetContainerId: summary.targetContainerId,
          sourceContainerLabel: sourceContainer?.label ?? containerId,
          targetContainerLabel: targetContainer?.label ?? summary.targetContainerId,
          edgeCount: summary.edges.length,
          dominantContractKinds: sortedKinds.slice(0, 3),
          edges: summary.edges.map(e => {
            const domainEdge = graph.edges[e.edgeId];
            const contract = domainEdge ? graph.contracts[domainEdge.contractId] : undefined;
            return {
              ...e,
              contractKind: contract?.kind,
              interactionKind: contract?.interactionKind,
              transport: contract?.transport,
              specFormat: contract?.specFormat,
            };
          }),
        },
      });
    }
  }

  return summaryEdges;
}
