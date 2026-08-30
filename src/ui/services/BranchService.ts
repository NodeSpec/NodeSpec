import type { Graph } from '@nodespec/core/types.js';
import type { PersistedBranch, PersistedSnapshot, PersistedPatch } from '../../persistence/types.js';
import type { ProjectService } from './ProjectService.js';
import type { PatchService } from './PatchService.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';

export class BranchService {
  constructor(
    private projectService: ProjectService,
    private patchService: PatchService
  ) {}

  async createBranch(
    projectId: string,
    branchName: string,
    userId: string,
    baseGraph?: Graph,
    basePatchSequence = 0
  ): Promise<{ branch: PersistedBranch; snapshot: PersistedSnapshot }> {
    // Create the branch FIRST (without a snapshot) to get a branchId
    const branch = await this.projectService.createBranch(
      projectId,
      branchName,
      userId,
      undefined
    );

    // Now create the snapshot using the branch's ID
    const snapshot = await this.projectService.saveSnapshot(
      projectId,
      branch.id,
      baseGraph || createEmptyGraph(),
      basePatchSequence
    );

    // Update the branch with the snapshot ID
    await this.updateBranchBaseSnapshot(branch.id, snapshot.id);

    return { branch, snapshot };
  }

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

  async loadBranchWithDetails(branchId: string): Promise<{
    branch: PersistedBranch;
    snapshot: PersistedSnapshot | null;
    patches: PersistedPatch[];
    patchCount: number;
  }> {
    const [branch, snapshot, patches] = await Promise.all([
      this.projectService.getBranch(branchId),
      this.projectService.loadSnapshot(branchId),
      this.patchService.loadPatches(branchId),
    ]);

    return {
      branch,
      snapshot,
      patches,
      patchCount: patches.length,
    };
  }

  async listBranchesWithPatchCounts(projectId: string): Promise<
    Array<{ branch: PersistedBranch; patchCount: number }>
  > {
    const branches = await this.projectService.listBranches(projectId);

    const branchesWithCounts = await Promise.all(
      branches.map(async (branch) => {
        const patches = await this.patchService.loadPatches(branch.id);
        return {
          branch,
          patchCount: patches.length,
        };
      })
    );

    return branchesWithCounts;
  }

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
