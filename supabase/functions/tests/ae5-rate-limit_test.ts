// V3 AE.5 (owner 2026-09-25, "within reason"): the MCP endpoint refuses a
// credential that calls faster than the rule, with 429 and a Retry-After the
// client honours, and only that credential. The count is the database's
// (owner 2026-09-26, "go with the table"): mcp_rate_take on
// mcp_rate_buckets, whose arithmetic lane 089 runs on a real Postgres. Here
// the real server is driven: it names the credential and the rule to the
// database, obeys its answer, and falls back to the isolate's own bucket
// only when the database cannot answer.
import { assert, assertEquals, MemorySupabase, type Row } from './helpers.ts';
import { sha256Hex } from '../mcp-server/shared.ts';
import { createRateLimiter, MCP_RATE_LIMIT, rateLimitMessage } from '../_shared/rate-limit.ts';
import { handleRequest, resetRateLimiter } from '../mcp-server/server.ts';

Deno.test('AE.5 limiter: a burst up to the capacity, then the rate; Retry-After says when; keys are independent', () => {
  let clock = 1_000_000;
  const limiter = createRateLimiter({ capacity: 5, refillPerSecond: 2 }, { now: () => clock });
  for (let i = 0; i < 5; i++) assertEquals(limiter.take('a').allowed, true, `call ${i + 1}`);
  const refused = limiter.take('a');
  assertEquals(refused, { allowed: false, retryAfterSeconds: 1 });
  assertEquals(limiter.take('b').allowed, true, 'another credential is not held back');
  clock += 500; // half a second refills one token at two a second
  assertEquals(limiter.take('a').allowed, true);
  assertEquals(limiter.take('a').allowed, false);
  clock += 10_000; // long quiet: back to a full bucket, never more than the capacity
  for (let i = 0; i < 5; i++) assertEquals(limiter.take('a').allowed, true, `after a rest, call ${i + 1}`);
  assertEquals(limiter.take('a').allowed, false);
  assertEquals(rateLimitMessage(MCP_RATE_LIMIT, 1), 'This credential made more than 60 calls in a burst; the rate is 240 a minute. Wait 1 second and try again.');
  assertEquals(MCP_RATE_LIMIT, { capacity: 60, refillPerSecond: 4 });
});

Deno.test('AE.5 limiter: memory is bounded; a credential that rested is forgotten first', () => {
  let clock = 0;
  const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 }, { now: () => clock, maxKeys: 3 });
  for (const k of ['a', 'b', 'c']) limiter.take(k);
  clock += 5_000; // a, b and c are full again
  limiter.take('d');
  assert(limiter.size() <= 3, `pruned to ${limiter.size()}`);
  limiter.take('d');
  assertEquals(limiter.take('d').allowed, false, 'the live credential keeps its count through a prune');
});

const OWNER = '11111111-1111-4111-8111-111111111111';
const KEY_A = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', secret: 'ns_live_burst_a', name: 'agent a' };
const KEY_B = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', secret: 'ns_live_burst_b', name: 'agent b' };
const BASE = 'http://localhost:54321/functions/v1/mcp-server';

async function world(): Promise<MemorySupabase> {
  const sb = new MemorySupabase();
  const keys: Row[] = [];
  for (const k of [KEY_A, KEY_B]) keys.push({ id: k.id, user_id: OWNER, name: k.name, key_hash: await sha256Hex(k.secret), key_prefix: k.secret.slice(0, 12), scopes: ['read'], expires_at: null, revoked_at: null, last_used_at: null });
  sb.table('mcp_api_keys', keys);
  sb.table('stripe_subscriptions', []);
  sb.fn('validate_mcp_api_key', (p, db) => {
    const k = db.rowsOf('mcp_api_keys').find((r) => r.key_hash === p.p_key_hash);
    if (!k) return [{ user_id: null, key_id: null, scopes: null, is_valid: false, rejection_reason: 'Invalid API key', key_name: null }];
    return [{ user_id: k.user_id, key_id: k.id, scopes: k.scopes, is_valid: true, rejection_reason: null, key_name: k.name }];
  });
  return sb;
}
const ping = (secret: string, id: number) => new Request(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-MCP-API-Key': secret },
  body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }),
});

