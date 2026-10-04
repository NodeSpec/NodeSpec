// R.2b and R.2c (owner 2026-09-24): a constraint is guidance or a check, for
// a scope, and it learns from use. "Okay as long as the rules are quality
// and contextual to the user's project (i.e. uses the user's AI over MCP or
// it's deterministically done but without generalized guidance)."
//
// So: NodeSpec ships no rule and words none. A check is a closed predicate
// with this project's scope and parameters; what the server notices goes to
// the agent as evidence and an ask; the user decides.
import {
  SpecPatchOperationSchema, SPEC_PATCH_KIND, NEVER_AUTO_APPLY,
} from '../_shared/spec-patch-schema.ts';
import {
  CHECK_PREDICATES, SIGNAL_ASKS, asCheckSpec, batchCounts, describeCheck, describeScope, evaluateCheck, evaluateChecks,
  introduced, judgeBatch, nodesInScope, projectPatches, repeatedLearnings, ruleFromRow, ruleSignals,
  type RuleGraph, type RuleView,
} from '../_shared/constraint-rules.ts';
import {
  constraintsSignature, judgeProposal, loadNodeConstraints, renderConstraintsSection, type NodeConstraint,
} from '../_shared/node-constraints.ts';
import { laneOfPatchType } from '../mcp-server/tools/change-router.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { handleResolveProposal } from '../mcp-server/tools/approvals.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals, scriptOwnerPlan } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333331';
const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write', 'propose'] } as AuthResult;
const INDIE = { plan_name: 'indie', status: 'active' };
const meta = () => ({ id: crypto.randomUUID(), actorType: 'ai', actorId: 'claude · bench', summary: 'bench', timestamp: new Date().toISOString() });
// deno-lint-ignore no-explicit-any
const spec = (type: string, payload: Record<string, unknown>): any => {
  const parsed = SpecPatchOperationSchema.safeParse({ type, metadata: meta(), payload });
  if (!parsed.success) throw new Error(`fixture does not parse: ${parsed.error.message}`);
  return parsed.data;
};

// A small system: a web app, an API with a part, a worker, Postgres.
const G = (): RuleGraph => ({
  nodes: {
    web: { id: 'web', type: 'frontend', label: 'Web app', technology: 'react' },
    api: { id: 'api', type: 'backend-service', label: 'API', technology: 'go-backend' },
    apiPart: { id: 'apiPart', type: 'part-module', label: 'Handlers', parentId: 'api' },
    worker: { id: 'worker', type: 'worker', label: 'Worker', technology: 'python' },
    db: { id: 'db', type: 'database', label: 'Postgres', technology: 'postgresql' },
    pay: { id: 'pay', type: 'external-service', label: 'Payments' },
  },
  edges: {
    e1: { id: 'e1', source: 'web', target: 'api', contractId: 'rest' },
    e2: { id: 'e2', source: 'api', target: 'db', contractId: 'sql' },
    e3: { id: 'e3', source: 'apiPart', target: 'pay', contractId: 'rest2' },
    e4: { id: 'e4', source: 'worker', target: 'db', contractId: 'sql' },
    e5: { id: 'e5', source: 'apiPart', target: 'api', contractId: 'dep' },
  },
  contracts: {
    rest: { id: 'rest', kind: 'rest', name: 'Public API', schema: { openapi: '3.1.0' } },
    rest2: { id: 'rest2', kind: 'rest', name: 'Payments API' },
    sql: { id: 'sql', kind: 'sql', interactionKind: 'data_write', name: 'Postgres' },
    dep: { id: 'dep', kind: 'dependency', name: 'imports' },
  },
});

const rule = (over: Partial<RuleView>): RuleView => ({
  id: C1, kind: 'check', scopeKind: 'project', scopeValue: null, workflowId: null, check: null,
  waivers: [], stats: {}, title: null, description: 'd', ...over,
});

// ── the vocabulary ────────────────────────────────────────────────────────────

