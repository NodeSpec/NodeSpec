// Z (owner 2026-09-23): the agent files a constraint over MCP, tiered.
// AC (owner 2026-09-24): constraints do not exist below Indie.
//
// create_constraint rides propose_patches like every spec op. Every
// constraint op, project-wide or scoped, is Indie and above: refused at
// propose (the whole batch, by name, nothing filed) and again at apply (a
// proposal filed on Indie and accepted after a downgrade). The row is the
// app's row: the same identity, so the same constraint from either door is
// recorded once.
import {
  SpecPatchOperationSchema,
  SPEC_PATCH_KIND,
  patchKindOf,
  NEVER_AUTO_APPLY,
} from '../_shared/spec-patch-schema.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { handleProposePatches } from '../mcp-server/tools/proposals.ts';
import { laneOfPatchType } from '../mcp-server/tools/change-router.ts';
import { CONSTRAINTS_STAY, isConstraintOp, isWorkflowOp, requireConstraints } from '../_shared/workflow-gate.ts';
import { CONSTRAINT_TYPES, constraintIdentity } from '../_shared/constraint-identity.ts';
import { toolsForTier } from '../mcp-server/tool-surface.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WF = '44444444-4444-4444-8444-444444444444';
const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write', 'propose'] } as AuthResult;
// AL.6: a key that may only propose files and waits at any level; these pin filing, not autonomy.
const FILER = { ...AUTH, scopes: ['read', 'propose'] } as AuthResult;
const INDIE = { plan_name: 'indie', status: 'active' };

// deno-lint-ignore no-explicit-any
const constraint = (payload: Record<string, unknown>): any => {
  const parsed = SpecPatchOperationSchema.safeParse({
    type: 'create_constraint',
    metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId: 'claude · bench', summary: 'bench', timestamp: new Date().toISOString() },
    payload,
  });
  if (!parsed.success) throw new Error(`fixture does not parse: ${parsed.error.message}`);
  return parsed.data;
};

// ── the vocabulary and the gate ─────────────────────────────────────────────

Deno.test('Z vocabulary: create_constraint is a requirement-kind spec op on the Requirements lane, auto-applicable, with the eight canonical types', () => {
  assertEquals(SPEC_PATCH_KIND.create_constraint, 'requirement');
  assertEquals(patchKindOf('create_constraint'), 'requirement');
  assertEquals(laneOfPatchType('create_constraint'), 'requirements');
  assert(!NEVER_AUTO_APPLY.has('create_constraint'), 'filing a constraint is not the promotion line');
  assertEquals([...CONSTRAINT_TYPES], ['technology', 'architecture', 'deployment', 'performance', 'security', 'compliance', 'cost', 'other']);
  const bad = SpecPatchOperationSchema.safeParse({ type: 'create_constraint', metadata: constraint({ ctype: 'cost', description: 'x' }).metadata, payload: { ctype: 'budget', description: 'x' } });
  assert(!bad.success, 'an invented ctype is refused at validation');
});

Deno.test('AC gate: every constraint op is Indie and above, apart from the workflow ops; its refusal says what keeps working', () => {
  for (const op of ['create_constraint', 'update_constraint', 'delete_constraint']) {
    assert(isConstraintOp(op), op);
    assert(!isWorkflowOp(op), `${op} has its own refusal`);
  }
  assert(!isConstraintOp('create_candidate'), 'outcomes keep their own rule');
  assert(!isConstraintOp(undefined));
  const r = requireConstraints('community', 'Working with constraints (create_constraint)');
  assert(!r.ok);
  assert(r.error.startsWith('Working with constraints (create_constraint) is available on Indie and above; this account resolves to the Community tier.'), r.error);
  assert(r.error.endsWith(CONSTRAINTS_STAY), r.error);
  assertEquals(requireConstraints('indie', 'x'), { ok: true });
});

