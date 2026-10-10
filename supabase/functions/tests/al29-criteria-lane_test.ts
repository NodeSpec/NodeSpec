// AL.29 (gap 7): the manual criteria lane (a person applying a card's ticks
// in the Git panel) wrote the whole acceptance_criteria array back from a read
// it made first, outside apply_criteria_ops, and marked the card applied even
// when a write failed. Two consequences: a test result that landed between the
// read and the write was erased, and a failed write left the card saying it was
// done. These interleave the writers deterministically over MemorySupabase,
// with apply_criteria_ops modelled on its SQL (20260915120000_v3r_criteria_ops):
// the compare token raises 40001, ops select one criterion, every other key is
// kept.
import { applyCardTicks, applyCriterionDeltas, criterionTickOps } from '../_shared/git-drift.ts';
import { MemorySupabase, assert, assertEquals, type Row } from './helpers.ts';

const PROJECT = 'p-1';
const SPEC = 'spec-1';
const CARD = 'card-1';
const NODE = '33333333-3333-4333-8333-333333333333';

let clock = 0;
const tick = () => `2026-10-09T00:00:${String(++clock).padStart(2, '0')}Z`;

/** apply_criteria_ops, as the migration writes it. */
function criteriaOps(p: Row, db: MemorySupabase): unknown {
  const row = db.rowsOf('specification_requirements').find((r) => r.id === p.p_requirement_id);
  if (!row) return { found: false, applied: 0, changed: false };
  if (p.p_expected_updated_at != null && row.updated_at !== p.p_expected_updated_at) {
    throw { code: '40001', message: `apply_criteria_ops: the requirement moved since you read it (expected ${p.p_expected_updated_at}, found ${row.updated_at})` };
  }
  let criteria = structuredClone((row.acceptance_criteria ?? []) as Row[]);
  let applied = 0;
  for (const op of p.p_ops as Row[]) {
    const [key, want] = 'criterion_id' in op ? ['id', op.criterion_id] : 'criterion_text' in op ? ['text', op.criterion_text] : ['testId', op.test_id];
    let matched = false;
    criteria = criteria.map((c) => {
      if (c[key as string] !== want) return c;
      matched = true;
      const next = { ...c };
      if (op.op === 'set_met') next.met = op.value;
      else if (op.op === 'stamp') next.provenance = op.value;
      else throw { code: 'P0001', message: `unmodelled op ${op.op}` };
      return next;
    });
    if (matched) applied++;
  }
  row.acceptance_criteria = criteria;
  row.updated_at = tick();
  return { found: true, applied, changed: true, criteria };
}

function world(requirements: Row[]): MemorySupabase {
  const sb = new MemorySupabase();
  sb.table('project_specifications', [{ id: SPEC, project_id: PROJECT, created_at: '2026-01-01T00:00:00Z' }]);
  sb.table('specification_requirements', requirements.map((r) => ({ specification_id: SPEC, updated_at: tick(), ...r })));
  sb.table('git_change_events', [{ id: CARD, project_id: PROJECT, commit_sha: 'abc1234', author: 'dev', metadata: {} }]);
  sb.table('task_items', []);
  sb.fn('apply_criteria_ops', criteriaOps);
  return sb;
}

const crit = (sb: MemorySupabase, req: string) =>
  sb.rowsOf('specification_requirements').find((r) => r.requirement_id === req)!.acceptance_criteria as Row[];

// A test result (report_test_results' own call shape) that lands just before
// each of the lane's writes, the first `times` of them.
function resultLandsFirst(sb: MemorySupabase, req: string, criterionId: string, times: number) {
  let left = times;
  sb.fn('apply_criteria_ops', (p, db) => {
    if (left > 0 && (p.p_ops as Row[]).some((o) => o.op === 'stamp' && (o.value as Row)?.source === 'git')) {
      left--;
      const row = db.rowsOf('specification_requirements').find((r) => r.requirement_id === req)!;
      criteriaOps({
        p_requirement_id: row.id,
        p_ops: [
          { op: 'set_met', criterion_id: criterionId, value: left % 2 === 0 },
          { op: 'stamp', criterion_id: criterionId, value: { source: 'test', testCaseId: `tc-${left}` } },
        ],
      }, db);
    }
    return criteriaOps(p, db);
  });
}

const tickDeltas = (pairs: Array<[string, string]>) => ({
  deltas: pairs.map(([requirementId, text]) => ({ requirementId, text, direction: 'tick' as const })),
  flagged: [],
});

Deno.test('AL.29 criterionTickOps: one set_met and one stamp per unmet criterion a tick names, by id; met ones keep their proof', () => {
  const prov = { source: 'git' as const, commitSha: 'abc', at: 't' };
  const { ops, count } = criterionTickOps(
    [
      { id: 'c1', text: 'orders persist', met: false },
      { id: 'c2', text: 'backups restore', met: true, provenance: { source: 'test' } },
      { text: 'legacy, no id', met: false },
      { text: 'legacy, no id', met: false },
      { id: 'c5', text: 'not ticked', met: false },
    ],
    [{ text: 'orders persist' }, { text: 'backups restore' }, { text: 'legacy, no id' }],
    prov,
  );
  assertEquals(count, 3, 'c1 and both legacy criteria; c2 is already met');
  assertEquals(ops, [
    { op: 'set_met', criterion_id: 'c1', value: true },
    { op: 'stamp', criterion_id: 'c1', value: prov },
    { op: 'set_met', criterion_text: 'legacy, no id', value: true },
    { op: 'stamp', criterion_text: 'legacy, no id', value: prov },
  ], 'a criterion with no id is selected by its text, once');
});