Deno.test('R.2b vocabulary: a check names one of four predicates with a severity; guidance names none; one scope, never two', () => {
  assertEquals([...CHECK_PREDICATES], ['contract_has_schema', 'no_calls_between_roles', 'technology_in_list', 'sync_calls_at_most']);
  spec('create_constraint', { ctype: 'architecture', description: 'The web app never talks to the database', kind: 'check',
    check: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } }, scope: { kind: 'role', value: 'frontend' } });
  spec('create_constraint', { ctype: 'cost', description: 'Under 40 dollars a month' });
  const bad = (payload: Record<string, unknown>) => !SpecPatchOperationSchema.safeParse({ type: 'create_constraint', metadata: meta(), payload }).success;
  assert(bad({ ctype: 'other', description: 'x', kind: 'check' }), 'a check without its check');
  assert(bad({ ctype: 'other', description: 'x', check: { predicate: 'contract_has_schema', severity: 'warn' } }), 'guidance with a check');
  assert(bad({ ctype: 'other', description: 'x', kind: 'check', check: { predicate: 'be_good', severity: 'warn' } }), 'a predicate outside the vocabulary');
  assert(bad({ ctype: 'other', description: 'x', workflowName: 'Checkout', scope: { kind: 'role', value: 'worker' } }), 'a workflow and a scope');
  spec('update_constraint', { constraintId: C1, addWaiver: { target: 'e1', reason: 'The legacy admin page, retired in Q1' } });
  spec('delete_constraint', { constraintId: C1, reason: 'Not used since June' });
  assert(!SpecPatchOperationSchema.safeParse({ type: 'update_constraint', metadata: meta(), payload: { constraintId: C1 } }).success, 'an update changes something');
});

Deno.test('R.2b doctrine: every constraint op rides the Requirements lane; a waiver, a changed check and a retirement are the person\'s to accept', () => {
  for (const t of ['create_constraint', 'update_constraint', 'delete_constraint']) {
    assertEquals(SPEC_PATCH_KIND[t as keyof typeof SPEC_PATCH_KIND], 'requirement');
    assertEquals(laneOfPatchType(t), 'requirements');
  }
  assert(NEVER_AUTO_APPLY.has('update_constraint') && NEVER_AUTO_APPLY.has('delete_constraint'));
  assert(!NEVER_AUTO_APPLY.has('create_constraint'), 'filing one stays as it was (Z)');
});

// ── scope and evaluation (pure) ─────────────────────────────────────────────

Deno.test('R.2b scope: a role (a part counts as its node), a technology, a connection kind, one node and what it holds, a workflow', () => {
  const g = G();
  const at = (r: Partial<RuleView>, lanes?: Map<string, Set<string>>) => [...nodesInScope(rule(r), g, lanes)].sort();
  assertEquals(at({ scopeKind: 'role', scopeValue: 'backend-service' }), ['api', 'apiPart']);
  assertEquals(at({ scopeKind: 'technology', scopeValue: 'postgresql' }), ['db']);
  assertEquals(at({ scopeKind: 'contract_kind', scopeValue: 'sql' }), ['api', 'db', 'worker']);
  assertEquals(at({ scopeKind: 'node', scopeValue: 'api' }), ['api', 'apiPart']);
  assertEquals(at({ scopeKind: 'workflow', workflowId: 'wf' }), [], 'without the lanes a workflow reaches nothing, never a guess');
  assertEquals(at({ scopeKind: 'workflow', workflowId: 'wf' }, new Map([['worker', new Set(['wf'])]])), ['worker']);
  assertEquals(at({ scopeKind: 'project' }).length, 6);
});

