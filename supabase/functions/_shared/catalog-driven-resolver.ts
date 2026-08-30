import type { CatalogData, TechnologyRow, NodeRoleRow } from "./catalog-loader.ts";

/**
 * Runtime lookup indexes built from CatalogData that replace hardcoded
 * FRAMEWORK_TO_NODE_TYPE, LANGUAGE_TO_BACKEND_NODE_TYPE, and
 * DATABASE_DEPENDENCY_PATTERNS maps. When new technologies are added to
 * the catalog, these indexes automatically include them.
 */

export interface TechSignature {
  techId: string;
  name: string;
  roleAffinities: string[];
  filePatterns: string[];
  dependencyNames: string[];
}

export interface CatalogResolver {
  techSignatures: TechSignature[];
  dependencyToTech: Map<string, { techId: string; roleId: string }>;
  frameworkToRole: Map<string, string>;
  languageToBackendRole: Map<string, string>;
}

const LANGUAGE_ROLE_PATTERNS: Record<string, string> = {
  typescript: "backend.nodejs",
  javascript: "backend.nodejs",
  python: "backend.python",
  go: "backend.go",
  rust: "backend.rust",
  java: "backend.java",
  csharp: "backend.dotnet",
  php: "backend.php",
  ruby: "backend.ruby",
  swift: "mobile.swift",
  kotlin: "mobile.kotlin",
  dart: "mobile.flutter",
};

export function buildCatalogResolver(catalogs: CatalogData): CatalogResolver {
  const techSignatures: TechSignature[] = [];
  const dependencyToTech = new Map<string, { techId: string; roleId: string }>();
  const frameworkToRole = new Map<string, string>();
  const languageToBackendRole = new Map<string, string>();

  for (const [techId, tech] of Object.entries(catalogs.technologies)) {
    if (tech.is_user_contributed) continue;

    const filePatterns: string[] = [];
    if (Array.isArray(tech.suggested_files)) {
      for (const sf of tech.suggested_files) {
        if (sf.path) filePatterns.push(sf.path);
      }
    }

    const dependencyNames: string[] = [];
    if (tech.ai_context?.integrationPatterns) {
      for (const pattern of tech.ai_context.integrationPatterns) {
        const lower = pattern.toLowerCase().trim();
        if (lower && !lower.includes(" ") && lower.length < 60) {
          dependencyNames.push(lower);
        }
      }
    }

    const primaryRole = tech.role_affinities?.[0] ?? null;

    techSignatures.push({
      techId,
      name: tech.name,
      roleAffinities: tech.role_affinities || [],
      filePatterns,
      dependencyNames,
    });

    if (primaryRole) {
      const nameLower = tech.name.toLowerCase();
      frameworkToRole.set(nameLower, primaryRole);
      frameworkToRole.set(techId, primaryRole);
      if (tech.display_name) {
        frameworkToRole.set(tech.display_name.toLowerCase(), primaryRole);
      }
    }

    if (primaryRole && dependencyNames.length > 0) {
      for (const dep of dependencyNames) {
        if (!dependencyToTech.has(dep)) {
          dependencyToTech.set(dep, { techId, roleId: primaryRole });
        }
      }
    }
  }

  for (const [lang, fallbackRole] of Object.entries(LANGUAGE_ROLE_PATTERNS)) {
    const resolvedRole = catalogs.nodeRoles[fallbackRole]
      ? fallbackRole
      : "backend.nodejs";
    languageToBackendRole.set(lang, resolvedRole);
  }

  return {
    techSignatures,
    dependencyToTech,
    frameworkToRole,
    languageToBackendRole,
  };
}

export function resolveFrameworkToRole(
  resolver: CatalogResolver,
  frameworkName: string,
): string | null {
  const lower = frameworkName.toLowerCase();
  return resolver.frameworkToRole.get(lower) ?? null;
}

export function resolveLanguageToBackendRole(
  resolver: CatalogResolver,
  language: string,
): string {
  return resolver.languageToBackendRole.get(language) ?? "backend.nodejs";
}

export function resolveDependencyToNodeType(
  resolver: CatalogResolver,
  dependencyName: string,
): { techId: string; roleId: string } | null {
  const lower = dependencyName.toLowerCase();
  return resolver.dependencyToTech.get(lower) ?? null;
}

export function resolveNodeTypeForCandidate(
  resolver: CatalogResolver,
  catalogs: CatalogData,
  candidateRole: string,
  framework: string | null,
  language: string,
): string {
  if (framework) {
    const roleFromFw = resolveFrameworkToRole(resolver, framework);
    if (roleFromFw && catalogs.nodeRoles[roleFromFw]) return roleFromFw;
  }

  if (candidateRole === "backend-service" || candidateRole === "api-layer") {
    return resolveLanguageToBackendRole(resolver, language);
  }

  return candidateRole;
}

export interface CatalogListing {
  frameworks: Array<{ name: string; techId: string; roleId: string; type: "frontend" | "backend" | "fullstack" }>;
  databases: Array<{ depName: string; roleId: string }>;
  languageRoles: Record<string, string>;
}

export function buildCatalogListing(catalogs: CatalogData): CatalogListing {
  const frameworks: CatalogListing["frameworks"] = [];
  const databases: CatalogListing["databases"] = [];
  const languageRoles: Record<string, string> = {};

  for (const [techId, tech] of Object.entries(catalogs.technologies)) {
    if (tech.is_user_contributed) continue;
    const primaryRole = tech.role_affinities?.[0];
    if (!primaryRole) continue;

    const roleRow = catalogs.nodeRoles[primaryRole];
    if (!roleRow) continue;

    const category = roleRow.palette_category;
    const isFrontend = primaryRole.startsWith("frontend.");
    const isBackend = primaryRole.startsWith("backend.");
    const isDatabase = primaryRole.startsWith("database.") || primaryRole.startsWith("cache.");

    if (isFrontend || isBackend) {
      const type: "frontend" | "backend" | "fullstack" = isFrontend ? "frontend" : "backend";
      frameworks.push({ name: tech.name, techId, roleId: primaryRole, type });
    }

    if (isDatabase && tech.ai_context?.integrationPatterns) {
      for (const pattern of tech.ai_context.integrationPatterns) {
        const lower = pattern.toLowerCase().trim();
        if (lower && !lower.includes(" ") && lower.length < 60) {
          databases.push({ depName: lower, roleId: primaryRole });
        }
      }
    }
  }

  for (const [lang, fallbackRole] of Object.entries(LANGUAGE_ROLE_PATTERNS)) {
    languageRoles[lang] = catalogs.nodeRoles[fallbackRole] ? fallbackRole : "backend.nodejs";
  }

  return { frameworks, databases, languageRoles };
}
