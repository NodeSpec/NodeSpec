// S1-3 chunk 4: regression tests for the `requirements` tool bucket, extracted verbatim
// from mcp-server/index.ts into mcp-server/tools/requirements.ts (+ its internal
// resolveSpecForProject / resolveRequirementRow helpers). Exercises the real handlers
// against a FakeSupabase. (Logic preservation only; module-graph boot is the live edge
// runtime, per the S1-2 lesson.)
import {
  handleCreateRequirement,
  handleUpdateRequirement,
  handleDeleteRequirement,
  handleSetRequirementLock,
  handleListRequirements,
  handleMapRequirement,
  computeRequirementCoupling,
} from '../mcp-server/tools/requirements.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const WRITE: AuthResult = { userId: 'user-1', scopes: ['read', 'write'], authMethod: 'api_key' };
const READ: AuthResult = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };
const PROJECT = { id: '11111111-1111-1111-1111-111111111111', name: 'Demo' };

function projectRow() {
  return { data: { id: PROJECT.id, name: PROJECT.name }, error: null };
}

// ── create_requirement ───────────────────────────────────────────────────────────────

Deno.test('create_requirement: write scope required; name+description required', async () => {
  const sb = new FakeSupabase();
  assertEquals((await handleCreateRequirement(sb as never, READ, { project_id: PROJECT.id, name: 'n', description: 'd' })).success, false);
  const sb2 = new FakeSupabase();
  sb2.script('projects', 'select', projectRow());
  const r = await handleCreateRequirement(sb2 as never, WRITE, { project_id: PROJECT.id, name: '', description: '' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('name and description'));
});

Deno.test('create_requirement: invalid category rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd', category: 'nonsense' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Invalid category'));
});

Deno.test('create_requirement: auto-creates spec, auto-numbers REQ id, inserts requirement', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  // resolveSpecForProject → none, so a spec gets created.
  sb.script('project_specifications', 'select', { data: null, error: null });
  sb.script('project_specifications', 'insert', { data: { id: 'spec-1' }, error: null });
  // auto-number: existing REQ rows → max REQ-002, so next is REQ-003.
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-001' }, { requirement_id: 'REQ-002' }], error: null });
  sb.script('specification_requirements', 'insert', { data: { id: 'r1', requirement_id: 'REQ-003', name: 'n', category: 'functional', status: 'pending' }, error: null });

  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd', acceptance_criteria: ['a', 'b'] });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assertEquals(data.requirementId, 'REQ-003');
  assertEquals(data.acceptanceCriteriaCount, 2);
  // The inserted row uses the resolved spec id and shapes acceptance criteria as {text, met}.
  const insert = sb.callsTo('specification_requirements', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.specification_id, 'spec-1');
  assertEquals(insert.acceptance_criteria, [{ text: 'a', met: false }, { text: 'b', met: false }]);
});

Deno.test('WS3 create_requirement: object-form criteria round-trip — manual stored, automated stored as ABSENT verification', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: [], error: null });
  sb.script('specification_requirements', 'insert', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', category: 'functional', status: 'pending' }, error: null });

  const r = await handleCreateRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, name: 'n', description: 'd',
    acceptance_criteria: [
      'plain string stays automated',
      { text: 'user confirms the dashboard visually', verification: 'manual' },
      { text: 'explicit automated', verification: 'automated' },
    ],
  });
  assertEquals(r.success, true);
  const insert = sb.callsTo('specification_requirements', 'insert')[0].payload as Record<string, unknown>;
  // D-2 storage rule: 'automated' is the ABSENT default — only 'manual' is written.
  assertEquals(insert.acceptance_criteria, [
    { text: 'plain string stays automated', met: false },
    { text: 'user confirms the dashboard visually', met: false, verification: 'manual' },
    { text: 'explicit automated', met: false },
  ]);
});

