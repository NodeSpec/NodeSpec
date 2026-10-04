import type { CatalogData, TechnologyRow, NodeRoleRow } from "./catalog-loader.ts";

/**
 * Runtime lookup indexes built from CatalogData that replace hardcoded
 * FRAMEWORK_TO_NODE_TYPE, LANGUAGE_TO_BACKEND_NODE_TYPE, and
 * DATABASE_DEPENDENCY_PATTERNS maps. When new technologies are added to
 * the catalog, these indexes automatically include them.
 */

export interface CatalogResolver {
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

// AF.4c (owner 2026-09-28): the catalog dependency matcher (dependencyToTech
// from single-word integrationPatterns) matched nothing for any manifest, as
// no row carries such a pattern; it is retired. A manifest's dependencies
// reach synthesis as technology hints (import-signals notableDeps).
export function buildCatalogResolver(catalogs: CatalogData): CatalogResolver {
  const frameworkToRole = new Map<string, string>();
  const languageToBackendRole = new Map<string, string>();

  for (const [techId, tech] of Object.entries(catalogs.technologies)) {
    if (tech.is_user_contributed) continue;
    const primaryRole = tech.role_affinities?.[0] ?? null;
    if (primaryRole) {
      const nameLower = tech.name.toLowerCase();
      frameworkToRole.set(nameLower, primaryRole);
      frameworkToRole.set(techId, primaryRole);
      if (tech.display_name) {
        frameworkToRole.set(tech.display_name.toLowerCase(), primaryRole);
      }
    }
  }

  for (const [lang, fallbackRole] of Object.entries(LANGUAGE_ROLE_PATTERNS)) {
    const resolvedRole = catalogs.nodeRoles[fallbackRole]
      ? fallbackRole
      : "backend.nodejs";
    languageToBackendRole.set(lang, resolvedRole);
  }

  return { frameworkToRole, languageToBackendRole };
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

// ── Role families (RI-5 ontology-decoupling amendment) ─────────────────────
//
// The import pipeline reasons in FAMILIES ("this group is a frontend", "this
// is a shared library", "this is CI tooling"), never in ontology role ids.
// The ONLY place a role id literal may appear in the pipeline is the
// preference table below, and every entry is validated against the LIVE
// catalog before it is used: a renamed or retired role falls through to the
// category-generic role, then to the global generic — so an ontology change
// can never produce a proposal the canonical-gate triggers reject. A grep
// pin (src/tests/repo-index-schema.test.ts) keeps the other pipeline modules
// free of these literals.

export type RoleFamily =
  | "frontend" | "backend" | "database" | "logical" | "library" | "worker"
  | "messaging" | "auth" | "gateway" | "ci-cd" | "iac"
  | "mobile" | "desktop" | "firmware" | "ros2" | "network";

const ROLE_FAMILY_PREFERENCES: Record<RoleFamily, { preferred: string[]; categories: string[] }> = {
  frontend:  { preferred: ["frontend-app"],        categories: ["Platform", "Services"] },
  backend:   { preferred: ["backend-service"],     categories: ["Services"] },
  database:  { preferred: ["database"],            categories: ["Database"] },
  logical:   { preferred: ["application-module"],  categories: ["Logical"] },
  library:   { preferred: ["shared-library"],      categories: ["Logical"] },
  worker:    { preferred: ["worker"],              categories: ["Services"] },
  // AG.10: Message Broker folded; a queue that hands work to one consumer is the
  // messaging a repo most often names (RabbitMQ, SQS, Celery, BullMQ).
  messaging: { preferred: ["queue"],               categories: ["Messaging"] },
  auth:      { preferred: ["auth-provider"],       categories: ["Services"] },
  gateway:   { preferred: ["api-gateway"],         categories: ["Networking"] },
  "ci-cd":   { preferred: ["ci-cd-pipeline"],      categories: ["Automation"] },
  iac:       { preferred: ["iac-workflow"],        categories: ["Automation", "Infrastructure"] },
  // AB.4: installed software. A group whose own manifest says it is an app
  // (an Xcode application target, an Android application module, an Electron
  // or Tauri app, a PlatformIO project) is one of these, whatever language
  // it is written in; the language is its technology.
  mobile:    { preferred: ["mobile-app"],          categories: ["Services"] },
  desktop:   { preferred: ["desktop-app"],         categories: ["Services"] },
  firmware:  { preferred: ["firmware-service"],    categories: ["Hardware"] },
  // AF.4b: a ROS 2 package is a ROS 2 node, chosen by its manifest (the
  // embedded target alone would say firmware).
  ros2:      { preferred: ["ros2-node"],           categories: ["Hardware"] },
  // AG.12f: a VPN, a dedicated line, a transit hub, a NAT or a private
  // endpoint that infrastructure-as-code declares.
  network:   { preferred: ["network-connection"],  categories: ["Networking"] },
};

export const ROLE_FAMILIES = Object.keys(ROLE_FAMILY_PREFERENCES) as RoleFamily[];

export function isRoleFamily(value: string): value is RoleFamily {
  return value in ROLE_FAMILY_PREFERENCES;
}

/** The id a family PREFERS (its first preference) — what a caller reports
 * as "from" when the live catalog lacks it and resolveFamilyRole fell
 * through to a category generic. */
export function familyPreferredRole(family: RoleFamily): string {
  return ROLE_FAMILY_PREFERENCES[family].preferred[0];
}

/** The live role id for a family, or null when the catalog is empty. Never
 * returns an id the loaded catalog does not contain. */
export function resolveFamilyRole(catalogs: CatalogData, family: RoleFamily): string | null {
  const roles = catalogs.nodeRoles ?? {};
  if (Object.keys(roles).length === 0) return null;
  const pref = ROLE_FAMILY_PREFERENCES[family];
  for (const id of pref.preferred) {
    if (roles[id] && !roles[id].deprecated) return id;
  }
  for (const category of pref.categories) {
    const inCategory = Object.values(roles)
      .filter((r) => r.palette_category === category && !r.is_container && !r.deprecated)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id));
    if (inCategory[0]) return inCategory[0].id;
  }
  const any = Object.values(roles)
    .filter((r) => !r.is_container && !r.deprecated)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id));
  return any[0]?.id ?? null;
}