Deno.test('R.2b checks: each predicate on the graph, with this project\'s parameters', () => {
  const g = G();
  const run = (check: unknown, over: Partial<RuleView> = {}) => evaluateCheck(rule({ check: asCheckSpec(check), ...over }), g).map((v) => v.target.id).sort();
  // Payments has no schema; the dependency between parts is never asked for one.
  assertEquals(run({ predicate: 'contract_has_schema', severity: 'warn' }), ['e2', 'e3', 'e4']);
  assertEquals(run({ predicate: 'contract_has_schema', severity: 'warn' }, { scopeKind: 'contract_kind', scopeValue: 'rest' }), ['e3']);
  assertEquals(run({ predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'backend-service' } }), ['e1']);
  // A part's call is its node's: the API's handlers calling Payments is the API calling it.
  assertEquals(run({ predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'backend-service', to: 'external-service' } }), ['e3']);
  // A node with no technology chosen is not a break; a part carries none.
  assertEquals(run({ predicate: 'technology_in_list', severity: 'warn', params: { technologies: ['go-backend', 'postgresql', 'react'] } }), ['worker']);
  // Synchronous calls out of a node count distinct targets outside it; data writes are not synchronous calls.
  assertEquals(run({ predicate: 'sync_calls_at_most', severity: 'warn', params: { max: 0 } }), ['api', 'web']);
  assertEquals(run({ predicate: 'sync_calls_at_most', severity: 'warn', params: { max: 1 } }), []);
});

Deno.test('R.2b words: the app, the task document and the agent read the same sentence', () => {
  assertEquals(describeCheck(asCheckSpec({ predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } })!), 'No frontend connects to a database directly.');
  assertEquals(describeCheck(asCheckSpec({ predicate: 'sync_calls_at_most', severity: 'warn', params: { max: 1 } })!), 'At most 1 synchronous call out of each node.');
  assertEquals(describeScope({ scopeKind: 'node', scopeValue: 'api', workflowId: null }, { node: () => 'API' }), 'API and what it holds');
  assertEquals(describeScope({ scopeKind: 'contract_kind', scopeValue: 'sql', workflowId: null }), 'every sql connection');
});

Deno.test('R.2b waivers: a waived target is set aside until its expiry', () => {
  const g = G();
  const check = asCheckSpec({ predicate: 'technology_in_list', severity: 'warn', params: { technologies: ['go-backend', 'postgresql', 'react'] } });
  const now = new Date('2026-09-24T12:00:00Z');
  const live = evaluateChecks([rule({ check, waivers: [{ id: 'w1', target: 'worker', reason: 'Python until Q2', owner: 'user-1', at: '2026-09-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z' }] })], g, undefined, now);
  assertEquals([live.violations.length, live.waived.length], [0, 1]);
  const lapsed = evaluateChecks([rule({ check, waivers: [{ id: 'w1', target: 'worker', reason: 'Python until Q2', owner: 'user-1', at: '2026-01-01T00:00:00Z', expiresAt: '2026-06-01T00:00:00Z' }] })], g, undefined, now);
  assertEquals([lapsed.violations.length, lapsed.waived.length], [1, 0]);
});

// ── a batch against the checks ──────────────────────────────────────────────