Deno.test('WS3 create_requirement: bad criterion shapes refused before any write', async () => {
  const bad = async (criteria: unknown[]) => {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', projectRow());
    const r = await handleCreateRequirement(sb as never, WRITE, {
      // deno-lint-ignore no-explicit-any
      project_id: PROJECT.id, name: 'n', description: 'd', acceptance_criteria: criteria as any,
    });
    assertEquals(r.success, false);
    assertEquals(sb.callsTo('specification_requirements', 'insert').length, 0);
    return r.error ?? '';
  };
  assert((await bad([{ text: 'x', verification: 'eyeball' }])).includes('Invalid verification'));
  assert((await bad([{ verification: 'manual' }])).includes('non-empty strings or { text, verification? }'));
  assert((await bad([''])).includes('non-empty strings or { text, verification? }'));
});

Deno.test('create_requirement: explicit duplicate requirement_id is rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  // resolveRequirementRow clash check → existing row.
  sb.script('specification_requirements', 'select', { data: { id: 'r0', requirement_id: 'REQ-009', name: 'x', locked: false }, error: null });
  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd', requirement_id: 'REQ-009' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('already exists'));
});

// Owner request 2026-08-22: the AI can categorize requirements into sections —
// previously a manual-only surface. Resolution is by name, case-insensitive;
// a miss creates the section at the end of the order.
Deno.test('create_requirement: section miss creates the section (end of order) and files the row under it', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_sections', 'select', { data: [{ id: 'sec-old', name: 'Core', order_index: 2 }], error: null });
  sb.script('specification_sections', 'insert', { data: { id: 'sec-new', name: 'Billing' }, error: null });
  sb.script('specification_requirements', 'select', { data: [], error: null }); // numbering
  sb.script('specification_requirements', 'insert', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', category: 'functional', status: 'pending' }, error: null });

  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd', section: 'Billing' });
  assertEquals(r.success, true);
  assertEquals((r.data as Record<string, unknown>).section, 'Billing');
  const sectionInsert = sb.callsTo('specification_sections', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(sectionInsert.specification_id, 'spec-1');
  assertEquals(sectionInsert.name, 'Billing');
  assertEquals(sectionInsert.order_index, 3); // after the existing max
  const reqInsert = sb.callsTo('specification_requirements', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(reqInsert.section_id, 'sec-new');
});

Deno.test('create_requirement: section resolves case-insensitively — no duplicate section, canonical name echoed', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_sections', 'select', { data: [{ id: 'sec-9', name: 'Core Features', order_index: 0 }], error: null });
  sb.script('specification_requirements', 'select', { data: [], error: null }); // numbering
  sb.script('specification_requirements', 'insert', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', category: 'functional', status: 'pending' }, error: null });

  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd', section: '  core features ' });
  assertEquals(r.success, true);
  assertEquals((r.data as Record<string, unknown>).section, 'Core Features');
  assertEquals(sb.callsTo('specification_sections', 'insert').length, 0);
  const reqInsert = sb.callsTo('specification_requirements', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(reqInsert.section_id, 'sec-9');
});

Deno.test('create_requirement: blank section refused BEFORE the spec auto-create can write anything', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd', section: '   ' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('non-empty section name'));
  assertEquals(sb.callsTo('project_specifications', 'insert').length, 0);
});

// ── update_requirement ───────────────────────────────────────────────────────────────

Deno.test('update_requirement: locked requirement is refused', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: true }, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'new' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('locked'));
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0);
});

Deno.test('update_requirement: no fields to update is rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('No fields to update'));
});

Deno.test('update_requirement: applies named fields and reports them', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'new', status: 'implemented' });
  assertEquals(r.success, true);
  const fields = (r.data as { updatedFields: string[] }).updatedFields.sort();
  assertEquals(fields, ['name', 'status']);
});

