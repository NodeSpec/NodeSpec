// AL.29 (gap 2): the steps an agent writes under a work order survive every
// regeneration of the task doc. Production: steps written under work orders
// were wiped by the next generate_task_docs or push, which kept only
// Implementation Context and Added Tasks; the bench saw a regeneration with no
// change file a proposal that removed them.
//
// Steps are indented checkbox lines under a work order (the generator writes
// none). They follow the work order's anchor key; the steps of a work order
// that was reworded or removed go to "Steps to review". Run against the real
// generator, the push gate and generate_task_docs.
import {
  generateTaskDocument,
  carryAgentTaskContent,
  computeTaskContextFingerprint,
} from '../_shared/task-document-generator.ts';
import {
  parseTaskDocTasks,
  taskDocDetails,
  preserveAddedTasksSection,
  STEPS_TO_REVIEW_HEADING,
  STEP_FORMAT,
} from '../_shared/task-deltas.ts';
import { wrapField } from '../_shared/untrusted-data.ts';
import { refreshTaskPackets } from '../_shared/packet-freshness.ts';
import { handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { sweepAuto } from '../mcp-server/tools/auto-apply.ts';
import { applyPatches } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import type { CanvasAcceptDeps } from '../mcp-server/tools/canvas-accept.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, MemorySupabase, migrationColumns, assert, assertEquals, type Row } from './helpers.ts';

const N_DB = 'a2920000-0000-4000-8000-0000000000a1';
const C1 = 'a nightly backup of the task store is taken';
const C2 = 'a backup can be restored to a fresh instance';
const C2_REWORDED = 'a backup restores to a fresh instance within an hour';

// deno-lint-ignore no-explicit-any
const CATALOGS: any = {
  nodeRoles: {
    database: { id: 'database', label: 'Database', description: 'Data store', nature: 'build', palette_category: 'data', is_container: false, container_layer: null, capability_tags: [] },
  },
  technologies: {}, deploymentTargets: {}, legacyMappings: {}, cloudPatterns: {}, scopeArchetypes: {},
};
// deno-lint-ignore no-explicit-any
const graph = (): any => ({ nodes: { [N_DB]: { id: N_DB, type: 'database', label: 'Orders DB', metadata: {}, ports: [] } }, edges: {}, contracts: {}, artifacts: {} });
const req = (criteria: string[]) => ({ requirementId: 'REQ-003', name: 'Back up tasks', description: 'The task store is backed up', category: 'functional', status: 'approved', acceptanceCriteria: criteria.map((text) => ({ text })) });
const generate = (criteria: string[]) => generateTaskDocument({
  node: graph().nodes[N_DB], graph: graph(), catalogs: CATALOGS, requirements: [req(criteria)], requirementNodeMap: { 'REQ-003': [N_DB] },
} as never);

const STEPS_A = ['  - [ ] Schedule pg_dump at 02:00 UTC', '    Use the replica, never the primary.', '  - [x] Write the dump to the backups bucket'];
const STEPS_B = ['  - [ ] Restore the latest dump into a scratch instance', '  - [ ] Compare row counts with the source'];

/** The doc as an agent leaves it: steps under the work order that quotes `criterion`. */
function withSteps(doc: string, criterion: string, steps: string[]): string {
  const lines = doc.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- [') && l.includes(`"${criterion}"`));
  assert(at >= 0, `a work order quotes "${criterion}"`);
  let end = at + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  lines.splice(end, 0, ...steps);
  return lines.join('\n');
}
const keyOf = (doc: string, criterion: string) => parseTaskDocTasks(doc).tasks.find((t) => t.title.includes(`"${criterion}"`))!.key!;
/** The lines directly under the work order keyed `key` (the record's reader). */
const under = (doc: string, key: string) => taskDocDetails(doc).get(key) ?? [];

Deno.test('AL.29: the generator writes no step lines, so every indented checkbox under a work order is the agent\'s', () => {
  const doc = generate([C1, C2]);
  assertEquals(doc.split('\n').filter((l) => /^\s+- \[[ xX]\] /.test(l)), []);
});

Deno.test('AL.29: regenerating an unchanged doc keeps every step under its work order, byte for byte', () => {
  const stored = withSteps(withSteps(generate([C1, C2]), C1, STEPS_A), C2, STEPS_B);
  const again = carryAgentTaskContent(generate([C1, C2]), stored);
  assertEquals(again, stored, 'nothing to file: the regenerated doc is the stored one');
  assertEquals(under(again, keyOf(again, C1)).filter((l) => l.startsWith('- [')).length, 2, 'the record reads them under their work order');
  assertEquals(parseTaskDocTasks(again).tasks.map((t) => [t.displayId, t.key, t.checked]), parseTaskDocTasks(generate([C1, C2])).tasks.map((t) => [t.displayId, t.key, t.checked]),
    'the steps are never work orders or ticks');
});

Deno.test('AL.29: a reworded criterion leaves the other work order\'s steps in place and keeps its own for review, once', () => {
  const stored = withSteps(withSteps(generate([C1, C2]), C1, STEPS_A), C2, STEPS_B);
  const oldC2 = parseTaskDocTasks(stored).tasks.find((t) => t.title.includes(`"${C2}"`))!;
  const once = carryAgentTaskContent(generate([C1, C2_REWORDED]), stored);

  const kC1 = keyOf(once, C1);
  assertEquals(kC1, keyOf(stored, C1), 'the unchanged work order keeps its key');
  for (const s of STEPS_A) assert(once.includes(`${s}\n`) || once.endsWith(s), `kept: ${s}`);
  assert(under(once, kC1).some((l) => l.includes('Schedule pg_dump')), 'under its own work order');
  assertEquals(under(once, keyOf(once, C2_REWORDED)).filter((l) => l.startsWith('- [')), [], 'the reworded work order starts with no steps');

  const review = once.slice(once.indexOf(STEPS_TO_REVIEW_HEADING));
  assert(once.includes(STEPS_TO_REVIEW_HEADING), 'a review block');
  assert(review.includes(`Written for ${oldC2.displayId}: ${oldC2.title}`), 'names the work order the steps were written for');
  for (const s of STEPS_B) assert(review.includes(s), `for review: ${s}`);
  assert(!under(once, parseTaskDocTasks(once).tasks.at(-1)!.key!).some((l) => l.includes('Restore the latest dump')), 'review steps belong to no work order');

  const twice = carryAgentTaskContent(generate([C1, C2_REWORDED]), once);
  assertEquals(twice, once, 'the next regeneration keeps the review block as it is, not twice');
});

Deno.test('AL.29: only the agent\'s lines move; a line it wrote under a step travels with that step', () => {
  const stored = withSteps(generate([C1]), C1, ['  - [ ] Turn on WAL archiving', '    Keep 7 days.', '  Plain note the generator could have written']);
  const out = carryAgentTaskContent(generate([C1]), stored);
  assert(out.includes('  - [ ] Turn on WAL archiving\n    Keep 7 days.'), 'the step and its deeper line');
  assert(!out.includes('Plain note the generator could have written'), 'an indented line that is not a step or under one is the generator\'s to write');
});

Deno.test('AL.29: a blank line inside a dropped Added Task no longer hands its details to the task before it', () => {
  const K = 'T1';
  const generated = '# Task: X\n\n## Implementation Tasks\n\n- [ ] **T1 \u2014 Build it** <!-- t:aaaa0001 -->\n\n## Requirements\n';
  const stored = [
    '# Task: X', '', '## Implementation Tasks', '', `- [ ] **${K} \u2014 Old** <!-- t:aaaa0009 -->`, '',
    '## Added Tasks', '',
    '- [ ] **T2 \u2014 Keep me** <!-- t:bbbb0001 -->', '  ↳ serves: REQ-001 "a"',
    '- [ ] **T3 \u2014 Build it** <!-- t:aaaa0001 -->', '  ↳ serves: REQ-001 "b"', '', '  a detail of the dropped task',
    '', '## Requirements', '',
  ].join('\n');
  const out = preserveAddedTasksSection(generated, stored);
  assert(out.includes('Keep me'), 'the kept task stays');
  assert(!out.includes('a detail of the dropped task'), 'the dropped task leaves with all its lines');
});

// ── the push gate ──────────────────────────────────────────────────────────

Deno.test('AL.29 push gate: a stale doc is regenerated around the agent\'s steps', async () => {
  const sb = new FakeSupabase();
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: null, error: null });
  sb.script('task_items', 'select', { data: [], error: null });
  sb.script('task_items', 'select', { data: [], error: null });
  // deno-lint-ignore no-explicit-any
  const g: any = { nodes: { [N_DB]: { id: N_DB, type: 'database', label: 'Orders DB', metadata: {}, ports: [] } }, edges: {}, contracts: {}, artifacts: {} };
  const fresh = generateTaskDocument({ node: g.nodes[N_DB], graph: g, catalogs: { ...CATALOGS, nodeRoles: {} }, requirements: [] } as never);
  const first = parseTaskDocTasks(fresh).tasks[0];
  const stored = (() => {
    const lines = fresh.split('\n');
    const at = lines.findIndex((l) => l.includes(`<!-- t:${first.key} -->`));
    let end = at + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    lines.splice(end, 0, ...STEPS_A);
    return lines.join('\n');
  })();
  const staleFp = computeTaskContextFingerprint({ id: N_DB, label: 'Orders DB', type: 'database', metadata: {} } as never, g, []);
  g.artifacts['doc-1'] = { id: 'doc-1', nodeId: N_DB, kind: 'task', path: '.nodespec/tasks/orders-db.task.md', content: stored, metadata: { taskContextFingerprint: staleFp } };
  // what changed since: an API now reads the store through a contract
  const N_API = 'a2920000-0000-4000-8000-0000000000a2';
  g.nodes[N_API] = { id: N_API, type: 'backend-service', label: 'Orders API', metadata: {}, ports: [] };
  g.edges.e1 = { id: 'e1', source: N_API, target: N_DB, contractId: 'c1' };
  g.contracts.c1 = { id: 'c1', kind: 'sql', name: 'Order queries' };
  const r = await refreshTaskPackets(sb as never, 'proj-1', g);
  assertEquals(r.refreshed, 1, JSON.stringify(r));
  const out = String(g.artifacts['doc-1'].content);
  assert(out !== stored && out.includes('Order queries'), 'the doc was regenerated');
  assert(under(out, first.key!).some((l) => l.includes('Schedule pg_dump')), 'the steps are still under their work order');
  for (const s of STEPS_A) assert(out.includes(s), `kept: ${s}`);
});

