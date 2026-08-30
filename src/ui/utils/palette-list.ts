// N4.5 (owner direction 2026-07-23): the browse IS one alphabetical running list —
// searchable, letter-snappable, scalable to a voluminous catalog — with STRUCTURE as a
// separate, clearly-defined set (the taxonomy N7's ONTOLOGY.md captures first-class).
// Categories, bands, and the lens chip are gone from the sidebar; this module is the
// pure, testable core of the new browse.
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../../persistence/supabase/catalog-repository.js';
import { paletteChip, deriveNodeNature, providerPlatformRoleId } from './node-nature.js';

export interface PaletteListItem {
  key: string;
  kind: 'technology' | 'role' | 'structure';
  /** technology id for tech rows; role id otherwise. */
  id: string;
  name: string;
  caption: string | null;
  chip: string | null;
  /** Full nature sentence — tooltip truth. */
  natureLine: string;
  /** Lucide icon name for role/structure rows. */
  iconName: string | null;
  color: string | null;
  brandColor: string | null;
  /** Role that travels with the drag when unambiguous (single live affinity / role rows). */
  dragRoleId: string | null;
  /** N4.6: provider family key (aws|azure|gcp|…) — the filter-chip dimension. */
  family: string | null;
}

// ── N4.6 provider families ──────────────────────────────────────────────────────────
// Membership = id prefix / alias (providerPlatformRoleId — the SAME source as the
// N3.8 minimum-container rule) OR brand-name prefix, so imported technologies file
// into their family automatically by naming convention alone (owner: "as I add more
// technologies, they are easily understood and importable").

const FAMILY_LABELS: Record<string, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'Google Cloud',
  supabase: 'Supabase',
  cloudflare: 'Cloudflare',
  vmware: 'VMware',
  vercel: 'Vercel',
  netlify: 'Netlify',
  railway: 'Railway',
  render: 'Render',
  'fly-io': 'Fly.io',
};

// N4.7 (owner: "firebase is part of GCP and should not be its own thing"): family-level
// fold. providerPlatformRoleId ALSO maps firebase-* → gcp now (full merge — drops nest
// under the Google Cloud container), so this remap is the belt for name-pattern hits
// and any legacy 'firebase' values that reach the family layer.
const FAMILY_REMAP: Record<string, string> = {
  firebase: 'gcp',
};

const FAMILY_NAME_PATTERNS: Array<[RegExp, string]> = [
  [/^(aws|amazon)\b/i, 'aws'],
  [/^(microsoft\s+)?azure\b/i, 'azure'],
  [/^(gcp|google\s+cloud)\b/i, 'gcp'],
  [/^supabase\b/i, 'supabase'],
  [/^firebase\b/i, 'gcp'],
  [/^cloudflare\b/i, 'cloudflare'],
  [/^vmware\b/i, 'vmware'],
];

/** N4.7: which platform-container role ids a family chip covers — the Structure filter
 *  under the Google Cloud chip must surface BOTH the gcp container and any legacy
 *  Firebase container still present in old graphs. Default: the family key itself. */
export function familyPlatformRoleIds(familyKey: string): string[] {
  return familyKey === 'gcp' ? ['gcp', 'firebase'] : [familyKey];
}

export function familyForTechnology(technologyId: string, name: string): string | null {
  const byId = providerPlatformRoleId(technologyId);
  if (byId) return FAMILY_REMAP[byId] ?? byId;
  if (technologyId in FAMILY_LABELS) return technologyId; // the platform identifier itself
  if (technologyId in FAMILY_REMAP) return FAMILY_REMAP[technologyId];
  for (const [pattern, key] of FAMILY_NAME_PATTERNS) {
    if (pattern.test(name)) return key;
  }
  return null;
}

export function familyLabel(key: string): string {
  return FAMILY_LABELS[key] ?? key;
}

export interface FamilyChip {
  key: string;
  label: string;
  count: number;
  /** N4.7: member technology ids (first few) — chip logo falls back to the first
   *  member with a catalog logo when the family key itself has none (Supabase,
   *  Cloudflare have no `supabase`/`cloudflare` technology rows). */
  sampleTechIds: string[];
}

