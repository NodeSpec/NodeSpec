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
import type { Graph, Node, Edge, Contract, EntityStatus, NodeGroup } from '@nodespec/core/types.js';
import { deriveArchitecturalObligations } from '@nodespec/core/obligations.js';
import { effectiveTreatmentForRole } from '@nodespec/core/ontology.js';
import { dominantChildTechnologies } from '../utils/semantic-zoom.js';
import { getNodeTypeById } from '@nodespec/core/node-types.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import { resolveRFVisualType, isContainerType, isLogicalBoundaryType } from './rf-visual-type-resolver.js';
import { ROWS_SHOWN, asAccess, asDataModel, asReference, type Access, type DataModel, type DataShape, type GroupEntry, type Reference } from './data-shape.js';
import { calculateFlowAwareContainerSize } from '../utils/container-child-layout.js';
import { hasRepoImportCanvas } from '../config/edition.js';

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
  metadata: Record<string, unknown>;
  hasError: boolean;
  errorMessage?: string;
  status?: EntityStatus;
  isDraft: boolean;
  highlighted?: boolean;
  isLocked?: boolean;
  /** AA.5: a fresh lease on the node (its holder, the level, since when); the node is locked for everyone else. */
  lease?: { holder: string; level: 'node' | 'work'; since: string; count: number; mine: boolean } | null;
  /** AA.2: the active change's constraints, marked on a node in its scope while the scope is shown. */
  changeConstraints?: number;
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
  /** AA.3: exploded into its parts: a box whose role is not a container. */
  exploded?: boolean;
  /** AA.3b: an exploded data store: its model and how many groups and items it holds. */
  dataShape?: DataShape;
  /** AA.3b: a group of a data store (a table group): what it lists. */
  group?: { model: DataModel | null; entries: GroupEntry[] };
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
  /** RI-6: repo-import evidence behind the edge (hosted + enterprise). */
  importEvidence?: ImportEdgeEvidence;
  /** AA.2: while a change's scope is shown: inside it, crossing into it, or outside it. */
  scopeState?: 'in' | 'crossing' | 'out';
  /** AA.3: an end is drawn on the collapsed box that hides it, not on the node it names. */
  rolledUp?: boolean;
  /** AA.3b: a service edge landing on a data store's group reads, writes or both. */
  access?: Access;
  /** AA.3b: an edge between two groups: a foreign key, or a reference kept in code. */
  reference?: Reference;
}

export interface ImportEdgeEvidence {
  kind: string;
  count: number;
  samples: string[];
}

/** edge.metadata.evidence as written by the import synthesizer, or undefined. */
export function readImportEdgeEvidence(metadata: Record<string, unknown> | undefined): ImportEdgeEvidence | undefined {
  if (!hasRepoImportCanvas || !metadata) return undefined;
  const ev = metadata.evidence as { kind?: unknown; count?: unknown; samples?: unknown } | undefined;
  if (!ev || typeof ev.count !== 'number') return undefined;
  return {
    kind: typeof ev.kind === 'string' ? ev.kind : 'import',
    count: ev.count,
    samples: Array.isArray(ev.samples) ? ev.samples.filter((s): s is string => typeof s === 'string') : [],
  };
}

export type SpecGraphRFNode = RFNode<RFNodeData>;
export type SpecGraphRFEdge = RFEdge<RFEdgeData>;

