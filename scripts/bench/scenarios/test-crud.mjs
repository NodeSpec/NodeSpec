// E1 scenario: update_test_case — the test-case maintenance lane, live.
//
// The full lifecycle in one project: report evidence → RENAME the case (binding
// survives — criteria bind by row uuid, not test_id) → rename COLLISION refused
// naming the holder → REASSIGN to the requirement it actually verifies (arrives
// deliberately stale; the old owner's criterion releases met-preserved +
// evidenceStale — the honest evidence-due state) → REBIND on the new owner
// (binding alone never flips met) → RETIRE a superseded case (soft: the row
// survives, every count surface excludes it, its binding releases) → REVIVAL
// (a fresh report on the retired test_id clears retirement and re-proves the
// criterion). All DB assertions are REST reads of the real rows — no simulation.
import { rest, mcpCall, Scenario } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const parse = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const testCrud = {
  name: 'test-crud',
  boxes: ['E1 update_test_case (rename · reassign · retire/revive · rebind)'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'testcrud');
    const db = rest(env);

    // Seed evidence: TC-001 proves the persistence criterion, TC-002 fails the
    // latency one (both bound by exact criterion text).
    const report = parse(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', external_agent: 'bench-harness',
      results: [
        { test_id: 'TC-001', status: 'passed', criterion_text: 'tasks persist across restarts', framework: 'vitest' },
        { test_id: 'TC-002', status: 'failed', criterion_text: 'queries return within 200ms' },
      ],
    }));
    s.check('seed report lands both cases', report?.reported === 2, JSON.stringify(report).slice(0, 300));

    // RENAME: test_id changes, the criterion binding (row uuid) survives.
    const rename = parse(await mcpCall(env, 'update_test_case', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', test_id: 'TC-001', new_test_id: 'TC-001A',
    }));
    s.check('rename succeeds with a named change', rename?.testId === 'TC-001A'
      && (rename?.changes ?? []).some((c) => c.includes('"TC-001" → "TC-001A"')),
      JSON.stringify(rename).slice(0, 300));
    const [renamedRow] = await db.select('test_cases', `requirement_id=eq.${fx.ids.req1}&test_id=eq.TC-001A&select=id,test_id`);
    s.check('DB: the row carries the new test_id', renamedRow?.test_id === 'TC-001A', JSON.stringify(renamedRow));
    let [req1] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const persistCrit = req1.acceptance_criteria.find((c) => c.text === 'tasks persist across restarts');
    s.check('criterion binding SURVIVES the rename (bound by row uuid, still met)',
      persistCrit?.testId === renamedRow?.id && persistCrit?.met === true, JSON.stringify(persistCrit).slice(0, 200));

    // COLLISION: TC-002 → TC-001A is taken; the refusal names the holder.
    const collide = parse(await mcpCall(env, 'update_test_case', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', test_id: 'TC-002', new_test_id: 'TC-001A',
    }));
    // Tool refusals ride the JSON-RPC envelope as plain text ("Error: ...")
    // with isError — parse() surfaces them as { raw, isError }.
    s.check('rename collision refused NAMING the holder',
      collide?.isError === true && String(collide?.raw ?? '').includes('already has a test case "TC-001A"'),
      JSON.stringify(collide).slice(0, 300));

    // REASSIGN: the passed case actually belongs to REQ-002. It must arrive
    // deliberately stale, and REQ-001's criterion must release met-preserved.
    const reassign = parse(await mcpCall(env, 'update_test_case', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', test_id: 'TC-001A', reassign_to: 'REQ-002',
    }));
    s.check('reassign succeeds and states the re-run duty', reassign?.requirementId === 'REQ-002'
      && String(reassign?.nextAction ?? '').includes('report_test_results'), JSON.stringify(reassign).slice(0, 300));
    const [movedRow] = await db.select('test_cases', `id=eq.${renamedRow.id}&select=requirement_id,stale,staleness_reason`);
    s.check('DB: moved case is deliberately STALE with the honest reason',
      movedRow?.requirement_id === fx.ids.req2 && movedRow?.stale === true
      && movedRow?.staleness_reason === 'Reassigned from REQ-001', JSON.stringify(movedRow));
    [req1] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const released = req1.acceptance_criteria.find((c) => c.text === 'tasks persist across restarts');
    s.check('DB: old owner\'s criterion released — met PRESERVED, evidenceStale set, binding gone',
      released?.met === true && released?.evidenceStale?.reason === 'case-reassigned' && !released?.testId,
      JSON.stringify(released).slice(0, 200));

    // REBIND on the new owner: binding lands, met does NOT flip.
    const rebind = parse(await mcpCall(env, 'update_test_case', {
      project_id: fx.ids.project, requirement_id: 'REQ-002', test_id: 'TC-001A', criterion_text: 'filter by status works',
    }));
    s.check('rebind reports bound + the never-flips-met note', rebind?.criterionBinding === 'bound'
      && (rebind?.notes ?? []).some((n) => n.includes('never flips met')), JSON.stringify(rebind).slice(0, 300));
    const [req2] = await db.select('specification_requirements', `id=eq.${fx.ids.req2}&select=acceptance_criteria`);
    const filterCrit = req2.acceptance_criteria.find((c) => c.text === 'filter by status works');
    s.check('DB: bound to the case but NOT met — binding is never proof',
      filterCrit?.testId === renamedRow.id && filterCrit?.met !== true, JSON.stringify(filterCrit).slice(0, 200));

    // RETIRE the failed TC-002 (superseded). Soft: row survives, counts exclude it,
    // its latency-criterion binding releases.
    const before = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    const retire = parse(await mcpCall(env, 'update_test_case', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', test_id: 'TC-002',
      retire: true, retire_reason: 'superseded by TC-001A',
    }));
    s.check('retire succeeds and teaches the revival lane',
      (retire?.changes ?? []).some((c) => c.includes('retired: superseded by TC-001A'))
      && (retire?.notes ?? []).some((n) => n.includes('revives')), JSON.stringify(retire).slice(0, 300));
    const [retiredRow] = await db.select('test_cases', `requirement_id=eq.${fx.ids.req1}&test_id=eq.TC-002&select=id,retired_at,retired_reason,status`);
    s.check('DB: the row SURVIVES retirement (soft, never a delete)',
      !!retiredRow && !!retiredRow.retired_at && retiredRow.retired_reason === 'superseded by TC-001A',
      JSON.stringify(retiredRow));
    const after = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    s.check('status counts EXCLUDE the retired case (budget gauge drops by one)',
      (after?.testBudget?.testCases ?? -1) === (before?.testBudget?.testCases ?? 0) - 1,
      JSON.stringify({ before: before?.testBudget?.testCases, after: after?.testBudget?.testCases }));
    [req1] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const latency = req1.acceptance_criteria.find((c) => c.text === 'queries return within 200ms');
    s.check('DB: retired case\'s binding released — never proven-by a hidden case',
      !latency?.testId && latency?.evidenceStale?.reason === 'case-retired', JSON.stringify(latency).slice(0, 200));

    // REVIVAL: a fresh (passing) report on the retired test_id clears retirement
    // and, bound by criterion_text, flips the criterion for real.
    const revive = parse(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', external_agent: 'bench-harness',
      results: [{ test_id: 'TC-002', status: 'passed', criterion_text: 'queries return within 200ms' }],
    }));
    s.check('revival report is an UPDATE of the surviving row (no new case)',
      revive?.updated === 1 && revive?.created === 0, JSON.stringify(revive).slice(0, 300));
    const [revivedRow] = await db.select('test_cases', `id=eq.${retiredRow.id}&select=retired_at,retired_reason,status`);
    s.check('DB: retirement cleared — a case that ran again is live again',
      revivedRow?.retired_at === null && revivedRow?.retired_reason === null && revivedRow?.status === 'passed',
      JSON.stringify(revivedRow));
    [req1] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const proven = req1.acceptance_criteria.find((c) => c.text === 'queries return within 200ms');
    s.check('DB: the revived run PROVES the criterion (met, fresh binding, stale mark CLEARED)',
      proven?.met === true && proven?.testId === retiredRow.id && !proven?.evidenceStale,
      JSON.stringify(proven).slice(0, 200));

    // E2 steering: deleting a requirement with recorded evidence refuses
    // (deletion would CASCADE the test_cases rows) and TEACHES supersession.
    const del = parse(await mcpCall(env, 'delete_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
    }));
    s.check('delete_requirement refuses over evidence, steering to supersession + retirement',
      del?.isError === true && String(del?.raw ?? '').includes('update_test_case')
      && String(del?.raw ?? '').includes("type: 'expands'"),
      JSON.stringify(del).slice(0, 300));
    const [stillThere] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=id`);
    s.check('DB: the requirement (and its evidence) survives the refused delete', !!stillThere?.id,
      JSON.stringify(stillThere));

    return { s, fx };
  },
};

export default [testCrud];