Deno.test('update_requirement: section moves the requirement (create-on-miss) and null clears it', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  sb.script('specification_sections', 'select', { data: [], error: null });
  sb.script('specification_sections', 'insert', { data: { id: 'sec-1', name: 'Platform' }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', section: 'Platform' });
  assertEquals(r.success, true);
  assertEquals((r.data as Record<string, unknown>).section, 'Platform');
  const update = sb.callsTo('specification_requirements', 'update')[0].payload as Record<string, unknown>;
  assertEquals(update.section_id, 'sec-1');
  // First section for the spec lands at order_index 0.
  const sectionInsert = sb.callsTo('specification_sections', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(sectionInsert.order_index, 0);

  // null clears — no section lookup, section_id explicit null.
  const sb2 = new FakeSupabase();
  sb2.script('projects', 'select', projectRow());
  sb2.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb2.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  sb2.script('specification_requirements', 'update', { data: null, error: null });
  const r2 = await handleUpdateRequirement(sb2 as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', section: null });
  assertEquals(r2.success, true);
  const update2 = sb2.callsTo('specification_requirements', 'update')[0].payload as Record<string, unknown>;
  assertEquals(update2.section_id, null);
  assertEquals(sb2.callsTo('specification_sections', 'select').length, 0);
});

Deno.test('update_requirement: invalid status rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', status: 'wat' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Invalid status'));
});

Deno.test('update_requirement: replacing criteria preserves met/testId for text-matching entries', async () => {
  // Completion provenance rule (2026-07-21): `met`/`testId`/`provenance` are evidence
  // state — a criteria-list replacement may not erase them for criteria whose text is
  // unchanged. Before the fix this handler reset EVERY criterion to met:false.
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: {
      id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false,
      acceptance_criteria: [
        { text: 'login works', met: true, testId: 'T-1' },
        { text: 'logout works', met: false },
      ],
    },
    error: null,
  });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    acceptance_criteria: ['login works', 'sessions expire after 30m'],
  });
  assertEquals(r.success, true);
  const upd = sb.callsTo('specification_requirements', 'update')[0].payload as { acceptance_criteria: Array<Record<string, unknown>> };
  assertEquals(upd.acceptance_criteria, [
    { text: 'login works', met: true, testId: 'T-1' }, // carried forward verbatim
    { text: 'sessions expire after 30m', met: false }, // new text starts unmet
  ]);
});

Deno.test('update_requirement: reworded criterion resets only itself; other flags survive', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: {
      id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false,
      acceptance_criteria: [
        { text: 'a', met: true, provenance: { source: 'test', at: 't0' } },
        { text: 'b', met: true },
      ],
    },
    error: null,
  });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    acceptance_criteria: ['a', 'b (reworded)'],
  });
  assertEquals(r.success, true);
  const upd = sb.callsTo('specification_requirements', 'update')[0].payload as { acceptance_criteria: Array<Record<string, unknown>> };
  assertEquals(upd.acceptance_criteria, [
    { text: 'a', met: true, provenance: { source: 'test', at: 't0' } },
    { text: 'b (reworded)', met: false },
  ]);
});

Deno.test('WS3 update_requirement: carry-forward preserves verification; explicit lane switch honored both ways', async () => {
  // Same text-match discipline as met/testId: a plain-string replacement keeps the
  // prior lane; an explicit verification switches it ('automated' by DELETING the key).
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: {
      id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false,
      acceptance_criteria: [
        { text: 'human eyeballs the report', met: true, verification: 'manual', provenance: { source: 'git', at: 't0' } },
        { text: 'was manual, now automated', met: false, verification: 'manual' },
        { text: 'stays automated', met: true, testId: 'T-1' },
      ],
    },
    error: null,
  });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleUpdateRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    acceptance_criteria: [
      'human eyeballs the report', // string form → prior manual lane carried forward
      { text: 'was manual, now automated', verification: 'automated' }, // explicit switch → key deleted
      { text: 'stays automated', verification: 'manual' }, // explicit switch the other way
    ],
  });
  assertEquals(r.success, true);
  const upd = sb.callsTo('specification_requirements', 'update')[0].payload as { acceptance_criteria: Array<Record<string, unknown>> };
  assertEquals(upd.acceptance_criteria, [
    { text: 'human eyeballs the report', met: true, verification: 'manual', provenance: { source: 'git', at: 't0' } },
    { text: 'was manual, now automated', met: false },
    { text: 'stays automated', met: true, testId: 'T-1', verification: 'manual' },
  ]);
});

// ── delete_requirement ───────────────────────────────────────────────────────────────

Deno.test('delete_requirement: mapped requirement refuses without force', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  sb.script('specification_mappings', 'select', { count: 2, data: null, error: null });
  const r = await handleDeleteRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('force: true'));
  assertEquals(sb.callsTo('specification_requirements', 'delete').length, 0);
});

