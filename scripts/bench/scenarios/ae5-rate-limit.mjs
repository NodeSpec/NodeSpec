// V3 AE.5 (owner 2026-09-25, "within reason"): the MCP endpoint holds each
// credential to a burst of 60 calls and then 4 a second. A runaway loop (an
// agent retrying in a tight loop, a script) gets 429 with Retry-After in
// seconds; every other credential keeps answering; the window lifts.
//
//   one ping warms the key →
//   120 concurrent pings with the seeded key, and the signed-in person's
//   bearer in the same moment: the burst answers 200 up to the rule, the
//   rest is 429 with Retry-After and the sentence carrying the rule's
//   numbers, nothing else; the person's ping is 200 (the limit is per
//   credential) →
//   after Retry-After the key answers again; the scenario then waits for
//   the bucket to refill so the next scenario starts with a full one.
//
// The count is the database's (owner 2026-09-26, "go with the table"):
// mcp_rate_take on mcp_rate_buckets, one row per credential, shared by every
// isolate the burst lands on. So the burst is held to the rule itself: at
// least the burst answers, and no more than the burst plus what the rate
// refills while it runs. The bench person's key has its row, and the person
// cannot read the table through the app's own door.
import { createHash } from 'node:crypto';
import { mcpRpc, rest, restAs, sleep, until, Scenario } from '../lib.mjs';

// supabase/functions/_shared/rate-limit.ts MCP_RATE_LIMIT, pinned by ae-batch1-rulings.test.tsx
const RULE = { capacity: 60, refillPerSecond: 4 };
const BURST = 120;

export const ae5RateLimit = {
  name: 'ae5-rate-limit',
  boxes: ['AE.5 a burst past the rule is 429 with Retry-After', 'AE.5 the count is shared by every isolate', 'AE.5 the limit is per credential', 'AE.5 the window lifts', 'AE.5 the app cannot read the buckets'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const key = { apiKey: env.MCP_API_KEY };
    const person = { accessToken: session.accessToken };

    const warm = await mcpRpc(env, key, 'ping', undefined, { noRetry: true });
    s.check('the seeded key answers ping before the burst', warm.status === 200, JSON.stringify(warm.data).slice(0, 200));

    // UAT 2026-09-27: one of the 120 once got no answer in 60 s from the local
    // edge runtime while the other 119 answered in under a second, and the
    // throw took the whole scenario with it. A call the stack never answers is
    // now the stack's (ERROR); the rule is judged on the calls that answered,
    // timed to the last answer.
    const started = Date.now();
    let lastAnswer = started;
    const answered = (p) => p.then((r) => { lastAnswer = Math.max(lastAnswer, Date.now()); return r; });
    const [mineSettled, ...burstSettled] = await Promise.allSettled([
      answered(mcpRpc(env, person, 'ping', undefined, { noRetry: true })),
      ...Array.from({ length: BURST }, () => answered(mcpRpc(env, key, 'ping', undefined, { noRetry: true }))),
    ]);
    const unanswered = [mineSettled, ...burstSettled].filter((r) => r.status === 'rejected');
    if (unanswered.length > 0) {
      s.stackFailure(`the stack answered every call of the burst (${unanswered.length} of ${BURST + 1} got no answer)`,
        unanswered.slice(0, 3).map((r) => String(r.reason?.message ?? r.reason)).join('\n'));
    }
    const burst = burstSettled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const lost = BURST - burst.length;
    const elapsed = ((lastAnswer - started) / 1000).toFixed(1);
    const ok = burst.filter((r) => r.status === 200);
    const refused = burst.filter((r) => r.status === 429);
    const other = burst.filter((r) => r.status !== 200 && r.status !== 429);
    // one isolate's count would let more through than this whenever the burst is spread
    const ceiling = RULE.capacity + Math.ceil(Number(elapsed) * RULE.refillPerSecond) + 1;
    s.check(`the burst is held to the rule: ${ok.length} answered (at most ${ceiling}), ${refused.length} refused, in ${elapsed}s${lost ? `, ${lost} unanswered` : ''}`,
      refused.length > 0 && ok.length >= RULE.capacity - 1 - lost && ok.length <= ceiling && other.length === 0,
      JSON.stringify({ ok: ok.length, refused: refused.length, lost, other: other.map((r) => [r.status, r.data]).slice(0, 3) }).slice(0, 600));
    const retryAfter = refused.map((r) => Number(r.headers?.get('Retry-After')));
    s.check('every refusal carries Retry-After in whole seconds and names the rule',
      refused.length > 0 && retryAfter.every((n) => Number.isInteger(n) && n >= 1) &&
      refused.every((r) => r.data?.error === 'rate_limited' &&
        String(r.data?.error_description).startsWith(`This credential made more than ${RULE.capacity} calls in a burst; the rate is ${RULE.refillPerSecond * 60} a minute.`)),
      JSON.stringify({ retryAfter: [...new Set(retryAfter)], first: refused[0]?.data }).slice(0, 400));
    if (mineSettled.status === 'fulfilled') {
      const mine = mineSettled.value;
      s.check('the signed-in person, another credential, answers 200 in the same moment', mine.status === 200, JSON.stringify(mine).slice(0, 200));
    } else {
      s.skip('the signed-in person, another credential, answers 200 in the same moment', 'the person\'s call got no answer from the stack (recorded above)');
    }

    // the burst pushed the key's arrival time seconds ahead; the person's ping has its own row
    const db = rest(env);
    // UAT hardening 2026-09-27: THIS key's row (key:<id>), not any key's.
    const keyHash = createHash('sha256').update(env.MCP_API_KEY).digest('hex');
    const [keyRow] = await db.select('mcp_api_keys', `key_hash=eq.${keyHash}&select=id`);
    const drained = keyRow
      ? await db.select('mcp_rate_buckets', `holder=eq.key:${keyRow.id}&tat=gt.${new Date().toISOString()}&select=holder,tat`)
      : [];
    const personRow = await db.select('mcp_rate_buckets', `holder=eq.user:${session.userId}&select=holder`);
    s.check('the count lives in the shared table: the key\'s row is drained, and the person has a row of their own',
      drained.length === 1 && personRow.length === 1, JSON.stringify({ key: keyRow?.id ?? 'not found', drained, personRow }).slice(0, 200));
    const peek = await restAs(env, session).select('mcp_rate_buckets', 'select=holder');
    s.check('the signed-in person cannot read the buckets through the app\'s door',
      !peek.ok && peek.error?.code === '42501', JSON.stringify(peek).slice(0, 200));

    const wait = Math.max(1, ...retryAfter.filter(Number.isFinite));
    await sleep(wait * 1000);
    const lifted = await until(async () => (await mcpRpc(env, key, 'ping', undefined, { noRetry: true })).status === 200, { timeoutMs: 15000, everyMs: 1000 });
    s.check(`after Retry-After (${wait}s) the key answers again`, lifted === true, 'still 429 fifteen seconds later');

    // Leave the key with a full bucket: the scenarios after this one call at
    // their own pace and must not inherit this burst.
    await sleep(Math.ceil(RULE.capacity / RULE.refillPerSecond) * 1000);
    const full = await mcpRpc(env, key, 'ping', undefined, { noRetry: true });
    s.check('the bucket is full again for the scenarios that follow', full.status === 200, JSON.stringify(full.data).slice(0, 200));
    return { s };
  },
};

export default [ae5RateLimit];
