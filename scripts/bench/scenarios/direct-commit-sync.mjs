// B3 (docs/WORK_LOOP_PLAN.md): direct-commit sync, the SERVER halves, live.
//
//   an OOB commit adds a new file + declares it in .nodespec/bindings.json →
//   the webhook card carries bindingResolution (resolved bind for the
//   declared file, flag for a declaration naming no real node) →
//   get_pending_changes projects it → after the binding lands in the graph
//   (the bench emulates the client apply by writing the snapshot, exactly
//   what the patch pipeline persists) → git-push CLEARS the consumed entry
//   from bindings.json while the unresolved entry SURVIVES — bind-then-clear
//   proven against real GitHub.
//
// The client driver itself (auto-bind + auto-accept + card resolve) is a
// browser hook and is pinned by src/tests/git-auto-sync.test.ts — a headless
// bench cannot mount React. What this scenario proves is every contract that
// driver depends on, server-side, end to end.
import { callFn, rest, github, postSignedWebhook, mcpCall, uid, until, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const NEW_FILE = 'src/notifications.ts';
const BINDINGS = '.nodespec/bindings.json';

const parseMcp = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const directCommitSync = {
  name: 'direct-commit-sync',
  boxes: ['B1 declaration contract live', 'B3 card bindingResolution', 'B3 MCP projection', 'B3 push bind-then-clear'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'directsync');
    const db = rest(env);
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // OOB: the AI writes a new file and declares it — plus one declaration
    // naming a node that does not exist (must flag, never bind).
    const gh = github(env);
    await gh.putFile(NEW_FILE, 'main', 'export const notify = () => "hi";\n', 'feat: notifications helper');
    await gh.putFile(BINDINGS, 'main', JSON.stringify({
      version: 1,
      bindings: [
        { path: NEW_FILE, node: 'API Service', kind: 'source', language: 'typescript' },
        { path: 'src/phantom.ts', node: 'No Such Component', kind: 'source' },
      ],
    }, null, 2), 'chore: declare new files');

    const served = await until(async () => {
      const f = await gh.getFile(BINDINGS, 'main');
      return f?.content.includes(NEW_FILE) ? true : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    s.check('provider serves the declaration before the webhook fires', !!served);

    const secret = `bench-secret-${uid().slice(0, 8)}`;
    await db.update('git_integrations', `id=eq.${integrationId}`, { webhook_secret: secret });
    const head = await gh.headSha('main');
    const hook = await postSignedWebhook(env, integrationId, secret, {
      ref: 'refs/heads/main', after: head,
      head_commit: {
        id: head, message: 'feat: notifications helper + declarations',
        author: { username: 'bench' }, added: [NEW_FILE], modified: [BINDINGS],
      },
    });
    s.check('webhook accepted', hook.status === 200, `status=${hook.status}`);

    const cards = await until(async () => {
      const rows = await db.select('git_change_events',
        `project_id=eq.${fx.ids.project}&status=eq.pending&select=id,metadata`);
      return rows.length > 0 ? rows : null;
    });
    const card = cards?.[0];
    const resolution = card?.metadata?.bindingResolution;
    s.check('card carries bindingResolution', !!resolution, JSON.stringify(card?.metadata ?? {}).slice(0, 400));
    s.check('declared file resolves to the API Service node',
      resolution?.bind?.length === 1 &&
      resolution.bind[0].path === NEW_FILE &&
      resolution.bind[0].nodeId === fx.ids.nodeApi,
      JSON.stringify(resolution?.bind ?? []).slice(0, 300));
    s.check('unknown-node declaration is FLAGGED, never bound',
      resolution?.flagged?.some((f) => f.reason === 'unknown-node'),
      JSON.stringify(resolution?.flagged ?? []).slice(0, 200));
    s.check('the new file still counts as residue until bound (card keeps the question)',
      (card?.metadata?.residuePaths ?? []).includes(NEW_FILE));

    // A5 parity: the AI sees the declarations.
    const pending = parseMcp(await mcpCall(env, 'get_pending_changes', { project_id: fx.ids.project }));
    const projected = pending?.pendingChanges?.find((c) => c.changeEventId === card?.id);
    s.check('get_pending_changes projects bindingResolution',
      !!projected?.bindingResolution?.bind?.length, JSON.stringify(projected ?? {}).slice(0, 300));

    // Emulate the client apply (what the patch pipeline persists): the
    // binding lands in the graph. The bench writes the snapshot the way the
    // editor's save does.
    const [snapshot] = await db.select('graph_snapshots',
      `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    const artifactId = uid();
    snapshot.graph_data.artifacts[artifactId] = {
      id: artifactId, nodeId: fx.ids.nodeApi, path: NEW_FILE, kind: 'source',
      status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    snapshot.graph_data.nodes[fx.ids.nodeApi].artifacts =
      [...(snapshot.graph_data.nodes[fx.ids.nodeApi].artifacts ?? []), artifactId];
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snapshot.graph_data });
    // Resolve the card so the second push is not blocked by pending drift.
    await db.update('git_change_events', `id=eq.${card.id}`,
      { status: 'accepted', resolved_at: new Date().toISOString() });

    // Push again: the consumed declaration must leave the file; the
    // unresolved one must SURVIVE (bind-then-clear, live).
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('second push succeeds', push2.data.success, JSON.stringify(push2.data).slice(0, 200));

    const after = await until(async () => {
      const f = await gh.getFile(BINDINGS, 'main');
      return f && !f.content.includes(NEW_FILE) ? f : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    s.check('consumed declaration cleared from bindings.json', !!after,
      'the bound path never left the declaration file');
    if (after) {
      const doc = JSON.parse(after.content);
      s.check('unresolved declaration SURVIVES the clear (bind-then-clear)',
        doc.bindings.some((b) => b.path === 'src/phantom.ts') &&
        !doc.bindings.some((b) => b.path === NEW_FILE),
        after.content.slice(0, 300));
    }
    return { s, fx, integrationId };
  },
};

export default [directCommitSync];
