// SHIP-1(e) · the license gate under pin. THE mechanisms: Ed25519 over the raw
// payload base64url bytes (format shared with scripts/selfhost/sign-license.mjs
// — a drift here bricks every issued license); FAIL-CLOSED to 'community' with a
// NAMED reason on every bad input (self-host stays all-features — tiers scale,
// never gate); and the deployment seam — NODESPEC_DEPLOYMENT=self-hosted
// resolves tier from the license WITHOUT touching the database, hosted keeps
// reading the Stripe subscription untouched.
import { FakeSupabase, assert, assertEquals } from './helpers.ts';
import {
  parseLicenseString,
  verifyLicense,
  resolveSelfHostTier,
  LICENSE_PREFIX,
} from '../_shared/selfhost-license.ts';
import { isSelfHosted, getEffectiveTier, getLicenseTier, resetLicenseTierCache } from '../_shared/deployment.ts';
// deno-lint-ignore no-explicit-any
type Any = any;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function makeSigned(payload: Record<string, unknown>) {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKeyB64 = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(payloadB64) as unknown as BufferSource));
  return { license: `${LICENSE_PREFIX}.${payloadB64}.${b64url(sig)}`, publicKeyB64, kp, payloadB64 };
}

const GOOD = {
  v: 1, licensee: 'Acme Corp', tier: 'pro',
  issued: '2026-08-23', expires: '2027-08-31', deployment: 'self-hosted',
};
const NOW = new Date('2026-08-24T00:00:00Z');

Deno.test('license: a well-signed unexpired license verifies — LEGACY tier names resolve to their canonical successor', async () => {
  // GOOD deliberately keeps tier:'pro' — an already-issued V1 token is inside
  // an Ed25519 signature and cannot be rewritten; it must verify as 'team'.
  const { license, publicKeyB64 } = await makeSigned(GOOD);
  const v = await verifyLicense(license, publicKeyB64, NOW);
  assert(v.valid, JSON.stringify(v));
  assertEquals(v.tier, 'team');
  assertEquals((v as Any).licensee, 'Acme Corp');
});

Deno.test('license: canonical tiers verify verbatim (enterprise, government, team)', async () => {
  for (const tier of ['team', 'enterprise', 'government'] as const) {
    const { license, publicKeyB64 } = await makeSigned({ ...GOOD, tier });
    const v = await verifyLicense(license, publicKeyB64, NOW);
    assert(v.valid, JSON.stringify(v));
    assertEquals(v.tier, tier);
  }
});

Deno.test('license: TAMPERED payload fails the signature — a customer cannot mint a tier', async () => {
  const { license, publicKeyB64 } = await makeSigned({ ...GOOD, tier: 'indie' });
  // Splice in a 'pro' payload while keeping the original signature.
  const forgedPayload = b64url(new TextEncoder().encode(JSON.stringify({ ...GOOD, tier: 'pro' })));
  const forged = `${LICENSE_PREFIX}.${forgedPayload}.${license.split('.')[2]}`;
  const v = await verifyLicense(forged, publicKeyB64, NOW);
  assert(!v.valid);
  assert((v as Any).reason.includes('signature does not verify'), (v as Any).reason);
  assertEquals(v.tier, 'community', 'fail-closed');
});

Deno.test('license: a DIFFERENT key\'s signature is rejected even when structurally perfect', async () => {
  const { license } = await makeSigned(GOOD);
  const { publicKeyB64: otherKey } = await makeSigned(GOOD); // fresh keypair
  const v = await verifyLicense(license, otherKey, NOW);
  assert(!v.valid);
  assert((v as Any).reason.includes('different key') || (v as Any).reason.includes('does not verify'));
});

