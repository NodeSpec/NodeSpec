import { describe, it, expect } from 'vitest';
import {
  createBranch,
  addPatchToBranch,
  replayBranch,
  diffBranches,
  cherryPickPatch,
  mergeBranches,
  forkBranch,
  getBranchHistory,
  findCommonAncestor,
} from '@nodespec/core/branch.js';
import {
  createAddNodePatch,
  createAddContractPatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Node, Contract, PatchOperation } from '@nodespec/core/types.js';

const actorOptions = { actorType: 'human' as const, summary: 'Test patch' };

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Node ${id.slice(0, 8)}`,
    data: {},
    metadata: {},
  };
}

function createTestContract(id: string): Contract {
  return {
    id,
    kind: 'sql',
    name: `Contract ${id.slice(0, 8)}`,
    schema: {},
    metadata: {},
  };
}

describe('Branch Model', () => {
  describe('createBranch', () => {
    it('should create an empty branch', () => {
      const branch = createBranch('main');

      expect(branch.name).toBe('main');
      expect(branch.patches).toHaveLength(0);
      expect(branch.baseSnapshotId).toBeNull();
    });

    it('should create a branch with patches', () => {
      const nodeId = generateUUID();
      const patches = [createAddNodePatch(createTestNode(nodeId), actorOptions)];
      const branch = createBranch('feature', null, patches);

      expect(branch.patches).toHaveLength(1);
    });
  });

  describe('addPatchToBranch', () => {
    it('should add a patch to branch', () => {
      const branch = createBranch('main');
      const nodeId = generateUUID();
      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);

      const updated = addPatchToBranch(branch, patch);

      expect(updated.patches).toHaveLength(1);
      expect(branch.patches).toHaveLength(0);
    });

    it('should maintain chronological order', () => {
      let branch = createBranch('main');

      const patch1 = createAddNodePatch(createTestNode(generateUUID()), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(generateUUID()), actorOptions);

      branch = addPatchToBranch(branch, patch1);
      branch = addPatchToBranch(branch, patch2);

      expect(branch.patches).toHaveLength(2);
      const t1 = new Date(branch.patches[0].metadata.timestamp).getTime();
      const t2 = new Date(branch.patches[1].metadata.timestamp).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    });
  });

  describe('replayBranch', () => {
    it('should replay patches to reconstruct graph', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const contractId = generateUUID();

      const patches: PatchOperation[] = [
        createAddContractPatch(createTestContract(contractId), actorOptions),
        createAddNodePatch(createTestNode(nodeId1), actorOptions),
        createAddNodePatch(createTestNode(nodeId2), actorOptions),
      ];

      const branch = createBranch('main', null, patches);
      const result = replayBranch(graph, branch);

      expect(result.success).toBe(true);
      expect(Object.keys(result.graph?.nodes ?? {})).toHaveLength(2);
      expect(Object.keys(result.graph?.contracts ?? {})).toHaveLength(1);
    });

    it('should fail on invalid patch sequence', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const patches: PatchOperation[] = [
        createUpdateNodePatch(nodeId, { label: 'Updated' }, actorOptions),
      ];

      const branch = createBranch('main', null, patches);
      const result = replayBranch(graph, branch);

      expect(result.success).toBe(false);
    });

    it('should produce consistent results on repeated replay', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const contractId = generateUUID();

      const patches: PatchOperation[] = [
        createAddContractPatch(createTestContract(contractId), actorOptions),
        createAddNodePatch(createTestNode(nodeId), actorOptions),
      ];

      const branch = createBranch('main', null, patches);

      const result1 = replayBranch(graph, branch);
      const result2 = replayBranch(graph, branch);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.graph?.hash).toBe(result2.graph?.hash);
    });
  });

  describe('diffBranches', () => {
    it('should identify added patches', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patch1 = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId2), actorOptions);

      const branchA = createBranch('main', null, [patch1]);
      const branchB = createBranch('feature', null, [patch1, patch2]);

      const diff = diffBranches(branchA, branchB);

      expect(diff.common).toHaveLength(1);
      expect(diff.added).toHaveLength(1);
      expect(diff.removed).toHaveLength(0);
    });

    it('should identify removed patches', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patch1 = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId2), actorOptions);

      const branchA = createBranch('main', null, [patch1, patch2]);
      const branchB = createBranch('feature', null, [patch1]);

      const diff = diffBranches(branchA, branchB);

      expect(diff.common).toHaveLength(1);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(1);
    });
  });

  describe('cherryPickPatch', () => {
    it('should cherry-pick a patch from another branch', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patch1 = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId2), actorOptions);

      const source = createBranch('source', null, [patch1, patch2]);
      const target = createBranch('target');

      const result = cherryPickPatch(target, source, patch2.metadata.id);

      expect(result).not.toBeNull();
      expect(result?.patches).toHaveLength(1);
      expect(result?.patches[0].metadata.id).toBe(patch2.metadata.id);
    });

    it('should return null for non-existent patch', () => {
      const source = createBranch('source');
      const target = createBranch('target');

      const result = cherryPickPatch(target, source, 'non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('mergeBranches', () => {
    it('should merge non-overlapping patches', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patch1 = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId2), actorOptions);

      const base = createBranch('main', null, [patch1]);
      const incoming = createBranch('feature', null, [patch2]);

      const merged = mergeBranches(base, incoming);

      expect(merged.patches).toHaveLength(2);
    });

    it('should not duplicate common patches', () => {
      const nodeId = generateUUID();
      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);

      const base = createBranch('main', null, [patch]);
      const incoming = createBranch('feature', null, [patch]);

      const merged = mergeBranches(base, incoming);

      expect(merged.patches).toHaveLength(1);
    });
  });

  describe('forkBranch', () => {
    it('should create an independent copy', () => {
      const nodeId = generateUUID();
      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);
      const original = createBranch('main', null, [patch]);

      const forked = forkBranch(original, 'feature');

      expect(forked.name).toBe('feature');
      expect(forked.patches).toHaveLength(1);
      expect(forked.id).not.toBe(original.id);
    });
  });

  describe('getBranchHistory', () => {
    it('should return patch history', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId1), {
          actorType: 'human',
          summary: 'Add first node',
        }),
        createAddNodePatch(createTestNode(nodeId2), {
          actorType: 'ai',
          summary: 'Add second node',
        }),
      ];

      const branch = createBranch('main', null, patches);
      const history = getBranchHistory(branch);

      expect(history).toHaveLength(2);
      expect(history[0].actorType).toBe('human');
      expect(history[1].actorType).toBe('ai');
    });
  });

  describe('findCommonAncestor', () => {
    it('should find common ancestor patch', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const nodeId3 = generateUUID();

      const commonPatch = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId2), actorOptions);
      const patch3 = createAddNodePatch(createTestNode(nodeId3), actorOptions);

      const branchA = createBranch('main', null, [commonPatch, patch2]);
      const branchB = createBranch('feature', null, [commonPatch, patch3]);

      const ancestor = findCommonAncestor(branchA, branchB);

      expect(ancestor).not.toBeNull();
      expect(ancestor?.metadata.id).toBe(commonPatch.metadata.id);
    });

    it('should return null when no common ancestor exists', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patch1 = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId2), actorOptions);

      const branchA = createBranch('main', null, [patch1]);
      const branchB = createBranch('feature', null, [patch2]);

      const ancestor = findCommonAncestor(branchA, branchB);

      expect(ancestor).toBeNull();
    });
  });
});