/** AB.4: the technology an app's manifest implies, when the node carries
 * none that fits its role: the manifest kind (and the group's dominant
 * language, where the manifest alone does not say). Technology ids are
 * catalog data like the role ids above, so they live here too, and each is
 * checked against the live catalog and the role's affinities before use. */
const MANIFEST_TECHNOLOGY: ReadonlyArray<{ kinds: string[]; family: RoleFamily; languages?: string[]; detail?: RegExp; technology: string }> = [
  { kinds: ["desktop-electron"], family: "desktop", technology: "electron" },
  { kinds: ["desktop-tauri"], family: "desktop", technology: "tauri" },
  { kinds: ["ios-app"], family: "mobile", languages: ["swift", "objective-c", "objectivec"], technology: "swift-ios" },
  // AF.4a: a SwiftUI or AppKit app.
  { kinds: ["macos-app"], family: "desktop", languages: ["swift", "objective-c", "objectivec"], technology: "swift-macos" },
  // AF.4b: a desktop project names its UI stack (the signal's detail). AJ.4: the
  // rows for Windows Forms, WinUI, Qt, GTK, Avalonia and JavaFX exist now.
  { kinds: ["desktop-ui"], family: "desktop", detail: /^WPF$/, technology: "wpf" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^\.NET MAUI$/, technology: "dotnet-maui" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^Windows Forms$/, technology: "winforms" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^WinUI$/, technology: "winui" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^Qt\b/, technology: "qt" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^GTK\b/, technology: "gtk" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^Avalonia$/, technology: "avalonia" },
  { kinds: ["desktop-ui"], family: "desktop", detail: /^JavaFX$/, technology: "javafx" },
  // A phone-only MAUI project (.NET MAUI takes Mobile App since the catalog type audit).
  { kinds: ["mobile-ui"], family: "mobile", detail: /^\.NET MAUI$/, technology: "dotnet-maui" },
  // AJ.4: a cross-platform app's own manifest names its framework; the app is
  // one node on its dominant role, wherever it installs (the 4d-2 rule).
  { kinds: ["mobile-app-framework"], family: "mobile", detail: /^(?:React Native|Expo)$/, technology: "react-native" },
  { kinds: ["mobile-app-framework"], family: "mobile", detail: /^Flutter$/, technology: "flutter" },
  { kinds: ["mobile-app-framework"], family: "mobile", detail: /^Capacitor$/, technology: "capacitor" },
  { kinds: ["mobile-app-framework"], family: "mobile", detail: /^Compose Multiplatform$/, technology: "compose-multiplatform" },
  { kinds: ["desktop-app-framework"], family: "desktop", detail: /^Wails$/, technology: "wails" },
  { kinds: ["desktop-app-framework"], family: "desktop", detail: /^Electron$/, technology: "electron" },
  { kinds: ["desktop-app-framework"], family: "desktop", detail: /^Tauri$/, technology: "tauri" },
  { kinds: ["ros2-package"], family: "ros2", technology: "ros2" },
  { kinds: ["android-app"], family: "mobile", languages: ["kotlin", "java"], technology: "kotlin-android" },
  // AE.9: a firmware project's own build files name the stack (the signal's
  // detail: "ESP-IDF", "Zephyr", "Arduino sketch", or PlatformIO's framework
  // line). PlatformIO alone is a build tool, not a stack, and a Yocto layer
  // is an image: both stay null.
  { kinds: ["firmware"], family: "firmware", detail: /\bESP-IDF\b|\bespidf\b/i, technology: "esp-idf" },
  { kinds: ["firmware"], family: "firmware", detail: /\bZephyr\b/i, technology: "zephyr" },
  { kinds: ["firmware"], family: "firmware", detail: /\bArduino\b/i, technology: "arduino" },
];

