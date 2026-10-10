// AL.24: who filed a proposal, and whether Auto may apply what they filed.
// Auto applies only what the filing agent could decide itself: the owner's
// agent with write access, or the owner or a maintainer in the app. A key
// that may only propose, a revoked key, or a member's agent never gets a
// change applied by Auto, at filing or in the sweep.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult } from "../shared.ts";
import { canApprove, isProjectRole, memberRoleFor, type ProjectRole, type AuthChannel } from "../../_shared/project-membership.ts";

/** The agent behind a proposal: its account, its channel, its seat, and
 *  whether the credential it filed with may write. */
export interface Filer {
  auth: AuthResult;
  role: ProjectRole | null;
  write: boolean;
  /** Why it may not write, when it may not. */
  why?: string;
}

/** The filer at filing: the caller itself. */
export function filerFromCaller(auth: AuthResult, role: string | undefined): Filer {
  return { auth, role: isProjectRole(role) ? role : null, write: auth.scopes.includes("write") };
}

/** The seat a user holds on a project: owner, a member's role, or none. */
export async function seatOf(supabase: SupabaseClient, projectId: string, ownerId: string | null, userId: string | null): Promise<ProjectRole | null> {
  if (!userId) return null;
  if (ownerId && userId === ownerId) return "owner";
  return await memberRoleFor(supabase, projectId, userId);
}

/** What a credential may do now: 'key:<id>', 'oauth:<user>:<client>', 'user:<id>'. */
export async function credentialRights(supabase: SupabaseClient, credential: string | null, fallbackUser: string | null): Promise<{ userId: string | null; channel: AuthChannel; keyId?: string; clientId?: string; write: boolean; why?: string }> {
  if (credential?.startsWith("key:")) {
    const keyId = credential.slice(4);
    const { data } = await supabase.from("mcp_api_keys").select("user_id, scopes, revoked_at, expires_at").eq("id", keyId).maybeSingle();
    const k = data as { user_id?: string; scopes?: string[]; revoked_at?: string | null; expires_at?: string | null } | null;
    if (!k) return { userId: fallbackUser, channel: "api_key", keyId, write: false, why: "the key it used no longer exists" };
    if (k.revoked_at) return { userId: k.user_id ?? fallbackUser, channel: "api_key", keyId, write: false, why: "the key it used was revoked" };
    if (k.expires_at && Date.parse(k.expires_at) < Date.now()) return { userId: k.user_id ?? fallbackUser, channel: "api_key", keyId, write: false, why: "the key it used has expired" };
    const write = Array.isArray(k.scopes) && k.scopes.includes("write");
    return { userId: k.user_id ?? fallbackUser, channel: "api_key", keyId, write, ...(write ? {} : { why: "the key it used may only propose" }) };
  }
  if (credential?.startsWith("oauth:")) {
    const [, userId, ...rest] = credential.split(":");
    const clientId = rest.join(":");
    const { data } = await supabase.from("mcp_oauth_tokens").select("scopes").eq("user_id", userId).eq("client_id", clientId)
      .is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const scopes = (data as { scopes?: string[] } | null)?.scopes;
    const write = Array.isArray(scopes) && scopes.includes("write");
    return { userId, channel: "oauth_token", clientId, write, ...(write ? {} : { why: data ? "its connection may only propose" : "its connection was revoked" }) };
  }
  const userId = credential?.startsWith("user:") ? credential.slice(5) : fallbackUser;
  return { userId, channel: "jwt", write: true };
}

/** The filer a waiting proposal records (for the sweep). */
export async function filerFromProposal(supabase: SupabaseClient, projectId: string, ownerId: string | null, meta: Record<string, unknown>): Promise<Filer> {
  const credential = typeof meta.credential === "string" && meta.credential ? meta.credential
    : typeof meta.apiKeyId === "string" && meta.apiKeyId ? `key:${meta.apiKeyId}` : null;
  const filedBy = typeof meta.proposedByUserId === "string" ? meta.proposedByUserId : null;
  const method = meta.authMethod === "api_key" || meta.authMethod === "oauth_token" || meta.authMethod === "jwt" ? meta.authMethod as AuthChannel : null;
  const rights = credential ? await credentialRights(supabase, credential, filedBy)
    : { userId: filedBy, channel: method ?? "jwt" as AuthChannel, write: method === "jwt" };
  const userId = rights.userId ?? filedBy;
  const auth: AuthResult = {
    userId: userId ?? "",
    ...(rights.keyId ? { keyId: rights.keyId } : {}),
    ...(rights.clientId ? { clientId: rights.clientId } : {}),
    scopes: rights.write ? ["read", "write", "propose"] : ["read", "propose"],
    authMethod: rights.channel,
  };
  return { auth, role: await seatOf(supabase, projectId, ownerId, userId), write: rights.write, ...("why" in rights && rights.why ? { why: rights.why } : {}) };
}

/** Why Auto may not apply what this filer filed, or null when it may. */
export function filerRefusal(filer: Pick<Filer, "role" | "write" | "why"> & { channel: AuthChannel }): string | null {
  if (!filer.write) return `Its agent may only propose: ${filer.why ?? "the credential it used has no write access"}.`;
  if (!filer.role) return "Its agent no longer has a seat on this project.";
  if (!canApprove(filer.role, filer.channel)) return "Its agent acts for a member who is not the project owner, and a member's agent never applies a change: you decide it.";
  return null;
}
