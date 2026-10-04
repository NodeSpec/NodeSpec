import type { CatalogData, TechnologyRow } from "./catalog-loader.ts";
import { effectiveTreatment, treatmentForRole } from "./ontology.ts";
import { categoryLabel, resolveCategoryId } from "./palette-categories.ts";
// Real imports, not just the re-exports at the bottom of this file: a re-export
// alone does NOT bind the name in this module's own scope, and --no-check
// (jsr-403) means the ReferenceError only surfaces at runtime — 17 tests caught
// it. (Prose on purpose: an import-shaped example path in this comment sent a
// path-scanning tool looking for a file that does not exist.)
import { normalizeProviderFamily, inferProviderFromId as inferProviderPrefix } from "./provider-inference.ts";
import { isPartRole, namedRoleIds } from "./part-roles.ts";
// AA.3: the part helpers live in part-roles.ts; re-exported for the registry's callers.
export { PART_CAPABILITY_TAG, isPartRole, namedRoleIds } from "./part-roles.ts";

export interface TechnologyOption {
  id: string;
  name: string;
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

/**
 * AA.3 (owner 2026-09-23): the depth rule. Mirror of core/src/container-types.ts::
 * depthRuleRefusal. A node may have a child only if its role lists the child's role in
 * can_contain. A part role is admitted only by a role naming it by id (never by a
 * container admitting by nature or provider), and its own can_contain is empty, so a part
 * can never be exploded; a role listing no parts can never be exploded either. Containers
 * keep their own rules (canContainerAcceptChild). A parent the catalog does not know is
 * never refused here. Returns why the placement is refused, or null.
 */
export function depthRuleRefusal(catalogs: CatalogData, parentRoleId: string, childRoleId: string): string | null {
  const parent = catalogs.nodeRoles[parentRoleId];
  if (!parent) return null;
  const child = catalogs.nodeRoles[childRoleId];
  const named = namedRoleIds(parent.can_contain);
  if (isPartRole(child)) {
    if (named.includes(childRoleId)) return null;
    return `"${childRoleId}" is a part: it lives only inside a node whose role lists it, and "${parentRoleId}" does not.`;
  }
  if (parent.is_container) return null;
  if (named.includes(childRoleId)) return null;
  return named.length > 0
    ? `"${parentRoleId}" is not a container: it holds only its parts (${named.join(', ')}), not "${childRoleId}".`
    : `"${parentRoleId}" is not a container and lists no parts, so nothing can be placed inside it.`;
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
  // AA.3: the depth rule. A part only under a role naming it; a node that is not a
  // container holds only the parts its role lists, and nothing else.
  const depth = depthRuleRefusal(catalogs, containerRoleId, childRoleId);
  if (depth) return { allowed: false, reason: depth };
  if (!containerRow.is_container) return { allowed: true };

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

/** AG.11c and AG.12 (owner 2026-09-28): how a type holds what it holds, read from its
 *  layer. A container that runs what it holds (runtime, orchestration) hosts it; one that
 *  places it (a network, a cloud account) contains it; a group (logical) scopes it. A type
 *  that is not a container is a leaf, holding at most the parts its role lists. */
export type HoldingKind = 'runs' | 'places' | 'groups' | 'leaf';

export function holdingKind(catalogs: CatalogData, roleId: string): HoldingKind {
  const row = catalogs.nodeRoles[roleId];
  if (!row?.is_container) return 'leaf';
  if (row.container_layer === 'runtime' || row.container_layer === 'orchestration') return 'runs';
  if (row.container_layer === 'logical') return 'groups';
  return 'places';
}

/** AG.11c and AG.12a: the placement a child gets from how its parent holds, the rule the
 *  canvas drag, the in-app agent and propose_patches share. A boundary engine (by role, or
 *  raised by its technology) is hosted only by what runs it and scoped anywhere else. */
export function placementFor(
  catalogs: CatalogData,
  parentRoleId: string,
  childRoleId?: string,
  childTechnologyId?: string,
): 'hosts' | 'contains' | 'scopes' {
  const kind = holdingKind(catalogs, parentRoleId);
  if (kind === 'runs') return 'hosts';
  if (childRoleId) {
    const child = catalogs.nodeRoles[childRoleId];
    const treatment = treatmentForRole({ nature: child?.nature, is_container: child?.is_container });
    const techRow = childTechnologyId ? catalogs.technologies[childTechnologyId] : undefined;
    const techOverride = (techRow?.ai_context as Record<string, unknown> | undefined)?.treatmentOverride as string | undefined;
    if (treatment !== 'container' && effectiveTreatment(treatment, techOverride) === 'boundary') return 'scopes';
  }
  return kind === 'groups' ? 'scopes' : 'contains';
}

/** AG.12: the live types a role may hold, decided by the same check every placement
 *  passes (canContainerAcceptChild), so what an agent reads is what it is held to. A leaf
 *  holds only the parts its role lists. */
export function admittedRoleIds(catalogs: CatalogData, roleId: string): string[] {
  const row = catalogs.nodeRoles[roleId];
  if (!row) return [];
  const live = (id: string) => !!catalogs.nodeRoles[id] && catalogs.nodeRoles[id].deprecated !== true;
  if (!row.is_container) return namedRoleIds(row.can_contain).filter(live);
  return Object.values(catalogs.nodeRoles)
    .filter((c) => c.deprecated !== true && canContainerAcceptChild(catalogs, roleId, c.id).allowed)
    .map((c) => c.id);
}

/** AG.12 (owner 2026-09-28: the canvas rules "made present to the user's agent over
 *  MCP"): one line on how a type holds and what it may hold, in the same words wherever an
 *  agent reads it: get_node, the import draft, search_catalog, lookup_catalog and a refused
 *  placement. Lists past `max` ids are cut, naming how many more. */
export function holdingLine(catalogs: CatalogData, roleId: string, max = 12): string {
  const row = catalogs.nodeRoles[roleId];
  if (!row) return `"${roleId}" is not in the catalog.`;
  if (isPartRole(row)) {
    const parents = Object.values(catalogs.nodeRoles).filter((r) => namedRoleIds(r.can_contain).includes(row.id)).map((r) => r.id);
    return `A part: it comes from exploding a node and lives only inside ${parents.length > 0 ? parents.join(', ') : 'a role that lists it'}. It holds nothing.`;
  }
  const ids = admittedRoleIds(catalogs, roleId);
  const list = ids.length <= max
    ? ids.join(', ')
    : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more (lookup_catalog roleId ${roleId} lists them all)`;
  const holds = ids.length > 0 ? ` May hold: ${list}.` : ' It admits nothing.';
  switch (holdingKind(catalogs, roleId)) {
    case 'runs': return `Runs what it holds: a node inside it is hosted by it.${holds}`;
    case 'places': return `Places what it holds: a node inside it names it in its own configuration.${holds}`;
    case 'groups': return `Groups what it holds: organization only, nothing runs in it.${holds}`;
    default:
      return ids.length > 0
        ? `A leaf. Parts: ${list}. Nothing else can be placed inside it.`
        : 'A leaf: it holds nothing.';
  }
}

/** AG.12a: why a parent may not hold a child, in the words propose_patches and
 *  finalize_import both use, or null when it may. The parent's own list or rule is said as
 *  what the parent may hold; the other refusals (one provider per chain, a platform only in
 *  a group, the depth rule) keep their own words. */
export function placementRefusal(
  catalogs: CatalogData,
  parentRoleId: string,
  childRoleId: string,
  childTechnologyId?: string,
  parentTechnologyId?: string,
): string | null {
  const check = canContainerAcceptChild(catalogs, parentRoleId, childRoleId, childTechnologyId, parentTechnologyId);
  if (check.allowed) return null;
  return !check.reason || /^Container role /.test(check.reason)
    ? `a ${parentRoleId} may not hold a ${childRoleId}. ${holdingLine(catalogs, parentRoleId)}`
    : check.reason;
}

/** AG.12a: the sentence that closes every placement refusal. */
export const PLACEMENT_RULE =
  "A node sits only where its parent may hold it, the rule the canvas and import apply; get_project_context and lookup_catalog say what each type may hold.";

// M6: the copies this file's own comment flagged ("the N8(a) worksheet owns unifying the
// copies") are unified. Re-exported under their existing names so call sites are unchanged.
export { normalizeProviderFamily } from "./provider-inference.ts";
export { inferProviderFromId as inferProviderPrefix } from "./provider-inference.ts";

export function getContainerLayer(catalogs: CatalogData, roleId: string): string | null {
  const row = catalogs.nodeRoles[roleId];
  return row?.container_layer ?? null;
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
  // technology-driven role with a reported note.
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

export interface ProjectRelevanceFilter {
  archetypes?: string[];
  existingRoleIds?: string[];
  preferredCategories?: string[];
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
  // AG.12c: how the type holds, runs, places, groups or leaf, and everything it may hold.
  lines.push(holdingLine(catalogs, role.id, Infinity));
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
    // AG.12c: how each type holds, and what it may hold.
    line += `\n  ${holdingLine(catalogs, row.id, 8)}`;
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

const CODE_TEMPLATE_SUFFIX = ' [Tailor to project language and apply best practices for engineering and security if different from this example]';

/** N8.4b-3: `common_connections` carries three shapes across the live catalog (see the
 *  type in catalog-loader.ts). Every reader collapses them here, so the `{id, reason}`
 *  rows (75 of them, the plurality) stop rendering as "undefined via undefined" in
 *  lookup_catalog. */
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
