// V3 collision visibility, app side: the SAME lease board agents read from
// get_work_queue's activeHolds, assembled client-side under RLS. One read
// of active agent_checkouts (every level — task, code and criterion are
// exclusive, requirement and outcome are advisory drafting holds), labels resolved in
// batched selects, stale derived from the 30-minute heartbeat threshold
// (mirrors the server's STALE_AFTER_MS — never stored). Refreshes when a
// lease changes (AA.5: realtime on agent_checkouts) and on an interval as the
// fallback: receipts, not presence — an agent that once fetched context is
// never shown as running.
import { useMemo } from 'react';
import { useSharedPoll } from '../../hooks/useSharedPoll.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { collisionsBetween, type LeaseCollision } from './lease-collisions.js';
import { oauthClientName } from '../../../../supabase/functions/_shared/oauth-client.js';

export const PRESENCE_STALE_AFTER_MS = 30 * 60 * 1000;
export const PRESENCE_REFRESH_MS = 30 * 1000;

export type HoldLevel = 'task' | 'code' | 'requirement' | 'outcome' | 'criterion' | 'node';

export interface AgentHold {
  checkoutId: string;
  level: HoldLevel;
  advisory: boolean;
  holder: string;
  /** 7.0: who holds — an agent (a delegate) or a person (the app's session); absent reads agent. */
  kind?: 'agent' | 'human';
  /** R7: the credential behind the hold — 'key · <name>' or 'oauth · <client>'; the identity, where holder is display. */
  credential: string | null;
  /** AA.5: the holding identity ('key:…', 'oauth:…', 'user:…'): a person's own holds never lock them out. */
  delegate?: string | null;
  /** 4b.4: when that credential stops working (ISO); null = never / unknown. */
  credentialExpiresAt: string | null;
  refId: string | null;
  refLabel: string;
  /** V3 2.3: the node a task or artifact hold sits on (derived from the row's node_id), null for spec-plane holds. */
  nodeId?: string | null;
  since: string;
  stale: boolean;
  proposalId: string | null;
  meta: Record<string, unknown> | null;
}

export interface LeaseRow {
  id: string;
  level: string;
  holder_kind?: string | null;
  holder_label: string;
  holder_key_id?: string | null;
  holder_delegate?: string | null;
  task_item_id: string | null;
  artifact_id: string | null;
  requirement_id: string | null;
  candidate_id: string | null;
  /** v3u: set exactly on criterion leases — WHICH criterion in the requirement row. */
  criterion_id?: string | null;
  /** AA.5: the node a node lease locks, and the node task and code leases work inside. */
  node_id?: string | null;
  proposal_id: string | null;
  meta: Record<string, unknown> | null;
  since: string;
  heartbeat_at: string;
}

export function holdIsStale(heartbeatAt: string | null | undefined, now = Date.now()): boolean {
  if (!heartbeatAt) return false;
  return now - new Date(heartbeatAt).getTime() > PRESENCE_STALE_AFTER_MS;
}

