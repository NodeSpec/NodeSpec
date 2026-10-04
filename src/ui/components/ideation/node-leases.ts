// AA.5 (owner 2026-09-23): "if a node is leased, then it is locked", app side.
//
// The lease board (useAgentPresence) holds every active lease with the node
// it sits on. A node is locked for a person when anyone other than them holds
// a fresh lease there: the node lease (its structure) or work inside it. This
// module answers the three questions the app asks, pure:
//
//   - which nodes are leased, by whom, since when (the canvas badge, the rail);
//   - would these patches change a node someone else holds (the canvas edit,
//     refused before it is emitted; the accept of a proposal, refused before
//     it is applied);
//   - what a work lease reaches, in words (the rail and the Plan).
//
// Moving or resizing a node is layout, not structure, and is never refused.
// The app claims nothing: a lease is taken by an agent over MCP.
import { patchTargets, layoutOnly } from '@nodespec/core/patch-targets.js';
import { sinceLabel, type AgentHold } from './useAgentPresence.js';

export interface NodeLease {
  nodeId: string;
  /** Who the badge names: the node lease's holder, else the earliest work lease's. */
  holder: string;
  level: 'node' | 'work';
  since: string;
  /** Fresh leases on the node. */
  count: number;
  /** Every fresh lease there is the viewer's own: nothing is locked for them. */
  mine: boolean;
}

const LOCKING = new Set(['node', 'task', 'code']);

/** Fresh leases, per node. A stale lease locks nothing. */
export function nodeLeases(holds: readonly AgentHold[], myDelegate?: string | null): Map<string, NodeLease> {
  const out = new Map<string, NodeLease>();
  const sorted = [...holds].filter((h) => !h.stale && h.nodeId && LOCKING.has(h.level)).sort((a, b) => a.since.localeCompare(b.since));
  for (const h of sorted) {
    const mine = !!myDelegate && h.delegate === myDelegate;
    const cur = out.get(h.nodeId!);
    if (!cur) {
      out.set(h.nodeId!, { nodeId: h.nodeId!, holder: h.holder, level: h.level === 'node' ? 'node' : 'work', since: h.since, count: 1, mine });
      continue;
    }
    cur.count += 1;
    cur.mine = cur.mine && mine;
    if (h.level === 'node' && cur.level !== 'node') { cur.holder = h.holder; cur.level = 'node'; cur.since = h.since; }
  }
  return out;
}

/** "cb" for "claude · bench": the first letters of the first two words (the badge sets the case in CSS). */
export function leaseInitials(holder: string): string {
  const words = holder.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join('') || '?';
}

/** The badge's words. Pure. */
export function leaseLine(lease: Pick<NodeLease, 'holder' | 'level' | 'since' | 'count'>, now = Date.now()): string {
  const since = sinceLabel(lease.since, now);
  const when = since ? (since === 'now' ? ' just now' : ` ${since} ago`) : '';
  const others = lease.count > 1 ? ` (${lease.count} leases)` : '';
  return lease.level === 'node'
    ? `Leased by ${lease.holder}${when}${others}: the node is locked while the lease lasts.`
    : `${lease.holder} is working inside this node${when}${others}: its structure is locked until the work ends.`;
}

/** What a work lease reaches, in words: its files, or the whole node. Null for other levels. */
export function reachLine(hold: Pick<AgentHold, 'level' | 'meta'>): string | null {
  if (hold.level === 'node') return 'Locks the node';
  if (hold.level !== 'task' && hold.level !== 'code') return null;
  const reach = Array.isArray(hold.meta?.reach) ? (hold.meta!.reach as unknown[]).map(String) : null;
  if (!reach || reach.length === 0 || reach.includes('*')) return 'Reaches the whole node';
  const files = reach.filter((r) => !r.startsWith('criterion:') && !r.startsWith('task:'));
  if (files.length === 0) return 'Reaches the criteria it serves';
  return `Reaches ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`;
}

/**
 * The refusal for patches that change a node someone else holds, or null.
 * `resolve` maps a target the patch names (an edge, an artifact) to the
 * nodes it belongs to; nodes resolve to themselves. Pure.
 */