/** The catalog technology for an app of `role` whose manifest is `kind`, or
 * null. `detail` is the signal's own note, for the kinds whose manifest
 * names a stack outright. */
export function resolveManifestTechnology(catalogs: CatalogData, kind: string, language: string | undefined, role: string, detail?: string): string | null {
  const lang = (language ?? "").toLowerCase();
  for (const row of MANIFEST_TECHNOLOGY) {
    if (!row.kinds.includes(kind)) continue;
    if (row.languages && !row.languages.includes(lang)) continue;
    if (row.detail && !row.detail.test(detail ?? "")) continue;
    const tech = catalogs.technologies?.[row.technology];
    if (tech && !tech.is_user_contributed && (tech.role_affinities ?? []).includes(role)) return row.technology;
  }
  return null;
}

/** AF.4e (owner 2026-09-28): the technology a group's language gives it when
 * nothing better was read. A hint resolves only by catalog id, and no row's id
 * is a bare language name, so without this a C, C++, Rust or Go group with no
 * framework dependency landed with no technology. Used only as the floor, and
 * only when the row takes the node's role (a C++ CLI gets none until C++
 * takes CLI Tool). */
const LANGUAGE_TECHNOLOGY: Readonly<Record<string, string>> = {
  c: "c-systems",
  cpp: "cpp-backend",
  go: "go-backend",
  rust: "rust-backend",
};

/** The floor technology for a node of `role` whose dominant language is `language`, or null. */
export function resolveLanguageTechnology(catalogs: CatalogData, language: string | undefined, role: string): string | null {
  const id = LANGUAGE_TECHNOLOGY[(language ?? "").toLowerCase()];
  const tech = id ? catalogs.technologies?.[id] : undefined;
  return tech && !tech.is_user_contributed && (tech.role_affinities ?? []).includes(role) ? id : null;
}

/** AG.12e (owner 2026-09-28): the managed runtime a deploy file names, by the
 * product words its reader writes (the signal's detail), and the technology
 * the runtime host carries. */
const RUNTIME_TECHNOLOGY: ReadonlyArray<{ product: RegExp; technology: string }> = [
  { product: /^App Engine\b/, technology: "gcp-app-engine" },
  { product: /^App Runner\b/, technology: "aws-app-runner" },
  { product: /^Elastic Beanstalk\b/, technology: "aws-elastic-beanstalk" },
  { product: /^Cloud Run\b/, technology: "gcp-cloud-run" },
  { product: /^Azure App Service\b/, technology: "azure-app-service" },
  { product: /^Azure Static Web Apps\b/, technology: "azure-static-web-apps" },
  { product: /^Amplify Hosting\b/, technology: "aws-amplify-hosting" },
];

/** AG.12e: the row a managed runtime's language line names (`runtime: nodejs20`),
 * for a service that carries no technology of its own. */
const RUNTIME_LANGUAGE: ReadonlyArray<{ runtime: RegExp; technology: string }> = [
  { runtime: /^nodejs/, technology: "nodejs" },
  { runtime: /^python/, technology: "python-backend" },
  { runtime: /^go\d/, technology: "go-backend" },
  { runtime: /^java/, technology: "java-backend" },
  { runtime: /^php/, technology: "php-backend" },
  { runtime: /^ruby/, technology: "ruby-backend" },
];