/** "4 min" / "2 h" — the design's since line. Junk dates read as ''. */
export function sinceLabel(since: string, now = Date.now()): string {
  const ms = now - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** Mirror of the server's credentialLabel (mcp-server/shared.ts): the
 *  key's name (or id prefix), or the OAuth client. Null for humans. */
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

/** "expires in 2 d" / "expires today" / "expired" — only inside the last
 *  seven days; null otherwise, so the strip stays quiet until it matters. */
export function expiryLabel(expiresAt: string | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'credential expired';
  const days = Math.floor(ms / 86_400_000);
  if (days > 7) return null;
  if (days === 0) return 'credential expires today';
  return `credential expires in ${days} d`;
}

export function assembleHolds(
  rows: LeaseRow[],
  labels: Map<string, string>,
  now = Date.now(),
  keyNames: Map<string, string> = new Map(),
  horizons: Map<string, string | null> = new Map(),
  nodeOf: Map<string, string> = new Map(),
): AgentHold[] {
  return rows.map((l) => {
    const refId = l.task_item_id ?? l.requirement_id ?? l.candidate_id ?? l.artifact_id;
    const nodeId = l.node_id ?? nodeOf.get(l.task_item_id ?? l.artifact_id ?? '') ?? null;
    const delegate = l.holder_delegate ?? (l.holder_key_id ? `key:${l.holder_key_id}` : null);
    return {
      checkoutId: l.id,
      level: (['task', 'code', 'requirement', 'outcome', 'criterion', 'node'].includes(l.level) ? l.level : 'task') as HoldLevel,
      advisory: l.level === 'requirement' || l.level === 'outcome',
      holder: l.holder_label,
      kind: (l.holder_kind === 'human' ? 'human' : 'agent') as 'human' | 'agent',
      credential: credentialLabel(l.holder_delegate ?? (l.holder_key_id ? `key:${l.holder_key_id}` : null), keyNames),
      credentialExpiresAt: horizons.get(l.holder_delegate ?? (l.holder_key_id ? `key:${l.holder_key_id}` : '')) ?? null,
      delegate,
      refId,
      nodeId,
      // v3u: a criterion hold reads as its requirement plus WHICH criterion
      refLabel: refId
        ? (l.level === 'criterion' && l.criterion_id
          ? `${labels.get(refId) ?? refId} · criterion ${l.criterion_id}`
          : (labels.get(refId) ?? refId))
        : l.level === 'node' ? 'the node' : '—',
      since: l.since,
      stale: holdIsStale(l.heartbeat_at, now),
      proposalId: l.proposal_id,
      meta: l.meta && Object.keys(l.meta).length > 0 ? l.meta : null,
    };
  }).sort((a, b) => (a.stale === b.stale ? a.since.localeCompare(b.since) : a.stale ? 1 : -1));
}

/** V3 2.3: the holds that sit on one node, live first. Pure. */
export function holdsOnNode(holds: AgentHold[], nodeId: string): AgentHold[] {
  return holds.filter((h) => h.nodeId === nodeId);
}

export interface AgentPresence {
  holds: AgentHold[];
  /** Holds keyed by their target row id — cards look themselves up here. */
  byRef: Map<string, AgentHold[]>;
  /** 4b.5 (R8): pending git changes that touched files bound to held work — the same join get_pending_changes flags. */
  collisions: LeaseCollision[];
  pendingProposals: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

interface PresenceData {
  holds: AgentHold[];
  collisions: LeaseCollision[];
  pendingProposals: number;
}

const NO_PRESENCE: PresenceData = { holds: [], collisions: [], pendingProposals: 0 };

/** One read of the project's lease board. Throws on a failed read; the shared
 *  entry then keeps what it last showed (presence is a lens, never a blocker). */
async function loadPresence(projectId: string): Promise<PresenceData> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('agent_checkouts')
    .select('id, level, holder_kind, holder_label, holder_key_id, holder_delegate, task_item_id, artifact_id, requirement_id, candidate_id, criterion_id, node_id, proposal_id, meta, since, heartbeat_at')
    .eq('project_id', projectId)
    .is('released_at', null);
  const rows = (data ?? []) as LeaseRow[];

  const labels = new Map<string, string>();
  const nodeOf = new Map<string, string>();
  const wanted = (key: keyof LeaseRow) => [...new Set(rows.map((r) => r[key]).filter(Boolean))] as string[];
  const taskIds = wanted('task_item_id');
  if (taskIds.length > 0) {
    const { data: t } = await supabase.from('task_items').select('id, title, display_id, node_id').in('id', taskIds);
    for (const r of (t ?? []) as Array<{ id: string; title: string | null; display_id: string | null; node_id: string | null }>) {
      labels.set(r.id, [r.display_id, r.title].filter(Boolean).join(' · ') || r.id);
      if (r.node_id) nodeOf.set(r.id, r.node_id);
    }
  }
  const reqIds = wanted('requirement_id');
  if (reqIds.length > 0) {
    const { data: r } = await supabase.from('specification_requirements').select('id, requirement_id, name').in('id', reqIds);
    for (const row of (r ?? []) as Array<{ id: string; requirement_id: string; name: string }>) {
      labels.set(row.id, `${row.requirement_id} · ${row.name}`);
    }
  }
  const candIds = wanted('candidate_id');
  if (candIds.length > 0) {
    const { data: cand } = await supabase.from('requirement_candidates').select('id, name').in('id', candIds);
    for (const row of (cand ?? []) as Array<{ id: string; name: string }>) labels.set(row.id, row.name);
  }
  const artIds = wanted('artifact_id');
  if (artIds.length > 0) {
    const { data: a } = await supabase.from('artifacts').select('id, path, node_id').in('id', artIds);
    for (const row of (a ?? []) as Array<{ id: string; path: string | null; node_id: string | null }>) {
      labels.set(row.id, row.path ?? row.id);
      if (row.node_id) nodeOf.set(row.id, row.node_id);
    }
  }
  // R7: the credential behind each hold; the owner reads their own key names.
  const keyNames = new Map<string, string>();
  const keyIds = wanted('holder_key_id');
  if (keyIds.length > 0) {
    const { data: keys } = await supabase.from('mcp_api_keys').select('id, name').in('id', keyIds);
    for (const k of (keys ?? []) as Array<{ id: string; name: string | null }>) if (k.name) keyNames.set(k.id, k.name);
  }
  // 4b.4: when the owner's own credentials stop working: a self-scoped RPC,
  // no client SELECT on the token tables.
  const horizons = new Map<string, string | null>();
  const { data: hz } = await supabase.rpc('mcp_credential_horizons');
  for (const h of (hz ?? []) as Array<{ delegate: string; expires_at: string | null }>) horizons.set(h.delegate, h.expires_at);
  const assembled = assembleHolds(rows, labels, Date.now(), keyNames, horizons, nodeOf);

  let collisions: LeaseCollision[] = [];
  // 4b.5: git reality vs the board: pending commits that touched files
  // bound to held tasks/artifacts (owner-readable tables, one batch each).
  try {
    const exclusive = rows.filter((r) => r.level === 'task' || r.level === 'code' || r.level === 'node');
    const { data: pending } = exclusive.length > 0
      ? await supabase.from('git_change_events').select('id, commit_sha, author, changed_files, metadata').eq('project_id', projectId).eq('status', 'pending')
      : { data: [] };
    const events = (pending ?? []) as Array<{ id: string; commit_sha: string | null; author: string | null; changed_files: unknown; metadata?: { authors?: unknown } | null }>;
    if (events.length > 0) {
      const heldTaskIds = exclusive.map((r) => r.task_item_id).filter(Boolean) as string[];
      const { data: tasks } = heldTaskIds.length > 0
        ? await supabase.from('task_items').select('id, node_id, display_id, title').in('id', heldTaskIds)
        : { data: [] };
      const taskRows = (tasks ?? []) as Array<{ id: string; node_id: string | null; display_id: string | null; title: string | null }>;
      // AA.5: a node lease holds every file bound to its node
      const nodeIds = [...new Set([...taskRows.map((t) => t.node_id), ...exclusive.filter((r) => r.level === 'node').map((r) => r.node_id)].filter(Boolean))] as string[];
      const artifactIds = exclusive.map((r) => r.artifact_id).filter(Boolean) as string[];
      const artifacts: Array<{ id: string; node_id: string | null; path: string | null }> = [];
      if (nodeIds.length > 0) {
        const { data: a } = await supabase.from('artifacts').select('id, node_id, path').eq('project_id', projectId).in('node_id', nodeIds);
        artifacts.push(...((a ?? []) as typeof artifacts));
      }
      if (artifactIds.length > 0) {
        const { data: a } = await supabase.from('artifacts').select('id, node_id, path').in('id', artifactIds);
        for (const x of (a ?? []) as typeof artifacts) if (!artifacts.some((y) => y.id === x.id)) artifacts.push(x);
      }
      const credentialOf = new Map(assembled.map((h) => [h.checkoutId, h.credential]));
      collisions = collisionsBetween(
        events.map((e) => ({
          changeEventId: e.id, commitSha: e.commit_sha, author: e.author,
          changedFiles: Array.isArray(e.changed_files) ? e.changed_files as Array<{ path?: unknown } | string> : null,
          // AD.3: who made the commits, so a holder's own are not flagged
          authors: Array.isArray(e.metadata?.authors) ? e.metadata!.authors as Array<{ author: string; commits: string[]; files: string[] }> : null,
        })),
        exclusive.map((r) => ({ id: r.id, level: r.level, holder_label: r.holder_label, credential: credentialOf.get(r.id) ?? null, task_item_id: r.task_item_id, artifact_id: r.artifact_id, node_id: r.node_id ?? null, meta: r.meta })),
        taskRows,
        artifacts,
      );
    }
  } catch { collisions = []; }

  // The queue count beside the board: pending spec-plane proposals are
  // the agent asks waiting on the human. Two-step (branch ids, then the
  // count), no join-filter fragility.
  let pendingProposals = 0;
  const { data: branches } = await supabase.from('branches').select('id').eq('project_id', projectId);
  const branchIds = ((branches ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (branchIds.length > 0) {
    const { count } = await supabase
      .from('ai_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .in('source_branch_id', branchIds);
    pendingProposals = count ?? 0;
  }
  return { holds: assembled, collisions, pendingProposals };
}

/** AA.5: a lease taken or released shows at once; the poll stays as the fallback. */
function listenToLeases(projectId: string, poke: () => void): () => void {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(`agent-checkouts-${projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_checkouts', filter: `project_id=eq.${projectId}` }, poke)
    .subscribe();
  return () => { try { supabase.removeChannel(channel as never); } catch { /* gone */ } };
}

// AL.20: every mount on a project shares one board (GraphEditor, the Agents
// panel, the Architecture rail and Work each mounted their own). A change on
// agent_checkouts reloads it at once, so the interval slows to 4x while
// nothing changes.
export function useAgentPresence(projectId: string | null | undefined): AgentPresence {
  const { data, loading, refresh } = useSharedPoll<PresenceData>({
    key: projectId ? `presence:${projectId}` : null,
    load: () => loadPresence(projectId as string),
    empty: NO_PRESENCE,
    intervalMs: PRESENCE_REFRESH_MS,
    maxBackoff: 4,
    listen: projectId ? (poke) => listenToLeases(projectId, poke) : undefined,
  });
  const { holds, collisions, pendingProposals } = data;
  const byRef = useMemo(() => {
    const map = new Map<string, AgentHold[]>();
    for (const hold of holds) {
      if (!hold.refId) continue;
      if (!map.has(hold.refId)) map.set(hold.refId, []);
      map.get(hold.refId)!.push(hold);
    }
    return map;
  }, [holds]);
  return { holds, byRef, collisions, pendingProposals, loading, refresh };
}