// ── generate_task_docs, end to end ─────────────────────────────────────────

const P = 'a2920000-0000-4000-8000-000000000001';
const B = 'a2920000-0000-4000-8000-000000000002';
const OWNER = 'a2920000-0000-4000-8000-000000000003';
const SPEC = 'a2920000-0000-4000-8000-000000000004';
const REQ_ROW = 'a2920000-0000-4000-8000-000000000005';
const KEY = { userId: OWNER, keyId: 'a2920000-0000-4000-8000-0000000000b1', authMethod: 'api_key', scopes: ['read', 'write', 'propose'] } as AuthResult;
const noGit: CanvasAcceptDeps = { repoReader: () => Promise.resolve(null), ancestry: () => Promise.resolve(async () => 'ahead' as const) };
const T = '2026-10-09T00:00:00.000Z';

function world(criteria: string[]) {
  const db = new MemorySupabase();
  for (const t of ['ai_proposals', 'graph_patches', 'graph_snapshots', 'specification_mappings', 'branches']) db.columns(t, migrationColumns(t));
  const base = applyPatches(createEmptyGraph(), [
    { type: 'add_node', metadata: { id: crypto.randomUUID(), actorType: 'human', summary: 'add', timestamp: T }, payload: { id: N_DB, type: 'database', label: 'Orders DB' } },
  ] as never).graph!;
  db.table('projects', [{ id: P, name: 'Bakery', owner_id: OWNER, automation_policy: { architecture: 2, tasks: 2 }, metadata: {} }]);
  db.table('branches', [{ id: B, project_id: P, name: 'main', is_primary: true }]);
  db.table('graph_snapshots', [{ id: crypto.randomUUID(), project_id: P, branch_id: B, graph_data: base, version: base.version, hash: base.hash, patch_sequence: 0, created_at: T }]);
  db.table('project_specifications', [{ id: SPEC, project_id: P, vision: '', locked_nodes: [], preferences: {}, created_at: T }]);
  db.table('specification_requirements', [{ id: REQ_ROW, specification_id: SPEC, requirement_id: 'REQ-003', name: 'Back up tasks', description: 'The task store is backed up', category: 'functional', status: 'pending', acceptance_criteria: criteria.map((text) => ({ text })), confirmed: false, locked: false }]);
  db.table('specification_mappings', [{ id: crypto.randomUUID(), specification_id: SPEC, requirement_id: REQ_ROW, node_id: N_DB, mapping_type: 'implements', created_at: T }]);
  for (const t of ['ai_proposals', 'ai_runs', 'graph_patches', 'test_cases', 'task_items', 'agent_checkouts', 'project_members', 'git_change_events', 'work_plans',
    'node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes',
    'project_constraints', 'workflows', 'workflow_steps', 'requirement_candidates', 'stripe_subscriptions', 'user_settings', 'outcome_derivations']) db.table(t, []);
  db.table('mcp_api_keys', [{ id: KEY.keyId, user_id: OWNER, scopes: ['read', 'write', 'propose'], revoked_at: null, expires_at: null }]);
  db.unique('graph_patches', ['branch_id', 'sequence']);
  db.fn('get_next_patch_sequence', (p, d) => Math.max(0, ...d.rowsOf('graph_patches').filter((r) => r.branch_id === p.p_branch_id).map((r) => Number(r.sequence))) + 1);
  db.fn('apply_criteria_ops', () => ({ criteria: [] }));
  db.fn('graph_reference_ids', () => ({ nodes: [N_DB], contracts: [] }));
  return db;
}
const head = (db: MemorySupabase) => db.rowsOf('graph_snapshots').slice().sort((a, b) => Number(b.patch_sequence) - Number(a.patch_sequence))[0] as { graph_data: { artifacts: Record<string, Row & { content: string; kind: string }> } };
const storedDoc = (db: MemorySupabase) => Object.values(head(db).graph_data.artifacts).find((a) => a.kind === 'task')!;
const gen = (db: MemorySupabase) => handleGenerateTaskDocs(db as never, KEY, { project_id: P, branch_id: B } as never);

