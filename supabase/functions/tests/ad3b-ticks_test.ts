// V3 AD.3b (owner ruling 3, finding D19): ticks split by kind. Over MCP a
// criterion tick is never applied, at any Autonomy setting: it stays on the
// card, the change stays pending, and the receipt says a person applies it
// in the Git panel. A task tick follows the Tasks setting: Ask first refuses
// the accept, Propose leaves it on the card, Auto-apply applies it with
// apply_ticks. The person's apply records who applied it; a card shows which
// ticked criteria expect a test result.
import { handleResolveChange, handleGetPendingChanges } from '../mcp-server/tools/git.ts';
import { computeCriterionDeltas, parseTaskDocCriteria, applyTickDeltas } from '../_shared/criterion-deltas.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const AGENT: AuthResult = { userId: 'user-1', scopes: ['read', 'propose', 'write'], authMethod: 'api_key' };
const PROJECT = '11111111-1111-1111-1111-111111111111';
const CRITERION = { requirementId: 'REQ-001', text: 'orders persist', direction: 'tick', verification: 'automated' };
const TASK = { nodeId: 'n1', key: 'aaaa1111', displayId: 'T1', title: 'Scaffold', direction: 'tick' };

// deno-lint-ignore no-explicit-any
type Any = any;

function card(metadata: Record<string, unknown>) {
  return { id: 'e1', project_id: PROJECT, status: 'pending', commit_sha: 'abc', projects: { owner_id: 'user-1' }, metadata: { branchName: 'main', ...metadata } };
}

/** The card (read twice when it resolves), the Tasks setting, the writes. */
function world(metadata: Record<string, unknown>, tasks?: 0 | 1 | 2) {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: card(metadata), error: null });
  sb.script('git_change_events', 'select', { data: card(metadata), error: null });
  if (tasks !== undefined) sb.script('projects', 'select', { data: { automation_policy: { tasks } }, error: null });
  sb.script('task_items', 'select', { data: [], error: null });
  sb.script('task_items', 'upsert', { data: null, error: null });
  sb.script('git_change_events', 'update', { data: [{ id: 'e1' }], error: null });
  return sb;
}

const accept = (sb: FakeSupabase, applyTicks = true) => handleResolveChange(sb as never, AGENT, {
  change_event_id: 'e1', commit_sha: 'abc', resolution: 'accepted', ...(applyTicks ? { apply_ticks: true } : {}),
});

const criterionWrites = (sb: FakeSupabase) =>
  sb.calls.filter((c) => c.table === 'specification_requirements' && c.op !== 'select').length + sb.callsTo('rpc', 'apply_criteria_ops').length;

Deno.test('AD.3b: an agent\'s criterion tick stays on the card at every Tasks setting; the change stays pending for a person', async () => {
  for (const level of [0, 1, 2] as const) {
    const sb = world({ criterionDeltas: { deltas: [CRITERION], flagged: [] } }, level);
    const r = await accept(sb);
    assertEquals(r.success, true, `level ${level}: ${JSON.stringify(r)}`);
    const data = r.data as Any;
    assertEquals(data.resolution, 'pending', `level ${level}`);
    assertEquals(data.waitingForPerson, { criteria: 1, tasks: 0 });
    assert(String(data.message).includes("1 criterion tick is a person's to apply in the Git panel; an agent never applies one."), data.message);
    assertEquals(criterionWrites(sb), 0, `level ${level}: no criterion is written`);
    assert(!sb.callsTo('git_change_events', 'update').some((c) => (c.payload as Any).status), 'the card is not resolved');
    assert(!/[\u2013\u2014]/.test(data.message), 'no dashes in the receipt');
  }
});

Deno.test('AD.3b: Ask first refuses an accept carrying task ticks, and nothing is written', async () => {
  const sb = world({ taskDeltas: { deltas: [TASK], flagged: [] } }, 0);
  const r = await accept(sb);
  assertEquals(r.success, false);
  assert(String(r.error).includes('the Tasks setting is Ask first: a person applies them'), String(r.error));
  assertEquals(sb.calls.filter((c) => c.op !== 'select').length, 0);
});

Deno.test('AD.3b: Propose leaves task ticks on the card for a person', async () => {
  const sb = world({ taskDeltas: { deltas: [TASK], flagged: [] } }, 1);
  const r = await accept(sb);
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.resolution, 'pending');
  assertEquals(data.waitingForPerson, { criteria: 0, tasks: 1 });
  assert(String(data.message).includes('1 task tick waits for a person (the Tasks setting is Propose).'), data.message);
  assertEquals(sb.callsTo('task_items', 'upsert').length, 0, 'no task is marked done');
  assertEquals(sb.callsTo('git_change_events', 'update').length, 0, 'nothing to stamp');
});