Deno.test('delete_requirement: force cascades mappings then deletes', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  sb.script('specification_mappings', 'select', { count: 3, data: null, error: null });
  sb.script('specification_mappings', 'delete', { data: null, error: null });
  sb.script('specification_requirements', 'delete', { data: null, error: null });
  const r = await handleDeleteRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', force: true });
  assertEquals(r.success, true);
  assertEquals((r.data as { deletedMappings: number }).deletedMappings, 3);
  assertEquals(sb.callsTo('specification_mappings', 'delete').length, 1);
  assertEquals(sb.callsTo('specification_requirements', 'delete').length, 1);
});

// ── set_requirement_lock ─────────────────────────────────────────────────────────────

Deno.test('set_requirement_lock: toggles locked and messages accordingly', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: 'r1', requirement_id: 'REQ-001', name: 'n', locked: false }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleSetRequirementLock(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', locked: true });
  assertEquals(r.success, true);
  assertEquals((r.data as { locked: boolean }).locked, true);
  const upd = sb.callsTo('specification_requirements', 'update')[0].payload as Record<string, unknown>;
  assertEquals(upd.locked, true);
});

// ── list_requirements ────────────────────────────────────────────────────────────────

Deno.test('list_requirements: no spec yet → empty, hasSpecification false', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: null, error: null });
  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { hasSpecification: boolean; requirements: unknown[] };
  assertEquals(data.hasSpecification, false);
  assertEquals(data.requirements.length, 0);
});

Deno.test('list_requirements: maps rows and derives categories', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: [
      { id: 'r1', requirement_id: 'REQ-001', name: 'A', description: 'a', category: 'functional', status: 'pending', acceptance_criteria: null, locked: null, created_at: 't', updated_at: 't' },
      { id: 'r2', requirement_id: 'REQ-002', name: 'B', description: 'b', category: 'technical', status: 'implemented', acceptance_criteria: ['x'], locked: true, created_at: 't', updated_at: 't' },
    ],
    error: null,
  });
  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { categories: string[]; requirements: Array<{ requirementId: string; locked: boolean; acceptanceCriteria: unknown[] }> };
  assertEquals(data.categories.sort(), ['functional', 'technical']);
  assertEquals(data.requirements[0].locked, false); // null coerced to false
  assertEquals(data.requirements[1].locked, true);
  assertEquals(data.requirements[0].acceptanceCriteria, []); // null coerced to []
});

// ── R6 commit 1: numbering race + numeric ordering (Discovered #8) ───────────────────

Deno.test('R6 create_requirement: 23505 race → recompute and retry with the FRESH id', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  // Attempt 1: sees REQ-001 → tries REQ-002 → a concurrent create already took it.
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-001' }], error: null });
  sb.script('specification_requirements', 'insert', { data: null, error: { message: 'duplicate key', code: '23505' } });
  // Attempt 2: recompute sees the racer's row → REQ-003 lands.
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-001' }, { requirement_id: 'REQ-002' }], error: null });
  sb.script('specification_requirements', 'insert', { data: { id: 'r1', requirement_id: 'REQ-003', name: 'n', category: 'functional', status: 'pending' }, error: null });

  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd' });
  assertEquals(r.success, true);
  assertEquals((r.data as Record<string, unknown>).requirementId, 'REQ-003');
  const inserts = sb.callsTo('specification_requirements', 'insert');
  assertEquals(inserts.length, 2);
  assertEquals((inserts[0].payload as Record<string, unknown>).requirement_id, 'REQ-002');
  assertEquals((inserts[1].payload as Record<string, unknown>).requirement_id, 'REQ-003', 'second insert carries the RECOMPUTED id, never the stale one');
});

Deno.test('R6 create_requirement: non-23505 insert failure surfaces without retry', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: [], error: null });
  sb.script('specification_requirements', 'insert', { data: null, error: { message: 'RLS says no', code: '42501' } });

  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd' });
  assertEquals(r.success, false);
  assert(String(r.error).includes('RLS says no'), String(r.error));
  assertEquals(sb.callsTo('specification_requirements', 'insert').length, 1, 'no retry on non-race failures');
});

