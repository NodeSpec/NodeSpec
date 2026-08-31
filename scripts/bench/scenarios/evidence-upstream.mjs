// Owner ask 2026-08-23: PROVE the upstream verification pipeline on the live
// stack — task docs and test plans/tests verify UPSTREAM (evidence flips
// criteria, criteria drive the derived status), and nothing leaks: no
// declaration shortcut, no cross-requirement bleed, no verified state
// surviving an upstream edit. BOARD.md is the asserted surface because it is
// the visually confirmable projection — and the app's Work Board renders the
// SAME shared functions (deriveWorkStatus, alignCriterionLanes,
// formatCriterionAnnotation; pinned by the vitest one-function contracts),
// so proving the file proves the view.
//
// The ladder this walks, all on ONE requirement (REQ-001, 2 criteria):
//   pending → (declaration only: still pending — mark_entity_complete never
//   verifies) → in-progress (mixed test evidence: one ❌ one ✅) →
//   verified (smoke) (fix + re-report; task tick lands laterally too) →
//   evidence-due (upstream requirement edit stales the evidence).
// REQ-002 sits beside it the whole time with zero evidence and must read
// ⬜ pending at every step — the leakage control.
import { callFn, rest, github, postSignedWebhook, mcpCall, uid, until, Scenario, boardDigest } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const BOARD = '.nodespec/BOARD.md';
const T1_TITLE = 'Implement the persistence layer.';
const CRIT1 = 'tasks persist across restarts';
const CRIT2 = 'queries return within 200ms';
const REQ2_CRIT = 'filter by status works';

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
  `  ↳ serves: REQ-001 "${CRIT1}"`, '',
].join('\n');

