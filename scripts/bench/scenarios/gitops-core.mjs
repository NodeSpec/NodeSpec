// SB-4 scenarios 1–4: connect/baseline · push format · legacy-anchor compat ·
// out-of-band detection.
import { createHash } from 'node:crypto';
import { callFn, github, rest, until, sweepUntil, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const sweep = async (env, session, integrationId, branchName = 'main') =>
  (await callFn(env, session, 'git-pull', { integrationId, mode: 'drift-check', branchName, force: true })).data?.sweep;

const pendingCards = (env, projectId) =>
  rest(env).select('git_change_events', `project_id=eq.${projectId}&status=eq.pending&select=id,metadata,commit_sha`);

export const connectBaseline = {
  name: 'connect-baseline',
  boxes: ['R2.2 reconnect no-op', 'R3-3d default-branch honesty'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'connect');
    const { integrationId, connect } = await connectRepo(env, session, callFn, fx.ids.project);
    s.check('connect returns an integration', !!integrationId, JSON.stringify(connect).slice(0, 300));
    // Owner spike 2026-08-23: connect reports the primary-branch outcome —
    // here the trunk is already named after the sandbox default ('main'),
    // so the rename is an explicit no-op, never a silent one.
    // connectRepo hands back the response BODY (connect = data), so the
    // report lives at connect.primaryBranch — caught live 2026-08-23 when
    // this pin read a level too deep and printed null.
    s.check('connect reports the primary branch (aligned name, no rename needed)',
      connect?.primaryBranch?.name === 'main' &&
      connect?.primaryBranch?.renamed === false &&
      typeof connect?.primaryBranch?.renameReason === 'string',
      JSON.stringify(connect?.primaryBranch ?? null));

    // First push establishes the baseline; the reconnect after it must be a no-op.
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('initial push succeeds', push.status === 200 && push.data.success, JSON.stringify(push.data).slice(0, 300));

    // The reconnect's anchor read can hit the stale-contents window right after
    // the initial push (reads as "no anchor found" — now NAMED server-side).
    // Reconnect is an idempotent no-op, so retry until the anchor is seen.
    let re = await connectRepo(env, session, callFn, fx.ids.project);
    for (let i = 0; i < 5 && !re.connect.anchorAdopt?.detected; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      re = await connectRepo(env, session, callFn, fx.ids.project);
    }
    const skipped = re.connect.anchorAdopt?.skipped ?? '';
    s.check('reconnect re-establishes the baseline silently (no card, no proposal)',
      !re.connect.anchorAdopt?.mismatchCardId && !re.connect.anchorAdopt?.proposalId,
      JSON.stringify(re.connect.anchorAdopt).slice(0, 300));
    s.check('reconnect names its outcome (observability)', typeof skipped === 'string' && skipped.length > 0, skipped);

    const cards = await pendingCards(env, fx.ids.project);
    s.check('no phantom card after reconnect', cards.length === 0, JSON.stringify(cards).slice(0, 200));
    return { s, fx, integrationId };
  },
};

export const pushFormat = {
  name: 'push-format',
  boxes: ['R7a 1–3', 'R7d 1', 'PUSH CLEANUP metadata'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'pushfmt');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('push succeeds', push.status === 200 && push.data.success, JSON.stringify(push.data).slice(0, 400));
    s.check('response reports specAnchored', push.data.specAnchored === true, JSON.stringify(push.data).slice(0, 200));

    const gh = github(env);
    // Read-after-own-push → poll: the contents API stays stale for a few
    // seconds after resetSandbox's force-push (see getFileEventually).
    const model = await gh.getFileEventually('.nodespec/model.json', 'main');
    s.check('model.json exists in the commit', !!model);
    if (model) {
      s.check('R7d: model.json is architecture-only (no "mappings", no REQ ids)',
        !model.content.includes('"mappings"') && !model.content.includes('REQ-'), model.content.slice(0, 300));
    }
    const spec = await gh.getFileEventually('.nodespec/spec.json', 'main');
    s.check('spec.json exists in the commit', !!spec);
    if (spec) {
      const parsed = JSON.parse(spec.content);
      s.check('spec.json carries the requirements', parsed.requirements?.length === 2, spec.content.slice(0, 300));
      s.check('spec.json carries the mappings', parsed.mappings?.length >= 1);
      s.check('R7a: no evidence state in spec.json (no "met")', !spec.content.includes('"met"'));
    }
    const commitMsg = (await gh.call('GET', `${gh.repo}/commits/${push.data.commitSha}`)).data?.commit?.message ?? '';
    s.check('commit message carries the self-push prefix', commitMsg.startsWith('Update from NodeSpec:'), commitMsg);

    const [branchRow] = await rest(env).select('branches', `id=eq.${fx.ids.branch}&select=last_synced_commit,git_ref`);
    s.check('baseline advanced to the pushed commit', branchRow.last_synced_commit === push.data.commitSha,
      JSON.stringify(branchRow));
    return { s, fx, integrationId };
  },
};

