import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type { SpecGraphRFNode, SpecGraphRFEdge } from '../adapters/graph-to-reactflow.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import { getLayoutPartition } from './layout-partition.js';

export interface ElkLayoutOptions {
  direction?: 'LR' | 'TB';
  catalog?: CatalogResolver | null;
}

export interface ElkNodePosition {
  id: string;
  x: number;
  y: number;
}

export interface ElkLayoutResult {
  /**
   * Positions for every node. Top-level nodes are absolute canvas
   * coordinates; children of containers are parent-relative — matching
   * exactly what React Flow (and the Canvas position stores) expect.
   */
  positions: ElkNodePosition[];
  /** Content-fitted sizes ELK computed for compound (container) nodes. */
  containerSizes: Map<string, { width: number; height: number }>;
}

// Fallback dimensions when a node hasn't been DOM-measured yet. Containers
// mirror graph-to-reactflow.ts sizing; regular nodes mirror the legacy
// auto-layout estimates.
const FALLBACK_NODE = { width: 200, height: 100 };
const FALLBACK_CONTAINER = { width: 500, height: 400 };

// elkjs bundled build runs the layout on the main thread. Fine for the
// graph sizes we see (hundreds of nodes lay out in tens of ms); moving to
// elk-worker.min.js via a Vite worker is a flagged follow-up if profiling
// ever says otherwise.
//
// The 1.6MB UMD bundle is loaded lazily on first layout so it stays out of
// the initial app bundle -- and so a resolution failure in any environment
// rejects the layout call (caught by Canvas's legacy-layout fallback)
// instead of preventing the whole app from booting.
interface ElkInstance {
  layout(graph: ElkNode): Promise<ElkNode>;
}
let elkPromise: Promise<ElkInstance> | null = null;
function getElk(): Promise<ElkInstance> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then((m) => {
    const ELKCtor = (m.default ?? m) as unknown as new () => ElkInstance;
    return new ELKCtor();
  });
  return elkPromise;
}

function measuredSize(node: SpecGraphRFNode): { width?: number; height?: number } {
  const measured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
  return {
    width: measured?.width ?? (node.width as number | undefined),
    height: measured?.height ?? (node.height as number | undefined),
  };
}

/**
 * Layered, crossing-minimized, container-aware layout via ELK — the same
 * algorithm family Mermaid/dagre use, plus compound-node support and
 * semantic partitioning (frontend -> services -> data -> external columns).
 */
export async function calculateElkLayout(
  nodes: SpecGraphRFNode[],
  edges: SpecGraphRFEdge[],
  options: ElkLayoutOptions = {},
): Promise<ElkLayoutResult> {
  const { direction = 'LR', catalog = null } = options;

  if (nodes.length === 0) {
    return { positions: [], containerSizes: new Map() };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string, SpecGraphRFNode[]>();
  for (const node of nodes) {
    if (node.parentId && nodeById.has(node.parentId)) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentId, siblings);
    }
  }

  const isCompound = (node: SpecGraphRFNode): boolean =>
    childrenByParent.has(node.id) ||
    node.type === 'container' ||
    node.type === 'group' ||
    node.type === 'logicalBoundary';

  // Partition constraints only apply to top-level leaf nodes: children are
  // placed within their container by edges alone, and containers themselves
  // move freely so they can sit where their connections pull them.
  let partitionsUsed = false;
  const buildElkNode = (node: SpecGraphRFNode, topLevel: boolean): ElkNode => {
    const compound = isCompound(node);
    const children = childrenByParent.get(node.id) ?? [];
    const size = measuredSize(node);

    const elkNode: ElkNode = {
      id: node.id,
      layoutOptions: {},
    };

    if (compound && children.length > 0) {
      elkNode.children = children.map((child) => buildElkNode(child, false));
      elkNode.layoutOptions = {
        'elk.padding': '[top=90.0,left=50.0,bottom=50.0,right=50.0]',
        'elk.spacing.nodeNode': '40',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      };
      // Give ELK a floor but let content grow the container.
      elkNode.width = Math.max(size.width ?? 0, 300);
      elkNode.height = Math.max(size.height ?? 0, 250);
    } else {
      elkNode.width = size.width ?? (compound ? FALLBACK_CONTAINER.width : FALLBACK_NODE.width);
      elkNode.height = size.height ?? (compound ? FALLBACK_CONTAINER.height : FALLBACK_NODE.height);

      if (topLevel && !compound) {
        const nodeType = (node.data as { nodeType?: string } | undefined)?.nodeType ?? node.type ?? '';
        const partition = getLayoutPartition(nodeType, catalog);
        if (partition !== null) {
          partitionsUsed = true;
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            'elk.partitioning.partition': String(partition),
          };
        }
      }
    }

    return elkNode;
  };

  const topLevelNodes = nodes.filter((n) => !n.parentId || !nodeById.has(n.parentId));
  const elkChildren = topLevelNodes.map((n) => buildElkNode(n, true));

  // With INCLUDE_CHILDREN, all edges can live at the root regardless of
  // which hierarchy level their endpoints sit in.
  const elkEdges: ElkExtendedEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    if (seenEdgeIds.has(edge.id)) continue;
    seenEdgeIds.add(edge.id);
    elkEdges.push({ id: edge.id, sources: [edge.source], targets: [edge.target] });
  }

  const rootOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': direction === 'TB' ? 'DOWN' : 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.nodeNode': '48',
    'elk.spacing.componentComponent': '96',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  };
  if (partitionsUsed) {
    rootOptions['elk.partitioning.activate'] = 'true';
  }

  const elk = await getElk();
  const layouted = await elk.layout({
    id: '__root__',
    layoutOptions: rootOptions,
    children: elkChildren,
    edges: elkEdges,
  });

  const positions: ElkNodePosition[] = [];
  const containerSizes = new Map<string, { width: number; height: number }>();

  const collect = (elkNode: ElkNode) => {
    for (const child of elkNode.children ?? []) {
      positions.push({ id: child.id, x: child.x ?? 0, y: child.y ?? 0 });
      if (child.children && child.children.length > 0) {
        containerSizes.set(child.id, {
          width: Math.round(child.width ?? FALLBACK_CONTAINER.width),
          height: Math.round(child.height ?? FALLBACK_CONTAINER.height),
        });
        collect(child);
      }
    }
  };
  collect(layouted);

  return { positions, containerSizes };
}