Deno.test('R6 create_requirement: REQ-999 rolls to REQ-1000 (numeric, unbounded past padding)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-999' }], error: null });
  sb.script('specification_requirements', 'insert', { data: { id: 'r1', requirement_id: 'REQ-1000', name: 'n', category: 'functional', status: 'pending' }, error: null });

  const r = await handleCreateRequirement(sb as never, WRITE, { project_id: PROJECT.id, name: 'n', description: 'd' });
  assertEquals(r.success, true);
  assertEquals((sb.callsTo('specification_requirements', 'insert')[0].payload as Record<string, unknown>).requirement_id, 'REQ-1000');
});

Deno.test('R6 list_requirements: NATURAL order — REQ-2 < REQ-10 < REQ-1000 (lexicographic breaks here)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  // The DB pre-sort delivers lexicographic order: REQ-10 < REQ-1000 < REQ-2.
  sb.script('specification_requirements', 'select', {
    data: [
      { id: 'a', requirement_id: 'REQ-10', name: 'A', description: '', category: 'functional', status: 'pending', acceptance_criteria: [], locked: false, created_at: 't', updated_at: 't' },
      { id: 'b', requirement_id: 'REQ-1000', name: 'B', description: '', category: 'functional', status: 'pending', acceptance_criteria: [], locked: false, created_at: 't', updated_at: 't' },
      { id: 'c', requirement_id: 'REQ-2', name: 'C', description: '', category: 'functional', status: 'pending', acceptance_criteria: [], locked: false, created_at: 't', updated_at: 't' },
    ],
    error: null,
  });
  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const ids = (r.data as { requirements: Array<{ requirementId: string }> }).requirements.map((x) => x.requirementId);
  assertEquals(ids, ['REQ-2', 'REQ-10', 'REQ-1000']);
});

Deno.test('list_requirements: read scope required', async () => {
  const sb = new FakeSupabase();
  const r = await handleListRequirements(sb as never, { userId: 'u', scopes: [], authMethod: 'api_key' }, { project_id: PROJECT.id });
  assertEquals(r.success, false);
  assertEquals(sb.calls.length, 0);
});

// ── map_requirement (P1-2 traceability) ───────────────────────────────────────────────

const REQ = { id: '33333333-3333-4333-8333-333333333333', requirement_id: 'REQ-001' };
function specRow() { return { data: { id: 'spec-1' }, error: null }; }
function reqRow(extra: Record<string, unknown> = {}) {
  return { data: { id: REQ.id, requirement_id: REQ.requirement_id, name: 'Auth', locked: false, ...extra }, error: null };
}
function mainBranchRow() { return { data: { id: 'branch-main', name: 'main' }, error: null }; }
function snapshotWithNodes(ids: string[]) {
  const nodes: Record<string, unknown> = {};
  for (const id of ids) nodes[id] = { id, label: id, type: 'backend-service' };
  return { data: { graph_data: { nodes } }, error: null };
}

Deno.test('map_requirement: write scope + non-empty node_ids required', async () => {
  const sb = new FakeSupabase();
  assertEquals((await handleMapRequirement(sb as never, READ, { project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['n1'] })).success, false);
  const sb2 = new FakeSupabase();
  const r = await handleMapRequirement(sb2 as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: [] });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('node_ids'));
});

Deno.test('map_requirement: invalid mapping_type rejected', async () => {
  const sb = new FakeSupabase();
  const r = await handleMapRequirement(sb as never, WRITE, { project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['n1'], mapping_type: 'bogus' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Invalid mapping_type'));
});

Deno.test('map_requirement: node_ids absent from the branch graph are rejected before any write', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', specRow());
  sb.script('specification_requirements', 'select', reqRow());
  sb.script('branches', 'select', mainBranchRow());
  sb.script('graph_snapshots', 'select', snapshotWithNodes(['node-a'])); // node-b missing
  const r = await handleMapRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['node-a', 'node-b'],
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('node-b'), 'names the unknown node');
  assertEquals(sb.callsTo('specification_mappings', 'insert').length, 0, 'no mapping written');
});

