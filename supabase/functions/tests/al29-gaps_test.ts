// AL.29 phase 3.3: the tools that serve a task doc or a test plan say what it
// still asks of an agent: the open work orders with no step under them, the
// test cases with no statement under them, and how many lines wait for review
// after a reword. These read the real generators' output, as an agent gets it.
import { generateTaskDocument, carryAgentTaskContent } from '../_shared/task-document-generator.ts';
import { parseTaskDocTasks, stepGaps } from '../_shared/task-deltas.ts';
import { generateTestDocument, carryAgentPlanContent, statementGaps } from '../_shared/test-document-generator.ts';
import { assert, assertEquals } from './helpers.ts';

// ── task docs ───────────────────────────────────────────────────────────────

const N_DB = 'a2930000-0000-4000-8000-0000000000a1';
const C1 = 'a nightly backup of the task store is taken';
const C2 = 'a backup can be restored to a fresh instance';
const C2_REWORDED = 'a backup restores to a fresh instance within an hour';
// deno-lint-ignore no-explicit-any
const TASK_CATALOGS: any = {
  nodeRoles: { database: { id: 'database', label: 'Database', description: 'Data store', nature: 'build', palette_category: 'data', is_container: false, container_layer: null, capability_tags: [] } },
  technologies: {}, deploymentTargets: {}, legacyMappings: {}, cloudPatterns: {}, scopeArchetypes: {},
};
// deno-lint-ignore no-explicit-any
const dbGraph = (): any => ({ nodes: { [N_DB]: { id: N_DB, type: 'database', label: 'Orders DB', metadata: {}, ports: [] } }, edges: {}, contracts: {}, artifacts: {} });
const taskDoc = (criteria: string[]) => generateTaskDocument({
  node: dbGraph().nodes[N_DB], graph: dbGraph(), catalogs: TASK_CATALOGS,
  requirements: [{ requirementId: 'REQ-003', name: 'Back up tasks', description: 'Backed up', category: 'functional', status: 'approved', acceptanceCriteria: criteria.map((text) => ({ text })) }],
  requirementNodeMap: { 'REQ-003': [N_DB] },
} as never);

/** The doc with `lines` under the work order whose title quotes `criterion`, after its own lines. */
function underOrder(doc: string, criterion: string, lines: string[]): string {
  const all = doc.split('\n');
  const at = all.findIndex((l) => l.startsWith('- [') && l.includes(`"${criterion}"`));
  assert(at >= 0, `a work order quotes "${criterion}"`);
  let end = at + 1;
  while (end < all.length && /^\s+\S/.test(all[end])) end++;
  all.splice(end, 0, ...lines);
  return all.join('\n');
}
const keyOf = (doc: string, criterion: string) => parseTaskDocTasks(doc).tasks.find((t) => t.title.includes(`"${criterion}"`))!.key!;
const openKeys = (doc: string) => parseTaskDocTasks(doc).tasks.filter((t) => !t.checked && t.key).map((t) => t.key!);

Deno.test('AL.29 stepGaps: every open work order of a fresh doc is listed, in order, and nothing waits for review', () => {
  const doc = taskDoc([C1, C2]);
  const gaps = stepGaps(doc);
  assert(openKeys(doc).length >= 3, 'setup: the doc has its work orders');
  assertEquals(gaps.withoutSteps.map((w) => w.key), openKeys(doc));
  const c1 = gaps.withoutSteps.find((w) => w.key === keyOf(doc, C1))!;
  assert(/^T\d+$/.test(c1.id) && c1.title.includes(C1), JSON.stringify(c1));
  assertEquals(gaps.toReview, 0);
});

Deno.test('AL.29 stepGaps: a work order with a step, or ticked done, is not listed; a detail line is not a step', () => {
  let doc = underOrder(taskDoc([C1, C2]), C1, ['  - [ ] Schedule pg_dump at 02:00 UTC']);
  const k2 = keyOf(doc, C2);
  doc = doc.split('\n').map((l) => (l.includes(`<!-- t:${k2} -->`) ? l.replace('- [ ]', '- [x]') : l)).join('\n');
  const gaps = stepGaps(doc);
  const listed = gaps.withoutSteps.map((w) => w.key);
  assert(!listed.includes(keyOf(doc, C1)), 'C1 has a step');
  assert(!listed.includes(k2), 'C2 is done');
  assertEquals(listed, openKeys(doc).filter((k) => k !== keyOf(doc, C1)));
  // the generator's own indented lines (details, serves) are not steps
  const fresh = taskDoc([C1, C2]);
  assert(fresh.split('\n').some((l, i, all) => /^\s+\S/.test(l) && all[i - 1]?.includes(`<!-- t:${keyOf(fresh, C1)} -->`)), 'setup: a work order carries generated detail lines');
  assert(stepGaps(fresh).withoutSteps.some((w) => w.key === keyOf(fresh, C1)));
});

Deno.test('AL.29 stepGaps: after a reword the steps kept for review are counted, and the reworded work order is listed', () => {
  const stored = underOrder(underOrder(taskDoc([C1, C2]), C1, ['  - [ ] Schedule pg_dump']), C2,
    ['  - [ ] Restore the latest dump', '    into a scratch instance', '  - [x] Compare row counts']);
  const out = carryAgentTaskContent(taskDoc([C1, C2_REWORDED]), stored);
  const gaps = stepGaps(out);
  assertEquals(gaps.toReview, 2, 'two steps (the detail under one is not a step)');
  const listed = gaps.withoutSteps.map((w) => w.key);
  assert(listed.includes(keyOf(out, C2_REWORDED)), 'the reworded work order has no step yet');
  assert(!listed.includes(keyOf(out, C1)), 'C1 kept its step');
});

