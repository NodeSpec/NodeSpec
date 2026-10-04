// V3 AD.0 (owner 2026-09-24): who may act on a git integration. git-push and
// git-pull authenticated the caller and then acted with the service client on
// whatever integration id the body named, so any signed-in user holding an id
// could push, read, load or apply criteria with that integration's stored
// token (finding S1). Every call now proves two things before the token is
// decrypted:
//
//   the integration belongs to the project the request names (when it names
//   one), and
//   the caller owns that project or holds a seat on it: any seat reads; a
//   push, a load, applying criteria and every baseline write need
//   contributor (the ladder in project-membership.ts); connecting the
//   repository, or changing its token, needs maintainer (owner 2026-09-27:
//   the repository is a maintainer's to manage on a Team project).
//
// A refusal reads exactly like an unknown id, so an id reveals nothing.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { memberRoleFor, roleAtLeast } from "./project-membership.ts";

export type GitAccess = "read" | "write" | "manage";

/** What each git-pull mode needs. A mode not listed is refused: there is no
 *  default mode (content-fetch used to be the default, and it moved the
 *  baseline without loading anything, finding D9; AD.4 retired it). */
const GIT_PULL_MODE_ACCESS: Readonly<Record<string, GitAccess>> = {
  "tree-scan": "read",
  "selective-fetch": "read",
  // The sync check writes cards and can move a baseline.
  "drift-check": "write",
  "restore-model": "write",
  "restore-spec": "write",
  "apply-criteria": "write",
  // AD.1: resolving a card, and the baseline an accepted proposal carries
  // (a connect adopt, or an agent's reconcile of a change card).
  "resolve-change": "write",
  "proposal-baseline": "write",
};

export function gitPullModeAccess(mode: unknown): GitAccess | null {
  return typeof mode === "string" && Object.prototype.hasOwnProperty.call(GIT_PULL_MODE_ACCESS, mode)
    ? GIT_PULL_MODE_ACCESS[mode]
    : null;
}

export const INTEGRATION_NOT_FOUND = "Integration not found";

export async function mayUseIntegration(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient | any,
  args: {
    integrationProjectId: string;
    /** The project the request names; when present it must be the integration's. */
    requestedProjectId?: string | null;
    userId: string;
    access: GitAccess;
  },
): Promise<boolean> {
  const { integrationProjectId, requestedProjectId, userId, access } = args;
  if (!integrationProjectId || !userId) return false;
  if (requestedProjectId != null && requestedProjectId !== integrationProjectId) return false;
  const { data: project } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", integrationProjectId)
    .maybeSingle();
  if (!project) return false;
  if ((project as { owner_id?: string }).owner_id === userId) return true;
  const role = await memberRoleFor(supabase, integrationProjectId, userId);
  return roleAtLeast(role, access === "manage" ? "maintainer" : access === "write" ? "contributor" : "viewer");
}