type Take = { p_holder: string; p_user_id: string; p_capacity: number; p_per_second: number };

/** The database's side, recorded: `answer` says what mcp_rate_take returns per holder. */
function sharedCount(sb: MemorySupabase, answer: (t: Take) => number): Take[] {
  const takes: Take[] = [];
  sb.fn('mcp_rate_take', (p) => { const t = p as unknown as Take; takes.push(t); return answer(t); });
  return takes;
}

const sessionPing = (token: string, id: number) => new Request(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }),
});

Deno.test('AE.5 door: the database counts; the server names the credential and the rule, and its isolate never adds a limit of its own', async () => {
  resetRateLimiter();
  try {
    const sb = await world();
    sb.jwt('session-token', { id: OWNER, email: 'owner@example.com' });
    const takes = sharedCount(sb, () => 0);
    // past the burst in this isolate, and all through: only the database decides
    for (let i = 1; i <= MCP_RATE_LIMIT.capacity + 10; i++) {
      const res = await handleRequest(ping(KEY_A.secret, i), sb as never);
      assertEquals(res.status, 200, `call ${i}`);
      await res.text();
    }
    assertEquals(takes.length, MCP_RATE_LIMIT.capacity + 10, 'one take per call');
    assertEquals(takes[0], { p_holder: `key:${KEY_A.id}`, p_user_id: OWNER, p_capacity: 60, p_per_second: 4 });
    const session = await handleRequest(sessionPing('session-token', 1), sb as never);
    assertEquals(session.status, 200);
    await session.text();
    assertEquals(takes.at(-1)?.p_holder, `user:${OWNER}`, 'a signed-in session is its own credential');
    // an unknown key is refused as unauthorized before anything is counted
    const before = takes.length;
    const nobody = await handleRequest(ping('ns_live_nobody', 1), sb as never);
    assertEquals(nobody.status, 401);
    await nobody.text();
    assertEquals(takes.length, before);
  } finally {
    resetRateLimiter();
  }
});

Deno.test('AE.5 door: when the database says wait, the call is 429 with its Retry-After and the rule, and only that credential waits', async () => {
  resetRateLimiter();
  try {
    const sb = await world();
    sharedCount(sb, (t) => (t.p_holder === `key:${KEY_A.id}` ? 3 : 0));
    const refused = await handleRequest(ping(KEY_A.secret, 1), sb as never);
    assertEquals(refused.status, 429);
    assertEquals(refused.headers.get('Retry-After'), '3');
    const body = await refused.json();
    assertEquals(body.error, 'rate_limited');
    assertEquals(body.error_description, rateLimitMessage(MCP_RATE_LIMIT, 3));
    const other = await handleRequest(ping(KEY_B.secret, 1), sb as never);
    assertEquals(other.status, 200, 'another credential is not held back');
    await other.text();
  } finally {
    resetRateLimiter();
  }
});

Deno.test('AE.5 door: when the database cannot answer, the isolate\'s own bucket holds: the 61st call is 429, the other credential answers, the window lifts', async () => {
  resetRateLimiter();
  try {
    const sb = await world(); // no mcp_rate_take: the function does not exist on this database
    for (let i = 1; i <= MCP_RATE_LIMIT.capacity; i++) {
      const res = await handleRequest(ping(KEY_A.secret, i), sb as never);
      assertEquals(res.status, 200, `call ${i}`);
      await res.text();
    }
    const refused = await handleRequest(ping(KEY_A.secret, 61), sb as never);
    assertEquals(refused.status, 429);
    assertEquals(refused.headers.get('Retry-After'), '1');
    const body = await refused.json();
    assertEquals(body.error, 'rate_limited');
    assert(String(body.error_description).startsWith('This credential made more than 60 calls in a burst'), body.error_description);
    const other = await handleRequest(ping(KEY_B.secret, 1), sb as never);
    assertEquals(other.status, 200, 'another credential is not held back');
    await other.text();
    resetRateLimiter();
    const lifted = await handleRequest(ping(KEY_A.secret, 62), sb as never);
    assertEquals(lifted.status, 200, 'a fresh window answers again');
    await lifted.text();
  } finally {
    resetRateLimiter();
  }
});