Deno.test('R.2b batch: only what the batch adds counts, never debt it did not add; a waiver in the same batch is honoured', () => {
  const g = G();
  const noSchema = rule({ check: asCheckSpec({ predicate: 'contract_has_schema', severity: 'refuse' }), title: 'Every call has a schema' });
  // Unrelated batch: the three standing breaks are not its to answer for.
  const rename = judgeBatch([noSchema], g, [{ type: 'update_node', payload: { id: 'web', changes: { label: 'Web' } } }]);
  assertEquals([rename.refused.length, rename.warned.length], [0, 0]);
  assertEquals(rename.touched, [C1], 'a change inside its reach is a use of the check');
  // A new call with no schema is refused.
  const adds = [
    { type: 'add_contract', payload: { id: 'events', kind: 'kafka', name: 'Events' } },
    { type: 'add_edge', payload: { id: 'e9', source: 'worker', target: 'api', contractId: 'events' } },
  ];
  const j = judgeBatch([noSchema], g, adds);
  assertEquals(j.refused.map((v) => v.target.id), ['e9']);
  // The same batch with a waiver for that call files: the person decides both together.
  const waived = judgeBatch([noSchema], g, [...adds, { type: 'update_constraint', payload: { constraintId: C1, addWaiver: { target: 'e9', reason: 'A spike, retired Friday' } } }]);
  assertEquals([waived.refused.length, waived.waived.map((v) => v.target.id)], [0, ['e9']]);
  assertEquals(batchCounts(j), { [C1]: { fired: 1, violated: 1, waived: 0 } });
  // Removing a node removes its calls; nothing new breaks.
  assertEquals(Object.keys(projectPatches(g, [{ type: 'remove_node', payload: { id: 'worker' } }]).edges).sort(), ['e1', 'e2', 'e3', 'e5']);
  assertEquals(introduced(evaluateCheck(noSchema, g), evaluateCheck(noSchema, g)), []);
});

Deno.test('R.2b propose: a refusing check stops the batch by name with the way through; a warning check files with the warning; the counts land', async () => {
  const sb = scriptOwnerPlan(new FakeSupabase());
  sb.script('project_constraints', 'select', { data: [
    { id: C1, kind: 'check', scope_kind: 'project', scope_value: null, workflow_id: null, title: 'The web app never talks to the database',
      check_spec: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } }, waivers: [], stats: {}, description: 'd', created_at: '2026-09-01T00:00:00Z' },
  ], error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: G() }, error: null });
  const j = await judgeProposal(sb as never, PROJECT, BRANCH, [{ type: 'add_edge', payload: { id: 'e9', source: 'web', target: 'db', contractId: 'sql' } }]);
  assert(j?.refusal, 'refused');
  assert(j!.refusal!.includes('c:33333333 "The web app never talks to the database": Web app connects to Postgres directly.'), j!.refusal!);
  assert(j!.refusal!.includes('update_constraint { constraintId, addWaiver: { target, reason } }'), 'the way through is named');
  const counted = sb.callsTo('rpc', 'constraints_count')[0].payload as { p_counts: Record<string, { violated: number }> };
  assertEquals(counted.p_counts[C1].violated, 1);

  const none = scriptOwnerPlan(new FakeSupabase());
  assertEquals(await judgeProposal(none as never, PROJECT, BRANCH, []), null, 'a project with no check reads no graph');
  assertEquals(none.callsTo('graph_snapshots').length, 0);

  // AC: below Indie a check kept from a paid plan is not read, judges nothing and counts nothing
  const down = scriptOwnerPlan(new FakeSupabase(), 'community');
  down.script('project_constraints', 'select', { data: [{ id: C1, kind: 'check', scope_kind: 'project', check_spec: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } }, waivers: [], stats: {}, description: 'd' }], error: null });
  down.script('graph_snapshots', 'select', { data: { graph_data: G() }, error: null });
  assertEquals(await judgeProposal(down as never, PROJECT, BRANCH, [{ type: 'add_edge', payload: { id: 'e9', source: 'web', target: 'db', contractId: 'sql' } }]), null);
  assertEquals([down.callsTo('project_constraints').length, down.callsTo('rpc', 'constraints_count').length], [0, 0]);
});

// ── R.2c: evidence from use ─────────────────────────────────────────────────

Deno.test('R.2c signals: a check waived again and again; a constraint unused for 90 days; the evidence is this project\'s, never advice', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  const s = ruleSignals([
    rule({ id: 'a', stats: { waived: 4, fired: 9, lastFiredAt: '2026-09-20T00:00:00Z' }, check: asCheckSpec({ predicate: 'contract_has_schema', severity: 'warn' }) }),
    rule({ id: 'b', kind: 'guide', createdAt: '2026-05-01T00:00:00Z' }),
    rule({ id: 'c', kind: 'guide', createdAt: '2026-09-01T00:00:00Z' }),
  ], now);
  assertEquals(s.map((x) => [x.constraintId, x.signal, x.detail]), [['a', 'often_waived', 'Waived 4 times.'], ['b', 'quiet', 'Not used since it was filed on 2026-05-01.']]);
  for (const ask of Object.values(SIGNAL_ASKS)) assert(/ask the user|The reviewer said why/i.test(ask) && /their words|ask the user/i.test(ask), ask);
});

