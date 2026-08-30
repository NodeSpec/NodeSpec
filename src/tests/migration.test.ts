// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import {
  migrateGraphToLatest,
  isGraphV1,
  isGraphV2,
  needsMigration,
  MigrationError,
  createTypeAwarePorts,
} from '@nodespec/core/migration.js';
import { validateGraph } from '@nodespec/core/patch-engine.js';
import { CURRENT_GRAPH_SCHEMA_VERSION } from '@nodespec/core/schemas.js';

const NODE_1_ID = '11111111-1111-4111-8111-111111111111';
const NODE_2_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GRAPH_ID = '99999999-9999-4999-8999-999999999999';

function createV1Graph() {
  return {
    id: GRAPH_ID,
    version: 0,
    hash: '00000000',
    nodes: {
      [NODE_1_ID]: {
        id: NODE_1_ID,
        type: 'service',
        label: 'Service A',
        metadata: {},
      },
      [NODE_2_ID]: {
        id: NODE_2_ID,
        type: 'database',
        label: 'Database B',
        metadata: {},
      },
    },
    edges: {
      [EDGE_ID]: {
        id: EDGE_ID,
        source: NODE_1_ID,
        target: NODE_2_ID,
        contractId: CONTRACT_ID,
        label: 'Data Flow',
        metadata: {},
      },
    },
    contracts: {
      [CONTRACT_ID]: {
        id: CONTRACT_ID,
        kind: 'data_flow',
        name: 'Service to DB',
        schema: {},
        metadata: {},
      },
    },
    artifacts: {},
    metadata: {},
  };
}

