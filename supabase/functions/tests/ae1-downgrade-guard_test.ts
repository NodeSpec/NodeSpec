// V3 AE.1 (owner 2026-09-25): a Team owner hands each project that still
// holds seats to one of its accounts before downgrading. The guard in
// cancel-subscription names the projects and runs before Stripe.
import { downgradeRefusal } from '../cancel-subscription/logic.ts';
import { ownedProjectsWithSeats, projectsWithSeats } from '../_shared/project-membership.ts';
import { handleCancelSubscription, type CancelStripe } from '../cancel-subscription/handler.ts';
import { MemorySupabase, assertEquals } from './helpers.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003';

Deno.test('AE.1 blockers: the owned projects that hold seats, counted and by name; the refusal names them and the hand-over', () => {
  const blockers = projectsWithSeats(
    [{ id: P2, name: 'Zeta' }, { id: P1, name: 'Acme' }, { id: P3, name: 'Solo' }],
    [{ project_id: P1 }, { project_id: P1 }, { project_id: P2 }, { project_id: 'not-mine' }],
  );
  assertEquals(blockers, [{ id: P1, name: 'Acme', seats: 2 }, { id: P2, name: 'Zeta', seats: 1 }]);
  assertEquals(downgradeRefusal(blockers),
    'Before you downgrade, hand each project that still has seats to one of its accounts: Acme (2 seats), Zeta (1 seat). ' +
    'Open the project, press Team, and press Make owner on the account that takes it; you keep a maintainer seat.');
  assertEquals(projectsWithSeats([{ id: P3, name: 'Solo' }], []), []);
});

Deno.test('AE.1 reader: only my projects count, only those with seats; a seat on someone else\'s project never blocks me', async () => {
  const sb = new MemorySupabase();
  sb.table('projects', [
    { id: P1, name: 'Acme', owner_id: ME },
    { id: P2, name: 'Solo', owner_id: ME },
    { id: P3, name: 'Theirs', owner_id: OTHER },
  ]);
  sb.table('project_members', [
    { project_id: P1, user_id: OTHER, role: 'viewer' },
    { project_id: P3, user_id: ME, role: 'maintainer' },
    { project_id: P3, user_id: 'someone', role: 'viewer' },
  ]);
  assertEquals(await ownedProjectsWithSeats(sb, ME), [{ id: P1, name: 'Acme', seats: 1 }]);
  assertEquals(await ownedProjectsWithSeats(sb, OTHER), [{ id: P3, name: 'Theirs', seats: 2 }]);
  assertEquals(await ownedProjectsWithSeats(sb, 'nobody'), []);
});

// The door, driven: the real handler with an in-memory database and a Stripe
// that records every call.
function door(seated: boolean) {
  const sb = new MemorySupabase();
  sb.table('projects', [{ id: P1, name: 'Acme', owner_id: ME }, { id: P3, name: 'Theirs', owner_id: OTHER }]);
  sb.table('project_members', seated ? [{ project_id: P1, user_id: OTHER, role: 'viewer' }] : [{ project_id: P3, user_id: ME, role: 'viewer' }]);
  sb.table('stripe_customers', [{ user_id: ME, customer_id: 'cus_me', deleted_at: null }]);
  sb.table('stripe_subscriptions', [{ user_id: ME, stripe_customer_id: 'cus_me', status: 'active', cancel_at_period_end: false }]);
  const users: Record<string, string> = { 'token-me': ME };
  (sb as unknown as { auth: unknown }).auth = {
    getUser: (token: string) => Promise.resolve(users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }),
  };
  const stripeCalls: string[] = [];
  const stripe: CancelStripe = {
    subscriptions: {
      list: (p) => { stripeCalls.push(`list ${p.customer}`); return Promise.resolve({ data: [{ id: 'sub_1', current_period_start: 0, current_period_end: 9_999_999_999, items: { data: [{ price: { recurring: { interval: 'month' }, unit_amount: 1200 } }] } }] }); },
      cancel: (id) => { stripeCalls.push(`cancel ${id}`); return Promise.resolve({}); },
      update: (id, p) => { stripeCalls.push(`update ${id} ${p.cancel_at_period_end}`); return Promise.resolve({}); },
    },
    invoices: { retrieve: () => { stripeCalls.push('invoice'); return Promise.resolve({}); } },
    refunds: { create: () => { stripeCalls.push('refund'); return Promise.resolve({}); } },
  };
  let stripeOpened = 0;
  const env: Record<string, string> = { SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test' };
  const run = (token: string | null) => handleCancelSubscription(
    new Request('http://localhost/functions/v1/cancel-subscription', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }),
    { env: { get: (k) => env[k] }, createClient: () => sb, stripe: () => { stripeOpened++; return stripe; } },
  );
  return { sb, run, stripeCalls, opened: () => stripeOpened };
}

Deno.test('AE.1 door: an owner whose project holds a seat is refused 409 with the sentence, and Stripe is never opened', async () => {
  const d = door(true);
  const res = await d.run('token-me');
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, downgradeRefusal([{ id: P1, name: 'Acme', seats: 1 }]));
  assertEquals(body.blockers, [{ id: P1, name: 'Acme', seats: 1 }]);
  assertEquals(d.opened(), 0, 'Stripe is not opened');
  assertEquals(d.stripeCalls, []);
  assertEquals(d.sb.rowsOf('stripe_subscriptions')[0].cancel_at_period_end, false, 'nothing is written');
});

Deno.test('AE.1 door: the guard needs the caller; with no seat on a project of mine the cancellation goes to Stripe', async () => {
  const unknown = door(true);
  assertEquals((await unknown.run('token-stranger')).status, 401, 'no caller, no guard read, no Stripe');
  assertEquals((await unknown.run(null)).status, 401);
  assertEquals(unknown.opened(), 0);

  const clear = door(false);
  const res = await clear.run('token-me');
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals((await res.json()).cancellationType, 'end_of_period');
  assertEquals(clear.stripeCalls, ['list cus_me', 'update sub_1 true']);
  assertEquals(clear.sb.rowsOf('stripe_subscriptions')[0].cancel_at_period_end, true, 'the subscription row says it ends at the period');
});
