// Owner spike 2026-08-23: the design trunk used to be identified by the
// LITERAL branch name 'main' in a dozen server lookups — while connect bound
// that row to whatever git branch the integration carries. Header said
// "main", the row mirrored 'develop', and any later branch wanting the real
// name collided. Identity now lives in branches.is_primary (migration
// 20260823150000), which frees connect to RENAME the trunk row to the bound
// git branch so the header tells the truth.
//
// deno-lint-ignore-file no-explicit-any

/** Resolve the project's primary (trunk) branch row. Prefers the is_primary
 *  flag; falls back to the legacy naming convention so pre-migration rows
 *  (and fixtures that insert bare 'main' rows) keep resolving. */
export async function getPrimaryBranch(
  supabase: any,
  projectId: string,
  columns = "id, name, git_ref, last_synced_commit, is_primary",
): Promise<any | null> {
  const { data: flagged } = await supabase
    .from("branches")
    .select(columns)
    .eq("project_id", projectId)
    .eq("is_primary", true)
    .maybeSingle();
  if (flagged) return flagged;
  const { data: legacy } = await supabase
    .from("branches")
    .select(columns)
    .eq("project_id", projectId)
    .eq("name", "main")
    .maybeSingle();
  return legacy ?? null;
}

/** A branch row read with is_primary in the select — with the legacy naming
 *  fallback for rows created before the migration (or by raw fixtures). */
export function isPrimaryRow(row: { is_primary?: boolean | null; name?: string | null }): boolean {
  return row.is_primary === true || (row.is_primary == null && row.name === "main");
}

export interface PrimaryRenameDecision {
  rename: boolean;
  to?: string;
  reason: string;
}

/** Connect-time rename decision (pure, pinned): the trunk row's name should
 *  MATCH the git branch it mirrors, so the header stops lying — unless the
 *  name is already right, invalid, or another branch row holds it (the
 *  collision this spike exists to prevent; never steal a sibling's name). */
export function computePrimaryRename(args: {
  primaryName: string;
  gitBranch: string | null | undefined;
  siblingNames: string[];
}): PrimaryRenameDecision {
  const target = (args.gitBranch ?? "").trim();
  if (!target) return { rename: false, reason: "no git branch bound" };
  if (target === args.primaryName) return { rename: false, reason: "already aligned" };
  if (args.siblingNames.includes(target)) {
    return { rename: false, reason: `another branch is already named "${target}" — rename skipped to avoid a collision` };
  }
  return { rename: true, to: target, reason: `renamed to match the bound git branch "${target}"` };
}
