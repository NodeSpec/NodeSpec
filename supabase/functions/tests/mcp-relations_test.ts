// R6 commit 5: relate_requirements — the AUTHORED requirement↔requirement lane.
// Pins the doctrine edges: rows only from explicit calls (source 'ai' over MCP),
// both id forms resolve, self-relation refused, duplicate add is idempotent
// (alreadyExists, not an error), and create_requirement's relations[] rides
// through non-fatally (the requirement stands even when a target is bogus).
import { handleRelateRequirements, createRelationsForNewRequirement, RELATION_TYPES } from '../mcp-server/tools/relations.ts';
import { handleCreateRequirement } from '../mcp-server/tools/requirements.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const WRITE: AuthResult = { userId: 'user-1', scopes: ['read', 'write'], authMethod: 'api_key' };
const READ: AuthResult = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const FROM_UUID = '22222222-2222-2222-2222-222222222222';
const TO_UUID = '33333333-3333-3333-3333-333333333333';

function reqRow(id: string, requirementId: string) {
  return { id, requirement_id: requirementId, name: `Req ${requirementId}`, locked: false };
}

/** Script the shared resolution prefix: project → spec. */
function scriptProjectAndSpec(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: { id: PROJECT_ID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
}

// ── relate_requirements: gates ───────────────────────────────────────────────────────

Deno.test('relate_requirements: write scope required', async () => {
  const sb = new FakeSupabase();
  const r = await handleRelateRequirements(sb as never, READ, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002', relation_type: 'expands',
  });
  assertEquals(r.success, false);
  assertEquals(sb.calls.length, 0, 'refused before any DB call');
});

Deno.test('relate_requirements: invalid relation_type refused before any lookup', async () => {
  const sb = new FakeSupabase();
  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002', relation_type: 'blocks',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Invalid relation_type'), r.error ?? '');
  assert((r.error ?? '').includes(RELATION_TYPES.join(', ')), 'error names the valid set');
  assertEquals(sb.calls.length, 0);
});

Deno.test('relate_requirements: missing spec surfaced honestly', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_ID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: null, error: null });
  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002', relation_type: 'expands',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('no specification'), r.error ?? '');
});

Deno.test('relate_requirements: unresolvable endpoint names the offending ref', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: null, error: null }); // `to` misses
  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-999', relation_type: 'expands',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('REQ-999'), r.error ?? '');
});

Deno.test('relate_requirements: self-relation refused', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: FROM_UUID, relation_type: 'relates_to',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('cannot relate to itself'), r.error ?? '');
  assertEquals(sb.callsTo('specification_requirement_relations', 'insert').length, 0);
});

// ── relate_requirements: add ─────────────────────────────────────────────────────────

Deno.test('relate_requirements add: inserts source ai with resolved row uuids', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow('row-2', 'REQ-002'), error: null });
  sb.script('specification_requirement_relations', 'insert', { data: null, error: null });

  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002',
    relation_type: 'expands', notes: 'splits checkout into payment + receipt',
  });
  assertEquals(r.success, true);
  assertEquals(r.data, { mode: 'add', from: 'REQ-001', to: 'REQ-002', relationType: 'expands' });

  const insert = sb.callsTo('specification_requirement_relations', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.specification_id, 'spec-1');
  assertEquals(insert.from_requirement_id, 'row-1');
  assertEquals(insert.to_requirement_id, 'row-2');
  assertEquals(insert.relation_type, 'expands');
  assertEquals(insert.source, 'ai', 'MCP writes are always source ai');
  assertEquals(insert.created_by, 'user-1');
  assertEquals(insert.notes, 'splits checkout into payment + receipt');
});

Deno.test('relate_requirements add: endpoints accept row uuids (resolved via id column)', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow(FROM_UUID, 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow(TO_UUID, 'REQ-002'), error: null });
  sb.script('specification_requirement_relations', 'insert', { data: null, error: null });

  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: FROM_UUID, to_requirement_id: TO_UUID, relation_type: 'depends_on',
  });
  assertEquals(r.success, true);
  // Human-readable ids in the response even when uuids were passed in.
  assertEquals((r.data as { from: string; to: string }).from, 'REQ-001');
  assertEquals((r.data as { from: string; to: string }).to, 'REQ-002');
  // uuid refs resolve on the `id` column, not `requirement_id`.
  const lookups = sb.callsTo('specification_requirements', 'select');
  assert(lookups[0].filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === FROM_UUID),
    'from resolved by id column');
});

Deno.test('relate_requirements add: duplicate (23505) reads as alreadyExists success', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow('row-2', 'REQ-002'), error: null });
  sb.script('specification_requirement_relations', 'insert', { data: null, error: { message: 'duplicate key', code: '23505' } });

  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002', relation_type: 'expands',
  });
  assertEquals(r.success, true);
  assertEquals((r.data as { alreadyExists?: boolean }).alreadyExists, true);
});

Deno.test('relate_requirements add: non-duplicate insert failure surfaces as error', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow('row-2', 'REQ-002'), error: null });
  sb.script('specification_requirement_relations', 'insert', { data: null, error: { message: 'permission denied', code: '42501' } });
  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002', relation_type: 'expands',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('permission denied'), r.error ?? '');
});

// ── relate_requirements: remove ──────────────────────────────────────────────────────

