// V3 P2 (task 2.3): the spec-plane patch vocabulary + apply. Pins: the
// union and the kind table can never drift apart; graph ops fold to kind
// 'patch'; promotion doctrine (NEVER_AUTO_APPLY, the deterministic
// criterion gate, decided-is-terminal, the null-node mapping skip, the
// backfill-shaped requirement insert); workflow upsert's create vs update
// lanes and the project guard; and requirement-kind delegation reaching
// the shipped handlers (update_vision round-trips through the real one).
import {
  SpecPatchOperationSchema,
  SPEC_PATCH_KIND,
  patchKindOf,
  NEVER_AUTO_APPLY,
  AnyProposalPatchSchema,
} from '../_shared/spec-patch-schema.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { OUTCOME_ON_PROJECT_NOTE, WORKFLOWS_STAY } from '../_shared/workflow-gate.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CAND = '33333333-3333-4333-8333-333333333333';
const WF = '44444444-4444-4444-8444-444444444444';
const SPEC = '55555555-5555-4555-8555-555555555555';

const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;
// P: Workflows are Indie and above, so a lane-shaping op reads the plan first.
const INDIE = { plan_name: 'indie', status: 'active' };

const meta = () => ({
  id: crypto.randomUUID(),
  actorType: 'ai' as const,
  actorId: 'claude · bench',
  summary: 'bench patch',
  timestamp: new Date().toISOString(),
});

// deno-lint-ignore no-explicit-any
const specPatch = (type: string, payload: unknown): any => {
  const parsed = SpecPatchOperationSchema.safeParse({ type, metadata: meta(), payload });
  if (!parsed.success) throw new Error(`fixture does not parse: ${type}: ${parsed.error.message}`);
  return parsed.data;
};

Deno.test('vocabulary: the union and the kind table cover exactly the same types; graph ops fold to patch', () => {
  const unionTypes = SpecPatchOperationSchema.options.map((o) => o.shape.type.value as string).sort();
  const tableTypes = Object.keys(SPEC_PATCH_KIND).sort();
  assertEquals(unionTypes, tableTypes, 'SPEC_PATCH_KIND drifted from the union');
  for (const t of unionTypes) {
    assert(['requirement', 'outcome', 'workflow'].includes(patchKindOf(t)), `${t} has a spec kind`);
  }
  assertEquals(patchKindOf('add_node'), 'patch');
  assertEquals(patchKindOf('update_contract'), 'patch');
  for (const t of NEVER_AUTO_APPLY) {
    assert(unionTypes.includes(t), `NEVER_AUTO_APPLY names a real op (${t})`);
  }
  assert(NEVER_AUTO_APPLY.has('promote_candidate'), 'promotion is a human act — proposal lane only');
  assert(NEVER_AUTO_APPLY.has('settle_candidate'), 'settling the source is the same human act (R6)');
});

Deno.test('vocabulary: the widened proposal parse accepts both planes', () => {
  const graph = AnyProposalPatchSchema.safeParse({
    type: 'remove_node', metadata: meta(), payload: { id: crypto.randomUUID() },
  });
  assert(graph.success, 'graph op parses');
  const spec = AnyProposalPatchSchema.safeParse({
    type: 'update_vision', metadata: meta(), payload: { vision: 'A CRM for small teams' },
  });
  assert(spec.success, 'spec op parses');
  const junk = AnyProposalPatchSchema.safeParse({ type: 'reboot_prod', metadata: meta(), payload: {} });
  assert(!junk.success, 'unknown types are refused');
});

Deno.test('promote_candidate: the gate refuses a candidate with no testable criterion', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', {
    data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'outcome:aa11', kind: 'outcome', name: 'AI board summarization', description: '', category: 'functional', criteria: [], status: 'pending', requirement_row_id: null },
    error: null,
  });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assertEquals(r.applied, false);
  assert(String((r as { error: string }).error).includes('no testable outcome'), 'the refusal names the gate');
  assertEquals(sb.callsTo('specification_requirements', 'insert').length, 0, 'nothing was minted');
});

