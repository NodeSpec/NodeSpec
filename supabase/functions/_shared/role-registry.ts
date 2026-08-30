import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CatalogData, NodeRoleRow, TechnologyRow } from "./catalog-loader.ts";
import { effectiveTreatment, treatmentForRole } from "./ontology.ts";
import { PALETTE_CATEGORY_IDS, categoryLabel, resolveCategoryId } from "./palette-categories.ts";
// Real imports, not just the re-exports at the bottom of this file: a re-export
// alone does NOT bind the name in this module's own scope, and --no-check
// (jsr-403) means the ReferenceError only surfaces at runtime — 17 tests caught
// it. (Prose on purpose: an import-shaped example path in this comment sent a
// path-scanning tool looking for a file that does not exist.)
import { normalizeProviderFamily, inferProviderFromId as inferProviderPrefix } from "./provider-inference.ts";

export interface RoleDefinition {
  id: string;
  label: string;
  description: string;
  category: string;
  /** M7: was `kind`, read from a column M1c DROPPED — a Deno type error the client tsc run
   *  could not see, and a field no consumer ever read. Replaced with the axis that exists. */
  nature: string;
  isContainer: boolean;
  containerLayer: string | null;
  capabilityTags: string[];
  /** N1 ontology axis. boundary = engine that owns its internals; NodeSpec owns placement,
   *  wiring, and connection config only (never the engine's internal logic). */
  treatmentMode: 'leaf' | 'container' | 'boundary';
}

export interface TechnologyOption {
  id: string;
  name: string;
}

function toRoleDefinition(row: NodeRoleRow): RoleDefinition {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    category: row.palette_category,
    nature: row.nature ?? 'build',
    isContainer: row.is_container,
    containerLayer: row.container_layer,
    capabilityTags: row.capability_tags || [],
    treatmentMode: treatmentForRole({ nature: row.nature, is_container: row.is_container }),
  };
}

export function getRolesWithCapability(catalogs: CatalogData, capability: string): string[] {
  return Object.values(catalogs.nodeRoles)
    .filter(r => Array.isArray(r.capability_tags) && r.capability_tags.includes(capability))
    .map(r => r.id);
}

export function getRolesByCategory(catalogs: CatalogData, category: string): string[] {
  return Object.values(catalogs.nodeRoles)
    .filter(r => r.palette_category === category)
    .map(r => r.id);
}

export function getContainersByLayer(catalogs: CatalogData, layer: string): string[] {
  return Object.values(catalogs.nodeRoles)
    .filter(r => r.is_container && r.container_layer === layer)
    .map(r => r.id);
}

export function isContainerRole(catalogs: CatalogData, roleId: string): boolean {
  const row = catalogs.nodeRoles[roleId];
  return row?.is_container ?? false;
}

export function canContainerAcceptChild(
  catalogs: CatalogData,
  containerRoleId: string,
  childRoleId: string,
  childTechnologyId?: string,
  containerTechnologyId?: string,
): { allowed: boolean; reason?: string } {
  const containerRow = catalogs.nodeRoles[containerRoleId];
  const childRow0 = catalogs.nodeRoles[childRoleId];

  // N8.4b-1c — ONTOLOGY INVARIANT: PROVIDER COHERENCE (mirror of
  // core/src/container-types.ts::canContainerHoldNode). Cross-provider containment is
  // refused at any depth — an azure-* node cannot live inside an aws-* container, no
  // matter what the generic container role's can_contain array enumerates (vpc/subnet/
  // k8s-cluster have no provider awareness at all). Provider comes from the NODES'
  // technologies first, then the role's provider column. A platform never nests inside
  // another platform, same-provider included. Checked before the permissive
  // unknown-container fallback so no path — propose_patches included — can bypass it.
  const childProvider = normalizeProviderFamily((childTechnologyId && inferProviderPrefix(childTechnologyId)) || childRow0?.provider || null);
  const containerProvider = normalizeProviderFamily((containerTechnologyId && inferProviderPrefix(containerTechnologyId)) || containerRow?.provider || null);
  if (childProvider && containerProvider && childProvider !== containerProvider) {
    return {
      allowed: false,
      reason: `Cross-provider containment refused: a ${childProvider} component cannot live inside a ${containerProvider} container ("${containerRoleId}"). Place it under its own provider's platform.`,
    };
  }
  // N8.4g-3 (owner ruling, supersedes platform-in-platform): a platform is operated
  // by its VENDOR — nothing hosts it. Refused in every container except a purely
  // organizational logical group (N5.16). Mirror of core canContainerHoldNode.
  if (childRow0?.nature === 'host' && containerRow && containerRow.container_style !== 'logical-boundary') {
    return {
      allowed: false,
      reason: `"${childRoleId}" is a managed platform — it is operated by its vendor and cannot be hosted inside "${containerRoleId}". Place it at the top level.`,
    };
  }

  if (!containerRow) return { allowed: true };
  if (!containerRow.is_container) return { allowed: false, reason: `"${containerRoleId}" is not a container` };

  // N2.3 precedence — mirror of core/src/container-types.ts::canContainerHoldNode. An
  // effective-boundary child (role default, or raised by a boundary-engine technology's
  // ai_context.treatmentOverride) is an engine NodeSpec places — hand-enumerated
  // can_contain lists never veto it; placement inference decides scopes vs hosts.
  const childRow = catalogs.nodeRoles[childRoleId];
  const childTreatment = treatmentForRole({ nature: childRow?.nature, is_container: childRow?.is_container });
  if (childTreatment !== 'container') {
    const techRow = childTechnologyId ? catalogs.technologies[childTechnologyId] : undefined;
    const techOverride = (techRow?.ai_context as Record<string, unknown> | undefined)?.treatmentOverride as string | undefined;
    if (effectiveTreatment(childTreatment, techOverride) === 'boundary') return { allowed: true };
  }

  const canContain = containerRow.can_contain;

  // Legacy shape: enumerated role-id array.
  if (Array.isArray(canContain)) {
    if (canContain.length === 0) return { allowed: true };
    if (canContain.includes(childRoleId)) return { allowed: true };
    return {
      allowed: false,
      reason: `Container role "${containerRow.label}" (${containerRoleId}) does not accept "${childRoleId}" children. Allowed: ${canContain.slice(0, 10).join(', ')}${canContain.length > 10 ? '...' : ''}`,
    };
  }

  // Rule-object shape (aws/azure/gcp) — N8.1 mirror of core/src/container-types.ts::
  // canContainerHoldNode. Before this, the object shape fell through as allowed:true,
  // so platform containment was enforced on the canvas but NOT over propose_patches.
  // A child matches if it hits ANY populated allowlist.
  if (canContain && typeof canContain === 'object') {
    const rule = canContain;
    if (rule.roleIds?.length && rule.roleIds.includes(childRoleId)) return { allowed: true };
    if (childRow) {
      if (rule.natures?.length && childRow.nature && rule.natures.includes(childRow.nature)) return { allowed: true };
      if (rule.interfaceKinds?.length && childRow.interface_kind && rule.interfaceKinds.includes(childRow.interface_kind)) return { allowed: true };
      if (rule.providers?.length && childRow.provider && rule.providers.includes(normalizeProviderFamily(childRow.provider)!)) return { allowed: true };
    }
    if (rule.providers?.length) {
      const inferred = (childTechnologyId && inferProviderPrefix(childTechnologyId)) || inferProviderPrefix(childRoleId);
      if (inferred && rule.providers.includes(inferred)) return { allowed: true };
    }
    const ruleSummary = [
      rule.roleIds?.length ? `roles: ${rule.roleIds.slice(0, 10).join(', ')}` : null,
      rule.natures?.length ? `natures: ${rule.natures.join(', ')}` : null,
      rule.interfaceKinds?.length ? `interfaces: ${rule.interfaceKinds.join(', ')}` : null,
      rule.providers?.length ? `providers: ${rule.providers.join(', ')} (any technology carrying the provider prefix)` : null,
    ].filter(Boolean).join('; ');
    return {
      allowed: false,
      reason: `Container role "${containerRow.label}" (${containerRoleId}) does not accept "${childRoleId}" children. Accepts ${ruleSummary || 'nothing (no allowlists populated)'}`,
    };
  }

  return { allowed: true };
}

