// P0-1: BYOK crypto envelope v2 — tests run against the REAL shipped crypto module
// (its core functions are pure: secrets are parameters, env access only happens inside
// the Deno wrappers, which these tests never call).
import { describe, expect, it } from 'vitest';
import {
  decryptAny,
  encryptLegacy,
  encryptV2,
  isEncrypted,
} from '../../supabase/functions/_shared/crypto.ts';

const ENCRYPTION_SECRET = 'test-dedicated-encryption-secret-v2';
const LEGACY_SECRET = 'test-service-role-key-legacy';
const PLAINTEXT = 'sk-ant-api03-averysecretcustomerkey';

describe('P0-1: v2 envelope', () => {
  it('round-trips and is versioned with a per-record salt', async () => {
    const envelope = await encryptV2(PLAINTEXT, ENCRYPTION_SECRET);
    expect(envelope.startsWith('v2:')).toBe(true);
    expect(envelope.split(':')).toHaveLength(4);

    const { plaintext, format } = await decryptAny(envelope, { encryptionSecret: ENCRYPTION_SECRET });
    expect(plaintext).toBe(PLAINTEXT);
    expect(format).toBe('v2');
  });

  it('two encryptions of the same plaintext differ (random salt AND iv per record)', async () => {
    const a = await encryptV2(PLAINTEXT, ENCRYPTION_SECRET);
    const b = await encryptV2(PLAINTEXT, ENCRYPTION_SECRET);
    expect(a).not.toBe(b);
    const [, saltA] = a.split(':');
    const [, saltB] = b.split(':');
    expect(saltA).not.toBe(saltB);
  });

  it('fails closed on a wrong secret', async () => {
    const envelope = await encryptV2(PLAINTEXT, ENCRYPTION_SECRET);
    await expect(decryptAny(envelope, { encryptionSecret: 'not-the-secret' }))
      .rejects.toThrow('Decryption failed');
  });

  it('fails closed on tampered ciphertext, salt, and iv — never partial plaintext', async () => {
    const envelope = await encryptV2(PLAINTEXT, ENCRYPTION_SECRET);
    const [prefix, salt, iv, ct] = envelope.split(':');

    const flip = (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      bytes[0] ^= 0xff;
      return btoa(String.fromCharCode(...bytes));
    };

    for (const tampered of [
      [prefix, salt, iv, flip(ct)].join(':'),
      [prefix, flip(salt), iv, ct].join(':'),
      [prefix, salt, flip(iv), ct].join(':'),
    ]) {
      await expect(decryptAny(tampered, { encryptionSecret: ENCRYPTION_SECRET }))
        .rejects.toThrow('Decryption failed');
    }
  });

  it('requires the dedicated secret — the legacy secret cannot open a v2 envelope', async () => {
    const envelope = await encryptV2(PLAINTEXT, ENCRYPTION_SECRET);
    await expect(decryptAny(envelope, { legacySecret: LEGACY_SECRET }))
      .rejects.toThrow('ENCRYPTION_SECRET is required');
  });
});

describe('P0-1: v1 (legacy) migration path', () => {
  it('still decrypts v1 values, reporting the format so callers can lazily upgrade', async () => {
    const v1 = await encryptLegacy(PLAINTEXT, LEGACY_SECRET);
    expect(v1.split(':')).toHaveLength(2);

    const { plaintext, format } = await decryptAny(v1, { legacySecret: LEGACY_SECRET });
    expect(plaintext).toBe(PLAINTEXT);
    expect(format).toBe('v1');
  });

  it('v1 -> v2 upgrade round-trip: re-encrypted value opens only with the new secret', async () => {
    const v1 = await encryptLegacy(PLAINTEXT, LEGACY_SECRET);
    const { plaintext } = await decryptAny(v1, { legacySecret: LEGACY_SECRET });
    const v2 = await encryptV2(plaintext, ENCRYPTION_SECRET);

    const roundTrip = await decryptAny(v2, { encryptionSecret: ENCRYPTION_SECRET });
    expect(roundTrip.plaintext).toBe(PLAINTEXT);

    // The leaked-admin-secret scenario this task closes: the service-role key alone no
    // longer decrypts the stored value.
    await expect(decryptAny(v2, { encryptionSecret: LEGACY_SECRET }))
      .rejects.toThrow('Decryption failed');
  });

  it('malformed values are rejected outright', async () => {
    for (const bad of ['', 'plaintext-token', 'a:b:c', 'v2:only:three']) {
      await expect(decryptAny(bad, { encryptionSecret: ENCRYPTION_SECRET, legacySecret: LEGACY_SECRET }))
        .rejects.toThrow();
    }
  });
});

describe('P0-1: isEncrypted recognizes both formats', () => {
  it('true for v1 and v2, false for plaintext and near-misses', async () => {
    expect(isEncrypted(await encryptV2(PLAINTEXT, ENCRYPTION_SECRET))).toBe(true);
    expect(isEncrypted(await encryptLegacy(PLAINTEXT, LEGACY_SECRET))).toBe(true);
    expect(isEncrypted('ghp_rawGithubTokenNoColons')).toBe(false);
    expect(isEncrypted('not!base64:also not!!')).toBe(false);
    expect(isEncrypted('v2:x:y')).toBe(false);
  });
});
