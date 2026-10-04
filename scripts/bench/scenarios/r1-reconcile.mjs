// V3 R.1 (board section R): the agent reconciles what changed outside
// NodeSpec in one read and one write.
//
//   one commit pushed straight to git: it edits a bound file (a new route on
//   the API Service), adds a service directory with a Dockerfile, a manifest
//   and a route, and adds a Redis client →
//   the sync check files the card →
//   get_pending_changes with change_event_id answers the card's reconcile
//   packet: the bound edit's owner, the API Service's contracts and
//   requirements, the new directory, the routes, ioredis naming the Redis
//   catalog entry, what the change is, and a draft of intents citing file
//   and line →
//   resolve_change with the draft files ONE proposal carrying that evidence,
//   the card waits for it, and the new files' bytes come from the commit →
//   the accept, as the app does it: the files read from git at the commit,
//   the proposal merged, proposal-baseline resolves the card and moves the
//   last sync, and the next sync check is clean.
//
// A graph proposal is applied by the app's patch engine, which a headless
// bench cannot mount; r1-reconcile_test.ts applies the same stored patches
// with that engine. The structural signals ride with repository import: the
// bench account must be on Indie or above, as for the import scenarios.
//
// Decision 1: the project's plan decides, for everyone on it. A fresh Free
// account reads a copy of the card on a project it owns without signals,
// and its tool text names none; seated on this project (the bench account's
// plan, when that carries seats) it reads what this project carries, the
// same signals the owner reads, and its tool text names them.
import { callFn, rest, github, mcpCall, mcpCallAs, mcpRpc, sweepUntil, uid, adminCreateUser, adminDeleteUser, signInAs, Scenario, parseMcp } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const sweep = async (env, session, integrationId) =>
  (await callFn(env, session, 'git-pull', { integrationId, mode: 'drift-check', branchName: 'main', force: true })).data?.sweep;


const FILES = {
  'src/api/index.ts': [
    'import express from "express";',
    'export const app = express();',
    'app.get("/health", (_req, res) => res.send("ok"));',
    'export const handler = () => "bench";',
    '',
  ].join('\n'),
  'services/orders/Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "src/index.js"]\n',
  'services/orders/package.json': JSON.stringify({ name: 'orders', dependencies: { express: '^4.19.2', ioredis: '^5.4.1' } }, null, 2) + '\n',
  'services/orders/src/index.ts': [
    'import express from "express";',
    'import Redis from "ioredis";',
    '',
    'const app = express();',
    'const redis = new Redis(process.env.REDIS_URL);',
    '',
    'app.get("/orders", async (_req, res) => {',
    '  res.json(JSON.parse((await redis.get("orders")) ?? "[]"));',
    '});',
    'app.listen(8080);',
    '',
  ].join('\n'),
};

