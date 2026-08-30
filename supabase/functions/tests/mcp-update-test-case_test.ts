// E1 · update_test_case — the test-case maintenance lane (rename / reassign /
// retire / rebind). THE doctrine under pin: cases are NEVER hard-deleted
// (retirement is soft — retired_at/retired_reason — and every count surface
// filters it out while the row survives); a REASSIGNED case is deliberately
// stale on its new owner (a moved test has proven nothing there yet) and the
// OLD owner's bindings are released met-preserved + evidenceStale (the honest
// evidence-due state, never a silent unproof); the REBIND lane follows the same
// R5a rules as report_test_results (exact text, manual refused, never steals)
// and binding alone NEVER flips met. Revival: a fresh report on a retired case
// clears retirement — pinned here against handleReportTestResults' phase C.
import { FakeSupabase, assert, assertEquals } from './helpers.ts';
import { handleUpdateTestCase, handleReportTestResults } from '../mcp-server/tools/test-results.ts';
import { MCP_TOOLS } from '../mcp-server/tool-registry.ts';
// deno-lint-ignore no-explicit-any
type Any = any;

const AUTH: Any = { userId: 'user-1', scopes: ['read', 'write', 'propose'], authMethod: 'api_key' };
const PROJECT_UUID = '00000000-0000-4000-8000-000000000001';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';
const TARGET_ROW = '88888888-8888-4888-8888-888888888888';
const CASE1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOLDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_CASE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function scriptBase(sb: FakeSupabase, criteria: Any[]) {
  sb.script('projects', 'select', { data: { id: PROJECT_UUID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: criteria },
    error: null,
  });
}

const scriptCase = (sb: FakeSupabase, row: Any = {}) =>
  sb.script('test_cases', 'select', {
    data: { id: CASE1, test_id: 'TC-1', name: 'first case', status: 'passed', retired_at: null, retired_reason: null, ...row },
    error: null,
  });

Deno.test('update_test_case rename: collision-checked, test_id updated in place, receipt names the change', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  scriptCase(sb);
  sb.script('test_cases', 'select', { data: null, error: null }); // collision check: free
  sb.script('test_cases', 'update', { data: null, error: null });

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', new_test_id: 'TC-9', name: 'renamed case',
  });
  assert(r.success, JSON.stringify(r));
  const update = sb.callsTo('test_cases', 'update')[0];
  assert(update, 'the case row is updated');
  const p = update.payload as Any;
  assertEquals(p.test_id, 'TC-9');
  assertEquals(p.name, 'renamed case');
  assertEquals(p.requirement_id, undefined, 'no reassign — owner untouched');
  assertEquals(p.retired_at, undefined, 'no retire — retirement untouched');
  const data = r.data as Any;
  assertEquals(data.testId, 'TC-9');
  assert((data.changes as string[]).some((c) => c.includes('"TC-1" → "TC-9"')));
});

Deno.test('update_test_case rename: a taken (requirement, test_id) key refuses NAMING the holder — nothing written', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  scriptCase(sb);
  sb.script('test_cases', 'select', { data: { id: HOLDER, test_id: 'TC-9', name: 'the incumbent' }, error: null });

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', new_test_id: 'TC-9',
  });
  assert(!r.success);
  assert((r.error ?? '').includes('already has a test case "TC-9"'), r.error);
  assert((r.error ?? '').includes('the incumbent'), 'refusal names the holder');
  assertEquals(sb.callsTo('test_cases', 'update').length, 0);
});

