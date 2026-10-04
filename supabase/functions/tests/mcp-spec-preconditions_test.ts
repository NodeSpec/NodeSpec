// V3 P2 (task 2.7): multi-agent preconditions. Pins: the three evaluator
// semantics (value_equals = exact-serialization equality, value_exists =
// present and non-null, hash_match = sha256 hex of the canonical string)
// with dot-path walking and refusals that NAME the path and current state;
// enforcement at APPLY (applySpecPatch refuses before any write, and the
// router's level-2 lane refuses before the handler runs) and at MERGE
// (resolve_proposal accept re-checks against the row as it is NOW, leaving
// an honest partial); preconditions on an unsupported op refuse loudly —
// never silently ignored; and a call carrying preconditions NEVER falls
// through to run unguarded, even when the patch build fails.
import {
  evaluatePreconditions,
  checkSpecPreconditions,
} from '../mcp-server/tools/spec-preconditions.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { routeToolCall } from '../mcp-server/tools/change-router.ts';
import { handleResolveProposal } from '../mcp-server/tools/approvals.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const SPEC = '33333333-3333-4333-8333-333333333333';
const PROP = '44444444-4444-4444-8444-444444444444';
const CAND = '55555555-5555-4555-8555-555555555555';

const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;

const meta = (preconditions?: unknown) => ({
  id: crypto.randomUUID(), actorType: 'ai' as const, actorId: 'claude · bench',
  summary: 'bench', timestamp: new Date().toISOString(),
  ...(preconditions !== undefined ? { preconditions } : {}),
});

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('evaluator: the three semantics, dot paths, and refusals that name the state', async () => {
  const row = {
    name: 'Store tasks',
    updated_at: '2026-09-13T10:00:00Z',
    section: null,
    acceptance_criteria: [{ text: 'tasks persist', met: false }],
  };

  // value_equals — pass, and fail naming path + both values.
  assertEquals((await evaluatePreconditions(row, [{ type: 'value_equals', path: 'updated_at', expected: '2026-09-13T10:00:00Z' }])).ok, true);
  const stale = await evaluatePreconditions(row, [{ type: 'value_equals', path: 'name', expected: 'Old name' }]);
  assert(!stale.ok && stale.error.includes('value_equals on "name"'), JSON.stringify(stale));
  assert(!stale.ok && stale.error.includes('Old name') && stale.error.includes('Store tasks'),
    'the refusal shows expected AND current');

  // value_exists — present passes; null and absent fail.
  assertEquals((await evaluatePreconditions(row, [{ type: 'value_exists', path: 'name' }])).ok, true);
  const nullish = await evaluatePreconditions(row, [{ type: 'value_exists', path: 'section' }]);
  assert(!nullish.ok && nullish.error.includes('value_exists on "section"'), JSON.stringify(nullish));
  assertEquals((await evaluatePreconditions(row, [{ type: 'value_exists', path: 'no_such_field' }])).ok, false);

  // dot path into jsonb.
  assertEquals((await evaluatePreconditions(row, [{ type: 'value_equals', path: 'acceptance_criteria.0.text', expected: 'tasks persist' }])).ok, true);

  // hash_match — strings hash as-is, objects hash their JSON; a wrong
  // digest names the actual hash so the caller can see what moved.
  const nameHash = await sha256Hex('Store tasks');
  assertEquals((await evaluatePreconditions(row, [{ type: 'hash_match', path: 'name', expected: nameHash }])).ok, true);
  const criteriaHash = await sha256Hex(JSON.stringify(row.acceptance_criteria));
  assertEquals((await evaluatePreconditions(row, [{ type: 'hash_match', path: 'acceptance_criteria', expected: criteriaHash }])).ok, true);
  const badHash = await evaluatePreconditions(row, [{ type: 'hash_match', path: 'name', expected: 'deadbeef' }]);
  assert(!badHash.ok && badHash.error.includes(nameHash), 'the refusal carries the current hash');

  // malformed entries refuse, never pass silently.
  assertEquals((await evaluatePreconditions(row, [{ type: 'value_equals', path: '', expected: 1 }])).ok, false);
  // deno-lint-ignore no-explicit-any
  assertEquals((await evaluatePreconditions(row, [{ type: 'teleport', path: 'name' } as any])).ok, false);
});

