import { getSupabaseClient } from './client.js';
import type { CanContainRule } from '@nodespec/core/container-types.js';
import type { NodeNature, InterfaceKind } from '@nodespec/core/ontology.js';
import { parseRole, parseTechnology } from '@nodespec/core/catalog-schemas.js';
import { TECHNOLOGY_ID_ALIASES } from '@nodespec/core/technology-aliases.js';

export interface NodeRole {
  id: string;
  label: string;
  description: string;
  iconName: string;
  color: string;
  rfVisualType: string;
  paletteCategory: string;
  /** M1b: the collapsed behavioral axis. Replaces kind + treatment_mode. Optional so
   *  pre-M1 constructors stay valid; absence means 'build'/'service' — the same defaults
   *  the DB columns carry. mapRole always populates both. */
  nature?: NodeNature;
  /** M1b: what an edge INTO this node means — the contract-birth axis. */
  interfaceKind?: InterfaceKind;
  provider: string | null;
  capabilityTags: string[];
  isContainer: boolean;
  containerLayer: string | null;
  containerStyle: 'hosting' | 'logical-boundary' | null;
  canContain: string[] | CanContainRule;
  metadataSchema: Record<string, unknown> | null;
  defaultPorts: unknown[];
  suggestedContracts: unknown[];
  sortOrder: number;
  deprecated: boolean;
  whenToUse: string | null;
  defaultTechnology: string | null;
}

export interface TechnologyCatalogEntry {
  id: string;
  name: string;
  iconUrl: string | null;
  brandColor: string;
  secondaryColor: string | null;
  displayName: string | null;
  roleAffinities: string[];
  aiContext: Record<string, unknown>;
  /** N8.4b-3: these two were typed `string[]` but the column has never held strings —
   *  `suggested_files` is `{path, kind}[]` (which is why CatalogService filters on those
   *  keys) and `common_connections` carries three shapes. The honest types stop callers
   *  from `.join(', ')`-ing objects into "[object Object]". */
  suggestedFiles: Array<{ path: string; kind: string }> | null;
  metadataSchema: Record<string, unknown> | null;
  commonConnections: Array<string | { targetRole: string; contractKind: string } | { id: string; reason?: string }> | null;
  isUserContributed: boolean;
  projectId: string | null;
  createdBy: string | null;
}

export interface DeploymentTarget {
  id: string;
  label: string;
  description: string;
  iconName: string;
  compatibleRoles: string[];
  metadataSchema: Record<string, unknown> | null;
  sortOrder: number;
}

export interface ResolvedNodeType {
  role: NodeRole;
  technology: TechnologyCatalogEntry | null;
  deploymentTarget: DeploymentTarget | null;
}

export interface CatalogResolver {
  /** M4: node.type is a ROLE ID, always (N9a). This is a role lookup wearing the old
   *  name — the dotted-grammar hop through legacy_type_mappings is gone with the table. */
  resolveNodeType(roleId: string): ResolvedNodeType | null;
  getRole(roleId: string): NodeRole | null;
  getTechnology(techId: string): TechnologyCatalogEntry | null;
  getDeploymentTarget(targetId: string): DeploymentTarget | null;
  getAllRoles(): NodeRole[];
  getAllTechnologies(): TechnologyCatalogEntry[];
  getAllDeploymentTargets(): DeploymentTarget[];
  getRolesByCategory(category: string): NodeRole[];
  getTechnologiesForRole(roleId: string): TechnologyCatalogEntry[];
  /** N8.5″(b): rows the M5 read gate skipped (row-identifying messages). Optional so
   *  older mocks stay valid; the real loader always provides it — the load-state
   *  machine reads it to enter 'degraded' instead of a false 'ready'. */
  getCatalogIssues?(): string[];
}

function mapRole(row: Record<string, unknown>): NodeRole {
  return {
    id: row.id as string,
    label: row.label as string,
    description: row.description as string,
    iconName: row.icon_name as string,
    color: row.color as string,
    rfVisualType: row.rf_visual_type as string,
    paletteCategory: row.palette_category as string,
    nature: ((row.nature as string) ?? 'build') as NodeRole['nature'],
    interfaceKind: ((row.interface_kind as string) ?? 'service') as NodeRole['interfaceKind'],
    provider: (row.provider as string) ?? null,
    capabilityTags: (row.capability_tags as string[]) ?? [],
    isContainer: row.is_container as boolean,
    containerLayer: row.container_layer as string | null,
    containerStyle: (row.container_style as 'hosting' | 'logical-boundary' | null) ?? null,
    canContain: (row.can_contain as string[] | CanContainRule) ?? [],
    metadataSchema: row.metadata_schema as Record<string, unknown> | null,
    defaultPorts: (row.default_ports as unknown[]) ?? [],
    suggestedContracts: (row.suggested_contracts as unknown[]) ?? [],
    sortOrder: row.sort_order as number,
    deprecated: (row.deprecated as boolean) ?? false,
    whenToUse: (row.when_to_use as string) ?? null,
    defaultTechnology: (row.default_technology as string) ?? null,
  };
}

function mapTech(row: Record<string, unknown>): TechnologyCatalogEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    iconUrl: row.icon_url as string | null,
    brandColor: row.brand_color as string,
    secondaryColor: row.secondary_color as string | null,
    displayName: row.display_name as string | null,
    roleAffinities: (row.role_affinities as string[]) ?? [],
    aiContext: (row.ai_context as Record<string, unknown>) ?? {},
    suggestedFiles: row.suggested_files as TechnologyCatalogEntry['suggestedFiles'],
    metadataSchema: row.metadata_schema as Record<string, unknown> | null,
    commonConnections: row.common_connections as TechnologyCatalogEntry['commonConnections'],
    isUserContributed: row.is_user_contributed as boolean,
    projectId: row.project_id as string | null,
    createdBy: row.created_by as string | null,
  };
}

