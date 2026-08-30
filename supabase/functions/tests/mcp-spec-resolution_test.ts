// Owner bench 2026-07-29: requirements pushed over MCP scattered across DUPLICATE
// project_specifications rows — resolveSpecForProject used bare .maybeSingle(),
// which errors on multiples, reads as "no spec", and mints another spec per call.
// Pins: (1) the spec lookup is ORDERED newest-first with limit 1 (never errors on
// duplicates, picks the row the client UI displays); (2) a create against an
// existing spec attaches the requirement to THAT spec — no new spec insert.
import { assert, assertEquals, FakeSupabase } from './helpers.ts';
import { handleCreateRequirement } from '../mcp-server/tools/requirements.ts';
import type { AuthResult } from '../mcp-server/shared.ts';

const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SPEC_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const AUTH: AuthResult = { userId: 'user-1', scopes: ['read', 'write'] } as unknown as AuthResult;

Deno.test('create_requirement resolves the spec newest-first (duplicate-safe) and reuses it', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_ID, name: 'Bench' }, error: null });
  // The duplicate-safe lookup returns ONE row even when the project carries several.
  sb.script('project_specifications', 'select', { data: { id: SPEC_ID }, error: null });
  // requirement_id clash probe + REQ-number scan + insert
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-004' }], error: null });
  sb.script('specification_requirements', 'insert', {
    data: { id: 'cccccccc-0000-4000-8000-000000000003', requirement_id: 'REQ-005', name: 'N', category: 'functional', status: 'pending' },
    error: null,
  });

  const res = await handleCreateRequirement(sb as never, AUTH, {
    project_id: PROJECT_ID,
    name: 'N',
    description: 'D',
  });
  assert(res.success, `create failed: ${res.success ? '' : res.error}`);

  // Pin 1: the spec lookup carries order(created_at desc) + limit(1) — the exact
  // shape that stays sane when duplicates exist. A bare maybeSingle regression
  // would drop these filters.
  const specSelect = sb.callsTo('project_specifications', 'select')[0];
  const order = specSelect.filters.find((f) => f.method === 'order' && f.args[0] === 'created_at');
  assert(order, 'spec lookup must be ordered by created_at');
  // deno-lint-ignore no-explicit-any
  assertEquals((order!.args[1] as any)?.ascending, false, 'newest-first — the row the client UI displays');
  assert(specSelect.filters.some((f) => f.method === 'limit' && f.args[0] === 1), 'limit 1');

  // Pin 2: with a spec resolved, NO new specification row is inserted.
  assertEquals(sb.callsTo('project_specifications', 'insert').length, 0, 'must reuse the existing spec');

  // The requirement insert targets the resolved spec.
  const reqInsert = sb.callsTo('specification_requirements', 'insert')[0];
  // deno-lint-ignore no-explicit-any
  assertEquals((reqInsert.payload as any).specification_id, SPEC_ID);
  // deno-lint-ignore no-explicit-any
  assertEquals((reqInsert.payload as any).requirement_id, 'REQ-005', 'numbering continues from the resolved spec');
});
