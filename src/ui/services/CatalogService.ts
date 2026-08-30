import { loadCatalog, type CatalogResolver, type NodeRole, type TechnologyCatalogEntry } from '../../persistence/supabase/catalog-repository.js';
import { populateDomains, type DomainNodeType, type NodeTypeDomain, type PortTemplate, type AIContext, type MetadataFieldSchema, type SuggestedFile, type SetupInstruction } from '@nodespec/core/node-types.js';
import type { AiContext } from '@nodespec/core/catalog-schemas.js';
import { hasCanContainRules, populateContainerTypes, setRoleResolver, setTechnologyTreatmentResolver, type ContainerTypeDefinition, type RoleInfo } from '@nodespec/core/container-types.js';
import { treatmentForRole } from '@nodespec/core/ontology.js';
import { registerProviderFamilies } from '@nodespec/core/provider-inference.js';
import { populateRFVisualTypes } from '../adapters/rf-visual-type-resolver.js';
import { populateTechnologyVisuals } from '../utils/technology-logo-map.js';
import { invalidateTemplateCache } from '@nodespec/core/templates.js';
import type { CatalogListingParam } from '@nodespec/core/catalog-scoring.js';
import { buildCatalogScoringHints, type CatalogScoringHints } from '@nodespec/core/catalog-scoring.js';

let cachedResolver: CatalogResolver | null = null;
let loadPromise: Promise<CatalogResolver> | null = null;

// ── N9b-2: catalog load-state machine ────────────────────────────────────────────────
// A failed DB catalog load used to be SWALLOWED (`.catch(() => {})` at every call
// site) while the static registries kept serving stale hardcoded data — a degraded
// session that read as a data bug on the bench rather than a load failure
// (`isCatalogPopulated()` existed to detect exactly this and NOTHING called it).
// The service now owns one observable load state; the DegradedCatalogBanner renders
// it and offers retry. Consumers keep their local fallbacks — degradation stays
// FUNCTIONAL, it just stops being silent.
// N8.5″(b): 'degraded' = the load SUCCEEDED but the M5 read gate skipped rows —
// the catalog is live yet incomplete, and that must never read as 'ready' (the
// skip count previously died in a console.warn; the banner renders this state).
export type CatalogLoadState = 'loading' | 'ready' | 'degraded' | 'failed';
let loadState: CatalogLoadState = 'loading';
let loadError: string | null = null;
const loadStateListeners = new Set<(state: CatalogLoadState, error: string | null) => void>();

function setLoadState(state: CatalogLoadState, error: string | null = null): void {
  loadState = state;
  loadError = error;
  for (const cb of loadStateListeners) cb(state, error);
}

interface DomainMeta {
  id: string;
  label: string;
  description: string;
  icon: string;
}

// N5.15 (core/ static-data audit): keyed on the CURRENT v3 palette categories
// (migration 20260624200858) — the previous map still keyed on Frontend/Backend and
// buildDomainsFromCatalog silently DROPPED every category it didn't know (Services /
// Networking / Automation roles never got domains built; the admin panel warned,
// nothing acted). This map is DISPLAY metadata only; membership comes from the DB —
// unknown categories are synthesized (see fallbackDomainMeta), never dropped.
const PALETTE_CATEGORY_TO_DOMAIN: Record<string, DomainMeta> = {
  'Services': { id: 'build', label: 'Build', description: 'Applications, services, APIs, and client-facing software', icon: '⚙️' },
  'Database': { id: 'data', label: 'Data & State', description: 'Databases, caches, search indexes, and storage', icon: '💾' },
  'Networking': { id: 'networking', label: 'Networking & Edge', description: 'Gateways, load balancers, CDNs, DNS, and network security', icon: '🌐' },
  'Messaging': { id: 'messaging', label: 'Messaging', description: 'Message brokers, event streams, and queues', icon: '📨' },
  'External': { id: 'external', label: 'External Systems', description: 'Third-party APIs, SaaS integrations, and partner services', icon: '🔗' },
  'Infrastructure': { id: 'deploy', label: 'Deploy & Runtime', description: 'Infrastructure, orchestration, containers, and runtime environments', icon: '🏗️' },
  'Automation': { id: 'automation', label: 'Automation', description: 'CI/CD pipelines, background workers, and scheduled tasks', icon: '⚡' },
  'Observability': { id: 'observability', label: 'Observe & Operate', description: 'Monitoring, logging, tracing, and alerting', icon: '📊' },
  'AI & ML': { id: 'ai-ml', label: 'AI & ML', description: 'AI services, LLM gateways, ML pipelines, and inference', icon: '🤖' },
  'Game Development': { id: 'game', label: 'Game & Simulation', description: 'Game engines, interactive simulations, and real-time rendering', icon: '🎮' },
  'Logical': { id: 'logical', label: 'Logical Structure', description: 'Bounded contexts, modules, software layers, and boundaries', icon: '📦' },
  'Platform': { id: 'platform', label: 'Platform', description: 'Managed platform containers and their built-in capabilities', icon: '☁️' },
  'Hardware': { id: 'hardware', label: 'Hardware & IoT', description: 'Sensors, actuators, microcontrollers, gateways, and robotic systems', icon: '🔌' },
  // Read-compat aliases: pre-v3 category names that may still appear in older data.
  'Frontend': { id: 'build', label: 'Build', description: 'Applications, services, APIs, and client-facing software', icon: '⚙️' },
  'Backend': { id: 'automation', label: 'Automation', description: 'CI/CD pipelines, background workers, and scheduled tasks', icon: '⚡' },
};