export const legacyAnchorCompat = {
  name: 'legacy-anchor-compat',
  boxes: ['R7d 2–3 (no spurious card on pre-R7d repos)'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'legacy');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // Rebuild the PRE-R7d file format from the current anchor: same architecture
    // + a mappings section, hash computed over content INCLUDING mappings (the
    // old rule). Commit it out-of-band. The sweep must read CLEAN — the
    // coreModelHash shim compares architecture-only across formats.
    const gh = github(env);
    const anchorFile = await gh.getFileEventually('.nodespec/model.json', 'main');
    if (!anchorFile) throw new Error('model.json never appeared on main after the setup push');
    const current = JSON.parse(anchorFile.content);
    const legacyContent = {
      nodes: current.nodes, edges: current.edges, contracts: current.contracts,
      artifacts: current.artifacts,
      mappings: [{ requirementId: 'REQ-001', nodeIds: [fx.ids.nodeApi] }],
    };
    const legacyHash = createHash('sha256').update(JSON.stringify(legacyContent)).digest('hex');
    const legacyJson = JSON.stringify(
      { modelVersion: 1, generatedBy: 'nodespec', modelHash: legacyHash, ...legacyContent }, null, 2,
    ) + '\n';
    await gh.putFile('.nodespec/model.json', 'main', legacyJson, 'chore: hand-rolled legacy anchor (bench)');

    const result = await sweepUntil(() => sweep(env, session, integrationId), (r) => r?.status === 'fast_forwarded');
    s.check('legacy-format anchor sweeps clean (fast-forward, NO card)',
      result?.status === 'fast_forwarded', JSON.stringify(result).slice(0, 300));
    const cards = await pendingCards(env, fx.ids.project);
    s.check('no pending card raised', cards.length === 0, JSON.stringify(cards).slice(0, 200));
    return { s, fx, integrationId };
  },
};

export const outOfBandDetect = {
  name: 'out-of-band-detect',
  boxes: ['R2 Test B', 'R3-2 modelDiff', 'R3-3c branchName on cards'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'oob');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    const gh = github(env);
    await gh.putFile('src/api/index.ts', 'main',
      'export const handler = () => "edited out of band";\n', 'fix: hand-edited the handler');

    const result = await sweepUntil(() => sweep(env, session, integrationId), (r) => r?.status === 'drift');
    s.check('sweep reports drift', result?.status === 'drift', JSON.stringify(result).slice(0, 300));

    const cards = await until(async () => {
      const rows = await pendingCards(env, fx.ids.project);
      return rows.length > 0 ? rows : null;
    });
    s.check('a pending card exists', !!cards, 'no card within timeout');
    if (cards) {
      const meta = cards[0].metadata ?? {};
      const match = (meta.artifactMatches ?? [])[0];
      s.check('card matches the bound artifact', match?.path === 'src/api/index.ts', JSON.stringify(meta).slice(0, 300));
      s.check('card carries its branchName (R3-3c)', meta.branchName === 'main');
      s.check('card is attributed to a node', !!match?.nodeId && !!match?.nodeName);
    }
    return { s, fx, integrationId };
  },
};

export default [connectBaseline, pushFormat, legacyAnchorCompat, outOfBandDetect];