Deno.test('update_test_case retire: soft-retirement (never a delete) + bound criteria released met-preserved with evidenceStale', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [
    { text: 'A holds', met: true, testId: CASE1, provenance: { source: 'test', testCaseId: CASE1, at: 't0' } },
    { text: 'B holds', met: false, testId: OTHER_CASE },
  ]);
  scriptCase(sb);
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null }); // release

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1',
    retire: true, retire_reason: 'superseded by TC-004',
  });
  assert(r.success, JSON.stringify(r));
  const p = sb.callsTo('test_cases', 'update')[0].payload as Any;
  assert(typeof p.retired_at === 'string' && p.retired_at.length > 0, 'retired_at stamped — the row itself survives');
  assertEquals(p.retired_reason, 'superseded by TC-004');
  assertEquals(sb.callsTo('test_cases', 'delete').length, 0, 'NEVER a hard delete — evidence is preserved');

  // The release: a criterion must never keep reading proven-by a hidden case.
  const release = sb.callsTo('specification_requirements', 'update')[0].payload as Any;
  const a = release.acceptance_criteria.find((c: Any) => c.text === 'A holds');
  assertEquals(a.testId, undefined, 'binding stripped');
  assertEquals(a.met, true, 'met PRESERVED — evidence-due, not silently unproven');
  assertEquals(a.evidenceStale.reason, 'case-retired', 'the R5e object mark, with the honest reason');
  assert(typeof a.evidenceStale.at === 'string' && a.evidenceStale.at.length > 0);
  assertEquals(a.provenance.testCaseId, CASE1, 'provenance history preserved');
  const b = release.acceptance_criteria.find((c: Any) => c.text === 'B holds');
  assertEquals(b.testId, OTHER_CASE, 'foreign bindings untouched');
  assertEquals((r.data as Any).releasedCriteria, ['A holds']);
  assert(((r.data as Any).notes as string[]).some((n) => n.includes('revives')), 'revival lane is taught');
});

Deno.test('update_test_case retire: refused without retire_reason — a retirement must be explainable', async () => {
  const sb = new FakeSupabase();
  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', retire: true,
  });
  assert(!r.success);
  assert((r.error ?? '').includes('retire_reason'));
  assertEquals(sb.calls.length, 0, 'refused before any query');
});

Deno.test('update_test_case un-retire: retire false clears both retirement columns', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  scriptCase(sb, { retired_at: '2026-08-23T00:00:00Z', retired_reason: 'superseded by TC-004' });
  sb.script('test_cases', 'update', { data: null, error: null });

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', retire: false,
  });
  assert(r.success, JSON.stringify(r));
  const p = sb.callsTo('test_cases', 'update')[0].payload as Any;
  assertEquals(p.retired_at, null);
  assertEquals(p.retired_reason, null);
  assert(((r.data as Any).changes as string[]).includes('un-retired'));
});

Deno.test('update_test_case reassign: case moves DELIBERATELY STALE and the old owner\'s binding is released', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'A holds', met: true, testId: CASE1 }]);
  scriptCase(sb);
  // Target requirement resolves AFTER the case lookup (spec select #2).
  sb.script('specification_requirements', 'select', {
    data: { id: TARGET_ROW, requirement_id: 'REQ-002', name: 'R2', locked: false, acceptance_criteria: [{ text: 'filter works', met: false }] },
    error: null,
  });
  sb.script('test_cases', 'select', { data: null, error: null }); // collision check on the TARGET
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null }); // release on the OLD owner

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', reassign_to: 'REQ-002',
  });
  assert(r.success, JSON.stringify(r));
  const p = sb.callsTo('test_cases', 'update')[0].payload as Any;
  assertEquals(p.requirement_id, TARGET_ROW);
  assertEquals(p.stale, true, 'a moved test has proven NOTHING about its new home');
  assertEquals(p.staleness_reason, 'Reassigned from REQ-001');
  const release = sb.callsTo('specification_requirements', 'update')[0];
  assert(release.filters.some((f) => f.method === 'eq' && f.args[1] === REQ_ROW), 'release targets the OLD owner');
  const a = (release.payload as Any).acceptance_criteria.find((c: Any) => c.text === 'A holds');
  assertEquals(a.testId, undefined);
  assertEquals(a.met, true, 'met preserved — the board reads evidence-due');
  assertEquals(a.evidenceStale.reason, 'case-reassigned');
  const data = r.data as Any;
  assertEquals(data.requirementId, 'REQ-002');
  assert((data.nextAction as string).includes('report_test_results'), 're-run + re-report is the stated next step');
});

Deno.test('update_test_case reassign: same requirement refused; unknown target refused', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  scriptCase(sb);
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: [] },
    error: null,
  });
  const same = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', reassign_to: 'REQ-001',
  });
  assert(!same.success);
  assert((same.error ?? '').includes('already owns'));

  const sb2 = new FakeSupabase();
  scriptBase(sb2, []);
  scriptCase(sb2);
  sb2.script('specification_requirements', 'select', { data: null, error: null }); // target missing
  const missing = await handleUpdateTestCase(sb2 as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', reassign_to: 'REQ-404',
  });
  assert(!missing.success);
  assert((missing.error ?? '').includes('Reassign target not found'));
  assertEquals(sb2.callsTo('test_cases', 'update').length, 0);
});