const parseMcp = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const evidenceUpstream = {
  name: 'evidence-upstream',
  boxes: [
    'declaration ≠ proof: mark_entity_complete never moves the board',
    'test evidence drives the ladder: ❌ holds in-progress, all-✅ reads verified (smoke)',
    'task tick + test evidence land LATERALLY on the same criterion row',
    'no cross-requirement leakage: the evidence-less neighbor stays ⬜ pending throughout',
    'upstream edit invalidates downstream proof: verified regresses to evidence-due (stale)',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'evidence');
    const db = rest(env);
    const gh = github(env);

    // Anchored task doc: T1 serves CRIT1 — the lateral linkage under test.
    const [snapshot] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    snapshot.graph_data.artifacts[fx.ids.taskArtifact].content = anchoredDoc();
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snapshot.graph_data });

    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);

    // The leakage control must be genuinely evidence-less: the fixture maps
    // BOTH requirements to the API node, and a requirement shares its mapped
    // nodes' work orders (by design — the node's tasks serve every
    // requirement it implements), so REQ-002 would inherit T1 and read
    // evidence-due once T1 ticks. Move it to the Primary Database node
    // through the map_requirement lane (r6 exercises it green every run).
    // History: this scenario's failures took three root causes to clear —
    // the evidence-self-staling trigger (20260823120000), this shared-node
    // inheritance, and the mapping→'in-progress' status trigger the digests
    // finally exposed (dropped in 20260823170000).
    const moved = parseMcp(await mcpCall(env, 'map_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-002',
      node_ids: [fx.ids.nodeDb], mode: 'replace',
    }));
    s.check('leakage control isolated: REQ-002 remapped to the Primary Database node',
      moved?.success !== false && !moved?.isError, JSON.stringify(moved).slice(0, 200));
    const push1 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push1.data.success, JSON.stringify(push1.data).slice(0, 200));

    // Immutable-sha read: a branch-ref read right after our own push can
    // serve the previous scenario's stale board (caught live 2026-08-23).
    const baseline = await gh.getFileEventually(BOARD, push1.data.commitSha);
    s.check('baseline board: both requirements read ⬜ pending, no evidence anywhere',
      !!baseline &&
      baseline.content.includes('⬜ pending') &&
      baseline.content.includes(`- [ ] ${CRIT1}`) &&
      baseline.content.includes(`- [ ] ${CRIT2}`) &&
      baseline.content.includes(`- [ ] ${REQ2_CRIT}`) &&
      !baseline.content.includes('✅ verified'),
      boardDigest(baseline?.content));
    if (!baseline) return { s, fx, integrationId };

    // ── Leakage pin 1: declaring the node complete proves NOTHING. ──────────
    const declared = parseMcp(await mcpCall(env, 'mark_entity_complete', {
      project_id: fx.ids.project, node_id: fx.ids.nodeApi, external_agent: 'bench-harness',
    }));
    const [req1AfterDecl] = await db.select('specification_requirements',
      `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    s.check('mark_entity_complete records the declaration but flips ZERO criteria',
      (declared?.unmetCriteria ?? 0) >= 2 &&
      (req1AfterDecl?.acceptance_criteria ?? []).every((c) => c.met !== true),
      JSON.stringify({ declared, criteria: req1AfterDecl?.acceptance_criteria }).slice(0, 300));

    // ── Mixed test evidence: one failure, one pass. ─────────────────────────
    const mixed = parseMcp(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: fx.ids.req1, external_agent: 'bench-harness',
      results: [
        { test_id: 'TC-1', status: 'failed', name: 'persistence survives restart', criterion_text: CRIT1 },
        { test_id: 'TC-2', status: 'passed', name: 'query latency under budget', criterion_text: CRIT2 },
      ],
    }));
    s.check('mixed report accepted and both criteria bound', mixed?.reported === 2,
      JSON.stringify(mixed).slice(0, 200));

    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('mid push succeeds', push2.data.success, JSON.stringify(push2.data).slice(0, 200));
    if (!push2.data.success) return { s, fx, integrationId };
    const midBoard = await gh.getFileEventually(BOARD, push2.data.commitSha, { timeoutMs: 60000 });
    if (!midBoard) {
      s.check('mid board readable at the push commit', false, `commitSha=${push2.data.commitSha} — contents API served nothing in 60s`);
      return { s, fx, integrationId };
    }
    s.check('mid board: 🔵 in-progress — a failing test HOLDS the row down even though the node was declared complete',
      !!midBoard &&
      midBoard.content.includes('🔵 in-progress') &&
      midBoard.content.includes(`- [ ] ${CRIT1}\n  ↳ tasks: T1 ☐ (API Service) · tests: TC-1 ❌`) &&
      midBoard.content.includes(`- [x] ${CRIT2}\n  ↳ tests: TC-2 ✅`) &&
      !midBoard.content.includes('✅ verified'),
      boardDigest(midBoard?.content));

    // ── Task-doc lane: tick T1 in the BOARD file, ride webhook + apply. ─────
    const ticked = midBoard.content.replace(`- [ ] **T1 — ${T1_TITLE}**`, `- [x] **T1 — ${T1_TITLE}**`);
    await gh.putFile(BOARD, 'main', ticked, 'chore: tick T1');
    await until(async () => {
      const f = await gh.getFile(BOARD, 'main');
      return f?.content.includes(`- [x] **T1 — ${T1_TITLE}**`) ? true : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    const secret = `bench-secret-${uid().slice(0, 8)}`;
    await db.update('git_integrations', `id=eq.${integrationId}`, { webhook_secret: secret });
    const head = await gh.headSha('main');
    await postSignedWebhook(env, integrationId, secret, {
      ref: 'refs/heads/main', after: head,
      head_commit: { id: head, message: 'chore: tick T1', author: { username: 'bench' }, modified: [BOARD] },
    });
    const cards = await until(async () => {
      const rows = await db.select('git_change_events',
        `project_id=eq.${fx.ids.project}&status=eq.pending&select=id,metadata`);
      return rows.length > 0 ? rows : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    s.check('the board tick raised a pending card', !!cards, 'no pending git_change_events within 30s');
    if (!cards) return { s, fx, integrationId };
    const resolved = parseMcp(await mcpCall(env, 'resolve_change', {
      change_event_id: cards[0].id, resolution: 'accepted', apply_ticks: true,
    }));
    s.check('task tick applied through the standard lane', (resolved?.tasksApplied ?? 0) >= 1,
      JSON.stringify(resolved ?? {}).slice(0, 200));

    // ── Fix the failure, re-report — the evidence lane flips the criterion. ─
    await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: fx.ids.req1, external_agent: 'bench-harness',
      results: [{ test_id: 'TC-1', status: 'passed', name: 'persistence survives restart', criterion_text: CRIT1 }],
    });

    const push3 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('green push succeeds', push3.data.success, JSON.stringify(push3.data).slice(0, 200));
    if (!push3.data.success) return { s, fx, integrationId };
    const greenBoard = await gh.getFileEventually(BOARD, push3.data.commitSha, { timeoutMs: 60000 });
    if (!greenBoard) {
      s.check('green board readable at the push commit', false, `commitSha=${push3.data.commitSha} — contents API served nothing in 60s`);
      return { s, fx, integrationId };
    }
    s.check('green board: ✅ verified (smoke) — all criteria proven by tests, within the one-per-criterion budget',
      !!greenBoard &&
      greenBoard.content.includes('✅ verified (smoke)') &&
      greenBoard.content.includes('status: verified (smoke)'),
      boardDigest(greenBoard?.content));
    s.check('the criterion row reads LATERALLY: task tick AND test evidence on one line',
      !!greenBoard &&
      greenBoard.content.includes(`- [x] ${CRIT1}\n  ↳ tasks: T1 ☑ (API Service) · tests: TC-1 ✅`),
      boardDigest(greenBoard?.content));
    s.check('leakage control: REQ-002 (zero evidence) still reads ⬜ pending with its criterion untouched',
      !!greenBoard &&
      greenBoard.content.includes('⬜ pending') &&
      greenBoard.content.includes(`- [ ] ${REQ2_CRIT}`) &&
      !greenBoard.content.includes(`${REQ2_CRIT}\n  ↳`),
      boardDigest(greenBoard?.content));

    // ── Upstream edit invalidates downstream proof. ─────────────────────────
    const reworded = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      description: 'Tasks persist — now including archival semantics.',
    }));
    s.check('requirement description updated over MCP', reworded?.requirementId === 'REQ-001',
      JSON.stringify(reworded).slice(0, 200));
    const staleRows = await db.select('test_cases',
      `requirement_id=eq.${fx.ids.req1}&select=test_id,stale,staleness_reason`);
    s.check('DB: the staleness trigger marked BOTH cases stale with the honest reason',
      (staleRows ?? []).length === 2 && staleRows.every((t) => t.stale === true) &&
      staleRows.every((t) => t.staleness_reason === 'Requirement description changed'),
      JSON.stringify(staleRows).slice(0, 300));

    const push4 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('stale push succeeds', push4.data.success, JSON.stringify(push4.data).slice(0, 200));
    if (!push4.data.success) return { s, fx, integrationId };
    const staleBoard = await gh.getFileEventually(BOARD, push4.data.commitSha, { timeoutMs: 60000 });
    if (!staleBoard) {
      s.check('stale board readable at the push commit', false, `commitSha=${push4.data.commitSha} — contents API served nothing in 60s`);
      return { s, fx, integrationId };
    }
    s.check('stale board: verified REGRESSED to 🟠 evidence-due and the lateral line shows (stale)',
      !!staleBoard &&
      staleBoard.content.includes('🟠 evidence-due') &&
      staleBoard.content.includes('status: evidence-due') &&
      !staleBoard.content.includes('✅ verified') &&
      staleBoard.content.includes('TC-1 ✅ (stale)'),
      boardDigest(staleBoard?.content));
    s.check('leakage control holds through the regression: REQ-002 still ⬜ pending',
      !!staleBoard && staleBoard.content.includes(`- [ ] ${REQ2_CRIT}`) &&
      staleBoard.content.includes('⬜ pending'),
      boardDigest(staleBoard?.content));

    return { s, fx, integrationId };
  },
};

export default [evidenceUpstream];
