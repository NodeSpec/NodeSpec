// N3.5: the plain-language layer over the ontology axes (owner: "the terminology as to
// what constitutes a node is key" — users must never need to understand axis jargon).
// The axes keep working invisibly (zoom, retrieval, task-doc treatment); humans see one
// sentence saying what the thing IS. Server twin of the nature wording lives in
// supabase/functions/_shared/catalog-search.ts — keep the phrases aligned.
import type { NodeRole, TechnologyCatalogEntry } from '../../persistence/supabase/catalog-repository.js';
import { effectiveTreatmentForRole } from '@nodespec/core/ontology.js';
import { providerFamilyForId } from '@nodespec/core/provider-inference.js';

export interface NodeNature {
  /** One plain sentence: what this node is and who runs it. */
  line: string;
  /** Very short chip label. */
  chip: string;
}

/** Structural shape the nature derivations actually read — lets palette items (which are
 *  not full NodeRole objects) participate without widening their type unsafely. */
export type NatureRoleShape = Pick<NodeRole, 'nature' | 'isContainer' | 'containerStyle'>;

export function deriveNodeNature(role: NatureRoleShape, tech?: TechnologyCatalogEntry | null): NodeNature {
  if (role.isContainer) {
    return role.containerStyle === 'logical-boundary'
      ? { line: 'Grouping — optional; organizes related nodes, nothing runs here', chip: 'Groups' }
      : { line: 'Hosting environment — runs other nodes', chip: 'Hosts' };
  }
  if (role.nature === 'call') {
    return { line: 'External service — you call it, someone else runs it', chip: 'You call' };
  }
  if (role.nature === 'host') {
    return { line: 'Platform — hosts parts of your system', chip: 'You host' };
  }
  if (role.nature === 'integrate') {
    return { line: 'Managed service — provider runs it, you configure it', chip: 'Managed' };
  }
  const techOverride = (tech?.aiContext as Record<string, unknown> | undefined)?.treatmentOverride;
  // M1b: treatment now derives from nature + containment rather than a stored column.
  if (effectiveTreatmentForRole(
        { nature: role.nature, is_container: role.isContainer },
        typeof techOverride === 'string' ? techOverride : undefined,
      ) === 'boundary') {
    const configMode = (tech?.aiContext as Record<string, unknown> | undefined)?.configMode;
    return configMode === 'definition-as-code'
      ? { line: 'Engine — you configure it; its definition file lives in your repo', chip: 'Engine' }
      : { line: 'Engine — you configure it; its internals stay inside it', chip: 'Engine' };
  }
  // N8.1b (owner bench feedback 2026-07-26): a generic role bound to a PROVIDER
  // technology read "Service you build" — a half-truth for AWS Lambda. Refine by the
  // bound technology's provider-ness + configMode. Twin: catalog-search.ts::describeNature.
  const cm = (tech?.aiContext as Record<string, unknown> | undefined)?.configMode;
  const providerBacked = tech ? providerPlatformRoleId(tech.id) !== null : false;
  if (providerBacked || cm === 'declarative' || cm === 'external') {
    return cm === 'code'
      ? { line: 'Managed runtime — you write the code, the provider runs it', chip: 'You build' }
      : { line: 'Managed service — provider runs it, you configure it', chip: 'Managed' };
  }
  return { line: 'Service you build', chip: 'You build' };
}

export const CUSTOM_NATURE: NodeNature = { line: 'Custom — defined by you, not in the catalog', chip: 'Custom' };

/** N3.8 (owner rule 2026-07-22): a provider-branded managed service (aws-s3, gcp-*, …)
 *  is only meaningful INSIDE its provider's platform — the platform parent is the minimum
 *  container, so parent/child semantics stay correct when the graph reaches an AI
 *  (ownership derives to `integrate` from the platform parent). Returns the provider's
 *  platform ROLE id for a provider-prefixed technology, else null. */
// M6: derived from the one provider table rather than re-listing the prefixes. The
// platform ROLE id equals the provider family id for all six, including the N4.7 Firebase
// merge (owner: "firebase is part of GCP and should not be its own thing") — firebase-*
// technologies nest under the Google Cloud platform container. Legacy Firebase containers
// in existing graphs keep rendering.

/** N4.6 audit: provider-branded technologies whose ids PREDATE the prefix convention
 *  ("Amazon Aurora" is `aurora`). One alias map feeds BOTH the family filter and the
 *  minimum-container rule, so the strays behave like their prefixed siblings. N8's
 *  filing gate makes the prefix (or a registered alias) mandatory going forward, and
 *  the N8 re-filing migration normalizes these ids. */