/** One commit carrying every file, the way a developer pushes it. */
async function commitFiles(gh, branch, files, message) {
  const head = await gh.headSha(branch);
  const parent = await gh.call('GET', `${gh.repo}/git/commits/${head}`);
  const tree = await gh.call('POST', `${gh.repo}/git/trees`, {
    base_tree: parent.data.tree.sha,
    tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
  });
  if (tree.status !== 201) throw new Error(`tree → ${tree.status}: ${JSON.stringify(tree.data).slice(0, 200)}`);
  const commit = await gh.call('POST', `${gh.repo}/git/commits`, { message, tree: tree.data.sha, parents: [head] });
  if (commit.status !== 201) throw new Error(`commit → ${commit.status}`);
  const ref = await gh.call('PATCH', `${gh.repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.data.sha });
  if (ref.status !== 200) throw new Error(`ref → ${ref.status}`);
  return commit.data.sha;
}

export const r1Reconcile = {
  name: 'r1-reconcile',
  boxes: ['R.1 one read: the reconcile packet', 'R.1 structural signals with file and line', 'R.1 task-doc freshness, read without a write', 'R.1 a Free project reads the packet without signals', 'R.1 one write: one proposal with evidence', 'R.1 the accept resolves the card'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'r1reconcile');
    const db = rest(env);
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    // The API Service's task doc is generator-managed with a fingerprint the
    // graph no longer matches, so the packet's freshness check has a real
    // answer to give. Pushes never write the snapshot, so it stays so.
    const [snap] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    snap.graph_data.artifacts[fx.ids.taskArtifact].metadata = { taskContextFingerprint: { fingerprint: 'bench-stale' } };
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snap.graph_data });
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success, JSON.stringify(push.data).slice(0, 200));

    const gh = github(env);
    const head = await commitFiles(gh, 'main', FILES, 'feat: orders service with a Redis cache; API health route');
    const swept = await sweepUntil(() => sweep(env, session, integrationId), (r) => r?.status === 'drift' && r?.headSha === head);
    s.check('the sync check files the commit as a card', swept?.status === 'drift' && !!swept?.eventId, JSON.stringify(swept).slice(0, 300));
    const cardId = swept?.eventId;

    // ONE read.
    const read = parseMcp(await mcpCall(env, 'get_pending_changes', { project_id: fx.ids.project, change_event_id: cardId }));
    const p = read?.reconcile;
    s.check('the packet answers the card', p?.changeEventId === cardId && read?.change?.commitSha === head, JSON.stringify(read).slice(0, 300));
    const api = p?.nodes?.find((n) => n.nodeId === fx.ids.nodeApi);
    s.check('the bound edit names its owner by binding',
      p?.files?.some((f) => f.path === 'src/api/index.ts' && f.owner?.nodeId === fx.ids.nodeApi && f.owner?.via === 'binding'),
      JSON.stringify(p?.files ?? []).slice(0, 400));
    s.check('the touched node carries its contracts and requirements',
      api?.contracts?.out?.some((c) => c.counterpart?.nodeId === fx.ids.nodeDb) && (api?.requirements?.length ?? 0) === 2,
      JSON.stringify(api ?? {}).slice(0, 400));
    s.check('the task doc reads stale: the fingerprint was computed live and moved',
      api?.taskDoc?.path === '.nodespec/tasks/api-service.task.md' && api?.taskDoc?.state === 'stale',
      JSON.stringify(api?.taskDoc ?? null));
    const [snapAfter] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=graph_data`);
    const docAfter = snapAfter?.graph_data?.artifacts?.[fx.ids.taskArtifact];
    s.check('the freshness check wrote nothing (the doc and its fingerprint are as seeded)',
      docAfter?.metadata?.taskContextFingerprint?.fingerprint === 'bench-stale' && docAfter?.content === snap.graph_data.artifacts[fx.ids.taskArtifact].content,
      JSON.stringify(docAfter?.metadata ?? {}).slice(0, 200));

    const sig = p?.signals;
    s.check('structural signals are available (the bench account is on Indie or above)', sig?.available === true, JSON.stringify(sig ?? {}).slice(0, 200));
    s.check('the new service directory is named with its Dockerfile and manifest',
      sig?.newDirectories?.some((d) => d.dir === 'services/orders' && d.manifests.includes('services/orders/Dockerfile') && d.manifests.includes('services/orders/package.json')),
      JSON.stringify(sig?.newDirectories ?? []).slice(0, 300));
    s.check('both routes are read with their file and line',
      sig?.routes?.added?.some((r) => r.route === '/orders' && r.path === 'services/orders/src/index.ts' && r.line === 7) &&
      sig?.routes?.added?.some((r) => r.route === '/health' && r.path === 'src/api/index.ts' && r.nodeId === fx.ids.nodeApi),
      JSON.stringify(sig?.routes ?? {}).slice(0, 300));
    s.check('the Redis client names the catalog entry',
      sig?.dependencies?.added?.some((d) => d.name === 'ioredis' && d.catalog?.id === 'redis') &&
      sig?.clients?.some((c) => c.name === 'ioredis' && c.catalog?.id === 'redis'),
      JSON.stringify(sig?.dependencies ?? {}).slice(0, 300));
    s.check('the change reads as structural', p?.classification?.includes('structural'), JSON.stringify(p?.classification));

    // Decision 1, with a fresh account on Free.
    // list_api_keys answers a signed-in session only, so the plan is read as the person.
    const ownerTier = parseMcp(await mcpCallAs(env, { accessToken: session.accessToken }, 'list_api_keys', {}))?.connections?.tier;
    if (!ownerTier) s.check('the bench account\'s plan reads through list_api_keys', false, 'no connections.tier in the answer');
    const carriesSeats = ['team', 'enterprise', 'government'].includes(ownerTier);
    const email = `bench-r1free-${Date.now()}@nodespec.test`;
    const password = `Bench-${uid()}`;
    const freeId = await adminCreateUser(env, email, password);
    let freeFx = null;
    try {
      const free = { accessToken: (await signInAs(env, email, password)).accessToken };
      const tier = parseMcp(await mcpCallAs(env, free, 'list_api_keys', {}))?.connections?.tier;
      if (tier === 'community') {
        const toolText = async () => (await mcpRpc(env, free, 'tools/list', {})).data?.result?.tools
          ?.find((t) => t.name === 'get_pending_changes')?.description ?? '';
        const own = await toolText();
        s.check('on Free the tool text offers the packet and names no signals or index',
          own.includes('reconcile packet') && !own.includes('structural signals') && !own.includes('repository index'),
          own.slice(0, 300));

        // The same card on a project the Free account owns: its plan is Free.
        freeFx = await createProject(env, { userId: freeId }, 'r1free');
        const [card] = await db.select('git_change_events', `id=eq.${cardId}&select=*`);
        const [copy] = await db.insert('git_change_events', [{ ...card, id: uid(), project_id: freeFx.ids.project, created_at: undefined }]);
        const freeRead = parseMcp(await mcpCallAs(env, free, 'get_pending_changes', { project_id: freeFx.ids.project, change_event_id: copy.id }));
        const fp = freeRead?.reconcile;
        s.check('on a Free project the same card reads with signals: { available: false } and no drafted structure',
          JSON.stringify(fp?.signals) === '{"available":false}' && fp?.files?.length === p?.files?.length &&
          !(fp?.draft?.intents ?? []).some((i) => i.kind === 'add_node' || i.kind === 'connect_nodes'),
          JSON.stringify(fp ?? freeRead).slice(0, 300));

        // Seated on this project: what the project carries, not what the person pays for.
        await db.insert('project_members', [{ project_id: fx.ids.project, user_id: freeId, role: 'viewer', invited_by: session.userId, clearance: [] }]);
        const seatRead = parseMcp(await mcpCallAs(env, free, 'get_pending_changes', { project_id: fx.ids.project, change_event_id: cardId }));
        if (carriesSeats) {
          const sp = seatRead?.reconcile;
          const dirs = (x) => JSON.stringify((x?.signals?.newDirectories ?? []).map((d) => d.dir));
          s.check(`seated on this ${ownerTier} project the Free account reads the signals the owner reads, and the drafted structure`,
            sp?.signals?.available === true && dirs(sp) === dirs(p) &&
            (sp?.draft?.intents ?? []).some((i) => i.kind === 'add_node'),
            JSON.stringify(sp ?? seatRead).slice(0, 300));
          const seated = await toolText();
          s.check('seated on a project whose plan carries the signals, the tool text names them',
            seated.includes('structural signals'), seated.slice(0, 300));
        } else {
          s.check(`on ${ownerTier} a seat reaches nothing: the Free account is told the project is not found`,
            seatRead?.success === false || /not found/i.test(JSON.stringify(seatRead)), JSON.stringify(seatRead).slice(0, 200));
        }
      } else if (typeof tier !== 'string') {
        // UAT hardening 2026-09-27: an unanswered read is not a plan.
        s.check('a fresh account\'s plan reads through list_api_keys', false, 'no connections.tier in the answer');
      } else {
        s.skip('the Free account\'s reconcile read', `a fresh account is on ${tier} on this stack, not Free; covered offline in r1-reconcile_test.ts and d1-project-plan_test.ts`);
      }
    } finally {
      if (freeFx) await db.delete('projects', `id=eq.${freeFx.ids.project}`).catch(() => {});
      await adminDeleteUser(env, freeId);
    }

    const intents = p?.draft?.intents ?? [];
    const kinds = intents.map((i) => `${i.kind}${i.ref ? `:${i.ref}` : ''}`);
    s.check('the draft adds the service and Redis, binds the files and connects them',
      kinds.includes('add_node:orders') && kinds.includes('add_node:redis') &&
      intents.filter((i) => i.kind === 'bind_file' && i.nodeId === '@orders').length === 3 &&
      intents.some((i) => i.kind === 'connect_nodes' && i.source === '@orders' && i.target === '@redis'),
      JSON.stringify(kinds));
    s.check('every structural intent cites a file and line',
      intents.filter((i) => i.kind !== 'bind_file').every((i) => i.evidence?.some((e) => e.path && e.line)),
      JSON.stringify(intents.map((i) => i.evidence)).slice(0, 400));

    // ONE write.
    const wrote = parseMcp(await mcpCall(env, 'resolve_change', {
      change_event_id: cardId, commit_sha: head, resolution: 'accepted', intents,
    }));
    s.check('resolve_change files the draft as one proposal and the card waits for it',
      wrote?.resolution === 'pending' && !!wrote?.proposalId, JSON.stringify(wrote).slice(0, 300));
    const [proposal] = wrote?.proposalId
      ? await db.select('ai_proposals', `id=eq.${wrote.proposalId}&select=id,status,patches,metadata`)
      : [];
    const patches = (proposal?.patches ?? []).map((x) => x.patch);
    s.check('the proposal carries the nodes, the edge and the bindings',
      patches.filter((x) => x.type === 'add_node').length === 2 && patches.some((x) => x.type === 'add_edge') &&
      patches.filter((x) => x.type === 'add_artifact').length === 3,
      JSON.stringify(patches.map((x) => x.type)));
    s.check('the new files are pulled from the card\'s commit when the user accepts',
      patches.filter((x) => x.type === 'add_artifact').every((x) => x.payload?.metadata?.contentSource?.ref === head),
      JSON.stringify(patches.filter((x) => x.type === 'add_artifact').map((x) => x.payload?.metadata)).slice(0, 300));
    s.check('the reviewer sees each intent with its evidence',
      (proposal?.metadata?.intents ?? []).filter((i) => i.kind !== 'bind_file').every((i) => (i.evidence ?? []).length > 0) &&
      (proposal?.patches ?? []).every((x) => String(x.explanation).includes('(evidence: ')),
      JSON.stringify(proposal?.metadata?.intents ?? []).slice(0, 400));
    const [card] = await db.select('git_change_events', `id=eq.${cardId}&select=status,metadata`);
    s.check('the card stays pending on its proposal', card?.status === 'pending' && card?.metadata?.reconcileProposalId === wrote?.proposalId,
      JSON.stringify(card ?? {}).slice(0, 200));

    // The accept, as the app runs it: pull the bound files at the commit,
    // apply (the app's patch engine), mark the proposal merged, then
    // proposal-baseline answers the card.
    const boundPaths = patches.filter((x) => x.type === 'add_artifact').map((x) => x.payload?.path);
    const fetched = await callFn(env, session, 'git-pull', { integrationId, mode: 'selective-fetch', paths: boundPaths, ref: head, maxContentLength: 500000 });
    const got = fetched.data?.files ?? [];
    s.check('at accept the bound files are read from the card\'s commit, byte for byte',
      boundPaths.length === 3 && boundPaths.every((path) => got.find((f) => f.path === path)?.content === FILES[path]),
      JSON.stringify(got.map((f) => f.path)));
    if (wrote?.proposalId) await db.update('ai_proposals', `id=eq.${wrote.proposalId}`, { status: 'merged' });
    const settled = await callFn(env, session, 'git-pull', { integrationId, mode: 'proposal-baseline', proposalId: wrote?.proposalId });
    const [resolved] = await db.select('git_change_events', `id=eq.${cardId}&select=status,metadata`);
    const [branchRow] = await db.select('branches', `id=eq.${fx.ids.branch}&select=last_synced_commit`);
    s.check('the accepted proposal resolves the card and moves the last sync to the commit',
      settled.data?.success === true && resolved?.status === 'accepted' &&
      resolved?.metadata?.reconciledByProposal === wrote?.proposalId && branchRow?.last_synced_commit === head,
      JSON.stringify({ settled: settled.data, status: resolved?.status, baseline: branchRow?.last_synced_commit }).slice(0, 300));
    const after = await sweep(env, session, integrationId);
    s.check('nothing is left to review: the next sync check is clean', after?.status === 'clean' && after?.headSha === head, JSON.stringify(after).slice(0, 200));
    return { s, fx, integrationId };
  },
};

export default [r1Reconcile];