export function leasedEditRefusal(
  patches: ReadonlyArray<{ type: string; payload?: unknown }>,
  leases: ReadonlyMap<string, Pick<NodeLease, 'holder' | 'since' | 'level' | 'mine'>>,
  opts: {
    resolve?: (id: string) => string[];
    labelOf?: (nodeId: string) => string;
    now?: number;
    /** AA.3: the box a node is a part of, when it is one: the box's node lease covers its parts. */
    boxOf?: (nodeId: string) => string | null;
  } = {},
): string | null {
  if (leases.size === 0) return null;
  for (const p of patches) {
    if (layoutOnly(p)) continue;
    const t = patchTargets(p as never);
    const ids = [t.primary, ...t.touched].filter((x): x is string => !!x);
    const nodes = new Set(ids.flatMap((id) => (leases.has(id) ? [id] : (opts.resolve?.(id) ?? []))));
    for (const n of nodes) {
      const lease = leases.get(n);
      if (!lease || lease.mine) continue;
      const since = sinceLabel(lease.since, opts.now);
      const label = opts.labelOf?.(n) ?? 'This node';
      return `${label} is ${lease.level === 'node' ? 'leased' : 'being worked on'} by ${lease.holder}${since ? ` (since ${since === 'now' ? 'just now' : `${since} ago`})` : ''}. A leased node is locked: wait for the lease to end, or ask its holder to release it.`;
    }
    // AA.3: a part is covered by its box's node lease (the part itself holds none).
    const touched = new Set([...ids, ...ids.flatMap((id) => opts.resolve?.(id) ?? [])]);
    for (const n of touched) {
      const box = opts.boxOf?.(n);
      const lease = box ? leases.get(box) : undefined;
      if (!box || !lease || lease.mine || lease.level !== 'node') continue;
      const since = sinceLabel(lease.since, opts.now);
      return `${opts.labelOf?.(n) ?? 'This part'} is a part of ${opts.labelOf?.(box) ?? 'a node'}, which is leased by ${lease.holder}${since ? ` (since ${since === 'now' ? 'just now' : `${since} ago`})` : ''}. A box's lease covers its parts: wait for the lease to end, or ask its holder to release it.`;
    }
  }
  return null;
}

/** AL.11: the accept-time lock, read against the graph as it stands. A file
 *  counts as the node it sits on (a task document is its node's work) and
 *  an edge as its two ends; a box's node lease covers its parts. */
export function acceptLeaseRefusal(
  patches: ReadonlyArray<{ type: string; payload?: unknown }>,
  rows: readonly LeaseRowLite[],
  exempt: ReadonlyArray<string | null | undefined>,
  graph: {
    nodes?: Record<string, { parentId?: string | null }>;
    edges?: Record<string, { source?: string | null; target?: string | null }>;
    artifacts?: Record<string, { nodeId?: string | null }>;
  } | null,
  isBox?: (nodeId: string) => boolean,
  now = Date.now(),
): string | null {
  const leases = leasesFromRows(rows, exempt, now);
  if (leases.size === 0) return null;
  const resolve = (id: string): string[] => {
    const file = graph?.artifacts?.[id];
    if (file?.nodeId) return [file.nodeId];
    const edge = graph?.edges?.[id];
    return edge ? [edge.source, edge.target].filter((x): x is string => !!x) : [];
  };
  const boxOf = isBox
    ? (nodeId: string) => {
      const parentId = graph?.nodes?.[nodeId]?.parentId;
      return parentId && isBox(parentId) ? parentId : null;
    }
    : undefined;
  return leasedEditRefusal(patches, leases, { resolve, boxOf, now });
}

/** A lease row as the accept path reads it. */
export interface LeaseRowLite {
  level: string;
  node_id: string | null;
  holder_label: string;
  holder_delegate: string | null;
  holder_key_id?: string | null;
  since: string;
  heartbeat_at: string;
}

/**
 * Fresh leases per node from raw rows, with the given identities exempt (the
 * proposing agent's credential, the accepting person): their own leases never
 * lock their own change. Pure.
 */
export function leasesFromRows(rows: readonly LeaseRowLite[], exempt: ReadonlyArray<string | null | undefined>, now = Date.now()): Map<string, NodeLease> {
  const mineIds = new Set(exempt.filter((x): x is string => !!x));
  const holds = rows.map((r) => ({
    checkoutId: '', level: r.level as AgentHold['level'], advisory: false, holder: r.holder_label, credential: null, credentialExpiresAt: null,
    delegate: r.holder_delegate ?? (r.holder_key_id ? `key:${r.holder_key_id}` : null),
    refId: null, refLabel: '', nodeId: r.node_id, since: r.since, stale: now - new Date(r.heartbeat_at).getTime() > 30 * 60 * 1000, proposalId: null, meta: null,
  } satisfies AgentHold));
  const byNode = nodeLeases(holds, null);
  for (const [nodeId, lease] of byNode) {
    const fresh = holds.filter((h) => h.nodeId === nodeId && !h.stale && LOCKING.has(h.level));
    lease.mine = fresh.every((h) => !!h.delegate && mineIds.has(h.delegate));
  }
  return byNode;
}