/** Families present in the list (≥2 members), largest first — the filter-chip row. */
export function familiesInList(items: PaletteListItem[], minCount = 2): FamilyChip[] {
  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  for (const item of items) {
    if (!item.family) continue;
    counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
    const list = samples.get(item.family) ?? [];
    if (list.length < 8 && item.kind === 'technology') list.push(item.id);
    samples.set(item.family, list);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, label: familyLabel(key), count, sampleTechIds: samples.get(key) ?? [] }));
}

function firstSentence(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const first = t.split(/(?<=[.!?])\s/)[0];
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

function liveLeafAffinities(tech: TechnologyCatalogEntry, resolver: CatalogResolver): NodeRole[] {
  return tech.roleAffinities
    .map(rid => resolver.getRole(rid))
    .filter((r): r is NodeRole => !!r && !r.deprecated && !r.isContainer);
}

/** Roles a technology can DROP as. Leaf affinities win; N8.4a-1c (owner bench finding
 *  2026-07-27: "I don't see amazon EC2 in our nodes list on sidebar"): technologies
 *  whose ONLY live affinities are CONTAINER roles (aws-ec2 → virtual-machine; the
 *  docker/kubernetes class) were silently absent from the Technology list — line
 *  `liveRoles.length === 0 → continue` dropped them. They now list with the container
 *  as the drop role: dropping creates the hosting container bound to the technology,
 *  which is the N5.16 model (hosting containers are real deliverables with IaC packets).
 *  roleTechnologyStats deliberately keeps the leaf-only helper — RULE A/B semantics
 *  are unchanged.
 *
 *  N8.4s (owner bench 2026-07-27: "VPC nodes are not even adding to the canvas"):
 *  EXPORTED because the Canvas drop handler must use the SAME rule. It had its own copy
 *  that filtered `!isContainer`, so aws-vpc / azure-vnet / gcp-vpc listed in the palette
 *  (this function allows containers) and then silently produced nothing on drop (the
 *  copy allowed none). The list said yes, the drop said no. One rule, one place. */
export function liveDropAffinities(tech: TechnologyCatalogEntry, resolver: CatalogResolver): NodeRole[] {
  const live = tech.roleAffinities
    .map(rid => resolver.getRole(rid))
    .filter((r): r is NodeRole => !!r && !r.deprecated);
  const leaves = live.filter(r => !r.isContainer);
  return leaves.length > 0 ? leaves : live.filter(r => r.isContainer);
}

/** One row per recognizable technology (N3.7 discipline): name + purpose + chip. */
/** N8.4s (owner bench 2026-07-27: "there's a Structure Google Cloud Platform overall
 *  node … then there's the branded actual node"): the provider PLATFORM container is one
 *  thing and the Structure section already lists it (from the `aws`/`azure`/`gcp` ROLE).
 *  The legacy `aws`/`azure`/`gcp` TECHNOLOGY rows — "Amazon Web Services", "Microsoft
 *  Azure", "Google Cloud Platform" — are a second row for that same thing under a second
 *  name, which is the N3.7 rule broken in the most confusing possible place. Suppressed
 *  here rather than deleted: existing nodes may still carry `technology: 'aws'`, and the
 *  row keeps resolving for them. */
function isPlatformOnlyTechnology(roles: NodeRole[]): boolean {
  return roles.length > 0 && roles.every(r => r.nature === 'host');
}

export function buildTechnologyListItems(resolver: CatalogResolver): PaletteListItem[] {
  const items: PaletteListItem[] = [];
  for (const tech of resolver.getAllTechnologies()) {
    const liveRoles = liveDropAffinities(tech, resolver);
    if (liveRoles.length === 0) continue;
    if (isPlatformOnlyTechnology(liveRoles)) continue;
    const primary = liveRoles[0];
    const aiCtx = tech.aiContext as Record<string, unknown> | undefined;
    const nature = deriveNodeNature(primary, tech);
    items.push({
      key: `tech:${tech.id}`,
      kind: 'technology',
      id: tech.id,
      name: tech.displayName || tech.name,
      caption: firstSentence(aiCtx?.purpose as string) ?? nature.line,
      chip: paletteChip(primary, tech),
      natureLine: nature.line,
      iconName: null,
      color: null,
      brandColor: tech.brandColor,
      dragRoleId: liveRoles.length === 1 ? primary.id : null,
      family: familyForTechnology(tech.id, tech.displayName || tech.name),
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Generic leaf roles (Backend Service, Worker, External Service…) — recognizable
 *  concepts you can drop without committing to a technology. */
export function buildRoleListItems(resolver: CatalogResolver): PaletteListItem[] {
  return resolver.getAllRoles()
    .filter(r => !r.deprecated && !r.isContainer && r.nature !== 'integrate')
    .map(role => ({
      key: `role:${role.id}`,
      kind: 'role' as const,
      id: role.id,
      name: role.label,
      caption: firstSentence(role.description),
      chip: paletteChip(role),
      natureLine: deriveNodeNature(role).line,
      iconName: role.iconName,
      color: role.color,
      brandColor: null,
      dragRoleId: role.id,
      family: null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── N4.7: the Functional Node Types browse section ──────────────────────────────────
// Owner: generic roles that lead to a language/framework choice are value-added;
// roles that can only lead to a platform selection (or to nothing) are confusing as
// generic drops. Two catalog-derived HIDE rules — presentation-only (hidden roles stay
// searchable and canvas-valid; catalog disposition is N8's):
//   RULE A — the role has ≥1 live technology and ZERO non-provider technologies:
//            a generic drop can only ask "which platform?" (cdn, object-storage…).
//   RULE B — the role has ZERO live technologies, kind app_service, outside Hardware:
//            a generic drop dead-ends — there is no choice to make (dns, waf…).
// Hardware/hardware_device (legitimately tech-less physical concepts), external_system,
// and automation_pipeline kinds are exempt by construction.

/** Per-role live technology stats: total + how many are NOT provider-branded. */
function roleTechnologyStats(resolver: CatalogResolver): Map<string, { total: number; nonProvider: number }> {
  const stats = new Map<string, { total: number; nonProvider: number }>();
  for (const tech of resolver.getAllTechnologies()) {
    const isProvider = familyForTechnology(tech.id, tech.displayName || tech.name) !== null;
    for (const role of liveLeafAffinities(tech, resolver)) {
      const s = stats.get(role.id) ?? { total: 0, nonProvider: 0 };
      s.total += 1;
      if (!isProvider) s.nonProvider += 1;
      stats.set(role.id, s);
    }
  }
  return stats;
}

export function buildFunctionalRoleItems(resolver: CatalogResolver): PaletteListItem[] {
  const stats = roleTechnologyStats(resolver);
  const leaves = buildRoleListItems(resolver)
    .filter(item => {
      const role = resolver.getRole(item.id);
      if (!role) return false;
      const s = stats.get(role.id);
      if (s && s.total > 0 && s.nonProvider === 0) return false; // RULE A
      // RULE B — M1c: was `kind === 'app_service'`. Keyed on nature it must EXCLUDE the
      // exempt nature ('call' = external concepts, 'engine' = boundary engines) rather than
      // include one, or the ten provider capabilities that M1a re-filed `integrate` would
      // leak into the browse — the exact leak the §13.4c audit flagged.
      if (!s && role.nature !== 'call' && role.nature !== 'engine' && role.paletteCategory !== 'Hardware') return false; // RULE B
      return true;
    })
    .map(item => {
      const s = stats.get(item.id);
      const caption = s && s.total > 0
        ? `generic — pick technology later (${s.total} available)`
        : item.caption;
      return { ...item, caption };
    });
  // Owner ruling 2026-08-05: generic hosting/hardware container concepts browse HERE,
  // not beside the brand platforms. RULE A/B are leaf rules — a container drop always
  // leads to a provisioning deliverable, never a dead end.
  return [...leaves, ...buildGenericContainerItems(resolver)]
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The Structure set (owner ruling 2026-08-05, supersedes N4.4's single-Group collapse
 *  and the N8.4s-era hosting rows): ONLY the original organizational roles — the
 *  logical-boundary containers filed under palette_category 'Logical'. Hosting
 *  containers (platforms included) are a different concept and live in their own
 *  section (buildHostingListItems). Strays styled logical-boundary but filed elsewhere
 *  stay searchable, never structural. (The two known strays were re-filed by N10(c)
 *  2026-08-09 — service-mesh is a Networking leaf, game-engine-project is deprecated —
 *  but the predicate stays: it is what PREVENTS the class from re-forming.) */
export function buildStructureListItems(resolver: CatalogResolver): PaletteListItem[] {
  const logical = resolver.getAllRoles()
    .filter(r => !r.deprecated && r.isContainer
      && r.containerStyle === 'logical-boundary' && r.paletteCategory === 'Logical')
    .sort((a, b) => (a.id === 'application-module' ? -1 : b.id === 'application-module' ? 1 : a.label.localeCompare(b.label)));

  return logical.map(role => ({
    key: `structure:${role.id}`,
    kind: 'structure' as const,
    id: role.id,
    name: role.label,
    caption: role.id === 'application-module'
      ? 'Optional — organizes related nodes; nothing runs here'
      : firstSentence(role.description),
    chip: 'Group',
    natureLine: deriveNodeNature(role).line,
    iconName: role.iconName,
    color: role.color,
    brandColor: null,
    dragRoleId: role.id,
    family: null,
  }));
}

/** Platforms — BRAND platforms only (owner ruling 2026-08-05: "platforms should just
 *  be platforms"). Predicate is the ontology axis itself: `nature === 'host'` — the
 *  role IS a vendor-operated hosting boundary (aws, azure, gcp, cloudflare, supabase,
 *  vercel, netlify, railway, render, fly-io). Generic hosting concepts you provision
 *  yourself (virtual-machine, k8s-cluster, docker-container, vpc…) are nature 'build'
 *  and browse under Functional Node Types instead. Scalable by construction: platform
 *  role #12 arrives with nature 'host' and files in with zero code change. */
export function buildPlatformListItems(resolver: CatalogResolver): PaletteListItem[] {
  return resolver.getAllRoles()
    .filter(r => !r.deprecated && r.isContainer && r.nature === 'host')
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(role => ({
      key: `platform:${role.id}`,
      kind: 'structure' as const,
      id: role.id,
      name: role.label,
      caption: firstSentence(role.description),
      chip: 'Host',
      natureLine: deriveNodeNature(role).line,
      iconName: role.iconName,
      color: role.color,
      brandColor: null,
      dragRoleId: role.id,
      family: null,
    }));
}

/** Generic hosting/hardware container CONCEPTS — Virtual Machine, Kubernetes Cluster,
 *  Docker Container, VPC, Robot, IoT Gateway… You provision these yourself (nature
 *  'build'; a real deliverable per N5.16), so they browse beside the other functional
 *  concepts. Provider-BRANDED non-platform containers (ecs-cluster → aws) are excluded:
 *  they are reachable via their technology row and search, never as a loose generic. */
function buildGenericContainerItems(resolver: CatalogResolver): PaletteListItem[] {
  return resolver.getAllRoles()
    .filter(r => !r.deprecated && r.isContainer && r.containerStyle !== 'logical-boundary'
      && r.nature !== 'host' && !r.provider)
    .map(role => ({
      key: `role:${role.id}`,
      kind: 'role' as const,
      id: role.id,
      name: role.label,
      caption: firstSentence(role.description),
      chip: 'Host',
      natureLine: deriveNodeNature(role).line,
      iconName: role.iconName,
      color: role.color,
      brandColor: null,
      dragRoleId: role.id,
      family: null,
    }));
}

/** N4.7: the A–Z stream is TECHNOLOGY-ONLY — generic roles moved to their own browse
 *  section (Functional Node Types), per the owner's three-section sidebar. */
export function buildAlphabeticalPalette(resolver: CatalogResolver): PaletteListItem[] {
  return buildTechnologyListItems(resolver);
}

export interface LetterGroup {
  letter: string;
  items: PaletteListItem[];
}

/** Letter buckets for the snap rail. Non-alphabetic leaders bucket under '#' (last). */
export function groupByLetter(items: PaletteListItem[]): LetterGroup[] {
  const buckets = new Map<string, PaletteListItem[]>();
  for (const item of items) {
    const first = item.name.charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : '#';
    if (!buckets.has(letter)) buckets.set(letter, []);
    buckets.get(letter)!.push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0])))
    .map(([letter, groupItems]) => ({ letter, items: groupItems }));
}
