// SB-4 scenarios 5–6: the merge-swallow regression (rebase AND squash) and
// R3-6 second-project branch safety. V3 AD.2b: a merge files a load proposal,
// and connect no longer materializes the repository's branches.
import { callFn, github, rest, uid, until, sweepUntil, Scenario } from '../lib.mjs';
import { createProject, connectRepo, RUN_PREFIX } from '../fixtures.mjs';

const sweep = async (env, session, integrationId, branchName = 'main') =>
  (await callFn(env, session, 'git-pull', { integrationId, mode: 'drift-check', branchName, force: true })).data?.sweep;

/** Insert a feature-branch row + snapshot = main's graph + one extra artifact. */
async function addFeatureBranch(env, session, fx, branchName, artifactPath) {
  const db = rest(env);
  const branchId = uid();
  await db.insert('branches', {
    id: branchId, project_id: fx.ids.project, name: branchName, created_by: session.userId,
  });
  const artId = uid();
  const graph = structuredClone(fx.graph);
  graph.artifacts[artId] = {
    id: artId, nodeId: fx.ids.nodeApi, path: artifactPath, kind: 'source',
    content: `// created on ${branchName}\nexport const feature = true;\n`, status: 'draft',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await db.insert('graph_snapshots', {
    id: uid(), project_id: fx.ids.project, branch_id: branchId,
    version: 1, hash: `bench-${branchName}`, patch_sequence: 1, graph_data: graph,
  });
  return { branchId, artId };
}

function makeMergeSwallow(mergeMethod) {
  return {
    name: `merge-swallow-${mergeMethod}`,
    boxes: ['MERGE-SWALLOW REGRESSION TEST', 'R3-3b/R3-3c'],
    async run(env, session) {
      const s = new Scenario(this.name, this.boxes);
      const fx = await createProject(env, session, `swallow-${mergeMethod}`);
      const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
      const setup = await callFn(env, session, 'git-push', {
        projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
      });
      s.check('setup push succeeds', setup.data.success);

      const featureName = `bench-feature-${mergeMethod}`;
      const artifactPath = `src/features/${mergeMethod}.ts`;
      await addFeatureBranch(env, session, fx, featureName, artifactPath);

      const created = await callFn(env, session, 'git-push', {
        projectId: fx.ids.project, branchName: featureName, integrationId,
        action: 'create-branch', fromBranchName: 'main',
      });
      s.check('git ref created for the design branch (R3-3a)', created.data.success && created.data.ref === featureName,
        JSON.stringify(created.data).slice(0, 300));

      // Pin the ref's BASE: create-branch resolves main's head via a live provider
      // read seconds after the sandbox force-reset moved main twice — a stale read
      // would base the ref on the wrong commit and surface much later as an
      // unexplainable "PR has merge conflicts" 405. Named here instead.
      const ghBase = github(env);
      const based = await until(async () => {
        const [f, m] = await Promise.all([ghBase.headSha(featureName), ghBase.headSha('main')]);
        return f && m && f === m ? f : null;
      }, { timeoutMs: 15000, everyMs: 2000 });
      s.check('design ref starts at main HEAD (no stale base)', !!based,
        `feature=${await ghBase.headSha(featureName)} main=${await ghBase.headSha('main')}`);

      const featurePush = await callFn(env, session, 'git-push', {
        projectId: fx.ids.project, branchName: featureName, integrationId,
      });
      s.check('push from the feature branch succeeds', featurePush.data.success, JSON.stringify(featurePush.data).slice(0, 300));

      const pr = await callFn(env, session, 'git-push', {
        projectId: fx.ids.project, branchName: featureName, integrationId,
        action: 'open-pr', targetBranchName: 'main',
      });
      s.check('PR opened with the entity-diff body', pr.data.success && !!pr.data.prNumber, JSON.stringify(pr.data).slice(0, 300));
      if (!pr.data.prNumber) return { s, fx, integrationId };

      const gh = github(env);
      // Mergeability is computed LAZILY: GitHub (re)computes it when the PR is
      // GETted, and a verdict computed against a just-moved base can be a stale
      // mergeable=false — which then makes every merge attempt 405 "has merge
      // conflicts" on a PR with none (the post-ontology-merge run hit exactly
      // this). GET before each attempt to force a fresh computation, and KEEP
      // the last non-200 response + mergeable state: "timeout" without
      // GitHub's actual verdict is undebuggable.
      let lastMergeErr = null;
      const merged = await until(async () => {
        const prState = await gh.call('GET', `${gh.repo}/pulls/${pr.data.prNumber}`);
        const r = await gh.mergePr(pr.data.prNumber, mergeMethod);
        if (r.status !== 200) {
          lastMergeErr = { ...r, mergeable: prState.data?.mergeable, mergeableState: prState.data?.mergeable_state };
          return null;
        }
        return r;
      }, { timeoutMs: 45000, everyMs: 3000 });
      // Detail is evaluated even on PASS — with no failed attempt lastMergeErr
      // is null and JSON.stringify(undefined) returns undefined, not a string.
      s.check(`PR merged on GitHub via ${mergeMethod}`, !!merged, lastMergeErr
        ? `last response: ${lastMergeErr.status} ${JSON.stringify(lastMergeErr.data ?? null).slice(0, 200)} ` +
          `(mergeable=${lastMergeErr.mergeable}, state=${lastMergeErr.mergeableState})`
        : 'no merge attempt failed');

      // THE regression: a rebase/squash merge yields a pure self-push range on
      // main. The old code bare-advanced the baseline without loading — the
      // artifact silently never existed on main, permanently undetectable.
      // V3 AD.2b: the merge is filed as a load proposal a person accepts; the
      // canvas never changes under an open editor, and the last sync waits.
      const [before] = await rest(env).select('branches', `id=eq.${fx.ids.branch}&select=last_synced_commit`);
      const result = await sweepUntil(
        () => sweep(env, session, integrationId, 'main'),
        (r) => r?.status === 'load_proposed' && !!r?.proposalId,
      );
      s.check('sweep files git\'s model as a proposal (load_proposed)',
        result?.status === 'load_proposed' && !!result?.proposalId,
        JSON.stringify(result).slice(0, 300));

      const [proposal] = result?.proposalId
        ? await rest(env).select('ai_proposals', `id=eq.${result.proposalId}&select=status,patches,metadata`)
        : [];
      const binds = (proposal?.patches ?? []).some((e) => e.patch?.type === 'add_artifact' && e.patch?.payload?.path === artifactPath);
      s.check('the merged artifact is IN the proposal (not swallowed)', binds,
        (proposal?.patches ?? []).map((e) => `${e.patch?.type}:${e.patch?.payload?.path ?? e.patch?.payload?.label ?? ''}`).join(', ').slice(0, 300));
      s.check('the proposal is a pending git load for the merged head', proposal?.status === 'pending' &&
        proposal?.metadata?.source === 'git-load' && proposal?.metadata?.loadsModel?.headSha === result?.headSha,
        JSON.stringify(proposal?.metadata ?? {}).slice(0, 300));
      const [after] = await rest(env).select('branches', `id=eq.${fx.ids.branch}&select=last_synced_commit`);
      s.check('the last sync waits for the accept', after?.last_synced_commit === before?.last_synced_commit,
        `before=${before?.last_synced_commit} after=${after?.last_synced_commit}`);
      return { s, fx, integrationId };
    },
  };
}

export const mergeSwallowRebase = makeMergeSwallow('rebase');
export const mergeSwallowSquash = makeMergeSwallow('squash');

export const branchSafety = {
  name: 'branch-safety',
  boxes: ['R3-6 never-push-to-default; AD.2b no detection'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    // Project A seeds the repo with main + one feature branch carrying an anchor.
    const fxA = await createProject(env, session, 'safety-a');
    const { integrationId: intA } = await connectRepo(env, session, callFn, fxA.ids.project);
    const pushA = await callFn(env, session, 'git-push', {
      projectId: fxA.ids.project, branchName: 'main', integrationId: intA, confirmOverwrite: true,
    });
    s.check('project A main push succeeds', pushA.data.success);
    await addFeatureBranch(env, session, fxA, 'bench-detected', 'src/detected.ts');
    const createdA = await callFn(env, session, 'git-push', {
      projectId: fxA.ids.project, branchName: 'bench-detected', integrationId: intA, action: 'create-branch',
    });
    s.check('project A feature ref created', createdA.data.success);
    const pushFeature = await callFn(env, session, 'git-push', {
      projectId: fxA.ids.project, branchName: 'bench-detected', integrationId: intA,
    });
    s.check('project A feature push succeeds (anchor on the ref)', pushFeature.data.success);

    // Project B connects to the SAME repo. V3 AD.2b retired design-branch
    // detection (it wrote snapshots straight from git; 2.2 keeps one design
    // branch): the connect creates no branch from the repository's refs.
    const fxB = await createProject(env, session, 'safety-b');
    const { integrationId: intB, connect } = await connectRepo(env, session, callFn, fxB.ids.project);
    s.check('AD.2b: connect reports no detected branches', connect.branchDetect === undefined,
      JSON.stringify(connect).slice(0, 300));
    const rows = await rest(env).select('branches',
      `project_id=eq.${fxB.ids.project}&name=eq.bench-detected&select=id`);
    s.check('AD.2b: no branch row is materialized from the repository', rows.length === 0, JSON.stringify(rows));

    // THE hazard: an unbound non-main branch must NEVER push to the repo default.
    const gh = github(env);
    const mainBefore = await gh.headSha('main');
    const db = rest(env);
    const freshId = uid();
    await db.insert('branches', {
      id: freshId, project_id: fxB.ids.project, name: `${RUN_PREFIX}fresh-slate`, created_by: session.userId,
    });
    await db.insert('graph_snapshots', {
      id: uid(), project_id: fxB.ids.project, branch_id: freshId,
      version: 0, hash: 'fresh', patch_sequence: 0, graph_data: fxB.graph,
    });
    const freshPush = await callFn(env, session, 'git-push', {
      projectId: fxB.ids.project, branchName: `${RUN_PREFIX}fresh-slate`, integrationId: intB,
    });
    s.check('push from the unbound branch succeeds (self-healed ref)', freshPush.data.success,
      JSON.stringify(freshPush.data).slice(0, 300));
    // UAT hardening 2026-09-27: the new ref must carry THIS push's commit, and
    // main's untouched head is checked by history too (a ref read can be stale).
    const newRef = freshPush.data.commitSha
      ? await until(async () => ((await gh.headSha(`${RUN_PREFIX}fresh-slate`)) === freshPush.data.commitSha ? true : null),
        { timeoutMs: 20000, everyMs: 2000 })
      : null;
    s.check('a git ref with the branch name was created, at the pushed commit', !!newRef,
      `pushed ${freshPush.data.commitSha ?? 'none'}`);
    const mainAfter = await gh.headSha('main');
    const pushVsMain = freshPush.data.commitSha ? await gh.compareStatus('main', freshPush.data.commitSha) : null;
    s.check('main HEAD is UNTOUCHED (never the default-ref fallback)',
      // 'identical' or 'behind' would mean the commit is on main; no common
      // history (null) or 'ahead' both mean it is not.
      mainAfter === mainBefore && pushVsMain !== 'identical' && pushVsMain !== 'behind',
      `before=${mainBefore} after=${mainAfter} pushed commit vs main: ${pushVsMain}`);
    const [freshRow] = await db.select('branches', `id=eq.${freshId}&select=git_ref,last_synced_commit`);
    s.check('branch row bound + baselined by the self-heal', freshRow.git_ref === `${RUN_PREFIX}fresh-slate` && !!freshRow.last_synced_commit,
      JSON.stringify(freshRow));
    return { s, fx: fxB, integrationId: intB };
  },
};

export default [mergeSwallowRebase, mergeSwallowSquash, branchSafety];
