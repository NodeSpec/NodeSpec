// B1/B3 edge lanes (docs/WORK_LOOP_PLAN.md) — the refusal paths, live.
//
// direct-commit-sync proves the happy path (declare → resolve → bind → clear)
// and one RESOLVE-time flag (unknown-node — which parses fine and therefore
// does not block the push-side rewrite). This scenario proves the lanes that
// only PARSE-time flags and stale declarations reach:
//
//   · a `kind: "task"` declaration is refused (the evidence-fabrication
//     vector: task-kind artifacts feed the R5/A4 checkbox parsers, so a
//     declaration must never mint one) and a `.nodespec/` path is refused
//     (NodeSpec's generated files are bound by the generator, not by hand) —
//     both surface as parse flags ON THE CARD;
//   · while ANY parse flag exists, git-push must NOT rewrite bindings.json —
//     rewriting from the parsed rows would silently delete the malformed row
//     before its author ever saw the flag. Byte-for-byte unchanged.
//   · a stale declaration for a path the graph ALREADY binds reports as
//     alreadyBound (the hand-off is done), and once the manifest is clean it
//     is consumed by the next push — the file self-heals to the empty
//     envelope.
import { callFn, rest, github, postSignedWebhook, uid, until, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const BINDINGS = '.nodespec/bindings.json';
// Bound by the fixture graph (createProject binds it to the API Service node).
const BOUND_PATH = 'src/api/index.ts';

export const bindingsEdgeCases = {
  name: 'bindings-edge-cases',
  boxes: [
    'B1 refusal lanes live (task-kind + reserved-path flagged)',
    'B3 flagged-skip (push never rewrites over a parse flag)',
    'B3 alreadyBound self-clean',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'bindedge');
    const db = rest(env);
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // OOB: a manifest that mixes one stale-but-valid row with two rows the
    // parser must refuse. The exact string matters — assert 2 is byte-for-byte.
    const gh = github(env);
    const dirtyManifest = JSON.stringify({
      version: 1,
      bindings: [
        { path: BOUND_PATH, node: 'API Service', kind: 'source' },
        { path: 'docs/fake-evidence.task.md', node: 'API Service', kind: 'task' },
        { path: '.nodespec/model.json', node: 'API Service', kind: 'source' },
      ],
    }, null, 2);
    await gh.putFile(BINDINGS, 'main', dirtyManifest, 'chore: declarations (two invalid)');
    const served = await until(async () => {
      const f = await gh.getFile(BINDINGS, 'main');
      return f?.content === dirtyManifest ? true : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    s.check('provider serves the dirty manifest before the webhook fires', !!served);

    const secret = `bench-secret-${uid().slice(0, 8)}`;
    await db.update('git_integrations', `id=eq.${integrationId}`, { webhook_secret: secret });
    const head = await gh.headSha('main');
    const hook = await postSignedWebhook(env, integrationId, secret, {
      ref: 'refs/heads/main', after: head,
      head_commit: {
        id: head, message: 'chore: declarations (two invalid)',
        author: { username: 'bench' }, added: [], modified: [BINDINGS],
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
    s.check('bindings-only push still carries bindingResolution', !!resolution,
      JSON.stringify(card?.metadata ?? {}).slice(0, 400));
    s.check('task-kind declaration is FLAGGED (evidence-fabrication refusal, live)',
      resolution?.flagged?.some((f) => f.reason === 'invalid-kind'),
      JSON.stringify(resolution?.flagged ?? []).slice(0, 300));
    s.check('.nodespec/ declaration is FLAGGED (reserved-path refusal, live)',
      resolution?.flagged?.some((f) => f.reason === 'reserved-path'));
    s.check('stale declaration for a bound path reports alreadyBound, never re-binds',
      resolution?.bind?.length === 0 &&
      resolution?.alreadyBound?.some((b) => b.path === BOUND_PATH),
      JSON.stringify({ bind: resolution?.bind, alreadyBound: resolution?.alreadyBound }).slice(0, 300));

    // Resolve the card so the next push is not blocked by pending drift.
    await db.update('git_change_events', `id=eq.${card.id}`,
      { status: 'accepted', resolved_at: new Date().toISOString() });

    // Push while the manifest carries parse flags: the rewrite must be
    // skipped even though the alreadyBound entry is consumed-eligible.
    // Fetching at the pushed commit's exact sha makes the assert race-free
    // (no stale-contents-API ambiguity about "unchanged").
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('push over a flagged manifest succeeds', push2.data.success,
      JSON.stringify(push2.data).slice(0, 200));
    const atPush2 = await gh.getFile(BINDINGS, push2.data.commitSha);
    s.check('flagged manifest is byte-for-byte UNTOUCHED by the push',
      atPush2?.content === dirtyManifest,
      (atPush2?.content ?? '(absent)').slice(0, 300));

    // Author fixes the manifest: only the stale-but-valid row remains. No
    // parse flags now, its path is bound in the pushed graph → consumed, and
    // the file self-heals to the documented empty envelope.
    const cleanManifest = JSON.stringify({
      version: 1,
      bindings: [{ path: BOUND_PATH, node: 'API Service', kind: 'source' }],
    }, null, 2);
    await gh.putFile(BINDINGS, 'main', cleanManifest, 'chore: remove invalid declarations');
    await until(async () => {
      const f = await gh.getFile(BINDINGS, 'main');
      return f?.content === cleanManifest ? true : null;
    }, { timeoutMs: 30000, everyMs: 2000 });

    const push3 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('push over the clean manifest succeeds', push3.data.success,
      JSON.stringify(push3.data).slice(0, 200));
    const atPush3 = await gh.getFile(BINDINGS, push3.data.commitSha);
    let healed = null;
    try { healed = JSON.parse(atPush3?.content ?? ''); } catch { /* checked below */ }
    s.check('consumed alreadyBound entry cleared — file is the empty envelope',
      healed?.bindings?.length === 0 && healed?.version === 1 && typeof healed?.note === 'string',
      (atPush3?.content ?? '(absent)').slice(0, 300));

    return { s, fx, integrationId };
  },
};

export default [bindingsEdgeCases];
