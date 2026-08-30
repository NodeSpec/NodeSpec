import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { NodeNature, InterfaceKind } from "./ontology.ts";
import type { AiContext } from "./catalog-schemas.ts";
import { parseRole, parseTechnology } from "./catalog-schemas.ts";
import { registerProviderFamilies } from "./provider-inference.ts";

/** N8.1: can_contain's second shape — the rule object (matches the DB CHECK constraint;
 *  a child matches if it hits ANY populated allowlist). The legacy shape is a bare
 *  string[] of role ids. */
export interface CanContainRule {
  roleIds?: string[];
  /** M1c: replaces `kinds` (the retired 13-value `kind` vocabulary). */
  natures?: string[];
  /** M1c: replaces `functionalKinds`. */
  interfaceKinds?: string[];
  providers?: string[];
}

export interface NodeRoleRow {
  id: string;
  label: string;
  description: string;
  icon_name: string;
  color: string;
  rf_visual_type: string;
  palette_category: string;
  /** M1b: the collapsed behavioral axis (replaces kind + treatment_mode). Optional in
   *  fixtures; always present from loadCatalogs' select. Absent === 'build' (column default). */
  nature?: NodeNature | null;
  /** M1b: what an edge INTO this node means (replaces functional_kind). Absent === 'service'. */
  interface_kind?: InterfaceKind | null;
  provider?: string | null;
  is_container: boolean;
  container_layer: string | null;
  container_style: 'hosting' | 'logical-boundary' | null;
  can_contain: string[] | CanContainRule;
  metadata_schema: Record<string, unknown>;
  default_ports: Array<{ name: string; direction: 'in' | 'out' }>;
  suggested_contracts: Array<{ kind: string; name: string }>;
  sort_order: number;
  capability_tags: string[];
  default_technology: string | null;
  /** N3.6: curated recommendation guidance + liveness — surfaced to the AI via search_catalog. */
  when_to_use: string | null;
  deprecated: boolean | null;
}

export interface TechnologyRow {
  id: string;
  name: string;
  icon_url: string | null;
  brand_color: string;
  secondary_color: string | null;
  display_name: string | null;
  role_affinities: string[];
  /** N8.3′: THE ONE ai_context declaration — inferred from AiContextSchema in
   *  catalog-schemas.ts (previously this inline shape and the client's TechAIContext
   *  had drifted apart, and configMode/treatmentOverride were declared in neither
   *  despite being read on both runtimes). The read boundary stays lenient (rows are
   *  never skipped for ai_context content); the schema is enforced at write by
   *  validateTechnologyFiling + the enrichment-provenance DB trigger. */
  ai_context: AiContext;
  suggested_files: Array<{ path: string; kind: string }>;
  metadata_schema: Record<string, unknown>;
  /** THREE shapes live in this column (N8.4b-3 audit of the 271-row export):
   *  a bare id string, `{targetRole, contractKind}`, and `{id, reason}` — the last is
   *  the plurality (75 rows) and the richest. Readers MUST go through
   *  `normalizeCommonConnections` in role-registry.ts, which collapses all three to
   *  `{id, reason?}`; reading `.targetRole` directly printed "undefined via undefined"
   *  into AI-facing text for every `{id, reason}` row. New rows author `{id, reason}`. */
  common_connections: Array<string | { targetRole: string; contractKind: string } | { id: string; reason?: string }>;
  is_user_contributed: boolean;
  project_id: string | null;
  created_by: string | null;
}

export interface DeploymentTargetRow {
  id: string;
  label: string;
  description: string;
  icon_name: string;
  compatible_roles: string[];
  metadata_schema: Record<string, unknown>;
  sort_order: number;
}

export interface CloudProviderPatternRow {
  provider: string;
  archetype: string;
  guidance: string;
}

export interface ScopeArchetypeRow {
  id: string;
  label: string;
  description: string;
  detection_signals: unknown[];
  spec_guidance: string;
  feature_guidance: string;
  architecture_guidance: string;
  relevant_categories: string[];
  requirement_count_range: { min: number; max: number };
  multi_archetype_feature_guidance: string;
  multi_archetype_architecture_guidance: string;
  sort_order: number;
}

export interface CatalogData {
  nodeRoles: Record<string, NodeRoleRow>;
  technologies: Record<string, TechnologyRow>;
  deploymentTargets: Record<string, DeploymentTargetRow>;
  cloudProviderPatterns: CloudProviderPatternRow[];
  scopeArchetypes: Record<string, ScopeArchetypeRow>;
  /** N8.5″(a): rows the M5 read gate skipped (row-identifying messages). Optional so
   *  hand-built test catalogs stay valid; loadCatalogs always sets it. */
  catalogIssues?: string[];
}

function indexById<T extends { id: string }>(rows: T[]): Record<string, T> {
  const map: Record<string, T> = {};
  for (const row of rows) {
    map[row.id] = row;
  }
  return map;
}

/** SERVER MIRROR of core/src/technology-aliases.ts — keep the map byte-identical
 *  (the enums.ts pattern). N8.4a-1b: stray ids renamed by migration 20260727140000;
 *  pre-rename graph/patch values still resolve through these alias keys. */
