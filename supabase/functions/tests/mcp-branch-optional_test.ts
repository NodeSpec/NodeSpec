// V3 3.2 (2026-09-19): branch_id is optional everywhere. One resolver in
// shared.ts answers the project's primary branch when the argument is
// omitted; a given id passes through with no read. Every tool that used to
// require the argument now accepts a call without it.
import { handleGetProjectContext, handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { handleGenerateTaskDocs, handleGetBuildReadiness } from '../mcp-server/tools/tasks.ts';
import { handleProposePatches } from '../mcp-server/tools/proposals.ts';
import { resolveBranchId } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const NODE = '33333333-3333-4333-8333-333333333333';
const REQ = '77777777-7777-4777-8777-777777777777';
const READ = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] } as never;
const PROPOSE = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'propose'] } as never;

Deno.test('resolveBranchId: a given id passes through without a read; an omitted one reads the primary', async () => {
  const sb = new FakeSupabase();
  assertEquals(await resolveBranchId(sb as never, PROJECT.id, BRANCH), BRANCH);
  assertEquals(sb.callsTo('branches', 'select').length, 0, 'nothing read for a given id');
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  assertEquals(await resolveBranchId(sb as never, PROJECT.id, undefined), BRANCH);
  assertEquals(sb.callsTo('branches', 'select').length, 1);
  const none = new FakeSupabase();
  assertEquals(await resolveBranchId(none as never, PROJECT.id, ''), null, 'no branch at all answers null');
});

Deno.test('every tool that took a required branch_id now accepts a call without it and resolves the primary', async () => {
  const cases: Array<[string, (sb: FakeSupabase) => Promise<{ success: boolean; error?: string }>]> = [
    ['get_project_context', (sb) => handleGetProjectContext(sb as never, READ, { project_id: PROJECT.id, target_type: 'node', target_id: NODE })],
    ['get_test_plan', (sb) => handleGetTestPlan(sb as never, READ, { project_id: PROJECT.id, requirement_id: REQ })],
    ['generate_task_docs', (sb) => handleGenerateTaskDocs(sb as never, PROPOSE, { project_id: PROJECT.id })],
    ['get_build_readiness', (sb) => handleGetBuildReadiness(sb as never, READ, { project_id: PROJECT.id })],
    ['propose_patches', (sb) => handleProposePatches(sb as never, PROPOSE, {
      project_id: PROJECT.id, external_agent: 'claude',
      patches: [{ type: 'add_node', payload: { id: NODE, type: 'backend-service', label: 'API' } }],
    })],
  ];
  for (const [name, call] of cases) {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', { data: PROJECT, error: null });
    // the resolver's read, then the handler's own validation of the resolved id
    sb.script('branches', 'select', { data: { id: BRANCH, name: 'main', is_primary: true }, error: null });
    sb.script('branches', 'select', { data: { id: BRANCH, name: 'main', is_primary: true }, error: null });
    // The handler may run into unscripted data further down (that is its own
    // test file's job); what this proves is that it got past the argument
    // check and asked for the primary branch.
    let err = '';
    try {
      const r = await call(sb);
      err = String(r.error ?? '');
    } catch (e) {
      err = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    assert(!/branch_id/.test(err), `${name} still demands branch_id: ${err}`);
    assert(!/is required/.test(err), `${name} refused for a missing argument: ${err}`);
    const reads = sb.callsTo('branches', 'select');
    assert(reads.length >= 1, `${name} never resolved the primary branch`);
    assert(JSON.stringify(reads[0].filters).includes('is_primary'), `${name}: the first branch read was not the primary lookup`);
  }
});
