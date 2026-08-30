/*
  M6 — THE provider-inference table (SERVER MIRROR). Mirrored from
  core/src/provider-inference.ts (the enums.ts pattern). Values MUST stay identical.

  There were FOUR copies, and they had already drifted:

    core/src/container-types.ts                     prefixes + family  (correct)
    supabase/.../role-registry.ts                   prefixes + family  (correct; its own
                                                    comment admitted the duplication)
    supabase/.../mcp-context-assembly.ts            prefixes ONLY      — returned `firebase`
    supabase/.../task-document-generator.ts         prefixes ONLY      — returned `firebase`

  The family mapping is not cosmetic. N4.7 merged the Firebase family INTO Google Cloud
  (owner: "firebase is part of GCP and should not be its own thing"), so a firebase-* child
  and its `gcp` platform parent must agree on one provider. Where the family mapping was
  missing they did not agree:

    - N8.4c-1 (already fixed, in container-types): the containment coherence rule saw child
      `firebase` vs container `gcp` and REFUSED every Firebase node dropped into a Google
      Cloud project.
    - Still live until this task, in the two copies above: the capability-equivalence note
      shipped to the user's AI read "a managed FIREBASE service … running inside its
      provider's platform" while the platform it named was Google Cloud.

  Two defects, same root cause, found one at a time. That is the argument for one table.
*/

/** Ids carrying one of these prefixes are provider-branded managed services.
 *  Every platform ROLE with a `provider` column must have its prefix here — the 4g-2
 *  hosting platforms shipped without theirs (recorded looseness: vercel-edge stayed
 *  droppable in foreign containers), closed 2026-08-05. */
/*  'supabase-' is DELIBERATELY ABSENT (owner bug report 2026-08-05, applying the 4g-3
 *  two-lane ruling): supabase-* technologies are LANE-NEUTRAL — inside the
 *  'Supabase (Managed)' platform they are the managed services; inside Docker or any
 *  self-managed container they are the OSS components (GoTrue, storage-api,
 *  edge-runtime). PLACEMENT decides the lane, so nothing may auto-parent them into a
 *  managed container or flag them "managed service without platform parent".
 *  Firebase stays listed: it has no self-hosted lane. */
export const KNOWN_PROVIDER_PREFIXES = [
  'aws-', 'azure-', 'gcp-', 'firebase-', 'cloudflare-',
  'vercel-', 'netlify-', 'railway-', 'render-', 'fly-io-',
] as const;

/** Sub-brands that resolve to their PARENT provider. The prefix survives on ids (there are
 *  297 enriched `firebase-*` rows); only the inferred provider collapses. */
export const PROVIDER_PREFIX_FAMILY: Record<string, string> = { firebase: 'gcp' };

/** The provider COLUMN goes through the same mapping as the prefix, so a legacy `firebase`
 *  platform container and a firebase-* child agree. */
export function normalizeProviderFamily(provider: string | null | undefined): string | null {
  return provider ? (PROVIDER_PREFIX_FAMILY[provider] ?? provider) : null;
}

// ── N8.5″(d): DB-authority — the catalog SEEDS the family set at load ─────────────────
// KNOWN_PROVIDER_PREFIXES becomes the FLOOR, not the ceiling. At catalog load, every
// distinct non-null `node_roles.provider` value registers its prefix, so a NEW provider
// works with ZERO code changes — one catalog row with a stamped provider column — while
// inference for everything the static floor covers is STRUCTURALLY unchanged (union
// semantics: registration can only add prefixes, never remove or re-map existing ones).
// GROWTH FENCE: do not add entries to the static list — new providers land as catalog
// rows. The static floor drops entirely once the owner's live export confirms every
// family has a provider-stamped role (one-line SQL check; N11-adjacent).
const registeredPrefixes = new Map<string, string>();

export function registerProviderFamilies(providers: Iterable<string | null | undefined>): void {
  for (const p of providers) {
    if (typeof p === 'string' && p.trim().length > 0) {
      const raw = p.trim();
      registeredPrefixes.set(`${raw}-`, PROVIDER_PREFIX_FAMILY[raw] ?? raw);
    }
  }
}

/** Test seam: clear the catalog-derived families (module state persists per isolate). */
export function resetRegisteredProviderFamilies(): void {
  registeredPrefixes.clear();
}

/** The provider family for a technology/role id, or null if it is not provider-branded. */
export function inferProviderFromId(id: string): string | null {
  for (const prefix of KNOWN_PROVIDER_PREFIXES) {
    if (id.startsWith(prefix)) {
      const raw = prefix.slice(0, -1);
      return PROVIDER_PREFIX_FAMILY[raw] ?? raw;
    }
  }
  for (const [prefix, family] of registeredPrefixes) {
    if (id.startsWith(prefix)) return family;
  }
  return null;
}

export function hasProviderPrefix(id: string): boolean {
  if (KNOWN_PROVIDER_PREFIXES.some(p => id.startsWith(p))) return true;
  for (const prefix of registeredPrefixes.keys()) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}

/** Provider-branded technologies whose ids PREDATE the prefix convention ("Amazon Aurora"
 *  is `aurora`). N8's filing gate makes the prefix mandatory going forward; these are the
 *  registered strays, and they behave exactly like their prefixed siblings. */
export const PROVIDER_ID_ALIASES: Record<string, string> = {
  aurora: 'aws',
  dynamodb: 'aws',
  ec2: 'aws',
  cosmosdb: 'azure',
};

/** The provider family for an id, prefix OR registered alias. This is the one every caller
 *  wants — `inferProviderFromId` alone misses the four pre-prefix strays. */
export function providerFamilyForId(id: string): string | null {
  return inferProviderFromId(id) ?? PROVIDER_ID_ALIASES[id] ?? null;
}

export function isProviderBrandedId(id: string): boolean {
  return providerFamilyForId(id) !== null;
}
