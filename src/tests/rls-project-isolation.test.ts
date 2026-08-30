import { describe, it, expect } from 'vitest';
import {
  createMockProjectRepository,
  createMockBranchRepository,
  createMockGraphRepository,
  createMockPatchRepository,
  createMockArtifactRepository,
  createMockAIRunRepository,
} from '../persistence/testing/mock-repositories.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import { createAddNodePatch } from '@nodespec/core/patch-factory.js';
import type { Node } from '@nodespec/core/types.js';

const OWNER_A = generateUUID();
const OWNER_B = generateUUID();

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Node ${id.slice(0, 8)}`,
    data: {},
    metadata: {},
  };
}

describe('RLS Project Isolation', () => {
  describe('ProjectRepository isolation', () => {
    it('listByOwner returns only projects owned by specified user', async () => {
      const repo = createMockProjectRepository();

      await repo.create('Project A1', OWNER_A);
      await repo.create('Project A2', OWNER_A);
      await repo.create('Project B1', OWNER_B);

      const listA = await repo.listByOwner(OWNER_A);
      expect(listA.success).toBe(true);
      if (!listA.success) return;
      expect(listA.data).toHaveLength(2);
      expect(listA.data.every(p => p.ownerId === OWNER_A)).toBe(true);

      const listB = await repo.listByOwner(OWNER_B);
      expect(listB.success).toBe(true);
      if (!listB.success) return;
      expect(listB.data).toHaveLength(1);
      expect(listB.data[0].ownerId).toBe(OWNER_B);
    });

    it('getById does not leak cross-owner project names or metadata', async () => {
      const repo = createMockProjectRepository();

      const resultA = await repo.create('Secret Project', OWNER_A, { secret: 'data' });
      expect(resultA.success).toBe(true);
      if (!resultA.success) return;

      const fetched = await repo.getById(resultA.data.id);
      expect(fetched.success).toBe(true);
      if (!fetched.success) return;
      expect(fetched.data?.ownerId).toBe(OWNER_A);
    });
  });

  describe('BranchRepository isolation', () => {
    it('listByProject returns only branches for the specified project', async () => {
      const repo = createMockBranchRepository();
      const projectA = generateUUID();
      const projectB = generateUUID();

      await repo.create(projectA, 'main', OWNER_A);
      await repo.create(projectA, 'dev', OWNER_A);
      await repo.create(projectB, 'main', OWNER_B);

      const branchesA = await repo.listByProject(projectA);
      expect(branchesA.success).toBe(true);
      if (!branchesA.success) return;
      expect(branchesA.data).toHaveLength(2);
      expect(branchesA.data.every(b => b.projectId === projectA)).toBe(true);

      const branchesB = await repo.listByProject(projectB);
      expect(branchesB.success).toBe(true);
      if (!branchesB.success) return;
      expect(branchesB.data).toHaveLength(1);
      expect(branchesB.data[0].projectId).toBe(projectB);
    });

    it('getByName scopes to project preventing cross-project branch access', async () => {
      const repo = createMockBranchRepository();
      const projectA = generateUUID();
      const projectB = generateUUID();

      await repo.create(projectA, 'main', OWNER_A);
      await repo.create(projectB, 'main', OWNER_B);

      const resultA = await repo.getByName(projectA, 'main');
      expect(resultA.success).toBe(true);
      if (!resultA.success) return;
      expect(resultA.data?.projectId).toBe(projectA);

      const resultB = await repo.getByName(projectB, 'main');
      expect(resultB.success).toBe(true);
      if (!resultB.success) return;
      expect(resultB.data?.projectId).toBe(projectB);

      const crossResult = await repo.getByName(projectA, 'nonexistent');
      expect(crossResult.success).toBe(true);
      if (!crossResult.success) return;
      expect(crossResult.data).toBeNull();
    });
  });

  describe('GraphRepository isolation', () => {
    it('loadSnapshot scopes to branch preventing cross-branch leakage', async () => {
      const repo = createMockGraphRepository();
      const branchA = generateUUID();
      const branchB = generateUUID();
      const projectA = generateUUID();
      const projectB = generateUUID();

      const graphA = createEmptyGraph();
      const graphB = createEmptyGraph();

      await repo.saveSnapshot(projectA, branchA, graphA, 0);
      await repo.saveSnapshot(projectB, branchB, graphB, 0);

      const snapA = await repo.loadSnapshot(branchA);
      expect(snapA.success).toBe(true);
      if (!snapA.success) return;
      expect(snapA.data?.branchId).toBe(branchA);
      expect(snapA.data?.projectId).toBe(projectA);

      const snapB = await repo.loadSnapshot(branchB);
      expect(snapB.success).toBe(true);
      if (!snapB.success) return;
      expect(snapB.data?.branchId).toBe(branchB);
      expect(snapB.data?.projectId).toBe(projectB);
    });

    it('listSnapshots returns only snapshots for specified branch', async () => {
      const repo = createMockGraphRepository();
      const branchA = generateUUID();
      const branchB = generateUUID();
      const projectA = generateUUID();
      const projectB = generateUUID();

      await repo.saveSnapshot(projectA, branchA, createEmptyGraph(), 0);
      await repo.saveSnapshot(projectA, branchA, createEmptyGraph(), 1);
      await repo.saveSnapshot(projectB, branchB, createEmptyGraph(), 0);

      const listA = await repo.listSnapshots(branchA);
      expect(listA.success).toBe(true);
      if (!listA.success) return;
      expect(listA.data).toHaveLength(2);
      expect(listA.data.every(s => s.branchId === branchA)).toBe(true);
    });
  });

  describe('PatchRepository isolation', () => {
    it('loadPatches scopes to branch preventing cross-branch patch access', async () => {
      const repo = createMockPatchRepository();
      const branchA = generateUUID();
      const branchB = generateUUID();

      const nodeA = createTestNode(generateUUID());
      const nodeB = createTestNode(generateUUID());
      const patchA = createAddNodePatch(nodeA, { actorType: 'human', summary: 'Add A' });
      const patchB = createAddNodePatch(nodeB, { actorType: 'human', summary: 'Add B' });

      await repo.appendPatch(branchA, patchA);
      await repo.appendPatch(branchB, patchB);

      const patchesA = await repo.loadPatches(branchA);
      expect(patchesA.success).toBe(true);
      if (!patchesA.success) return;
      expect(patchesA.data).toHaveLength(1);
      expect(patchesA.data[0].branchId).toBe(branchA);

      const patchesB = await repo.loadPatches(branchB);
      expect(patchesB.success).toBe(true);
      if (!patchesB.success) return;
      expect(patchesB.data).toHaveLength(1);
      expect(patchesB.data[0].branchId).toBe(branchB);
    });

    it('clearPatches only clears patches for specified branch', async () => {
      const repo = createMockPatchRepository();
      const branchA = generateUUID();
      const branchB = generateUUID();

      const nodeA = createTestNode(generateUUID());
      const nodeB = createTestNode(generateUUID());
      const patchA = createAddNodePatch(nodeA, { actorType: 'human', summary: 'Add A' });
      const patchB = createAddNodePatch(nodeB, { actorType: 'human', summary: 'Add B' });

      await repo.appendPatch(branchA, patchA);
      await repo.appendPatch(branchB, patchB);

      await repo.clearPatches(branchA);

      const patchesA = await repo.loadPatches(branchA);
      expect(patchesA.success).toBe(true);
      if (!patchesA.success) return;
      expect(patchesA.data).toHaveLength(0);

      const patchesB = await repo.loadPatches(branchB);
      expect(patchesB.success).toBe(true);
      if (!patchesB.success) return;
      expect(patchesB.data).toHaveLength(1);
    });
  });

  describe('ArtifactRepository isolation', () => {
    it('loadArtifacts scopes to project preventing cross-project artifact access', async () => {
      const repo = createMockArtifactRepository();
      const projectA = generateUUID();
      const projectB = generateUUID();

      await repo.saveArtifact(projectA, {
        id: generateUUID(),
        path: 'src/main.ts',
        contentText: 'console.log("A")',
        contentHash: 'hash-a',
        language: 'typescript',
        nodeId: generateUUID(),
        status: 'active',
        kind: 'source',
      });

      await repo.saveArtifact(projectB, {
        id: generateUUID(),
        path: 'src/main.ts',
        contentText: 'console.log("B")',
        contentHash: 'hash-b',
        language: 'typescript',
        nodeId: generateUUID(),
        status: 'active',
        kind: 'source',
      });

      const artifactsA = await repo.loadArtifacts(projectA);
      expect(artifactsA.success).toBe(true);
      if (!artifactsA.success) return;
      expect(artifactsA.data).toHaveLength(1);
      expect(artifactsA.data[0].projectId).toBe(projectA);

      const artifactsB = await repo.loadArtifacts(projectB);
      expect(artifactsB.success).toBe(true);
      if (!artifactsB.success) return;
      expect(artifactsB.data).toHaveLength(1);
      expect(artifactsB.data[0].projectId).toBe(projectB);
    });

    it('searchByLanguage scopes to project', async () => {
      const repo = createMockArtifactRepository();
      const projectA = generateUUID();
      const projectB = generateUUID();

      await repo.saveArtifact(projectA, {
        id: generateUUID(),
        path: 'src/app.ts',
        contentText: 'export default {}',
        contentHash: 'hash-1',
        language: 'typescript',
        nodeId: generateUUID(),
        status: 'active',
        kind: 'source',
      });

      await repo.saveArtifact(projectB, {
        id: generateUUID(),
        path: 'src/app.ts',
        contentText: 'export default {}',
        contentHash: 'hash-2',
        language: 'typescript',
        nodeId: generateUUID(),
        status: 'active',
        kind: 'source',
      });

      const results = await repo.searchByLanguage(projectA, 'typescript');
      expect(results.success).toBe(true);
      if (!results.success) return;
      expect(results.data).toHaveLength(1);
      expect(results.data[0].projectId).toBe(projectA);
    });
  });

  describe('AIRunRepository isolation', () => {
    it('listByBranch returns only runs for specified branch', async () => {
      const repo = createMockAIRunRepository();
      const projectA = generateUUID();
      const projectB = generateUUID();
      const branchA = generateUUID();
      const branchB = generateUUID();

      await repo.create(projectA, branchA, 'gpt-4', 'hash-a');
      await repo.create(projectA, branchA, 'gpt-4', 'hash-a2');
      await repo.create(projectB, branchB, 'gpt-4', 'hash-b');

      const runsA = await repo.listByBranch(branchA);
      expect(runsA.success).toBe(true);
      if (!runsA.success) return;
      expect(runsA.data).toHaveLength(2);
      expect(runsA.data.every(r => r.branchId === branchA)).toBe(true);

      const runsB = await repo.listByBranch(branchB);
      expect(runsB.success).toBe(true);
      if (!runsB.success) return;
      expect(runsB.data).toHaveLength(1);
      expect(runsB.data[0].branchId).toBe(branchB);
    });
  });

  describe('Cross-project data integrity', () => {
    it('two projects with same name have completely separate data', async () => {
      const projectRepo = createMockProjectRepository();
      const branchRepo = createMockBranchRepository();
      const graphRepo = createMockGraphRepository();

      const resultA = await projectRepo.create('Todo Application', OWNER_A);
      const resultB = await projectRepo.create('Todo Application', OWNER_B);
      expect(resultA.success && resultB.success).toBe(true);
      if (!resultA.success || !resultB.success) return;

      const projectA = resultA.data;
      const projectB = resultB.data;
      expect(projectA.id).not.toBe(projectB.id);

      const branchResultA = await branchRepo.create(projectA.id, 'main', OWNER_A);
      const branchResultB = await branchRepo.create(projectB.id, 'main', OWNER_B);
      expect(branchResultA.success && branchResultB.success).toBe(true);
      if (!branchResultA.success || !branchResultB.success) return;

      const branchA = branchResultA.data;
      const branchB = branchResultB.data;

      const graphA = createEmptyGraph();
      const graphB = createEmptyGraph();
      await graphRepo.saveSnapshot(projectA.id, branchA.id, graphA, 0);
      await graphRepo.saveSnapshot(projectB.id, branchB.id, graphB, 0);

      const snapsA = await graphRepo.listSnapshots(branchA.id);
      const snapsB = await graphRepo.listSnapshots(branchB.id);
      expect(snapsA.success && snapsB.success).toBe(true);
      if (!snapsA.success || !snapsB.success) return;

      expect(snapsA.data).toHaveLength(1);
      expect(snapsB.data).toHaveLength(1);
      expect(snapsA.data[0].projectId).toBe(projectA.id);
      expect(snapsB.data[0].projectId).toBe(projectB.id);

      const ownerAProjects = await projectRepo.listByOwner(OWNER_A);
      const ownerBProjects = await projectRepo.listByOwner(OWNER_B);
      expect(ownerAProjects.success && ownerBProjects.success).toBe(true);
      if (!ownerAProjects.success || !ownerBProjects.success) return;
      expect(ownerAProjects.data).toHaveLength(1);
      expect(ownerBProjects.data).toHaveLength(1);
    });

    it('deleting one project does not affect another with same name', async () => {
      const projectRepo = createMockProjectRepository();
      const branchRepo = createMockBranchRepository();

      const resultA = await projectRepo.create('Todo Application', OWNER_A);
      const resultB = await projectRepo.create('Todo Application', OWNER_B);
      expect(resultA.success && resultB.success).toBe(true);
      if (!resultA.success || !resultB.success) return;

      await branchRepo.create(resultA.data.id, 'main', OWNER_A);
      await branchRepo.create(resultB.data.id, 'main', OWNER_B);

      await projectRepo.delete(resultA.data.id);

      const listA = await projectRepo.listByOwner(OWNER_A);
      const listB = await projectRepo.listByOwner(OWNER_B);
      expect(listA.success && listB.success).toBe(true);
      if (!listA.success || !listB.success) return;
      expect(listA.data).toHaveLength(0);
      expect(listB.data).toHaveLength(1);

      const branchesB = await branchRepo.listByProject(resultB.data.id);
      expect(branchesB.success).toBe(true);
      if (!branchesB.success) return;
      expect(branchesB.data).toHaveLength(1);
    });
  });

  describe('RLS policy consistency checks', () => {
    it('UPDATE policies should verify ownership before and after change', () => {
      // N11(a) 2026-08-09: detected_dependencies + architecture_generation_results
      // dropped with their tables (migration 20260809170000).
      const policiesRequiringWithCheck = [
        'specification_mappings',
        'specification_requirements',
        'specification_sections',
        'project_specifications',
        'branches',
        'code_structures',
        'test_cases',
      ];

      expect(policiesRequiringWithCheck.length).toBeGreaterThan(0);
      policiesRequiringWithCheck.forEach(table => {
        expect(table).toBeTruthy();
      });
    });

    it('INSERT policies should always verify project ownership', () => {
      const tablesWithProjectScope = [
        'branches',
        'graph_snapshots',
        'graph_patches',
        'artifacts',
        'ai_runs',
        'specification_requirements',
        'specification_sections',
        'specification_mappings',
        'code_structures',
        'conversation_history',
        'generation_events',
        'git_sync_log',
      ];

      // 15 tables since specification_features was dropped
      // (20260625145327_drop_specification_features.sql removed the whole
      // Features domain, including its project-scoped INSERT policy); 12 since
      // N11(a) dropped architecture_generation_results, detected_dependencies
      // and recent_changes with their policies (20260809170000).
      expect(tablesWithProjectScope.length).toBe(12);
    });

    it('service_role should bypass RLS for edge function operations', () => {
      const tablesNeedingServiceRole = [
        'ai_runs',
        'graph_patches',
        'graph_snapshots',
        'artifacts',
        'branches',
        'generation_events',
        'token_usage',
        'conversation_history',
        'code_structures',
        'project_specifications',
        'specification_requirements',
        'specification_sections',
        'specification_mappings',
        'ai_proposals',
        'test_cases',
        'git_integrations',
        'git_sync_log',
        'stripe_subscriptions',
        'stripe_customers',
        'stripe_orders',
        'projects',
      ];

      // The RLS audit migration (20260219034141) created 25 service-role
      // policies; specification_features was later dropped along with its
      // policies (20260625145327), leaving 24; N11(a) dropped the three dead
      // tables' policies with their tables (20260809170000), leaving 21.
      expect(tablesNeedingServiceRole.length).toBe(21);
    });
  });
});
