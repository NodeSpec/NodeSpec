// S1-3: cross-cutting types, constants, and utilities shared across the mcp-server
// modules (index composition, auth, transport, tool handlers). Extracted verbatim from
// index.ts so sibling modules can import them without importing index.ts itself — whose
// top-level Deno.serve fires on import and blocks unit testing. The only jsr import is a
// type-only SupabaseClient (erased at runtime; the 7.0 membership module it re-exports is
// type-only on jsr too), so this module type-checks and runs offline and needs no jsr resolution.
import { getPrimaryBranch } from "../_shared/primary-branch.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isProjectRole, type ProjectRole } from "../_shared/project-membership.ts";
import { ownersCarryingSeats } from "../_shared/deployment.ts";
import { oauthClientName } from "../_shared/oauth-client.ts";
// 7.0: the role ladder is one module (the RLS helpers mirror it); the tool
// buckets reach it through here so they never import _shared twice.
export {
  PROJECT_ROLES, PROJECT_ROLE_RANK, GRANTABLE_ROLES, isProjectRole, roleAtLeast, roleForScope,
  canApprove, roleRefusal, approvalRefusal, memberRoleFor,
} from "../_shared/project-membership.ts";
export type { ProjectRole } from "../_shared/project-membership.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-MCP-API-Key",
};

export interface MCPRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface MCPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AuthResult {
  userId: string;
  keyId?: string;
  /** OAuth connectors: the client that holds the token (stable across renewals). */
  clientId?: string;
  scopes: string[];
  authMethod: 'jwt' | 'api_key' | 'oauth_token';
  /** 7.0: the signed-in user's email (sessions only) — the label a human hold shows. */
  email?: string;
  /** O.2: the API key's name, from validate_mcp_api_key. The proven label. */
  keyName?: string;
}

/** R7: the credential IS the identity. 'key:<id>' for API keys,
 *  'oauth:<user>:<client_id>' for OAuth tokens (the pair survives token
 *  renewals), null for the app's own session — a human, not a delegate. */
export function delegateOf(auth: Pick<AuthResult, 'userId' | 'keyId' | 'clientId'>): string | null {
  if (auth.keyId) return `key:${auth.keyId}`;
  if (auth.clientId) return `oauth:${auth.userId}:${auth.clientId}`;
  return null;
}

/** 7.0: the identity a lease records — the delegate for an agent, and
 *  'user:<id>' for the signed-in human (so a person's own holds read mine
 *  and release for them). Null only when nothing identifies the caller. */
export function holderIdentity(auth: Pick<AuthResult, 'userId' | 'keyId' | 'clientId' | 'authMethod'>): string | null {
  return delegateOf(auth) ?? (auth.authMethod === 'jwt' ? `user:${auth.userId}` : null);
}

/** The human-readable credential behind a delegate id: the key's name (or
 *  its id prefix), or the OAuth client. Null for humans. */
export function credentialLabel(delegate: string | null | undefined, keyNames: ReadonlyMap<string, string> = new Map()): string | null {
  if (!delegate) return null;
  if (delegate.startsWith('key:')) {
    const id = delegate.slice(4);
    return `key · ${keyNames.get(id) ?? id.slice(0, 8)}`;
  }
  if (delegate.startsWith('oauth:')) {
    const rest = delegate.slice(6);
    return `oauth · ${oauthClientName(rest.slice(rest.indexOf(':') + 1))}`;
  }
  // 7.0: a human holds in person — no credential behind the name.
  if (delegate.startsWith('user:')) return null;
  // AL.2: a bare account id is no name; the caller names the person.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(delegate)) return null;
  return delegate;
}

/** O.2: the credential a request authenticated with, as the label a person
 *  sees. 'key · <name>' for an API key (its id prefix when the name is
 *  unknown), 'oauth · <client>' for an OAuth connector, the email for a
 *  session. Never "unknown agent": the transport always knows who called. */
export function credentialOf(auth: Pick<AuthResult, 'userId' | 'keyId' | 'clientId' | 'authMethod' | 'email' | 'keyName'>): { delegate: string | null; label: string } {
  const delegate = delegateOf(auth);
  if (auth.keyId) return { delegate, label: `key · ${auth.keyName ?? auth.keyId.slice(0, 8)}` };
  if (auth.clientId) return { delegate, label: `oauth · ${oauthClientName(auth.clientId)}` };
  return { delegate, label: auth.authMethod === 'jwt' ? (auth.email ?? 'signed-in user') : 'agent' };
}

/** O.2: what a write is attributed to in words. The caller's self-declared
 *  nickname (`external_agent`) when it sent one, else the proven credential.
 *  Replaces every "unknown agent" / 'external-mcp-agent' / 'unknown'
 *  fallback: an agent that says nothing is still the key it holds. */