// M6: the copies this file's own comment flagged ("the N8(a) worksheet owns unifying the
// copies") are unified. Re-exported under their existing names so call sites are unchanged.
export { normalizeProviderFamily } from "./provider-inference.ts";
export { inferProviderFromId as inferProviderPrefix } from "./provider-inference.ts";

export function getContainerLayer(catalogs: CatalogData, roleId: string): string | null {
  const row = catalogs.nodeRoles[roleId];
  return row?.container_layer ?? null;
}

export function getRoleDefinition(catalogs: CatalogData, roleId: string): RoleDefinition | null {
  const row = catalogs.nodeRoles[roleId];
  return row ? toRoleDefinition(row) : null;
}

export function getTechnologiesForRole(catalogs: CatalogData, roleId: string): TechnologyOption[] {
  return Object.values(catalogs.technologies)
    .filter(t => Array.isArray(t.role_affinities) && t.role_affinities.includes(roleId))
    .map(t => ({ id: t.id, name: t.name }));
}

export function getValidRoleIds(catalogs: CatalogData): string[] {
  return Object.keys(catalogs.nodeRoles);
}

export function getValidNodeTypes(catalogs: CatalogData): string[] {
  return getValidRoleIds(catalogs);
}

export function isValidRoleId(catalogs: CatalogData, roleId: string): boolean {
  return roleId in catalogs.nodeRoles;
}

export function isValidNodeType(catalogs: CatalogData, type: string): boolean {
  return isValidRoleId(catalogs, type);
}