Deno.test('promote_candidate: null-node ideation outcome DERIVES the requirement, SKIPS the mapping, records the derivation, leaves the candidate pending', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', {
    data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'outcome:bb22', kind: 'outcome', name: 'Tenants export their data', description: 'On demand.', category: 'functional', criteria: [{ text: 'Export completes under 60s' }, { text: 'Officer signs off', verification: 'manual' }], status: 'pending', requirement_row_id: null },
    error: null,
  });
  // v3l: no prior derivations (FakeSupabase's default null reads as none)
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });     // resolveSpecForProject
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-007' }], error: null }); // nextRequirementId
  sb.script('specification_requirements', 'insert', { data: { id: 'req-row-1', requirement_id: 'REQ-008' }, error: null });
  sb.script('outcome_derivations', 'insert', { data: null, error: null });
  sb.script('requirement_candidates', 'update', { data: null, error: null });

  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assertEquals(r.applied, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const result = (r as any).result;
  assertEquals(result.requirementId, 'REQ-008');
  assertEquals(result.claimed, 2);
  assertEquals(result.remaining, 0);
  assertEquals(result.derivations, 1);

  // The backfill-shaped insert: source ai-generated, unmet criteria, the
  // manual marker surviving, promotion provenance in metadata — now with
  // the derivation id and the claimed criterion ids (text-hash ids: the
  // fixture criteria were drafted without ids).
  // deno-lint-ignore no-explicit-any
  const ins = sb.callsTo('specification_requirements', 'insert')[0].payload as any;
  assertEquals(ins.source, 'ai-generated');
  assertEquals(ins.acceptance_criteria[0], { text: 'Export completes under 60s', met: false });
  assertEquals(ins.acceptance_criteria[1].verification, 'manual');
  assert(ins.metadata.promotion.candidateId === CAND, 'promotion provenance recorded');
  assertEquals(ins.metadata.promotion.derivationId, result.derivationId);
  assertEquals(ins.metadata.promotion.criterionIds.length, 2);
  assert(ins.metadata.promotion.criterionIds.every((id: string) => /^h[0-9a-f]{8}$/.test(id)), 'legacy criteria claim by text-hash id');
  // Ideation-born: no node, no fabricated mapping.
  assertEquals(sb.callsTo('specification_mappings', 'insert').length, 0, 'null-node candidate maps nothing');
  // The derivation row is the record (R5): slice, proposer (the api key), approver.
  // deno-lint-ignore no-explicit-any
  const der = sb.callsTo('outcome_derivations', 'insert')[0].payload as any;
  assertEquals(der.id, result.derivationId);
  assertEquals(der.candidate_id, CAND);
  assertEquals(der.requirement_row_id, 'req-row-1');
  assertEquals(der.criteria_slice.map((c: { text: string }) => c.text), ['Export completes under 60s', 'Officer signs off']);
  assertEquals(der.proposed_by_kind, 'agent');
  assertEquals(der.proposed_by_id, 'k1');
  assertEquals(der.via_proposal_id, null);
  assertEquals(der.approved_by, 'user-1');
  // The candidate is LINKED (first derivation) but stays pending — no status write.
  // deno-lint-ignore no-explicit-any
  const mark = sb.callsTo('requirement_candidates', 'update')[0].payload as any;
  assertEquals(mark.requirement_row_id, 'req-row-1');
  assertEquals(mark.status, undefined, 'promotion never writes accepted — settle does');
  assertEquals(mark.decided_at, undefined);
});

Deno.test('decided candidates are terminal: promote and update refuse dismissed/accepted rows', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', {
    data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'k', kind: 'outcome', name: 'n', description: '', category: 'functional', criteria: [{ text: 'x' }], status: 'dismissed', requirement_row_id: null },
    error: null,
  });
  const p = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assertEquals(p.applied, false);
  assert(String((p as { error: string }).error).includes('dismissed is terminal'));

  sb.script('requirement_candidates', 'select', {
    data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'k', kind: 'outcome', name: 'n', description: '', category: 'functional', criteria: [], status: 'accepted', requirement_row_id: 'req-row-1' },
    error: null,
  });
  const u = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('update_candidate', { candidateId: CAND, changes: { name: 'renamed' } }));
  assertEquals(u.applied, false);
  assert(String((u as { error: string }).error).includes('terminal'));
});

Deno.test('upsert_workflow: no id inserts with the acting user; an id updates within the project or refuses', async () => {
  const sb = new FakeSupabase();
  for (let n = 0; n < 3; n++) sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('workflows', 'select', { data: null, error: null }); // no lane of that name yet
  sb.script('workflows', 'insert', { data: { id: WF }, error: null });
  const created = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow', { name: 'Product Development', color: '#8B8FE6' }));
  assertEquals(created.applied, true);
  // deno-lint-ignore no-explicit-any
  const ins = sb.callsTo('workflows', 'insert')[0].payload as any;
  assertEquals(ins.project_id, PROJECT.id);
  assertEquals(ins.created_by, 'user-1');

  sb.script('workflows', 'update', { data: { id: WF }, error: null });
  const updated = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow', { id: WF, name: 'IT Platform' }));
  assertEquals(updated.applied, true);

  sb.script('workflows', 'update', { data: null, error: null }); // foreign/missing lane
  const foreign = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow', { id: WF, name: 'Nope' }));
  assertEquals(foreign.applied, false);
});