Deno.test('R.2c learnings: a line written in two nodes\' Implementation Context comes back in the project\'s own words', () => {
  const hits = repeatedLearnings([
    { nodeId: 'api', text: '- Retries must be idempotent: every write carries a request id.\n- Short.' },
    { nodeId: 'worker', text: '* retries must be idempotent: every write carries a request id' },
    { nodeId: 'web', text: 'Nothing in common here at all, only local notes.' },
  ]);
  assertEquals(hits, [{ text: 'Retries must be idempotent: every write carries a request id.', nodeIds: ['api', 'worker'] }]);
});

// ── the loader and the task document ────────────────────────────────────────

Deno.test('R.2b loader: a role-scoped check reaches the nodes of that role, with the graph; the document says what it checks', async () => {
  const sb = scriptOwnerPlan(new FakeSupabase());
  sb.script('project_constraints', 'select', { data: [
    { id: C1, ctype: 'architecture', title: 'No direct database access', description: 'The web app goes through the API', rationale: null, workflow_id: null, mark: null,
      kind: 'check', scope_kind: 'role', scope_value: 'frontend', check_spec: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } } },
  ], error: null });
  const by = await loadNodeConstraints(sb as never, PROJECT, ['web', 'api'], undefined, G());
  assertEquals([by.get('web')!.length, by.get('api')!.length], [1, 0]);
  const doc = renderConstraintsSection(by.get('web')).join('\n');
  assert(doc.includes('Checked: No frontend connects to a database directly. A proposal that breaks it is refused. (holds for every frontend node)'), doc);
});

Deno.test('R.2b fingerprint: guidance for the project or a workflow hashes as it did before R.2b, so no packet goes stale on deploy', () => {
  const g: NodeConstraint = { id: C1, ctype: 'cost', title: 'Cheap', description: 'Under 40 dollars', rationale: null, workflowId: null, workflowName: null, mark: null, kind: 'guide', scopeKind: 'project', scopeValue: null, check: null };
  const before = [C1, 'cost', 'Cheap', 'Under 40 dollars', '', '', '', ''].join('\u0001');
  assertEquals(constraintsSignature([g]), before);
  assert(constraintsSignature([{ ...g, kind: 'check', check: asCheckSpec({ predicate: 'contract_has_schema', severity: 'warn' }) }]) !== before, 'a check moves the fingerprint');
});

// ── apply ───────────────────────────────────────────────────────────────────

Deno.test('R.2b apply: a check files with its scope and predicate after its roles are found in the catalog; an unknown role is refused by name', async () => {
  const ok = new FakeSupabase();
  ok.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  ok.script('node_roles', 'select', { data: [{ id: 'frontend' }, { id: 'database' }], error: null });
  ok.script('project_constraints', 'insert', { data: { id: 'pc-9' }, error: null });
  const r = await applySpecPatch(ok as never, AUTH, PROJECT, spec('create_constraint', {
    ctype: 'architecture', description: 'The web app never talks to the database', kind: 'check', scope: { kind: 'role', value: 'frontend' },
    check: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } },
    origin: { source: 'review', proposalId: '44444444-4444-4444-8444-444444444444' },
  }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const row = ok.callsTo('project_constraints', 'insert')[0].payload as Record<string, unknown>;
  assertEquals([row.kind, row.scope_kind, row.scope_value, (row.check_spec as { predicate: string }).predicate, (row.origin as { source: string }).source], ['check', 'role', 'frontend', 'no_calls_between_roles', 'review']);

  const bad = new FakeSupabase();
  bad.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  bad.script('node_roles', 'select', { data: [{ id: 'frontend' }], error: null });
  const b = await applySpecPatch(bad as never, AUTH, PROJECT, spec('create_constraint', {
    ctype: 'architecture', description: 'x', kind: 'check', check: { predicate: 'no_calls_between_roles', severity: 'warn', params: { from: 'frontend', to: 'mainframe' } },
  }));
  assertEquals(b.applied, false);
  assert((b as { error: string }).error.includes('no node role "mainframe" in the catalog'), (b as { error: string }).error);
  assertEquals(bad.callsTo('project_constraints', 'insert').length, 0);
});

