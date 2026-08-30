// N3.6: catalog search/lookup, extracted OUT of tool-executor.ts (the D-series-doomed
// internal agent loop) so the retrieval survives deletion and can serve the MCP server —
// the same extract-before-delete pattern as C3b. This is how an EXTERNAL AI discovers the
// catalog at scale: technologies via the weighted FTS RPC (migration 20260317014759:
// name=A, id=A, purpose=B, typicalTech=C), roles via in-memory matching (~120 rows needs
// no FTS). Results carry `when_to_use` (previously UI-only) and a plain-language NATURE
// line — the recommendation signals. Client twin of the nature wording:
// src/ui/utils/node-nature.ts — keep the phrases aligned.
import type { CatalogData, NodeRoleRow, TechnologyRow } from "./catalog-loader.ts";
import { effectiveTreatment, effectiveTreatmentForRole, treatmentForRole, paletteOwnershipDefault } from "./ontology.ts";
import { inferProviderPrefix } from "./role-registry.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export function describeNature(role: NodeRoleRow | undefined, tech?: TechnologyRow | null): string {
  if (!role) return "Unknown role";
  if (role.is_container) {
    return role.container_style === "logical-boundary"
      ? "Grouping — optional; organizes related nodes, nothing runs here"
      : "Hosting environment — runs other nodes";
  }
  if (role.nature === "call") return "External service — you call it, someone else runs it";
  if (role.nature === "host") return "Platform — hosts parts of your system";
  if (role.nature === "integrate") {
    return "Managed service — provider runs it, you configure it";
  }
  const aiCtx = tech?.ai_context as Record<string, unknown> | undefined;
  const override = aiCtx?.treatmentOverride as string | undefined;
  // M1b: treatment derives from nature + containment; the twin in node-nature.ts matches.
  if (effectiveTreatmentForRole({ nature: role.nature, is_container: role.is_container }, override) === "boundary") {
    return aiCtx?.configMode === "definition-as-code"
      ? "Engine — you configure it; its definition file lives in your repo"
      : "Engine — you configure it; its internals stay inside it";
  }
  // N8.1b twin of node-nature.ts::deriveNodeNature — provider-backed technologies never
  // read as a plain "Service you build" (the AWS Lambda bench finding).
  const cm = aiCtx?.configMode;
  const providerBacked = tech ? inferProviderPrefix(tech.id) !== null : false;
  if (providerBacked || cm === "declarative" || cm === "external") {
    return cm === "code"
      ? "Managed runtime — you write the code, the provider runs it"
      : "Managed service — provider runs it, you configure it";
  }
  return "Service you build";
}

/** N3.7 enums-first (owner 2026-07-22): machine truth leads — treatment/ownership/
 *  configMode are THE vocabulary an AI should reason and propose with; the prose nature
 *  is demoted to `description` (human gloss only, never a category to echo). */
export interface CatalogSearchResult {
  technologies: Array<{
    id: string;
    name: string;
    purpose: string | null;
    roleAffinities: string[];
    treatment: string;
    ownership: string;
    configMode: string | null;
    rank: number;
    description: string;
  }>;
  roles: Array<{
    id: string;
    label: string;
    kind: string;
    treatment: string;
    ownership: string;
    altitude: string;
    whenToUse: string | null;
    description: string;
  }>;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_./]+/g, " ").trim();
}

/** In-memory role match (label/id/capability_tags/when_to_use), direct-hit first:
 *  exact > prefix > all-tokens > guidance-text. */