export function isValidTechnologyId(catalogs: CatalogData, technologyId: string, roleId?: string): boolean {
  if (roleId) {
    const tech = catalogs.technologies[technologyId];
    if (tech && Array.isArray(tech.role_affinities) && tech.role_affinities.includes(roleId)) {
      return true;
    }
    return !tech ? false : technologyId in catalogs.technologies;
  }
  return technologyId in catalogs.technologies;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function findClosestRoleId(catalogs: CatalogData, target: string): { roleId: string; distance: number } | null {
  let closest: { roleId: string; distance: number } | null = null;
  const lower = target.toLowerCase();

  for (const roleId of Object.keys(catalogs.nodeRoles)) {
    const distance = levenshteinDistance(lower, roleId);
    if (!closest || distance < closest.distance) {
      closest = { roleId, distance };
    }
  }

  return closest;
}

export function validateAndCorrectNodeType(
  catalogs: CatalogData,
  nodeType: string
): { type: string; corrected: boolean; blanket?: boolean; error?: string; technologyHint?: string; deploymentTargetHint?: string } {
  if (isValidRoleId(catalogs, nodeType)) {
    return { type: nodeType, corrected: false };
  }

  // M4: dotted input is AI-INPUT TOLERANCE, not backward compatibility — the app has
  // emitted role ids since N9a and legacy_type_mappings is gone. An AI that proposes
  // "backend.nodejs" gets its last segment run through the same Levenshtein correction as
  // any other unknown token, rather than a table lookup.
  const candidate = nodeType.includes('.') ? nodeType.split('.').pop()! : nodeType;
  if (candidate !== nodeType && isValidRoleId(catalogs, candidate)) {
    return {
      type: candidate,
      corrected: true,
      error: `Auto-corrected dotted type "${nodeType}" to role "${candidate}"`,
    };
  }

  const closest = findClosestRoleId(catalogs, candidate);
  if (closest && closest.distance <= 3) {
    return {
      type: closest.roleId,
      corrected: true,
      error: `Auto-corrected "${nodeType}" to "${closest.roleId}"`,
    };
  }

  // N8.5″(c): the last resort is now MACHINE-DETECTABLE (`blanket: true`) — consumers
  // decide what to do with a lie-shaped answer instead of sniffing the error string.
  // The normalization lane (catalog-node-normalization.ts) REFUSES it and derives a
  // technology-driven role with a reported note; only the D-doomed tool-executor lane
  // still accepts it, and it dies with the D-series.
  return {
    type: 'backend-service',
    corrected: true,
    blanket: true,
    error: `Unknown node type "${nodeType}" - using fallback "backend-service"`,
  };
}

function findClosestTechnologyId(
  catalogs: CatalogData,
  target: string,
  scope?: TechnologyOption[]
): { techId: string; distance: number } | null {
  const candidates = scope ?? Object.values(catalogs.technologies).map(t => ({ id: t.id, name: t.name }));
  let closest: { techId: string; distance: number } | null = null;
  const lower = target.toLowerCase();

  for (const tech of candidates) {
    const distance = levenshteinDistance(lower, tech.id.toLowerCase());
    if (!closest || distance < closest.distance) {
      closest = { techId: tech.id, distance };
    }
  }

  return closest;
}

export function isContainerTechnologyMismatch(
  catalogs: CatalogData,
  technologyId: string,
  roleId: string,
): { mismatch: boolean; reason?: string; suggestion?: string } {
  const role = catalogs.nodeRoles[roleId];
  if (!role || !role.is_container) return { mismatch: false };
  if (role.container_layer !== 'infrastructure' && role.container_layer !== 'orchestration') return { mismatch: false };

  const tech = catalogs.technologies[technologyId];
  if (!tech) return { mismatch: false };

  const hasAffinity = Array.isArray(tech.role_affinities) && tech.role_affinities.includes(roleId);
  if (hasAffinity) return { mismatch: false };

  const containerRoleIds = Object.values(catalogs.nodeRoles)
    .filter(r => r.is_container && (r.container_layer === 'infrastructure' || r.container_layer === 'orchestration'))
    .map(r => r.id);
  const hasAnyContainerAffinity = Array.isArray(tech.role_affinities) &&
    tech.role_affinities.some(aff => containerRoleIds.includes(aff));
  if (hasAnyContainerAffinity) return { mismatch: false };

  const validTechs = getTechnologiesForRole(catalogs, roleId);
  const suggestion = validTechs.length > 0
    ? `Valid technologies for ${roleId}: ${validTechs.map(t => t.id).join(', ')}`
    : `No specific technologies cataloged for ${roleId}; omit technology or use a cloud provider identifier (aws, azure, gcp)`;

  return {
    mismatch: true,
    reason: `Technology "${technologyId}" is a leaf-service technology (affinities: ${tech.role_affinities.join(', ')}), not valid for infrastructure container role "${roleId}"`,
    suggestion,
  };
}

export function validateTechnology(
  catalogs: CatalogData,
  technologyId: string,
  roleId: string
): { technology: string; corrected: boolean; warning?: string } {
  if (isValidTechnologyId(catalogs, technologyId, roleId)) {
    return { technology: technologyId, corrected: false };
  }

  if (isValidTechnologyId(catalogs, technologyId)) {
    return {
      technology: technologyId,
      corrected: false,
      warning: `Technology "${technologyId}" is not typical for role "${roleId}" but is valid`,
    };
  }

  const roleTechs = getTechnologiesForRole(catalogs, roleId);
  if (roleTechs.length > 0) {
    const roleMatch = findClosestTechnologyId(catalogs, technologyId, roleTechs);
    if (roleMatch && roleMatch.distance <= 3) {
      return {
        technology: roleMatch.techId,
        corrected: true,
        warning: `Auto-corrected technology "${technologyId}" to "${roleMatch.techId}" for role "${roleId}"`,
      };
    }
  }

  const globalMatch = findClosestTechnologyId(catalogs, technologyId);
  if (globalMatch && globalMatch.distance <= 3) {
    return {
      technology: globalMatch.techId,
      corrected: true,
      warning: `Auto-corrected technology "${technologyId}" to "${globalMatch.techId}" (global match)`,
    };
  }

  return { technology: technologyId, corrected: false };
}

function containerTag(row: NodeRoleRow): string {
  if (!row.is_container) return '';
  if (row.container_style === 'logical-boundary') return '[LOGICAL BOUNDARY]';
  return '[HOSTING CONTAINER]';
}

// M2: keyed on the stored palette_category ID, not the resolved LABEL. Keyed on the label
// these silently never fired for Infrastructure (label "Deploy & Runtime") or Platform
// (label "Platforms"). Worse, the old Infrastructure hint described NETWORKING — "use cdn…
// api-gateway… load-balancer" — which the v3 restructure moved into its own category, so
// repairing the key without rewriting the text would have taught the AI a layout two
// restructures stale. Both are rewritten here; the dead `Process` hint is gone.
const CATEGORY_PROMPT_HINTS: Record<string, string> = {
  'Networking': 'Traffic routing, edge and network security: api-gateway for request routing and auth verification, load-balancer for distribution, cdn for static assets, dns, waf, auth-provider, secret-manager. These do NOT run your application code — they sit in front of or beside the services that do.',
  'Infrastructure': 'Deployment containers only — the things that HOLD workloads: VPCs, subnets, Kubernetes clusters and namespaces, Docker containers/compose/swarm, ECS clusters, VMs. Not networking, not automation.',
  'Automation': 'Triggered and scheduled pipelines: CI/CD, infrastructure-as-code workflows, scheduled triggers. These run code but are started by an event or a schedule, never by a user request.',
  'Platform': 'Cloud provider accounts and managed platforms (AWS, Azure, Google Cloud, Cloudflare, Supabase, Vercel, Netlify, Railway, Render, Fly.io). They are CONTAINERS: drop a provider-branded technology and it nests inside its platform automatically. A platform is operated by its vendor — nothing hosts it.',
  'Hardware': 'Physical devices: sensors, actuators, microcontrollers, embedded devices, robots, gateways. Use for IoT, robotics, and embedded systems.',
  'AI & ML': 'Model serving and ML workloads: inference-service for endpoints, ai-agent-service for agent loops, ml-pipeline for training/evaluation/data-prep jobs, plus feature and model stores. Distinct from backend-service — these specifically serve or manage machine-learning workloads.',
  'Logical': 'Organizational boundaries with no runtime: bounded contexts, modules, software layers. Optional — grouping never hosts anything. Use a hosting container when something actually runs there.',
};

const ROLE_PROMPT_HINTS: Record<string, string> = {
  'cdn': '[INFRASTRUCTURE] Content delivery network. Caches and serves static assets at the edge. NOT a backend-service.',
  'api-gateway': '[INFRASTRUCTURE] Request routing, rate limiting, auth verification. Sits in front of backend services. NOT a backend-service itself.',
  'load-balancer': '[INFRASTRUCTURE] Distributes traffic across service instances. NOT a backend-service.',
  'dns-resolver': '[INFRASTRUCTURE] DNS resolution. Maps domain names to IPs.',
  'firewall': '[INFRASTRUCTURE] Network security boundary. Filters traffic by rules.',
};

// M2: ordering and labels come from the shared vocabulary module, keyed on the SAME value
// roles store. The `palette_categories` table, its separate row-id space and the
// agent_alias hop are all gone — that hop is what silently matched zero roles.
function getCategoryDisplayOrder(): string[] {
  return [...PALETTE_CATEGORY_IDS];
}

export function getAllNodeTypesForPrompt(catalogs: CatalogData): string {
  return getFilteredNodeTypesForPrompt(catalogs);
}

export interface ProjectRelevanceFilter {
  archetypes?: string[];
  existingRoleIds?: string[];
  preferredCategories?: string[];
}

export function getFilteredNodeTypesForPrompt(
  catalogs: CatalogData,
  filter?: ProjectRelevanceFilter,
): string {
  const byCategory: Record<string, NodeRoleRow[]> = {};

  const relevantRoleIds = filter ? computeRelevantRoles(catalogs, filter) : null;

  for (const row of Object.values(catalogs.nodeRoles)) {
    if (relevantRoleIds && !relevantRoleIds.has(row.id)) continue;
    if (!byCategory[row.palette_category]) byCategory[row.palette_category] = [];
    byCategory[row.palette_category].push(row);
  }

  const displayOrder = getCategoryDisplayOrder();
  const knownSet = new Set(displayOrder);
  const extraCategories = Object.keys(byCategory).filter(c => !knownSet.has(c)).sort();
  const orderedCategories = [...displayOrder, ...extraCategories];

  const lines: string[] = [];

  for (const cat of orderedCategories) {
    const rows = byCategory[cat];
    if (!rows || rows.length === 0) continue;

    rows.sort((a, b) => a.sort_order - b.sort_order);

    const catLabel = categoryLabel(cat);
    const catHint = CATEGORY_PROMPT_HINTS[catLabel];
    lines.push(`\n## ${catLabel}`);
    if (catHint) {
      lines.push(`> ${catHint}`);
    }

    for (const row of rows) {
      const techs = getTechnologiesForRole(catalogs, row.id);
      let line = `- ${row.id}: ${row.description}`;
      if (techs.length > 0) {
        line += `\n  Technologies: ${techs.map(t => t.id).join(', ')}`;
      }
      if (row.is_container) {
        line += `\n  ${containerTag(row)} - can hold child nodes`;
      }
      // M7: was keyed on 'component-library', a role M3 DELETED (deprecated=true), so the
      // library annotation stopped reaching the AI entirely. The surviving role is
      // `shared-library`; the note is what tells the model an edge INTO this node means
      // consuming its exports rather than calling a service.
      if (row.id === 'shared-library') {
        line += `\n  [LIBRARY - code-producing node. Edges TO this node = consumption of its exports. Has export surface with functions, classes, types.]`;
      }
      const roleHint = ROLE_PROMPT_HINTS[row.id];
      if (roleHint) {
        line += `\n  ${roleHint}`;
      }
      lines.push(line);
    }
  }

  return lines.join('\n');
}

export function getCatalogSummaryForPrompt(
  catalogs: CatalogData,
  filter?: ProjectRelevanceFilter,
  inContextTechIds?: Set<string>,
): string {
  const byCategory: Record<string, NodeRoleRow[]> = {};
  const relevantRoleIds = filter ? computeRelevantRoles(catalogs, filter) : null;

  for (const row of Object.values(catalogs.nodeRoles)) {
    if (relevantRoleIds && !relevantRoleIds.has(row.id)) continue;
    if (!byCategory[row.palette_category]) byCategory[row.palette_category] = [];
    byCategory[row.palette_category].push(row);
  }

  const displayOrder = getCategoryDisplayOrder();
  const knownSet = new Set(displayOrder);
  const extraCategories = Object.keys(byCategory).filter(c => !knownSet.has(c)).sort();
  const orderedCategories = [...displayOrder, ...extraCategories];

  const lines: string[] = [];

  for (const cat of orderedCategories) {
    const rows = byCategory[cat];
    if (!rows || rows.length === 0) continue;
    const roleIds = rows.map(r => r.id);
    const catTechIds = new Set(
      rows.flatMap(r =>
        Object.values(catalogs.technologies)
          .filter(t => Array.isArray(t.role_affinities) && t.role_affinities.some(a => roleIds.includes(a)))
          .map(t => t.id)
      )
    );
    const roleIdList = roleIds.join(', ');
    const catLabel = categoryLabel(cat);
    const catHint = CATEGORY_PROMPT_HINTS[catLabel];
    const hintSuffix = catHint ? ` -- ${catHint}` : '';

    if (inContextTechIds && inContextTechIds.size > 0) {
      const inCtx = [...catTechIds].filter(id => inContextTechIds.has(id));
      const remaining = catTechIds.size - inCtx.length;
      if (inCtx.length > 0) {
        const inCtxStr = inCtx.join(', ');
        const moreStr = remaining > 0 ? `; ${remaining} more via lookup_catalog` : '';
        lines.push(`- ${catLabel}: ${roleIdList} (${inCtxStr} already in context${moreStr})${hintSuffix}`);
      } else {
        lines.push(`- ${catLabel}: ${roleIdList} (${catTechIds.size} technologies -- use lookup_catalog or search_catalog for details)${hintSuffix}`);
      }
    } else {
      lines.push(`- ${catLabel}: ${roleIdList} (${catTechIds.size} technologies -- use lookup_catalog or search_catalog for details)${hintSuffix}`);
    }
  }

  return lines.join('\n');
}

export interface CatalogLookupParams {
  category?: string;
  roleId?: string;
  technologyId?: string;
}

export function lookupCatalog(
  catalogs: CatalogData,
  params: CatalogLookupParams,
  filter?: ProjectRelevanceFilter,
): string {
  const relevantRoleIds = filter ? computeRelevantRoles(catalogs, filter) : null;

  if (params.technologyId) {
    return lookupTechnology(catalogs, params.technologyId);
  }

  if (params.roleId) {
    return lookupRole(catalogs, params.roleId, relevantRoleIds);
  }

  if (params.category) {
    return lookupCategory(catalogs, params.category, relevantRoleIds);
  }

  return 'Provide at least one of: category, roleId, or technologyId.';
}

function lookupTechnology(catalogs: CatalogData, technologyId: string): string {
  const tech = catalogs.technologies[technologyId.toLowerCase()];
  if (!tech) {
    const candidates = Object.values(catalogs.technologies)
      .filter(t => t.name.toLowerCase() === technologyId.toLowerCase() || t.id.includes(technologyId.toLowerCase()))
      .slice(0, 5);
    if (candidates.length === 0) return `No technology found matching "${technologyId}".`;
    return `No exact match for "${technologyId}". Did you mean: ${candidates.map(c => c.id).join(', ')}?`;
  }

  const lines: string[] = [`## ${tech.name} (${tech.id})`];
  lines.push(`Roles: ${tech.role_affinities.join(', ')}`);

  if (tech.ai_context) {
    const ctx = tech.ai_context;
    // N10(d): lifecycle steering FIRST — a lookup of a migrated/retired row must name
    // its status before any content invites recommending it.
    const lifecycleCtx = ctx as Record<string, unknown>;
    if (typeof lifecycleCtx.migrationTarget === 'string' && lifecycleCtx.migrationTarget) {
      lines.push(`Catalog status: MIGRATED — superseded by ${lifecycleCtx.migrationTarget}. Recommend the successor for new work.`);
    } else if (lifecycleCtx.lifecycle === 'retired') {
      lines.push('Catalog status: RETIRED — no named successor. Do not recommend for new work.');
    }
    if (ctx.purpose) lines.push(`Purpose: ${ctx.purpose}`);
    // N10(d): the docs pointer is the currency mechanism — render it wherever the row
    // renders. For externals the live docs win over the curated snapshot.
    if (ctx.apiReference?.docsUrl) {
      lines.push((ctx as Record<string, unknown>).configMode === 'external'
        ? `Docs: ${ctx.apiReference.docsUrl} (third-party service — the live docs win over curated guidance)`
        : `Docs: ${ctx.apiReference.docsUrl}`);
    }
    if (typeof (ctx as Record<string, unknown>).configMode === 'string') {
      lines.push(`Config mode: ${(ctx as Record<string, unknown>).configMode}`);
    }
    // N8.1b: the catalog carries the service's API reference; per-node selections
    // (config.apiAreas) decide which areas render in that node's task packet.
    if (ctx.apiReference?.areas && Object.keys(ctx.apiReference.areas).length > 0) {
      lines.push(`API reference areas (curated; select per node in the inspector — selected areas render in the task packet): ${Object.keys(ctx.apiReference.areas).join(', ')}`);
    }
    // N8.1c: the trust signal — when and how this row's curated content was verified.
    if (ctx.provenance?.verifiedAt) {
      lines.push(`Reference verified: ${ctx.provenance.verifiedAt} (${ctx.provenance.method ?? 'unrecorded'})`);
    }
    // N8.4g: dated deprecation/license/ownership facts render WITH the technology.
    if (ctx.freshnessNote) {
      lines.push(`Freshness: ${ctx.freshnessNote}`);
    }
    if (ctx.sdkInitPattern) {
      lines.push(`SDK Init: ${ctx.sdkInitPattern}${CODE_TEMPLATE_SUFFIX}`);
    }
    if (ctx.commonApiPatterns && ctx.commonApiPatterns.length > 0) {
      lines.push(`Common Patterns:`);
      for (const p of ctx.commonApiPatterns) {
        lines.push(`  - ${p.name}: ${p.codeTemplate}${CODE_TEMPLATE_SUFFIX}${p.description ? ` -- ${p.description}` : ''}`);
      }
    }
    if (ctx.configurationTemplate) {
      lines.push(`Config: ${ctx.configurationTemplate}${CODE_TEMPLATE_SUFFIX}`);
    }
    if (ctx.bestPractices && ctx.bestPractices.length > 0) {
      lines.push(`Best practices: ${ctx.bestPractices.join('; ')}`);
    }
    if (ctx.securityGuidance) {
      lines.push(`Security: ${ctx.securityGuidance}`);
    }
    if (ctx.integrationPatterns && ctx.integrationPatterns.length > 0) {
      lines.push(`Integrations: ${ctx.integrationPatterns.join('; ')}`);
    }
    if (ctx.antiPatterns && ctx.antiPatterns.length > 0) {
      lines.push(`Avoid: ${ctx.antiPatterns.join('; ')}`);
    }
  }

  if (Array.isArray(tech.suggested_files) && tech.suggested_files.length > 0) {
    lines.push(`Suggested files:`);
    for (const sf of tech.suggested_files) {
      lines.push(`  - ${sf.path} (${sf.kind})`);
    }
  }

  const lookupConnections = normalizeCommonConnections(tech.common_connections);
  if (lookupConnections.length > 0) {
    lines.push(`Common connections:`);
    for (const cc of lookupConnections) {
      lines.push(`  - -> ${formatCommonConnection(cc)}`);
    }
  }

  return lines.join('\n');
}

function lookupRole(catalogs: CatalogData, roleId: string, relevantRoleIds: Set<string> | null): string {
  const lower = roleId.toLowerCase();
  const role = catalogs.nodeRoles[lower];
  if (!role) {
    const candidates = Object.keys(catalogs.nodeRoles)
      .filter(id => id.includes(lower))
      .slice(0, 5);
    if (candidates.length === 0) return `No role found matching "${roleId}".`;
    return `No exact match for "${roleId}". Did you mean: ${candidates.join(', ')}?`;
  }

  if (relevantRoleIds && !relevantRoleIds.has(role.id)) {
    return `Role "${role.id}" exists but is outside the current project relevance filter.`;
  }

  const lines: string[] = [`## ${role.label} (${role.id})`];
  lines.push(`Category: ${categoryLabel(role.palette_category)}`);
  lines.push(`Description: ${role.description}`);
  if (role.is_container) {
    const styleLabel = role.container_style === 'logical-boundary'
      ? 'visual grouping only -- no runtime or deployment semantics'
      : 'deployment container -- represents where code actually runs';
    lines.push(`${containerTag(role)} - layer: ${role.container_layer || 'unspecified'} (${styleLabel})`);
    // N8.1: can_contain has two shapes — the array `.length` check silently printed
    // NOTHING for exactly the rule-object platform containers (aws/azure/gcp).
    if (Array.isArray(role.can_contain) && role.can_contain.length > 0) {
      lines.push(`Can contain: ${role.can_contain.join(', ')}`);
    } else if (role.can_contain && !Array.isArray(role.can_contain)) {
      const rule = role.can_contain;
      const parts = [
        rule.roleIds?.length ? `roles: ${rule.roleIds.join(', ')}` : null,
        rule.natures?.length ? `natures: ${rule.natures.join(', ')}` : null,
        rule.interfaceKinds?.length ? `interfaces: ${rule.interfaceKinds.join(', ')}` : null,
        rule.providers?.length ? `providers: ${rule.providers.join(', ')} (any ${rule.providers.map(p => `${p}-*`).join('/')} technology)` : null,
      ].filter(Boolean);
      if (parts.length > 0) lines.push(`Can contain: ${parts.join('; ')}`);
    }
  }
  if (role.capability_tags && role.capability_tags.length > 0) {
    lines.push(`Capabilities: ${role.capability_tags.join(', ')}`);
  }

  const techs = Object.values(catalogs.technologies)
    .filter(t => Array.isArray(t.role_affinities) && t.role_affinities.includes(role.id));

  if (techs.length > 0) {
    lines.push(`\nTechnologies (${techs.length}):`);
    for (const t of techs) {
      let techLine = `- ${t.id}: ${t.name}`;
      if (t.ai_context?.purpose) techLine += ` -- ${t.ai_context.purpose}`;
      lines.push(techLine);
    }
  }

  if (role.suggested_contracts && role.suggested_contracts.length > 0) {
    lines.push(`\nSuggested contracts:`);
    for (const sc of role.suggested_contracts) {
      lines.push(`  - ${sc.name} (${sc.kind})`);
    }
  }

  return lines.join('\n');
}

function lookupCategory(catalogs: CatalogData, category: string, relevantRoleIds: Set<string> | null): string {
  // M2: resolves the id or the label, case-insensitively, against the one vocabulary.
  // Previously this matched against palette_categories rows whose ids were pre-v3, so
  // `services`, `networking`, `automation` and `hardware` all returned "No category found".
  const displayKey = resolveCategoryId(category);
  if (!displayKey) return `No category found matching "${category}".`;

  const rows = Object.values(catalogs.nodeRoles)
    .filter(r => r.palette_category === displayKey && (!relevantRoleIds || relevantRoleIds.has(r.id)))
    .sort((a, b) => a.sort_order - b.sort_order);

  if (rows.length === 0) return `Category "${category}" has no roles matching current project filter.`;

  const lines: string[] = [`## ${categoryLabel(displayKey)}`];
  for (const row of rows) {
    const techs = Object.values(catalogs.technologies)
      .filter(t => Array.isArray(t.role_affinities) && t.role_affinities.includes(row.id));
    let line = `- ${row.id}: ${row.description}`;
    if (techs.length > 0) line += `\n  Technologies: ${techs.map(t => t.id).join(', ')}`;
    if (row.is_container) line += `\n  ${containerTag(row)}`;
    if (row.capability_tags && row.capability_tags.length > 0) {
      line += `\n  Capabilities: ${row.capability_tags.join(', ')}`;
    }
    lines.push(line);
  }

  const categoryTags = new Set<string>();
  for (const row of rows) {
    if (row.capability_tags) {
      for (const tag of row.capability_tags) categoryTags.add(tag);
    }
  }
  const categoryRoleIds = new Set(rows.map(r => r.id));

  if (categoryTags.size > 0) {
    const related = Object.values(catalogs.nodeRoles)
      .filter(r =>
        !categoryRoleIds.has(r.id) &&
        r.palette_category !== displayKey &&
        (!relevantRoleIds || relevantRoleIds.has(r.id)) &&
        r.capability_tags &&
        r.capability_tags.some(tag => categoryTags.has(tag))
      )
      .slice(0, 6);

    if (related.length > 0) {
      lines.push(`\nRelated roles in other categories:`);
      for (const r of related) {
        lines.push(`- ${r.id} (${categoryLabel(r.palette_category)}): ${r.description}`);
      }
    }
  }

  return lines.join('\n');
}

export function lookupCatalogCategory(
  catalogs: CatalogData,
  categoryOrRole: string,
  filter?: ProjectRelevanceFilter,
): string {
  const lower = categoryOrRole.toLowerCase();

  if (catalogs.nodeRoles[lower]) {
    return lookupCatalog(catalogs, { roleId: lower }, filter);
  }

  return lookupCatalog(catalogs, { category: lower }, filter);
}

function getArchetypeRelevantCategories(catalogs: CatalogData, archetype: string): string[] {
  const arch = catalogs.scopeArchetypes[archetype];
  return arch ? arch.relevant_categories : [];
}

// M2: archetypes now store the palette_category value directly (migration 20260731160000
// repointed them), so this is an identity check that keeps an unknown token from silently
// matching everything. The alias indirection it replaces is the zero-Services-roles bug.
function resolveAliasToDisplayKey(alias: string): string {
  return resolveCategoryId(alias) ?? alias;
}

function computeRelevantRoles(catalogs: CatalogData, filter: ProjectRelevanceFilter): Set<string> {
  const relevant = new Set<string>();

  if (filter.existingRoleIds) {
    for (const id of filter.existingRoleIds) relevant.add(id);
  }

  const relevantDisplayKeys = new Set<string>();

  if (filter.archetypes && filter.archetypes.length > 0) {
    for (const arch of filter.archetypes) {
      const aliases = getArchetypeRelevantCategories(catalogs, arch);
      for (const alias of aliases) {
        relevantDisplayKeys.add(resolveAliasToDisplayKey(alias));
      }
    }
  }

  if (filter.preferredCategories) {
    for (const c of filter.preferredCategories) {
      relevantDisplayKeys.add(resolveAliasToDisplayKey(c));
    }
  }

  relevantDisplayKeys.add('Infrastructure');
  relevantDisplayKeys.add('Logical');

  for (const row of Object.values(catalogs.nodeRoles)) {
    if (relevantDisplayKeys.size === 0 || relevantDisplayKeys.has(row.palette_category)) {
      relevant.add(row.id);
    }
  }

  return relevant;
}

export interface InScopeTechPreferences {
  languages?: string[];
  frameworks?: string[];
  databases?: string[];
}

export interface GraphNodeMinimal {
  technology?: string;
}

export function collectInScopeTechnologies(
  catalogs: CatalogData,
  preferences: InScopeTechPreferences | null | undefined,
  graphNodes: Record<string, GraphNodeMinimal>,
): string[] {
  const ids = new Set<string>();

  if (preferences) {
    const candidates = [
      ...(preferences.languages || []),
      ...(preferences.frameworks || []),
      ...(preferences.databases || []),
    ];
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase().replace(/\s+/g, '-');
      if (catalogs.technologies[lower]) {
        ids.add(lower);
      } else if (catalogs.technologies[candidate]) {
        ids.add(candidate);
      } else {
        for (const tech of Object.values(catalogs.technologies)) {
          if (tech.name.toLowerCase() === candidate.toLowerCase() ||
              tech.id.toLowerCase() === lower) {
            ids.add(tech.id);
            break;
          }
        }
      }
    }
  }

  for (const node of Object.values(graphNodes)) {
    if (node.technology && catalogs.technologies[node.technology]) {
      ids.add(node.technology);
    }
  }

  return [...ids];
}

