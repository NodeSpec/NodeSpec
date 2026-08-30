import type { ProjectExportData } from './export-context.js';
import { getStaticPartition, LAYOUT_PARTITIONS } from './layout-partition.js';

/**
 * Mermaid export aligned with the ELK canvas layout: nodes are emitted in
 * semantic-partition order (clients -> edge -> services -> messaging ->
 * data -> external -> operations) so Mermaid's layered renderer produces
 * the same left-to-right architectural flow the canvas shows, with
 * per-partition classDef styling and role-appropriate node shapes.
 *
 * Structure mirrors the server formatter (_shared/mermaid-formatter.ts):
 * containers as subgraphs, depth-3 reparenting, compact mode at >= 50 nodes.
 */

type ExportNode = ProjectExportData['nodes'][number];
type ExportEdge = ProjectExportData['edges'][number];

const MAX_DEPTH = 3;
const COMPACT_THRESHOLD = 50;
const COMPACT_CONTAINER_LEAF_LIMIT = 5;
const COMPACT_REPRESENTATIVES = 3;

const PARTITION_CLASS: Record<number, string> = {
  [LAYOUT_PARTITIONS.client]: 'client',
  [LAYOUT_PARTITIONS.edge]: 'edge',
  [LAYOUT_PARTITIONS.service]: 'service',
  [LAYOUT_PARTITIONS.messaging]: 'messaging',
  [LAYOUT_PARTITIONS.data]: 'data',
  [LAYOUT_PARTITIONS.external]: 'external',
  [LAYOUT_PARTITIONS.operations]: 'operations',
};

const CLASS_DEFS = [
  'classDef client fill:#eff6ff,stroke:#3b82f6,stroke-width:1.5px',
  'classDef edge fill:#ecfeff,stroke:#06b6d4,stroke-width:1.5px',
  'classDef service fill:#f0fdf4,stroke:#22c55e,stroke-width:1.5px',
  'classDef messaging fill:#fefce8,stroke:#eab308,stroke-width:1.5px',
  'classDef data fill:#faf5ff,stroke:#a855f7,stroke-width:1.5px',
  'classDef external fill:#fff7ed,stroke:#f97316,stroke-width:1.5px',
  'classDef operations fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px',
  'classDef boundary fill:transparent,stroke:#94a3b8,stroke-dasharray:5 5',
];

function sanitizeLabel(label: string): string {
  return (label || '')
    .replace(/["[\]{}()|\\<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'node';
}

function partitionSortKey(node: ExportNode): number {
  // Unpartitioned nodes sort between services and messaging.
  return getStaticPartition(node.type) ?? LAYOUT_PARTITIONS.service + 0.5;
}

function nodeShape(node: ExportNode, shortId: string): string {
  const label = sanitizeLabel(node.label) + (node.technology ? `\\n${sanitizeLabel(node.technology)}` : '');
  const partition = getStaticPartition(node.type);
  switch (partition) {
    case LAYOUT_PARTITIONS.data:
      return `${shortId}[("${label}")]`;
    case LAYOUT_PARTITIONS.external:
      return `${shortId}(["${label}"])`;
    case LAYOUT_PARTITIONS.edge:
      return `${shortId}{{"${label}"}}`;
    case LAYOUT_PARTITIONS.messaging:
      return `${shortId}[/"${label}"\\]`;
    default:
      return `${shortId}["${label}"]`;
  }
}

function nodeClass(node: ExportNode): string | null {
  const partition = getStaticPartition(node.type);
  return partition === null ? null : PARTITION_CLASS[partition] ?? null;
}

interface PreparedGraph {
  nodes: Map<string, ExportNode>;
  childrenOf: Map<string, ExportNode[]>;
  containerIds: Set<string>;
  roots: ExportNode[];
  orphans: ExportNode[];
}

function prepare(data: ProjectExportData): PreparedGraph {
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));

  // Depth clamp: re-parent nodes deeper than MAX_DEPTH to their depth-MAX_DEPTH ancestor.
  const depthOf = (n: ExportNode): number => {
    let depth = 0;
    let current = n;
    while (current.parentId && nodes.has(current.parentId) && depth <= MAX_DEPTH + 1) {
      current = nodes.get(current.parentId)!;
      depth++;
    }
    return depth;
  };
  const effectiveParent = new Map<string, string | undefined>();
  for (const n of data.nodes) {
    let parentId = n.parentId && nodes.has(n.parentId) ? n.parentId : undefined;
    if (parentId && depthOf(n) > MAX_DEPTH) {
      let ancestor = n;
      const chain: ExportNode[] = [];
      while (ancestor.parentId && nodes.has(ancestor.parentId)) {
        ancestor = nodes.get(ancestor.parentId)!;
        chain.push(ancestor);
      }
      // chain is [parent, grandparent, ..., root]; pick the ancestor at depth MAX_DEPTH-1 from root.
      parentId = chain[chain.length - MAX_DEPTH]?.id ?? parentId;
    }
    effectiveParent.set(n.id, parentId);
  }

  const childrenOf = new Map<string, ExportNode[]>();
  for (const n of data.nodes) {
    const parentId = effectiveParent.get(n.id);
    if (parentId) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(n);
      childrenOf.set(parentId, siblings);
    }
  }
  const containerIds = new Set(childrenOf.keys());

  const byPartition = (a: ExportNode, b: ExportNode) =>
    partitionSortKey(a) - partitionSortKey(b) || a.label.localeCompare(b.label);

  for (const children of childrenOf.values()) children.sort(byPartition);

  const topLevel = data.nodes.filter((n) => !effectiveParent.get(n.id));
  const roots = topLevel.filter((n) => containerIds.has(n.id));
  const orphans = topLevel.filter((n) => !containerIds.has(n.id)).sort(byPartition);

  // Order root containers by the minimum partition of their descendants so
  // e.g. a frontend container renders before the data-layer container.
  const minDescendantPartition = (id: string): number => {
    let min = Number.POSITIVE_INFINITY;
    for (const child of childrenOf.get(id) ?? []) {
      min = Math.min(
        min,
        containerIds.has(child.id) ? minDescendantPartition(child.id) : partitionSortKey(child),
      );
    }
    return min === Number.POSITIVE_INFINITY ? LAYOUT_PARTITIONS.service : min;
  };
  roots.sort((a, b) => minDescendantPartition(a.id) - minDescendantPartition(b.id) || a.label.localeCompare(b.label));

  return { nodes, childrenOf, containerIds, roots, orphans };
}

