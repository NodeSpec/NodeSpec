import { describe, it, expect } from 'vitest';
import { applyPatch, validatePatch } from '@nodespec/core/patch-engine.js';
import type { Graph, AddNodeGroupPatch, UpdateNodeGroupPatch, RemoveNodeGroupPatch } from '@nodespec/core/types.js';
import { now } from '@nodespec/core/utils.js';

describe('NodeGroup Patch Operations', () => {
  const createMockGraph = (): Graph => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    schemaVersion: 2,
    version: 1,
    hash: 'abc123',
    nodes: {
      '223e4567-e89b-12d3-a456-426614174001': {
        id: '223e4567-e89b-12d3-a456-426614174001',
        type: 'service',
        label: 'Auth Service',
      },
      '323e4567-e89b-12d3-a456-426614174002': {
        id: '323e4567-e89b-12d3-a456-426614174002',
        type: 'service',
        label: 'User Service',
      },
    },
    edges: {},
    contracts: {},
    artifacts: {},
    nodeGroups: {},
  });

  describe('add_node_group', () => {
    it('should add a new node group', () => {
      const graph = createMockGraph();
      const patch: AddNodeGroupPatch = {
        type: 'add_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Add authentication cluster',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Authentication Cluster',
          nodeIds: ['223e4567-e89b-12d3-a456-426614174001'],
          style: {
            backgroundColor: '#e3f2fd',
            borderColor: '#1976d2',
          },
        },
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph?.nodeGroups).toBeDefined();
      expect(result.graph?.nodeGroups!['523e4567-e89b-12d3-a456-426614174004']).toEqual({
        id: '523e4567-e89b-12d3-a456-426614174004',
        label: 'Authentication Cluster',
        nodeIds: ['223e4567-e89b-12d3-a456-426614174001'],
        style: {
          backgroundColor: '#e3f2fd',
          borderColor: '#1976d2',
        },
      });
      expect(result.graph?.version).toBe(2);
    });

    it('should reject adding duplicate node group', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Existing Group',
          nodeIds: [],
        },
      };

      const patch: AddNodeGroupPatch = {
        type: 'add_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Add duplicate group',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Duplicate Group',
          nodeIds: [],
        },
      };

      const validation = validatePatch(graph, patch);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0].code).toBe('NODE_GROUP_EXISTS');
    });

    it('should reject adding node group with non-existent nodes', () => {
      const graph = createMockGraph();
      const patch: AddNodeGroupPatch = {
        type: 'add_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Add group with invalid nodes',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Invalid Group',
          nodeIds: ['999e4567-e89b-12d3-a456-426614174999'],
        },
      };

      const validation = validatePatch(graph, patch);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0].code).toBe('NODE_NOT_FOUND');
    });

    it('should add node group to graph without nodeGroups field', () => {
      const graph = createMockGraph();
      delete graph.nodeGroups;

      const patch: AddNodeGroupPatch = {
        type: 'add_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Add first group',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'First Group',
          nodeIds: [],
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph?.nodeGroups).toBeDefined();
    });
  });

  describe('update_node_group', () => {
    it('should update node group label', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Old Label',
          nodeIds: [],
        },
      };

      const patch: UpdateNodeGroupPatch = {
        type: 'update_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Update group label',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          changes: {
            label: 'New Label',
          },
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph?.nodeGroups!['523e4567-e89b-12d3-a456-426614174004'].label).toBe('New Label');
    });

    it('should update node group nodeIds', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Test Group',
          nodeIds: ['223e4567-e89b-12d3-a456-426614174001'],
        },
      };

      const patch: UpdateNodeGroupPatch = {
        type: 'update_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Update group nodes',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          changes: {
            nodeIds: ['223e4567-e89b-12d3-a456-426614174001', '323e4567-e89b-12d3-a456-426614174002'],
          },
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph?.nodeGroups!['523e4567-e89b-12d3-a456-426614174004'].nodeIds).toEqual([
        '223e4567-e89b-12d3-a456-426614174001',
        '323e4567-e89b-12d3-a456-426614174002',
      ]);
    });

    it('should update node group style', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Test Group',
          nodeIds: [],
        },
      };

      const patch: UpdateNodeGroupPatch = {
        type: 'update_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Update group style',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          changes: {
            style: {
              backgroundColor: '#f3e5f5',
              borderColor: '#7b1fa2',
            },
          },
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph?.nodeGroups!['523e4567-e89b-12d3-a456-426614174004'].style).toEqual({
        backgroundColor: '#f3e5f5',
        borderColor: '#7b1fa2',
      });
    });

    it('should reject updating non-existent node group', () => {
      const graph = createMockGraph();
      const patch: UpdateNodeGroupPatch = {
        type: 'update_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Update non-existent group',
          timestamp: now(),
        },
        payload: {
          id: '999e4567-e89b-12d3-a456-426614174999',
          changes: {
            label: 'New Label',
          },
        },
      };

      const validation = validatePatch(graph, patch);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0].code).toBe('NODE_GROUP_NOT_FOUND');
    });

    it('should reject updating with non-existent nodes', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Test Group',
          nodeIds: [],
        },
      };

      const patch: UpdateNodeGroupPatch = {
        type: 'update_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Update with invalid nodes',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
          changes: {
            nodeIds: ['999e4567-e89b-12d3-a456-426614174999'],
          },
        },
      };

      const validation = validatePatch(graph, patch);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0].code).toBe('NODE_NOT_FOUND');
    });
  });

  describe('remove_node_group', () => {
    it('should remove node group', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Test Group',
          nodeIds: [],
        },
      };

      const patch: RemoveNodeGroupPatch = {
        type: 'remove_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Remove group',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph?.nodeGroups!['523e4567-e89b-12d3-a456-426614174004']).toBeUndefined();
    });

    it('should reject removing non-existent node group', () => {
      const graph = createMockGraph();
      const patch: RemoveNodeGroupPatch = {
        type: 'remove_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Remove non-existent group',
          timestamp: now(),
        },
        payload: {
          id: '999e4567-e89b-12d3-a456-426614174999',
        },
      };

      const validation = validatePatch(graph, patch);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0].code).toBe('NODE_GROUP_NOT_FOUND');
    });

    it('should not affect nodes when removing node group', () => {
      const graph = createMockGraph();
      graph.nodeGroups = {
        '523e4567-e89b-12d3-a456-426614174004': {
          id: '523e4567-e89b-12d3-a456-426614174004',
          label: 'Test Group',
          nodeIds: ['223e4567-e89b-12d3-a456-426614174001'],
        },
      };

      const patch: RemoveNodeGroupPatch = {
        type: 'remove_node_group',
        metadata: {
          id: '423e4567-e89b-12d3-a456-426614174003',
          actorType: 'human',
          summary: 'Remove group',
          timestamp: now(),
        },
        payload: {
          id: '523e4567-e89b-12d3-a456-426614174004',
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph?.nodes['223e4567-e89b-12d3-a456-426614174001']).toBeDefined();
    });
  });
});