Deno.test('R.2b apply: a waiver records who accepted it; guidance cannot be waived; retiring deletes this project\'s row only', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('project_constraints', 'select', { data: { id: C1, ctype: 'architecture', kind: 'check', description: 'd', waivers: [] }, error: null });
  const r = await applySpecPatch(sb as never, { ...AUTH, authMethod: 'jwt', userId: 'person-1' } as AuthResult, PROJECT,
    spec('update_constraint', { constraintId: C1, addWaiver: { target: 'e3', reason: 'Payments publishes no schema; tracked in PAY-12', expiresAt: '2026-12-31T00:00:00Z' } }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const w = ((sb.callsTo('project_constraints', 'update')[0].payload as { waivers: Array<Record<string, unknown>> }).waivers)[0];
  assertEquals([w.target, w.owner, w.expiresAt], ['e3', 'person-1', '2026-12-31T00:00:00Z']);

  const guide = new FakeSupabase();
  guide.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  guide.script('project_constraints', 'select', { data: { id: C1, ctype: 'cost', kind: 'guide', description: 'd', waivers: [] }, error: null });
  const g = await applySpecPatch(guide as never, AUTH, PROJECT, spec('update_constraint', { constraintId: C1, addWaiver: { target: 'x', reason: 'y' } }));
  assertEquals(g.applied, false);
  assertEquals(guide.callsTo('project_constraints', 'update').length, 0);

  const del = new FakeSupabase();
  del.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null }).script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  del.script('project_constraints', 'delete', { data: [{ id: C1 }], error: null });
  const d = await applySpecPatch(del as never, AUTH, PROJECT, spec('delete_constraint', { constraintId: C1, reason: 'Not used since June' }));
  assertEquals(d.applied, true, JSON.stringify(d));
  assert(JSON.stringify(del.callsTo('project_constraints', 'delete')[0].filters).includes(PROJECT), 'scoped to this project');
});

Deno.test('R.2b approval: an MCP key cannot accept a waiver or a retirement; the refusal says whose decision it is', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'P' }, error: null });
  sb.script('ai_proposals', 'select', { data: { id: 'prop-1', status: 'pending', source_branch_id: BRANCH, metadata: { plane: 'spec' }, patches: [
    { patch: { type: 'delete_constraint', metadata: meta(), payload: { constraintId: C1, reason: 'unused' } }, status: 'pending' },
  ] }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT }, error: null });
  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT, proposal_id: 'prop-1', action: 'accept' });
  assertEquals(r.success, false, JSON.stringify(r));
  assert(String(r.error).includes("a waiver, a changed check or a retired constraint is the person's decision"), String(r.error));
  assertEquals(sb.callsTo('project_constraints').length, 0);
});

Deno.test('R.2c rows: a row written before R.2b reads as the guidance it was', () => {
  const r = ruleFromRow({ id: C1, description: 'Under 40 dollars', workflow_id: null });
  assertEquals([r.kind, r.scopeKind, r.check, r.waivers, r.stats], ['guide', 'project', null, [], {}]);
  assertEquals(ruleFromRow({ id: C1, description: 'x', workflow_id: 'wf' }).scopeKind, 'workflow');
});