/** The row for a node of `role` whose runtime's config names `runtime`, or null. */
export function resolveRuntimeLanguage(catalogs: CatalogData, runtime: string | undefined, role: string): string | null {
  const row = runtime ? RUNTIME_LANGUAGE.find((r) => r.runtime.test(runtime)) : undefined;
  const tech = row ? catalogs.technologies?.[row.technology] : undefined;
  return row && tech && !tech.is_user_contributed && (tech.role_affinities ?? []).includes(role) ? row.technology : null;
}

/** The technology of a runtime host of `role` for `product`, or null. */
export function resolveRuntimeTechnology(catalogs: CatalogData, product: string, role: string): string | null {
  const row = RUNTIME_TECHNOLOGY.find((r) => r.product.test(product));
  const tech = row ? catalogs.technologies?.[row.technology] : undefined;
  return row && tech && !tech.is_user_contributed && (tech.role_affinities ?? []).includes(role) ? row.technology : null;
}

/** AG.12f (owner 2026-09-28): the network products infrastructure-as-code
 * declares, by the words the network reader writes, and their rows: the
 * links (on the network family's role) and the networks that hold them (on
 * the network host's). A product with no row lands without a technology. */
const NETWORK_TECHNOLOGY: ReadonlyArray<{ product: string; part: "link" | "network"; technology: string }> = [
  { product: "Site-to-Site VPN", part: "link", technology: "aws-site-to-site-vpn" },
  { product: "Direct Connect", part: "link", technology: "aws-direct-connect" },
  { product: "Transit Gateway", part: "link", technology: "aws-transit-gateway" },
  { product: "PrivateLink", part: "link", technology: "aws-privatelink" },
  { product: "Cloud VPN", part: "link", technology: "gcp-cloud-vpn" },
  { product: "Cloud NAT", part: "link", technology: "gcp-cloud-nat" },
  { product: "Cloud Interconnect", part: "link", technology: "gcp-cloud-interconnect" },
  { product: "Private Service Connect", part: "link", technology: "gcp-private-service-connect" },
  { product: "AWS VPC", part: "network", technology: "aws-vpc" },
  { product: "Google Cloud VPC", part: "network", technology: "gcp-vpc" },
  { product: "Azure Virtual Network", part: "network", technology: "azure-vnet" },
];

/** The technology of a network node of `role` for `product`, or null. */
export function resolveNetworkTechnology(catalogs: CatalogData, product: string, role: string): string | null {
  const row = NETWORK_TECHNOLOGY.find((r) => r.product === product);
  const tech = row ? catalogs.technologies?.[row.technology] : undefined;
  return row && tech && !tech.is_user_contributed && (tech.role_affinities ?? []).includes(role) ? row.technology : null;
}

/** AG.0b (owner 2026-09-28): what the import pipeline names that the loaded
 * catalog cannot honour. Every role and technology id import code names
 * lives in this file's tables, plus the backing services the caller places
 * by their first role (`placed`). A missing or retired id does not break an
 * import (the family fallbacks degrade to a generic), it quietly makes it
 * worse, so the synthesize stage records this list on the job and the
 * proposal, and the live bench asserts it is empty. An empty catalog (the
 * offline paths) reports nothing. */
