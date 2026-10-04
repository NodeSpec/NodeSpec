// Owner bench 2026-07-29, gitops bug 2 (client half): out-of-band change cards —
// Compare clicked and NOTHING happened, Accept confirmed nothing visible, and the
// file inspector demanded a manual "Load from Repo" click that errored off the
// default branch. Root cause: every content fetch read the DEFAULT branch. These
// pins hold the branch-aware fetch plumbing and the inspector auto-hydration.
// (The server halves — selective-fetch ref resolution, merge-arrival restore,
// rename stale-path deletion — are pinned in
// supabase/functions/tests/gitops-bench-fixes_test.ts.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

describe('branch-aware content fetch (owner: "nothing happens when i click compare")', () => {
  it('GitService.fetchFileContent takes branchName and forwards it to git-pull', () => {
    const source = read('ui/services/GitService.ts');
    // (signature gained atRef on 2026-07-30 — exact-arity pin lives in the recovery-lane suite)
    expect(source).toContain("...(branchName ? { branchName } : {})");
  });

  it('the reconciliation lanes fetch from the CHANGE\'s branch, not the default', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    // Compare, Accept-All, and residue Bind all pass the card's branch.
    expect(source).toContain("gitService.fetchFileContent(integration.id, [path], change?.branchName)");
    expect(source).toContain('change.branchName,');
    expect(source).toContain('gitService.fetchFileContent(integration.id, [path], change.branchName)');
  });

  it('Compare ALWAYS opens the view — an empty fetch result explains itself', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('File not found on the ${change?.branchName');
  });

  it('Load-from-repo reads the ACTIVE branch\'s ref', () => {
    const source = read('ui/components/GraphEditor.tsx');
    // Item 16: the open branch as the database names it now (openBranchName,
    // driven in item16-project-branch.test.ts), so a connect rename is followed.
    expect(source).toContain('gitService.fetchFileContent(integration.id, [path], openName ?? undefined)');
  });
});

describe('inspector auto-hydration (owner: "user should not have to click Load from Repo")', () => {
  it('a body-less binding hydrates itself when opened; opening it again is the retry (AB.2: no button)', () => {
    const source = read('ui/components/panels/ArtifactWorkbenchPanel.tsx');
    expect(source).toContain('onLoadFromRepo(id)');
    expect(source).toContain('Open it again to retry.');
    expect(source).not.toContain('Load from repo');
  });
});

// ── Owner 2026-07-30 follow-up: detection latency + locked-accept safety + recovery ──

describe('detection latency (owner: "wait 1 minute or switch branches; refresh does nothing")', () => {
  it('a page load runs the same forced freshness check a branch switch runs', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('initialFreshnessRanRef');
    // Owner spike 2026-08-23: the fallback is the RESOLVED primary branch,
    // never the literal 'main' — the trunk may be renamed at connect.
    expect(source).toContain("checkBranchFreshness(openName || primaryBranchNameRef.current)");
  });

  it('a visible tab background-sweeps every minute (server throttle dedupes)', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('60_000');
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain('refreshPendingGitCount');
  });

  it('the badge toasts when the pending count RISES after first load', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('prevGitCountRef.current !== null && next > prevGitCountRef.current');
    expect(source).toContain('External git change detected');
  });
});

describe('locked-artifact accept never consumes the card (owner: "deletes the change with no ability to go back")', () => {
  it('accept/delete handlers return string|null and refuse locked (complete) artifacts with guidance', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('const handleAcceptGitChange = useCallback((artifactId: string, newContent: string, path: string, sourceCommit?: string): string | null =>');
    expect(source).toContain("artifact?.status === 'complete'");
    expect(source).toContain('is locked (Complete). Unlock it in the Files tab first');
  });

  it('the modal keeps the row and shows the error ON the card when accept fails', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('acceptErrors');
    // failure path returns BEFORE markApplied — the card is not consumed
    expect(source).toContain("setAcceptErrors(prev => ({ ...prev, [changeId]: err }));");
  });

  it('dismiss states its consequence before resolving', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Dismiss keeps YOUR canvas version: your next push will overwrite');
  });
});

describe('push cleanup observability (owner: "delete in canvas → push → file survives in git")', () => {
  it('PushResult carries deletedPaths and the cleanupSkipped reason', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain('deletedPaths?: string[]');
    expect(source).toContain('cleanupSkipped?: string');
  });

  it('the push toast reports removals, and a skipped cleanup surfaces as an explicit error', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Removed ${result.deletedPaths.length} stale file');
    expect(source).toContain('rename/delete cleanup could not run');
  });
});

// ── Owner 2026-07-30: setup UX (repo/branch pickers, header ref label, Commit wording) ──

