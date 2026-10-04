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
    // Project creation marks its first branch primary: driven through the
    // real repositories in item16-project-branch.test.ts (this pin used to
    // read an unused ProjectService copy while the app's own path wrote the
    // row unflagged).
  });

  it('GraphEditor resolves the primary name from data and aims every remaining lane at it', () => {
    const ge = read('ui/components/GraphEditor.tsx');
    // AD.4 (D15): null until the branches load, never the literal 'main'.
    expect(ge).toContain("() => availableBranches.find(b => b.isPrimary)?.name ?? null,");
    // Item 16: the open branch named from the loaded rows by id (openBranchName).
    expect(ge).toContain('const gitBranchName: string | null = openName || primaryBranchName;');
    // V3 1.2 (2026-09-19): the editor's merge, create and delete lanes left
    // with multi-branch; item 16 (2026-09-26) removed the client methods they
    // called (createRemoteBranch, openPullRequest, mergeBranchDirect), which
    // had no caller left. A caller written again fails to compile.
    // The one branch-row lane that stays (the ref-deleted card's Archive)
    // still guards the primary by identity, whatever it is named.
    expect(ge).toContain("if (name === primaryBranchName) throw new Error('Cannot archive the primary branch')");
    // Change detection polls the ACTIVE branch with the primary as fallback,
    // never the literal 'main' (the owner's "detecting on main only" worry).
    expect(ge).toContain('branchName: branchNameRef.current || primaryBranchNameRef.current');
    expect(ge).toContain('checkBranchFreshness(openName || primaryBranchNameRef.current)');
  });

  it('the header re-reads branches when the git panel closes (the rename must show up)', () => {
    const ge = read('ui/components/GraphEditor.tsx');
    // AL.21: and the connected repository, for the start card
    expect(ge).toContain('onGitIntegrationClosed={() => { loadBranches(); loadGitIntegration(); }}');
    const tb = read('ui/components/panels/TopBar.tsx');
    expect(tb).toContain('onGitIntegrationClosed?.()');
    // V3 1.2: the chip reads the rows the re-read produced; there is no merge button to hide.
    expect(tb).toContain('availableBranches={availableBranches}');
    expect(tb).not.toContain('onMergeBranch');
  });

  it('the branch chip marks the default by flag, with the naming rule only as legacy fallback', () => {
    // Rendered proof lives in branch-chip.test.tsx; this pins the expression itself.
    const chip = read('ui/components/panels/BranchChip.tsx');
    expect(chip).toContain("availableBranches.find(b => b.name === name)?.isPrimary ?? name === 'main'");
  });
});