// A DB category with no display registration still gets a domain — a rename or a new
// category can shift how roles are LABELED, never whether they exist to the app.
function fallbackDomainMeta(category: string): DomainMeta {
  return {
    id: category.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    label: category,
    description: `${category} roles`,
    icon: '📦',
  };
}

export function getRegisteredDomainCategoryKeys(): string[] {
  return Object.keys(PALETTE_CATEGORY_TO_DOMAIN);
}

// N8.3′: the local TechAIContext shape (5 keys) had drifted from the server
// declaration (14 keys) — and configMode/treatmentOverride were declared in NEITHER
// while being read on both runtimes via casts. One declaration now: AiContext,
// inferred from AiContextSchema in @nodespec/core/catalog-schemas.
function asTechAIContext(raw: Record<string, unknown> | null): AiContext | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as AiContext;
}

function asPortTemplates(raw: unknown[]): PortTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is PortTemplate =>
      typeof p === 'object' && p !== null && 'name' in p && 'direction' in p
  );
}

function asSuggestedFiles(raw: unknown): SuggestedFile[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const filtered: SuggestedFile[] = [];
  for (const f of raw) {
    if (typeof f === 'object' && f !== null && 'path' in f && 'kind' in f) {
      filtered.push(f as SuggestedFile);
    }
  }
  return filtered.length > 0 ? filtered : undefined;
}

/** N8.4b-3 — client mirror of role-registry's `normalizeCommonConnections`. The column
 *  carries three shapes (bare id, `{targetRole, contractKind}`, `{id, reason}`); the core
 *  `NodeTypeDefinition.commonConnections` is `string[]`, so objects were flowing through
 *  a lying cast and printing as "[object Object]" wherever they were joined. */
export function formatCommonConnections(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: string[] = [];
  for (const cc of raw) {
    if (typeof cc === 'string') {
      if (cc) out.push(cc);
    } else if (typeof cc === 'object' && cc !== null) {
      const rec = cc as { id?: string; reason?: string; targetRole?: string; contractKind?: string };
      if (rec.id) out.push(rec.reason ? `${rec.id} (${rec.reason})` : rec.id);
      else if (rec.targetRole) out.push(rec.contractKind ? `${rec.targetRole} (via ${rec.contractKind})` : rec.targetRole);
    }
  }
  return out.length > 0 ? out : undefined;
}

function buildNodeType(
  legacyType: string,
  role: NodeRole,
  tech: TechnologyCatalogEntry | null,
): DomainNodeType {
  const techAi = asTechAIContext(tech?.aiContext ?? null);
  const aiContext: AIContext = {
    purpose: techAi?.purpose || role.description,
    typicalTech: techAi?.typicalTech || [],
    bestPractices: techAi?.bestPractices || [],
    antiPatterns: techAi?.antiPatterns || [],
    setupInstructions: techAi?.setupInstructions,
  };

  return {
    id: legacyType,
    label: tech?.name || role.label,
    domain: role.paletteCategory,
    description: techAi?.purpose || role.description,
    icon: role.iconName,
    color: tech?.brandColor || role.color,
    aiContext,
    defaultPorts: asPortTemplates(role.defaultPorts),
    suggestedContracts: (role.suggestedContracts as string[]) || [],
    commonConnections: formatCommonConnections(tech?.commonConnections),
    metadataSchema: tech?.metadataSchema as Record<string, MetadataFieldSchema> | undefined,
    suggestedFiles: asSuggestedFiles(tech?.suggestedFiles ?? null),
  };
}