Deno.test('map_requirement: creates only new mappings and unions the architecture_trace', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', specRow());
  sb.script('specification_requirements', 'select', reqRow()); // resolveRequirementRow
  sb.script('branches', 'select', mainBranchRow());
  sb.script('graph_snapshots', 'select', snapshotWithNodes(['node-a', 'node-b']));
  // existing mapping already covers node-a → only node-b should be created.
  sb.script('specification_mappings', 'select', { data: [{ node_id: 'node-a' }], error: null });
  sb.script('specification_mappings', 'insert', { data: null, error: null });
  // current architecture_trace already has node-a.
  sb.script('specification_requirements', 'select', { data: { architecture_trace: ['node-a'] }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null });

  const r = await handleMapRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['node-a', 'node-b'],
  });
  assertEquals(r.success, true);
  const data = r.data as { created: number; alreadyMapped: number; architectureTraceCount: number; branch: string };
  assertEquals(data.created, 1);
  assertEquals(data.alreadyMapped, 1);
  assertEquals(data.architectureTraceCount, 2); // node-a ∪ node-b
  assertEquals(data.branch, 'main');

  // Only node-b was inserted.
  const inserted = sb.callsTo('specification_mappings', 'insert')[0].payload as Array<{ node_id: string; mapping_type: string }>;
  assertEquals(inserted.map((m) => m.node_id), ['node-b']);
  assertEquals(inserted[0].mapping_type, 'implements');
  // The trace update wrote the union.
  const traceUpdate = sb.callsTo('specification_requirements', 'update')[0].payload as { architecture_trace: string[] };
  assertEquals(traceUpdate.architecture_trace.sort(), ['node-a', 'node-b']);
});

Deno.test('N5.13 map_requirement mode=remove: deletes listed links + prunes trace, NO liveness validation (dangling-id cleanup lane)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', specRow());
  sb.script('specification_requirements', 'select', reqRow());
  sb.script('branches', 'select', mainBranchRow());
  // Graph no longer contains dead-node — exactly the phantom-mapping cleanup case.
  sb.script('graph_snapshots', 'select', snapshotWithNodes(['node-a']));
  sb.script('specification_mappings', 'select', { data: [{ node_id: 'node-a' }, { node_id: 'dead-node' }], error: null });
  sb.script('specification_mappings', 'delete', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: { architecture_trace: ['node-a', 'dead-node'] }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null });

  const r = await handleMapRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['dead-node'], mode: 'remove',
  });
  assertEquals(r.success, true, `remove of a dangling id must not be rejected: ${r.error ?? ''}`);
  const data = r.data as { removed: number; mappedNodes: string[]; architectureTraceCount: number };
  assertEquals(data.removed, 1);
  assertEquals(data.mappedNodes, ['node-a'], 'response reports the surviving mapping set');
  assertEquals(sb.callsTo('specification_mappings', 'delete').length, 1, 'stale link deleted');
  const traceUpdate = sb.callsTo('specification_requirements', 'update')[0].payload as { architecture_trace: string[] };
  assertEquals(traceUpdate.architecture_trace, ['node-a'], 'trace pruned in the dual-write');
});

Deno.test('N5.13 map_requirement mode=replace: exact set — inserts missing, deletes everything else (incl. dangling)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', specRow());
  sb.script('specification_requirements', 'select', reqRow());
  sb.script('branches', 'select', mainBranchRow());
  sb.script('graph_snapshots', 'select', snapshotWithNodes(['node-a', 'node-b']));
  sb.script('specification_mappings', 'select', { data: [{ node_id: 'node-a' }, { node_id: 'dead-node' }], error: null });
  sb.script('specification_mappings', 'delete', { data: null, error: null });
  sb.script('specification_mappings', 'insert', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: { architecture_trace: ['node-a', 'dead-node'] }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null });

  const r = await handleMapRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['node-a', 'node-b'], mode: 'replace',
  });
  assertEquals(r.success, true);
  const data = r.data as { created: number; removed: number };
  assertEquals(data.created, 1, 'node-b added');
  assertEquals(data.removed, 1, 'dead-node removed implicitly');
  const inserted = sb.callsTo('specification_mappings', 'insert')[0].payload as Array<{ node_id: string }>;
  assertEquals(inserted.map((m) => m.node_id), ['node-b']);
  const traceUpdate = sb.callsTo('specification_requirements', 'update')[0].payload as { architecture_trace: string[] };
  assertEquals(traceUpdate.architecture_trace.sort(), ['node-a', 'node-b'], 'trace = exact set');
});

