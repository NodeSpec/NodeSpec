/*
  M2 — THE palette category vocabulary. One definition, mirrored at
  core/src/palette-categories.ts (the enums.ts pattern).

  This replaces the `palette_categories` DB TABLE, which was deleted. That table was a
  third category vocabulary layered on top of `node_roles.palette_category`, and it had
  drifted three restructures behind: its row ids were still the pre-v3 names (`Frontend`,
  `Backend`) while every role had moved to the v3 keys. The server joined the two, so
  `resolveAliasToDisplayKey('build')` returned `'Frontend'` and then matched ZERO roles —
  silently dropping every Services role (backend-service, frontend-app, worker) from the
  AI's node-type prompt, plus all of Automation and all of Hardware. See
  docs/ONTOLOGY_AUDIT.md §1.1.

  A display map does not need a table. Nothing wrote to it, nothing joined to it except the
  code below, and giving it a row id separate from the value roles actually carry is what
  made the drift possible in the first place. The KEY here IS `node_roles.palette_category`
  — there is no second key space and no alias hop, so this cannot drift the same way.

  Categories carry NO SEMANTICS (docs/NODE_REFERENCE.md §3). They group roles in the AI
  prompt, scope `lookup_catalog(category=…)`, drive icon fallback, and order the browse.
  Behavior lives on `nature` / `interface_kind` / containment / `provider`.
*/

export interface PaletteCategoryDef {
  /** The value stored in node_roles.palette_category. The one and only key. */
  id: string;
  /** Human-facing label. */
  label: string;
  /** Order in the palette and in the AI node-type prompt. */
  sortOrder: number;
}

export const PALETTE_CATEGORIES: readonly PaletteCategoryDef[] = [
  { id: 'Services',         label: 'Services',        sortOrder: 1 },
  { id: 'Database',         label: 'Data & Storage',  sortOrder: 2 },
  { id: 'Networking',       label: 'Networking',      sortOrder: 3 },
  { id: 'AI & ML',          label: 'AI & ML',         sortOrder: 4 },
  { id: 'Messaging',        label: 'Messaging',       sortOrder: 5 },
  { id: 'Infrastructure',   label: 'Infrastructure',  sortOrder: 6 },
  { id: 'Platform',         label: 'Platforms',       sortOrder: 7 },
  { id: 'Automation',       label: 'Automation',      sortOrder: 8 },
  { id: 'External',         label: 'Integrations',    sortOrder: 9 },
  { id: 'Observability',    label: 'Observability',   sortOrder: 10 },
  { id: 'Hardware',         label: 'Hardware & IoT',  sortOrder: 11 },
  { id: 'Game Development', label: 'Game Dev',        sortOrder: 12 },
  { id: 'Logical',          label: 'Structure',       sortOrder: 13 },
] as const;

export const PALETTE_CATEGORY_IDS: readonly string[] = PALETTE_CATEGORIES.map(c => c.id);

const BY_ID = new Map(PALETTE_CATEGORIES.map(c => [c.id, c]));

/** Display label for a stored palette_category value; falls back to the raw value. */
export function categoryLabel(id: string | null | undefined): string {
  if (!id) return '';
  return BY_ID.get(id)?.label ?? id;
}

/** Prompt/browse ordering. Unknown categories sort last, alphabetically, never dropped. */
export function categorySortOrder(id: string | null | undefined): number {
  return (id && BY_ID.get(id)?.sortOrder) || 99;
}

/**
 * Resolve a user- or AI-supplied category token to its stored id. Accepts the id, the
 * label, or either case-insensitively — so `lookup_catalog(category='services')`,
 * `'Services'` and `'Data & Storage'` all resolve. Returns null when nothing matches,
 * which callers surface as "no such category" rather than silently returning zero rows.
 */
export function resolveCategoryId(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  for (const c of PALETTE_CATEGORIES) {
    if (c.id.toLowerCase() === t || c.label.toLowerCase() === t) return c.id;
  }
  return null;
}
