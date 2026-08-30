// S1-3 chunk 3: regression tests for the `git` tool bucket, extracted verbatim from
// mcp-server/index.ts into mcp-server/tools/git.ts. Exercises the real handlers against a
// FakeSupabase, including the cross-bucket path where resolve_change reconciles accepted
// patches through the proposals bucket. (Logic preservation only; module-graph boot is
// verified on the live edge runtime, per the S1-2 lesson.)
import { handleGetPendingChanges, handleResolveChange } from '../mcp-server/tools/git.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const WRITE_AUTH: AuthResult = { userId: 'user-1', scopes: ['read', 'propose', 'write'], authMethod: 'api_key' };
const READ_AUTH: AuthResult = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };
const PROJECT = { id: '11111111-1111-1111-1111-111111111111', name: 'Demo' };

// ── get_pending_changes ──────────────────────────────────────────────────────────────

Deno.test('get_pending_changes: requires read scope', async () => {
  const sb = new FakeSupabase();
  const r = await handleGetPendingChanges(sb as never, { userId: 'u', scopes: [], authMethod: 'api_key' }, { project_id: PROJECT.id });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('read scope'));
  assertEquals(sb.calls.length, 0, 'no DB call on scope failure');
});

Deno.test('get_pending_changes: maps pending git_change_events rows', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null });
  sb.script('git_change_events', 'select', {
    data: [
      { id: 'e1', commit_sha: 'abc', commit_message: 'fix', author: 'dev', changed_files: ['a.ts'], status: 'pending', metadata: { branch: 'main' }, created_at: 't' },
    ],
    error: null,
  });
  const r = await handleGetPendingChanges(sb as never, READ_AUTH, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { pendingChanges: Array<Record<string, unknown>>; totalPending: number };
  assertEquals(data.totalPending, 1);
  assertEquals(data.pendingChanges[0].changeEventId, 'e1');
  assertEquals(data.pendingChanges[0].commitSha, 'abc');
  assertEquals(data.pendingChanges[0].branch, 'main');
});

Deno.test('get_pending_changes: unknown project is surfaced as an error', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: null, error: null }); // resolveProjectByName by UUID → not found
  const r = await handleGetPendingChanges(sb as never, READ_AUTH, { project_id: PROJECT.id });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('not found or access denied'));
});

// ── resolve_change ───────────────────────────────────────────────────────────────────

Deno.test('resolve_change: requires write scope and valid args', async () => {
  const sb = new FakeSupabase();
  assertEquals((await handleResolveChange(sb as never, READ_AUTH, { change_event_id: 'e', resolution: 'accepted' })).success, false);
  assertEquals((await handleResolveChange(sb as never, WRITE_AUTH, { change_event_id: '', resolution: 'accepted' })).success, false);
  const bad = await handleResolveChange(sb as never, WRITE_AUTH, { change_event_id: 'e', resolution: 'sideways' as never });
  assertEquals(bad.success, false);
  assert((bad.error ?? '').includes('accepted'));
});

Deno.test('resolve_change: enforces ownership of the change event', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: { id: 'e1', project_id: PROJECT.id, status: 'pending', projects: { owner_id: 'someone-else' } }, error: null });
  const r = await handleResolveChange(sb as never, WRITE_AUTH, { change_event_id: 'e1', resolution: 'dismissed' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('not found or access denied'));
  assertEquals(sb.callsTo('git_change_events', 'update').length, 0, 'no update on ownership failure');
});

Deno.test('resolve_change: already-resolved event is rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: { id: 'e1', project_id: PROJECT.id, status: 'accepted', projects: { owner_id: 'user-1' } }, error: null });
  const r = await handleResolveChange(sb as never, WRITE_AUTH, { change_event_id: 'e1', resolution: 'dismissed' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('already resolved'));
});

