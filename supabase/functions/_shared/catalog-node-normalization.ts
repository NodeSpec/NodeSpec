// Deterministic, IP-safe node normalization for the MCP write path. The external AI proposes
// catalog-blind (e.g. type:"service", technology:"React"); this conforms those guesses to the
// server-side catalog vocabulary WITHOUT exposing the catalog to the AI. No LLM — pure
// business logic (edit-distance + catalog lookups), reusing the same validators the internal
// agent loop uses. Edge-safe: only `_shared` + type-only jsr imports.
//
// Correctness is runtime-derived from the LOADED catalog: an unknown node type resolves to a
// real, non-container role in the *inferred* category (inferred from the proposed technology's
// role affinity). The hardcoded PREFERRED_GENERIC_BY_CATEGORY map only supplies a curated
// preference where one exists; when it doesn't (or the preferred role isn't in the catalog),
// we fall back to the lowest-sort-order role in that category, so the map can never make the
// result *invalid* — it only makes it *nicer*. Curate the map over time; correctness never
// depends on it.
import type { CatalogData } from "./catalog-loader.ts";
import {
  isValidNodeType,
  isValidTechnologyId,
  validateAndCorrectNodeType,
  validateTechnology,
} from "./role-registry.ts";

// The catalog's own last-resort role (also validateAndCorrectNodeType's blanket fallback).
// Guaranteed valid — the whole app relies on it.
export const GLOBAL_GENERIC_ROLE = "backend-service";

// Curated overrides: node_roles.palette_category -> preferred generic role id. Consulted
// first; if the role isn't in the loaded catalog we derive one at runtime instead. Start
// minimal and curate (owner review) — correctness does not depend on these entries.
export const PREFERRED_GENERIC_BY_CATEGORY: Record<string, string> = {
  Services: "backend-service",
  Backend: "backend-service",
};

/** The generic (non-container) role for a category, from the loaded catalog. */
export function genericRoleForCategory(
  catalogs: CatalogData,
  category: string | undefined,
): string | undefined {
  if (!category) return undefined;
  const preferred = PREFERRED_GENERIC_BY_CATEGORY[category];
  if (preferred && catalogs.nodeRoles[preferred]) return preferred;
  const inCategory = Object.values(catalogs.nodeRoles)
    .filter((r) => r.palette_category === category && !r.is_container)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id));
  return inCategory[0]?.id;
}

export interface NodeNormalizationNote {
  field: "type" | "technology" | "ports" | "frame";
  from: string;
  to: string;
  reason: string;
}

/**
 * Ensure a proposed node has ports (2026-07-16). Canvas node components render React Flow
 * handles ONLY per port — a portless node has zero handles, and React Flow silently drops every
 * edge touching it (mermaid/data stay correct; only the render starves). Both in-app paths
 * always provision ports (the palette injects the role's catalog `default_ports`; the internal
 * agent's add_node always created an in+out pair) — external MCP proposals were the only path
 * that could produce portless nodes. This restores that choreography server-side:
 * existing ports pass through untouched; container roles get none (edges to containers are
 * forbidden); otherwise the role's `default_ports` are materialized, falling back to a generic
 * in/out pair (internal-agent parity).
 */
export function ensureNodePorts(
  catalogs: CatalogData,
  resolvedType: string,
  ports: unknown,
): { ports: Array<Record<string, unknown>>; note?: NodeNormalizationNote } {
  if (Array.isArray(ports) && ports.length > 0) {
    return { ports: ports as Array<Record<string, unknown>> };
  }

  const role = catalogs.nodeRoles[resolvedType];
  if (role?.is_container) {
    return { ports: [] };
  }

  const defaults = role?.default_ports;
  const materialized = (Array.isArray(defaults) && defaults.length > 0)
    ? defaults.map((p) => ({ id: crypto.randomUUID(), name: p.name, direction: p.direction }))
    : [
      { id: crypto.randomUUID(), name: "input", direction: "in" },
      { id: crypto.randomUUID(), name: "output", direction: "out" },
    ];

  return {
    ports: materialized,
    note: {
      field: "ports",
      from: "(none)",
      to: materialized.map((p) => `${p.direction}:${p.name}`).join(", "),
      reason: (Array.isArray(defaults) && defaults.length > 0)
        ? `node had no ports; provisioned the role's default ports (edges cannot render on a portless node)`
        : `node had no ports; provisioned a generic input/output pair (edges cannot render on a portless node)`,
    },
  };
}

export interface NormalizedNode {
  type: string;
  technology?: string;
  notes: NodeNormalizationNote[];
}

/** Case-insensitive technology-id lookup, for category inference before a role is known.
 *  N8.4a-1b: returns the ROW's id, not the matched key — alias keys (legacy stray ids)
 *  share the canonical row, so proposals writing `technology: "ec2"` are canonicalized
 *  to `aws-ec2` at this write boundary. */
export function resolveTechnologyId(catalogs: CatalogData, raw: string): string | undefined {
  return techIdCaseInsensitive(catalogs, raw);
}

function techIdCaseInsensitive(catalogs: CatalogData, raw: string): string | undefined {
  const direct = catalogs.technologies[raw];
  if (direct) return direct.id;
  const lower = raw.toLowerCase();
  for (const [key, row] of Object.entries(catalogs.technologies)) {
    if (key.toLowerCase() === lower) return row.id;
  }
  return undefined;
}

