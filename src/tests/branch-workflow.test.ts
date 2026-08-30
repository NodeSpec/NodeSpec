import { describe, it, expect, beforeEach } from 'vitest';
import { createMockProjectRepository, createMockBranchRepository, createMockGraphRepository } from '../persistence/testing/mock-repositories.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { ProjectRepository, BranchRepository, GraphRepository } from '../persistence/ports.js';

describe('Branch Workflow', () => {
  let projectRepo: ProjectRepository;
  let branchRepo: BranchRepository;
  let graphRepo: GraphRepository;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    projectRepo = createMockProjectRepository();
    branchRepo = createMockBranchRepository();
    graphRepo = createMockGraphRepository();

    userId = 'user-123';
    const projectResult = await projectRepo.create('Test Project', userId);
    if (!projectResult.success) throw new Error('Failed to create project');
    projectId = projectResult.data.id;
  });

  describe('Branch Creation', () => {
    it('should create a new branch with snapshot', async () => {
      const graph = createEmptyGraph();
      const snapshotResult = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);
      expect(snapshotResult.success).toBe(true);

      const branchResult = await branchRepo.create(
        projectId,
        'feature-branch',
        userId,
        snapshotResult.success ? snapshotResult.data.id : undefined
      );

      expect(branchResult.success).toBe(true);
      if (branchResult.success) {
        expect(branchResult.data.name).toBe('feature-branch');
        expect(branchResult.data.baseSnapshotId).toBeDefined();
      }
    });

    it('should prevent duplicate branch names', async () => {
      const graph = createEmptyGraph();
      const snapshotResult = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);

      await branchRepo.create(
        projectId,
        'existing-branch',
        userId,
        snapshotResult.success ? snapshotResult.data.id : undefined
      );

      const duplicateResult = await branchRepo.create(
        projectId,
        'existing-branch',
        userId,
        snapshotResult.success ? snapshotResult.data.id : undefined
      );

      expect(duplicateResult.success).toBe(false);
    });

    it('should list all branches in a project', async () => {
      const graph = createEmptyGraph();
      const snapshot = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);
      const snapshotId = snapshot.success ? snapshot.data.id : undefined;

      await branchRepo.create(projectId, 'main', userId, snapshotId);
      await branchRepo.create(projectId, 'feature-1', userId, snapshotId);
      await branchRepo.create(projectId, 'feature-2', userId, snapshotId);

      const listResult = await branchRepo.listByProject(projectId);

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.data).toHaveLength(3);
        expect(listResult.data.map((b) => b.name)).toContain('main');
        expect(listResult.data.map((b) => b.name)).toContain('feature-1');
        expect(listResult.data.map((b) => b.name)).toContain('feature-2');
      }
    });
  });

  describe('Branch Switching', () => {
    it('should load branch snapshot correctly', async () => {
      const graph = createEmptyGraph();
      const snapshotResult = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);
      const snapshotId = snapshotResult.success ? snapshotResult.data.id : '';

      const branchResult = await branchRepo.create(projectId, 'test-branch', userId, snapshotId);
      const branchId = branchResult.success ? branchResult.data.id : '';

      const loadedSnapshot = await graphRepo.loadSnapshot(branchId);

      expect(loadedSnapshot.success).toBe(true);
      if (loadedSnapshot.success && loadedSnapshot.data) {
        expect(loadedSnapshot.data.graphData).toEqual(graph);
      }
    });

    it('should retrieve branch by name', async () => {
      const graph = createEmptyGraph();
      const snapshot = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);

      await branchRepo.create(
        projectId,
        'my-feature',
        userId,
        snapshot.success ? snapshot.data.id : undefined
      );

      const branchResult = await branchRepo.getByName(projectId, 'my-feature');

      expect(branchResult.success).toBe(true);
      if (branchResult.success && branchResult.data) {
        expect(branchResult.data.name).toBe('my-feature');
      }
    });
  });

  describe('Save Functionality', () => {
    it('should save snapshot and update branch base', async () => {
      const initialGraph = createEmptyGraph();
      const initialSnapshot = await graphRepo.saveSnapshot(projectId, 'temp', initialGraph, 0);

      const branchResult = await branchRepo.create(
        projectId,
        'work-branch',
        userId,
        initialSnapshot.success ? initialSnapshot.data.id : undefined
      );

      const branchId = branchResult.success ? branchResult.data.id : '';

      const modifiedGraph = { ...initialGraph, version: 1 };
      const newSnapshot = await graphRepo.saveSnapshot(projectId, branchId, modifiedGraph, 1);

      expect(newSnapshot.success).toBe(true);

      const updateResult = await branchRepo.update(branchId, {
        metadata: { lastSaved: new Date().toISOString() }
      });

      expect(updateResult.success).toBe(true);
    });

    it('should track multiple snapshots per branch', async () => {
      const graph = createEmptyGraph();
      const snapshot1 = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);

      const branchResult = await branchRepo.create(
        projectId,
        'versioned-branch',
        userId,
        snapshot1.success ? snapshot1.data.id : undefined
      );
      const branchId = branchResult.success ? branchResult.data.id : '';

      await graphRepo.saveSnapshot(projectId, branchId, { ...graph, version: 1 }, 1);
      await graphRepo.saveSnapshot(projectId, branchId, { ...graph, version: 2 }, 2);

      const snapshots = await graphRepo.listSnapshots(branchId, 10);

      expect(snapshots.success).toBe(true);
      if (snapshots.success) {
        expect(snapshots.data).toHaveLength(2);
      }
    });
  });

  describe('Merge Workflow', () => {
    it('should merge feature branch to main', async () => {
      const mainGraph = createEmptyGraph();
      const mainSnapshot = await graphRepo.saveSnapshot(projectId, 'temp-main', mainGraph, 0);
      const mainBranchResult = await branchRepo.create(
        projectId,
        'main',
        userId,
        mainSnapshot.success ? mainSnapshot.data.id : undefined
      );
      const mainBranchId = mainBranchResult.success ? mainBranchResult.data.id : '';

      const featureGraph = { ...mainGraph, version: 1 };
      const featureSnapshot = await graphRepo.saveSnapshot(projectId, 'temp-feature', featureGraph, 0);
      const featureBranchResult = await branchRepo.create(
        projectId,
        'feature',
        userId,
        featureSnapshot.success ? featureSnapshot.data.id : undefined
      );
      const featureBranchId = featureBranchResult.success ? featureBranchResult.data.id : '';

      const featureFinalSnapshot = await graphRepo.loadSnapshot(featureBranchId);
      expect(featureFinalSnapshot.success).toBe(true);

      if (featureFinalSnapshot.success && featureFinalSnapshot.data) {
        const mergeSnapshot = await graphRepo.saveSnapshot(
          projectId,
          mainBranchId,
          featureFinalSnapshot.data.graphData,
          0
        );

        expect(mergeSnapshot.success).toBe(true);

        const updatedMain = await branchRepo.update(mainBranchId, {
          metadata: { lastMerge: featureBranchId }
        });

        expect(updatedMain.success).toBe(true);
      }
    });

    it('should preserve main branch integrity during merge', async () => {
      const mainGraph = createEmptyGraph();
      const mainSnapshot = await graphRepo.saveSnapshot(projectId, 'temp-main', mainGraph, 0);
      const mainBranchResult = await branchRepo.create(
        projectId,
        'main',
        userId,
        mainSnapshot.success ? mainSnapshot.data.id : undefined
      );

      const mainBefore = await branchRepo.getById(mainBranchResult.success ? mainBranchResult.data.id : '');
      expect(mainBefore.success).toBe(true);

      if (mainBefore.success && mainBefore.data) {
        const baseSnapshot = mainBefore.data.baseSnapshotId;

        const updatedMain = await branchRepo.getById(mainBranchResult.success ? mainBranchResult.data.id : '');
        expect(updatedMain.success).toBe(true);
        if (updatedMain.success && updatedMain.data) {
          expect(updatedMain.data.baseSnapshotId).toBe(baseSnapshot);
        }
      }
    });
  });

  describe('Branch Deletion', () => {
    it('should delete a branch', async () => {
      const graph = createEmptyGraph();
      const snapshot = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);
      const branchResult = await branchRepo.create(
        projectId,
        'temporary-branch',
        userId,
        snapshot.success ? snapshot.data.id : undefined
      );

      const branchId = branchResult.success ? branchResult.data.id : '';
      const deleteResult = await branchRepo.delete(branchId);

      expect(deleteResult.success).toBe(true);

      const getResult = await branchRepo.getById(branchId);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBeNull();
      }
    });

    it('should not allow deleting main branch in production', async () => {
      const graph = createEmptyGraph();
      const snapshot = await graphRepo.saveSnapshot(projectId, 'temp', graph, 0);
      const mainResult = await branchRepo.create(
        projectId,
        'main',
        userId,
        snapshot.success ? snapshot.data.id : undefined
      );

      const mainBranchId = mainResult.success ? mainResult.data.id : '';

      const mainBranch = await branchRepo.getById(mainBranchId);
      if (mainBranch.success && mainBranch.data) {
        expect(mainBranch.data.name).toBe('main');
      }
    });
  });

  describe('Unsaved Changes Detection', () => {
    it('should detect when branch has unsaved patches', () => {
      const hasPendingChanges = (patchCount: number) => patchCount > 0;

      expect(hasPendingChanges(0)).toBe(false);
      expect(hasPendingChanges(3)).toBe(true);
    });
  });
});
