import type {
  Branch,
  Graph,
  PatchOperation,
  PatchResult,
  BranchDiff,
  GraphSnapshot,
} from './types.js';
import { applyPatches, sortPatchesByTimestamp } from './patch-engine.js';
import { generateUUID, now, deepClone } from './utils.js';

export function createBranch(
  name: string,
  baseSnapshotId: string | null = null,
  patches: PatchOperation[] = []
): Branch {
  return {
    id: generateUUID(),
    name,
    baseSnapshotId,
    patches: sortPatchesByTimestamp(patches),
    createdAt: now(),
    metadata: {},
  };
}

export function addPatchToBranch(branch: Branch, patch: PatchOperation): Branch {
  const newPatches = sortPatchesByTimestamp([...branch.patches, patch]);
  return {
    ...branch,
    patches: newPatches,
  };
}

export function removePatchFromBranch(branch: Branch, patchId: string): Branch {
  return {
    ...branch,
    patches: branch.patches.filter((p) => p.metadata.id !== patchId),
  };
}

export function replayBranch(baseGraph: Graph, branch: Branch): PatchResult {
  return applyPatches(baseGraph, branch.patches);
}

export function replayBranchPartial(
  baseGraph: Graph,
  branch: Branch,
  untilPatchId: string
): PatchResult {
  const index = branch.patches.findIndex((p) => p.metadata.id === untilPatchId);
  if (index === -1) {
    return {
      success: false,
      error: {
        code: 'PATCH_NOT_FOUND',
        message: `Patch ${untilPatchId} not found in branch`,
      },
    };
  }
  return applyPatches(baseGraph, branch.patches.slice(0, index + 1));
}

export function diffBranches(branchA: Branch, branchB: Branch): BranchDiff {
  const patchIdsA = new Set(branchA.patches.map((p) => p.metadata.id));
  const patchIdsB = new Set(branchB.patches.map((p) => p.metadata.id));

  const common = branchA.patches.filter((p) => patchIdsB.has(p.metadata.id));
  const added = branchB.patches.filter((p) => !patchIdsA.has(p.metadata.id));
  const removed = branchA.patches.filter((p) => !patchIdsB.has(p.metadata.id));

  return {
    added,
    removed,
    common,
  };
}

export function cherryPickPatch(
  targetBranch: Branch,
  sourceBranch: Branch,
  patchId: string
): Branch | null {
  const patch = sourceBranch.patches.find((p) => p.metadata.id === patchId);
  if (!patch) {
    return null;
  }
  return addPatchToBranch(targetBranch, deepClone(patch));
}

export function cherryPickPatches(
  targetBranch: Branch,
  sourceBranch: Branch,
  patchIds: string[]
): Branch {
  let result = targetBranch;
  for (const patchId of patchIds) {
    const cherryPicked = cherryPickPatch(result, sourceBranch, patchId);
    if (cherryPicked) {
      result = cherryPicked;
    }
  }
  return result;
}

export function mergeBranches(
  baseBranch: Branch,
  incomingBranch: Branch
): Branch {
  const existingIds = new Set(baseBranch.patches.map((p) => p.metadata.id));
  const newPatches = incomingBranch.patches.filter(
    (p) => !existingIds.has(p.metadata.id)
  );

  return {
    ...baseBranch,
    patches: sortPatchesByTimestamp([...baseBranch.patches, ...newPatches]),
  };
}

export function forkBranch(sourceBranch: Branch, newName: string): Branch {
  return {
    ...createBranch(newName, sourceBranch.baseSnapshotId),
    patches: deepClone(sourceBranch.patches),
  };
}

export function getBranchHistory(branch: Branch): Array<{
  patchId: string;
  timestamp: string;
  actorType: string;
  summary: string;
}> {
  return branch.patches.map((p) => ({
    patchId: p.metadata.id,
    timestamp: p.metadata.timestamp,
    actorType: p.metadata.actorType,
    summary: p.metadata.summary,
  }));
}

export function findCommonAncestor(
  branchA: Branch,
  branchB: Branch
): PatchOperation | null {
  const patchIdsB = new Set(branchB.patches.map((p) => p.metadata.id));

  for (let i = branchA.patches.length - 1; i >= 0; i--) {
    if (patchIdsB.has(branchA.patches[i].metadata.id)) {
      return branchA.patches[i];
    }
  }

  return null;
}

export function createSnapshot(graph: Graph): GraphSnapshot {
  return {
    id: generateUUID(),
    graph: deepClone(graph),
    createdAt: now(),
  };
}

export function compareBranchesAtPoint(
  baseGraph: Graph,
  branchA: Branch,
  branchB: Branch
): { graphA: Graph | null; graphB: Graph | null; divergencePoint: number } {
  let divergencePoint = 0;
  const minLength = Math.min(branchA.patches.length, branchB.patches.length);

  for (let i = 0; i < minLength; i++) {
    if (branchA.patches[i].metadata.id !== branchB.patches[i].metadata.id) {
      divergencePoint = i;
      break;
    }
    if (i === minLength - 1) {
      divergencePoint = minLength;
    }
  }

  const resultA = replayBranch(baseGraph, branchA);
  const resultB = replayBranch(baseGraph, branchB);

  return {
    graphA: resultA.success ? resultA.graph! : null,
    graphB: resultB.success ? resultB.graph! : null,
    divergencePoint,
  };
}

export function rebaseBranch(
  branch: Branch,
  newBasePatches: PatchOperation[]
): Branch {
  const existingIds = new Set(branch.patches.map((p) => p.metadata.id));
  const basePatches = newBasePatches.filter((p) => !existingIds.has(p.metadata.id));

  return {
    ...branch,
    patches: sortPatchesByTimestamp([...basePatches, ...branch.patches]),
  };
}
