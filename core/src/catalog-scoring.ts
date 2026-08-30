/*
  Catalog scoring hints — OPEN-CORE seam (2026-08-25).

  These symbols are catalog-generic (they describe how technology_catalog rows
  steer file relevance) and are consumed by the OPEN CatalogService. They used
  to live inside core/src/repo-import/, which made the open catalog surface
  import from the closed reverse-engineering package — the one cross-link that
  would have dragged pipeline code into the community build. The closed side
  re-imports from here; the open side never touches repo-import again.
*/

/** Catalog-derived inputs to file classification (frameworks/databases/language roles). */
export interface CatalogListingParam {
  frameworks: Array<{ name: string; techId: string; roleId: string; type: "frontend" | "backend" | "fullstack" }>;
  databases: Array<{ depName: string; roleId: string }>;
  languageRoles: Record<string, string>;
}

export interface CatalogScoringHints {
  suggestedFilePatterns: string[];
  technologyFileNames: Set<string>;
}

/** N8.4b-3: the catalog's `suggested_files` column holds `{path, kind}` objects, never
 *  bare strings — this function's old `string[]` parameter type was a lie that made
 *  `pattern.split('/')` throw on live data (the brownfield-import scoring path). Both
 *  shapes are accepted now; the path is what scoring ever wanted. */
export function buildCatalogScoringHints(
  technologies: Array<{ suggestedFiles: Array<string | { path: string; kind?: string }> | null }>,
): CatalogScoringHints {
  const suggestedFilePatterns: string[] = [];
  const technologyFileNames = new Set<string>();

  for (const tech of technologies) {
    if (!tech.suggestedFiles) continue;
    for (const entry of tech.suggestedFiles) {
      const pattern = typeof entry === 'string' ? entry : entry?.path;
      if (!pattern) continue;
      suggestedFilePatterns.push(pattern);
      const filename = pattern.split('/').pop()?.toLowerCase();
      if (filename && !filename.includes('*')) {
        technologyFileNames.add(filename);
      }
    }
  }

  return { suggestedFilePatterns, technologyFileNames };
}
