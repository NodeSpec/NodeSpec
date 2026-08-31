// UX-1.1b (docs/V2_TASKS.md): pull-request commit mode, live against GitHub.
//
//   direct mode (default) pushes exactly as before → flip the integration to
//   'pull-request' → the next push lands on a nodespec/push-* work branch
//   with a real PR opened into main, main's head does NOT move, and the sync
//   baseline does NOT advance (the merge-arrival lane owns that moment) →
//   flip back to direct → pushing advances the baseline again.
import { callFn, rest, github, Scenario } from '../lib.mjs';
import { createProject, connectRepo, bumpArtifactContent } from '../fixtures.mjs';

export const prCommitMode = {
  name: 'pr-commit-mode',
  boxes: [
    'UX-1.1b PR-mode push → work branch + real PR',
    'UX-1.1b main untouched, baseline NOT advanced',
    'UX-1.1b direct mode unchanged after flip-back',
    'DF-4 PR-mode unchanged push opens NO PR',
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
    const mainBefore = await gh.headSha('main');
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
    s.check('main head did not move and the sync baseline did not advance',
      mainAfter === mainBefore && rowAfter?.last_synced_commit === rowBefore?.last_synced_commit,
      `main ${mainBefore?.slice(0, 8)}→${mainAfter?.slice(0, 8)} baseline ${rowBefore?.last_synced_commit?.slice(0, 8)}→${rowAfter?.last_synced_commit?.slice(0, 8)}`);

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
