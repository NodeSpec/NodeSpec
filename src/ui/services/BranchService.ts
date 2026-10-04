import type { PersistedBranch } from '../../persistence/types.js';
import type { ProjectService } from './ProjectService.js';
import type { PatchService } from './PatchService.js';

export class BranchService {
  constructor(
    private projectService: ProjectService,
    private patchService: PatchService
  ) {}

  async deleteBranch(branchId: string): Promise<void> {
    await this.patchService.clearPatches(branchId);
    await this.projectService.deleteBranch(branchId);
  }

  // R3-3b: mergeBranchToMain DELETED (the stray-path kill list). It was a DB
  // snapshot-copy that git never saw — after R3-3a's real refs, using it would
  // desync main's ref from main's canvas and orphan the feature ref. A design
  // merge IS a git merge now: push → pull request (or explicit direct merge) via
  // the provider, convergence through the R3-1 loader / drift-card machinery.
  // clearPatches survives ONLY inside deleteBranch — a MERGE never clears anything.

  async updateBranchBaseSnapshot(branchId: string, snapshotId: string): Promise<PersistedBranch> {
    const branch = await this.projectService.getBranch(branchId);
    const { createSupabaseBranchRepository } = await import('../../persistence/supabase/branch-repository.js');
    const { getSupabaseClient } = await import('../../persistence/supabase/client.js');
    const branchRepo = createSupabaseBranchRepository(getSupabaseClient());

    const result = await branchRepo.update(branchId, {
      metadata: { ...branch.metadata, baseSnapshotId: snapshotId },
    });

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  }
}