// V3 P3: the shell's CanvasViewMode ('ideation' | 'architecture') lives in
// ViewToggle.tsx — this adapter serves the Architecture canvas only, and
// its one dimension is the layer mode.
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
  const roleIsContainer = isContainerType(node.type, catalog);
  const nodeIsLogicalBoundary = rfNodeType === 'logicalBoundary';
  // AA.3: a node whose role is not a container has children only when it is
  // exploded into its parts. AB.7 (owner 2026-09-24): parts are what a node is
  // made of, not where it runs. The deployment view never shows them: the node
  // is itself, in its host. The functional view shows it as a card that opens
  // on demand (metadata.partsShown, the viewer's own view state): a data store
  // opens into its schema, anything else into its parts.
  const exploded = !roleIsContainer && !nodeIsLogicalBoundary && childCount > 0;
  const explodedBox = exploded && layerMode === 'flat';
  const partsShown = explodedBox && partsAreShown(node);
  const nodeIsContainer = roleIsContainer || explodedBox;
  // AA.3b: an exploded data store and its groups (their shape, in the functional view).
  const dataChildren = explodedBox ? children.filter((c) => isDataPartNode(c, catalog)) : [];
  const dataShape: DataShape | undefined = dataChildren.length > 0
    ? { model: dataModelOf(node, catalog), groups: dataChildren.length, items: dataChildren.reduce((n, c) => n + groupEntries(c, graph).length, 0) }
    : undefined;
  const parentNode = node.parentId ? graph.nodes[node.parentId] : undefined;
  const group = parentNode && isDataPartNode(node, catalog)
    ? { model: dataModelOf(parentNode, catalog), entries: groupEntries(node, graph) }
    : undefined;

  const position = { x: 0, y: 0 };

  let actualRFType = rfNodeType;
  let shouldBeHidden = false;
  let containerParentLabel: string | undefined;

  let isInsideLogicalBoundary = false;

  if (layerMode === 'nested' && !nodeIsContainer && !nodeIsLogicalBoundary) {
    actualRFType = group ? 'tableGroup' : 'icon';
  }

  if (layerMode === 'flat') {
    // AA.3: the flat view hides hosting boxes and shows what they hold; an
    // exploded node is not a hosting box, so it shows. AB.7: its parts show
    // inside it once it is opened, and roll up into it while it is closed.
    if (roleIsContainer && !nodeIsLogicalBoundary) {
      shouldBeHidden = true;
    }
    if (node.parentId) {
      const parent = graph.nodes[node.parentId];
      if (parent && isExplodedNode(parent, graph, catalog)) {
        if (partsAreShown(parent)) actualRFType = group ? 'tableGroup' : 'icon';
        else shouldBeHidden = true;
      } else if (parent && isLogicalBoundaryType(parent.type, catalog)) {
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
      exploded: explodedBox || undefined,
      ...(dataShape ? { dataShape } : {}),
      ...(group ? { group } : {}),
    },
    zIndex: roleIsContainer || partsShown ? 1 : 10,
    hidden: shouldBeHidden,
  };

  if (node.parentId && layerMode === 'nested') {
    const parent = graph.nodes[node.parentId];
    if (parent && isExplodedNode(parent, graph, catalog)) {
      // AB.7: a part never shows where things run; its node stands for it.
      rfNode.hidden = true;
    } else if (!parent) {
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
    if (parent && isExplodedNode(parent, graph, catalog) && partsAreShown(parent)) {
      rfNode.parentId = node.parentId;
      rfNode.extent = 'parent' as const;
      rfNode.zIndex = 10;
    } else if (parent && isLogicalBoundaryType(parent.type, catalog)) {
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

  if (nodeIsContainer && (layerMode === 'nested' || nodeIsLogicalBoundary || explodedBox)) {
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
      // AB.7: an exploded node opens by its own toggle, closed until opened.
      const isExpanded = explodedBox ? partsShown : ((node.metadata?.containerExpanded as boolean | undefined) ?? true);

      rfNode.type = 'container';

      if (!isExpanded) {
        rfNode.width = 240;
        rfNode.height = 80;
      } else {
        const metaW = node.metadata?.width as number | undefined;
        const metaH = node.metadata?.height as number | undefined;
        const fit = explodedBox ? layoutParts(node.id, graph, catalog).sizing : minSize;
        rfNode.width = Math.max(fit.width, metaW ?? 0);
        rfNode.height = Math.max(fit.height, metaH ?? 0);
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

/** AA.3b: a part that groups a data store's contents (a table group): its role
 *  is a part whose interface is data. Before the catalog is read, the table
 *  group's own role id. A table list alone does not make one: a database the
 *  person drew carries its tables too, and it is a database wherever it sits. */
export function isDataPartNode(node: Node, catalog?: CatalogResolver | null): boolean {
  const role = catalog?.getRole(node.type);
  if (role) return (role.capabilityTags ?? []).includes('part') && role.interfaceKind === 'data';
  return node.type === 'part-table-group';
}

/** AA.3b: the data model of a node's technology, from its catalog row. */
function dataModelOf(node: Node, catalog?: CatalogResolver | null): DataModel | null {
  if (!catalog || !node.technology) return null;
  return asDataModel(catalog.getTechnology(node.technology)?.aiContext?.dataModel);
}

/** AA.3b: what a group lists, each with the file that defines it when that
 *  file is bound. Item 25: the file may live anywhere in the project (a
 *  service's migrations, one schema file left on the database); the group's
 *  own file wins, and the row opens it on the node that holds it. */
function groupEntries(node: Node, graph: Graph): GroupEntry[] {
  const raw = Array.isArray(node.metadata?.tables) ? node.metadata!.tables as Array<Record<string, unknown>> : [];
  const artifactByPath = new Map<string, { id: string; nodeId: string }>();
  for (const a of Object.values(graph.artifacts)) {
    if (!a.path || !a.nodeId || a.kind === 'task' || a.kind === 'test-plan') continue;
    if (a.nodeId === node.id || !artifactByPath.has(a.path)) artifactByPath.set(a.path, { id: a.id, nodeId: a.nodeId });
  }
  return raw
    .filter((t) => t && typeof t.name === 'string' && t.name)
    .map((t) => {
      const entry: GroupEntry = { name: String(t.name) };
      if (typeof t.columns === 'number') entry.columns = t.columns;
      if (Array.isArray(t.keys)) entry.keys = t.keys.map(String);
      if (typeof t.kind === 'string') entry.kind = t.kind;
      if (typeof t.note === 'string') entry.note = t.note;
      if (typeof t.file === 'string') {
        entry.file = t.file;
        const bound = artifactByPath.get(t.file);
        if (bound) { entry.artifactId = bound.id; entry.artifactNodeId = bound.nodeId; }
      }
      return entry;
    });
}

/** AB.7: whether the viewer opened an exploded node to show its parts (its schema, for a data store). Closed by default. */
export function partsAreShown(node: Node): boolean {
  return node.metadata?.partsShown === true;
}

/** AB.7: a part of an exploded node. It is placed inside its node, never on its own. */
export function isPartNode(node: Node, graph: Graph, catalog?: CatalogResolver | null): boolean {
  const parent = node.parentId ? graph.nodes[node.parentId] : undefined;
  return !!parent && isExplodedNode(parent, graph, catalog);
}

const PARTS_PAD_X = 40;
const PARTS_PAD_TOP = 72;
const PARTS_PAD_BOTTOM = 40;
const PARTS_GAP = 32;
const GROUP_WIDTH = 340;
const ICON_SIZE = 80;

/** AB.7: where an opened node's parts sit inside it (relative to it), and the
 *  size that holds them. A table group is as tall as the rows it shows. */
export function layoutParts(
  nodeId: string,
  graph: Graph,
  catalog?: CatalogResolver | null,
): { positions: Array<{ id: string; x: number; y: number }>; sizing: { width: number; height: number } } {
  const parts = Object.values(graph.nodes)
    .filter((n) => n.parentId === nodeId)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (parts.length === 0) return { positions: [], sizing: { width: 240, height: 80 } };

  const sized = parts.map((p) => {
    if (!isDataPartNode(p, catalog)) return { id: p.id, w: ICON_SIZE, h: ICON_SIZE };
    const rows = groupEntries(p, graph).length;
    const shown = Math.min(rows, ROWS_SHOWN);
    return { id: p.id, w: GROUP_WIDTH, h: 56 + Math.max(1, shown) * 34 + (rows > ROWS_SHOWN ? 34 : 0) };
  });
  const cols = Math.min(sized.length, sized.some((s) => s.w === GROUP_WIDTH) ? 2 : 4);
  const cellW = Math.max(...sized.map((s) => s.w));

  const positions: Array<{ id: string; x: number; y: number }> = [];
  let y = PARTS_PAD_TOP;
  for (let row = 0; row * cols < sized.length; row++) {
    const inRow = sized.slice(row * cols, row * cols + cols);
    inRow.forEach((s, col) => positions.push({ id: s.id, x: PARTS_PAD_X + col * (cellW + PARTS_GAP), y }));
    y += Math.max(...inRow.map((s) => s.h)) + PARTS_GAP;
  }
  return {
    positions,
    sizing: {
      width: PARTS_PAD_X * 2 + cols * cellW + (cols - 1) * PARTS_GAP,
      height: y - PARTS_GAP + PARTS_PAD_BOTTOM,
    },
  };
}

/** AA.3: a node whose role is not a container but that has children: it is exploded into its parts. */
export function isExplodedNode(node: Node, graph: Graph, catalog?: CatalogResolver | null): boolean {
  if (isContainerType(node.type, catalog) || isLogicalBoundaryType(node.type, catalog)) return false;
  return Object.values(graph.nodes).some((n) => n.parentId === node.id);
}

/** A box that collapses and expands (a container or a logical boundary). AB.7:
 *  an exploded node is not one: its parts open by its own toggle, in the
 *  functional view only. */
export function isBoxNode(node: Node, _graph: Graph, catalog?: CatalogResolver | null): boolean {
  return isContainerType(node.type, catalog) || isLogicalBoundaryType(node.type, catalog);
}

/**
 * AA.3: where an edge's end shows on the canvas. Nested: the node itself, or the
 * outermost collapsed box hiding it, so a collapsed box shows its outside edges.
 * AB.7: a part rolls up into its exploded node in the deployment view always,
 * and in the functional view while the node is closed.
 */
export function visibleEndpoint(nodeId: string, graph: Graph, layerMode: ArchitectureLayerMode, catalog?: CatalogResolver | null): string {
  let shown = nodeId;
  const visited = new Set<string>();
  let currentId: string | undefined = graph.nodes[nodeId]?.parentId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const ancestor = graph.nodes[currentId];
    if (!ancestor) break;
    if (isExplodedNode(ancestor, graph, catalog)) {
      if (layerMode === 'nested' || !partsAreShown(ancestor)) shown = ancestor.id;
    } else if (layerMode === 'nested' && ((ancestor.metadata?.containerExpanded as boolean | undefined) ?? true) === false) {
      shown = ancestor.id;
    }
    currentId = ancestor.parentId;
  }
  return shown;
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

  const rolledGroups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = `${visibleEndpoint(edge.source, graph, layerMode, catalog)}-${visibleEndpoint(edge.target, graph, layerMode, catalog)}`;
    if (!rolledGroups.has(key)) {
      rolledGroups.set(key, []);
    }
    rolledGroups.get(key)!.push(edge);
  }

  return edges.map((edge) => {
    // AA.3: an end hidden inside a collapsed box (or a part in the flat view)
    // shows on the box; edges that now share a pair of ends are staggered together.
    const source = visibleEndpoint(edge.source, graph, layerMode, catalog);
    const target = visibleEndpoint(edge.target, graph, layerMode, catalog);
    const key = `${source}-${target}`;
    const group = rolledGroups.get(key)!;
    const index = group.indexOf(edge);

    const visibility = layerMode === 'nested' ? classifyEdge(edge, graph, catalog) : 'external';
    const staggerPx = visibility === 'intra-container' ? 15 : 30;
    const offset = group.length > 1 ? (index - (group.length - 1) / 2) * staggerPx : 0;

    const rfEdge = mapEdgeToRFEdge(edge, graph, offset, visibility, layerMode);
    if (source === edge.source && target === edge.target) return rfEdge;
    return {
      ...rfEdge,
      source,
      target,
      // Both ends inside the same collapsed box: the edge is inside it.
      hidden: rfEdge.hidden || source === target,
      data: { ...rfEdge.data!, rolledUp: true },
    };
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

  // AG.13 (owner 2026-09-28): ports came out of the model. Every node draws
  // one unnamed handle each side (LeafHandles, or FallbackHandles on a
  // container), so an edge never names a handle: a stored port id on an old
  // edge is ignored, and React Flow binds the edge to the node's handle. Before
  // this, an edge naming a handle the node did not draw was silently dropped
  // (owner bench 2026-07-29).
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
      importEvidence: readImportEdgeEvidence(edge.metadata as Record<string, unknown> | undefined),
      ...(asAccess(edge.metadata?.access) ? { access: asAccess(edge.metadata?.access)! } : {}),
      ...(asReference(edge.metadata?.reference) ? { reference: asReference(edge.metadata?.reference)! } : {}),
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
