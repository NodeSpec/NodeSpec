// V3 I (owner ruling 2026-09-21): the person's connected agents, as the
// Connected tab reads them. One list on both lanes: API keys the person
// minted for their agents and OAuth clients they approved in the browser,
// with the plan's allowance the server counted (community one, Indie and
// above five per person). The hook only carries what list_api_keys said;
// the mint and the revoke go back through the same tools and re-read.
import { useCallback, useEffect, useRef, useState } from 'react';
import { callMcpToolAsUser, type McpToolResult } from '../../services/agent-connections.js';
import { agentConnectionCapMessage } from '../../config/feature-rules.js';
import type { PlanTier } from '../../config/tiers.js';
import { oauthClientKnownName } from '../../../../supabase/functions/_shared/oauth-client.js';

export type ConnectionKind = 'key' | 'oauth';

export interface AgentConnection {
  kind: ConnectionKind;
  /** The key's UUID, or the OAuth client_id: what revoke_api_key takes. */
  id: string;
  /** The key's name (the lease board's identity), or the client's registered name. */
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** The wire shape list_api_keys answers with (mcp-server/tools/keys.ts). */
export interface ListApiKeysData {
  apiKeys: Array<{ keyId: string; name: string; lastUsedAt: string | null; expiresAt: string | null; createdAt: string; isActive: boolean }>;
  oauthClients: Array<{ clientId: string; clientName: string | null; lastUsedAt: string | null; expiresAt: string | null; createdAt: string }>;
  connections: { active: number; limit: number; tier: PlanTier; allowance: string };
}

export interface ConnectionsSnapshot {
  rows: AgentConnection[];
  active: number;
  limit: number;
  tier: PlanTier;
  allowance: string;
}

export type ConnectResult = { apiKey: string; keyId: string; name: string } | { error: string };
export type RevokeResult = { ok: true; leasesReleased: number } | { error: string };

export interface AgentConnections extends ConnectionsSnapshot {
  loading: boolean;
  error: string | null;
  /** The plan's allowance is spent: the connect door is shut until a revoke. */
  atCap: boolean;
  capMessage: string;
  refresh: () => Promise<void>;
  connect: (input: { name: string; expiresInDays: number | null }) => Promise<ConnectResult>;
  revoke: (row: AgentConnection) => Promise<RevokeResult>;
}

const EMPTY: ConnectionsSnapshot = { rows: [], active: 0, limit: 1, tier: 'community', allowance: '' };

/** Pure: the wire shape to the tab's rows. Revoked and expired keys are not
 *  connections and do not appear; an unregistered OAuth client is named by
 *  its id's prefix so the row is never blank. Oldest connection first. */
export function foldConnections(data: ListApiKeysData): ConnectionsSnapshot {
  const rows: AgentConnection[] = [];
  for (const k of data.apiKeys ?? []) {
    if (!k.isActive) continue;
    rows.push({ kind: 'key', id: k.keyId, name: k.name, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, createdAt: k.createdAt });
  }
  for (const c of data.oauthClients ?? []) {
    rows.push({ kind: 'oauth', id: c.clientId, name: c.clientName?.trim() || oauthClientKnownName(c.clientId) || `client ${c.clientId.slice(0, 8)}`, lastUsedAt: c.lastUsedAt, expiresAt: c.expiresAt, createdAt: c.createdAt });
  }
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const c = data.connections ?? { active: rows.length, limit: 1, tier: 'community' as PlanTier, allowance: '' };
  return { rows, active: c.active, limit: c.limit, tier: c.tier, allowance: c.allowance };
}

export type McpCall = <T>(name: string, args?: Record<string, unknown>) => Promise<McpToolResult<T>>;

export function useAgentConnections(enabled: boolean, call: McpCall = callMcpToolAsUser): AgentConnections {
  const [snapshot, setSnapshot] = useState<ConnectionsSnapshot>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await call<ListApiKeysData>('list_api_keys');
    if (!alive.current) return;
    if (r.ok) {
      setSnapshot(foldConnections(r.data));
      setError(null);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, [call]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const connect = useCallback(async (input: { name: string; expiresInDays: number | null }): Promise<ConnectResult> => {
    const args: Record<string, unknown> = { name: input.name.trim() };
    if (input.expiresInDays && input.expiresInDays > 0) args.expires_in_days = input.expiresInDays;
    const r = await call<{ apiKey: string; keyId: string; name: string }>('create_api_key', args);
    if (!r.ok) return { error: r.error };
    void refresh();
    return { apiKey: r.data.apiKey, keyId: r.data.keyId, name: r.data.name };
  }, [call, refresh]);

  const revoke = useCallback(async (row: AgentConnection): Promise<RevokeResult> => {
    const args = row.kind === 'key' ? { key_id: row.id } : { client_id: row.id };
    const r = await call<{ leasesReleased?: number }>('revoke_api_key', args);
    if (!r.ok) return { error: r.error };
    void refresh();
    return { ok: true, leasesReleased: r.data?.leasesReleased ?? 0 };
  }, [call, refresh]);

  const atCap = snapshot.active >= snapshot.limit;
  return {
    ...snapshot,
    loading,
    error,
    atCap,
    capMessage: agentConnectionCapMessage(snapshot.tier),
    refresh,
    connect,
    revoke,
  };
}