describe('Migration Engine', () => {
  describe('isGraphV1', () => {
    it('should return true for graph without schemaVersion', () => {
      const graph = createV1Graph();
      expect(isGraphV1(graph)).toBe(true);
    });

    it('should return true for graph with schemaVersion 1', () => {
      const graph = { ...createV1Graph(), schemaVersion: 1 };
      expect(isGraphV1(graph)).toBe(true);
    });

    it('should return false for graph with schemaVersion 2', () => {
      const graph = { ...createV1Graph(), schemaVersion: 2 };
      expect(isGraphV1(graph)).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(isGraphV1(null)).toBe(false);
      expect(isGraphV1(undefined)).toBe(false);
      expect(isGraphV1('string')).toBe(false);
      expect(isGraphV1(123)).toBe(false);
    });
  });

  describe('isGraphV2', () => {
    it('should return false for graph without schemaVersion', () => {
      const graph = createV1Graph();
      expect(isGraphV2(graph)).toBe(false);
    });

    it('should return true for graph with schemaVersion 2', () => {
      const graph = { ...createV1Graph(), schemaVersion: 2 };
      expect(isGraphV2(graph)).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isGraphV2(null)).toBe(false);
    });
  });

  describe('needsMigration', () => {
    it('should return true for v1 graphs', () => {
      const graph = createV1Graph();
      expect(needsMigration(graph)).toBe(true);
    });

    it('should return false for current version graphs', () => {
      const graph = { ...createV1Graph(), schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION };
      expect(needsMigration(graph)).toBe(false);
    });
  });

  describe('migrateGraphToLatest', () => {
    it('should migrate v1 graph without schemaVersion', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      expect(migrated.schemaVersion).toBe(CURRENT_GRAPH_SCHEMA_VERSION);
    });

    it('should add default ports to nodes without ports', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      const node1 = migrated.nodes[NODE_1_ID];
      const node2 = migrated.nodes[NODE_2_ID];

      expect(node1.ports).toBeDefined();
      expect(node1.ports!.length).toBeGreaterThanOrEqual(2);
      expect(node1.ports!.some(p => p.direction === 'in')).toBe(true);
      expect(node1.ports!.some(p => p.direction === 'out')).toBe(true);

      expect(node2.ports).toBeDefined();
      expect(node2.ports!.length).toBeGreaterThanOrEqual(2);
    });

    it('should add port IDs to edges missing them', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      const edge = migrated.edges[EDGE_ID];
      expect(edge.sourcePortId).toBeDefined();
      expect(edge.targetPortId).toBeDefined();
    });

    it('should produce deterministic output', () => {
      const v1Graph = createV1Graph();

      const migrated1 = migrateGraphToLatest(v1Graph);
      const migrated2 = migrateGraphToLatest(v1Graph);

      expect(migrated1.nodes[NODE_1_ID].ports![0].id).toBe(
        migrated2.nodes[NODE_1_ID].ports![0].id
      );
      expect(migrated1.edges[EDGE_ID].sourcePortId).toBe(
        migrated2.edges[EDGE_ID].sourcePortId
      );
      expect(migrated1.edges[EDGE_ID].targetPortId).toBe(
        migrated2.edges[EDGE_ID].targetPortId
      );
    });

    it('should produce a valid graph after migration', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      const validation = validateGraph(migrated);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should preserve existing data', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      expect(migrated.id).toBe(GRAPH_ID);
      expect(migrated.nodes[NODE_1_ID].label).toBe('Service A');
      expect(migrated.nodes[NODE_2_ID].label).toBe('Database B');
      expect(migrated.edges[EDGE_ID].label).toBe('Data Flow');
      expect(migrated.contracts[CONTRACT_ID].name).toBe('Service to DB');
    });

    it('should not modify nodes that already have ports', () => {
      const graphWithPorts = {
        ...createV1Graph(),
        nodes: {
          [NODE_1_ID]: {
            id: NODE_1_ID,
            type: 'service',
            label: 'Service A',
            ports: [
              { id: 'aaaaaaaa-0001-4001-8001-aaaaaaaaaaaa', name: 'custom-in', direction: 'in' as const },
              { id: 'aaaaaaaa-0002-4002-8002-aaaaaaaaaaaa', name: 'custom-out', direction: 'out' as const },
            ],
            metadata: {},
          },
          [NODE_2_ID]: {
            id: NODE_2_ID,
            type: 'database',
            label: 'Database B',
            metadata: {},
          },
        },
      };

      const migrated = migrateGraphToLatest(graphWithPorts);
      const node1 = migrated.nodes[NODE_1_ID];

      expect(node1.ports![0].name).toBe('custom-in');
      expect(node1.ports![1].name).toBe('custom-out');
    });

    it('should throw MigrationError for invalid input', () => {
      expect(() => migrateGraphToLatest(null)).toThrow(MigrationError);
      expect(() => migrateGraphToLatest(undefined)).toThrow(MigrationError);
      expect(() => migrateGraphToLatest('string')).toThrow(MigrationError);
    });

    it('should add default contract fields if missing', () => {
      const graphWithMinimalContract = {
        ...createV1Graph(),
        contracts: {
          [CONTRACT_ID]: {
            id: CONTRACT_ID,
          },
        },
      };

      const migrated = migrateGraphToLatest(graphWithMinimalContract);
      const contract = migrated.contracts[CONTRACT_ID];

      expect(contract.kind).toBeDefined();
      expect(contract.name).toBeDefined();
    });
  });

  describe('edge port assignment', () => {
    it('should assign source port with out direction', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      const edge = migrated.edges[EDGE_ID];
      const sourceNode = migrated.nodes[edge.source];
      const sourcePort = sourceNode.ports!.find(p => p.id === edge.sourcePortId);

      expect(sourcePort).toBeDefined();
      expect(sourcePort!.direction).toBe('out');
    });

    it('should assign target port with in direction', () => {
      const v1Graph = createV1Graph();
      const migrated = migrateGraphToLatest(v1Graph);

      const edge = migrated.edges[EDGE_ID];
      const targetNode = migrated.nodes[edge.target];
      const targetPort = targetNode.ports!.find(p => p.id === edge.targetPortId);

      expect(targetPort).toBeDefined();
      expect(targetPort!.direction).toBe('in');
    });
  });

  describe('type-aware port creation', () => {
    it('should use template ports for known node types', () => {
      const REST_NODE_ID = '33333333-3333-4333-8333-333333333333';
      const DB_NODE_ID = '44444444-4444-4444-8444-444444444444';
      const v1Graph = {
        id: GRAPH_ID,
        version: 0,
        hash: '00000000',
        nodes: {
          [REST_NODE_ID]: {
            id: REST_NODE_ID,
            type: 'web.rest-api',
            label: 'My REST API',
            metadata: {},
          },
          [DB_NODE_ID]: {
            id: DB_NODE_ID,
            type: 'database.postgresql',
            label: 'My Database',
            metadata: {},
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        metadata: {},
      };

      const migrated = migrateGraphToLatest(v1Graph);
      const restNode = migrated.nodes[REST_NODE_ID];

      expect(restNode.ports).toBeDefined();
      expect(restNode.ports!.length).toBe(2);
      expect(restNode.ports!.find(p => p.name === 'HTTP In')).toBeDefined();
      expect(restNode.ports!.find(p => p.name === 'HTTP Out')).toBeDefined();
      expect(restNode.ports!.find(p => p.name === 'HTTP In')!.direction).toBe('in');
      expect(restNode.ports!.find(p => p.name === 'HTTP In')!.required).toBe(true);
      expect(restNode.ports!.find(p => p.name === 'HTTP Out')!.direction).toBe('out');
    });

    it('should fall back to generic ports for unknown node types', () => {
      const UNKNOWN_NODE_ID = '55555555-5555-4555-8555-555555555555';
      const v1Graph = {
        id: GRAPH_ID,
        version: 0,
        hash: '00000000',
        nodes: {
          [UNKNOWN_NODE_ID]: {
            id: UNKNOWN_NODE_ID,
            type: 'totally.unknown-type',
            label: 'Unknown Thing',
            metadata: {},
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        metadata: {},
      };

      const migrated = migrateGraphToLatest(v1Graph);
      const node = migrated.nodes[UNKNOWN_NODE_ID];

      expect(node.ports).toBeDefined();
      expect(node.ports!.length).toBe(2);
      expect(node.ports!.find(p => p.name === 'default-in')).toBeDefined();
      expect(node.ports!.find(p => p.name === 'default-out')).toBeDefined();
    });

    it('should produce deterministic IDs for type-aware ports', () => {
      const nodeId = '66666666-6666-4666-8666-666666666666';
      const ports1 = createTypeAwarePorts(nodeId, 'web.rest-api');
      const ports2 = createTypeAwarePorts(nodeId, 'web.rest-api');

      expect(ports1.length).toBe(ports2.length);
      for (let i = 0; i < ports1.length; i++) {
        expect(ports1[i].id).toBe(ports2[i].id);
        expect(ports1[i].name).toBe(ports2[i].name);
      }
    });

    it('should correctly assign edge ports for typed nodes', () => {
      const REST_NODE_ID = '77777777-7777-4777-8777-777777777777';
      const DB_NODE_ID = '88888888-8888-4888-8888-888888888888';
      const CONN_CONTRACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const CONN_EDGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      const v1Graph = {
        id: GRAPH_ID,
        version: 0,
        hash: '00000000',
        nodes: {
          [REST_NODE_ID]: {
            id: REST_NODE_ID,
            type: 'web.rest-api',
            label: 'API',
            metadata: {},
          },
          [DB_NODE_ID]: {
            id: DB_NODE_ID,
            type: 'database.postgresql',
            label: 'DB',
            metadata: {},
          },
        },
        edges: {
          [CONN_EDGE_ID]: {
            id: CONN_EDGE_ID,
            source: REST_NODE_ID,
            target: DB_NODE_ID,
            contractId: CONN_CONTRACT_ID,
            metadata: {},
          },
        },
        contracts: {
          [CONN_CONTRACT_ID]: {
            id: CONN_CONTRACT_ID,
            kind: 'data_flow',
            name: 'API to DB',
            schema: {},
            metadata: {},
          },
        },
        artifacts: {},
        metadata: {},
      };

      const migrated = migrateGraphToLatest(v1Graph);
      const edge = migrated.edges[CONN_EDGE_ID];
      const sourceNode = migrated.nodes[REST_NODE_ID];
      const targetNode = migrated.nodes[DB_NODE_ID];

      const sourcePort = sourceNode.ports!.find(p => p.id === edge.sourcePortId);
      expect(sourcePort).toBeDefined();
      expect(sourcePort!.direction).toBe('out');

      const targetPort = targetNode.ports!.find(p => p.id === edge.targetPortId);
      expect(targetPort).toBeDefined();
      expect(targetPort!.direction).toBe('in');
    });

    it('should still produce a valid graph with typed nodes', () => {
      const REST_NODE_ID = '77777777-7777-4777-8777-777777777777';
      const v1Graph = {
        id: GRAPH_ID,
        version: 0,
        hash: '00000000',
        nodes: {
          [REST_NODE_ID]: {
            id: REST_NODE_ID,
            type: 'web.rest-api',
            label: 'API',
            metadata: {},
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        metadata: {},
      };

      const migrated = migrateGraphToLatest(v1Graph);
      const validation = validateGraph(migrated);
      expect(validation.valid).toBe(true);
    });
  });
});