function mapTarget(row: Record<string, unknown>): DeploymentTarget {
  return {
    id: row.id as string,
    label: row.label as string,
    description: row.description as string,
    iconName: row.icon_name as string,
    compatibleRoles: (row.compatible_roles as string[]) ?? [],
    metadataSchema: row.metadata_schema as Record<string, unknown> | null,
    sortOrder: row.sort_order as number,
  };
}

export async function loadCatalog(): Promise<CatalogResolver> {
  const supabase = getSupabaseClient();

  // N11(a) 2026-08-09: the scope_archetypes fetch is gone — it ran on every catalog
  // load and its getAllScopeArchetypes surface had ZERO callers (the N3 project-context
  // lens it fed no longer exists client-side). The table itself stays (D-series fence).
  const [rolesRes, techRes, targetsRes] = await Promise.all([
    supabase.from('node_roles').select('*').order('sort_order'),
    supabase.from('technology_catalog').select('*').order('name'),
    supabase.from('deployment_targets').select('*').order('sort_order'),
  ]);

  if (rolesRes.error) throw new Error(`Failed to load node_roles: ${rolesRes.error.message}`);
  if (techRes.error) throw new Error(`Failed to load technology_catalog: ${techRes.error.message}`);
  if (targetsRes.error) throw new Error(`Failed to load deployment_targets: ${targetsRes.error.message}`);

  // M5: the catalog read boundary is SCHEMA-GUARDED. Rows were previously taken with a raw
  // `as` cast, which is why the vocabulary columns were free to drift (15 palette_category
  // values including a dead one; 9 retired suggested_contracts tokens; a node_shape outside
  // its own union). Invalid rows are SKIPPED and reported rather than throwing — a single
  // malformed row must not blank the canvas — and the count surfaces on the degraded-catalog
  // banner the N9b-2 load-state machine already renders.
  const catalogIssues: string[] = [];
  const roles: NodeRole[] = [];
  for (const raw of rolesRes.data as Record<string, unknown>[]) {
    const parsed = parseRole(raw);
    if (!parsed.ok) { catalogIssues.push(...parsed.issues); continue; }
    roles.push(mapRole(raw));
  }
  const technologies: TechnologyCatalogEntry[] = [];
  for (const raw of techRes.data as Record<string, unknown>[]) {
    const parsed = parseTechnology(raw);
    if (!parsed.ok) { catalogIssues.push(...parsed.issues); continue; }
    technologies.push(mapTech(raw));
  }
  if (catalogIssues.length > 0) {
    console.warn(`[catalog] ${catalogIssues.length} row(s) failed schema validation and were skipped:\n  ` +
      catalogIssues.slice(0, 20).join('\n  '));
  }
  const targets = (targetsRes.data as Record<string, unknown>[]).map(mapTarget);

  const roleIndex = new Map<string, NodeRole>();
  for (const r of roles) roleIndex.set(r.id, r);

  const techIndex = new Map<string, TechnologyCatalogEntry>();
  for (const t of technologies) techIndex.set(t.id, t);
  // N8.4a-1b: legacy stray ids resolve to their renamed canonical rows (same row
  // object — row.id stays canonical). Pre-rename graph values keep rendering.
  for (const [alias, canonical] of Object.entries(TECHNOLOGY_ID_ALIASES)) {
    const row = techIndex.get(canonical);
    if (row && !techIndex.has(alias)) techIndex.set(alias, row);
  }

  const targetIndex = new Map<string, DeploymentTarget>();
  for (const d of targets) targetIndex.set(d.id, d);

  return {
    resolveNodeType(nodeType: string): ResolvedNodeType | null {
      const direct = roleIndex.get(nodeType);
      if (direct) return { role: direct, technology: null, deploymentTarget: null };
      // M4: TABLE-FREE dotted tolerance. graph_patches are append-only and HASH-CHAINED, so
      // they are never rewritten — a replayed patch can carry `frontend.react` forever, and
      // this is the read boundary that has to cope. The 429-row legacy_type_mappings table
      // and the 152-entry NODE_TYPE_TO_ROLE map are gone; the last segment of a dotted type
      // is its role id under the retired grammar, which is all the tolerance this needs.
      // Same category as LEGACY_ALIAS_MAP and LEGACY_INTERACTION_KIND_MAP: read-boundary
      // tolerance, not graph backward-compatibility.
      if (nodeType.includes('.')) {
        const tail = roleIndex.get(nodeType.split('.').pop()!);
        if (tail) return { role: tail, technology: null, deploymentTarget: null };
      }
      return null;
    },

    getRole(roleId: string) {
      return roleIndex.get(roleId) ?? null;
    },

    getTechnology(techId: string) {
      return techIndex.get(techId) ?? null;
    },

    getDeploymentTarget(targetId: string) {
      return targetIndex.get(targetId) ?? null;
    },

    getAllRoles() {
      return roles;
    },

    getAllTechnologies() {
      return technologies;
    },

    getAllDeploymentTargets() {
      return targets;
    },

    getRolesByCategory(category: string) {
      return roles.filter(r => r.paletteCategory === category);
    },

    getTechnologiesForRole(roleId: string) {
      return technologies.filter(t => t.roleAffinities.includes(roleId));
    },

    getCatalogIssues() {
      return catalogIssues;
    },
  };
}