export function catalogDrift(catalogs: CatalogData, placed: readonly string[] = []): string[] {
  const roles = catalogs.nodeRoles ?? {};
  const techs = catalogs.technologies ?? {};
  if (Object.keys(roles).length === 0) return [];
  const out: string[] = [];
  const roleProblem = (id: string): string | null =>
    !roles[id] ? "is missing" : roles[id].deprecated ? "is retired" : null;
  for (const [family, pref] of Object.entries(ROLE_FAMILY_PREFERENCES)) {
    for (const id of pref.preferred) {
      const problem = roleProblem(id);
      if (problem) out.push(`role family ${family}: ${id} ${problem}`);
    }
  }
  for (const [family, ids] of Object.entries(HOST_FAMILY_PREFERENCES)) {
    for (const id of ids) {
      const problem = roleProblem(id) ??
        (roles[id].is_container && roles[id].container_style === "hosting" ? null : "is not a hosting container");
      if (problem) out.push(`host family ${family}: ${id} ${problem}`);
    }
  }
  for (const row of MANIFEST_TECHNOLOGY) {
    const tech = techs[row.technology];
    const role = resolveFamilyRole(catalogs, row.family);
    const problem = !tech ? "is missing"
      : tech.is_user_contributed ? "is a custom row"
      : role && !(tech.role_affinities ?? []).includes(role) ? `does not take ${role}`
      : null;
    if (problem) out.push(`manifest ${row.kinds.join(", ")}: ${row.technology} ${problem}`);
  }
  const rowProblem = (id: string, role: string | null): string | null => {
    const tech = techs[id];
    return !tech ? "is missing"
      : tech.is_user_contributed ? "is a custom row"
      : role && !(tech.role_affinities ?? []).includes(role) ? `does not take ${role}`
      : null;
  };
  for (const [language, id] of Object.entries(LANGUAGE_TECHNOLOGY)) {
    const problem = rowProblem(id, null);
    if (problem) out.push(`language ${language}: ${id} ${problem}`);
  }
  for (const row of RUNTIME_LANGUAGE) {
    const problem = rowProblem(row.technology, null);
    if (problem) out.push(`runtime language ${row.runtime.source.replace(/^\^/, "")}: ${row.technology} ${problem}`);
  }
  const runtimeRole = resolveHostFamilyRole(catalogs, "runtime");
  for (const row of RUNTIME_TECHNOLOGY) {
    const problem = rowProblem(row.technology, runtimeRole);
    if (problem) out.push(`runtime ${row.product.source.replace(/^\^|\\b$/g, "")}: ${row.technology} ${problem}`);
  }
  const linkRole = resolveFamilyRole(catalogs, "network");
  const vpcRole = resolveHostFamilyRole(catalogs, "network");
  for (const row of NETWORK_TECHNOLOGY) {
    const problem = rowProblem(row.technology, row.part === "link" ? linkRole : vpcRole);
    if (problem) out.push(`network ${row.product}: ${row.technology} ${problem}`);
  }
  for (const id of new Set(placed)) {
    const tech = techs[id];
    const first = tech?.role_affinities?.[0];
    const problem = !tech ? "is missing"
      : tech.is_user_contributed ? "is a custom row"
      : !first ? "has no role"
      : roleProblem(first) ? `places on ${first}, which ${roleProblem(first)}`
      : null;
    if (problem) out.push(`backing service ${id} ${problem}`);
  }
  return out;
}

// ── Host families (RI-15a slice 2) ───────────────────────────────────────
//
// Deployment evidence names a HOST — a compose stack, a kubernetes
// namespace/cluster — that wraps functional nodes. Hosts are catalog
// container roles with container_style 'hosting'; the preference table is
// the only place their ids appear, validated against the live catalog like
// the leaf families above. Unlike leaf families there is NO category
// fallback: a catalog without a hosting role for the family containerizes
// nothing (a guessed host would be a wrong parent on the deployment canvas).

// AE.8 (owner 2026-09-25, ruling 17): a device is a host too. Import draws
// the device an app installs on (mobile, desktop) or the board firmware runs
// on (edge) as a hosting container around that one node; cloud stays with
// the platform container roles. The device holds no files: the node keeps
// its artifacts, and the container is organization on the deployment canvas.
//
// AG.12e (owner 2026-09-28): a managed runtime (App Engine, Cloud Run, App
// Runner ...) is a host too: the service it runs sits inside it and keeps its
// framework, the runtime carries the product as its technology. AG.12f: the
// network a link serves is the link's parent.
export type HostFamily = "compose" | "kubernetes" | "mobile" | "desktop" | "edge" | "runtime" | "network";

const HOST_FAMILY_PREFERENCES: Record<HostFamily, string[]> = {
  compose: ["docker-compose"],
  kubernetes: ["k8s-namespace", "k8s-cluster"],
  mobile: ["mobile-device"],
  desktop: ["desktop-device"],
  edge: ["edge-device", "gateway-device"],
  runtime: ["docker-container"],
  network: ["vpc"],
};

/** The live HOSTING container role id for a host family, or null. */
export function resolveHostFamilyRole(catalogs: CatalogData, family: HostFamily): string | null {
  const roles = catalogs.nodeRoles ?? {};
  for (const id of HOST_FAMILY_PREFERENCES[family]) {
    const row = roles[id];
    if (row && row.is_container && row.container_style === "hosting" && !row.deprecated) return id;
  }
  return null;
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
