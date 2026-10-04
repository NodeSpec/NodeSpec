// V3 7.0: the role ladder and the seat rules — one module the RLS helpers
// mirror. Pins: the ranks; what a scope needs (read → viewer, propose and
// write → contributor); who approves (the owner on any channel, a
// maintainer in person only, nobody below); the refusals name the seat;
// memberRoleFor reads the roster row and never invents a role.
import {
  PROJECT_ROLE_RANK, GRANTABLE_ROLES, isProjectRole, roleAtLeast, roleForScope, canApprove,
  roleRefusal, approvalRefusal, memberRoleFor,
} from '../_shared/project-membership.ts';
import { FakeSupabase, assert, assertEquals, scriptSeatOwner } from './helpers.ts';

Deno.test('membership: the ladder is owner > maintainer > contributor > viewer; owner is never grantable', () => {
  assert(PROJECT_ROLE_RANK.owner > PROJECT_ROLE_RANK.maintainer, 'owner over maintainer');
  assert(PROJECT_ROLE_RANK.maintainer > PROJECT_ROLE_RANK.contributor, 'maintainer over contributor');
  assert(PROJECT_ROLE_RANK.contributor > PROJECT_ROLE_RANK.viewer, 'contributor over viewer');
  assertEquals([...GRANTABLE_ROLES], ['maintainer', 'contributor', 'viewer']);
  assert(isProjectRole('viewer') && !isProjectRole('admin') && !isProjectRole(null), 'vocabulary');
  assert(roleAtLeast('maintainer', 'contributor') && !roleAtLeast('viewer', 'contributor') && !roleAtLeast(null, 'viewer'), 'roleAtLeast');
});

Deno.test('membership: a scope names the seat it needs', () => {
  assertEquals(roleForScope('read'), 'viewer');
  assertEquals(roleForScope(undefined), 'viewer');
  assertEquals(roleForScope('propose'), 'contributor');
  assertEquals(roleForScope('write'), 'contributor');
});

Deno.test('membership: approving is the owner\'s on any channel, a maintainer\'s in person only, nobody below', () => {
  assert(canApprove('owner', 'api_key') && canApprove('owner', 'oauth_token') && canApprove('owner', 'jwt'), 'owner');
  assert(canApprove('maintainer', 'jwt'), 'maintainer in person');
  assert(!canApprove('maintainer', 'api_key') && !canApprove('maintainer', 'oauth_token'), 'a maintainer\'s agent never approves');
  assert(!canApprove('contributor', 'jwt') && !canApprove('viewer', 'jwt'), 'below maintainer never');
  const agentRefusal = approvalRefusal('Accepting a plan', 'Bench', 'maintainer', 'api_key');
  assert(agentRefusal.includes("a member's agent never approves") && agentRefusal.includes('Bench'), agentRefusal);
  const seatRefusal = approvalRefusal('Resolving a proposal', 'Bench', 'contributor', 'jwt');
  assert(seatRefusal.includes("owner's call") && seatRefusal.includes('contributor'), seatRefusal);
  const r = roleRefusal('create_requirement', 'Bench', 'viewer', 'contributor');
  assert(r.includes('viewer') && r.includes('needs contributor') && r.includes('create_requirement'), r);
});

Deno.test('membership: memberRoleFor reads the roster row by (project, user) and never invents a role', async () => {
  const sb = new FakeSupabase();
  sb.script('project_members', 'select', { data: { role: 'contributor', projects: { owner_id: 'u1' } }, error: null });
  scriptSeatOwner(sb, 'u1');
  assertEquals(await memberRoleFor(sb as never, 'p1', 'u2'), 'contributor');
  const call = sb.callsTo('project_members', 'select')[0];
  const eq = (col: string, val: string) => call.filters.some((f) => f.method === 'eq' && f.args[0] === col && f.args[1] === val);
  assert(eq('project_id', 'p1') && eq('user_id', 'u2'), JSON.stringify(call.filters));
  // no row → null; a row with a role outside the vocabulary → null
  assertEquals(await memberRoleFor(sb as never, 'p1', 'u3'), null);
  sb.script('project_members', 'select', { data: { role: 'admin', projects: { owner_id: 'u1' } }, error: null });
  assertEquals(await memberRoleFor(sb as never, 'p1', 'u4'), null);
});

Deno.test('membership (decision 1): below Team a project is its owner\'s alone: a held seat counts for nothing, and counts again on Team', async () => {
  const sb = new FakeSupabase();
  for (const plan of ['community', 'indie', 'team', 'enterprise']) {
    sb.script('project_members', 'select', { data: { role: 'maintainer', projects: { owner_id: 'u1' } }, error: null });
    scriptSeatOwner(sb, 'u1', plan);
    assertEquals(await memberRoleFor(sb as never, 'p1', 'u2'), plan === 'team' || plan === 'enterprise' ? 'maintainer' : null, plan);
  }
  // a lapsed owner: no active subscription at all
  sb.script('project_members', 'select', { data: { role: 'maintainer', projects: { owner_id: 'u1' } }, error: null });
  sb.script('stripe_subscriptions', 'select', { data: [], error: null });
  assertEquals(await memberRoleFor(sb as never, 'p1', 'u2'), null);
});
