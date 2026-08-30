import type { Graph } from '@nodespec/core/types.js';
import type { Project, PersistedBranch, PersistedSnapshot } from '../../persistence/types.js';
import type { PersistenceService } from './PersistenceService.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';

export interface ProjectWithBranch {
  project: Project;
  branch: PersistedBranch;
  graph: Graph;
}

export class ProjectService {
  constructor(private persistence: PersistenceService) {}

  async listProjects(userId: string): Promise<Project[]> {
    const repo = this.persistence.getProjectRepository();
    const result = await repo.listByOwner(userId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getProject(projectId: string): Promise<Project> {
    const repo = this.persistence.getProjectRepository();
    const result = await repo.getById(projectId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    if (!result.data) {
      throw new Error('Project not found');
    }
    return result.data;
  }

  async createProject(name: string, userId: string): Promise<ProjectWithBranch> {
    const projectRepo = this.persistence.getProjectRepository();
    const branchRepo = this.persistence.getBranchRepository();
    const graphRepo = this.persistence.getGraphRepository();

    const projectResult = await projectRepo.create(name, userId);
    if (!projectResult.success) {
      throw new Error(projectResult.error.message);
    }
    const project = projectResult.data;

    const branchResult = await branchRepo.create(project.id, 'main', userId, undefined, undefined, true);
    if (!branchResult.success) {
      throw new Error(branchResult.error.message);
    }
    const branch = branchResult.data;

    const emptyGraph = createEmptyGraph();

    const snapshotResult = await graphRepo.saveSnapshot(project.id, branch.id, emptyGraph, 0);
    if (!snapshotResult.success) {
      throw new Error(snapshotResult.error.message);
    }

    const updateResult = await branchRepo.update(branch.id, {
      baseSnapshotId: snapshotResult.data.id,
    });
    if (!updateResult.success) {
      throw new Error(updateResult.error.message);
    }

    return {
      project,
      branch: updateResult.data,
      graph: emptyGraph,
    };
  }

  async deleteProject(projectId: string): Promise<void> {
    const repo = this.persistence.getProjectRepository();
    const result = await repo.delete(projectId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async updateProject(projectId: string, name: string): Promise<Project> {
    const repo = this.persistence.getProjectRepository();
    const result = await repo.update(projectId, { name });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async listBranches(projectId: string): Promise<PersistedBranch[]> {
    const repo = this.persistence.getBranchRepository();
    const result = await repo.listByProject(projectId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getBranch(branchId: string): Promise<PersistedBranch> {
    const repo = this.persistence.getBranchRepository();
    const result = await repo.getById(branchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    if (!result.data) {
      throw new Error('Branch not found');
    }
    return result.data;
  }

  async getBranchByName(projectId: string, branchName: string): Promise<PersistedBranch | null> {
    const repo = this.persistence.getBranchRepository();
    const result = await repo.getByName(projectId, branchName);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async createBranch(
    projectId: string,
    branchName: string,
    userId: string,
    baseSnapshotId?: string
  ): Promise<PersistedBranch> {
    const repo = this.persistence.getBranchRepository();
    const result = await repo.create(projectId, branchName, userId, baseSnapshotId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteBranch(branchId: string): Promise<void> {
    const repo = this.persistence.getBranchRepository();
    const result = await repo.delete(branchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async loadSnapshot(branchId: string): Promise<PersistedSnapshot | null> {
    const repo = this.persistence.getGraphRepository();
    const result = await repo.loadSnapshot(branchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async loadSnapshotById(snapshotId: string): Promise<PersistedSnapshot | null> {
    const repo = this.persistence.getGraphRepository();
    const result = await repo.loadSnapshotById(snapshotId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async saveSnapshot(
    projectId: string,
    branchId: string,
    graph: Graph,
    patchSequence: number
  ): Promise<PersistedSnapshot> {
    const repo = this.persistence.getGraphRepository();
    const result = await repo.saveSnapshot(projectId, branchId, graph, patchSequence);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }
}