export const TECHNOLOGY_ID_ALIASES: Record<string, string> = {
  aurora: 'aws-aurora',
  dynamodb: 'aws-dynamodb',
  ec2: 'aws-ec2',
  elasticache: 'aws-elasticache',
  cosmosdb: 'azure-cosmos-db',
  'azure-ad-b2c': 'azure-entra-id',
  gcs: 'gcp-cloud-storage',
  'gcp-cloud-storage-for-archive': 'gcp-cloud-storage',
  firestore: 'gcp-firestore',
  'firebase-firestore': 'gcp-firestore',
  'gce-instance': 'gcp-compute-engine',
  'gcp-cloud-natural-language-api': 'gcp-vertex-ai',
  'openai-assistants': 'openai',
};

/** Register alias keys pointing at the canonical row (same object — row.id stays
 *  canonical), so every `catalogs.technologies[...]` site tolerates legacy ids with
 *  zero per-site edits. Exported for offline tests. */
export function registerTechnologyAliases(map: Record<string, TechnologyRow>): Record<string, TechnologyRow> {
  for (const [alias, canonical] of Object.entries(TECHNOLOGY_ID_ALIASES)) {
    if (map[canonical] && !map[alias]) map[alias] = map[canonical];
  }
  return map;
}

export async function loadCatalogs(supabase: SupabaseClient): Promise<CatalogData> {
  const [rolesResult, techResult, targetsResult, patternsResult, archetypesResult] = await Promise.all([
    supabase
      .from('node_roles')
      .select('id, label, description, icon_name, color, rf_visual_type, palette_category, nature, interface_kind, provider, is_container, container_layer, container_style, can_contain, metadata_schema, default_ports, suggested_contracts, sort_order, capability_tags, default_technology, when_to_use, deprecated')
      .order('sort_order'),
    supabase
      .from('technology_catalog')
      .select('id, name, icon_url, brand_color, secondary_color, display_name, role_affinities, ai_context, suggested_files, metadata_schema, common_connections, is_user_contributed, project_id, created_by')
      .order('name'),
    supabase
      .from('deployment_targets')
      .select('id, label, description, icon_name, compatible_roles, metadata_schema, sort_order')
      .order('sort_order'),
    supabase
      .from('cloud_provider_patterns')
      .select('provider, archetype, guidance')
      .order('provider'),
    supabase
      .from('scope_archetypes')
      .select('id, label, description, detection_signals, spec_guidance, feature_guidance, architecture_guidance, relevant_categories, requirement_count_range, multi_archetype_feature_guidance, multi_archetype_architecture_guidance, sort_order')
      .order('sort_order'),
  ]);

  if (rolesResult.error) throw new Error(`Failed to load node_roles: ${rolesResult.error.message}`);
  if (techResult.error) throw new Error(`Failed to load technology_catalog: ${techResult.error.message}`);
  if (targetsResult.error) throw new Error(`Failed to load deployment_targets: ${targetsResult.error.message}`);

  // N8.5″(a): the M5 read gate, SERVER side — the same parseRole/parseTechnology the
  // client repository runs (catalog-repository.ts:181-188), with the same semantics:
  // validate the RAW row, skip + report on failure, never throw (a malformed row must
  // degrade the catalog, never 500 the MCP server). The raw `as` casts that stood here
  // were the exact pattern the M5 schema header condemns — the gate ran CLIENT-ONLY,
  // so a row the client skipped still flowed into task packets, MCP context, and
  // import synthesis unchecked. Mapping stays on the raw row (client parity).
  const catalogIssues: string[] = [];
  const roleRows: NodeRoleRow[] = [];
  for (const raw of (rolesResult.data ?? []) as Record<string, unknown>[]) {
    const parsed = parseRole(raw);
    if (!parsed.ok) { catalogIssues.push(...parsed.issues); continue; }
    roleRows.push(raw as unknown as NodeRoleRow);
  }
  const techRows: TechnologyRow[] = [];
  for (const raw of (techResult.data ?? []) as Record<string, unknown>[]) {
    const parsed = parseTechnology(raw);
    if (!parsed.ok) { catalogIssues.push(...parsed.issues); continue; }
    techRows.push(raw as unknown as TechnologyRow);
  }
  if (catalogIssues.length > 0) {
    console.warn(`[catalog-loader] ${catalogIssues.length} row(s) failed schema validation and were SKIPPED:\n  ` +
      catalogIssues.slice(0, 20).join('\n  '));
  }

  // N8.5″(d): the catalog seeds provider inference — a provider-stamped role row is
  // all a NEW provider family needs (the static prefix list is the floor, not the
  // ceiling; union semantics keep existing inference identical).
  registerProviderFamilies(roleRows.map((r) => r.provider));

  return {
    nodeRoles: indexById(roleRows),
    technologies: registerTechnologyAliases(indexById(techRows)),
    deploymentTargets: indexById(targetsResult.data as DeploymentTargetRow[]),
    cloudProviderPatterns: (patternsResult.data as CloudProviderPatternRow[]) || [],
    scopeArchetypes: indexById((archetypesResult.data as ScopeArchetypeRow[]) || []),
    catalogIssues,
  };
}