Deno.test('license: semantic refusals each carry a NAMED reason (expiry, tier vocabulary, deployment, version, licensee)', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...GOOD, expires: '2026-01-01' }, 'expired'],
    [{ ...GOOD, tier: 'platinum' }, 'unknown tier'],
    [{ ...GOOD, deployment: 'hosted' }, 'not self-hosted'],
    [{ ...GOOD, v: 2 }, 'unsupported license version'],
    [{ ...GOOD, licensee: '  ' }, 'no licensee'],
  ];
  for (const [payload, needle] of cases) {
    const { license, publicKeyB64 } = await makeSigned(payload);
    const v = await verifyLicense(license, publicKeyB64, NOW);
    assert(!v.valid, `expected refusal for ${needle}`);
    assert((v as Any).reason.includes(needle), `"${(v as Any).reason}" should name "${needle}"`);
  }
});

Deno.test('license: structural garbage fails closed with usable reasons, never throws', async () => {
  const { publicKeyB64 } = await makeSigned(GOOD);
  for (const raw of ['', 'not-a-license', 'nslic1.only-two-parts', 'nslic2.a.b', `${LICENSE_PREFIX}.!!!.sig`]) {
    const v = await verifyLicense(raw, publicKeyB64, NOW);
    assert(!v.valid, `"${raw}" must not verify`);
    assertEquals(v.tier, 'community');
    assert(((v as Any).reason as string).length > 0);
  }
  // Missing verification key names the deployment fix, not a crypto error.
  const { license } = await makeSigned(GOOD);
  const noKey = await verifyLicense(license, '', NOW);
  assert(!noKey.valid && (noKey as Any).reason.includes('NODESPEC_LICENSE_PUBLIC_KEY'));
});

Deno.test('license: parseLicenseString round-trips the payload without trusting it', async () => {
  const { license } = await makeSigned(GOOD);
  const p = parseLicenseString(license);
  assert(!('error' in p));
  assertEquals((p as Any).payload.licensee, 'Acme Corp');
});

Deno.test('resolveSelfHostTier: valid license → its tier; anything else → community WITH the reason', async () => {
  const { license, publicKeyB64 } = await makeSigned({ ...GOOD, tier: 'architect' });
  const ok = await resolveSelfHostTier({ license, publicKey: publicKeyB64 }, NOW);
  assertEquals(ok, { tier: 'team', licensee: 'Acme Corp' });
  const bad = await resolveSelfHostTier({ license: 'garbage', publicKey: publicKeyB64 }, NOW);
  assertEquals(bad.tier, 'community');
  assert((bad.reason ?? '').length > 0, 'fail-closed is doctrine, silent is not');
});

// ── the deployment seam ─────────────────────────────────────────────────────────

const envOf = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

Deno.test('deployment seam: self-hosted resolves tier from the LICENSE and never touches the database', async () => {
  resetLicenseTierCache();
  const { license, publicKeyB64 } = await makeSigned(GOOD);
  const env = envOf({
    NODESPEC_DEPLOYMENT: 'self-hosted',
    NODESPEC_LICENSE: license,
    NODESPEC_LICENSE_PUBLIC_KEY: publicKeyB64,
  });
  assert(isSelfHosted(env));
  const sb = new FakeSupabase();
  const tier = await getEffectiveTier(sb as never, 'user-1', env);
  assertEquals(tier, 'team');
  assertEquals(sb.callsTo('stripe_subscriptions').length, 0, 'the license is the source — stripe_subscriptions is never read');
  // V3 Q: the one write is the self-hosted mark the database's plan checks defer to
  assertEquals(sb.calls.map((c) => `${c.table}.${c.op}`), ['deployment_settings.upsert']);
  assertEquals(sb.calls[0].payload, { id: true, mode: 'self-hosted', updated_at: (sb.calls[0].payload as { updated_at: string }).updated_at });
  await getEffectiveTier(sb as never, 'user-2', env);
  assertEquals(sb.calls.length, 1, 'marked once per isolate, not per call');
  // Second resolve rides the per-isolate cache (deployment-wide, not per-user).
  const again = await getLicenseTier(env, NOW);
  assertEquals(again.licensee, 'Acme Corp');
  resetLicenseTierCache();
});

