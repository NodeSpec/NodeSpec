// Item 16 (owner 2026-09-26): a project has one branch, its primary, and
// the app never picks another. Three things follow from it, each one a place
// the multi-branch app got wrong once branches were retired (V3 2.2):
//
// - A new project's branch is its primary. The app's own create path wrote
//   the row without the flag (only an unused ProjectService copy set it), so
//   every project made from New project had no flagged primary until a git
//   connect stamped one: the inspectors found no architecture, the orphan
//   sync found no branch, the chip drew a non-primary colour.
// - Opening a project opens its primary. The app used to reopen the branch
//   name remembered in the browser, and fall back to the newest row, so a
//   person who had a design branch open when branches were retired stayed on
//   it with no way back.
// - The open branch is named as the database names it now. Connect renames
//   the primary to the tracked git branch; the name handed down at open went
//   stale until a reload, and every git lane aimed at a branch that no longer
//   had that name.
import type { BranchRepository, GraphRepository, ProjectRepository } from '../../persistence/ports.js';
import type { PersistedBranch, Project } from '../../persistence/types.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';

/** The branch a project opens on: the flagged primary; for a legacy project
 *  with none flagged, the one named main; else the oldest (the first made). */
export function pickProjectBranch(rows: readonly PersistedBranch[]): PersistedBranch | null {
  if (rows.length === 0) return null;
  return rows.find((b) => b.isPrimary)
    ?? rows.find((b) => b.name === 'main')
    ?? [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

/** The name the open branch carries now, read from the loaded rows by its id;
 *  the name it opened with until the rows are in. */
export function openBranchName(
  rows: ReadonlyArray<{ id: string; name: string }>,
  openId: string | null | undefined,
  openedAs: string | null | undefined,
): string | null {
  const live = openId ? rows.find((b) => b.id === openId)?.name : undefined;
  return live ?? openedAs ?? null;
}

export interface NewProjectRepos {
  projects: ProjectRepository;
  branches: BranchRepository;
  graphs: GraphRepository;
}

/** A project, its one branch (flagged primary) and the empty graph it starts
 *  from, linked as the branch's base snapshot. */
export async function createProjectWithPrimaryBranch(
  repos: NewProjectRepos,
  input: { name: string; userId: string; metadata?: Record<string, unknown> },
): Promise<{ project: Project; branch: PersistedBranch }> {
  const projectResult = await repos.projects.create(input.name, input.userId, input.metadata);
  if (!projectResult.success) throw new Error(projectResult.error.message);
  const project = projectResult.data;

  const branchResult = await repos.branches.create(project.id, 'main', input.userId, undefined, undefined, true);
  if (!branchResult.success) throw new Error(branchResult.error.message);

  const snapshotResult = await repos.graphs.saveSnapshot(project.id, branchResult.data.id, createEmptyGraph(), 0);
  if (!snapshotResult.success) throw new Error(snapshotResult.error.message);

  const linked = await repos.branches.update(branchResult.data.id, { baseSnapshotId: snapshotResult.data.id });
  if (!linked.success) throw new Error(`Failed to link snapshot to branch: ${linked.error.message}`);

  return { project, branch: linked.data };
}
