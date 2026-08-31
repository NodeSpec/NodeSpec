// A6 (docs/WORK_LOOP_PLAN.md): the work-loop tick round-trip, live.
//
// Proves rails A1–A5 against the real local stack in one flow:
//   anchored task doc pushed → an OOB commit ticks a T-task AND a MANUAL
//   criterion → the WEBHOOK card carries BOTH delta kinds (A3+A4 producers)
//   → get_pending_changes projects them (A5) → resolve_change apply_ticks
//   flips the manual criterion met (the A2 "(manual)" fix, live) AND marks
//   the task done in task_items (A1) with git provenance → a re-resolve is
//   refused (the card is resolved; stamp guards are Deno-pinned).
//
// This scenario specializes ITS OWN project instance (createProject rows are
// per-scenario): it adds a manual criterion to REQ-001 and replaces the
// fixture's hand-authored task doc with an anchored one — the shared fixture
// stays untouched for every other scenario.
import { callFn, rest, github, postSignedWebhook, mcpCall, uid, until, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

// Mirror of _shared/task-deltas.ts taskAnchorKey (FNV-1a 32-bit, hex8) — the
// bench authors anchors the same way the generator does.
const anchorKey = (title) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const T1_TITLE = 'Scaffold the API Service component.';
const T2_TITLE = 'Verify every acceptance criterion above and tick its box.';
const MANUAL_TEXT = 'operator verifies backups restore';
const DOC_PATH = '.nodespec/tasks/api-service.task.md';

const anchoredDoc = () => [
  '# Task: API Service', '',
  '## Requirements — Your Scope', '',
  '### REQ-001: Store tasks', 'Category: functional | Status: pending', '',
  '**Acceptance criteria — your task boxes:**',
  '- [ ] tasks persist across restarts',
  '- [ ] queries return within 200ms',
  `- [ ] ${MANUAL_TEXT} (manual)`, '',
  '## Implementation Tasks', '',
  `- [ ] **T1 — ${T1_TITLE}** <!-- t:${anchorKey(T1_TITLE)} -->`,
  `- [ ] **T2 — ${T2_TITLE}** <!-- t:${anchorKey(T2_TITLE)} -->`, '',
].join('\n');

const parseMcp = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const workLoopTicks = {
  name: 'work-loop-ticks',
  boxes: ['A1 task_items', 'A2 (manual) round-trip', 'A3 webhook deltas', 'A4 task tick lane', 'A5 apply_ticks'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'workloop');
    const db = rest(env);

    // Specialize THIS instance: manual criterion on REQ-001 + anchored doc.
    await db.update('specification_requirements', `id=eq.${fx.ids.req1}`, {
      acceptance_criteria: [
        { text: 'tasks persist across restarts', met: false },
        { text: 'queries return within 200ms', met: false },
        { text: MANUAL_TEXT, met: false, verification: 'manual' },
      ],
    });
    const [snapshot] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    snapshot.graph_data.artifacts[fx.ids.taskArtifact].content = anchoredDoc();
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snapshot.graph_data });

    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // OOB: tick T1 and the MANUAL criterion, exactly as a dev/AI would in git.
    const gh = github(env);
    const doc = await gh.getFileEventually(DOC_PATH, 'main');
    s.check('anchored task doc was pushed', !!doc && doc.content.includes(`t:${anchorKey(T1_TITLE)}`),
      (doc?.content ?? '').slice(0, 300));
    if (!doc) return { s, fx, integrationId };
    const edited = doc.content
      .replace(`- [ ] **T1 — ${T1_TITLE}**`, `- [x] **T1 — ${T1_TITLE}**`)
      .replace(`- [ ] ${MANUAL_TEXT} (manual)`, `- [x] ${MANUAL_TEXT} (manual)`);
    await gh.putFile(DOC_PATH, 'main', edited, 'chore: dev ticked a task and a manual criterion');

    // The webhook fetches the doc at the ref — wait until the provider serves
    // the edited content (same settle rule criteria-loop learned live).
    const served = await until(async () => {
      const f = await gh.getFile(DOC_PATH, 'main');
      return f?.content.includes(`- [x] **T1 — ${T1_TITLE}**`) ? true : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    s.check('provider serves the ticked doc before the webhook fires', !!served);

    // Forge the signed webhook delivery (A3: the CARD carries the deltas —
    // no sweep wait).
    const secret = `bench-secret-${uid().slice(0, 8)}`;
    await db.update('git_integrations', `id=eq.${integrationId}`, { webhook_secret: secret });
    const head = await gh.headSha('main');
    const hook = await postSignedWebhook(env, integrationId, secret, {
      ref: 'refs/heads/main', after: head,
      head_commit: {
        id: head, message: 'chore: dev ticked a task and a manual criterion',
        author: { username: 'bench' }, modified: [DOC_PATH],
      },
    });
    s.check('webhook accepted', hook.status === 200, `status=${hook.status} ${JSON.stringify(hook.data).slice(0, 200)}`);

    const cards = await until(async () => {
      const rows = await db.select('git_change_events',
        `project_id=eq.${fx.ids.project}&status=eq.pending&select=id,metadata`);
      return rows.length > 0 ? rows : null;
    });
    const card = cards?.[0];
    const meta = card?.metadata ?? {};
    s.check('webhook card carries criterionDeltas (A3)', !!meta.criterionDeltas, JSON.stringify(meta).slice(0, 400));
    s.check('the MANUAL tick matched via the (manual) strip (A2) and carries the STORED text',
      meta.criterionDeltas?.deltas?.some((d) => d.direction === 'tick' && d.text === MANUAL_TEXT),
      JSON.stringify(meta.criterionDeltas ?? {}).slice(0, 300));
    s.check('webhook card carries taskDeltas for the anchored T1 (A4)',
      meta.taskDeltas?.deltas?.some((d) => d.direction === 'tick' && d.key === anchorKey(T1_TITLE)),
      JSON.stringify(meta.taskDeltas ?? {}).slice(0, 300));

    // A5: the AI's view — get_pending_changes projects both delta kinds.
    const pending = parseMcp(await mcpCall(env, 'get_pending_changes', { project_id: fx.ids.project }));
    const projected = pending?.pendingChanges?.find((c) => c.changeEventId === card?.id);
    s.check('get_pending_changes projects both delta kinds (A5)',
      !!projected?.criterionDeltas && !!projected?.taskDeltas, JSON.stringify(projected ?? {}).slice(0, 300));

    // A5: one resolve applies both families with git provenance.
    const resolve = parseMcp(await mcpCall(env, 'resolve_change', {
      change_event_id: card?.id, resolution: 'accepted', apply_ticks: true,
    }));
    s.check('resolve_change apply_ticks applies 1 criterion + 1 task',
      resolve?.criteriaApplied === 1 && resolve?.tasksApplied === 1, JSON.stringify(resolve ?? {}).slice(0, 300));

    const [req] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const manual = req.acceptance_criteria.find((c) => c.text === MANUAL_TEXT);
    s.check('manual criterion met with git provenance (the lane the docs promise)',
      manual?.met === true && manual?.provenance?.source === 'git' && !!manual?.provenance?.commitSha,
      JSON.stringify(req.acceptance_criteria).slice(0, 300));
    const others = req.acceptance_criteria.filter((c) => c.text !== MANUAL_TEXT);
    s.check('unticked criteria stay unmet (no fabrication)', others.every((c) => c.met !== true));

    const taskRows = await db.select('task_items',
      `project_id=eq.${fx.ids.project}&select=task_key,done,orphaned,provenance,display_id`);
    const t1 = taskRows.find((r) => r.task_key === anchorKey(T1_TITLE));
    s.check('task_items records T1 done with git provenance (A1+A4)',
      t1?.done === true && t1?.provenance?.source === 'git' && t1?.orphaned === false,
      JSON.stringify(taskRows).slice(0, 300));
    s.check('the unticked T2 has no state row (state is earned, not pre-registered)',
      !taskRows.some((r) => r.task_key === anchorKey(T2_TITLE)));

    // Guard: the card is resolved — a second apply attempt is refused.
    const again = parseMcp(await mcpCall(env, 'resolve_change', {
      change_event_id: card?.id, resolution: 'accepted', apply_ticks: true,
    }));
    s.check('re-resolve is refused (already resolved)',
      again?.isError === true || /already resolved/i.test(String(again?.raw ?? again?.error ?? '')),
      JSON.stringify(again ?? {}).slice(0, 200));

    return { s, fx, integrationId };
  },
};

export default [workLoopTicks];
