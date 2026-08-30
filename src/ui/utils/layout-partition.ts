import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';

/**
 * Semantic layout partitions: left-to-right architectural columns shared by
 * the ELK canvas layout and the Mermaid export so both surfaces read the
 * same way — clients/frontends on the left, flowing through edge and
 * services, to data stores and external systems on the right, with an
 * ops/delivery lane last.
 *
 * Returning null means "no opinion" — the node is left unpartitioned and
 * the layout engine places it purely by its edges (used for containers,
 * platforms, and unknown types, where forcing a column does more harm
 * than good).
 */
export const LAYOUT_PARTITIONS = {
  client: 0,
  edge: 1,
  service: 2,
  messaging: 3,
  data: 4,
  external: 5,
  operations: 6,
} as const;

// M1c: keyed on interface_kind (what an edge into the node MEANS) rather than the retired
// `kind`. This is a better fit than the axis it replaces: the layout columns are about data
// flow, which is exactly what interface_kind describes. `service` carries no column opinion
// and falls through to the nature/heuristic rules below.
const INTERFACE_PARTITION: Record<string, number> = {
  queue: LAYOUT_PARTITIONS.messaging,
  event_bus: LAYOUT_PARTITIONS.messaging,
  data: LAYOUT_PARTITIONS.data,
  object_store: LAYOUT_PARTITIONS.data,
  telemetry: LAYOUT_PARTITIONS.operations,
};

// Ordered: first match wins. Mirrors and extends the import-layout
// ROLE_COLUMN table (src/domain/repo-import/import-layout.ts).
const ID_HEURISTICS: Array<[RegExp, number]> = [
  [/gateway|ingress|load-?balancer|\bcdn\b|reverse-?proxy|api-?edge/, LAYOUT_PARTITIONS.edge],
  [/frontend|web-?app|mobile|desktop|\bcli\b|\bspa\b|static-?site|\bui\b/, LAYOUT_PARTITIONS.client],
  [/queue|broker|kafka|topic|event-?(bus|stream)|pub-?sub/, LAYOUT_PARTITIONS.messaging],
  [/database|\bdb\b|cache|redis|storage|object-?store|search-?engine|warehouse|vector/, LAYOUT_PARTITIONS.data],
  [/external|third-?party|stripe|payment|webhook-?provider/, LAYOUT_PARTITIONS.external],
  [/monitor|logging|observab|\bci\b|\bcd\b|pipeline|testing|deploy|terraform|infra/, LAYOUT_PARTITIONS.operations],
  [/auth/, LAYOUT_PARTITIONS.edge],
  [/backend|service|worker|server|api/, LAYOUT_PARTITIONS.service],
];

/**
 * Catalog-free partition lookup by role/type id substring. Used as the
 * client fallback and as the entire strategy for the server-side Mermaid
 * formatter (which has no catalog access).
 */
export function getStaticPartition(typeOrRoleId: string): number | null {
  const id = (typeOrRoleId || '').toLowerCase();
  if (!id) return null;
  for (const [pattern, partition] of ID_HEURISTICS) {
    if (pattern.test(id)) return partition;
  }
  return null;
}

/**
 * Resolve a node type to its layout partition using the role catalog when
 * available (kind first, then palette category, then id heuristics).
 */
export function getLayoutPartition(
  nodeType: string,
  catalog: CatalogResolver | null | undefined,
): number | null {
  const role = catalog?.resolveNodeType(nodeType)?.role ?? null;

  if (role) {
    // Containers, platforms, and logical groups are placed by their edges
    // and contents, not forced into a column.
    if (role.isContainer) return null;
    const iface = role.interfaceKind || 'service';
    if (iface in INTERFACE_PARTITION) return INTERFACE_PARTITION[iface];
    // Third-party systems sit on the right, whatever they interface as.
    if (role.nature === 'call') return LAYOUT_PARTITIONS.external;
    // Engines are delivery/ops machinery (CI, IaC, scheduled pipelines).
    if (role.nature === 'engine') return LAYOUT_PARTITIONS.operations;
    // Hardware is the client edge of the system.
    if (role.paletteCategory === 'Hardware') return LAYOUT_PARTITIONS.client;
    const byRoleId = getStaticPartition(role.id ?? nodeType);
    if (byRoleId !== null) return byRoleId;
    if (role.nature === 'build') return LAYOUT_PARTITIONS.service;
  }

  return getStaticPartition(nodeType);
}