Deno.test('relate_requirements remove: deletes the exact (from, to, type) fact', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndSpec(sb);
  sb.script('specification_requirements', 'select', { data: reqRow('row-1', 'REQ-001'), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow('row-2', 'REQ-002'), error: null });
  sb.script('specification_requirement_relations', 'delete', { data: null, error: null });

  const r = await handleRelateRequirements(sb as never, WRITE, {
    project_id: PROJECT_ID, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002',
    relation_type: 'depends_on', mode: 'remove',
  });
  assertEquals(r.success, true);
  assertEquals(r.data, { mode: 'remove', from: 'REQ-001', to: 'REQ-002', relationType: 'depends_on' });
  const del = sb.callsTo('specification_requirement_relations', 'delete')[0];
  const eqs = del.filters.filter((f) => f.method === 'eq').map((f) => f.args);
  assertEquals(eqs, [
    ['from_requirement_id', 'row-1'],
    ['to_requirement_id', 'row-2'],
    ['relation_type', 'depends_on'],
  ]);
  assertEquals(sb.callsTo('specification_requirement_relations', 'insert').length, 0);
});

// ── createRelationsForNewRequirement (create_requirement's relations[] lane) ─────────

Deno.test('createRelationsForNewRequirement: mixed batch — created + every failure mode reported, none fatal', async () => {
  const sb = new FakeSupabase();
  sb.script('specification_requirements', 'select', { data: reqRow('row-7', 'REQ-007'), error: null }); // good target
  // invalid type does no lookup; next lookup is the not-found target:
  sb.script('specification_requirements', 'select', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: reqRow('row-new', 'REQ-010'), error: null }); // self
  sb.script('specification_requirement_relations', 'insert', { data: null, error: null });

  const out = await createRelationsForNewRequirement(sb as never, 'spec-1', 'row-new', 'user-1', [
    { to: 'REQ-007', type: 'expands' },
    { to: 'REQ-007', type: 'blocks' },
    { to: 'REQ-404', type: 'depends_on' },
    { to: 'REQ-010', type: 'relates_to' },
  ]);
  assertEquals(out.created, [{ to: 'REQ-007', type: 'expands' }]);
  assertEquals(out.failed.length, 3);
  assert(out.failed[0].reason.includes('invalid relation type'), out.failed[0].reason);
  assert(out.failed[1].reason.includes('not found'), out.failed[1].reason);
  assert(out.failed[2].reason.includes('itself'), out.failed[2].reason);
  // Exactly ONE insert — failures never reach the table.
  assertEquals(sb.callsTo('specification_requirement_relations', 'insert').length, 1);
});

Deno.test('createRelationsForNewRequirement: duplicate insert (23505) still counts as created', async () => {
  const sb = new FakeSupabase();
  sb.script('specification_requirements', 'select', { data: reqRow('row-7', 'REQ-007'), error: null });
  sb.script('specification_requirement_relations', 'insert', { data: null, error: { message: 'dup', code: '23505' } });
  const out = await createRelationsForNewRequirement(sb as never, 'spec-1', 'row-new', 'user-1', [
    { to: 'REQ-007', type: 'expands' },
  ]);
  assertEquals(out.created, [{ to: 'REQ-007', type: 'expands' }]);
  assertEquals(out.failed, []);
});

// ── create_requirement end-to-end with relations[] ──────────────────────────────────

Deno.test('create_requirement with relations: lineage recorded at creation, bad target non-fatal', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_ID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null }); // spec exists
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-007' }], error: null }); // nextRequirementId
  sb.script('specification_requirements', 'insert', {
    data: { id: 'row-new', requirement_id: 'REQ-008', name: 'Receipts', category: 'functional', status: 'pending' },
    error: null,
  });
  sb.script('specification_requirements', 'select', { data: reqRow('row-7', 'REQ-007'), error: null }); // good relation target
  sb.script('specification_requirement_relations', 'insert', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: null, error: null }); // bad relation target

  const r = await handleCreateRequirement(sb as never, WRITE, {
    project_id: PROJECT_ID,
    name: 'Receipts',
    description: 'Email receipts after checkout',
    relations: [
      { to: 'REQ-007', type: 'expands' },
      { to: 'REQ-404', type: 'depends_on' },
    ],
  });
  assertEquals(r.success, true, r.error ?? '');
  const data = r.data as {
    requirementId: string;
    relationsCreated?: Array<{ to: string; type: string }>;
    relationsFailed?: Array<{ to: string; type: string; reason: string }>;
  };
  assertEquals(data.requirementId, 'REQ-008');
  assertEquals(data.relationsCreated, [{ to: 'REQ-007', type: 'expands' }]);
  assertEquals(data.relationsFailed?.length, 1);
  assertEquals(data.relationsFailed?.[0].to, 'REQ-404');
  const relInsert = sb.callsTo('specification_requirement_relations', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(relInsert.from_requirement_id, 'row-new');
  assertEquals(relInsert.to_requirement_id, 'row-7');
  assertEquals(relInsert.source, 'ai');
});

Deno.test('create_requirement without relations: response omits the relations fields', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_ID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: [], error: null });
  sb.script('specification_requirements', 'insert', {
    data: { id: 'row-new', requirement_id: 'REQ-001', name: 'A', category: 'functional', status: 'pending' },
    error: null,
  });
  const r = await handleCreateRequirement(sb as never, WRITE, {
    project_id: PROJECT_ID, name: 'A', description: 'B',
  });
  assertEquals(r.success, true, r.error ?? '');
  const data = r.data as Record<string, unknown>;
  assert(!('relationsCreated' in data), 'no relationsCreated key when none requested');
  assert(!('relationsFailed' in data), 'no relationsFailed key when none requested');
});