Deno.test('map_requirement: fully-redundant call writes nothing (idempotent)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', specRow());
  sb.script('specification_requirements', 'select', reqRow());
  sb.script('branches', 'select', mainBranchRow());
  sb.script('graph_snapshots', 'select', snapshotWithNodes(['node-a']));
  sb.script('specification_mappings', 'select', { data: [{ node_id: 'node-a' }], error: null });
  sb.script('specification_requirements', 'select', { data: { architecture_trace: ['node-a'] }, error: null });

  const r = await handleMapRequirement(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: 'REQ-001', node_ids: ['node-a'],
  });
  assertEquals(r.success, true);
  assertEquals(sb.callsTo('specification_mappings', 'insert').length, 0, 'no insert');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'no trace update');
});

// ── R6 commit 6: derived coupling + list_requirements enrichment (Discovered #6) ─────

const GRAPH = {
  nodes: {
    'node-api': { label: 'API Service' },
    'node-db': { label: 'Primary Database' },
    'node-ui': { label: 'Web Frontend' },
    'node-island': { label: 'Island' },
  },
  edges: {
    'e1': { source: 'node-api', target: 'node-db' },
  },
};

Deno.test('coupling: two requirements on the same node → shared_node, via = the node LABEL', () => {
  const out = computeRequirementCoupling(
    { 'REQ-001': ['node-api'], 'REQ-002': ['node-api'] },
    GRAPH,
  );
  assertEquals(out['REQ-001'], [{ requirementId: 'REQ-002', kind: 'shared_node', via: 'API Service' }]);
  assertEquals(out['REQ-002'], [{ requirementId: 'REQ-001', kind: 'shared_node', via: 'API Service' }]);
});

Deno.test('coupling: requirements on edge-bridged nodes → adjacent, via names the edge "src → tgt"', () => {
  const out = computeRequirementCoupling(
    { 'REQ-001': ['node-api'], 'REQ-002': ['node-db'] },
    GRAPH,
  );
  assertEquals(out['REQ-001'], [{ requirementId: 'REQ-002', kind: 'adjacent', via: 'API Service → Primary Database' }]);
  assertEquals(out['REQ-002'], [{ requirementId: 'REQ-001', kind: 'adjacent', via: 'API Service → Primary Database' }]);
});

Deno.test('coupling: NO false positive — distinct nodes without a bridging edge stay uncoupled', () => {
  const out = computeRequirementCoupling(
    { 'REQ-001': ['node-api'], 'REQ-002': ['node-ui'] }, // no api↔ui edge in GRAPH
    GRAPH,
  );
  assertEquals(out, {});
});

Deno.test('coupling: shared_node WINS over adjacent for the same pair (one entry per pair)', () => {
  // Both reqs share node-api AND their nodes are bridged by e1 — shared_node only.
  const out = computeRequirementCoupling(
    { 'REQ-001': ['node-api', 'node-db'], 'REQ-002': ['node-api'] },
    GRAPH,
  );
  assertEquals(out['REQ-001'], [{ requirementId: 'REQ-002', kind: 'shared_node', via: 'API Service' }]);
  assertEquals(out['REQ-002']?.length, 1);
});

Deno.test('coupling: a requirement never couples to itself (mapped to both edge endpoints)', () => {
  const out = computeRequirementCoupling({ 'REQ-001': ['node-api', 'node-db'] }, GRAPH);
  assertEquals(out, {});
});

Deno.test('coupling: unlabeled node and edges-as-array both fall back sanely', () => {
  const out = computeRequirementCoupling(
    { 'REQ-001': ['n1'], 'REQ-002': ['n2'] },
    { nodes: {}, edges: [{ source: 'n1', target: 'n2' }] }, // no labels → ids name the via
  );
  assertEquals(out['REQ-001'], [{ requirementId: 'REQ-002', kind: 'adjacent', via: 'n1 → n2' }]);
});