const TECH_GUIDANCE_CHAR_CAP = 10_000;

const CODE_TEMPLATE_SUFFIX = ' [Tailor to project language and apply best practices for engineering and security if different from this example]';

function buildTechSection(tech: TechnologyRow): string {
  if (tech.is_user_contributed) {
    return `### ${tech.name} (${tech.id}) [user-specified]\nThis is a user-specified technology without curated best practices. Apply general software engineering principles for ${tech.name} and note any assumptions.`;
  }

  if (!tech.ai_context) return '';

  const ctx = tech.ai_context;
  const hasContent = ctx.purpose || (ctx.bestPractices && ctx.bestPractices.length > 0) ||
                     (ctx.antiPatterns && ctx.antiPatterns.length > 0) ||
                     ctx.sdkInitPattern || ctx.configurationTemplate ||
                     (ctx.commonApiPatterns && ctx.commonApiPatterns.length > 0) ||
                     ctx.securityGuidance || ctx.freshnessNote ||
                     (ctx.integrationPatterns && ctx.integrationPatterns.length > 0);
  if (!hasContent) return '';

  const parts: string[] = [`### ${tech.name} (${tech.id})`];
  if (ctx.purpose) parts.push(`Purpose: ${ctx.purpose}`);
  if (ctx.sdkInitPattern) {
    parts.push(`SDK Init: ${ctx.sdkInitPattern}${CODE_TEMPLATE_SUFFIX}`);
  }
  if (ctx.commonApiPatterns && ctx.commonApiPatterns.length > 0) {
    const patterns = ctx.commonApiPatterns.map(p =>
      `${p.name}: ${p.codeTemplate}${CODE_TEMPLATE_SUFFIX}${p.description ? ` -- ${p.description}` : ''}`
    );
    parts.push(`Common Patterns:\n${patterns.join('\n')}`);
  }
  if (ctx.configurationTemplate) {
    parts.push(`Config: ${ctx.configurationTemplate}${CODE_TEMPLATE_SUFFIX}`);
  }
  if (ctx.bestPractices && ctx.bestPractices.length > 0) {
    parts.push(`Best practices: ${ctx.bestPractices.join('; ')}`);
  }
  if (ctx.securityGuidance) {
    parts.push(`Security: ${ctx.securityGuidance}`);
  }
  if (ctx.freshnessNote) {
    parts.push(`Freshness: ${ctx.freshnessNote}`);
  }
  if (ctx.integrationPatterns && ctx.integrationPatterns.length > 0) {
    parts.push(`Integrations: ${ctx.integrationPatterns.join('; ')}`);
  }
  if (ctx.antiPatterns && ctx.antiPatterns.length > 0) {
    parts.push(`Avoid: ${ctx.antiPatterns.join('; ')}`);
  }
  const guidanceConnections = normalizeCommonConnections(tech.common_connections);
  if (guidanceConnections.length > 0) {
    parts.push(`Typical connections: ${guidanceConnections.map(formatCommonConnection).join(', ')}`);
  }
  return parts.join('\n');
}