export function searchRoles(catalogs: CatalogData, query: string, limit: number): NodeRoleRow[] {
  const q = normalize(query);
  const qTokens = q.split(" ").filter(Boolean);
  const scored: Array<{ row: NodeRoleRow; tier: number }> = [];
  for (const row of Object.values(catalogs.nodeRoles)) {
    if (row.deprecated) continue;
    const hay = [row.label, row.id].map(normalize);
    // Tokens may span the label, tags, AND the guidance text ("etl pipelines" should hit a
    // role whose label says pipeline and whose when_to_use says ETL).
    const hayJoined = hay.join(" ")
      + " " + ((row.capability_tags ?? []) as string[]).map(normalize).join(" ")
      + " " + (row.when_to_use ? normalize(row.when_to_use) : "");
    let tier: number | null = null;
    if (hay.some((h) => h === q)) tier = 1;
    else if (hay.some((h) => h.startsWith(q))) tier = 2;
    else if (qTokens.every((t) => hayJoined.includes(t))) tier = 3;
    if (tier !== null) scored.push({ row, tier });
  }
  return scored
    .sort((a, b) => a.tier - b.tier || a.row.label.localeCompare(b.row.label))
    .slice(0, limit)
    .map((s) => s.row);
}

export async function searchCatalog(
  supabase: AnyClient,
  catalogs: CatalogData,
  query: string,
  maxResults = 10,
): Promise<{ success: true; data: CatalogSearchResult } | { success: false; error: string }> {
  const q = query.trim();
  const limit = Math.min(Math.max(maxResults || 10, 1), 25);
  if (q.length < 2) return { success: false, error: "query must be at least 2 characters" };

  const { data, error } = await supabase.rpc("search_relevant_technologies", {
    query_text: q,
    max_results: limit,
  });
  if (error) return { success: false, error: error.message };

  const technologies = ((data ?? []) as Array<{ tech_id: string; rank: number }>).filter((row) => {
    // N10(d): migrated/retired rows never surface in discovery — search is a
    // recommendation lane, and the catalog steers to successors (lookup by explicit
    // id still works and names the successor). Platform umbrellas stay searchable.
    const aiCtx = catalogs.technologies[row.tech_id]?.ai_context as Record<string, unknown> | undefined;
    return !(typeof aiCtx?.migrationTarget === "string" && aiCtx.migrationTarget) && aiCtx?.lifecycle !== "retired";
  }).map((row) => {
    const tech = catalogs.technologies[row.tech_id];
    if (!tech) return { id: row.tech_id, name: row.tech_id, purpose: null, roleAffinities: [], treatment: "leaf", ownership: "build", configMode: null, rank: row.rank, description: "Unknown" };
    const primaryRole = catalogs.nodeRoles[(tech.role_affinities ?? [])[0]];
    const aiCtx = tech.ai_context as Record<string, unknown> | undefined;
    const roleTreatment = treatmentForRole({ nature: primaryRole?.nature, is_container: primaryRole?.is_container });
    return {
      id: tech.id,
      name: tech.name,
      purpose: (aiCtx?.purpose as string) || (aiCtx?.summary as string) || null,
      roleAffinities: (tech.role_affinities ?? []) as string[],
      treatment: effectiveTreatment(roleTreatment, aiCtx?.treatmentOverride as string | undefined),
      ownership: paletteOwnershipDefault(primaryRole?.nature),
      configMode: (aiCtx?.configMode as string) ?? null,
      rank: row.rank,
      description: describeNature(primaryRole, tech),
    };
  });

  // M7: this emitted `kind: row.kind` and `altitude: row.altitude ?? "service"` — two
  // columns M1c DROPPED, and neither is on NodeRoleRow, so both were Deno type errors that
  // the client tsc run could not see. At runtime the MCP search_catalog response would have
  // advertised `kind: undefined` and an `altitude` pinned to "service" for every role.
  // Replaced with the axes that exist: `nature` (who runs it) and `interfaceKind` (what an
  // edge INTO it means) — the two the calling AI can actually act on.
  const roles = searchRoles(catalogs, q, limit).map((row) => ({
    id: row.id,
    label: row.label,
    nature: row.nature ?? "build",
    interfaceKind: row.interface_kind ?? "service",
    treatment: treatmentForRole({ nature: row.nature, is_container: row.is_container }),
    ownership: paletteOwnershipDefault(row.nature),
    whenToUse: row.when_to_use ?? null,
    description: describeNature(row),
  }));

  return { success: true, data: { technologies, roles } };
}