Deno.test('resolve_change: dismissed marks the event and does not create a proposal', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: { id: 'e1', project_id: PROJECT.id, status: 'pending', projects: { owner_id: 'user-1' } }, error: null });
  sb.script('git_change_events', 'update', { data: null, error: null });
  const r = await handleResolveChange(sb as never, WRITE_AUTH, { change_event_id: 'e1', resolution: 'dismissed' });
  assertEquals(r.success, true);
  assertEquals((r.data as { proposalId: string | null }).proposalId, null);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'no proposal on dismiss');
});

Deno.test('resolve_change: accepted with patches reconciles through the proposals bucket', async () => {
  const sb = new FakeSupabase();
  // ownership + status check
  sb.script('git_change_events', 'select', { data: { id: 'e1', project_id: PROJECT.id, status: 'pending', projects: { owner_id: 'user-1' } }, error: null });
  sb.script('git_change_events', 'update', { data: null, error: null });
  // main branch lookup, then the proposals path: project resolve + branch check + inserts
  sb.script('branches', 'select', { data: { id: 'main-branch' }, error: null });   // main branch
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null }); // resolveProjectByName inside propose
  sb.script('branches', 'select', { data: { id: 'main-branch' }, error: null });   // branch existence in propose
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('branches', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const patch = { type: 'add_node', payload: { id: '22222222-2222-2222-2222-222222222222', type: 'backend-service', label: 'API' } };
  const r = await handleResolveChange(sb as never, WRITE_AUTH, { change_event_id: 'e1', resolution: 'accepted', patches: [patch] });
  assertEquals(r.success, true);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 1, 'a proposal was created via the proposals bucket');
  assert((r.data as { message: string }).message.includes('submitted as proposal'));
});

// ── A5 (docs/WORK_LOOP_PLAN.md): tick visibility + in-band apply ─────────────

Deno.test('A5: get_pending_changes projects criterionDeltas/taskDeltas and applied stamps', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null });
  sb.script('git_change_events', 'select', {
    data: [
      {
        id: 'e1', commit_sha: 'abc', commit_message: 'tick', author: 'dev', changed_files: ['t.md'],
        status: 'pending', created_at: 't',
        metadata: {
          branch: 'main',
          criterionDeltas: { deltas: [{ requirementId: 'REQ-001', text: 'c', direction: 'tick' }], flagged: [] },
          taskDeltas: { deltas: [{ nodeId: 'n1', key: 'aaaa1111', displayId: 'T1', title: 't', direction: 'tick' }], flagged: [] },
          criteriaApplied: { at: 'earlier', count: 1 },
        },
      },
      { id: 'e2', commit_sha: 'def', commit_message: 'plain', author: 'dev', changed_files: ['x.ts'], status: 'pending', metadata: {}, created_at: 't' },
    ],
    error: null,
  });
  const r = await handleGetPendingChanges(sb as never, READ_AUTH, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const rows = (r.data as { pendingChanges: Array<Record<string, unknown>> }).pendingChanges;
  const ticked = rows.find((c) => c.changeEventId === 'e1')!;
  assert(ticked.criterionDeltas, 'criterionDeltas must project');
  assert(ticked.taskDeltas, 'taskDeltas must project');
  assertEquals((ticked.criteriaApplied as { count: number }).count, 1);
  const plain = rows.find((c) => c.changeEventId === 'e2')!;
  assert(!('criterionDeltas' in plain) && !('taskDeltas' in plain), 'delta keys absent on a plain card');
});