// M7: re-exported, not redefined — one provider table (M6 consolidated four copies and
// missed this pair because one of them is a Set, not a Record).
export { PROVIDER_ID_ALIASES as PROVIDER_ALIASES } from '@nodespec/core/provider-inference.js';

export function providerPlatformRoleId(technologyId: string | null | undefined): string | null {
  if (!technologyId) return null;
  return providerFamilyForId(technologyId);
}

/** N3.7 palette chip — the ONLY classification vocabulary shown at recognition time
 *  (owner 2026-07-22: 7 nature words read as a third taxonomy). Three words:
 *  Build = yours, the AI writes its code · Connect = someone else's — you configure or
 *  call it (external, managed, engine all collapse here) · Host = it runs other nodes
 *  (platforms + hosting containers). Logical groups get NO chip — their shape says it.
 *  The full nature sentence (deriveNodeNature) stays for tooltips/inspector/task docs,
 *  where the finer truth changes behavior. */
export function paletteChip(role: NatureRoleShape, tech?: TechnologyCatalogEntry | null): 'Build' | 'Connect' | 'Host' | null {
  const nature = deriveNodeNature(role, tech);
  switch (nature.chip) {
    case 'You build': return 'Build';
    case 'You call':
    case 'Managed':
    case 'Engine': return 'Connect';
    case 'You host':
    case 'Hosts': return 'Host';
    default: return null; // 'Groups' — logical containers carry no chip
  }
}

/** N3.7 drop-time disambiguation: when a technology maps to several roles, the question
 *  is asked in USAGE terms, never role-taxonomy terms. First sentence of the role's
 *  curated when_to_use (bounded), else its label. */
export function usagePhraseForRole(role: NodeRole): string {
  const src = (role.whenToUse ?? '').trim();
  if (src) {
    const firstSentence = src.split(/(?<=[.!?])\s/)[0].replace(/^Choose for\s*/i, '').trim();
    const phrase = firstSentence.length > 0 ? firstSentence[0].toUpperCase() + firstSentence.slice(1) : '';
    if (phrase) return phrase.length > 80 ? `${phrase.slice(0, 77)}…` : phrase;
  }
  return role.label;
}

/** N3.5 rectification (owner question 2026-07-22): a "custom technology" names an
 *  UNCATALOGUED DEPENDENCY (a partner API, an internal platform, a niche engine) — it is
 *  NOT for "the app I'm about to build". Your own component is just role + label,
 *  optionally with a real framework as build material (React on frontend-app stays a
 *  plain build node). So the custom tag + the task-doc honesty line apply ONLY on roles
 *  whose nature is not "you build": external, platform, managed, engine, container.
 *  On a build-nature role, a custom name becomes the node LABEL and nothing else. */
export function isCustomDependencyRole(role: NatureRoleShape): boolean {
  return deriveNodeNature(role).chip !== 'You build';
}

// ── Direct-hit search ranking (owner: "AWS S3" / "Apache NiFi" must come up first) ──────

export interface RankableEntry {
  id: string;
  name: string;
  displayName?: string | null;
  purpose?: string | null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_./]+/g, ' ').trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

/** Deterministic tiers: 1 exact (name/id/displayName) · 2 prefix · 3 all query tokens
 *  present in the entry's name/id/displayName · 4 purpose-text hit. Case/hyphen/space
 *  insensitive, so "apache nifi" hits `apache-nifi` and "s3"/"aws s3" hits `aws-s3`.
 *  Returns matches sorted by tier, then name. */
export function rankCatalogMatches<T extends RankableEntry>(query: string, entries: T[], limit = 25): Array<T & { matchTier: number }> {
  const q = normalize(query);
  if (!q) return [];
  const qTokens = tokens(query);

  const scored: Array<T & { matchTier: number }> = [];
  for (const entry of entries) {
    const hay = [entry.name, entry.id, entry.displayName ?? ''].map(normalize);
    const hayJoined = hay.join(' ');
    let tier: number | null = null;
    if (hay.some(h => h === q)) tier = 1;
    else if (hay.some(h => h.startsWith(q))) tier = 2;
    else if (qTokens.every(t => hayJoined.includes(t))) tier = 3;
    else if (entry.purpose && normalize(entry.purpose).includes(q)) tier = 4;
    if (tier !== null) scored.push({ ...entry, matchTier: tier });
  }
  return scored
    .sort((a, b) => a.matchTier - b.matchTier || a.name.localeCompare(b.name))
    .slice(0, limit);
}
