// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import {
  buildUpdateNodePatch,
  buildAddPortPatch,
  buildConnectPortsPatch,
  buildAddNodePatch,
  buildRemoveNodePatch,
  buildRemoveEdgePatch,
  buildAddContractPatch,
  buildAddEdgePatch,
  PatchBuilderError,
} from '../ui/builders/patchBuilders.js';
import { PatchOperationSchema } from '@nodespec/core/schemas.js';
import type {
  UpdateNodePatch,
  AddPortPatch,
  ConnectPortsPatch,
  AddNodePatch,
  RemoveNodePatch,
  RemoveEdgePatch,
  AddContractPatch,
  AddEdgePatch,
} from '@nodespec/core/types.js';

const VALID_NODE_ID = '11111111-1111-4111-8111-111111111111';
const VALID_NODE_ID_2 = '22222222-2222-4222-8222-222222222222';
const VALID_PORT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID_PORT_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VALID_CONTRACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VALID_EDGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('Patch Builders', () => {
  describe('buildUpdateNodePatch', () => {
    it('should create a valid update_node patch', () => {
      const patch = buildUpdateNodePatch({
        nodeId: VALID_NODE_ID,
        updates: { label: 'Updated Label' },
        actor: 'human',
        summary: 'Update node label',
      }) as UpdateNodePatch;

      expect(patch.type).toBe('update_node');
      expect(patch.payload.id).toBe(VALID_NODE_ID);
      expect(patch.payload.changes.label).toBe('Updated Label');

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should create patch with label updates', () => {
      const patch = buildUpdateNodePatch({
        nodeId: VALID_NODE_ID,
        updates: { label: 'Updated Label' },
        actor: 'human',
        summary: 'Update label',
      }) as UpdateNodePatch;

      expect(patch.payload.changes.label).toBe('Updated Label');

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should reject invalid nodeId', () => {
      expect(() =>
        buildUpdateNodePatch({
          nodeId: 'invalid-id',
          updates: { label: 'Test' },
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });

    it('should reject empty updates', () => {
      expect(() =>
        buildUpdateNodePatch({
          nodeId: VALID_NODE_ID,
          updates: {},
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });

    it('should include preconditions when provided', () => {
      const patch = buildUpdateNodePatch({
        nodeId: VALID_NODE_ID,
        updates: { label: 'Test' },
        actor: 'human',
        summary: 'Test',
        preconditions: [
          { type: 'value_exists', path: `nodes.${VALID_NODE_ID}` },
        ],
      });

      expect(patch.metadata.preconditions).toBeDefined();
      expect(patch.metadata.preconditions).toHaveLength(1);
    });
  });

  describe('buildAddPortPatch', () => {
    it('should create a valid add_port patch', () => {
      const patch = buildAddPortPatch({
        nodeId: VALID_NODE_ID,
        port: {
          name: 'data-in',
          direction: 'in',
        },
        actor: 'human',
        summary: 'Add input port',
      }) as AddPortPatch;

      expect(patch.type).toBe('add_port');
      expect(patch.payload.nodeId).toBe(VALID_NODE_ID);
      expect(patch.payload.port.name).toBe('data-in');
      expect(patch.payload.port.direction).toBe('in');
      expect(patch.payload.port.id).toBeDefined();

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should use provided port id', () => {
      const patch = buildAddPortPatch({
        nodeId: VALID_NODE_ID,
        port: {
          id: VALID_PORT_ID,
          name: 'custom-port',
          direction: 'out',
        },
        actor: 'human',
        summary: 'Add port',
      }) as AddPortPatch;

      expect(patch.payload.port.id).toBe(VALID_PORT_ID);
    });

    it('should reject invalid direction', () => {
      expect(() =>
        buildAddPortPatch({
          nodeId: VALID_NODE_ID,
          port: {
            name: 'test',
            direction: 'invalid' as 'in',
          },
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });

    it('should reject empty port name', () => {
      expect(() =>
        buildAddPortPatch({
          nodeId: VALID_NODE_ID,
          port: {
            name: '',
            direction: 'in',
          },
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });
  });

  describe('buildConnectPortsPatch', () => {
    it('should create a valid connect_ports patch with new contract', () => {
      const patch = buildConnectPortsPatch({
        sourceNodeId: VALID_NODE_ID,
        sourcePortId: VALID_PORT_ID,
        targetNodeId: VALID_NODE_ID_2,
        targetPortId: VALID_PORT_ID_2,
        contract: {
          kind: 'sql',
          name: 'Test Connection',
        },
        label: 'Connection Label',
        actor: 'human',
        summary: 'Connect nodes',
      }) as ConnectPortsPatch;

      expect(patch.type).toBe('connect_ports');
      expect(patch.payload.sourceNodeId).toBe(VALID_NODE_ID);
      expect(patch.payload.sourcePortId).toBe(VALID_PORT_ID);
      expect(patch.payload.targetNodeId).toBe(VALID_NODE_ID_2);
      expect(patch.payload.targetPortId).toBe(VALID_PORT_ID_2);
      expect(patch.payload.contract).toBeDefined();
      expect(patch.payload.contract?.name).toBe('Test Connection');

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should create patch with existing contract reference', () => {
      const patch = buildConnectPortsPatch({
        sourceNodeId: VALID_NODE_ID,
        sourcePortId: VALID_PORT_ID,
        targetNodeId: VALID_NODE_ID_2,
        targetPortId: VALID_PORT_ID_2,
        existingContractId: VALID_CONTRACT_ID,
        actor: 'human',
        summary: 'Connect using existing contract',
      }) as ConnectPortsPatch;

      expect(patch.payload.contractId).toBe(VALID_CONTRACT_ID);
      expect(patch.payload.contract).toBeUndefined();

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should reject missing contract info', () => {
      expect(() =>
        buildConnectPortsPatch({
          sourceNodeId: VALID_NODE_ID,
          sourcePortId: VALID_PORT_ID,
          targetNodeId: VALID_NODE_ID_2,
          targetPortId: VALID_PORT_ID_2,
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });

    it('should reject invalid port IDs', () => {
      expect(() =>
        buildConnectPortsPatch({
          sourceNodeId: VALID_NODE_ID,
          sourcePortId: 'invalid',
          targetNodeId: VALID_NODE_ID_2,
          targetPortId: VALID_PORT_ID_2,
          existingContractId: VALID_CONTRACT_ID,
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });
  });

  describe('buildAddNodePatch', () => {
    it('should create a valid add_node patch', () => {
      const patch = buildAddNodePatch({
        node: {
          type: 'service',
          label: 'New Service',
        },
        actor: 'human',
        summary: 'Add new node',
      }) as AddNodePatch;

      expect(patch.type).toBe('add_node');
      expect(patch.payload.type).toBe('service');
      expect(patch.payload.label).toBe('New Service');
      expect(patch.payload.id).toBeDefined();

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should use provided node id', () => {
      const patch = buildAddNodePatch({
        node: {
          id: VALID_NODE_ID,
          type: 'api',
          label: 'API Gateway',
        },
        actor: 'human',
        summary: 'Add API',
      }) as AddNodePatch;

      expect(patch.payload.id).toBe(VALID_NODE_ID);
    });

    it('should reject empty type', () => {
      expect(() =>
        buildAddNodePatch({
          node: {
            type: '',
            label: 'Test',
          },
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });

    it('should auto-populate ports from template for known node types', () => {
      const patch = buildAddNodePatch({
        node: {
          type: 'web.rest-api',
          label: 'My API',
        },
        actor: 'human',
        summary: 'Add REST API node',
      }) as AddNodePatch;

      expect(patch.payload.ports).toBeDefined();
      expect(patch.payload.ports!.length).toBe(2);
      expect(patch.payload.ports!.find((p: any) => p.name === 'HTTP In')).toBeDefined();
      expect(patch.payload.ports!.find((p: any) => p.name === 'HTTP Out')).toBeDefined();
      expect(patch.payload.ports!.find((p: any) => p.name === 'HTTP In')!.direction).toBe('in');
      expect(patch.payload.ports!.find((p: any) => p.name === 'HTTP Out')!.direction).toBe('out');

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should preserve explicit ports when provided', () => {
      const customPort = {
        id: VALID_PORT_ID,
        name: 'Custom Input',
        direction: 'in' as const,
      };

      const patch = buildAddNodePatch({
        node: {
          type: 'web.rest-api',
          label: 'My API',
          ports: [customPort],
        },
        actor: 'human',
        summary: 'Add REST API node with custom ports',
      }) as AddNodePatch;

      expect(patch.payload.ports).toBeDefined();
      expect(patch.payload.ports!.length).toBe(1);
      expect(patch.payload.ports![0].name).toBe('Custom Input');
      expect(patch.payload.ports![0].id).toBe(VALID_PORT_ID);
    });

    it('should not add ports for unknown node types without explicit ports', () => {
      const patch = buildAddNodePatch({
        node: {
          type: 'totally.unknown-thing',
          label: 'Mystery Node',
        },
        actor: 'human',
        summary: 'Add unknown node',
      }) as AddNodePatch;

      expect(patch.payload.ports).toBeUndefined();
    });
  });

  describe('buildRemoveNodePatch', () => {
    it('should create a valid remove_node patch', () => {
      const patch = buildRemoveNodePatch({
        nodeId: VALID_NODE_ID,
        actor: 'human',
        summary: 'Remove node',
      }) as RemoveNodePatch;

      expect(patch.type).toBe('remove_node');
      expect(patch.payload.id).toBe(VALID_NODE_ID);

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should reject invalid nodeId', () => {
      expect(() =>
        buildRemoveNodePatch({
          nodeId: 'not-a-uuid',
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });
  });

  describe('buildRemoveEdgePatch', () => {
    it('should create a valid remove_edge patch', () => {
      const patch = buildRemoveEdgePatch({
        edgeId: VALID_EDGE_ID,
        actor: 'human',
        summary: 'Remove edge',
      }) as RemoveEdgePatch;

      expect(patch.type).toBe('remove_edge');
      expect(patch.payload.id).toBe(VALID_EDGE_ID);

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });
  });

  describe('buildAddContractPatch', () => {
    it('should create a valid add_contract patch', () => {
      const patch = buildAddContractPatch({
        contract: {
          kind: 'rest',
          name: 'REST API Contract',
          schema: { endpoint: '/api/users' },
        },
        actor: 'human',
        summary: 'Add contract',
      }) as AddContractPatch;

      expect(patch.type).toBe('add_contract');
      expect(patch.payload.kind).toBe('rest');
      expect(patch.payload.name).toBe('REST API Contract');

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should reject empty contract name', () => {
      expect(() =>
        buildAddContractPatch({
          contract: {
            kind: 'sql',
            name: '',
          },
          actor: 'human',
          summary: 'Test',
        })
      ).toThrow(PatchBuilderError);
    });
  });

  describe('buildAddEdgePatch', () => {
    it('should create a valid add_edge patch', () => {
      const patch = buildAddEdgePatch({
        edge: {
          source: VALID_NODE_ID,
          target: VALID_NODE_ID_2,
          contractId: VALID_CONTRACT_ID,
          label: 'Data Flow',
        },
        actor: 'human',
        summary: 'Add edge',
      }) as AddEdgePatch;

      expect(patch.type).toBe('add_edge');
      expect(patch.payload.source).toBe(VALID_NODE_ID);
      expect(patch.payload.target).toBe(VALID_NODE_ID_2);
      expect(patch.payload.contractId).toBe(VALID_CONTRACT_ID);

      const validation = PatchOperationSchema.safeParse(patch);
      expect(validation.success).toBe(true);
    });

    it('should include port IDs when provided', () => {
      const patch = buildAddEdgePatch({
        edge: {
          source: VALID_NODE_ID,
          target: VALID_NODE_ID_2,
          sourcePortId: VALID_PORT_ID,
          targetPortId: VALID_PORT_ID_2,
          contractId: VALID_CONTRACT_ID,
        },
        actor: 'human',
        summary: 'Add edge with ports',
      }) as AddEdgePatch;

      expect(patch.payload.sourcePortId).toBe(VALID_PORT_ID);
      expect(patch.payload.targetPortId).toBe(VALID_PORT_ID_2);
    });
  });

  describe('all builders produce valid patches', () => {
    const testCases = [
      {
        name: 'update_node',
        builder: () =>
          buildUpdateNodePatch({
            nodeId: VALID_NODE_ID,
            updates: { label: 'Test' },
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'add_port',
        builder: () =>
          buildAddPortPatch({
            nodeId: VALID_NODE_ID,
            port: { name: 'test', direction: 'in' },
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'connect_ports',
        builder: () =>
          buildConnectPortsPatch({
            sourceNodeId: VALID_NODE_ID,
            sourcePortId: VALID_PORT_ID,
            targetNodeId: VALID_NODE_ID_2,
            targetPortId: VALID_PORT_ID_2,
            contract: { kind: 'sql', name: 'Test' },
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'add_node',
        builder: () =>
          buildAddNodePatch({
            node: { type: 'service', label: 'Test' },
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'remove_node',
        builder: () =>
          buildRemoveNodePatch({
            nodeId: VALID_NODE_ID,
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'remove_edge',
        builder: () =>
          buildRemoveEdgePatch({
            edgeId: VALID_EDGE_ID,
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'add_contract',
        builder: () =>
          buildAddContractPatch({
            contract: { kind: 'sql', name: 'Test' },
            actor: 'human',
            summary: 'Test',
          }),
      },
      {
        name: 'add_edge',
        builder: () =>
          buildAddEdgePatch({
            edge: {
              source: VALID_NODE_ID,
              target: VALID_NODE_ID_2,
              contractId: VALID_CONTRACT_ID,
            },
            actor: 'human',
            summary: 'Test',
          }),
      },
    ];

    for (const { name, builder } of testCases) {
      it(`${name} builder produces schema-valid patch`, () => {
        const patch = builder();
        const validation = PatchOperationSchema.safeParse(patch);
        expect(validation.success).toBe(true);
      });
    }
  });
});
