// Q (owner 2026-09-22): the repo index is repo import's, Indie and above.
// A build brief for an imported node carries the repo summary and the
// freshness section (which points at get_node_context / search_repo_index)
// only when the project's plan (its owner's) carries repo import. Below it neither table is
// read and the brief names neither tool.
import { assembleContextForTarget } from '../_shared/mcp-context-assembly.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const NODE = '33333333-3333-4333-8333-333333333333';

function world(): FakeSupabase {
  const sb = new FakeSupabase();
  sb.script('deployment_targets', 'select', { data: [], error: null });
  sb.script('projects', 'select', { data: { name: 'Bench', owner_id: 'user-1' }, error: null });
  sb.script('branches', 'select', { data: { name: 'main' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: {
    nodes: { [NODE]: { id: NODE, label: 'Orders API', type: 'backend-service', technology: 'express', metadata: { importedFromRepo: true }, artifacts: [] } },
    edges: {}, contracts: {}, artifacts: {},
  } }, error: null });
  sb.script('repo_index_freshness', 'select', { data: [{ path: 'src/orders.ts', status: 'modified' }], error: null });
  return sb;
}

Deno.test('Q context: below Indie an imported node brief reads no repo index and names no repo-index tool', async () => {
  const sb = world();
  const ctx = await assembleContextForTarget(sb as never, PROJECT, BRANCH, 'node', NODE, 'user-1', { repoIndex: false });
  assertEquals(ctx.repoFreshness, undefined);
  assertEquals(sb.callsTo('repo_index_freshness').length, 0);
  // absent option is the same as below Indie: fail closed
  const bare = await assembleContextForTarget(world() as never, PROJECT, BRANCH, 'node', NODE, 'user-1');
  assertEquals(bare.repoFreshness, undefined);
});

Deno.test('Q context: on Indie the imported node brief carries the freshness', async () => {
  const sb = world();
  const ctx = await assembleContextForTarget(sb as never, PROJECT, BRANCH, 'node', NODE, 'user-1', { repoIndex: true });
  assertEquals(ctx.repoFreshness?.modified, 1);
  assert(sb.callsTo('repo_index_freshness').length === 1, 'freshness read once');
});

// Which plan decides repoIndex (the project's, its owner's) is driven end to
// end through get_project_context in d1-project-plan_test.ts.
