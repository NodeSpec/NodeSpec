import type { PersistedArtifact } from '../../persistence/types.js';
import type { PersistenceService } from './PersistenceService.js';

export class ArtifactService {
  constructor(private persistence: PersistenceService) {}

  async saveArtifact(projectId: string, artifact: Omit<PersistedArtifact, 'createdAt' | 'updatedAt'>): Promise<PersistedArtifact> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.saveArtifact(projectId, artifact);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getArtifact(artifactId: string): Promise<PersistedArtifact | null> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.loadArtifact(artifactId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async listArtifacts(projectId: string, artifactIds?: string[]): Promise<PersistedArtifact[]> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.loadArtifacts(projectId, artifactIds);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async listByNode(nodeId: string): Promise<PersistedArtifact[]> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.loadByNodeId(nodeId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async listByBranch(branchId: string): Promise<PersistedArtifact[]> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.loadByBranchId(branchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async searchByLanguage(projectId: string, language: string): Promise<PersistedArtifact[]> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.searchByLanguage(projectId, language);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async searchByPath(projectId: string, pathPattern: string): Promise<PersistedArtifact[]> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.searchByPath(projectId, pathPattern);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateArtifact(
    artifactId: string,
    updates: Partial<Omit<PersistedArtifact, 'id' | 'projectId' | 'createdAt'>>
  ): Promise<PersistedArtifact> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.updateArtifact(artifactId, updates);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const repo = this.persistence.getArtifactRepository();
    const result = await repo.deleteArtifact(artifactId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }
}
