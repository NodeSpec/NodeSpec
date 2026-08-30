// S1-4 c1: server-side repository ports for the MCP tool handlers. The S1-3 split left handlers
// taking a raw structural `supabase` client and querying tables inline — the last hard Supabase
// coupling in server logic. These interfaces are the seam: handlers depend on them, and the sole
// Supabase implementation lives in ./supabase-adapter.ts (the only mcp-server file allowed to
// know the database exists once S1-4 completes).
//
// Shape discipline: methods are narrow and return supabase-style `{ data, error }` results so the
// handler logic stays a mechanical substitution of its former inline query (S1-3's verbatim
// ethos). Interfaces grow bucket-by-bucket as chunks land (c1: keys + tier).
// Edge-safe: type-only imports.
import type { PlanTier } from "../_shared/mcp-tier-gate.ts";

export interface RepoError {
  message: string;
  code?: string;
}

export interface RepoResult<T> {
  data: T | null;
  error: RepoError | null;
}

// ── api keys (tools/keys.ts) ──────────────────────────────────────────────────────────

export interface CreatedApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
}

export interface ApiKeyListRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface RevokedApiKeyRow {
  id: string;
  name: string;
  revoked_at: string;
}

export interface ApiKeysRepository {
  create(row: {
    user_id: string;
    name: string;
    key_hash: string;
    key_prefix: string;
    scopes: string[];
    expires_at: string | null;
  }): Promise<RepoResult<CreatedApiKeyRow>>;
  listByUser(userId: string): Promise<RepoResult<ApiKeyListRow[]>>;
  revoke(keyId: string, userId: string, revokedAtIso: string): Promise<RepoResult<RevokedApiKeyRow>>;
}

// ── cross-cutting services the handlers need without touching the client ─────────────

export interface TierService {
  getUserTier(userId: string): Promise<PlanTier>;
}

/** The aggregate handed to tool handlers. Grows as S1-4 chunks convert each bucket. */
export interface Repos {
  apiKeys: ApiKeysRepository;
  tier: TierService;
}
