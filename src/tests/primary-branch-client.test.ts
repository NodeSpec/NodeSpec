import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Owner spike 2026-08-23: the trunk's identity is branches.is_primary, not
// the literal name 'main' — connect renames the trunk row to the git branch
// it mirrors, so the header tells the truth and later branches wanting the
// real name stop colliding. The client half: the flag travels the
// persistence stack, and every merge/switch/guard lane targets the RESOLVED
// primary name instead of a hardcoded 'main'.

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('primary-branch identity — client', () => {
  it('the flag travels the persistence stack (row → PersistedBranch → creation lanes)', () => {
    const repo = read('persistence/supabase/branch-repository.ts');
    expect(repo).toContain("isPrimary: row.is_primary === true || (row.is_primary == null && row.name === 'main')");
    expect(repo).toContain('is_primary: isPrimary === true');
    const types = read('persistence/types.ts');
    expect(types).toContain('isPrimary: boolean');
    // Project creation marks its first branch primary explicitly.
    expect(read('ui/services/ProjectService.ts')).toContain("branchRepo.create(project.id, 'main', userId, undefined, undefined, true)");
  });

  it('GraphEditor resolves the primary name from data and aims every lane at it', () => {
    const ge = read('ui/components/GraphEditor.tsx');
    expect(ge).toContain("availableBranches.find(b => b.isPrimary)?.name ?? 'main'");
    // Merge lanes target the RESOLVED name — no hardcoded 'main' target remains.
    expect(ge).toContain('gitService.openPullRequest(projectId, branchName, integrationId, primaryBranchName)');
    expect(ge).toContain('gitService.mergeBranchDirect(projectId, branchName, integrationId, primaryBranchName)');
    expect(ge).toContain('gitService.restoreModel(integrationId, primaryBranchName)');
    expect(ge).not.toContain("openPullRequest(projectId, branchName, integrationId, 'main')");
    expect(ge).not.toContain("mergeBranchDirect(projectId, branchName, integrationId, 'main')");
    // Guards protect the primary, whatever it is named.
    expect(ge).toContain("if (name === primaryBranchName) throw new Error('Cannot archive the primary branch')");
    expect(ge).toContain('if (deleteBranchName === primaryBranchName)');
    // Change detection polls the ACTIVE branch with the primary as fallback —
    // never the literal 'main' (the owner's "detecting on main only" worry).
    expect(ge).toContain('branchName: branchNameRef.current || primaryBranchNameRef.current');
    expect(ge).toContain('checkBranchFreshness(branchName || primaryBranchNameRef.current)');
  });

  it('the header re-reads branches when the git panel closes (the rename must show up)', () => {
    const ge = read('ui/components/GraphEditor.tsx');
    expect(ge).toContain('onGitIntegrationClosed={loadBranches}');
    const tb = read('ui/components/panels/TopBar.tsx');
    expect(tb).toContain('onGitIntegrationClosed?.()');
    // The merge button hides on the primary by IDENTITY.
    expect(tb).toContain("branchName !== (primaryBranchName ?? 'main')");
  });

  it('BranchManager marks the default by flag, with the naming rule only as legacy fallback', () => {
    const bm = read('ui/components/panels/BranchManager.tsx');
    expect(bm).toContain("availableBranches.find(b => b.name === name)?.isPrimary ?? name === 'main'");
    expect(bm).toContain("branch.isPrimary ?? branch.name === 'main'");
  });
});