Deno.test('AL.29: a test result that lands between the tick\'s read and its write survives, and the tick still lands', async () => {
  const sb = world([{ id: 'row-3', requirement_id: 'REQ-003', acceptance_criteria: [
    { id: 'c1', text: 'C1 passes', met: false },
    { id: 'cm', text: 'CM checked by hand', met: false, verification: 'manual', note: 'keep me' },
  ] }]);
  resultLandsFirst(sb, 'REQ-003', 'c1', 1);
  const r = await applyCriterionDeltas(sb as never, PROJECT, { deltas: tickDeltas([['REQ-003', 'CM checked by hand']]), commitSha: 'abc1234', appliedBy: 'user-9' });
  assertEquals([r.applied, r.requirementsTouched, r.failed], [1, ['REQ-003'], []]);
  const [c1, cm] = crit(sb, 'REQ-003');
  assertEquals([c1.met, (c1.provenance as Row).source], [true, 'test'], 'the result that landed first is not erased');
  assertEquals([cm.met, (cm.provenance as Row).source, (cm.provenance as Row).appliedBy, cm.note], [true, 'git', 'user-9', 'keep me']);
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'no whole-array write');
  assertEquals(sb.callsTo('rpc', 'apply_criteria_ops').length, 2, 'the moved requirement was read again and written once');
});

Deno.test('AL.29: a result that proves the same criterion first keeps its proof; the tick, read again, has nothing left to write', async () => {
  const sb = world([{ id: 'row-3', requirement_id: 'REQ-003', acceptance_criteria: [
    { id: 'c1', text: 'C1 passes', met: false },
  ] }]);
  resultLandsFirst(sb, 'REQ-003', 'c1', 1);
  const r = await applyCriterionDeltas(sb as never, PROJECT, { deltas: tickDeltas([['REQ-003', 'C1 passes']]), appliedBy: 'user-9' });
  assertEquals([r.applied, r.requirementsTouched, r.failed], [0, [], []]);
  const [c1] = crit(sb, 'REQ-003');
  assertEquals([c1.met, (c1.provenance as Row).source], [true, 'test'], 'the test result is the proof on record, not the tick');
});

Deno.test('AL.29: a requirement that keeps moving is reported failed after one retry, not written over', async () => {
  const sb = world([{ id: 'row-3', requirement_id: 'REQ-003', acceptance_criteria: [
    { id: 'c1', text: 'C1 passes', met: false },
    { id: 'cm', text: 'CM checked by hand', met: false },
  ] }]);
  resultLandsFirst(sb, 'REQ-003', 'c1', 2);
  const r = await applyCriterionDeltas(sb as never, PROJECT, { deltas: tickDeltas([['REQ-003', 'CM checked by hand']]) });
  assertEquals([r.applied, r.requirementsTouched], [0, []]);
  assertEquals(r.failed.map((f) => f.requirementId), ['REQ-003']);
  assert(/moved since you read it/.test(r.failed[0].reason), r.failed[0].reason);
  assertEquals(crit(sb, 'REQ-003')[1].met, false, 'nothing of the tick was written');
  assertEquals((crit(sb, 'REQ-003')[0].provenance as Row).source, 'test', 'and the results stand');
});

Deno.test('AL.29 applyCardTicks: a refused write is reported, the others land, the card stays open; applying again writes only what is unmet and closes it', async () => {
  const sb = world([
    { id: 'row-1', requirement_id: 'REQ-001', acceptance_criteria: [{ id: 'a1', text: 'A1', met: false }] },
    { id: 'row-2', requirement_id: 'REQ-002', acceptance_criteria: [{ id: 'b1', text: 'B1', met: false }] },
  ]);
  let refuse = true;
  sb.fn('apply_criteria_ops', (p, db) => {
    if (refuse && p.p_requirement_id === 'row-2') throw { code: 'P0001', message: 'REQ-002 is locked' };
    return criteriaOps(p, db);
  });
  const card = sb.rowsOf('git_change_events')[0];
  card.metadata = {
    criterionDeltas: tickDeltas([['REQ-001', 'A1'], ['REQ-002', 'B1']]),
    taskDeltas: { deltas: [{ nodeId: NODE, key: 'aaaa0001', displayId: 'T1', title: 'Build it', direction: 'tick' }], flagged: [] },
  };

  const first = await applyCardTicks(sb as never, PROJECT, structuredClone(card) as never, 'user-9');
  assertEquals([first.applied, first.requirements, first.tasksApplied], [1, ['REQ-001'], 1]);
  assertEquals(first.failed.map((f) => [f.requirementId, f.reason]), [['REQ-002', 'REQ-002 is locked']]);
  const meta1 = sb.rowsOf('git_change_events')[0].metadata as Row;
  assertEquals(meta1.criteriaApplied, undefined, 'the card is not marked applied while a write is missing');
  assertEquals((meta1.ticksApplied as Row).count, 1, 'the task tick that did apply is stamped');
  const a1Proof = structuredClone(crit(sb, 'REQ-001')[0].provenance);

  refuse = false;
  const second = await applyCardTicks(sb as never, PROJECT, structuredClone(sb.rowsOf('git_change_events')[0]) as never, 'user-9');
  assertEquals([second.applied, second.requirements, second.failed], [1, ['REQ-002'], []], 'only the criterion still unmet');
  assertEquals(crit(sb, 'REQ-001')[0].provenance, a1Proof, 'the first apply is not rewritten');
  assertEquals(crit(sb, 'REQ-002')[0].met, true);
  assertEquals(((sb.rowsOf('git_change_events')[0].metadata as Row).criteriaApplied as Row).count, 1, 'now the card is applied');
});