Deno.test('upsert_workflow_step: the lane must belong to the project', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('workflows', 'select', { data: null, error: null }); // guard: not this project's lane
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow_step', { workflowId: WF, name: 'Design' }));
  assertEquals(r.applied, false);
  assert(String((r as { error: string }).error).includes('Workflow not found'));
});

Deno.test('set_outcome_step_maps: replaces the set, dedupes, and guards the candidate', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('requirement_candidates', 'select', {
    data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'k', kind: 'outcome', name: 'n', description: '', category: 'functional', criteria: [], status: 'pending', requirement_row_id: null },
    error: null,
  });
  sb.script('outcome_step_maps', 'delete', { data: null, error: null });
  sb.script('outcome_step_maps', 'insert', { data: null, error: null });
  const stepA = crypto.randomUUID();
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('set_outcome_step_maps', { candidateId: CAND, branchId: BRANCH, stepIds: [stepA, stepA] }));
  assertEquals(r.applied, true);
  // deno-lint-ignore no-explicit-any
  const rows = sb.callsTo('outcome_step_maps', 'insert')[0].payload as any[];
  assertEquals(rows.length, 1, 'duplicate step ids collapse');
  assertEquals(rows[0].candidate_id, CAND);
});

Deno.test('set_outcome_step_maps: a DECIDED outcome keeps the steps it was filed on', async () => {
  // This case loaded the candidate and then never read its status, so it was
  // the one candidate op that let a settled or dismissed outcome be remapped —
  // rewriting the record of where that work was filed. v3t enforces it at the
  // database in every lane; this is the message an agent gets.
  for (const status of ['accepted', 'dismissed']) {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
    sb.script('requirement_candidates', 'select', {
      data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'k', kind: 'outcome', name: 'n', description: '', category: 'functional', criteria: [], status, requirement_row_id: null },
      error: null,
    });
    const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('set_outcome_step_maps', { candidateId: CAND, branchId: BRANCH, stepIds: [crypto.randomUUID()] }));
    assertEquals(r.applied, false, `${status} was remapped`);
    const err = String((r as { error: string }).error);
    assert(err.includes(status), err);
    assert(err.includes('Create a new outcome to map different steps'), err);
    // and it refuses BEFORE touching anything — no delete-then-fail
    assertEquals(sb.callsTo('outcome_step_maps', 'delete').length, 0, 'the existing maps were not cleared before the refusal');
    assertEquals(sb.callsTo('outcome_step_maps', 'insert').length, 0);
  }
});

Deno.test('requirement kind delegates to the shipped handlers: update_vision round-trips through the real one', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });          // the handler's own resolve
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('project_specifications', 'update', { data: null, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('update_vision', { vision: 'Architecture as data.' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const upd = sb.callsTo('project_specifications', 'update')[0].payload as any;
  assertEquals(upd.vision, 'Architecture as data.');
});

// ── 9.5 (v3v): create_candidate and the home lane ────────────────────────────
// An outcome may name its home workflow; a lane of another project is refused
// by name; absent, the insert carries no workflow_id and the database homes
// the row in the project's first lane (never orphaned).
Deno.test('create_candidate (9.5): a named home lane of this project is written on the row', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null }); // P: naming a lane is an Indie act
  sb.script('workflows', 'select', { data: { id: WF }, error: null });
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('create_candidate', { branchId: BRANCH, workflowId: WF, name: 'Tenants export their data' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const insert = sb.callsTo('requirement_candidates', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.workflow_id, WF);
  // the lane lookup is scoped to the project — a lane id alone never passes
  const lookup = sb.callsTo('workflows', 'select')[0];
  assert(lookup.filters.some((f) => f.method === 'eq' && f.args[0] === 'project_id' && f.args[1] === PROJECT.id), 'lane checked against THIS project');
});

Deno.test('create_candidate (9.5): a lane that is not this project\'s is refused by name, nothing inserted', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null }); // P: naming a lane is an Indie act
  sb.script('workflows', 'select', { data: null, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('create_candidate', { branchId: BRANCH, workflowId: WF, name: 'stray' }));
  assertEquals(r.applied, false);
  assert(String((r as { error: string }).error).includes('is not a workflow of this project'), 'names the refusal');
  assert(String((r as { error: string }).error).includes('get_outcome_board lists the lanes'), 'names the way through');
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 0);
});