Deno.test('Z identity: the hash the agent mints is the hash the app minted before (ctype, a NUL, the trimmed description)', async () => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('security\u0000Sessions expire after 15 minutes idle'));
  const expected = `app-sha256:${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  assertEquals(await constraintIdentity('security', '  Sessions expire after 15 minutes idle '), expected);
});

// ── apply ───────────────────────────────────────────────────────────────────

Deno.test('Z apply: on Indie a project-wide constraint is the app\'s row with the proposer as author', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('project_constraints', 'insert', { data: { id: 'pc-1' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, constraint({ ctype: 'security', description: ' Sessions expire after 15 minutes idle ', title: 'Short sessions', rationale: 'Stolen sessions die fast' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const row = sb.callsTo('project_constraints', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(row, {
    project_id: PROJECT, ctype: 'security', description: 'Sessions expire after 15 minutes idle',
    source_hash: await constraintIdentity('security', 'Sessions expire after 15 minutes idle'),
    workflow_id: null, title: 'Short sessions', rationale: 'Stolen sessions die fast', author: 'claude · bench',
  });
  assertEquals((r as { result: Record<string, unknown> }).result, { constraintId: 'pc-1', ctype: 'security', workflowId: null });
});

Deno.test('AC apply: on Community every constraint op is refused with the upgrade and what keeps working, and nothing is written', async () => {
  const ops = [
    constraint({ ctype: 'security', description: 'Sessions expire after 15 minutes idle' }),
    constraint({ ctype: 'performance', description: 'Checkout answers in 300 ms', workflowId: WF }),
    constraint({ ctype: 'performance', description: 'Checkout answers in 300 ms', workflowName: 'Checkout' }),
    { ...constraint({ ctype: 'cost', description: 'x' }), type: 'update_constraint', payload: { constraintId: 'pc-1', changes: { title: 'Cheap' } } },
    { ...constraint({ ctype: 'cost', description: 'x' }), type: 'delete_constraint', payload: { constraintId: 'pc-1', reason: 'gone' } },
  ];
  for (const op of ops) {
    const sb = new FakeSupabase(); // Community
    const r = await applySpecPatch(sb as never, AUTH, PROJECT, op);
    assertEquals(r.applied, false, JSON.stringify(r));
    const err = (r as { error: string }).error;
    assert(err.startsWith(`Working with constraints (${op.type}) is available on Indie and above`), err);
    assert(err.endsWith(CONSTRAINTS_STAY), err);
    assertEquals(sb.callsTo('project_constraints').length, 0, op.type);
    assertEquals(sb.callsTo('workflows').length, 0, 'no lane is read on Community');
  }
});

Deno.test('Z apply: on Indie a constraint is scoped by lane name, checked against this project', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('workflows', 'select', { data: { id: WF, name: 'Checkout' }, error: null });
  sb.script('project_constraints', 'insert', { data: { id: 'pc-2' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, constraint({ ctype: 'performance', description: 'Checkout answers in 300 ms', workflowName: 'Checkout' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const lane = sb.callsTo('workflows', 'select')[0];
  assert(JSON.stringify(lane.filters).includes(PROJECT), 'the lane is looked up in this project only');
  assertEquals((sb.callsTo('project_constraints', 'insert')[0].payload as Record<string, unknown>).workflow_id, WF);

  const missing = new FakeSupabase();
  missing.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  const m = await applySpecPatch(missing as never, AUTH, PROJECT, constraint({ ctype: 'performance', description: 'Checkout answers in 300 ms', workflowName: 'Nowhere' }));
  assertEquals(m.applied, false);
  assert((m as { error: string }).error.startsWith('create_constraint refused: Workflow "Nowhere" not found in this project.'), (m as { error: string }).error);
  assertEquals(missing.callsTo('project_constraints').length, 0);
});

Deno.test('Z apply: the same constraint a second time, from either door, is refused as already recorded', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('project_constraints', 'insert', { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "project_constraints_project_id_source_hash_key"' } });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, constraint({ ctype: 'cost', description: 'Under 40 dollars a month' }));
  assertEquals(r, { applied: false, error: 'create_constraint refused: this cost constraint is already recorded on the project.' });
});

// ── propose ─────────────────────────────────────────────────────────────────

function scriptProposal(sb: FakeSupabase, plan: Record<string, string> | null) {
  if (plan) sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: plan, error: null });
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Demo' }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('projects', 'select', { data: null, error: null }); // the policy read
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
}

Deno.test('AC propose: on Community any constraint refuses the whole batch by name and files nothing', async () => {
  const sb = new FakeSupabase();
  scriptProposal(sb, null);
  const r = await handleProposePatches(sb as never, FILER, {
    project_id: PROJECT, branch_id: BRANCH,
    patches: [
      { type: 'create_constraint', payload: { ctype: 'security', description: 'Sessions expire after 15 minutes idle' } },
      { type: 'create_constraint', payload: { ctype: 'performance', description: 'Checkout answers in 300 ms', workflowName: 'Checkout' } },
    ],
  });
  assertEquals(r.success, false, JSON.stringify(r));
  const err = String(r.error);
  assert(err.startsWith('Working with constraints (patch[0] create_constraint, patch[1] create_constraint) is available on Indie and above'), err);
  assert(err.includes(CONSTRAINTS_STAY) && err.endsWith('Nothing was created.'), err);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'a batch is never half-filed');
});

Deno.test('Z propose: on Indie a project-wide and a scoped constraint file, on the Requirements lane', async () => {
  for (const payload of [
    { ctype: 'security', description: 'Sessions expire after 15 minutes idle' },
    { ctype: 'performance', description: 'Checkout answers in 300 ms', workflowId: WF },
  ]) {
    const sb = new FakeSupabase();
    scriptProposal(sb, INDIE);
    const r = await handleProposePatches(sb as never, FILER, {
      project_id: PROJECT, branch_id: BRANCH,
      patches: [{ type: 'create_constraint', payload }],
    });
    assertEquals(r.success, true, JSON.stringify(r));
    assertEquals(sb.callsTo('ai_proposals', 'insert').length, 1);
    assertEquals((r.data as { routing: { lane: string } }).routing.lane, 'requirements');
  }
});

// ── the tool surface by plan ────────────────────────────────────────────────

Deno.test('AC surface: Indie and above read the constraint ops; below Indie no tool names a constraint', () => {
  const describe = (tier: 'community' | 'indie') =>
    String(toolsForTier(tier).find((t) => t.name === 'propose_patches')!.description);
  assert(describe('indie').includes('create_constraint { ctype: technology|architecture|deployment|performance|security|compliance|cost|other, description, title?, rationale?, scope?: { kind: role|technology|contract_kind|node, value }, kind?: guide|check,'));
  assert(describe('indie').includes('update_constraint { constraintId, changes?, addWaiver?: { target, reason, expiresAt? }, removeWaiver? } and delete_constraint { constraintId, reason } are accepted by the user in the app only'));
  assert(describe('indie').includes('the constraint ops (create_constraint, update_constraint, delete_constraint) need Indie and above'));
  for (const tool of toolsForTier('community')) {
    assert(!/constraint/i.test(JSON.stringify(tool)), `${tool.name} names a constraint on Community`);
  }
});
