import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GitService, WORK_BRANCH_PREFIX } from '../ui/services/GitService.js';

// V3 AD.4 (D16): NodeSpec's pull request work branches are never offered as
// the branch a project tracks. The server refuses them at save
// (ad4-git-cleanup_test.ts); the connect form never lists them.

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

afterEach(() => { vi.unstubAllGlobals(); });

const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('AD.4a: work branches are not offered at connect', () => {
  it('the app prefix is the server prefix', () => {
    expect(read('supabase/functions/_shared/commit-mode.ts')).toContain(`export const WORK_BRANCH_PREFIX = "${WORK_BRANCH_PREFIX}";`);
  });

  it.each(['github', 'gitlab'])('%s: the branch list leaves out nodespec/push-* and keeps every other branch', async (provider) => {
    const names = ['main', `${WORK_BRANCH_PREFIX}main-k2x9`, 'feature/nodespec-push', 'nodespec/other'];
    vi.stubGlobal('fetch', vi.fn((url: string) => (
      String(url).includes('branches') ? answer(names.map((name) => ({ name }))) : answer({ default_branch: 'main' })
    )));
    const out = await new GitService({} as never).listRemoteBranches(provider, 'tok', 'acme', 'shop');
    expect(out).toEqual({ branches: ['main', 'feature/nodespec-push', 'nodespec/other'], defaultBranch: 'main' });
  });
});

describe('AD.4a: content-fetch is gone from the app', () => {
  it('GitService no longer asks git-pull for it', () => {
    const git = read('src/ui/services/GitService.ts');
    expect(git).not.toContain("'content-fetch'");
    expect(git).not.toContain('async pull(');
  });
});

// A chainable read-only fake: every filter is applied, so a wrong column or
// value reads as nothing.
function fakeSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        order: () => q,
        limit: () => q,
        then: (ok: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
      };
      return q;
    },
  };
}

describe('AD.4b (D15): the primary branch by its flag, never the literal main', () => {
  const card = (id: string, metadata: Record<string, unknown>) => ({
    id, project_id: 'p1', status: 'pending', commit_sha: 'abc1234', commit_message: 'm', author: 'a',
    changed_files: [], created_at: '2026-09-25T00:00:00Z', metadata,
  });

  it('a card from before R3-3c is named after the primary, whatever connect renamed it to', async () => {
    const sb = fakeSupabase({
      branches: [
        { project_id: 'p1', name: 'develop', is_primary: true },
        { project_id: 'p1', name: 'main', is_primary: false },
      ],
      git_change_events: [
        card('legacy', { source: 'sweep' }),
        card('named', { source: 'sweep', branchName: 'develop' }),
        card('unmapped', { source: 'webhook', unmappedRef: 'release/9' }),
      ],
    });
    const out = await new GitService(sb as never).getPendingChanges('p1');
    expect(Object.fromEntries(out.map((c) => [c.id, c.branchName]))).toEqual({
      legacy: 'develop', named: 'develop', unmapped: undefined,
    });
  });

  it('a row from before the flag keeps the legacy naming rule', async () => {
    const sb = fakeSupabase({
      branches: [{ project_id: 'p1', name: 'main', is_primary: null }],
      git_change_events: [card('legacy', { source: 'sweep' })],
    });
    expect((await new GitService(sb as never).getPendingChanges('p1'))[0].branchName).toBe('main');
  });

  it('the app lanes name the open branch or let the server find the primary', () => {
    const ge = read('src/ui/components/GraphEditor.tsx');
    const changes = read('src/ui/components/panels/ChangesPanel.tsx');
    for (const src of [ge, changes]) expect(src).not.toMatch(/\|\| 'main'|\?\? 'main'/);
    expect(read('src/ui/utils/git-auto-sync.ts')).not.toContain("?? 'main'");
    expect(read('src/ui/components/panels/repoActivity.ts')).not.toContain("|| 'main'");
    for (const f of ['src/ui/services/PatchService.ts', 'src/ui/services/SpecificationService.ts', 'src/ui/components/panels/RequirementInspector.tsx']) {
      expect(read(f)).not.toContain("b.name === 'main'");
    }
    expect(read('src/ui/components/panels/TestInspector.tsx')).not.toContain("getByName(projectId, 'main')");
    // A template's one branch is its primary by flag.
    expect(read('src/ui/services/TemplateService.ts')).toContain("branchRepo.create(project.id, 'main', userId, undefined, undefined, true)");
  });
});