Deno.test('create_candidate (9.5): no lane named → no workflow_id on the insert; the v3v trigger homes it', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('create_candidate', { branchId: BRANCH, name: 'unhomed by the caller' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const insert = sb.callsTo('requirement_candidates', 'insert')[0].payload as Record<string, unknown>;
  assert(!('workflow_id' in insert), 'absent, not null — the trigger decides');
  assertEquals(sb.callsTo('workflows', 'select').length, 0, 'no lookup without a lane to check');
});

// ── 9.6: lanes by name, idempotent lanes; P: Workflows start at Indie ────────
// A context proposal creates a lane and then names it from its steps and
// outcomes in the same batch (no id exists yet). Pins: upsert_workflow on an
// existing name updates instead of failing the accept; upsert_workflow_step
// and create_candidate resolve `workflowName` against THIS project's lanes.
//
// P (2026-09-22) retired the below-Team "one lane" merge. Indie and Team
// create the lane they name. Below Indie every lane-shaping op is refused
// at the door, by name, before a single read or write; create_candidate
// still files the outcome, on the project, and says so.

const TEAM = { plan_name: 'team', status: 'active' };
const stepInsert = (sb: FakeSupabase) => sb.callsTo('workflow_steps', 'insert')[0].payload as Record<string, unknown>;

Deno.test('upsert_workflow (9.6): naming an existing lane updates it — existing: true, nothing inserted', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('workflows', 'select', { data: { id: WF, name: 'IT Platform' }, error: null });
  sb.script('workflows', 'update', { data: null, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow', { name: 'IT Platform', color: '#123456' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  assertEquals((r as { result: Record<string, unknown> }).result, { workflowId: WF, existing: true });
  assertEquals(sb.callsTo('workflows', 'insert').length, 0, 'no duplicate lane');
  const lookup = sb.callsTo('workflows', 'select')[0];
  assert(lookup.filters.some((f) => f.method === 'eq' && f.args[0] === 'project_id' && f.args[1] === PROJECT.id), 'scoped to THIS project');
  assert(lookup.filters.some((f) => f.method === 'eq' && f.args[0] === 'name' && f.args[1] === 'IT Platform'));
  const upd = sb.callsTo('workflows', 'update')[0].payload as Record<string, unknown>;
  assertEquals(upd.color, '#123456');
});

for (const [plan, row] of [['Indie', INDIE], ['Team', TEAM]] as const) {
  Deno.test(`upsert_workflow (P): ${plan} creates a new lane by name, with no merge into an existing one`, async () => {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: row, error: null });
    sb.script('workflows', 'select', { data: null, error: null }); // no lane of that name
    sb.script('workflows', 'insert', { data: { id: WF }, error: null });
    const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow', { name: 'Onboarding' }));
    assertEquals(r.applied, true, JSON.stringify(r));
    assertEquals((r as { result: Record<string, unknown> }).result, { workflowId: WF, created: true });
    const ins = sb.callsTo('workflows', 'insert')[0].payload as Record<string, unknown>;
    assertEquals(ins.name, 'Onboarding');
    assertEquals(ins.project_id, PROJECT.id);
    assertEquals(sb.callsTo('workflows', 'select').length, 1, 'one lookup by name; no first-lane read for a merge');
  });
}

Deno.test('P: Community is refused every lane-shaping op, by name, before any read or write, and told what stays', async () => {
  const ops: Array<[string, unknown]> = [
    ['upsert_workflow', { name: 'Ops' }],
    ['delete_workflow', { id: WF }],
    ['upsert_workflow_step', { workflowId: WF, name: 'Deploy' }],
    ['delete_workflow_step', { id: crypto.randomUUID() }],
    ['set_outcome_step_maps', { candidateId: CAND, branchId: BRANCH, stepIds: [crypto.randomUUID()] }],
  ];
  for (const [type, payload] of ops) {
    const sb = new FakeSupabase(); // no subscription row: Community
    const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch(type, payload));
    assertEquals(r.applied, false, `${type} applied on Community`);
    const err = String((r as { error: string }).error);
    assert(err.includes(`Shaping a workflow (${type}) is available on Indie and above`), err);
    assert(err.includes('this account resolves to the Community tier'), err);
    assert(err.includes(WORKFLOWS_STAY), 'the refusal says what keeps working');
    for (const table of ['workflows', 'workflow_steps', 'outcome_step_maps', 'requirement_candidates']) {
      assertEquals(sb.callsTo(table).length, 0, `${type} touched ${table} before refusing`);
    }
  }
});

