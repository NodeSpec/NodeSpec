import type { CodeStructure } from '@nodespec/core/code-structure.js';
import type { PersistenceService } from './PersistenceService.js';

export class CodeStructureService {
  constructor(private persistence: PersistenceService) {}

  async getByArtifactId(artifactId: string): Promise<CodeStructure | null> {
    const repo = this.persistence.getCodeStructureRepository();
    return await repo.getByArtifactId(artifactId);
  }

  async getByNodeId(nodeId: string): Promise<CodeStructure[]> {
    const repo = this.persistence.getCodeStructureRepository();
    return await repo.getByNodeId(nodeId);
  }

  async getByProjectId(projectId: string): Promise<CodeStructure[]> {
    const repo = this.persistence.getCodeStructureRepository();
    return await repo.getByProjectId(projectId);
  }

  async update(id: string, updates: Partial<CodeStructure>): Promise<CodeStructure> {
    const repo = this.persistence.getCodeStructureRepository();
    return await repo.update(id, updates);
  }

  async delete(id: string): Promise<void> {
    const repo = this.persistence.getCodeStructureRepository();
    return await repo.delete(id);
  }
}