Deno.test('deployment seam: hosted (flag unset) keeps reading the Stripe subscription untouched', async () => {
  resetLicenseTierCache();
  const env = envOf({});
  assert(!isSelfHosted(env));
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: { plan_name: 'Architect Monthly', status: 'active' }, error: null });
  const tier = await getEffectiveTier(sb as never, 'user-1', env);
  assertEquals(tier, 'team');
  assertEquals(sb.callsTo('stripe_subscriptions', 'select').length, 1);
  assertEquals(sb.callsTo('deployment_settings').length, 0, 'hosted never marks itself self-hosted');
});

// Audit (owner 2026-09-27): the mark opens every plan check in the database
// and is never cleared; a managed project is never marked, whatever its flag.
Deno.test('deployment seam: a self-hosted flag on a managed Supabase project never marks the database', async () => {
  resetLicenseTierCache();
  const env = envOf({ NODESPEC_DEPLOYMENT: 'self-hosted', SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co' });
  const sb = new FakeSupabase();
  const tier = await getEffectiveTier(sb as never, 'user-1', env);
  assertEquals(tier, 'community', 'still fails closed to the licence');
  assertEquals(sb.callsTo('deployment_settings').length, 0, 'the managed database is not marked self-hosted');
  resetLicenseTierCache();
  for (const url of ['http://kong:8000', 'http://127.0.0.1:54321', 'https://supabase.co.example.org', '']) {
    resetLicenseTierCache();
    const own = new FakeSupabase();
    await getEffectiveTier(own as never, 'user-1', envOf({ NODESPEC_DEPLOYMENT: 'self-hosted', SUPABASE_URL: url }));
    assertEquals(own.callsTo('deployment_settings', 'upsert').length, 1, `a self-hosted stack at ${url || 'no URL'} is marked`);
  }
  resetLicenseTierCache();
});

// Audit (owner 2026-09-27): the managed site sells Free, Indie and Team;
// Enterprise and Government are licensed installs. A hosted plan never
// resolves above Team, whatever its plan_name says; a licence still can.
Deno.test('deployment seam: a hosted plan never resolves above Team; a licence does', async () => {
  for (const [plan, want] of [['government', 'team'], ['Enterprise Annual', 'team'], ['team', 'team'], ['indie', 'indie'], ['free', 'community']] as const) {
    resetLicenseTierCache();
    const sb = new FakeSupabase();
    sb.script('stripe_subscriptions', 'select', { data: { plan_name: plan, status: 'active' }, error: null });
    assertEquals(await getEffectiveTier(sb as never, 'user-1', envOf({})), want, plan);
  }
  resetLicenseTierCache();
  const { license, publicKeyB64 } = await makeSigned({ ...GOOD, tier: 'government', expires: '2099-12-31' });
  const tier = await getEffectiveTier(new FakeSupabase() as never, 'user-1', envOf({ NODESPEC_DEPLOYMENT: 'self-hosted', NODESPEC_LICENSE: license, NODESPEC_LICENSE_PUBLIC_KEY: publicKeyB64 }));
  assertEquals(tier, 'government');
  resetLicenseTierCache();
});

Deno.test('deployment seam: self-hosted with NO license fails closed to community', async () => {
  resetLicenseTierCache();
  const env = envOf({ NODESPEC_DEPLOYMENT: 'self-hosted' });
  const sb = new FakeSupabase();
  const tier = await getEffectiveTier(sb as never, 'user-1', env);
  assertEquals(tier, 'community');
  assertEquals(sb.callsTo('stripe_subscriptions').length, 0);
  assertEquals(sb.callsTo('deployment_settings', 'upsert').length, 1, 'an unlicensed self-host is still self-hosted');
  resetLicenseTierCache();
});