Deno.test('upsert_workflow_step (9.6): resolves workflowName against this project; the step name is as given', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('workflows', 'select', { data: { id: WF, name: 'Onboarding' }, error: null });
  sb.script('workflow_steps', 'insert', { data: { id: 'step-1' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow_step', { workflowName: 'Onboarding', name: 'Sign up', sortOrder: 2 }));
  assertEquals(r.applied, true, JSON.stringify(r));
  assertEquals((r as { result: Record<string, unknown> }).result, { stepId: 'step-1', created: true });
  assertEquals(stepInsert(sb), { workflow_id: WF, name: 'Sign up', sort_order: 2 });
  const lookup = sb.callsTo('workflows', 'select')[0];
  assert(lookup.filters.some((f) => f.method === 'eq' && f.args[0] === 'name' && f.args[1] === 'Onboarding'));
  assert(lookup.filters.some((f) => f.method === 'eq' && f.args[0] === 'project_id' && f.args[1] === PROJECT.id), 'never another project\'s lane');
});

for (const [plan, row] of [['Indie', INDIE], ['Team', TEAM]] as const) {
  Deno.test(`upsert_workflow_step (P): ${plan} with an unknown lane name is refused with the way through; never merged or prefixed`, async () => {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: row, error: null });
    sb.script('workflows', 'select', { data: null, error: null });
    const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow_step', { workflowName: 'Nope', name: 'Deploy' }));
    assertEquals(r.applied, false);
    const err = String((r as { error: string }).error);
    assert(err.includes('Workflow "Nope" not found in this project'), err);
    assert(err.includes('Put an upsert_workflow for it EARLIER in the same proposal'), err);
    assertEquals(sb.callsTo('workflow_steps', 'insert').length, 0);
  });
}

Deno.test('upsert_workflow_step (9.6): neither id nor name is refused', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  const none = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('upsert_workflow_step', { name: 'Orphan' }));
  assertEquals(none.applied, false);
  assert(String((none as { error: string }).error).includes('workflowId or workflowName is required'));
});

Deno.test('create_candidate (P): Indie homes the outcome by lane name; no note', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('workflows', 'select', { data: { id: WF, name: 'Onboarding' }, error: null });
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('create_candidate', { branchId: BRANCH, workflowName: 'Onboarding', name: 'New users reach the dashboard' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const insert = sb.callsTo('requirement_candidates', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.workflow_id, WF);
  assert(!('note' in (r as { result: Record<string, unknown> }).result), 'placed where asked, nothing to say');
});

Deno.test('create_candidate (P): on Community a named workflow is not honoured; the outcome still files, homed by the database, and the result says where it went', async () => {
  for (const named of [{ workflowName: 'Ops' }, { workflowId: WF }]) {
    const sb = new FakeSupabase(); // Community
    sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
    const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('create_candidate', { branchId: BRANCH, ...named, name: 'Deploys are one click' }));
    assertEquals(r.applied, true, JSON.stringify(r));
    const insert = sb.callsTo('requirement_candidates', 'insert')[0].payload as Record<string, unknown>;
    // No workflow_id: the v3v trigger homes it (workflow_id is NOT NULL), so it is never orphaned.
    assert(!('workflow_id' in insert), `a Community outcome was pinned to a lane: ${JSON.stringify(insert)}`);
    assertEquals(sb.callsTo('workflows').length, 0, 'no lane is read or created on Community');
    const data = (r as { result: Record<string, unknown> }).result;
    assertEquals(data.workflow, null, 'the result says plainly that no workflow was used');
    assertEquals(data.note, OUTCOME_ON_PROJECT_NOTE('workflowName' in named ? 'Ops' : WF));
    assert(!('mergedInto' in data), 'the retired merge vocabulary is gone');
  }
});

Deno.test('create_candidate (P): naming nothing reads no tier at all; the outcome files as it always did', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT.id, specPatch('create_candidate', { branchId: BRANCH, name: 'Search finds the book' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  assertEquals(sb.callsTo('stripe_subscriptions').length, 0, 'an outcome with no workflow costs no tier read');
  assert(!('note' in (r as { result: Record<string, unknown> }).result));
});
