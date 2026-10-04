// V3 P2 (task 2.5): the lighter "in play" marker on list_requirements —
// DERIVED at read time from active task-level leases through the stored
// chain (lease -> task_items.node_id -> specification_mappings), never
// stored twice. Pins: a held task on a mapped node lights the
// requirement with its holders; unmapped-node holds light nothing;
// no active leases means no extra queries fire on task_items.
import { handleListRequirements } from '../mcp-server/tools/requirements.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const N_API = '33333333-3333-4333-8333-333333333333';
const N_OTHER = '44444444-4444-4444-8444-444444444444';
const TASK_HELD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_ELSEWHERE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const READ = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] } as never;

function prelude(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: [
      { id: 'r1', requirement_id: 'REQ-001', name: 'Store tasks', description: 'a', category: 'functional', status: 'pending', acceptance_criteria: null, locked: null, created_at: 't', updated_at: 't' },
      { id: 'r2', requirement_id: 'REQ-002', name: 'Unmapped', description: 'b', category: 'functional', status: 'pending', acceptance_criteria: null, locked: null, created_at: 't', updated_at: 't' },
    ],
    error: null,
  });
  // r1 maps to the API node; r2 maps to nothing.
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: 'r1', node_id: N_API }], error: null });
}

Deno.test('in play: an actively held task on a mapped node lights the requirement with its holders', async () => {
  const sb = new FakeSupabase();
  prelude(sb);
  sb.script('agent_checkouts', 'select', {
    data: [
      { task_item_id: TASK_HELD, holder_label: 'claude · test-runner' },
      { task_item_id: TASK_ELSEWHERE, holder_label: 'claude · bench' },
    ],
    error: null,
  });
  sb.script('task_items', 'select', {
    data: [
      { id: TASK_HELD, node_id: N_API },
      { id: TASK_ELSEWHERE, node_id: N_OTHER }, // held, but its node maps to no requirement
    ],
    error: null,
  });

  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const rows = (r.data as any).requirements;
  const r1 = rows.find((x: { requirementId: string }) => x.requirementId === 'REQ-001');
  const r2 = rows.find((x: { requirementId: string }) => x.requirementId === 'REQ-002');
  assertEquals(r1.inPlay, true);
  assertEquals(r1.heldBy, ['claude · test-runner'], 'only holders on MAPPED nodes count');
  assertEquals(r2.inPlay, false);
  assertEquals(r2.heldBy, []);
});

Deno.test('in play: quiet when nothing is held — and the task lookup never fires', async () => {
  const sb = new FakeSupabase();
  prelude(sb);
  sb.script('agent_checkouts', 'select', { data: [], error: null });

  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const rows = (r.data as any).requirements;
  assert(rows.every((x: { inPlay: boolean }) => x.inPlay === false));
  assertEquals(sb.callsTo('task_items', 'select').length, 0, 'no leases, no second query');
});

// AL.13 (owner 2026-10-02: a requirement tracing to several outcomes showed
// one): list_requirements names every outcome behind a requirement, oldest
// first, each with its workflow, from one batched read of outcome_derivations.
Deno.test('AL.13: derivedFrom names every outcome behind a requirement, oldest first, each with its workflow; a failed read leaves it empty', async () => {
  const sb = new FakeSupabase();
  prelude(sb);
  sb.script('agent_checkouts', 'select', { data: [], error: null });
  sb.script('outcome_derivations', 'select', {
    data: [
      { candidate_id: 'c1', requirement_row_id: 'r1', created_at: '2026-09-10T00:00:00Z', requirement_candidates: { name: 'Warehouse ships every confirmed order', workflow_id: 'wf-fulfil' } },
      // the join arrives as an array on some PostgREST versions
      { candidate_id: 'c2', requirement_row_id: 'r1', created_at: '2026-09-11T00:00:00Z', requirement_candidates: [{ name: 'A sale becomes a posted invoice', workflow_id: null }] },
      // the same outcome twice names it once
      { candidate_id: 'c1', requirement_row_id: 'r1', created_at: '2026-09-12T00:00:00Z', requirement_candidates: { name: 'Warehouse ships every confirmed order', workflow_id: 'wf-fulfil' } },
      { candidate_id: 'c3', requirement_row_id: 'r2', created_at: '2026-09-12T00:00:00Z', requirement_candidates: null },
    ],
    error: null,
  });
  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const rows = (r.data as any).requirements;
  assertEquals(rows.find((x: { requirementId: string }) => x.requirementId === 'REQ-001').derivedFrom, [
    { candidateId: 'c1', name: 'Warehouse ships every confirmed order', workflowId: 'wf-fulfil' },
    { candidateId: 'c2', name: 'A sale becomes a posted invoice', workflowId: null },
  ]);
  assertEquals(rows.find((x: { requirementId: string }) => x.requirementId === 'REQ-002').derivedFrom, [], 'a derivation whose outcome is gone names nothing');
  const read = sb.callsTo('outcome_derivations', 'select')[0];
  assertEquals(read.filters.filter((f) => f.method === 'eq' || f.method === 'in').map((f) => f.args), [['project_id', PROJECT.id], ['requirement_row_id', ['r1', 'r2']]], 'one read, for every requirement listed');

  const failed = new FakeSupabase();
  prelude(failed);
  failed.script('agent_checkouts', 'select', { data: [], error: null });
  failed.script('outcome_derivations', 'select', { data: null, error: { message: 'timeout' } });
  const r2 = await handleListRequirements(failed as never, READ, { project_id: PROJECT.id });
  assertEquals(r2.success, true);
  // deno-lint-ignore no-explicit-any
  assert((r2.data as any).requirements.every((x: { derivedFrom: unknown[] }) => x.derivedFrom.length === 0));

  // nothing listed, nothing read
  const empty = new FakeSupabase();
  empty.script('projects', 'select', { data: PROJECT, error: null });
  empty.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  empty.script('specification_requirements', 'select', { data: [], error: null });
  empty.script('specification_mappings', 'select', { data: [], error: null });
  empty.script('agent_checkouts', 'select', { data: [], error: null });
  const r3 = await handleListRequirements(empty as never, READ, { project_id: PROJECT.id });
  assertEquals(r3.success, true);
  assertEquals(empty.callsTo('outcome_derivations', 'select').length, 0);
});