Deno.test('AD.3b: Auto-apply marks task ticks done with apply_ticks, and refuses the accept without it', async () => {
  const without = world({ taskDeltas: { deltas: [TASK], flagged: [] } }, 2);
  const refused = await accept(without, false);
  assertEquals(refused.success, false);
  assert(String(refused.error).includes('Pass apply_ticks: true'), String(refused.error));

  const sb = world({ taskDeltas: { deltas: [TASK], flagged: [] } }, 2);
  const r = await accept(sb);
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as Any).resolution, 'accepted', 'nothing waits, so the card resolves');
  assertEquals((r.data as Any).tasksApplied, 1);
  assertEquals(sb.callsTo('task_items', 'upsert').length, 1);
});

Deno.test('AD.3b: a mixed card at Auto-apply: the task ticks land and are stamped, the criterion tick waits', async () => {
  const sb = world({ criterionDeltas: { deltas: [CRITERION], flagged: [] }, taskDeltas: { deltas: [TASK], flagged: [] } }, 2);
  const r = await accept(sb);
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.resolution, 'pending');
  assertEquals(data.tasksApplied, 1);
  assertEquals(data.criteriaApplied, 0);
  assertEquals(data.waitingForPerson, { criteria: 1, tasks: 0 });
  const stamp = sb.callsTo('git_change_events', 'update')[0].payload as Any;
  assert(!('status' in stamp), 'the card stays pending');
  assertEquals(stamp.metadata.ticksApplied.count, 1, 'the task ticks never apply twice');
  assert(!('criteriaApplied' in stamp.metadata), 'no criterion is stamped as applied');
  assertEquals(criterionWrites(sb), 0);
});

Deno.test('AD.3b: get_pending_changes names the branch the sync check reads', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Demo' }, error: null });
  sb.script('git_integrations', 'select', { data: null, error: null }); // the sweep: no integration row for it
  sb.script('git_change_events', 'select', { data: [], error: null });
  sb.script('git_integrations', 'select', { data: { default_branch: 'main' }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1', name: 'main', git_ref: 'trunk', is_primary: true }, error: null });
  const r = await handleGetPendingChanges(sb as never, AGENT, { project_id: PROJECT });
  assertEquals((r.data as Any).trackedBranch, 'trunk', 'the bound ref wins over the default branch');
});

Deno.test('AD.3b: a card knows which ticked criteria expect a test result; a person\'s apply is recorded as theirs', () => {
  const doc = ['## Requirements', '', '### REQ-001: Orders', '- [x] orders persist', '- [x] backups restore (manual)'].join('\n');
  const { deltas } = computeCriterionDeltas(parseTaskDocCriteria(doc), {
    'REQ-001': [{ text: 'orders persist' }, { text: 'backups restore', verification: 'manual' }],
  });
  assertEquals(deltas.map((d) => [d.text, d.verification]), [['orders persist', 'automated'], ['backups restore', 'manual']]);
  const { criteria } = applyTickDeltas([{ text: 'orders persist', met: false }], [deltas[0]], {
    source: 'git', commitSha: 'abc', actor: 'dev', appliedBy: 'user-9', at: 't',
  });
  assertEquals(criteria[0].provenance, { source: 'git', commitSha: 'abc', actor: 'dev', appliedBy: 'user-9', at: 't' });
});

Deno.test('AD.3b wiring: the Git panel apply passes the person; MCP never applies a criterion tick', () => {
  const pull = Deno.readTextFileSync(new URL('../git-pull/index.ts', import.meta.url));
  assert(pull.includes('return await handleApplyCriteria(integration, serviceClient, changeEventId, userId);'), 'the caller is passed');
  assert(/applyCriterionDeltas\(serviceClient, integration\.project_id, \{[\s\S]{0,200}appliedBy: userId,/.test(pull), 'and recorded');
  const git = Deno.readTextFileSync(new URL('../mcp-server/tools/git.ts', import.meta.url));
  assert(!git.includes('applyCriterionDeltas'), 'the MCP resolver has no criterion apply at all');
  const skill = Deno.readTextFileSync(new URL('../../../skills/nodespec-developer/SKILL.md', import.meta.url));
  assert(skill.includes('**Work on the branch NodeSpec tracks.**') && skill.includes('`resolve_change` never does, at any setting'), 'the skill says both');
  assert(!skill.includes('that single call flips the ticked criteria met'), 'the old instruction is gone');
});
