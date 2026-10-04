// V3 R11 (owner ruling 2026-09-16): who is working, folded to ONE ROW PER
// AGENT instead of one row per lease.
//
// The strip this replaces printed a chip per HOLD, eight fields wide. One
// agent holding three things filled the line by itself, and the line sat above
// the canvas in every Ideation mode. The fix is not smaller text: it is that a
// hold is not a who. An agent is.
//
// WHICH IDENTITY DO WE ACTUALLY HAVE? The owner asked, and it matters, because
// the two things the MCP boundary records are not equally trustworthy:
//
//   holder_label      SELF-DECLARED. checkout_task takes `external_agent` as
//                     free text and stores it verbatim; with no JWT and no
//                     value it lands as the literal "unknown agent". Nothing
//                     validates it. It is a NICKNAME.
//   holder_delegate   PROVEN. The credential the request authenticated with —
//     / holder_key_id 'key:<uuid>' → `key · <the key's name>`, 'oauth:<client>'
//                     → `oauth · <client>`, 'user:<id>' → a person in the app.
//                     The caller cannot choose this; the transport decides it.
//
// So the roster keys on the CREDENTIAL. Two connections presenting the same
// key are one principal however they name themselves, and an agent cannot
// split itself in two — or impersonate another — by changing a string. The
// nickname still shows, as a nickname, because it is what the human recognises.
// A person holding through the app has no credential; they key on their own
// identity and are marked as a person.
import type { AgentHold } from './useAgentPresence.js';

export type AgentStatus = 'working' | 'drafting' | 'stale';

export interface AgentPrincipal {
  /** Stable across renders and across reconnects: the proven credential. */
  id: string;
  /** What the request authenticated AS. Null for a person in the app. */
  credential: string | null;
  /** What it calls itself. Claimed, never proven — display only. */
  label: string;
  kind: 'agent' | 'human';
  holds: AgentHold[];
  /** Oldest live hold — "working for 20 min", not "claimed this 2 s ago". */
  since: string;
  status: AgentStatus;
  /** Two letters for the avatar, from the PROVEN name where there is one. */
  initials: string;
  /** Deterministic 0–359: the same principal is the same colour, always. */
  hue: number;
  /** Set when this agent's credential is about to stop working mid-task. */
  credentialExpiresAt: string | null;
}

/** FNV-1a over the principal key — stable across sessions and machines, which
 *  a hash of the array index or a palette cursor would not be. */
export function hueOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/** "CI runner" → "CR"; "claude-code" → "CC"; one word → its first two. An
 *  email is its LOCAL part, or every address at one domain reads the same. */
export function initialsOf(name: string): string {
  const bare = name.replace(/^(key|oauth)\s*·\s*/i, '');
  const local = bare.includes('@') ? bare.slice(0, bare.indexOf('@')) : bare;
  const words = local.split(/[\s\-_.·]+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** A hold on a task or an artifact is real work; requirement and outcome holds
 *  are advisory drafting. An agent whose every hold has gone quiet is stale. */
function statusOf(holds: AgentHold[]): AgentStatus {
  const live = holds.filter((h) => !h.stale);
  if (live.length === 0) return 'stale';
  return live.some((h) => !h.advisory) ? 'working' : 'drafting';
}

const earliest = (holds: AgentHold[]): string =>
  holds.map((h) => h.since).sort()[0] ?? '';

/** One row per principal, busiest first — the order the avatars stack in. */
export function roster(holds: AgentHold[]): AgentPrincipal[] {
  const groups = new Map<string, AgentHold[]>();
  for (const h of holds) {
    // The credential is the identity. Without one (a person in the app) the
    // label is all there is, so it is scoped by kind to keep a human named
    // "claude" from merging with an agent that calls itself the same.
    const key = h.credential ?? `${h.kind ?? 'agent'}:${h.holder}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(h);
  }

  const out: AgentPrincipal[] = [];
  for (const [id, list] of groups) {
    const kind = list.some((h) => h.kind === 'human') ? 'human' : 'agent';
    const credential = list.find((h) => h.credential)?.credential ?? null;
    // The nickname of the most recent hold — an agent may rename itself
    // between claims, and the newest is the one the human just saw.
    const label = list.slice().sort((a, b) => b.since.localeCompare(a.since))[0].holder;
    out.push({
      id,
      credential,
      label,
      kind,
      holds: list,
      since: earliest(list),
      status: statusOf(list),
      initials: initialsOf(credential ?? label),
      hue: hueOf(id),
      credentialExpiresAt: list.find((h) => h.credentialExpiresAt)?.credentialExpiresAt ?? null,
    });
  }

  const RANK: Record<AgentStatus, number> = { working: 0, drafting: 1, stale: 2 };
  return out.sort((a, b) =>
    RANK[a.status] - RANK[b.status] || b.holds.length - a.holds.length || a.id.localeCompare(b.id));
}

/** What the avatar's tooltip and the roster row say it is doing. */
export function workLabel(p: AgentPrincipal): string {
  if (p.holds.length === 0) return 'nothing held';
  const first = p.holds[0];
  const more = p.holds.length - 1;
  return `${first.refLabel}${more > 0 ? ` +${more} more` : ''}`;
}
