// V3 AD.2 (owner 2026-09-24, ruling 5; invariant I12): no credential reaches git.
//
// model.json now carries node configuration and contract schema bodies, so git
// holds the whole design. The catalog's config fields include
// `connectionString`, `apiKey` and `database_password`, so a person can type a
// real secret into a node. Everything NodeSpec writes to git passes through
// here first: a value that looks like a credential is replaced by a marked
// placeholder and its path is reported, so the push can name it. A load never
// writes the placeholder over the value the canvas holds.
//
// A string value is withheld when
//   - the field holding it is named for a password, secret, token, credential
//     or key (`dbPassword`, `clientSecret`, `accessToken`, `apiKey`,
//     `private_key`), and the value is not a placeholder; in a JSON Schema the
//     name of the property counts for its `default`, `example`, `const` and
//     `enum` values;
//   - it is a connection string with an inline password
//     (`postgres://app:s3cret@db/app`, `Server=x;Password=s3cret`); or
//   - it has the shape of a known token (GitHub, GitLab, AWS, Slack, Stripe,
//     OpenAI, Anthropic, Google, SendGrid, npm, a JWT, a PEM private key).
// Numbers and booleans are never withheld.

export const WITHHELD = "nodespec:withheld";

/** The last word of the field name that marks a secret on its own. */
const SECRET_WORDS = new Set([
  "password", "passwd", "pwd", "passphrase", "secret", "secrets", "token", "credential", "credentials",
  "apikey", "authorization",
]);
/** A word before "key" that makes the key a secret one (`apiKey`, `privateKey`). */
const KEY_QUALIFIERS = new Set([
  "api", "access", "secret", "private", "auth", "client", "signing", "encryption", "master", "service",
  "license", "webhook", "ssh", "deploy", "app", "consumer", "subscription", "admin", "account",
]);
/** JSON Schema slots whose values belong to the property that holds them. */
const VALUE_SLOTS = new Set(["default", "example", "examples", "const", "enum"]);

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when a field name marks its value as a secret. A lone `key` counts
 *  only for a value long enough to be one (see `withholdCredentials`). */
export function isSecretName(name: string): boolean {
  const w = words(name);
  if (w.length === 0) return false;
  const last = w[w.length - 1];
  if (SECRET_WORDS.has(last)) return true;
  if (last === "key" || last === "keys") return w.length === 1 || KEY_QUALIFIERS.has(w[w.length - 2]);
  return false;
}

/** A value that stands in for a secret rather than being one. */
export function isPlaceholder(value: string): boolean {
  const s = value.trim();
  if (s === "" || s === WITHHELD) return true;
  if (/^\$\{[^}]+\}$/.test(s) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return true; // ${VAR}, $VAR
  if (/^\{\{.+\}\}$/.test(s) || /^<[^<>]+>$/.test(s) || /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(s)) return true;
  if (/^(env|secret|secrets|vault|ssm|op|aws-sm|gcp-sm|azure-kv|keychain):/i.test(s)) return true;
  if (/^(process\.env|env)\.[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return true;
  if (/^[*•x.\-_]+$/i.test(s)) return true; // ****, xxxx
  if (/^(changeme|change[-_ ]me|placeholder|redacted|todo|tbd|none|null|example|dummy|your[-_ ].*)$/i.test(s)) return true;
  return false;
}

const TOKEN_SHAPES: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s@/]+)@/i;
const KV_PASSWORD = /(?:^|;)\s*(?:password|pwd)\s*=\s*([^;]+)/i;

function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** True for a value that is a credential whatever field holds it. */
export function looksLikeCredential(value: string): boolean {
  const s = value.trim();
  const url = s.match(URL_WITH_PASSWORD);
  if (url && !isPlaceholder(decoded(url[1]))) return true;
  const kv = s.match(KV_PASSWORD);
  if (kv && !isPlaceholder(kv[1])) return true;
  return TOKEN_SHAPES.some((shape) => shape.test(s));
}

function secretByName(owner: string | null, value: string): boolean {
  if (owner === null || !isSecretName(owner) || isPlaceholder(value)) return false;
  // A field named only `key` often holds a routing or partition key; it counts
  // when the value is long and unbroken, as a real key is.
  const w = words(owner);
  if (w.length === 1 && (w[0] === "key" || w[0] === "keys")) return value.trim().length >= 12 && !/\s/.test(value.trim());
  return true;
}

/**
 * A copy of `value` with every credential replaced by `WITHHELD`, and the
 * dotted path of each one (`config.database.password`,
 * `schema.properties.token.default`). Pure; the input is not changed.
 */
export function withholdCredentials<T>(value: T, basePath = ""): { value: T; withheld: string[] } {
  const withheld: string[] = [];
  const walk = (v: unknown, path: string, owner: string | null): unknown => {
    if (typeof v === "string") {
      if (secretByName(owner, v) || looksLikeCredential(v)) {
        withheld.push(path);
        return WITHHELD;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, owner));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(x, path ? `${path}.${k}` : k, VALUE_SLOTS.has(k) ? owner : k);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, basePath, null) as T, withheld };
}

/**
 * For a load: `incoming` is what git holds, `current` what the canvas holds.
 * Every `WITHHELD` in `incoming` takes the canvas's value at the same place;
 * where the canvas has none, the key is left out, so the placeholder never
 * lands on the canvas.
 */
export function keepWithheldFromCanvas(incoming: unknown, current: unknown): unknown {
  if (incoming === WITHHELD) return current;
  if (Array.isArray(incoming)) {
    const cur = Array.isArray(current) ? current : [];
    return incoming
      .map((x, i) => keepWithheldFromCanvas(x, cur[i]))
      .filter((x) => x !== undefined);
  }
  if (incoming && typeof incoming === "object") {
    const cur = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(incoming as Record<string, unknown>)) {
      const kept = keepWithheldFromCanvas(x, cur[k]);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  return incoming;
}
