/*
  P0-1: BYOK crypto envelope v2.

  Encrypts ALL stored customer secrets: AI provider keys
  (user_api_keys.api_key_encrypted) and git provider tokens
  (git_integrations.access_token_encrypted).

  Formats:
    v2 (current): "v2:<b64 salt>:<b64 iv>:<b64 ciphertext>"
      AES-GCM-256; key = PBKDF2(ENCRYPTION_SECRET, per-record random salt, 100k, SHA-256).
    v1 (legacy):  "<b64 iv>:<b64 ciphertext>"
      AES-GCM-256; key = PBKDF2(SUPABASE_SERVICE_ROLE_KEY, STATIC salt, 100k, SHA-256).
      Readable for migration only; new writes are v2 whenever ENCRYPTION_SECRET is set.

  Runtime layout: the core functions are PURE (secrets passed in, no env access) so
  vitest exercises the real shipped code; the thin `encrypt`/`decrypt`/
  `decryptWithUpgrade` wrappers read Deno env at CALL time (never at module load).

  Failure policy: decryption fails CLOSED — wrong key, tampered salt/iv/ciphertext, or a
  malformed envelope all throw; no partial plaintext is ever returned.
*/

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const SEPARATOR = ':';
const V2_PREFIX = 'v2';
const LEGACY_STATIC_SALT = 'nodal-token-encryption-v1';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Pure core (no env access; testable in any runtime with WebCrypto) ──────────────────

/** Encrypt to the v2 envelope: per-record random salt, dedicated secret. */
export async function encryptV2(plaintext: string, encryptionSecret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(encryptionSecret, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );

  return [V2_PREFIX, toBase64(salt.buffer), toBase64(iv.buffer), toBase64(ciphertext)].join(SEPARATOR);
}

/** Legacy v1 write path — static salt, service-role-derived key. Migration/fallback only. */
export async function encryptLegacy(plaintext: string, legacySecret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(legacySecret, new TextEncoder().encode(LEGACY_STATIC_SALT));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );

  return toBase64(iv.buffer) + SEPARATOR + toBase64(ciphertext);
}

export interface DecryptSecrets {
  /** Dedicated secret for v2 envelopes (ENCRYPTION_SECRET). */
  encryptionSecret?: string;
  /** Service-role key — accepted ONLY for legacy v1 values. */
  legacySecret?: string;
}

/** Decrypt either format; reports which one was found so callers can lazily upgrade. */
export async function decryptAny(
  encrypted: string,
  secrets: DecryptSecrets,
): Promise<{ plaintext: string; format: 'v1' | 'v2' }> {
  const parts = encrypted.split(SEPARATOR);

  let format: 'v1' | 'v2';
  let secret: string;
  let salt: Uint8Array;
  let ivB64: string;
  let ciphertextB64: string;

  if (parts.length === 4 && parts[0] === V2_PREFIX) {
    if (!secrets.encryptionSecret) {
      throw new Error('ENCRYPTION_SECRET is required to decrypt a v2 envelope but is not configured');
    }
    format = 'v2';
    secret = secrets.encryptionSecret;
    salt = fromBase64(parts[1]);
    ivB64 = parts[2];
    ciphertextB64 = parts[3];
  } else if (parts.length === 2) {
    if (!secrets.legacySecret) {
      throw new Error('Legacy secret is required to decrypt a v1 value but is not configured');
    }
    format = 'v1';
    secret = secrets.legacySecret;
    salt = new TextEncoder().encode(LEGACY_STATIC_SALT);
    ivB64 = parts[0];
    ciphertextB64 = parts[1];
  } else {
    throw new Error('Invalid encrypted token format');
  }

  const key = await deriveKey(secret, salt);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: fromBase64(ivB64) as BufferSource },
      key,
      fromBase64(ciphertextB64) as BufferSource,
    );
  } catch {
    // Fail closed: wrong key or tampered salt/iv/ciphertext. Never partial plaintext.
    throw new Error('Decryption failed: wrong key or tampered ciphertext');
  }

  return { plaintext: new TextDecoder().decode(decrypted), format };
}

/** True for either envelope format (used to distinguish stored plaintext git tokens). */
export function isEncrypted(value: string): boolean {
  const parts = value.split(SEPARATOR);
  try {
    if (parts.length === 4 && parts[0] === V2_PREFIX) {
      fromBase64(parts[1]);
      fromBase64(parts[2]);
      fromBase64(parts[3]);
      return true;
    }
    if (parts.length === 2) {
      fromBase64(parts[0]);
      fromBase64(parts[1]);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Deno env wrappers (env read at call time — module stays import-safe everywhere) ────

// Ambient declaration so the app tsconfig (which type-checks this file via the vitest
// tests importing the pure core) compiles without Deno lib types. At runtime the
// wrappers below only execute inside the Deno edge runtime.
declare const Deno: { env: { get(name: string): string | undefined } };

function getEncryptionSecret(): string | undefined {
  return Deno.env.get('ENCRYPTION_SECRET') || undefined;
}

function getLegacySecret(): string | undefined {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined;
}

/** New writes are v2 whenever ENCRYPTION_SECRET is configured; otherwise degrade to the
 *  legacy format (with a loud warning) rather than breaking key/token saves. */
export async function encrypt(plaintext: string): Promise<string> {
  const encryptionSecret = getEncryptionSecret();
  if (encryptionSecret) {
    return encryptV2(plaintext, encryptionSecret);
  }

  const legacySecret = getLegacySecret();
  if (!legacySecret) {
    throw new Error('No encryption secret available (set ENCRYPTION_SECRET)');
  }
  console.warn('[crypto] ENCRYPTION_SECRET not set — writing LEGACY v1 envelope. Configure ENCRYPTION_SECRET (see DEPLOYMENT.md).');
  return encryptLegacy(plaintext, legacySecret);
}

export async function decrypt(encrypted: string): Promise<string> {
  const { plaintext } = await decryptAny(encrypted, {
    encryptionSecret: getEncryptionSecret(),
    legacySecret: getLegacySecret(),
  });
  return plaintext;
}

/** Decrypt and, when the value was legacy v1 AND ENCRYPTION_SECRET is configured, return
 *  a fresh v2 envelope for the caller to persist (lazy re-encryption). */
export async function decryptWithUpgrade(
  encrypted: string,
): Promise<{ plaintext: string; upgraded: string | null }> {
  const encryptionSecret = getEncryptionSecret();
  const { plaintext, format } = await decryptAny(encrypted, {
    encryptionSecret,
    legacySecret: getLegacySecret(),
  });

  const upgraded = format === 'v1' && encryptionSecret
    ? await encryptV2(plaintext, encryptionSecret)
    : null;

  return { plaintext, upgraded };
}