Deno.test('AL.29 generate_task_docs: with nothing changed the doc and its steps are left as they are and nothing is filed', async () => {
  const db = world([C1, C2]);
  assert((await gen(db)).success);
  await sweepAuto(db as never, P, noGit);
  const doc = storedDoc(db);
  doc.content = withSteps(doc.content, C1, STEPS_A); // the agent's accepted edit, as the snapshot holds it
  const before = db.rowsOf('ai_proposals').length;

  const r = await gen(db);
  assert(r.success, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const d = r.data as any;
  assertEquals([d.proposalId, d.alreadyFresh], [undefined, 1], JSON.stringify(d).slice(0, 300));
  assertEquals(db.rowsOf('ai_proposals').length, before, 'nothing filed');
  assert(storedDoc(db).content.includes('Schedule pg_dump at 02:00 UTC'));
});

Deno.test('AL.29 generate_task_docs: a reworded criterion files a refresh that keeps the other steps under their work order and these for review', async () => {
  const db = world([C1, C2]);
  assert((await gen(db)).success);
  await sweepAuto(db as never, P, noGit);
  const doc = storedDoc(db);
  doc.content = withSteps(withSteps(doc.content, C1, STEPS_A), C2, STEPS_B);
  db.rowsOf('specification_requirements')[0].acceptance_criteria = [{ text: C1 }, { text: C2_REWORDED }];

  assert((await gen(db)).success);
  await sweepAuto(db as never, P, noGit);
  const out = storedDoc(db).content;
  assert(under(out, keyOf(out, C1)).some((l) => l.includes('Schedule pg_dump')), 'C1 keeps its steps');
  assert(out.includes(STEPS_TO_REVIEW_HEADING) && out.slice(out.indexOf(STEPS_TO_REVIEW_HEADING)).includes('Restore the latest dump'), 'C2\'s steps are kept for review');
});

// AL.29 phase 3.3: the response says what each doc still asks of the agent.
Deno.test('AL.29 generate_task_docs: the response names the work orders with no steps, then the steps kept for review, with the line format', async () => {
  const db = world([C1, C2]);
  const first = await gen(db);
  assert(first.success, JSON.stringify(first));
  // deno-lint-ignore no-explicit-any
  let d = first.data as any;
  const filed = db.rowsOf('ai_proposals')[0].patches as Array<{ patch: { type: string; payload: { id: string; path: string; content: string } } }>;
  const add = filed.find((p) => p.patch.type === 'add_artifact')!.patch.payload;
  const open = parseTaskDocTasks(add.content).tasks.filter((t) => !t.checked && t.key);
  assertEquals(d.workOrdersWithoutSteps, [{
    nodeId: N_DB, label: 'Orders DB', artifactId: add.id, path: add.path,
    workOrders: open.map((t) => ({ id: t.displayId, key: t.key, title: wrapField(t.title) })),
  }], 'the new doc: every open work order, by the id the agent writes into');
  assertEquals(d.stepFormat, STEP_FORMAT);
  assertEquals(d.stepsToReview, undefined);

  await sweepAuto(db as never, P, noGit);
  const doc = storedDoc(db);
  // the agent writes steps under every work order but C2's
  let content = doc.content;
  for (const t of open) {
    if (t.title.includes(`"${C2}"`)) continue;
    const lines = content.split('\n');
    const at = lines.findIndex((l) => l.includes(`<!-- t:${t.key} -->`));
    let end = at + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    lines.splice(end, 0, `  - [ ] Step for ${t.displayId}`);
    content = lines.join('\n');
  }
  doc.content = content;
  d = (await gen(db)).data;
  assertEquals(d.alreadyFresh, 1);
  assertEquals(d.workOrdersWithoutSteps?.[0]?.workOrders?.map((w: { key: string }) => w.key), [keyOf(content, C2)], 'only C2 is left');
  assertEquals(d.workOrdersWithoutSteps[0].artifactId, doc.id);

  doc.content = withSteps(content, C2, STEPS_B);
  d = (await gen(db)).data;
  assertEquals([d.workOrdersWithoutSteps, d.stepsToReview, d.stepFormat], [undefined, undefined, undefined], 'nothing is asked');

  db.rowsOf('specification_requirements')[0].acceptance_criteria = [{ text: C1 }, { text: C2_REWORDED }];
  d = (await gen(db)).data;
  assertEquals(d.refreshed, 1);
  assertEquals(d.stepsToReview, [{ nodeId: N_DB, label: 'Orders DB', artifactId: doc.id, path: doc.path, steps: 2 }], 'C2\'s two steps wait for review');
  assertEquals(d.workOrdersWithoutSteps?.[0]?.workOrders?.map((w: { title: string }) => w.title.includes(C2_REWORDED)), [true], 'the reworded work order is listed');
  assertEquals(d.stepFormat, STEP_FORMAT);

  // The refresh lands and the agent writes the reworded work order's steps; the review block is still there.
  await sweepAuto(db as never, P, noGit);
  const after = storedDoc(db);
  after.content = withSteps(after.content, C2_REWORDED, ['  - [ ] Restore within the hour']);
  d = (await gen(db)).data;
  assertEquals([d.alreadyFresh, d.workOrdersWithoutSteps], [1, undefined]);
  assertEquals(d.stepsToReview?.[0]?.steps, 2);
  assertEquals(d.stepFormat, STEP_FORMAT, 'the format comes with the review block too');
});
