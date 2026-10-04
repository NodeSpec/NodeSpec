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

    // AG.13 (owner 2026-09-28): ports came out of the model; migrating an old
    // graph invents none, for nodes or for edges.
    it('adds no ports to nodes and no port ids to edges', () => {
      const migrated = migrateGraphToLatest(createV1Graph());

      expect(migrated.nodes[NODE_1_ID].ports).toBeUndefined();
      expect(migrated.nodes[NODE_2_ID].ports).toBeUndefined();
      expect(migrated.edges[EDGE_ID].sourcePortId).toBeUndefined();
      expect(migrated.edges[EDGE_ID].targetPortId).toBeUndefined();
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
});
