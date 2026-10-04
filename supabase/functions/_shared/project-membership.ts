// V3 7.0 (Membership): the role ladder and the one read that answers "what
// is this user to this project". Pure helpers plus a structural query, so
// the MCP server, the RLS helpers the migration installs (project_role /
// is_project_member) and the app agree on one vocabulary:
//
//   owner       the projects.owner_id account — implicit, never a roster row
//   maintainer  edits, approves in person, updates the project row
//   contributor edits and proposes
//   viewer      reads
//
// What a tool needs is decided by its scope (read → viewer, propose and
// write → contributor); the roster itself is the owner's. Approving —
// accepting a plan, settling a proposal — is the owner's on any channel
// (their delegate acts for them; R6 still keeps promotion to the session)
// and a maintainer's in person only: a member's agent never approves.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ownersCarryingSeats } from "./deployment.ts";

export type ProjectRole = "owner" | "maintainer" | "contributor" | "viewer";
export type AuthChannel = "jwt" | "api_key" | "oauth_token";

export const PROJECT_ROLES: readonly ProjectRole[] = ["owner", "maintainer", "contributor", "viewer"];
export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { owner: 4, maintainer: 3, contributor: 2, viewer: 1 };

/** The seats set_project_member grants — 'owner' is projects.owner_id, not a grant. */
export const GRANTABLE_ROLES: readonly ProjectRole[] = ["maintainer", "contributor", "viewer"];

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === "string" && (PROJECT_ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: ProjectRole | null | undefined, min: ProjectRole): boolean {
  return !!role && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[min];
}

/** The role a tool needs, by its scope: read → viewer; propose and write → contributor. */
export function roleForScope(scope: "read" | "propose" | "write" | undefined): ProjectRole {
  return scope === "read" || scope === undefined ? "viewer" : "contributor";
}

/** Who may approve (accept a plan, settle a proposal): the owner on any
 *  channel, a maintainer in person (the session) only, nobody below. */
export function canApprove(role: ProjectRole, channel: AuthChannel): boolean {
  if (role === "owner") return true;
  if (role === "maintainer") return channel === "jwt";
  return false;
}

export function roleRefusal(tool: string, projectName: string, role: ProjectRole, need: ProjectRole): string {
  return `Your seat on '${projectName}' is ${role}; ${tool} needs ${need} or above. Ask the project owner for a wider seat.`;
}

export function approvalRefusal(what: string, projectName: string, role: ProjectRole, channel: AuthChannel): string {
  if (role === "maintainer" && channel !== "jwt") {
    return `${what} is a decision the user makes in person: you act for a maintainer of '${projectName}', and a member's agent never approves. The user decides in the app.`;
  }
  return `${what} is the project owner's call (or a maintainer's, in the app); your seat on '${projectName}' is ${role}.`;
}

/** The seat (project, user) holds, or null. Owner is the caller's to
 *  decide from projects.owner_id, the PK read every resolver already makes.
 *  Below Team a project is its owner's alone (owner 2026-09-26): a seat
 *  counts only while the project's plan (its owner's) carries seats. */
export async function memberRoleFor(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<ProjectRole | null> {
  const { data } = await supabase
    .from("project_members")
    .select("role, projects!inner(owner_id)")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { role?: unknown; projects?: { owner_id?: unknown } | null } | null;
  const role = row?.role;
  const owner = row?.projects?.owner_id;
  if (!isProjectRole(role) || typeof owner !== "string") return null;
  return (await ownersCarryingSeats(supabase, [owner])).has(owner) ? role : null;
}

/** A project its owner still shares: the seats on it, counted. */
export interface SeatedProject { id: string; name: string; seats: number }

/** The owned projects that hold seats, by name. */
export function projectsWithSeats(
  owned: ReadonlyArray<{ id: string; name: string }>,
  seats: ReadonlyArray<{ project_id: string }>,
): SeatedProject[] {
  const count = new Map<string, number>();
  for (const s of seats) count.set(s.project_id, (count.get(s.project_id) ?? 0) + 1);
  return owned
    .filter((p) => (count.get(p.id) ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, seats: count.get(p.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The narrow client the reader needs; the generic builder's types are not worth the checker's time here. */
type SeatReader = {
  from: (table: "projects" | "project_members") => {
    select: (cols: string) => {
      eq: (col: "owner_id", v: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      in: (col: "project_id", v: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

/** The projects this account owns that still hold seats. An owner hands
 *  each one over before a downgrade (AE.1) and before the account is
 *  deleted (owner 2026-09-27); the database refuses the deletion too. */
export async function ownedProjectsWithSeats(client: unknown, userId: string): Promise<SeatedProject[]> {
  const db = client as SeatReader;
  const owned = await db.from("projects").select("id, name").eq("owner_id", userId);
  if (owned.error) throw new Error(`Could not read your projects: ${owned.error.message}`);
  const rows = (Array.isArray(owned.data) ? owned.data : []) as Array<{ id: string; name: string }>;
  if (rows.length === 0) return [];
  const seats = await db.from("project_members").select("project_id").in("project_id", rows.map((r) => r.id));
  if (seats.error) throw new Error(`Could not read the seats: ${seats.error.message}`);
  return projectsWithSeats(rows, (Array.isArray(seats.data) ? seats.data : []) as Array<{ project_id: string }>);
}
