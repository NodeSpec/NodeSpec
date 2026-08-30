import type { AIRun } from '../../persistence/types.js';
import type { PersistenceService } from './PersistenceService.js';

export class AIRunService {
  constructor(private persistence: PersistenceService) {}

  async createRun(
    projectId: string,
    branchId: string,
    model: string,
    promptHash: string,
    inputSnapshotId?: string,
    metadata?: Record<string, unknown>
  ): Promise<AIRun> {
    const repo = this.persistence.getAIRunRepository();
    const result = await repo.create(projectId, branchId, model, promptHash, inputSnapshotId, metadata);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getRun(runId: string): Promise<AIRun | null> {
    const repo = this.persistence.getAIRunRepository();
    const result = await repo.getById(runId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async listRunsByBranch(branchId: string, limit = 20): Promise<AIRun[]> {
    const repo = this.persistence.getAIRunRepository();
    const result = await repo.listByBranch(branchId, limit);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateRunStatus(
    runId: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    outputPatches?: string[]
  ): Promise<AIRun> {
    const repo = this.persistence.getAIRunRepository();
    const result = await repo.updateStatus(runId, status, outputPatches);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async markCompleted(runId: string, outputPatches: string[]): Promise<AIRun> {
    const repo = this.persistence.getAIRunRepository();
    const result = await repo.markCompleted(runId, outputPatches);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async markFailed(runId: string, metadata?: Record<string, unknown>): Promise<AIRun> {
    const repo = this.persistence.getAIRunRepository();
    const result = await repo.markFailed(runId, metadata);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }
}