Deno.test('A5: resolve_change apply_ticks applies task deltas and stamps in the SAME resolve write', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', {
    data: {
      id: 'e1', project_id: PROJECT.id, status: 'pending', commit_sha: 'abc',
      projects: { owner_id: 'user-1' },
      metadata: {
        branchName: 'main',
        taskDeltas: { deltas: [{ nodeId: 'n1', key: 'aaaa1111', displayId: 'T1', title: 'Scaffold', direction: 'tick' }], flagged: [] },
      },
    },
    error: null,
  });
  sb.script('task_items', 'select', { data: [], error: null });   // no existing state
  sb.script('task_items', 'upsert', { data: null, error: null });
  sb.script('git_change_events', 'update', { data: null, error: null });
  sb.script('branches', 'update', { data: null, error: null });

  const r = await handleResolveChange(sb as never, WRITE_AUTH, {
    change_event_id: 'e1', resolution: 'accepted', apply_ticks: true,
  });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { tasksApplied: number }).tasksApplied, 1);

  const upserts = sb.callsTo('task_items', 'upsert');
  assertEquals(upserts.length, 1);
  const row = (upserts[0].payload as Array<Record<string, unknown>>)[0];
  assertEquals(row.done, true);
  assertEquals((row.provenance as { source: string }).source, 'git');

  // ONE write resolves the card AND stamps ticksApplied (criteriaApplied only
  // when criterion deltas existed — none here).
  const updates = sb.callsTo('git_change_events', 'update');
  assertEquals(updates.length, 1);
  const payload = updates[0].payload as Record<string, unknown>;
  assertEquals(payload.status, 'accepted');
  const meta = payload.metadata as Record<string, unknown>;
  assertEquals((meta.ticksApplied as { count: number }).count, 1);
  assert(!('criteriaApplied' in meta), 'no criterion deltas → no criteriaApplied stamp');
});

Deno.test('A5: a card already stamped ticksApplied cannot double-apply', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', {
    data: {
      id: 'e1', project_id: PROJECT.id, status: 'pending', commit_sha: 'abc',
      projects: { owner_id: 'user-1' },
      metadata: {
        branchName: 'main',
        taskDeltas: { deltas: [{ nodeId: 'n1', key: 'aaaa1111', displayId: 'T1', title: 't', direction: 'tick' }], flagged: [] },
        ticksApplied: { at: 'earlier', count: 1 },
      },
    },
    error: null,
  });
  sb.script('git_change_events', 'update', { data: null, error: null });
  sb.script('branches', 'update', { data: null, error: null });

  const r = await handleResolveChange(sb as never, WRITE_AUTH, {
    change_event_id: 'e1', resolution: 'accepted', apply_ticks: true,
  });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { tasksApplied: number }).tasksApplied, 0);
  assertEquals(sb.callsTo('task_items', 'upsert').length, 0, 'stamped card must not re-apply');
});

Deno.test('A5: dismissed NEVER applies ticks, even when requested', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', {
    data: {
      id: 'e1', project_id: PROJECT.id, status: 'pending', commit_sha: 'abc',
      projects: { owner_id: 'user-1' },
      metadata: {
        branchName: 'main',
        taskDeltas: { deltas: [{ nodeId: 'n1', key: 'aaaa1111', displayId: 'T1', title: 't', direction: 'tick' }], flagged: [] },
      },
    },
    error: null,
  });
  sb.script('git_change_events', 'update', { data: null, error: null });
  sb.script('branches', 'update', { data: null, error: null });

  const r = await handleResolveChange(sb as never, WRITE_AUTH, {
    change_event_id: 'e1', resolution: 'dismissed', apply_ticks: true,
  });
  assertEquals(r.success, true);
  assertEquals(sb.callsTo('task_items', 'upsert').length, 0, 'dismiss must never write evidence');
  assertEquals(sb.callsTo('task_items', 'select').length, 0);
});

Deno.test('A5: apply_ticks on a card with no deltas is a named refusal, card left pending', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', {
    data: { id: 'e1', project_id: PROJECT.id, status: 'pending', commit_sha: 'abc', projects: { owner_id: 'user-1' }, metadata: { branchName: 'main' } },
    error: null,
  });
  const r = await handleResolveChange(sb as never, WRITE_AUTH, {
    change_event_id: 'e1', resolution: 'accepted', apply_ticks: true,
  });
  assertEquals(r.success, false);
  assert(String(r.error).includes('no criterion or task deltas'));
  assertEquals(sb.callsTo('git_change_events', 'update').length, 0, 'card must stay pending');
});
