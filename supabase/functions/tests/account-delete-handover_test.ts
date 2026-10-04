// Owner 2026-09-27: "Refuse account deletion until project handover." An
// account that owns a project teammates hold seats on is refused before
// Stripe or any project is touched, and the refusal names the projects and
// the hand-over. The door, driven: the real handler with an in-memory
// database and a Stripe that records every call.
import { accountDeletionRefusal, handleDeleteAccount, type DeleteStripe } from '../delete-account/handler.ts';
import { MemorySupabase, assertEquals } from './helpers.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003';

function door(seats: Array<{ project_id: string; user_id: string; role: string }>) {
  const sb = new MemorySupabase();
  sb.table('projects', [
    { id: P1, name: 'Acme', owner_id: ME },
    { id: P2, name: 'Solo', owner_id: ME },
    { id: P3, name: 'Theirs', owner_id: OTHER },
  ]);
  sb.table('project_members', seats);
  sb.table('stripe_customers', [{ user_id: ME, customer_id: 'cus_me', deleted_at: null }]);
  sb.table('stripe_subscriptions', [{ user_id: ME, status: 'active' }]);
  for (const t of ['user_settings', 'bug_reports', 'user_feedback']) sb.table(t, [{ user_id: ME }]);
  sb.jwt('token-me', { id: ME });
  sb.fn('project_delete_step', (params, db) => {
    const rows = db.rowsOf('projects');
    const i = rows.findIndex((r) => r.id === params.p_project_id);
    if (i >= 0) rows.splice(i, 1);
    return { done: true };
  });
  const deletedUsers: string[] = [];
  (sb.auth as unknown as { admin: unknown }).admin = {
    deleteUser: (id: string) => { deletedUsers.push(id); return Promise.resolve({ error: null }); },
  };
  const stripeCalls: string[] = [];
  const stripe: DeleteStripe = {
    subscriptions: {
      list: (p) => { stripeCalls.push(`list ${p.customer}`); return Promise.resolve({ data: [{ id: 'sub_1', status: 'active' }] }); },
      cancel: (id) => { stripeCalls.push(`cancel ${id}`); return Promise.resolve({}); },
    },
  };
  const env: Record<string, string> = { SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test' };
  const run = (token: string | null) => handleDeleteAccount(
    new Request('http://localhost/functions/v1/delete-account', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }),
    { env: { get: (k) => env[k] }, createClient: () => sb, stripe: () => stripe },
  );
  return { sb, run, stripeCalls, deletedUsers };
}

Deno.test('Account deletion: an owner whose project holds a seat is refused 409 by name, and nothing is touched', async () => {
  const d = door([{ project_id: P1, user_id: OTHER, role: 'maintainer' }, { project_id: P3, user_id: ME, role: 'viewer' }]);
  const res = await d.run('token-me');
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.blockers, [{ id: P1, name: 'Acme', seats: 1 }], 'only my project with a seat; my seat on theirs does not block');
  assertEquals(body.error,
    'Before you delete your account, hand each project that still has seats to one of its accounts: Acme (1 seat). ' +
    'Open the project, press Team, and press Make owner on the account that takes it. Nothing was deleted.');
  assertEquals(d.stripeCalls, [], 'the subscription is not cancelled');
  assertEquals(d.sb.rowsOf('projects').map((p) => p.name), ['Acme', 'Solo', 'Theirs'], 'no project is deleted, not even the unshared one');
  assertEquals(d.sb.callsTo('rpc', 'project_delete_step').length, 0);
  assertEquals(d.sb.rowsOf('stripe_customers')[0].deleted_at, null);
  assertEquals(d.sb.rowsOf('user_settings').length, 1);
  assertEquals(d.deletedUsers, []);
});

Deno.test('Account deletion: once handed over, the account goes: Stripe cancelled, my projects deleted in slices, theirs kept', async () => {
  const d = door([{ project_id: P3, user_id: ME, role: 'maintainer' }]);
  const res = await d.run('token-me');
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(d.stripeCalls, ['list cus_me', 'cancel sub_1']);
  assertEquals(d.sb.callsTo('rpc', 'project_delete_step').map((c) => (c.payload as { p_project_id: string }).p_project_id).sort(), [P1, P2]);
  assertEquals(d.sb.rowsOf('projects').map((p) => p.name), ['Theirs']);
  assertEquals(d.sb.rowsOf('stripe_subscriptions')[0].status, 'canceled');
  assertEquals(d.deletedUsers, [ME]);
  // AH.2: the account's own rows go; the dropped token tables are never named.
  assertEquals(['user_settings', 'bug_reports', 'user_feedback'].map((t) => d.sb.rowsOf(t).length), [0, 0, 0]);
  assertEquals(d.sb.callsTo('token_usage').length + d.sb.callsTo('token_grants').length, 0);
});

Deno.test('Account deletion: no caller, no read, no Stripe', async () => {
  const d = door([{ project_id: P1, user_id: OTHER, role: 'viewer' }]);
  assertEquals((await d.run(null)).status, 401);
  assertEquals((await d.run('token-stranger')).status, 401);
  assertEquals(d.sb.callsTo('project_members').length, 0);
  assertEquals(d.stripeCalls, []);
});

Deno.test('Account deletion: the refusal counts every seat on each project', () => {
  assertEquals(accountDeletionRefusal([{ id: P1, name: 'Acme', seats: 2 }, { id: P2, name: 'Zeta', seats: 1 }]),
    'Before you delete your account, hand each project that still has seats to one of its accounts: Acme (2 seats), Zeta (1 seat). ' +
    'Open the project, press Team, and press Make owner on the account that takes it. Nothing was deleted.');
});
