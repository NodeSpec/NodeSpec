// D2 (docs/WORK_LOOP_PLAN.md): BOARD.md live — push writes the projection,
// ticks made IN the file ride the same card/delta lanes task docs use,
// apply_ticks flips the database, and the next regeneration renders the
// ticks back. An assistant that has never heard of NodeSpec can work the
// project from this one file.
import { callFn, rest, github, postSignedWebhook, mcpCall, uid, until, Scenario, boardDigest } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const BOARD = '.nodespec/BOARD.md';
const T1_TITLE = 'Scaffold the API Service component.';
const T2_TITLE = 'Wire the persistence layer.';
const CRIT = 'tasks persist across restarts';

const anchorKey = (title) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const anchoredDoc = () => [
  '# Task: API Service', '',
  '## Implementation Tasks', '',
  `- [ ] **T1 — ${T1_TITLE}** <!-- t:${anchorKey(T1_TITLE)} -->`,
  `  ↳ serves: REQ-001 "${CRIT}"`,
  `- [ ] **T2 — ${T2_TITLE}** <!-- t:${anchorKey(T2_TITLE)} -->`, '',
].join('\n');

const parseMcp = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const boardLoop = {
  name: 'board-loop',
  boxes: [
    'D2 push writes BOARD.md (grammar + anchors)',
    'D2 board ticks ride the card (same lanes)',
    'D2 apply_ticks flips DB from board ticks',
    'D2 regen renders ticks back',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'boardloop');
    const db = rest(env);
    const gh = github(env);

    // Give the API node an anchored task doc so the board carries task lines.
    const [snapshot] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    snapshot.graph_data.artifacts[fx.ids.taskArtifact].content = anchoredDoc();
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snapshot.graph_data });

    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // Read at the push's immutable commit sha — a branch-ref read here can
    // serve the PREVIOUS scenario's stale board (the contents API's
    // existence-only staleness; caught live 2026-08-23: check 2 received
    // pr-commit-mode's final board, which lacks the T1 anchors).
    const board = await gh.getFileEventually(BOARD, push.data.commitSha);
    s.check('push wrote BOARD.md: triage table up top, anchors, criteria boxes, task anchors',
      !!board &&
      board.content.startsWith('# Work Board <!-- nodespec-board v1 -->') &&
      // D3 refinement: the file OPENS as a GFM table — one anchor-linked row
      // per requirement with emoji status and aligned counts.
      board.content.includes('| Requirement | Status | Criteria | Tasks | Tests P/F/S | Nodes |') &&
      board.content.includes('| [REQ-001](#req-001') &&
      board.content.includes('⬜ pending') &&
      board.content.indexOf('| [REQ-001]') < board.content.indexOf('## REQ-001') &&
      board.content.includes('<!-- r:REQ-001 -->') &&
      board.content.includes(`- [ ] ${CRIT}`) &&
      // D3 refinement 2: the criterion reads LATERALLY — its serving task
      // annotated right under it, exact serves-line linkage.
      board.content.includes(`- [ ] ${CRIT}\n  ↳ tasks: T1 ☐ (API Service)`) &&
      board.content.includes(`<!-- n:${fx.ids.nodeApi} -->`) &&
      board.content.includes(`<!-- t:${anchorKey(T1_TITLE)} -->`) &&
      board.content.includes('status: pending'),
      boardDigest(board?.content));
    if (!board) return { s, fx, integrationId };

    // The user (or their AI) works the board: tick one criterion + task T1.
    const ticked = board.content
      .replace(`- [ ] ${CRIT}`, `- [x] ${CRIT}`)
      .replace(`- [ ] **T1 — ${T1_TITLE}**`, `- [x] **T1 — ${T1_TITLE}**`);
    await gh.putFile(BOARD, 'main', ticked, 'chore: tick board boxes');
    const served = await until(async () => {
      const f = await gh.getFile(BOARD, 'main');
      return f?.content.includes(`- [x] ${CRIT}`) ? true : null;
    }, { timeoutMs: 60000, everyMs: 2000 });
    s.check('provider serves the ticked board before the webhook fires', !!served);

    const secret = `bench-secret-${uid().slice(0, 8)}`;
    await db.update('git_integrations', `id=eq.${integrationId}`, { webhook_secret: secret });
    const head = await gh.headSha('main');
    const hook = await postSignedWebhook(env, integrationId, secret, {
      ref: 'refs/heads/main', after: head,
      head_commit: {
        id: head, message: 'chore: tick board boxes',
        author: { username: 'bench' }, modified: [BOARD],
      },
    });
    s.check('webhook accepted', hook.status === 200, `status=${hook.status}`);

    const cards = await until(async () => {
      const rows = await db.select('git_change_events',
        `project_id=eq.${fx.ids.project}&status=eq.pending&select=id,metadata`);
      return rows.length > 0 ? rows : null;
    });
    const card = cards?.[0];
    const critDeltas = card?.metadata?.criterionDeltas?.deltas ?? [];
    const taskDeltas = card?.metadata?.taskDeltas?.deltas ?? [];
    s.check('the card carries BOTH board ticks through the standard delta lanes',
      critDeltas.some((d) => d.requirementId === 'REQ-001' && d.text === CRIT && d.direction === 'tick') &&
      taskDeltas.some((d) => d.nodeId === fx.ids.nodeApi && d.key === anchorKey(T1_TITLE) && d.direction === 'tick'),
      JSON.stringify({ critDeltas, taskDeltas }).slice(0, 400));
    s.check('BOARD.md never reads as residue', !(card?.metadata?.residuePaths ?? []).includes(BOARD));

    // Approve with apply_ticks — the SAME resolve the task-doc lane uses.
    const resolved = parseMcp(await mcpCall(env, 'resolve_change', {
      change_event_id: card.id, resolution: 'accepted', apply_ticks: true,
    }));
    s.check('apply_ticks flips the criterion AND creates the task_items row',
      (resolved?.criteriaApplied ?? 0) >= 1 && (resolved?.tasksApplied ?? 0) >= 1,
      JSON.stringify(resolved ?? {}).slice(0, 300));

    const [req] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const flipped = (req?.acceptance_criteria ?? []).find((c) => c.text === CRIT);
    const taskRows = await db.select('task_items',
      `project_id=eq.${fx.ids.project}&node_id=eq.${fx.ids.nodeApi}&task_key=eq.${anchorKey(T1_TITLE)}&select=done,provenance`);
    s.check('database state: criterion met with git provenance, task done',
      flipped?.met === true && taskRows?.[0]?.done === true,
      JSON.stringify({ flipped, taskRow: taskRows?.[0] }).slice(0, 300));

    // Regeneration renders the ticks back — the projection converges.
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('second push succeeds', push2.data.success, JSON.stringify(push2.data).slice(0, 200));
    const regen = await until(async () => {
      const f = await gh.getFile(BOARD, push2.data.commitSha);
      return f?.content.includes(`- [x] ${CRIT}`) ? f : null;
    }, { timeoutMs: 60000, everyMs: 2000 });
    s.check('regenerated board shows both ticks (and the criterion counts moved)',
      !!regen &&
      regen.content.includes(`- [x] **T1 — ${T1_TITLE}**`) &&
      regen.content.includes('criteria 1/2'),
      boardDigest(regen?.content));
    s.check('the lateral annotation converged too: the criterion now shows its task done',
      !!regen && regen.content.includes(`- [x] ${CRIT}\n  ↳ tasks: T1 ☑ (API Service)`),
      boardDigest(regen?.content));

    return { s, fx, integrationId };
  },
};

export default [boardLoop];