Deno.test('update_test_case reassign: target already holding the test_id refuses with both remedies named', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  scriptCase(sb);
  sb.script('specification_requirements', 'select', {
    data: { id: TARGET_ROW, requirement_id: 'REQ-002', name: 'R2', locked: false, acceptance_criteria: [] },
    error: null,
  });
  sb.script('test_cases', 'select', { data: { id: HOLDER, test_id: 'TC-1', name: 'their TC-1' }, error: null });

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', reassign_to: 'REQ-002',
  });
  assert(!r.success);
  assert((r.error ?? '').includes('REQ-002 already has a test case "TC-1"'), r.error);
  assert((r.error ?? '').includes('new_test_id'), 'remedy: rename with the reassign');
  assertEquals(sb.callsTo('test_cases', 'update').length, 0);
});

Deno.test('update_test_case rebind: criterion_text binds by exact text and NEVER flips met — a fresh report is the stated proof lane', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'A holds', met: false }]);
  scriptCase(sb);
  sb.script('specification_requirements', 'update', { data: null, error: null });

  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', criterion_text: 'A holds',
  });
  assert(r.success, JSON.stringify(r));
  const bind = sb.callsTo('specification_requirements', 'update')[0].payload as Any;
  const a = bind.acceptance_criteria.find((c: Any) => c.text === 'A holds');
  assertEquals(a.testId, CASE1);
  assertEquals(a.met, false, 'binding alone NEVER flips met');
  const data = r.data as Any;
  assertEquals(data.criterionBinding, 'bound');
  assert((data.notes as string[]).some((n) => n.includes('never flips met')), 'the proof lane is taught');
});

Deno.test('update_test_case rebind: conflict (never steals), manual-lane (refused), unbound (never guessed) — no criteria write in any of them', async () => {
  const run = async (criteria: Any[], text: string) => {
    const sb = new FakeSupabase();
    scriptBase(sb, criteria);
    scriptCase(sb);
    sb.script('test_cases', 'update', { data: null, error: null });
    const r = await handleUpdateTestCase(sb as never, AUTH, {
      project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', criterion_text: text,
    });
    assert(r.success, JSON.stringify(r));
    assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'no binding write');
    return r.data as Any;
  };
  const conflict = await run([{ text: 'A holds', met: true, testId: OTHER_CASE }], 'A holds');
  assertEquals(conflict.criterionBinding, 'conflict');
  assert((conflict.notes as string[])[0].includes('never stolen'));
  const manual = await run([{ text: 'User confirms it', met: false, verification: 'manual' }], 'User confirms it');
  assertEquals(manual.criterionBinding, 'manual-lane');
  const unbound = await run([{ text: 'The real criterion', met: false }], 'the real criterion'); // case differs
  assertEquals(unbound.criterionBinding, 'unbound');
});

Deno.test('update_test_case: retire+criterion_text refused up front; no action at all refused; write scope required', async () => {
  const sb = new FakeSupabase();
  const combo = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1',
    retire: true, retire_reason: 'x', criterion_text: 'A holds',
  });
  assert(!combo.success);
  assert((combo.error ?? '').includes('cannot be combined'));
  const noop = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1',
  });
  assert(!noop.success);
  assert((noop.error ?? '').includes('Nothing to do'));
  assertEquals(sb.calls.length, 0, 'both refusals precede any query');

  const scoped = await handleUpdateTestCase(sb as never, { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' } as Any, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-1', name: 'x',
  });
  assert(!scoped.success);
  assert((scoped.error ?? '').includes('write scope'));
});

Deno.test('update_test_case: unknown case refuses naming the (requirement, test_id) key', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  sb.script('test_cases', 'select', { data: null, error: null });
  const r = await handleUpdateTestCase(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: 'REQ-001', test_id: 'TC-404', name: 'x',
  });
  assert(!r.success);
  assert((r.error ?? '').includes('No test case "TC-404" on REQ-001'));
});

