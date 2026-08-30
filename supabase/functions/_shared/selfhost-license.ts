/*
  SHIP-1(e) · the license-file gate — the self-host replacement for the
  Stripe-synced tier (same PlanTier enum, different source; runbook §6).

  A NodeSpec license is a compact signed token:

      nslic1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>

  payload: { v: 1, licensee, tier, issued, expires, deployment: 'self-hosted' }

  Ed25519 keeps the trust one-way: the PRIVATE signing key lives only in
  NodeSpec's CI (secret NODESPEC_LICENSE_SIGNING_KEY, consumed by
  scripts/selfhost/sign-license.mjs on per-customer dispatch); the PUBLIC
  verification key ships in the artifact — stamped into
  EMBEDDED_LICENSE_PUBLIC_KEY by the bundle build, with the
  NODESPEC_LICENSE_PUBLIC_KEY env var as the dev-time override. A customer
  editing their bundle can at most break verification, never mint a tier.

  DOCTRINE: fail closed. Any malformed, tampered, expired, or unverifiable
  license resolves to 'community' with a reason — the deployment keeps running
  (self-host is all-features by the 2026-08-10 ruling; tier only scales), and
  the reason is surfaceable so a wrong clock or truncated env var is a
  five-minute fix, not a mystery.

  Pure module: WebCrypto + injected inputs only — no Deno globals — so both
  the Deno suite and (if ever needed) vitest exercise the real shipped logic.
*/
import type { PlanTier } from './tiers.ts';
import { canonicalizeTier } from './tiers.ts';

export const LICENSE_PREFIX = 'nslic1';

/** Stamped by scripts/selfhost/build-bundle.mjs at artifact build time
 *  (leave empty in source — an empty key fails closed to 'community'). */
export const EMBEDDED_LICENSE_PUBLIC_KEY = '';

export interface LicensePayload {
  v: number;
  licensee: string;
  /** May carry a LEGACY tier name on already-issued tokens — the payload is
   *  inside an Ed25519 signature and cannot be rewritten. Verification
   *  canonicalizes (pro→team etc.) so outstanding licenses stay valid. */
  tier: string;
  issued: string;
  expires: string;
  deployment: string;
}

export type LicenseVerdict =
  | { valid: true; tier: PlanTier; licensee: string; expires: string }
  | { valid: false; tier: 'community'; reason: string };

const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const invalid = (reason: string): LicenseVerdict => ({ valid: false, tier: 'community', reason });

/** Structural parse only — no signature check. Exposed for the signer script's
 *  round-trip test and for error messages that must not trust the content. */
export function parseLicenseString(raw: string): { payloadB64: string; payload: LicensePayload; sigB64: string } | { error: string } {
  const parts = (raw ?? '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    return { error: `not a ${LICENSE_PREFIX} token (expected ${LICENSE_PREFIX}.<payload>.<signature>)` };
  }
  let payload: LicensePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return { error: 'payload is not valid base64url JSON' };
  }
  return { payloadB64: parts[1], payload, sigB64: parts[2] };
}

/**
 * Full verification: structure → signature (Ed25519 over the RAW payload
 * base64url bytes) → semantic checks (version, tier vocabulary, deployment,
 * expiry against the supplied clock). Every failure is a named reason.
 */
export async function verifyLicense(
  raw: string,
  publicKeyB64: string,
  now: Date,
): Promise<LicenseVerdict> {
  if (!raw?.trim()) return invalid('no license supplied (NODESPEC_LICENSE is empty)');
  if (!publicKeyB64?.trim()) return invalid('no verification key (artifact not stamped and NODESPEC_LICENSE_PUBLIC_KEY unset)');

  const parsed = parseLicenseString(raw);
  if ('error' in parsed) return invalid(parsed.error);

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('raw', b64urlToBytes(publicKeyB64) as unknown as BufferSource, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return invalid('verification key is not a valid Ed25519 public key');
  }
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'Ed25519',
      key,
      b64urlToBytes(parsed.sigB64) as unknown as BufferSource,
      new TextEncoder().encode(parsed.payloadB64) as unknown as BufferSource,
    );
  } catch {
    return invalid('signature check failed to run');
  }
  if (!ok) return invalid('signature does not verify — the license was altered or signed by a different key');

  const p = parsed.payload;
  if (p.v !== 1) return invalid(`unsupported license version ${p.v}`);
  // Signed payloads may carry legacy tier names (a 'pro' license issued before
  // the 2026-08-25 canonicalization verifies as 'team') — the alias map is the
  // read boundary; the signer emits canonical only.
  const tier = canonicalizeTier(p.tier);
  if (!tier) return invalid(`unknown tier "${p.tier}"`);
  if (p.deployment !== 'self-hosted') return invalid(`license is for deployment "${p.deployment}", not self-hosted`);
  if (!p.licensee?.trim()) return invalid('license carries no licensee');
  const exp = Date.parse(p.expires);
  if (Number.isNaN(exp)) return invalid('license has no parseable expiry');
  if (exp < now.getTime()) return invalid(`license expired ${p.expires} (licensee: ${p.licensee})`);

  return { valid: true, tier, licensee: p.licensee, expires: p.expires };
}

/**
 * The deployment-facing resolver: env-shaped inputs in, PlanTier out.
 * Key resolution order: build-stamped embedded key, then the env override.
 */
export async function resolveSelfHostTier(
  env: { license?: string; publicKey?: string },
  now: Date,
): Promise<{ tier: PlanTier; licensee?: string; reason?: string }> {
  const key = EMBEDDED_LICENSE_PUBLIC_KEY || env.publicKey || '';
  const verdict = await verifyLicense(env.license ?? '', key, now);
  return verdict.valid
    ? { tier: verdict.tier, licensee: verdict.licensee }
    : { tier: 'community', reason: verdict.reason };
}
