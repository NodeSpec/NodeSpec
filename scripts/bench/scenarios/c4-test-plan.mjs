// SB-4 scenario 12: C4 — the test-evidence lane, live.
//
// Automates 4½ of the 5 C4 bench moves: plan refresh + git write at push (with a
// user-edited Test Strategy surviving regeneration), requirement-rename path
// stability, report_test_results → criterion flip with test provenance (+ the
// unbound-honesty warning), and both triage surfaces (readiness `tests` advisory,
// status failedTestCases). The one move left manual is the source-change → stale
// TRIGGER itself (it rides the artifact-update lane; its pre-existing DB trigger
// is live since March) — the triage VISIBILITY of staleness is covered here via
// the failing case.
import { callFn, github, rest, mcpCall, uid, until, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const parse = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const testPlanLoop = {
  name: 'test-plan-loop',
  boxes: ['C4 bench 1–2, 4–5 (plan push + rename stability + report→flip→provenance + triage)'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'c4tests');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const db = rest(env);
    const gh = github(env);

    // Seed a MANAGED test-plan artifact (generator fingerprint present → the C1-style
    // provenance guard treats it as refreshable) with a deliberately stale fingerprint
    // and a user-edited Test Strategy the regeneration must carry across.
    const artId = uid();
    const graph = structuredClone(fx.graph);
    graph.artifacts[artId] = {
      id: artId, nodeId: fx.ids.nodeApi, path: '.nodespec/tests/REQ-001.tests.md',
      kind: 'test-plan', status: 'draft',
      content: '# Test Plan: REQ-001\n\n## Test Strategy\nBENCH-EDITED STRATEGY: exercise persistence through the public API only.\n\n## Test Cases\n(stale — regenerate)\n',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      metadata: { requirementId: 'REQ-001', testContextFingerprint: { fingerprint: 'bench-stale' } },
    };
    await db.insert('graph_snapshots', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch,
      version: 1, hash: 'benchfix-c4', patch_sequence: 1, graph_data: graph,
    });

    // C4 box 1 + freshness: push refreshes the stale plan and writes it to git.
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success, JSON.stringify(push.data).slice(0, 300));
    s.check('push freshness refreshed the stale plan (testPlansRefreshed ≥ 1)',
      (push.data.testPlansRefreshed ?? 0) >= 1, JSON.stringify(push.data).slice(0, 300));
    const planFile = await gh.getFileEventually('.nodespec/tests/REQ-001.tests.md', 'main');
    s.check('test plan exists in the commit at the id-only path', !!planFile);
    if (planFile) {
      s.check('user-edited Test Strategy SURVIVED regeneration',
        planFile.content.includes('BENCH-EDITED STRATEGY'), planFile.content.slice(0, 300));
    }

    // C4 box 2: rename the requirement → the plan path must not move.
    // Two rapid same-ref pushes: wait until the provider serves push1's head so
    // git-push cannot build on a stale parent (the server now also retries a
    // 422 non-fast-forward once on a fresh head — this keeps the scenario's
    // failure detail meaningful rather than masking a real conflict).
    await until(async () => (await gh.headSha('main')) === push.data.commitSha, { timeoutMs: 20000, everyMs: 2000 });
    await db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { name: 'Store tasks (renamed)' });
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId,
    });
    s.check('post-rename push succeeds', push2.data.success, JSON.stringify(push2.data).slice(0, 200));
    const stablePath = await gh.getFileEventually('.nodespec/tests/REQ-001.tests.md', 'main');
    s.check('renamed requirement keeps the SAME plan path', !!stablePath);

    // C4 box 4: report a pass + a fail with exact criterion binding, plus one
    // deliberately unbindable text (the honesty rule: reported, never guessed).
    const report = parse(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', external_agent: 'bench-harness',
      results: [
        { test_id: 'TC-001', status: 'passed', criterion_text: 'tasks persist across restarts', framework: 'vitest', test_type: 'integration' },
        { test_id: 'TC-002', status: 'failed', criterion_text: 'queries return within 200ms' },
        { test_id: 'TC-003', status: 'passed', criterion_text: 'no such criterion wording' },
      ],
    }));
    s.check('report accepted all three results', report?.reported === 3, JSON.stringify(report).slice(0, 300));
    s.check('flippedCriteria carries the passed criterion as met',
      (report?.flippedCriteria ?? []).some((c) => c.text === 'tasks persist across restarts' && c.met === true),
      JSON.stringify(report?.flippedCriteria).slice(0, 300));
    s.check('unbindable criterion_text is REPORTED, never guessed',
      (report?.warnings ?? []).some((w) => w.includes('no such criterion wording')),
      JSON.stringify(report?.warnings).slice(0, 300));

    const [req1] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const c1 = req1.acceptance_criteria.find((c) => c.text === 'tasks persist across restarts');
    const c2 = req1.acceptance_criteria.find((c) => c.text === 'queries return within 200ms');
    s.check('DB: passed criterion met with TEST provenance (source, testCaseId, at)',
      c1?.met === true && c1?.provenance?.source === 'test' && !!c1?.provenance?.testCaseId && !!c1?.provenance?.at,
      JSON.stringify(c1).slice(0, 300));
    s.check('DB: failed criterion bound (testId set) but NOT met',
      c2?.met !== true && !!c2?.testId, JSON.stringify(c2).slice(0, 200));

    // C4 box 5: both triage surfaces name the problem. WS1: scoped call → full gap
    // detail (unscoped defaults to summary counts); the resolution action rides ONCE
    // in the top-level remediations map, keyed by gap kind.
    const readiness = parse(await mcpCall(env, 'get_build_readiness', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, node_ids: ['API Service'],
    }));
    const apiNode = (readiness?.nodes ?? readiness?.results ?? []).find((n) => n.label === 'API Service');
    const testsAdvisory = (apiNode?.advisories ?? []).find((a) => a.kind === 'tests');
    s.check('readiness carries a tests advisory on the serving node naming REQ-001',
      !!testsAdvisory && testsAdvisory.detail.includes('REQ-001') && testsAdvisory.detail.includes('1 failing'),
      JSON.stringify(testsAdvisory ?? apiNode).slice(0, 300));
    s.check('tests advisory is an ADVISORY, never a blocker',
      !(apiNode?.blockers ?? []).some((b) => b.kind === 'tests'), JSON.stringify(apiNode?.blockers).slice(0, 200));
    s.check('remediations.tests points at the re-verify lane (get_test_plan + report_test_results)',
      String(readiness?.remediations?.tests ?? '').includes('get_test_plan')
      && String(readiness?.remediations?.tests ?? '').includes('report_test_results'),
      JSON.stringify(readiness?.remediations).slice(0, 300));

    const status = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    s.check('get_project_status counts the failing case (failedTestCases ≥ 1)',
      (status?.testCoverage?.failedTestCases ?? 0) >= 1, JSON.stringify(status?.testCoverage).slice(0, 300));
    // Owner bug 2026-08-23: the phase is DERIVED from live progress — this
    // project has canvas architecture AND reported test evidence, so status
    // must read generating_code no matter what the wizard column stored.
    s.check('phase derives from live progress: architecture + test evidence → generating_code',
      status?.phaseStatus === 'generating_code',
      JSON.stringify({ phaseStatus: status?.phaseStatus, storedPhaseStatus: status?.storedPhaseStatus }));
    // D4: the test-budget gauge rides the same response — policy doctrine,
    // live counts, and an overTested array (empty here: three cases across
    // this fixture's criteria sits within the one-per-criterion budget).
    s.check('D4: status carries the test-budget gauge (policy + counts + overTested)',
      typeof status?.testBudget?.policy === 'string' &&
      status.testBudget.policy.includes('One binding test per acceptance criterion') &&
      typeof status.testBudget.criteriaTotal === 'number' &&
      typeof status.testBudget.testCases === 'number' &&
      Array.isArray(status.testBudget.overTested),
      JSON.stringify(status?.testBudget).slice(0, 300));
    return { s, fx, integrationId };
  },
};

export default [testPlanLoop];