// Exported for the N5.15 no-silent-drop pins.
export function buildDomainsFromCatalog(resolver: CatalogResolver): NodeTypeDomain[] {
  // M4: every role is indexed under its OWN id. The removed loop indexed roles under their
  // DOTTED legacy type wherever a mapping existed, which is why getNodeTypeById(roleId)
  // returned undefined for 91 of them — and why the inspector's third schema-precedence
  // source was unreachable for the most common node types (ONTOLOGY_AUDIT §4.3).
  const domainGroups = new Map<string, DomainNodeType[]>();

  for (const role of resolver.getAllRoles()) {
    if (role.isContainer) continue;
    if (role.deprecated) continue;

    const nodeType = buildNodeType(role.id, role, null);
    const category = role.paletteCategory;
    if (!domainGroups.has(category)) {
      domainGroups.set(category, []);
    }
    domainGroups.get(category)!.push(nodeType);
  }

  // Merge categories that map to the same domain id, and NEVER drop an unknown one.
  const domainsById = new Map<string, NodeTypeDomain>();
  for (const [category, nodeTypes] of domainGroups) {
    const meta = PALETTE_CATEGORY_TO_DOMAIN[category] ?? fallbackDomainMeta(category);
    const existing = domainsById.get(meta.id);
    if (existing) {
      existing.nodeTypes.push(...nodeTypes);
    } else {
      domainsById.set(meta.id, { ...meta, nodeTypes: [...nodeTypes] });
    }
  }

  const domains = [...domainsById.values()];
  for (const d of domains) {
    d.nodeTypes.sort((a, b) => a.label.localeCompare(b.label));
  }
  return domains;
}

function buildContainerTypesFromCatalog(resolver: CatalogResolver): ContainerTypeDefinition[] {
  const roles = resolver.getAllRoles();
  return roles
    .filter(r => r.isContainer && hasCanContainRules(r))
    .map(r => ({
      id: r.id,
      label: r.label,
      description: r.description,
      icon: r.iconName,
      layer: (r.containerLayer || 'logical') as ContainerTypeDefinition['layer'],
      containerStyle: (r.containerStyle || (r.containerLayer === 'logical' ? 'logical-boundary' : 'hosting')) as ContainerTypeDefinition['containerStyle'],
      canContain: r.canContain ?? [],
      // Core's static ContainerTypeDefinition shape — unrelated to the dropped
      // technology_catalog.default_metadata column; container defaults have never
      // come from the technology row.
      defaultMetadata: {},
      metadataSchema: (r.metadataSchema ?? {}) as ContainerTypeDefinition['metadataSchema'],
    }));
}

function buildRoleResolverFromCatalog(resolver: CatalogResolver): (roleId: string) => RoleInfo | null {
  return (roleId: string): RoleInfo | null => {
    const role = resolver.getRole(roleId);
    if (!role) return null;
    return {
      id: role.id,
      nature: role.nature,
      interfaceKind: role.interfaceKind,
      provider: role.provider,
      isContainer: role.isContainer,
      containerStyle: role.containerStyle,
      // M1b: derived from nature + containment rather than read from a column.
      treatmentMode: treatmentForRole({ nature: role.nature, is_container: role.isContainer }),
    };
  };
}

export class CatalogService {
  static async getResolver(): Promise<CatalogResolver> {
    if (cachedResolver) return cachedResolver;

    if (!loadPromise) {
      loadPromise = loadCatalog().then(resolver => {
        cachedResolver = resolver;
        loadPromise = null;

        const domains = buildDomainsFromCatalog(resolver);
        populateDomains(domains);

        const containerTypes = buildContainerTypesFromCatalog(resolver);
        populateContainerTypes(containerTypes);

        const roleResolver = buildRoleResolverFromCatalog(resolver);
        setRoleResolver(roleResolver);

        // N2.3: containment + placement consult the technology's treatment override
        // (boundary engines like n8n raise a leaf role to boundary — see core/ontology).
        setTechnologyTreatmentResolver((technologyId) => {
          const tech = resolver.getTechnology(technologyId);
          // N8.3′: typed via the unified AiContext — no more raw-record cast.
          return asTechAIContext(tech?.aiContext ?? null)?.treatmentOverride ?? null;
        });

        // N8.5″(d): the catalog seeds provider inference — a provider-stamped role
        // row is all a NEW provider family needs (static prefixes stay the floor;
        // union semantics keep existing inference identical).
        registerProviderFamilies(resolver.getAllRoles().map((r) => r.provider));

        populateRFVisualTypes(resolver);

        populateTechnologyVisuals(resolver);

        invalidateTemplateCache();

        // N8.5″(b): a load that skipped rows is DEGRADED, not ready — the detail
        // rides the existing error channel so the banner needs no new plumbing.
        const issues = resolver.getCatalogIssues?.() ?? [];
        if (issues.length > 0) {
          setLoadState('degraded',
            `${issues.length} catalog row(s) failed schema validation and were skipped — ` +
            `those entries are missing from the palette and packets. ${issues.slice(0, 3).join(' · ')}`);
        } else {
          setLoadState('ready');
        }
        return resolver;
      }).catch(err => {
        loadPromise = null;
        setLoadState('failed', err instanceof Error ? err.message : String(err));
        throw err;
      });
    }

    return loadPromise;
  }

