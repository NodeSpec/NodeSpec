import { describe, it, expect } from 'vitest';
import {
  createMockProjectRepository,
  createMockBranchRepository,
  createMockGraphRepository,
  createMockPatchRepository,
} from '../persistence/testing/mock-repositories.js';
import { createAddNodePatch, createAddContractPatch } from '@nodespec/core/patch-factory.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Node, Contract } from '@nodespec/core/types.js';
import type { PatchEvent } from '../persistence/types.js';

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

describe('Persistence Layer', () => {
  describe('ProjectRepository', () => {
    it('should create and retrieve projects', async () => {
      const repo = createMockProjectRepository();
      const ownerId = generateUUID();

      const createResult = await repo.create('Test Project', ownerId, { foo: 'bar' });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const project = createResult.data;
      expect(project.name).toBe('Test Project');
      expect(project.ownerId).toBe(ownerId);
      expect(project.metadata).toEqual({ foo: 'bar' });

      const getResult = await repo.getById(project.id);
      expect(getResult.success).toBe(true);
      if (!getResult.success) return;
      expect(getResult.data?.id).toBe(project.id);
    });

    it('should list projects by owner', async () => {
      const repo = createMockProjectRepository();
      const ownerId = generateUUID();
      const otherOwnerId = generateUUID();

      await repo.create('Project 1', ownerId);
      await repo.create('Project 2', ownerId);
      await repo.create('Other Project', otherOwnerId);

      const listResult = await repo.listByOwner(ownerId);
      expect(listResult.success).toBe(true);
      if (!listResult.success) return;
      expect(listResult.data).toHaveLength(2);
    });
  });

  describe('BranchRepository', () => {
    it('should create branches with unique names per project', async () => {
      const repo = createMockBranchRepository();
      const projectId = generateUUID();
      const createdBy = generateUUID();

      const result1 = await repo.create(projectId, 'main', createdBy);
      expect(result1.success).toBe(true);

      const result2 = await repo.create(projectId, 'main', createdBy);
      expect(result2.success).toBe(false);
      if (!result2.success) {
        expect(result2.error.code).toBe('DUPLICATE');
      }
    });

    it('should find branches by name', async () => {
      const repo = createMockBranchRepository();
      const projectId = generateUUID();
      const createdBy = generateUUID();

      await repo.create(projectId, 'main', createdBy);
      await repo.create(projectId, 'feature', createdBy);

      const findResult = await repo.getByName(projectId, 'feature');
      expect(findResult.success).toBe(true);
      if (!findResult.success) return;
      expect(findResult.data?.name).toBe('feature');
    });
  });

  describe('PatchRepository', () => {
    it('should append patches with sequential numbers', async () => {
      const repo = createMockPatchRepository();
      const branchId = generateUUID();

      const contractId = generateUUID();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patch1 = createAddContractPatch(createTestContract(contractId), actorOptions);
      const patch2 = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      const patch3 = createAddNodePatch(createTestNode(nodeId2), actorOptions);

      const r1 = await repo.appendPatch(branchId, patch1);
      const r2 = await repo.appendPatch(branchId, patch2);
      const r3 = await repo.appendPatch(branchId, patch3);

      expect(r1.success && r1.data.sequence).toBe(1);
      expect(r2.success && r2.data.sequence).toBe(2);
      expect(r3.success && r3.data.sequence).toBe(3);
    });

    it('should reject duplicate patches', async () => {
      const repo = createMockPatchRepository();
      const branchId = generateUUID();
      const nodeId = generateUUID();

      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);

      const r1 = await repo.appendPatch(branchId, patch);
      expect(r1.success).toBe(true);

      const r2 = await repo.appendPatch(branchId, patch);
      expect(r2.success).toBe(false);
      if (!r2.success) {
        expect(r2.error.code).toBe('DUPLICATE_PATCH');
      }
    });

    it('should load patches with filters', async () => {
      const repo = createMockPatchRepository();
      const branchId = generateUUID();

      for (let i = 0; i < 10; i++) {
        const nodeId = generateUUID();
        const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);
        await repo.appendPatch(branchId, patch);
      }

      const allPatches = await repo.loadPatches(branchId);
      expect(allPatches.success && allPatches.data.length).toBe(10);

      const sinceSeq5 = await repo.loadPatches(branchId, { sinceSequence: 5 });
      expect(sinceSeq5.success && sinceSeq5.data.length).toBe(5);

      const limited = await repo.loadPatches(branchId, { limit: 3 });
      expect(limited.success && limited.data.length).toBe(3);
    });

    it('should notify subscribers on new patches', async () => {
      const repo = createMockPatchRepository();
      const branchId = generateUUID();
      const events: PatchEvent[] = [];

      const subscription = repo.subscribeToPatchStream(branchId, (event) => {
        events.push(event);
      });

      const nodeId = generateUUID();
      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);
      await repo.appendPatch(branchId, patch);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('INSERT');
      expect(events[0].patch.id).toBe(patch.metadata.id);

      subscription.unsubscribe();
    });
  });

  describe('GraphRepository', () => {
    it('should save and load snapshots', async () => {
      const repo = createMockGraphRepository();
      const projectId = generateUUID();
      const branchId = generateUUID();
      const graph = createEmptyGraph();

      const saveResult = await repo.saveSnapshot(projectId, branchId, graph, 0);
      expect(saveResult.success).toBe(true);

      const loadResult = await repo.loadSnapshot(branchId);
      expect(loadResult.success).toBe(true);
      if (!loadResult.success) return;
      expect(loadResult.data?.graphData.id).toBe(graph.id);
    });

    it('should return latest snapshot', async () => {
      const repo = createMockGraphRepository();
      const projectId = generateUUID();
      const branchId = generateUUID();

      const graph1 = createEmptyGraph();
      const graph2 = createEmptyGraph();

      await repo.saveSnapshot(projectId, branchId, graph1, 0);
      await new Promise((r) => setTimeout(r, 10));
      await repo.saveSnapshot(projectId, branchId, graph2, 5);

      const loadResult = await repo.loadSnapshot(branchId);
      expect(loadResult.success).toBe(true);
      if (!loadResult.success) return;
      expect(loadResult.data?.graphData.id).toBe(graph2.id);
      expect(loadResult.data?.patchSequence).toBe(5);
    });
  });

  describe('Patch Replay from Persisted Data', () => {
    it('should replay patches to reconstruct graph state', async () => {
      const patchRepo = createMockPatchRepository();
      const graphRepo = createMockGraphRepository();
      const projectId = generateUUID();
      const branchId = generateUUID();

      const baseGraph = createEmptyGraph();
      await graphRepo.saveSnapshot(projectId, branchId, baseGraph, 0);

      const contractId = generateUUID();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patches = [
        createAddContractPatch(createTestContract(contractId), actorOptions),
        createAddNodePatch(createTestNode(nodeId1), actorOptions),
        createAddNodePatch(createTestNode(nodeId2), actorOptions),
      ];

      for (const patch of patches) {
        await patchRepo.appendPatch(branchId, patch);
      }

      const snapshotResult = await graphRepo.loadSnapshot(branchId);
      expect(snapshotResult.success).toBe(true);
      if (!snapshotResult.success) return;

      const snapshot = snapshotResult.data!;
      const patchesResult = await patchRepo.loadPatches(branchId, {
        sinceSequence: snapshot.patchSequence,
      });
      expect(patchesResult.success).toBe(true);
      if (!patchesResult.success) return;

      const patchOperations = patchesResult.data.map((p) => p.payload);
      const replayResult = applyPatches(snapshot.graphData, patchOperations);

      expect(replayResult.success).toBe(true);
      expect(Object.keys(replayResult.graph?.nodes ?? {})).toHaveLength(2);
      expect(Object.keys(replayResult.graph?.contracts ?? {})).toHaveLength(1);
      expect(replayResult.graph?.version).toBe(3);
    });

    it('should handle incremental sync from snapshot', async () => {
      const patchRepo = createMockPatchRepository();
      const graphRepo = createMockGraphRepository();
      const projectId = generateUUID();
      const branchId = generateUUID();

      const baseGraph = createEmptyGraph();

      const contractId = generateUUID();
      const contractPatch = createAddContractPatch(createTestContract(contractId), actorOptions);
      await patchRepo.appendPatch(branchId, contractPatch);

      const nodeId1 = generateUUID();
      const node1Patch = createAddNodePatch(createTestNode(nodeId1), actorOptions);
      await patchRepo.appendPatch(branchId, node1Patch);

      const allPatches1 = await patchRepo.loadPatches(branchId);
      const ops1 = allPatches1.success ? allPatches1.data.map((p) => p.payload) : [];
      const graph1 = applyPatches(baseGraph, ops1);
      expect(graph1.success).toBe(true);

      await graphRepo.saveSnapshot(projectId, branchId, graph1.graph!, 2);

      const nodeId2 = generateUUID();
      const nodeId3 = generateUUID();
      const node2Patch = createAddNodePatch(createTestNode(nodeId2), actorOptions);
      const node3Patch = createAddNodePatch(createTestNode(nodeId3), actorOptions);
      await patchRepo.appendPatch(branchId, node2Patch);
      await patchRepo.appendPatch(branchId, node3Patch);

      const snapshotResult = await graphRepo.loadSnapshot(branchId);
      expect(snapshotResult.success).toBe(true);
      if (!snapshotResult.success) return;

      const snapshot = snapshotResult.data!;
      expect(snapshot.patchSequence).toBe(2);

      const newPatchesResult = await patchRepo.loadPatches(branchId, {
        sinceSequence: snapshot.patchSequence,
      });
      expect(newPatchesResult.success).toBe(true);
      if (!newPatchesResult.success) return;

      expect(newPatchesResult.data).toHaveLength(2);

      const newOps = newPatchesResult.data.map((p) => p.payload);
      const finalGraph = applyPatches(snapshot.graphData, newOps);

      expect(finalGraph.success).toBe(true);
      expect(Object.keys(finalGraph.graph?.nodes ?? {})).toHaveLength(3);
      expect(finalGraph.graph?.version).toBe(4);
    });
  });
});
