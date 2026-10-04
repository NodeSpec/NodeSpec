// V3 AE.7 (owner 2026-09-25): a teammate's Workflows edit from the app is a
// proposal. The app files it through propose_patches as the person's
// session, with the same spec op an agent would file and the person's
// email as the name; the proposal waits pending, in their name, and the
// workflow is not written until the owner accepts it under Proposals.
import { handleProposePatches } from '../mcp-server/tools/proposals.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const INDIE = { plan_name: 'indie', status: 'active', current_period_end: '2099-01-01T00:00:00Z' };
const SESSION: AuthResult = { userId: 'user-alice', scopes: ['read', 'write', 'propose'], authMethod: 'jwt' };

function world(): FakeSupabase {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: INDIE, error: null });
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Demo' }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('projects', 'select', { data: { automation_policy: { candidates: '1' } }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  return sb;
}

Deno.test('AE.7 propose: a session files the workflow op as a pending proposal in the person\'s name; the lane is not written', async () => {
  const sb = world();
  const r = await handleProposePatches(sb as never, SESSION, {
    project_id: PROJECT, branch_id: BRANCH,
    patches: [{ type: 'upsert_workflow_step', payload: { workflowId: '33333333-3333-4333-8333-333333333333', name: 'Ship', sortOrder: 2 } }],
    explanations: ['add the stage "Ship" to Checkout'],
    external_agent: 'alice@acme.test',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { proposalId?: string; status?: string; routing?: { route: string; lane: string | null } };
  assert(typeof data.proposalId === 'string');
  assertEquals(data.status, 'pending');
  assertEquals(data.routing?.route, 'propose');
  assertEquals(data.routing?.lane, 'candidates');
  const row = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    status: string; patches: Array<{ patch: { type: string; payload: Record<string, unknown> }; explanation: string; status: string }>;
    metadata: Record<string, unknown>;
  };
  assertEquals(row.status, 'pending');
  assertEquals(row.metadata.authMethod, 'jwt');
  assertEquals(row.metadata.externalAgent, 'alice@acme.test');
  assertEquals(row.metadata.proposedByUserId, 'user-alice');
  assertEquals(row.patches[0].patch.type, 'upsert_workflow_step');
  assertEquals(row.patches[0].patch.payload.name, 'Ship');
  assertEquals(row.patches[0].explanation, 'add the stage "Ship" to Checkout');
  assertEquals(sb.callsTo('workflow_steps').length, 0, 'a proposal writes no stage');
  assertEquals(sb.callsTo('workflows', 'insert').length, 0, 'a proposal writes no lane');
});

Deno.test('AE.7 propose: the step map toggle files set_outcome_step_maps the same way', async () => {
  const sb = world();
  const r = await handleProposePatches(sb as never, SESSION, {
    project_id: PROJECT, branch_id: BRANCH,
    patches: [{ type: 'set_outcome_step_maps', payload: { candidateId: '44444444-4444-4444-8444-444444444444', branchId: BRANCH, stepIds: ['55555555-5555-4555-8555-555555555555'] } }],
    explanations: ['place the outcome "Pay in one tap" on its step'],
    external_agent: 'alice@acme.test',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const row = sb.callsTo('ai_proposals', 'insert')[0].payload as { patches: Array<{ patch: { type: string } }>; metadata: Record<string, unknown> };
  assertEquals(row.patches[0].patch.type, 'set_outcome_step_maps');
  assertEquals(row.metadata.externalAgent, 'alice@acme.test');
  assertEquals(sb.callsTo('outcome_step_maps').length, 0);
});