  static invalidateCache(): void {
    cachedResolver = null;
    loadPromise = null;
  }

  // ── N9b-2: degraded-mode observability ──────────────────────────────────────────
  static getLoadState(): { state: CatalogLoadState; error: string | null } {
    return { state: loadState, error: loadError };
  }

  /** Subscribe to load-state changes; fires immediately with the current state.
   *  Returns the unsubscribe function. */
  static subscribeLoadState(cb: (state: CatalogLoadState, error: string | null) => void): () => void {
    loadStateListeners.add(cb);
    cb(loadState, loadError);
    return () => loadStateListeners.delete(cb);
  }

  /** Retry after a failed or degraded load (the banner's button). */
  static retryLoad(): Promise<CatalogResolver> {
    if (loadState === 'failed' || loadState === 'degraded') {
      CatalogService.invalidateCache();
      setLoadState('loading');
    }
    return CatalogService.getResolver();
  }

  /** N4.8: synchronous role lookup for render-path icon resolution. Accepts a canonical
   *  role id or a dotted legacy type (resolved via the catalog's legacy mappings).
   *  Null before the catalog loads — callers fall back to their own defaults. */
  static getRoleForNodeType(nodeType: string | undefined): NodeRole | null {
    if (!cachedResolver || !nodeType) return null;
    const direct = cachedResolver.getRole(nodeType);
    if (direct) return direct;
    const resolved = cachedResolver.resolveNodeType(nodeType);
    return resolved?.role ?? null;
  }

  static getSetupInstructions(technologyId: string | undefined): SetupInstruction[] {
    if (!cachedResolver || !technologyId) return [];
    const tech = cachedResolver.getTechnology(technologyId);
    if (!tech) return [];
    const ai = asTechAIContext(tech.aiContext);
    return ai?.setupInstructions ?? [];
  }

  static getCatalogListingParam(): CatalogListingParam | null {
    if (!cachedResolver) return null;
    const techs = cachedResolver.getAllTechnologies();
    const roles = cachedResolver.getAllRoles();
    const frameworks: CatalogListingParam['frameworks'] = [];
    const databases: CatalogListingParam['databases'] = [];
    const languageRoles: Record<string, string> = {};

    for (const tech of techs) {
      if (tech.isUserContributed) continue;
      const primaryRole = tech.roleAffinities[0];
      if (!primaryRole) continue;
      const role = cachedResolver.getRole(primaryRole);
      if (!role) continue;

      // M6: this branched on `category === 'frontend' || 'backend'` — categories that have
      // not existed since the v3 restructure, so `frameworks` was PERMANENTLY EMPTY and the
      // catalog-driven framework detection in file-classifier never fired (it fell back to
      // the hardcoded flask/django/fastapi names). Rekeyed onto what the data actually
      // carries: a framework is a technology whose primary role is an authored Services
      // role, and `ui`/`client-facing` in capability_tags is the existing frontend signal.
      const category = role.paletteCategory.toLowerCase();
      if (category === 'services' && (role.nature ?? 'build') === 'build') {
        const isUi = role.capabilityTags.includes('ui') || role.capabilityTags.includes('client-facing');
        frameworks.push({
          name: tech.name,
          techId: tech.id,
          roleId: primaryRole,
          type: isUi ? 'frontend' : 'backend',
        });
      } else if (category === 'database') {
        databases.push({ depName: tech.name.toLowerCase(), roleId: primaryRole });
      }
    }

    for (const role of roles) {
      if (role.deprecated) continue;
      if (role.nature === 'build' && role.interfaceKind) {
        languageRoles[role.interfaceKind] = role.id;
      }
    }

    return { frameworks, databases, languageRoles };
  }

  static getCatalogScoringHints(): CatalogScoringHints | null {
    if (!cachedResolver) return null;
    const techs = cachedResolver.getAllTechnologies();
    return buildCatalogScoringHints(techs);
  }
}