// Revival — the other half of retirement, pinned against report_test_results:
// a retired case that RAN again is live again; phase C clears retirement the
// same way it clears staleness.
Deno.test('report_test_results revival: a fresh report on an existing case clears retired_at/retired_reason', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_UUID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: [] },
    error: null,
  });
  sb.script('test_cases', 'select', { data: [{ id: CASE1, test_id: 'TC-1', status: 'passed' }], error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: { acceptance_criteria: [] }, error: null });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW, results: [{ test_id: 'TC-1', status: 'passed' }],
  });
  assert(r.success, JSON.stringify(r));
  const p = sb.callsTo('test_cases', 'update')[0].payload as Any;
  assertEquals(p.retired_at, null, 'a case that ran again is live again by definition');
  assertEquals(p.retired_reason, null);
});

// Registry + dispatch wiring, mirroring the report_test_results pin style.
Deno.test('update_test_case: registered with write scope (tool #30) and dispatched by transport', () => {
  const tool = MCP_TOOLS.find((t) => t.name === 'update_test_case');
  assert(tool, 'registered in MCP_TOOLS');
  assertEquals(tool!.requiredScope, 'write');
  assert(tool!.description.includes('NEVER hard-deleted'), 'the evidence-preservation rule is stated to the calling AI');
  assert(tool!.description.includes('DELIBERATELY marks it stale'), 'reassign staleness doctrine stated');
  assert(tool!.description.includes('binding alone NEVER flips met'), 'the rebind lane cannot be mistaken for proof');
  const schema = tool!.inputSchema as Any;
  assertEquals(schema.required, ['project_id', 'requirement_id', 'test_id']);
  assert(schema.properties.retire_reason, 'retire_reason is a declared parameter');

  const transport = Deno.readTextFileSync(new URL('../mcp-server/transport.ts', import.meta.url));
  assert(transport.includes("case 'update_test_case':"));
  assert(transport.includes('handleUpdateTestCase'));
});

// ── E2: delete_requirement steered away from evidence destruction ───────────────
// Deleting a requirement CASCADES its test_cases (the FK) — so a requirement
// carrying evidence refuses without force, and the refusal TEACHES the
// supersession lane (expands relation + update_test_case retirement).
import { handleDeleteRequirement } from '../mcp-server/tools/requirements.ts';

Deno.test('delete_requirement: recorded evidence refuses without force and names the supersession lane', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_UUID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: [] },
    error: null,
  });
  sb.script('specification_mappings', 'select', { count: 0, data: null, error: null });
  sb.script('test_cases', 'select', { count: 3, data: null, error: null }); // evidence — retired rows count too

  const r = await handleDeleteRequirement(sb as never, AUTH, { project_id: PROJECT_UUID, requirement_id: 'REQ-001' });
  assert(!r.success);
  const err = r.error ?? '';
  assert(err.includes('3 test case(s)'), err);
  assert(err.includes("type: 'expands'"), 'steers to supersession lineage');
  assert(err.includes('update_test_case'), 'steers to retirement, not cascade destruction');
  assertEquals(sb.callsTo('specification_requirements', 'delete').length, 0);
});

Deno.test('delete_requirement: registry description steers to supersession over deletion', () => {
  const tool = MCP_TOOLS.find((t) => t.name === 'delete_requirement');
  assert(tool);
  assert(tool!.description.includes('PREFER SUPERSESSION'), 'the steering is stated to the calling AI');
  assert(tool!.description.includes('update_test_case (retire: true)'), 'names the retirement lane');
  assert(tool!.description.includes('CASCADES'), 'names the cost of force');
});

// Owner bench catch 2026-08-23 (test-crud 18/19): REQ-001 was BOTH mapped and
// evidence-carrying, the mapping refusal fired first, and the supersession
// steering never surfaced. The evidence guard now outranks the mapping one.
Deno.test('delete_requirement: mapped AND evidence-carrying → the evidence steering wins', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_UUID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: [] },
    error: null,
  });
  sb.script('specification_mappings', 'select', { count: 1, data: null, error: null });
  sb.script('test_cases', 'select', { count: 2, data: null, error: null });

  const r = await handleDeleteRequirement(sb as never, AUTH, { project_id: PROJECT_UUID, requirement_id: 'REQ-001' });
  assert(!r.success);
  assert((r.error ?? '').includes('update_test_case'), 'the steering surfaces even on a mapped requirement');
  assert(!(r.error ?? '').includes('architecture element'), 'the plain mapping message does not mask it');
});
