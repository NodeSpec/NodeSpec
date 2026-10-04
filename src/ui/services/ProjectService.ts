import type { Graph } from '@nodespec/core/types.js';
import type { Project, PersistedBranch, PersistedSnapshot } from '../../persistence/types.js';
import type { PersistenceService } from './PersistenceService.js';

export interface ProjectWithBranch {
  project: Project;
  branch: PersistedBranch;
  graph: Graph;
}

/** True while project_delete_step (migration 20260906140000) is removing the project. */
export function isDeleting(project: Pick<Project, 'metadata'>): boolean {
  return project.metadata?.deleting === true;
}

export class ProjectService {
  constructor(private persistence: PersistenceService) {}

  async listProjects(userId: string): Promise<Project[]> {
    const repo = this.persistence.getProjectRepository();
    // 7.0: owned plus the seats — a member opens a shared project from the same list.
    const result = await repo.listForUser(userId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    // A project mid-delete (metadata.deleting — the first delete slice marks
    // it; the client may have gone away before the last) is not a project
    // to open. It is hidden here and finished by resumePendingDeletes.
    return result.data.filter((p) => !isDeleting(p));
  }

  /** Projects whose delete was interrupted (marked, not gone). */
  async listPendingDeletes(userId: string): Promise<Project[]> {
    const repo = this.persistence.getProjectRepository();
    const result = await repo.listByOwner(userId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data.filter(isDeleting);
  }

  /** Finishes every interrupted delete for the user. Failures are returned,
   * never thrown — the list must still load. */
  async resumePendingDeletes(userId: string): Promise<{ resumed: number; failed: string[] }> {
    const pending = await this.listPendingDeletes(userId);
    const failed: string[] = [];
    for (const project of pending) {
      try {
        await this.deleteProject(project.id);
      } catch (err) {
        failed.push(`${project.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { resumed: pending.length - failed.length, failed };
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

  async deleteProject(projectId: string, onProgress?: (rowsDeleted: number) => void): Promise<void> {
    const repo = this.persistence.getProjectRepository();
    const result = await repo.delete(projectId, onProgress);
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