export function buildTechnologyGuidance(
  catalogs: CatalogData,
  inScopeTechIds: string[],
  graphNodeTechIds?: Set<string>,
): string {
  if (inScopeTechIds.length === 0) return '';

  const sections: string[] = [];

  for (const techId of inScopeTechIds) {
    const tech = catalogs.technologies[techId];
    if (!tech) continue;
    const section = buildTechSection(tech);
    if (section) sections.push(section);
  }

  if (sections.length === 0) return '';

  let result = `\nTECHNOLOGY GUIDANCE (for this project's stack):\n${sections.join('\n\n')}`;

  if (result.length > TECH_GUIDANCE_CHAR_CAP && graphNodeTechIds && graphNodeTechIds.size > 0) {
    const prioritySections: string[] = [];
    for (const techId of graphNodeTechIds) {
      const tech = catalogs.technologies[techId];
      if (!tech) continue;
      const section = buildTechSection(tech);
      if (section) prioritySections.push(section);
    }
    if (prioritySections.length > 0) {
      const trimmedCount = inScopeTechIds.length - graphNodeTechIds.size;
      const suffix = trimmedCount > 0
        ? `\n\n(${trimmedCount} additional technologies from spec preferences omitted -- use lookup_catalog for details)`
        : '';
      result = `\nTECHNOLOGY GUIDANCE (for technologies assigned to graph nodes):\n${prioritySections.join('\n\n')}${suffix}`;
    }
  }

  return result;
}

