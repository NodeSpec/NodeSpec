// AL.7 (owner 2026-10-01): the Workflows space names the agent an outcome
// came from, so the outcome must say who filed it. create_candidate keeps
// the filing agent on the row's evidence, beside the vision sentences it
// serves: the proven credential and the name the agent gave itself. A
// direct write takes them from the caller; an accepted proposal from the
// proposal's own record (the person accepting is not the filer). A person's
// outcome carries no filer.
import { SpecPatchOperationSchema } from '../_shared/spec-patch-schema.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { FakeSupabase, assertEquals } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CAND = '33333333-3333-4333-8333-333333333333';

// deno-lint-ignore no-explicit-any
const outcome = (actorId: string): any => {
  const parsed = SpecPatchOperationSchema.safeParse({
    type: 'create_candidate',
    metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId, summary: 'file an outcome', timestamp: new Date().toISOString() },
    payload: { branchId: BRANCH, name: 'Customers order ahead for pickup' },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

const filed = async (auth: unknown, origin?: Parameters<typeof applySpecPatch>[4]) => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await applySpecPatch(sb as never, auth as never, PROJECT, outcome('bakery-site-agent'), origin);
  assertEquals(r.applied, true, JSON.stringify(r));
  return (sb.callsTo('requirement_candidates', 'insert')[0].payload as { evidence?: unknown }).evidence;
};

Deno.test('a key agent writing directly: the outcome names its key and its own name', async () => {
  const evidence = await filed({ userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['write'] });
  assertEquals(evidence, { filedBy: { credential: 'key:k1', agent: 'bakery-site-agent' } });
});

Deno.test('an OAuth agent writing directly: the outcome names its sign-in', async () => {
  const evidence = await filed({ userId: 'user-1', authMethod: 'oauth_token', clientId: 'claude-code.4b1c2e9a-1111-4222-8333-444444444444', scopes: ['write'] });
  assertEquals(evidence, { filedBy: { credential: 'oauth:user-1:claude-code.4b1c2e9a-1111-4222-8333-444444444444', agent: 'bakery-site-agent' } });
});

Deno.test('accepted from a proposal: the filer is the proposal\'s agent, not the person accepting', async () => {
  const evidence = await filed(
    { userId: 'owner-1', authMethod: 'jwt', email: 'owner@acme.test', scopes: ['write'] },
    { proposedByKind: 'agent', proposedById: 'k9', viaProposalId: 'prop-1', credential: 'key:k9', agent: 'site-builder' },
  );
  assertEquals(evidence, { filedBy: { credential: 'key:k9', agent: 'site-builder' } });
});

Deno.test('a person\'s outcome, written or accepted from a teammate\'s proposal, names no agent', async () => {
  assertEquals(await filed({ userId: 'owner-1', authMethod: 'jwt', email: 'owner@acme.test', scopes: ['write'] }), undefined);
  assertEquals(await filed(
    { userId: 'owner-1', authMethod: 'jwt', scopes: ['write'] },
    { proposedByKind: 'human', proposedById: 'mate-1', viaProposalId: 'prop-2', credential: null, agent: null },
  ), undefined);
});

Deno.test('the accept path passes the proposal\'s own agent through: not whoever accepts it', async () => {
  const { handleResolveProposal } = await import('../mcp-server/tools/approvals.ts');
  const PROP = '44444444-4444-4444-8444-444444444444';
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Bench' }, error: null });
  sb.script('ai_proposals', 'select', {
    data: { id: PROP, status: 'pending', source_branch_id: BRANCH, patches: [{ patch: outcome('site-builder'), explanation: 'e', status: 'pending' }],
      metadata: { plane: 'spec', authMethod: 'api_key', apiKeyId: 'k9', credential: 'key:k9', externalAgent: 'site-builder' } },
    error: null,
  });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT }, error: null });
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const accepter = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] };
  const r = await handleResolveProposal(sb as never, accepter as never, { project_id: PROJECT, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, true, JSON.stringify(r));
  const evidence = (sb.callsTo('requirement_candidates', 'insert')[0].payload as { evidence?: unknown }).evidence;
  assertEquals(evidence, { filedBy: { credential: 'key:k9', agent: 'site-builder' } });
});