export function actorLabel(auth: Parameters<typeof credentialOf>[0], externalAgent: unknown): string {
  return typeof externalAgent === 'string' && externalAgent.trim() ? externalAgent.trim() : credentialOf(auth).label;
}

export function getBaseUrl(): string {
  return Deno.env.get('MCP_PUBLIC_URL') || `${Deno.env.get('SUPABASE_URL')}/functions/v1/mcp-server`;
}

export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function checkScope(auth: AuthResult, requiredScope: string): boolean {
  return auth.scopes.includes(requiredScope);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A resolved project: id, name and the caller's seat on it (7.0). */
export interface ResolvedProject { id: string; name: string; role: ProjectRole }

type SeatRow = { role: unknown; projects: { id: string; name: string; owner_id?: string; updated_at?: string } | null };

// Resolve a project by UUID or (unique) name for the authenticated user. Shared by every
// tool bucket that takes a `project_id`. Structural supabase param; type-only client.
// 7.0: the owner's read comes first (one PK lookup — the common case); anyone else
// resolves through their roster seat, and the seat's role rides back with the project.
// Below Team a project is its owner's alone (owner 2026-09-26): a seat resolves only
// while the owner's plan carries seats; otherwise it is refused like a stranger.
export async function resolveProjectByName(
  supabase: SupabaseClient,
  userId: string,
  identifier: string
): Promise<{ project: ResolvedProject } | { error: MCPResponse }> {
  if (!identifier) {
    return { error: { success: false, error: 'project_id is required' } };
  }

  if (UUID_RE.test(identifier)) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', identifier)
      .eq('owner_id', userId)
      .maybeSingle();
    if (data) return { project: { id: data.id, name: data.name, role: 'owner' } };

    const { data: seat } = await supabase
      .from('project_members')
      .select('role, projects!inner(id, name, owner_id)')
      .eq('project_id', identifier)
      .eq('user_id', userId)
      .maybeSingle();
    const row = seat as SeatRow | null;
    const owner = row?.projects?.owner_id;
    if (!row?.projects || !isProjectRole(row.role) || !owner || !(await ownersCarryingSeats(supabase, [owner])).has(owner)) {
      return { error: { success: false, error: 'Project not found or access denied' } };
    }
    return { project: { id: row.projects.id, name: row.projects.name, role: row.role } };
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .eq('name', identifier)
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return { error: { success: false, error: error.message } };
  }

  const found: Array<{ id: string; name: string; updated_at: string; role: ProjectRole }> =
    ((data ?? []) as Array<{ id: string; name: string; updated_at: string }>).map((p) => ({ ...p, role: 'owner' as const }));

  const { data: seats } = await supabase
    .from('project_members')
    .select('role, projects!inner(id, name, owner_id, updated_at)')
    .eq('user_id', userId)
    .eq('projects.name', identifier);
  const seatRows = (seats ?? []) as SeatRow[];
  const carried = seatRows.length > 0 ? await ownersCarryingSeats(supabase, seatRows.map((r) => r.projects?.owner_id ?? '')) : new Map();
  for (const seat of seatRows) {
    if (seat.projects && isProjectRole(seat.role) && carried.has(seat.projects.owner_id ?? '') && !found.some((f) => f.id === seat.projects!.id)) {
      found.push({ id: seat.projects.id, name: seat.projects.name, updated_at: seat.projects.updated_at ?? '', role: seat.role });
    }
  }
  found.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  if (found.length === 0) {
    return { error: { success: false, error: `No project found with name '${identifier}'. Use list_projects to see your available projects.` } };
  }

  if (found.length > 1) {
    const list = found.map((p) => `  ${p.id} (updated ${p.updated_at})`).join('\n');
    return { error: { success: false, error: `Multiple projects found with name '${identifier}'. Please specify the project UUID:\n${list}` } };
  }

  return { project: { id: found[0].id, name: found[0].name, role: found[0].role } };
}

/** V3 3.2 (2026-09-19): every tool that takes a branch_id resolves the
 *  project's primary branch when it is omitted. A given id is returned as
 *  is (the handler validates it against the project as before); nothing is
 *  read in that case, so callers that pass one see no new query. Null when
 *  the project has no branch at all. */
export async function resolveBranchId(
  supabase: SupabaseClient,
  projectId: string,
  branchId: string | null | undefined,
): Promise<string | null> {
  if (typeof branchId === 'string' && branchId.length > 0) return branchId;
  const primary = await getPrimaryBranch(supabase, projectId, 'id');
  return (primary as { id?: string } | null)?.id ?? null;
}