export interface TechnologyHints {
  suggested_files: Array<{ path: string; kind: string }>;
  /** Normalized — see normalizeCommonConnections. */
  common_connections: Array<{ id: string; reason?: string }>;
}

/** N8.4b-3: `common_connections` carries three shapes across the live catalog (see the
 *  type in catalog-loader.ts). Every reader collapses them here, so the `{id, reason}`
 *  rows — 75 of them, the plurality — stop rendering as "undefined via undefined" in
 *  lookup_catalog, add_node hints and the technology-relevance block. */
export function normalizeCommonConnections(
  connections: TechnologyRow['common_connections'] | null | undefined,
): Array<{ id: string; reason?: string }> {
  if (!Array.isArray(connections)) return [];
  const out: Array<{ id: string; reason?: string }> = [];
  for (const cc of connections) {
    if (typeof cc === 'string') {
      if (cc) out.push({ id: cc });
    } else if (cc && typeof cc === 'object') {
      if ('id' in cc && cc.id) {
        out.push(cc.reason ? { id: cc.id, reason: cc.reason } : { id: cc.id });
      } else if ('targetRole' in cc && cc.targetRole) {
        out.push({ id: cc.targetRole, reason: cc.contractKind ? `via ${cc.contractKind}` : undefined });
      }
    }
  }
  return out;
}