describe('git setup UX', () => {
  it('GitService browses repos and branches with the setup-time token (both providers)', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain('async listRemoteRepositories(provider: string, accessToken: string, baseUrl?: string)');
    expect(source).toContain('async listRemoteBranches(provider: string, accessToken: string, owner: string, repo: string, baseUrl?: string)');
    expect(source).toContain("'PRIVATE-TOKEN': accessToken");
  });

  it('the setup form is token-first, and selecting still only fills fields (owner 2026-09-21)', () => {
    // The behaviour is driven in src/tests/git-setup-form.test.tsx; these two
    // lines hold the doctrine the rewrite must not lose.
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('the token is the only thing a person types');
    // selecting a repo only FILLS FORM FIELDS — no writes, no baselines (brownfield-safe)
    expect(source).toContain('selecting only fills these fields (no writes, no baselines');
    // manual fallback stays
    expect(source).toContain('placeholder="username or organization"');
  });

  it('the branch chip annotates main with its bound git ref, display-only', () => {
    // V3 1.2 (2026-09-19): the Branches button became a chip; the rule is
    // the same and branch-chip.test.tsx proves it by rendering.
    const chip = read('ui/components/panels/BranchChip.tsx');
    // Owner spike 2026-08-23: primacy reads from the flag; the alias shows
    // only when the (legacy, unrenamed) trunk name differs from its ref.
    expect(chip).toContain("isPrimaryBranch(currentBranch) && gitDefaultBranch && gitDefaultBranch !== currentBranch");
    expect(chip).toContain('→ {mainRefLabel}');
    const ge = read('ui/components/GraphEditor.tsx');
    expect(ge).toContain('setGitDefaultBranch(data?.default_branch ?? null)');
  });

  it('user-facing wording says Commit (the lane creates a commit on the remote)', () => {
    const modal = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(modal).toContain('Commit to Repository');
    expect(modal).toContain('Committed ${result.fileCount} files');
    expect(modal).not.toContain('>Push to Repository<');
    const exportModal = read('ui/components/common/ProjectExportModal.tsx');
    expect(exportModal).toContain("label: 'Commit to Git',");
    // the export card's ACTION button too (owner 2026-07-30: still read "Push")
    expect(exportModal).toContain('Commit\n                        </button>');
    expect(exportModal).not.toContain('Push\n                        </button>');
  });

  it('V3 1.2: the branch header is one chip; the dropdown, its count, create, switch, delete and Merge to Main are gone', () => {
    const chip = read('ui/components/panels/BranchChip.tsx');
    expect(chip).not.toContain('patchCount');
    expect(chip).not.toContain('onClick');
    const tb = read('ui/components/panels/TopBar.tsx');
    for (const gone of ['BranchManager', 'onSwitchBranch', 'onCreateBranch', 'onDeleteBranch', 'onMergeBranch', 'Merge to Main']) {
      expect(tb, gone).not.toContain(gone);
    }
    const ge = read('ui/components/GraphEditor.tsx');
    for (const gone of ['handleCreateBranch', 'handleDeleteBranch', 'handleRequestMerge', 'runMerge', 'mergeDialog']) {
      expect(ge, gone).not.toContain(gone);
    }
  });
});

// ── Dogfood find 2026-09-02 (#4, client half): an unchanged tree mints no commit ──
describe('unchanged-push honesty (server pin: gitops-bench-fixes_test.ts)', () => {
  it('PushResult carries the unchanged flag', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain('unchanged?: boolean');
  });

  it('the toast says "already up to date" instead of claiming a commit', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('if (result.unchanged) {');
    expect(source).toContain('Already up to date — the repository matches your design');
    // the unchanged branch is checked BEFORE the PR-mode success message, so a
    // no-op push in PR mode never renders a commit/PR claim
    expect(source.indexOf('if (result.unchanged) {')).toBeLessThan(
      source.indexOf("result.commitMode === 'pull-request' && result.prUrl"),
    );
  });
});

describe('resolved-change recovery lane (owner: "no ability to go back and pull the standing changes")', () => {
  it('GitService reads recently resolved cards and fetches content at an exact ref', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain('async getResolvedChanges(projectId: string, limit = 6)');
    expect(source).toContain('async fetchFileContent(integrationId: string, paths: string[], branchName?: string, atRef?: string)');
    expect(source).toContain('...(atRef ? { ref: atRef } : {})');
  });

  it('the git panel renders Recently resolved with View-at-commit, and re-accepts NEVER re-resolve the card', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Recently resolved');
    expect(source).toContain('handleViewAtCommit');
    // the recovery lane must not call markApplied (re-resolving would regress the baseline)
    expect(source).toContain('if (change && !resolvedLane) await markApplied(change, [path]);');
  });
});