// ── test plans ─────────────────────────────────────────────────────────────

const N1 = 'a2930000-0000-4000-8000-0000000000b1';
const N2 = 'a2930000-0000-4000-8000-0000000000b2';
const P1 = 'a nightly backup is taken';
const P2 = 'a backup restores into an empty database';
const P2_REWORDED = 'a backup restores into an empty database within one hour';
const PB = 'the dump feed lists every backup';
const PM = 'an operator restored a backup by hand';
// deno-lint-ignore no-explicit-any
const PLAN_CATALOGS: any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };
// deno-lint-ignore no-explicit-any
const planGraph = (): any => ({
  nodes: {
    [N1]: { id: N1, label: 'Vault', type: 'database', ports: [] },
    [N2]: { id: N2, label: 'Scheduler', type: 'backend-service', ports: [] },
  },
  // a contract with no schema: a criterion that names it is blocked until it has one
  edges: { e1: { id: 'e1', source: N2, target: N1, contractId: 'c1' } },
  contracts: { c1: { id: 'c1', name: 'Dump Feed', kind: 'rest' } },
  artifacts: {},
});
type Crit = { text: string; verification?: 'manual' };
const plan = (criteria: Crit[]) => generateTestDocument({
  requirement: { requirementId: 'REQ-003', name: 'Back up tasks', description: 'Backed up', category: 'functional', acceptanceCriteria: criteria.map((c) => ({ ...c, met: false })) } as never,
  graph: planGraph(), catalogs: PLAN_CATALOGS, mappedNodes: [{ nodeId: N1, label: 'Vault', role: 'database' }] as never, sourceArtifacts: [],
});
function underCase(doc: string, acId: string, lines: string[]): string {
  const all = doc.split('\n');
  const at = all.findIndex((l) => l.startsWith(`#### ${acId}:`));
  assert(at >= 0, `no heading ${acId}`);
  let end = at + 1;
  while (end < all.length && all[end].trim() !== '' && !all[end].startsWith('#')) end++;
  all.splice(end, 0, ...lines);
  return all.join('\n');
}
function underManual(doc: string, acId: string, lines: string[]): string {
  const all = doc.split('\n');
  const at = all.findIndex((l) => l.startsWith(`- [ ] ${acId} `));
  assert(at >= 0, `no manual item ${acId}`);
  all.splice(at + 1, 0, ...lines.map((l) => `  ${l}`));
  return all.join('\n');
}
const CRITERIA: Crit[] = [{ text: P1 }, { text: P2 }, { text: PB }, { text: PM, verification: 'manual' }];

Deno.test('AL.29 statementGaps: every case of a fresh plan is listed with its criterion and lane, except one blocked by a schema', () => {
  const doc = plan(CRITERIA);
  const blocked = doc.split('\n').findIndex((l) => l.startsWith('#### AC-REQ-003-3:'));
  assert(doc.split('\n')[blocked + 1].startsWith('[blocked by schema'), 'setup: the case naming the dump feed is blocked');
  const gaps = statementGaps(doc);
  assertEquals(gaps.withoutStatements, [
    { id: 'AC-REQ-003-1', criterion: P1, lane: 'automated' },
    { id: 'AC-REQ-003-2', criterion: P2, lane: 'automated' },
    { id: 'AC-REQ-003-4', criterion: PM, lane: 'manual' },
  ]);
  assertEquals(gaps.toReview, 0);
});

Deno.test('AL.29 statementGaps: a case with a statement is not listed, a manual one only with an indented check', () => {
  let doc = underCase(plan(CRITERIA), 'AC-REQ-003-1', ['- [ ] Given the job ran, when the bucket is listed, then a dump dated today is present']);
  // under a manual item only an indented line is its check (the carry keeps no other):
  // not an unindented checkbox, and not an indented one after prose has ended the item
  for (const after of [['- [ ] Given a dump, when restored by hand, then it works'], ['Some prose after the item.', '  - [ ] Given a dump, when restored by hand, then it works']]) {
    const all = doc.split('\n');
    all.splice(all.findIndex((l) => l.startsWith('- [ ] AC-REQ-003-4 ')) + 1, 0, ...after);
    assertEquals(statementGaps(all.join('\n')).withoutStatements.map((c) => c.id), ['AC-REQ-003-2', 'AC-REQ-003-4'], after.join(' / '));
  }
  doc = underManual(plan(CRITERIA), 'AC-REQ-003-4', ['- [ ] Given a dump, when an operator restores it by hand, then the tasks are back']);
  assertEquals(statementGaps(doc).withoutStatements.map((c) => c.id), ['AC-REQ-003-1', 'AC-REQ-003-2']);
});

Deno.test('AL.29 statementGaps: after a reword the statements kept for review are counted, and the reworded case is listed', () => {
  const stored = underCase(underCase(plan(CRITERIA), 'AC-REQ-003-1', ['- [ ] Given A, when B, then C']), 'AC-REQ-003-2',
    ['- [ ] Given an empty database, when the dump is restored, then every row is back', '- [ ] Given a restore, when it ends, then it took under an hour']);
  const out = carryAgentPlanContent(plan([{ text: P1 }, { text: P2_REWORDED }, { text: PB }, { text: PM, verification: 'manual' }]), stored);
  const gaps = statementGaps(out);
  assertEquals(gaps.toReview, 2);
  assertEquals(gaps.withoutStatements.map((c) => [c.id, c.criterion]), [['AC-REQ-003-2', P2_REWORDED], ['AC-REQ-003-4', PM]]);
});