/** One rendering of a normalized connection, shared by every AI-facing surface. */
export function formatCommonConnection(cc: { id: string; reason?: string }): string {
  return cc.reason ? `${cc.id} (${cc.reason})` : cc.id;
}

export function getTechnologyHints(
  catalogs: CatalogData,
  technologyId: string,
): TechnologyHints | null {
  const tech = catalogs.technologies[technologyId];
  if (!tech) return null;

  const hasSuggestedFiles = Array.isArray(tech.suggested_files) && tech.suggested_files.length > 0;
  const connections = normalizeCommonConnections(tech.common_connections);
  // N8.4q: default_metadata dropped — orphan column (no packet/context/readiness reader).
  if (!hasSuggestedFiles && connections.length === 0) return null;

  return {
    suggested_files: tech.suggested_files || [],
    common_connections: connections,
  };
}

export function buildPlaceholderTechnology(
  rawName: string,
  roleId: string,
  projectId: string,
  userId: string,
): TechnologyRow {
  const id = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id,
    name: rawName,
    icon_url: null,
    brand_color: '#6b7280',
    secondary_color: null,
    display_name: null,
    node_shape: null,
    role_affinities: [roleId],
    ai_context: {},
    suggested_files: [],
    metadata_schema: {},
    common_connections: [],
    is_user_contributed: true,
    project_id: projectId,
    created_by: userId,
  };
}

