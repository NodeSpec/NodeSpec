import type { Graph, Port } from './types.js';
import { CURRENT_GRAPH_SCHEMA_VERSION, GraphSchema } from './schemas.js';
import { computeHash, updateGraphHash } from './utils.js';
import { getNodeTypeById } from './node-types.js';
import { KIND_TO_INTERACTION_FIELDS, compressInteractionKind, LEGACY_INTERACTION_KIND_MAP, LEGACY_CONTRACT_KIND_MAP } from './shared/legacy-mappings.js';
import type { ContractKind } from './shared/enums.js';
import type { LegacyContractKind } from './shared/legacy-mappings.js';

export interface MigrationResult {
  graph: Graph;
  migratedFrom: number;
  migratedTo: number;
  changes: string[];
}

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: unknown
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

function generateDeterministicPortId(nodeId: string, direction: 'in' | 'out'): string {
  const seed = `${nodeId}:${direction}:default`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${hex.slice(0, 12).padEnd(12, '0')}`;
}

function generateDeterministicPortIdIndexed(nodeId: string, direction: 'in' | 'out', index: number): string {
  const seed = `${nodeId}:${direction}:${index}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${hex.slice(0, 12).padEnd(12, '0')}`;
}

function createDefaultPorts(nodeId: string): Port[] {
  return [
    {
      id: generateDeterministicPortId(nodeId, 'in'),
      name: 'default-in',
      direction: 'in',
    },
    {
      id: generateDeterministicPortId(nodeId, 'out'),
      name: 'default-out',
      direction: 'out',
    },
  ];
}

export function createTypeAwarePorts(nodeId: string, nodeType: string): Port[] {
  const typeDef = getNodeTypeById(nodeType);
  if (!typeDef?.defaultPorts || typeDef.defaultPorts.length === 0) {
    return createDefaultPorts(nodeId);
  }

  const inCount = { current: 0 };
  const outCount = { current: 0 };

  return typeDef.defaultPorts.map((template) => {
    const counter = template.direction === 'in' ? inCount : outCount;
    const id = generateDeterministicPortIdIndexed(nodeId, template.direction, counter.current);
    counter.current++;
    return {
      id,
      name: template.name,
      direction: template.direction,
      required: template.required,
      schemaRef: template.schemaRef,
    };
  });
}

export function isGraphV1(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === undefined || obj.schemaVersion === 1;
}

export function isGraphV2(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 2;
}

export function isGraphV3(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 3;
}

export function isGraphV4(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 4;
}

export function isGraphV5(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 5;
}

export function isGraphV6(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 6;
}

export function isGraphV7(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 7;
}

export function isGraphV8(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === 8;
}

export function isLatestVersion(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return false;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion === CURRENT_GRAPH_SCHEMA_VERSION;
}

function migrateV1ToV2(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 2;
  changes.push('Set schemaVersion to 2');

  const nodes = graph.nodes as Record<string, Record<string, unknown>> | undefined;
  const edges = graph.edges as Record<string, Record<string, unknown>> | undefined;
  const contracts = graph.contracts as Record<string, Record<string, unknown>> | undefined;

  const nodeDefaultPorts: Record<string, { inPort: string; outPort: string }> = {};

  if (nodes) {
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!node.ports || (Array.isArray(node.ports) && node.ports.length === 0)) {
        const nodeType = (node.type as string) || '';
        const generatedPorts = createTypeAwarePorts(nodeId, nodeType);
        node.ports = generatedPorts;
        const firstIn = generatedPorts.find(p => p.direction === 'in');
        const firstOut = generatedPorts.find(p => p.direction === 'out');
        nodeDefaultPorts[nodeId] = {
          inPort: firstIn?.id ?? generateDeterministicPortId(nodeId, 'in'),
          outPort: firstOut?.id ?? generateDeterministicPortId(nodeId, 'out'),
        };
        changes.push(`Added type-aware ports to node ${nodeId} (type: ${nodeType || 'unknown'})`);
      } else {
        const ports = node.ports as Port[];
        const inPort = ports.find(p => p.direction === 'in');
        const outPort = ports.find(p => p.direction === 'out');
        nodeDefaultPorts[nodeId] = {
          inPort: inPort?.id ?? generateDeterministicPortId(nodeId, 'in'),
          outPort: outPort?.id ?? generateDeterministicPortId(nodeId, 'out'),
        };
      }
    }
  }

  if (edges) {
    for (const [edgeId, edge] of Object.entries(edges)) {
      const sourceNodeId = edge.source as string;
      const targetNodeId = edge.target as string;

      if (!edge.sourcePortId && nodeDefaultPorts[sourceNodeId]) {
        edge.sourcePortId = nodeDefaultPorts[sourceNodeId].outPort;
        changes.push(`Added sourcePortId to edge ${edgeId}`);
      }

      if (!edge.targetPortId && nodeDefaultPorts[targetNodeId]) {
        edge.targetPortId = nodeDefaultPorts[targetNodeId].inPort;
        changes.push(`Added targetPortId to edge ${edgeId}`);
      }
    }
  }

  if (contracts) {
    for (const [contractId, contract] of Object.entries(contracts)) {
      if (!contract.name) {
        contract.name = `Contract ${contractId.slice(0, 8)}`;
        changes.push(`Added default name to contract ${contractId}`);
      }
      if (!contract.kind) {
        contract.kind = 'custom';
        changes.push(`Added default kind to contract ${contractId}`);
      }
    }
  }

  return { graph, changes };
}

function migrateV2ToV3(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 3;
  changes.push('Set schemaVersion to 3');

  // M4: the dotted→role-id node-type conversion is gone with legacy-type-migration.ts.
  // N9b already converted every stored graph (20260729050000) and the app has emitted role
  // ids since N9a, so there is nothing left for this step to migrate.

  return { graph, changes };
}

function migrateV3ToV4(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 4;
  changes.push('Set schemaVersion to 4');

  const nodes = graph.nodes as Record<string, Record<string, unknown>> | undefined;

  if (nodes) {
    let backfillCount = 0;
    for (const node of Object.values(nodes)) {
      if (node.parentId && !node.placementKind) {
        node.placementKind = 'contains';
        backfillCount++;
      }
    }
    if (backfillCount > 0) {
      changes.push(`Set default placementKind "contains" on ${backfillCount} node(s) with parentId`);
    }
  }

  return { graph, changes };
}

export { inferContractFieldsFromKind } from './shared/legacy-mappings.js';

function migrateV4ToV5(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 5;
  changes.push('Set schemaVersion to 5');

  const contracts = graph.contracts as Record<string, Record<string, unknown>> | undefined;

  if (contracts) {
    let enrichedCount = 0;
    for (const contract of Object.values(contracts)) {
      if (contract.kind && !contract.interactionKind) {
        const fields = KIND_TO_INTERACTION_FIELDS[contract.kind as ContractKind];
        if (fields) {
          contract.interactionKind = fields.interactionKind;
          contract.transport = fields.transport;
          contract.specFormat = fields.specFormat;
        } else {
          contract.interactionKind = 'data_read';
          contract.transport = 'http';
          contract.specFormat = 'none';
        }
        if (contract.kind === 'data_flow') {
          if (!contract.metadata) contract.metadata = {};
          (contract.metadata as Record<string, unknown>).needsRefinement = true;
        }
        enrichedCount++;
      }
    }
    if (enrichedCount > 0) {
      changes.push(`Enriched ${enrichedCount} contract(s) with interactionKind, transport, and specFormat`);
    }
  }

  return { graph, changes };
}

function migrateV5ToV6(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 6;
  changes.push('Set schemaVersion to 6');

  if (!graph.origin) {
    graph.origin = 'spec_authored';
    changes.push('Set default origin to "spec_authored"');
  }

  const contracts = graph.contracts as Record<string, Record<string, unknown>> | undefined;
  if (contracts) {
    let compressedCount = 0;
    for (const contract of Object.values(contracts)) {
      const ik = contract.interactionKind as string | undefined;
      if (ik && ik in LEGACY_INTERACTION_KIND_MAP) {
        const compressed = compressInteractionKind(ik);
        if (compressed !== ik) {
          contract.interactionKind = compressed;
          compressedCount++;
        }
      }
    }
    if (compressedCount > 0) {
      changes.push(`Compressed ${compressedCount} interactionKind value(s) to v6 vocabulary`);
    }
  }

  return { graph, changes };
}

function migrateV6ToV7(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 7;
  changes.push('Set schemaVersion to 7');

  const contracts = graph.contracts as Record<string, Record<string, unknown>> | undefined;
  if (contracts) {
    let compressedCount = 0;
    for (const contract of Object.values(contracts)) {
      const oldKind = contract.kind as string | undefined;
      if (!oldKind) continue;

      const mapping = LEGACY_CONTRACT_KIND_MAP[oldKind as LegacyContractKind];
      if (mapping && mapping.kind !== oldKind) {
        contract.kind = mapping.kind;
        if (!contract.interactionKind) {
          contract.interactionKind = mapping.interactionKind;
        }
        if (mapping.specFormat && !contract.specFormat) {
          contract.specFormat = mapping.specFormat;
        }
        compressedCount++;
      } else if (!mapping) {
        contract.kind = 'custom';
        compressedCount++;
      }
    }
    if (compressedCount > 0) {
      changes.push(`Compressed ${compressedCount} contract kind(s) to v7 vocabulary`);
    }
  }

  return { graph, changes };
}

const NODE_DEAD_FIELDS = ['exposure', 'authorship', 'hostingModel', 'rationale'];
const EDGE_DEAD_FIELDS = ['cardinality', 'rationale'];
const ARTIFACT_DEAD_FIELDS = ['role', 'generationStatus'];

function migrateV7ToV8(graphLike: Record<string, unknown>): { graph: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const graph = JSON.parse(JSON.stringify(graphLike)) as Record<string, unknown>;

  graph.schemaVersion = 8;
  changes.push('Set schemaVersion to 8');

  const nodes = graph.nodes as Record<string, Record<string, unknown>> | undefined;
  if (nodes) {
    let stripped = 0;
    for (const node of Object.values(nodes)) {
      for (const field of NODE_DEAD_FIELDS) {
        if (field in node) {
          delete node[field];
          stripped++;
        }
      }
    }
    if (stripped > 0) {
      changes.push(`Stripped ${stripped} dead field(s) from nodes`);
    }
  }

  const edges = graph.edges as Record<string, Record<string, unknown>> | undefined;
  if (edges) {
    let stripped = 0;
    for (const edge of Object.values(edges)) {
      for (const field of EDGE_DEAD_FIELDS) {
        if (field in edge) {
          delete edge[field];
          stripped++;
        }
      }
    }
    if (stripped > 0) {
      changes.push(`Stripped ${stripped} dead field(s) from edges`);
    }
  }

  const artifacts = graph.artifacts as Record<string, Record<string, unknown>> | undefined;
  if (artifacts) {
    let stripped = 0;
    for (const artifact of Object.values(artifacts)) {
      for (const field of ARTIFACT_DEAD_FIELDS) {
        if (field in artifact) {
          delete artifact[field];
          stripped++;
        }
      }
    }
    if (stripped > 0) {
      changes.push(`Stripped ${stripped} dead field(s) from artifacts`);
    }
  }

  return { graph, changes };
}

export function migrateGraphToLatest(graphLike: unknown): Graph {
  if (typeof graphLike !== 'object' || graphLike === null) {
    throw new MigrationError('Invalid graph: expected an object');
  }

  let current = graphLike as Record<string, unknown>;
  const allChanges: string[] = [];
  const startVersion = (current.schemaVersion as number | undefined) ?? 1;

  if (startVersion < 2) {
    const result = migrateV1ToV2(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  if ((current.schemaVersion as number) < 3) {
    const result = migrateV2ToV3(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  if ((current.schemaVersion as number) < 4) {
    const result = migrateV3ToV4(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  if ((current.schemaVersion as number) < 5) {
    const result = migrateV4ToV5(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  if ((current.schemaVersion as number) < 6) {
    const result = migrateV5ToV6(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  if ((current.schemaVersion as number) < 7) {
    const result = migrateV6ToV7(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  if ((current.schemaVersion as number) < 8) {
    const result = migrateV7ToV8(current);
    current = result.graph;
    allChanges.push(...result.changes);
  }

  const hash = computeHash({
    ...current,
    hash: undefined,
  });
  current.hash = hash;

  const parseResult = GraphSchema.safeParse(current);
  if (!parseResult.success) {
    throw new MigrationError(
      `Migration completed but graph still invalid: ${parseResult.error.message}`,
      parseResult.error.flatten()
    );
  }

  return updateGraphHash(parseResult.data);
}

export function migrateGraphWithDetails(graphLike: unknown): MigrationResult {
  if (typeof graphLike !== 'object' || graphLike === null) {
    throw new MigrationError('Invalid graph: expected an object');
  }

  const startVersion = ((graphLike as Record<string, unknown>).schemaVersion as number | undefined) ?? 1;
  const graph = migrateGraphToLatest(graphLike);

  return {
    graph,
    migratedFrom: startVersion,
    migratedTo: CURRENT_GRAPH_SCHEMA_VERSION,
    changes: startVersion < CURRENT_GRAPH_SCHEMA_VERSION
      ? [`Migrated from v${startVersion} to v${CURRENT_GRAPH_SCHEMA_VERSION}`]
      : [],
  };
}

export function needsMigration(graphLike: unknown): boolean {
  if (typeof graphLike !== 'object' || graphLike === null) {
    return true;
  }
  const obj = graphLike as Record<string, unknown>;
  return obj.schemaVersion !== CURRENT_GRAPH_SCHEMA_VERSION;
}
