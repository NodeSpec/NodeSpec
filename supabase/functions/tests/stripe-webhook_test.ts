// P0-8: webhook event handling against the REAL handlers (stripe-webhook/handlers.ts).
import { handleEvent } from '../stripe-webhook/handlers.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const CUSTOMER = 'cus_test_123';
const USER = 'b0000000-0000-4000-8000-000000000001';

function stripeWithSubscription(sub: Record<string, unknown> | null) {
  return {
    subscriptions: { list: () => Promise.resolve({ data: sub ? [sub] : [] }) },
    checkout: { sessions: { listLineItems: () => Promise.resolve({ data: [] }) } },
  };
}

function activeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    currency: 'usd',
    current_period_start: 1750000000,
    current_period_end: 1752600000,
    cancel_at_period_end: false,
    default_payment_method: null,
    items: { data: [{ price: { id: 'price_1', lookup_key: 'price_pro_monthly_new', unit_amount: 7900, recurring: { interval: 'month' } } }] },
    ...overrides,
  };
}

function mappedSupabase(existingRow: Record<string, unknown> | null = null) {
  const db = new FakeSupabase();
  db.script('stripe_customers', 'select', { data: { user_id: USER } });
  db.script('stripe_subscriptions', 'select', { data: existingRow });
  return db;
}

Deno.test('customer.subscription.created syncs plan/status and audits action=create', async () => {
  const db = mappedSupabase(null);
  await handleEvent(
    { stripe: stripeWithSubscription(activeSubscription()), supabase: db },
    { id: 'evt_1', type: 'customer.subscription.created', data: { object: { customer: CUSTOMER } } },
  );

  const upserts = db.callsTo('stripe_subscriptions', 'upsert');
  assertEquals(upserts.length, 1);
  const row = upserts[0].payload as Record<string, unknown>;
  assertEquals(row.plan_name, 'team');
  assertEquals(row.status, 'active');
  assertEquals(row.billing_interval, 'month');
  assertEquals(row.stripe_subscription_id, 'sub_1');
  assertEquals((upserts[0].opts as Record<string, unknown>).onConflict, 'stripe_customer_id');

  const audit = db.callsTo('subscription_audit_log', 'insert');
  assertEquals(audit.length, 1);
  assertEquals((audit[0].payload as Record<string, unknown>).action, 'create');
});

Deno.test('customer.subscription.updated: plan change is audited as plan_change with old values', async () => {
  const db = mappedSupabase({ id: 'row1', plan_name: 'indie', status: 'active' });
  await handleEvent(
    { stripe: stripeWithSubscription(activeSubscription()), supabase: db },
    { id: 'evt_2', type: 'customer.subscription.updated', data: { object: { customer: CUSTOMER } } },
  );

  const audit = db.callsTo('subscription_audit_log', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(audit.action, 'plan_change');
  assertEquals((audit.old_values as Record<string, unknown>).plan_name, 'indie');
  assertEquals((audit.new_values as Record<string, unknown>).plan_name, 'team');
});

Deno.test('customer.subscription.updated: status-only change audited as status_change', async () => {
  // Post-backfill canonical row — a legacy 'pro' row here would (correctly)
  // self-heal to 'team' and audit as plan_change instead.
  const db = mappedSupabase({ id: 'row1', plan_name: 'team', status: 'active' });
  await handleEvent(
    { stripe: stripeWithSubscription(activeSubscription({ status: 'past_due' })), supabase: db },
    { id: 'evt_3', type: 'customer.subscription.updated', data: { object: { customer: CUSTOMER } } },
  );
  const audit = db.callsTo('subscription_audit_log', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(audit.action, 'status_change');
});

Deno.test('customer.subscription.deleted with no remaining Stripe subscription -> status canceled', async () => {
  const db = mappedSupabase({ id: 'row1', plan_name: 'pro', status: 'active' });
  await handleEvent(
    { stripe: stripeWithSubscription(null), supabase: db },
    { id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { customer: CUSTOMER } } },
  );

  const upsert = db.callsTo('stripe_subscriptions', 'upsert')[0].payload as Record<string, unknown>;
  assertEquals(upsert.status, 'canceled');
  const audit = db.callsTo('subscription_audit_log', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(audit.action, 'status_change');
  assertEquals((audit.new_values as Record<string, unknown>).status, 'canceled');
});

Deno.test('free-plan customers are never force-canceled by an empty Stripe list', async () => {
  const db = mappedSupabase({ id: 'row1', plan_name: 'free', status: 'active' });
  await handleEvent(
    { stripe: stripeWithSubscription(null), supabase: db },
    { id: 'evt_5', type: 'customer.subscription.deleted', data: { object: { customer: CUSTOMER } } },
  );
  assertEquals(db.callsTo('stripe_subscriptions', 'upsert').length, 0);
  assertEquals(db.callsTo('subscription_audit_log', 'insert').length, 0);
});

Deno.test('idempotency: replaying the same event produces the same end-state upsert, no error', async () => {
  const stripe = stripeWithSubscription(activeSubscription());
  const event = { id: 'evt_6', type: 'customer.subscription.created', data: { object: { customer: CUSTOMER } } };

  const db1 = mappedSupabase(null);
  await handleEvent({ stripe, supabase: db1 }, event);
  const first = db1.callsTo('stripe_subscriptions', 'upsert')[0].payload as Record<string, unknown>;

  const db2 = mappedSupabase({ id: 'row1', plan_name: 'team', status: 'active' });
  await handleEvent({ stripe, supabase: db2 }, event);
  const second = db2.callsTo('stripe_subscriptions', 'upsert')[0].payload as Record<string, unknown>;

  for (const key of ['plan_name', 'status', 'stripe_subscription_id', 'billing_interval', 'amount_cents']) {
    assertEquals(second[key], first[key], `idempotent field ${key}`);
  }
  // Second pass classifies as plain 'sync' — no spurious create/change records.
  const audit2 = db2.callsTo('subscription_audit_log', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(audit2.action, 'sync');
});

Deno.test('events without a customer field are ignored entirely', async () => {
  const db = new FakeSupabase();
  await handleEvent(
    { stripe: stripeWithSubscription(null), supabase: db },
    { id: 'evt_7', type: 'customer.subscription.updated', data: { object: { foo: 'bar' } } },
  );
  assert(db.calls.length === 0, 'no DB calls for customer-less events');
});