export function formatAsMermaid(data: ProjectExportData): string | null {
  if (!data.nodes.length) return null;

  const prepared = prepare(data);
  const compact = data.nodes.length >= COMPACT_THRESHOLD;

  const shortId = new Map<string, string>();
  let counter = 0;
  const idFor = (nodeId: string): string => {
    let sid = shortId.get(nodeId);
    if (!sid) {
      sid = `n${counter++}`;
      shortId.set(nodeId, sid);
    }
    return sid;
  };

  const lines: string[] = ['flowchart LR'];
  const classAssignments: string[] = [];
  const renderedLeaves = new Set<string>();

  const declareLeaf = (node: ExportNode, indent: string) => {
    lines.push(`${indent}${nodeShape(node, idFor(node.id))}`);
    renderedLeaves.add(node.id);
    const cls = nodeClass(node);
    if (cls) classAssignments.push(`class ${idFor(node.id)} ${cls}`);
  };

  const renderContainer = (container: ExportNode, indent: string) => {
    const children = prepared.childrenOf.get(container.id) ?? [];
    const leafChildren = children.filter((c) => !prepared.containerIds.has(c.id));
    const subContainers = children.filter((c) => prepared.containerIds.has(c.id));

    lines.push(`${indent}subgraph ${idFor(container.id)}["${sanitizeLabel(container.label)}"]`);

    if (compact && subContainers.length === 0 && leafChildren.length > COMPACT_CONTAINER_LEAF_LIMIT) {
      for (const child of leafChildren.slice(0, COMPACT_REPRESENTATIVES)) {
        declareLeaf(child, indent + '  ');
      }
      const remaining = leafChildren.length - COMPACT_REPRESENTATIVES;
      lines.push(`${indent}  ${idFor(container.id)}_more["... +${remaining} more"]`);
    } else {
      for (const child of leafChildren) declareLeaf(child, indent + '  ');
      for (const sub of subContainers) renderContainer(sub, indent + '  ');
    }

    lines.push(`${indent}end`);
    classAssignments.push(`class ${idFor(container.id)} boundary`);
  };

  for (const root of prepared.roots) renderContainer(root, '  ');
  for (const orphan of prepared.orphans) declareLeaf(orphan, '  ');

  // Edges: resolve endpoints hidden by compact collapsing up to their
  // nearest rendered ancestor; drop resulting self-loops and duplicates.
  const resolveEndpoint = (nodeId: string): string | null => {
    if (renderedLeaves.has(nodeId) || (prepared.containerIds.has(nodeId) && shortId.has(nodeId))) {
      return nodeId;
    }
    let current = prepared.nodes.get(nodeId);
    while (current?.parentId) {
      const parent = prepared.nodes.get(current.parentId);
      if (!parent) break;
      if (shortId.has(parent.id)) return parent.id;
      current = parent;
    }
    return null;
  };

  const emittedEdges = new Set<string>();
  for (const edge of data.edges as ExportEdge[]) {
    const source = resolveEndpoint(edge.sourceId);
    const target = resolveEndpoint(edge.targetId);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}:${edge.contractKind ?? ''}`;
    if (emittedEdges.has(key)) continue;
    emittedEdges.add(key);

    if (edge.contractName) {
      const label = sanitizeLabel(`${edge.contractKind ? edge.contractKind + ': ' : ''}${edge.contractName}`);
      lines.push(`  ${idFor(source)} -->|"${label}"| ${idFor(target)}`);
    } else {
      lines.push(`  ${idFor(source)} --> ${idFor(target)}`);
    }
  }

  lines.push('');
  for (const def of CLASS_DEFS) lines.push(`  ${def}`);
  for (const assignment of classAssignments) lines.push(`  ${assignment}`);

  return lines.join('\n');
}
