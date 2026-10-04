// V3 AD.0 (owner 2026-09-24): the webhook's secret. Nothing ever wrote
// git_integrations.webhook_secret, and the handler verified a delivery only
// when a secret existed AND a signature header was present, so every delivery
// was accepted, a forged one included (finding S2). The owner ruled: NodeSpec
// shows the webhook's URL and a secret, and the person adds them in GitHub or
// GitLab; NodeSpec never registers the webhook through the provider API.
//
//   save-git-integration makes the secret when the integration has none or
//   binds a different repository, stores it encrypted like the token, and
//   returns it to the owner on every save.
//   The handler refuses a delivery with no secret on file, no signature, a
//   wrong signature, or a repository other than the integration's.
import { decrypt, isEncrypted } from "./crypto.ts";

/** 32 random bytes as hex: what the person pastes into the provider. */
export function newWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The stored secret in plain text, or null when there is none or it cannot
 *  be read (fail closed: an unreadable secret verifies nothing). A value that
 *  is not an envelope is taken as written, as a secret set by hand is. */
export async function readWebhookSecret(stored: string | null | undefined): Promise<string | null> {
  if (typeof stored !== "string" || stored.trim() === "") return null;
  if (!isEncrypted(stored)) return stored;
  try {
    const plain = await decrypt(stored);
    return plain.trim() === "" ? null : plain;
  } catch {
    return null;
  }
}

/** The secret a save keeps: the one on file, unless there is none or the
 *  integration now binds a different repository (its webhook lives there). */
export function webhookSecretToKeep(existingPlain: string | null, bindingChanged: boolean): string | null {
  return existingPlain && !bindingChanged ? existingPlain : null;
}

/** Equal strings, compared in time that does not depend on where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** The delivery names the integration's repository. GitHub sends
 *  repository.full_name and GitLab project.path_with_namespace on every push;
 *  a delivery naming neither is refused. */
export function webhookRepoMatches(
  provider: string,
  // deno-lint-ignore no-explicit-any
  body: any,
  repoOwner: string | null | undefined,
  repoName: string | null | undefined,
): boolean {
  if (!repoOwner || !repoName) return false;
  const named = provider === "gitlab" ? body?.project?.path_with_namespace : body?.repository?.full_name;
  if (typeof named !== "string" || named.trim() === "") return false;
  return named.trim().toLowerCase() === `${repoOwner}/${repoName}`.toLowerCase();
}
