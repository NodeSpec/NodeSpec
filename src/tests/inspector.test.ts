import { describe, it, expect } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { generateUUID } from '@nodespec/core/utils.js';
import {
  createAddNodePatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';
import type { Node, UpdateNodePatch } from '@nodespec/core/types.js';

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: 'Original Label',
    metadata: { key1: 'value1' },
  };
}

describe('Inspector Editing', () => {
  describe('emits correct patches', () => {
    it('should emit update_node patch when changing label', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([
        createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
      ]);

      const updatePatch = createUpdateNodePatch(
        nodeId,
        { label: 'New Label' },
        { actorType: 'human', summary: 'Update node label to "New Label"' }
      );

      store.proposePatches([updatePatch]);

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(2);
      expect(state.derivedGraph.nodes[nodeId].label).toBe('New Label');
    });

    it('should emit update_node patch when changing type', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([
        createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
      ]);

      const updatePatch = createUpdateNodePatch(
        nodeId,
        { type: 'database' },
        { actorType: 'human', summary: 'Update node type to "database"' }
      );

      store.proposePatches([updatePatch]);

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(2);
      expect(state.derivedGraph.nodes[nodeId].type).toBe('database');
    });

    it('should emit update_node patch when adding metadata', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([
        createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
      ]);

      const newMetadata = {
        key1: 'value1',
        newKey: 'newValue',
      };

      const updatePatch = createUpdateNodePatch(
        nodeId,
        { metadata: newMetadata },
        { actorType: 'human', summary: 'Add metadata "newKey"' }
      );

      store.proposePatches([updatePatch]);

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(2);
      expect(state.derivedGraph.nodes[nodeId].metadata).toEqual(newMetadata);
    });

    it('should emit update_node patch when updating metadata (merge semantics)', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([
        createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
      ]);

      const newMetadata = { key2: 'value2' };

      const updatePatch = createUpdateNodePatch(
        nodeId,
        { metadata: newMetadata },
        { actorType: 'human', summary: 'Add metadata key2' }
      );

      store.proposePatches([updatePatch]);

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(2);
      expect(state.derivedGraph.nodes[nodeId].metadata).toEqual({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('invalid patches are rejected safely', () => {
    it('should reject update to non-existent node', () => {
      const store = createBranchStore();
      const nonExistentNodeId = generateUUID();

      const updatePatch = createUpdateNodePatch(
        nonExistentNodeId,
        { label: 'New Label' },
        { actorType: 'human', summary: 'Update label' }
      );

      const result = store.proposePatches([updatePatch]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(0);
      expect(state.patchLog).toHaveLength(1);
      expect(state.patchLog[0].status).toBe('rejected');
    });

    it('should preserve state when patch is rejected', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([
        createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
      ]);

      const graphBeforeInvalidEdit = store.getState().derivedGraph;
      const patchesBeforeInvalidEdit = store.getState().activeBranch.patches;

      const invalidPatch = createUpdateNodePatch(
        generateUUID(),
        { label: 'Invalid' },
        { actorType: 'human', summary: 'Invalid edit' }
      );

      store.proposePatches([invalidPatch]);

      const state = store.getState();
      expect(state.derivedGraph).toEqual(graphBeforeInvalidEdit);
      expect(state.activeBranch.patches).toEqual(patchesBeforeInvalidEdit);
      expect(state.lastError).not.toBeNull();
    });

    it('should allow valid edit after invalid edit', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([
        createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
      ]);

      const invalidPatch = createUpdateNodePatch(
        generateUUID(),
        { label: 'Invalid' },
        { actorType: 'human', summary: 'Invalid edit' }
      );

      store.proposePatches([invalidPatch]);

      const validPatch = createUpdateNodePatch(
        nodeId,
        { label: 'Valid Label' },
        { actorType: 'human', summary: 'Valid edit' }
      );

      const result = store.proposePatches([validPatch]);

      expect(result.success).toBe(true);
      const state = store.getState();
      expect(state.derivedGraph.nodes[nodeId].label).toBe('Valid Label');
    });
  });

  describe('patch properties', () => {
    it('should create patch with correct type', () => {
      const nodeId = generateUUID();
      const patch = createUpdateNodePatch(
        nodeId,
        { label: 'Test' },
        { actorType: 'human', summary: 'Test' }
      );

      expect(patch.type).toBe('update_node');
    });

    it('should create patch with human actor type', () => {
      const nodeId = generateUUID();
      const patch = createUpdateNodePatch(
        nodeId,
        { label: 'Test' },
        { actorType: 'human', summary: 'Test' }
      );

      expect(patch.metadata.actorType).toBe('human');
    });

    it('should create patch with descriptive summary', () => {
      const nodeId = generateUUID();
      const patch = createUpdateNodePatch(
        nodeId,
        { label: 'My Label' },
        { actorType: 'human', summary: 'Update node label to "My Label"' }
      );

      expect(patch.metadata.summary).toContain('Update node label');
    });

    it('should include only changed fields in patch payload', () => {
      const nodeId = generateUUID();
      const patch = createUpdateNodePatch(
        nodeId,
        { label: 'New Label' },
        { actorType: 'human', summary: 'Update label' }
      ) as UpdateNodePatch;

      expect(patch.payload.changes).toHaveProperty('label');
      expect(patch.payload.changes).not.toHaveProperty('type');
      expect(patch.payload.changes).not.toHaveProperty('position');
    });
  });
});