export async function registerPlaceholderTechnology(
  supabase: SupabaseClient,
  catalogs: CatalogData,
  placeholder: TechnologyRow,
): Promise<{ registered: boolean; techId: string }> {
  if (catalogs.technologies[placeholder.id]) {
    const existing = catalogs.technologies[placeholder.id];
    if (!existing.role_affinities.includes(placeholder.role_affinities[0])) {
      existing.role_affinities = [...existing.role_affinities, placeholder.role_affinities[0]];
    }
    return { registered: false, techId: existing.id };
  }

  const { error } = await supabase
    .from('technology_catalog')
    .upsert({
      id: placeholder.id,
      name: placeholder.name,
      icon_url: placeholder.icon_url,
      brand_color: placeholder.brand_color,
      role_affinities: placeholder.role_affinities,
      ai_context: placeholder.ai_context,
      suggested_files: placeholder.suggested_files,
      metadata_schema: placeholder.metadata_schema,
      common_connections: placeholder.common_connections,
      is_user_contributed: placeholder.is_user_contributed,
      project_id: placeholder.project_id,
      created_by: placeholder.created_by,
    }, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.warn(`[registerPlaceholderTechnology] Failed to persist "${placeholder.id}":`, error.message);
  }

  catalogs.technologies[placeholder.id] = placeholder;
  return { registered: true, techId: placeholder.id };
}

export function buildPlatformCoexistenceGuidance(): string {
  return `## Platform Modeling Styles

Two valid approaches exist for modeling cloud/platform infrastructure:

**Style A -- Platform-Committed**: A single platform container node (e.g. "aws", "azure", "gcp") acts as the root container. Platform-specific capabilities (RDS, Lambda, S3) are children of that platform node with kind=platform_capability. Use this when the project is built entirely on one cloud provider. Note: Supabase and Firebase are standalone managed nodes, NOT containers -- use Style B for them.

**Style B -- Component-Composed**: No platform parent. Each service is modeled independently with its own role (database, serverless-function, object-storage) and a technology reference to the specific provider product. Use this for multi-cloud or provider-agnostic designs.

**Orphan-Prevention Rule**: platform_capability nodes MUST have a parent platform node (kind=platform). An orphaned platform_capability (no parentId pointing to a platform-kind node) is invalid and will be rejected by validation.

Choose ONE style per cloud provider within a project. Do not mix styles for the same provider.`;
}

export function buildCatalogDeploymentGuidance(
  catalogs: CatalogData,
  provider: string,
  archetypes: string[],
): string {
  const patterns = catalogs.cloudProviderPatterns;
  if (!patterns || patterns.length === 0) return '';

  const parts: string[] = [];
  for (const arch of archetypes) {
    const match = patterns.find(p => p.provider === provider && p.archetype === arch);
    if (match) parts.push(match.guidance);
  }

  if (parts.length === 0) {
    const fallback = patterns.find(p => p.provider === provider);
    if (fallback) parts.push(fallback.guidance);
  }

  return parts.join('\n\n');
}