function scriptEnrichedList(sb: FakeSupabase) {
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: [
      { id: 'row-1', requirement_id: 'REQ-001', name: 'A', description: 'a', category: 'functional', status: 'implemented', acceptance_criteria: [], locked: false, section_id: 'sec-1', architecture_trace: ['node-api'], confirmed: true, created_at: 't', updated_at: 't' },
      { id: 'row-2', requirement_id: 'REQ-002', name: 'B', description: 'b', category: 'functional', status: 'pending', acceptance_criteria: [], locked: false, section_id: null, architecture_trace: null, confirmed: null, created_at: 't', updated_at: 't' },
    ],
    error: null,
  });
  sb.script('specification_sections', 'select', { data: [{ id: 'sec-1', name: 'Core Flows' }], error: null });
  sb.script('specification_mappings', 'select', {
    data: [
      { requirement_id: 'row-1', node_id: 'node-api' },
      { requirement_id: 'row-2', node_id: 'node-db' },
    ],
    error: null,
  });
  sb.script('specification_requirement_relations', 'select', {
    data: [
      { from_requirement_id: 'row-2', to_requirement_id: 'row-1', relation_type: 'expands', source: 'ai', notes: null },
    ],
    error: null,
  });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: GRAPH }, error: null });
}

Deno.test('R6 list_requirements: enriched rows — section, confirmed, trace, mappings, relations both directions, coupling', async () => {
  const sb = new FakeSupabase();
  scriptEnrichedList(sb);
  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const reqs = (r.data as { requirements: Array<Record<string, unknown>> }).requirements;
  const [r1, r2] = reqs;

  // Section resolution + null section stays null.
  assertEquals(r1.sectionId, 'sec-1');
  assertEquals(r1.sectionName, 'Core Flows');
  assertEquals(r2.sectionId, null);
  assertEquals(r2.sectionName, null);

  // Realtime-parity fields (Discovered #7's server-side half).
  assertEquals(r1.confirmed, true);
  assertEquals(r2.confirmed, false); // null coerced
  assertEquals(r1.architectureTrace, ['node-api']);
  assertEquals(r2.architectureTrace, []); // null coerced

  assertEquals(r1.mappedNodeIds, ['node-api']);
  assertEquals(r2.mappedNodeIds, ['node-db']);

  // Relations resolve to human REQ ids: row-2 expands row-1.
  assertEquals(r2.relations, { from: [{ to: 'REQ-001', type: 'expands', source: 'ai' }], to: [] });
  assertEquals(r1.relations, { from: [], to: [{ from: 'REQ-002', type: 'expands', source: 'ai' }] });

  // Coupling: node-api → node-db bridged by e1 → adjacent, via names the edge.
  assertEquals(r1.coupling, [{ requirementId: 'REQ-002', kind: 'adjacent', via: 'API Service → Primary Database' }]);
  assertEquals(r2.coupling, [{ requirementId: 'REQ-001', kind: 'adjacent', via: 'API Service → Primary Database' }]);
});

Deno.test('R6 list_requirements: relation whose counterpart is NOT in the returned rows is omitted, not half-resolved', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: [
      { id: 'row-1', requirement_id: 'REQ-001', name: 'A', description: 'a', category: 'functional', status: 'pending', acceptance_criteria: [], locked: false, section_id: null, architecture_trace: null, confirmed: null, created_at: 't', updated_at: 't' },
    ],
    error: null,
  });
  sb.script('specification_sections', 'select', { data: [], error: null });
  sb.script('specification_mappings', 'select', { data: [], error: null });
  sb.script('specification_requirement_relations', 'select', {
    data: [
      { from_requirement_id: 'row-1', to_requirement_id: 'row-gone', relation_type: 'depends_on', source: 'user', notes: null },
    ],
    error: null,
  });
  sb.script('branches', 'select', { data: null, error: null }); // no main branch → empty graph, no coupling
  const r = await handleListRequirements(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const [row] = (r.data as { requirements: Array<Record<string, unknown>> }).requirements;
  assertEquals(row.relations, { from: [], to: [] });
  assertEquals(row.coupling, []);
  assertEquals(sb.callsTo('graph_snapshots', 'select').length, 0, 'no snapshot read without a main branch');
});