/**
 * Conform a proposed (type, technology) pair to the catalog. Never throws; always returns a
 * valid role `type`. `technology` is case/alias-corrected where possible, else kept as the
 * raw string (external proposals never register placeholder technologies). `notes` records
 * every change for transparency back to the AI.
 */
export function normalizeProposedNode(
  catalogs: CatalogData,
  rawType: string | undefined,
  rawTechnology: string | undefined,
): NormalizedNode {
  const notes: NodeNormalizationNote[] = [];
  const originalType = (rawType || "").trim();
  const originalTech = (rawTechnology || "").trim() || undefined;

  // A technology hint for role inference: an explicit technology, else the `type` field when
  // it actually names a technology (external AIs often put "react" in the type slot). Both are
  // resolved to a canonical catalog tech id (case-insensitive).
  const techFromTech = originalTech ? techIdCaseInsensitive(catalogs, originalTech) : undefined;
  const techFromType = (!originalTech && originalType) ? techIdCaseInsensitive(catalogs, originalType) : undefined;
  const techHint = techFromTech ?? techFromType;

  // ── resolve the node type ──────────────────────────────────────────────────────────
  let type: string;
  if (originalType && isValidNodeType(catalogs, originalType)) {
    type = originalType;
  } else {
    const correction = originalType
      ? validateAndCorrectNodeType(catalogs, originalType)
      : { type: "", corrected: true, error: "using fallback" };
    // validateAndCorrectNodeType's *real* corrections (legacy-dotted, Levenshtein ≤3) are
    // accepted; its blanket backend-service answer is NOT — we replace it with a
    // technology-driven fallback. N8.5″(c): detection is the structural `blanket` flag,
    // not an error-string sniff (string coupling was one wording tweak from silently
    // re-admitting the lie).
    const isBlanketFallback = correction.blanket === true || !correction.type;
    if (!isBlanketFallback && correction.type && isValidNodeType(catalogs, correction.type)) {
      type = correction.type;
      if (correction.corrected) {
        notes.push({ field: "type", from: originalType, to: type, reason: correction.error || "corrected to a valid role" });
      }
    } else {
      // Prefer the technology's own primary role affinity DIRECTLY (e.g. react → frontend-app).
      // This is the catalog's opinion about what role the tech belongs to — more precise than
      // routing through the tech's category and re-deriving a category-generic (which could
      // resolve to a role in a shared/restructured category). Only when no usable affinity
      // role exists do we fall to the category generic, then the global generic.
      const affinities = techHint ? (catalogs.technologies[techHint]?.role_affinities ?? []) : [];
      const affinityRole = affinities.find((rid) => catalogs.nodeRoles[rid] && !catalogs.nodeRoles[rid].is_container);
      if (affinityRole) {
        type = affinityRole;
        notes.push({ field: "type", from: originalType || "(none)", to: type, reason: `unknown node type; used the primary role of technology "${techHint}"` });
      } else {
        const category = affinities[0] ? catalogs.nodeRoles[affinities[0]]?.palette_category : undefined;
        type = genericRoleForCategory(catalogs, category) || GLOBAL_GENERIC_ROLE;
        notes.push({
          field: "type",
          from: originalType || "(none)",
          to: type,
          reason: category
            ? `unknown node type; defaulted to the generic role of category "${category}"`
            : "unknown node type; defaulted to the global generic role",
        });
      }
    }
  }

  // ── normalize the technology against the resolved role ─────────────────────────────
  let technology = originalTech;
  // If no explicit technology but the `type` field named one, adopt it (canonical id).
  if (!technology && techFromType) {
    notes.push({ field: "technology", from: "(none)", to: techFromType, reason: "adopted technology from the proposed type" });
    technology = techFromType;
  }
  if (technology) {
    // N8.4a-1b: canonicalize legacy alias ids BEFORE validation — alias keys share the
    // canonical row (row.id is canonical), so a proposal carrying "ec2" (or "EC2" via
    // the case-insensitive hint) persists as "aws-ec2" and the stray id never re-enters
    // the graph through this boundary.
    const canonicalId = (technology === originalTech ? techFromTech : undefined) ?? catalogs.technologies[technology]?.id;
    if (canonicalId && canonicalId !== technology) {
      notes.push({ field: "technology", from: technology, to: canonicalId, reason: "legacy technology id normalized to its canonical catalog id" });
      technology = canonicalId;
    }
    const tv = validateTechnology(catalogs, technology, type);
    if (tv.corrected) {
      notes.push({ field: "technology", from: technology, to: tv.technology, reason: tv.warning || "corrected technology to a catalog id" });
      technology = tv.technology;
    } else if (!isValidTechnologyId(catalogs, technology)) {
      // Unknown technology: keep the raw string. External proposals never write the catalog,
      // so there is no placeholder registration — the node renders (valid type) without a logo
      // until the tech is added to the catalog by an admin.
      notes.push({ field: "technology", from: technology, to: technology, reason: "technology not in catalog; kept as-is (no logo until added to the catalog)" });
    }
    // else: valid as-is (possibly atypical for the role) — kept unchanged, no note.
  }

  return { type, technology, notes };
}
