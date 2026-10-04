// UX-1.1b (docs/V2_TASKS.md): pull-request commit mode, live against GitHub.
//
//   direct mode (default) pushes exactly as before → flip the integration to
//   'pull-request' → the next push lands on a nodespec/push-* work branch
//   with a real PR opened into main, main's head does NOT move, and the sync
//   baseline does NOT advance (the merge-arrival lane owns that moment) →
//   flip back to direct → pushing advances the baseline again.
//
//   V3 AD.4 (D14, ruling 6): one work branch per tracked branch and one open
//   pull request on it. A second push adds to the open pull request; a squash
//   merge of it is NodeSpec's own writing (no card, the sync check moves
//   forward); the next push starts the work branch again and opens a new one.
import { callFn, rest, github, until, sweepUntil, Scenario } from '../lib.mjs';
import { createProject, connectRepo, bumpArtifactContent } from '../fixtures.mjs';

export const prCommitMode = {
  name: 'pr-commit-mode',
  boxes: [
    'UX-1.1b PR-mode push → work branch + real PR',
    'UX-1.1b main untouched, baseline NOT advanced',
    'UX-1.1b direct mode unchanged after flip-back',
    'DF-4 PR-mode unchanged push opens NO PR',
    'AD.4 one open PR per branch; a squash of it is recognised by blob',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'prmode');
    const db = rest(env);
    const gh = github(env);
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);

    const push1 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push (direct) succeeds', push1.data.success && !push1.data.prUrl);
    // The ref read can serve the PRE-push head for a few seconds after a
    // force-reset (owner bench 2026-09-02: "main a9a2→61a7" where 61a7 WAS
    // the setup commit) — the setup push's own sha is the honest before.
    const mainBefore = (await until(async () =>
      (await gh.headSha('main')) === push1.data.commitSha ? push1.data.commitSha : null,
    { timeoutMs: 30000, everyMs: 2000 })) ?? push1.data.commitSha;
    const [rowBefore] = await db.select('branches',
      `id=eq.${fx.ids.branch}&select=last_synced_commit`);

    await db.update('git_integrations', `id=eq.${integrationId}`, { commit_mode: 'pull-request' });

    // Dogfood #4: an IDENTICAL tree in PR mode mints no commit and opens no PR
    // — there is nothing to review. (Before the unchanged-tree guard this same
    // call opened a PR whose diff was empty.)
    const pushNoop = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('DF-4: PR-mode push of an unchanged tree reports unchanged and opens NO PR',
      pushNoop.data.success && pushNoop.data.unchanged === true &&
      !pushNoop.data.prUrl && pushNoop.data.commitSha === push1.data.commitSha,
      JSON.stringify(pushNoop.data).slice(0, 300));

    // A real change: PR mode carries it on a work branch with a real PR.
    await bumpArtifactContent(env, fx, 'prmode-v2');
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('PR-mode push returns the PR and the work branch',
      push2.data.success && push2.data.commitMode === 'pull-request' &&
      typeof push2.data.prUrl === 'string' && push2.data.prUrl.includes('/') &&
      typeof push2.data.workBranch === 'string' && push2.data.workBranch.startsWith('nodespec/push-'),
      JSON.stringify(push2.data).slice(0, 300));

    const workHead = push2.data.workBranch ? await gh.headSha(push2.data.workBranch) : null;
    s.check('the commit sits on the work branch', workHead === push2.data.commitSha,
      `workHead=${workHead} commitSha=${push2.data.commitSha}`);

    const mainAfter = await gh.headSha('main');
    const [rowAfter] = await db.select('branches',
      `id=eq.${fx.ids.branch}&select=last_synced_commit`);
    // UAT hardening 2026-09-27: the ref read alone can be served stale; the
    // history says whether the PR commit is on main.
    const prOnMain = push2.data.commitSha ? await gh.compareStatus('main', push2.data.commitSha) : null;
    s.check('main head did not move, the PR commit is not on main, and the sync baseline did not advance',
      mainAfter === mainBefore && prOnMain === 'ahead' && rowAfter?.last_synced_commit === rowBefore?.last_synced_commit,
      `main ${mainBefore?.slice(0, 8)}→${mainAfter?.slice(0, 8)} commit vs main: ${prOnMain} baseline ${rowBefore?.last_synced_commit?.slice(0, 8)}→${rowAfter?.last_synced_commit?.slice(0, 8)}`);

    // AD.4: a second push adds a commit to the pull request already open.
    await bumpArtifactContent(env, fx, 'prmode-v2b');
    const push2b = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('AD.4: a second push adds to the open pull request (same number, same work branch)',
      push2b.data.success && push2b.data.prReused === true && push2b.data.prNumber === push2.data.prNumber &&
      push2b.data.workBranch === push2.data.workBranch && push2b.data.commitSha !== push2.data.commitSha,
      JSON.stringify(push2b.data).slice(0, 300));
    const workHead2 = push2b.data.workBranch ? await gh.headSha(push2b.data.workBranch) : null;
    s.check('AD.4: the work branch carries the second commit on top of the first', workHead2 === push2b.data.commitSha,
      `workHead=${workHead2} commitSha=${push2b.data.commitSha}`);

    // AD.4: a squash merge mints a new sha; the sync check knows it by the
    // blobs NodeSpec recorded for that pull request's pushes.
    let lastMergeErr = null;
    const merged = push2.data.prNumber ? await until(async () => {
      const prState = await gh.call('GET', `${gh.repo}/pulls/${push2.data.prNumber}`);
      const r = await gh.mergePr(push2.data.prNumber, 'squash');
      if (r.status !== 200) {
        lastMergeErr = { status: r.status, mergeable: prState.data?.mergeable, state: prState.data?.mergeable_state };
        return null;
      }
      return r;
    }, { timeoutMs: 45000, everyMs: 3000 }) : null;
    s.check('AD.4: the pull request squash-merges on GitHub', !!merged, lastMergeErr ? JSON.stringify(lastMergeErr) : 'merged');
    const sweep = await sweepUntil(
      async () => (await callFn(env, session, 'git-pull', { integrationId, mode: 'drift-check', branchName: 'main', force: true })).data?.sweep,
      (r) => r?.status === 'fast_forwarded' || r?.status === 'drift',
    );
    const pendingCards = await db.select('git_change_events', `project_id=eq.${fx.ids.project}&status=eq.pending&select=id`);
    const mainMerged = await gh.headSha('main');
    const [rowMerged] = await db.select('branches', `id=eq.${fx.ids.branch}&select=last_synced_commit`);
    s.check('AD.4: the squash is NodeSpec\'s own writing: no card, the last sync moves to it',
      sweep?.status === 'fast_forwarded' && pendingCards.length === 0 && rowMerged?.last_synced_commit === mainMerged,
      JSON.stringify({ sweep: sweep?.status, detail: sweep?.detail, cards: pendingCards.length, baseline: rowMerged?.last_synced_commit, main: mainMerged }).slice(0, 300));

    // AD.4: with no pull request open, the next push starts the work branch
    // again at main's head and opens a new one.
    await bumpArtifactContent(env, fx, 'prmode-v2c');
    const push2c = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('AD.4: after the merge the next push opens a new pull request from the same work branch',
      push2c.data.success && push2c.data.prReused !== true && typeof push2c.data.prNumber === 'number' &&
      push2c.data.prNumber !== push2.data.prNumber && push2c.data.workBranch === push2.data.workBranch,
      JSON.stringify(push2c.data).slice(0, 300));

    // Flip back: direct mode must behave exactly as before the feature. A new
    // content bump makes this a REAL commit (an identical tree would be the
    // unchanged lane, asserted above).
    await db.update('git_integrations', `id=eq.${integrationId}`, { commit_mode: 'direct' });
    await bumpArtifactContent(env, fx, 'prmode-v3');
    const push3 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    const [rowFinal] = await db.select('branches',
      `id=eq.${fx.ids.branch}&select=last_synced_commit`);
    s.check('direct mode after the flip-back mints a NEW commit and advances the baseline',
      push3.data.success && !push3.data.prUrl && push3.data.unchanged !== true &&
      push3.data.commitSha !== push1.data.commitSha &&
      rowFinal?.last_synced_commit === push3.data.commitSha,
      JSON.stringify({ sha: push3.data.commitSha, baseline: rowFinal?.last_synced_commit }).slice(0, 200));

    return { s, fx, integrationId };
  },
};

export default [prCommitMode];