Deno.test('apply gate: a stale precondition refuses update_candidate BEFORE any write; a fresh one lets it through', async () => {
  const candidateRow = {
    id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null,
    key: 'outcome:abc', kind: 'outcome', name: 'Current name', description: '',
    category: 'functional', criteria: [], status: 'pending', requirement_row_id: null,
    updated_at: '2026-09-13T10:00:00Z',
  };

  // Stale: the precondition read sees the current row, the guard refuses,
  // and the candidates table is never written.
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: candidateRow, error: null }); // precondition read
  const staleResult = await applySpecPatch(sb as never, AUTH, PROJECT.id, {
    type: 'update_candidate',
    metadata: meta([{ type: 'value_equals', path: 'name', expected: 'My stale read' }]),
    payload: { candidateId: CAND, changes: { name: 'Renamed' } },
  } as never);
  assertEquals(staleResult.applied, false);
  assert(!staleResult.applied && staleResult.error.includes('value_equals on "name"'), JSON.stringify(staleResult));
  assertEquals(sb.callsTo('requirement_candidates', 'update').length, 0, 'refused before any write');

  // Fresh: the guard passes and the normal update proceeds.
  const sb2 = new FakeSupabase();
  sb2.script('requirement_candidates', 'select', { data: candidateRow, error: null }); // precondition read
  sb2.script('requirement_candidates', 'select', { data: candidateRow, error: null }); // getCandidate
  sb2.script('requirement_candidates', 'update', { data: null, error: null });
  const freshResult = await applySpecPatch(sb2 as never, AUTH, PROJECT.id, {
    type: 'update_candidate',
    metadata: meta([{ type: 'value_equals', path: 'name', expected: 'Current name' }]),
    payload: { candidateId: CAND, changes: { name: 'Renamed' } },
  } as never);
  assertEquals(freshResult.applied, true, JSON.stringify(freshResult));
  assertEquals(sb2.callsTo('requirement_candidates', 'update').length, 1);
});

Deno.test('apply gate: a deleted target row IS a failed precondition, and unsupported ops refuse loudly', async () => {
  // Requirement gone: the strongest staleness.
  const sb = new FakeSupabase();
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', { data: null, error: null });
  const gone = await applySpecPatch(sb as never, AUTH, PROJECT.id, {
    type: 'delete_requirement',
    metadata: meta([{ type: 'value_exists', path: 'id' }]),
    payload: { requirementId: 'REQ-001' },
  } as never);
  assertEquals(gone.applied, false);
  assert(!gone.applied && gone.error.includes('no longer exists'), JSON.stringify(gone));

  // update_vision has no pre-existing target row: preconditions on it are a
  // caller error, refused — never silently ignored protection.
  const sb2 = new FakeSupabase();
  const unsupported = await applySpecPatch(sb2 as never, AUTH, PROJECT.id, {
    type: 'update_vision',
    metadata: meta([{ type: 'value_exists', path: 'vision' }]),
    payload: { vision: 'x' },
  } as never);
  assertEquals(unsupported.applied, false);
  assert(!unsupported.applied && unsupported.error.includes('not supported'), JSON.stringify(unsupported));
  assertEquals(sb2.callsTo('project_specifications', 'update').length, 0);
});

Deno.test('router level 2: preconditions check against the CURRENT row before the handler — overlap never last-write-wins', async () => {
  const serverRow = { id: 'r1', requirement_id: 'REQ-001', name: 'Server truth', updated_at: '2026-09-13T11:00:00Z' };

  // Stale read → refused, the handler never runs.
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', { data: serverRow, error: null });
  let handlerRan = false;
  const refused = await routeToolCall(sb as never, AUTH, 'update_requirement',
    {
      project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'Overwrite attempt',
      preconditions: [{ type: 'value_equals', path: 'updated_at', expected: '2026-09-13T10:00:00Z' }],
    },
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: true }; });
  assertEquals(refused.success, false);
  assert(String(refused.error).includes('value_equals on "updated_at"'), JSON.stringify(refused));
  assertEquals(handlerRan, false, 'the write never happened');

  // Fresh read → the handler runs and the auto-apply records as usual.
  const sb2 = new FakeSupabase();
  sb2.script('projects', 'select', { data: PROJECT, error: null });
  sb2.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb2.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb2.script('specification_requirements', 'select', { data: serverRow, error: null });
  sb2.script('branches', 'select', { data: [{ id: BRANCH, is_primary: true }], error: null });
  sb2.script('ai_runs', 'insert', { data: null, error: null });
  sb2.script('ai_proposals', 'insert', { data: null, error: null });
  const applied = await routeToolCall(sb2 as never, AUTH, 'update_requirement',
    {
      project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'Safe rename',
      preconditions: [{ type: 'value_equals', path: 'updated_at', expected: '2026-09-13T11:00:00Z' }],
    },
    // deno-lint-ignore require-await
    async () => ({ success: true, data: { requirementId: 'REQ-001' } }));
  assertEquals(applied.success, true, JSON.stringify(applied));
  // deno-lint-ignore no-explicit-any
  assertEquals((applied.data as any).routed, 'applied');
});

Deno.test('router: a call carrying preconditions NEVER falls through unguarded — malformed guards refuse', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  let handlerRan = false;
  const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
    { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'x', preconditions: 'not-an-array' },
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: true }; });
  assertEquals(r.success, false);
  assert(String(r.error).includes('preconditions could not be validated'), JSON.stringify(r));
  assertEquals(handlerRan, false, 'asked-for protection is never silently dropped');
});

Deno.test('merge gate: resolve_proposal accept re-checks against the row AS IT IS NOW; a stale accept applies nothing and stays pending (AL.8)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('ai_proposals', 'select', {
    data: {
      id: PROP, status: 'pending', source_branch_id: BRANCH,
      patches: [{
        patch: {
          type: 'update_requirement',
          metadata: meta([{ type: 'value_equals', path: 'name', expected: 'As proposed' }]),
          payload: { requirementId: 'REQ-001', changes: { description: 'sharper' } },
        },
        status: 'pending',
      }],
      metadata: { plane: 'spec' },
    },
    error: null,
  });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT.id }, error: null });
  // applySpecPatch → precondition read: the row moved since the proposal.
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: 'r1', requirement_id: 'REQ-001', name: 'Changed out-of-band' },
    error: null,
  });
  sb.script('ai_proposals', 'update', { data: null, error: null });

  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, false);
  assert(String(r.error).includes('Precondition failed'), 'the refusal surfaces the precondition');
  assert(String(r.error).startsWith('Nothing was applied.'), JSON.stringify(r.error));
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).status, 'pending');
  assert(!sb.callsTo('ai_proposals', 'update').some((c) => 'status' in (c.payload as object)), 'the proposal is not marked');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'nothing was written');
});

Deno.test('no preconditions costs nothing: checkSpecPreconditions never reads without guards to check', async () => {
  const sb = new FakeSupabase();
  const r = await checkSpecPreconditions(sb as never, PROJECT.id, {
    type: 'update_requirement',
    metadata: meta(),
    payload: { requirementId: 'REQ-001', changes: { name: 'x' } },
  } as never);
  assertEquals(r.ok, true);
  assertEquals(sb.calls.length, 0, 'zero queries on the unguarded path');
});
