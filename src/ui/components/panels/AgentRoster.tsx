// V3 R11 (owner ruling 2026-09-16): the detail behind the avatar stack.
//
// Everything the AGENTS AT WORK strip used to print above the canvas lives
// here, in the Agents popover, folded to one row per agent instead of one chip
// per lease. Nothing was dropped — the credential, the in-person marker, the
// expiry warning, the collisions and the queue link are all still here, and
// still carry the testids the lane's pins have always used.
//
// THE IDENTITY LINE IS THE POINT. The big name is what the request
// AUTHENTICATED as (a key or an oauth client); the muted name beside it is
// what the agent calls itself, which `checkout_task` accepts as free text and
// never checks. Showing the nickname as the identity would be a lie the UI
// tells on the agent's behalf, so the panel labels which is which.
import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { sinceLabel, expiryLabel, type AgentPresence } from '../ideation/useAgentPresence.js';
import { roster, workLabel } from '../ideation/agent-roster.js';
import { statusWord, ringColor } from './AgentAvatars.js';

const MONO = 'ui-monospace, Menlo, monospace';

const LEVEL_LABEL: Record<string, string> = {
  task: 'task',
  code: 'code',
  requirement: 'requirement · drafting',
  outcome: 'outcome · drafting',
  criterion: 'criterion · verifying',
};

/** "3.1k" / "41k" / "800": approximate tokens, short. Pure. */
export function tokensShort(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(n)));
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** AA.7: what this agent last read of a node it holds, beside the whole
 *  spec: "Checkout API's context: 3.1k tokens; the whole spec: 41k". The
 *  server stamps it on the reader's own lease per read. Pure. */
export function contextReadLine(holds: ReadonlyArray<{ meta?: Record<string, unknown> | null }>): string | null {
  let best: { label: string; tokens: number; whole: number; at: string } | null = null;
  for (const h of holds) {
    const r = h.meta?.contextRead as { label?: unknown; tokens?: unknown; wholeSpecTokens?: unknown; at?: unknown } | undefined;
    if (!r || typeof r.tokens !== 'number' || typeof r.wholeSpecTokens !== 'number' || typeof r.at !== 'string') continue;
    if (!best || r.at > best.at) best = { label: typeof r.label === 'string' && r.label ? r.label : 'this node', tokens: r.tokens, whole: r.wholeSpecTokens, at: r.at };
  }
  return best ? `${best.label}'s context: ${tokensShort(best.tokens)} tokens; the whole spec: ${tokensShort(best.whole)}` : null;
}

function AgentRosterComponent({ presence, onOpenQueue, showQueueLink = true }: { presence: AgentPresence; onOpenQueue?: () => void; showQueueLink?: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = theme.mode === 'dark' ? { ok: '#4ade80', warn: '#fbbf24' } : { ok: '#1f7d52', warn: '#8a5a12' };
  const warn = tones.warn;
  const people = roster(presence.holds);

  return (
    <div data-testid="agent-roster" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, letterSpacing: '.09em', color: c.primary }}>AGENTS AT WORK</span>
        <span style={{ fontSize: '11.5px', color: c.textSecondary }}>
          {people.length === 0 ? 'nobody is holding anything right now' : `${people.length} agent${people.length === 1 ? '' : 's'} · ${presence.holds.length} lease${presence.holds.length === 1 ? '' : 's'}`}
        </span>
        <span style={{ flex: 1 }} />
        {showQueueLink && presence.pendingProposals > 0 && (
          <button
            data-testid="presence-open-queue"
            onClick={onOpenQueue}
            disabled={!onOpenQueue}
            style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, color: c.primary, background: 'transparent', border: 'none', padding: 0, cursor: onOpenQueue ? 'pointer' : 'default' }}
          >
            {presence.pendingProposals} pending proposal{presence.pendingProposals === 1 ? '' : 's'} in the queue{onOpenQueue ? ' →' : ''}
          </button>
        )}
      </div>

      {people.map((p) => (
        <div
          key={p.id}
          data-testid="agent-roster-row"
          data-status={p.status}
          style={{ display: 'flex', gap: '10px', padding: '9px 11px', borderRadius: '10px', border: `1px solid ${c.border}66`, backgroundColor: c.surface }}
        >
          <span style={{
            width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: `hsl(${p.hue} 52% ${theme.mode === 'dark' ? 62 : 42}%)`, color: '#fff',
            fontFamily: MONO, fontSize: '10px', fontWeight: 700,
            boxShadow: `0 0 0 2px ${ringColor(p.status, c.primary, tones.ok, warn)}`,
          }}>{p.initials}</span>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', flexWrap: 'wrap' }}>
              {/* The proven identity leads. */}
              <span data-testid="hold-credential" title="The credential this agent authenticated with — this is the identity" style={{ fontSize: '12.5px', fontWeight: 650, color: c.text }}>
                {p.credential ?? p.label}
              </span>
              {p.credential && p.label && p.label !== p.credential && (
                <span data-testid="agent-nickname" title="The name the agent gave itself (external_agent). Free text — never verified." style={{ fontFamily: MONO, fontSize: '10.5px', color: c.textSecondary }}>
                  calls itself “{p.label}”
                </span>
              )}
              {p.kind === 'human' && (
                <span data-testid="hold-kind" title="Held in person — a teammate's session, not an agent" style={{ fontFamily: MONO, fontSize: '10.5px', color: c.textSecondary }}>in person</span>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: MONO, fontSize: '10.5px', fontWeight: 700, color: ringColor(p.status, c.primary, tones.ok, warn) }}>
                {statusWord[p.status]}
              </span>
              <span style={{ fontFamily: MONO, fontSize: '10.5px', color: c.textSecondary }}>{sinceLabel(p.since)}</span>
            </div>

            <div style={{ fontSize: '11.5px', color: c.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{workLabel(p)}</div>
            {contextReadLine(p.holds) && (
              <div data-testid="agent-context-read" title="What this agent last read of the node it holds, beside the whole specification, in approximate tokens" style={{ fontFamily: MONO, fontSize: '10.5px', color: c.textSecondary }}>
                {contextReadLine(p.holds)}
              </div>
            )}

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {p.holds.map((hold) => (
                <span key={hold.checkoutId} data-testid="agent-roster-hold" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: MONO, fontSize: '10px', color: hold.stale ? warn : c.textSecondary, border: `1px solid ${hold.stale ? warn : c.border}`, borderRadius: '5px', padding: '1px 5px' }}>
                  {LEVEL_LABEL[hold.level] ?? hold.level}
                  <span style={{ color: hold.stale ? warn : c.textSecondary }}>
                    {hold.stale ? 'stale — claimable' : sinceLabel(hold.since)}
                  </span>
                  {typeof hold.meta?.commitSha === 'string' && (
                    <span data-testid="hold-commit" title="The commit this agent last reported working at">@{String(hold.meta.commitSha).slice(0, 7)}</span>
                  )}
                </span>
              ))}
              {expiryLabel(p.credentialExpiresAt) && (
                <span data-testid="hold-expiry" title="This credential is about to stop working — the agent will lose access mid-task" style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, color: warn }}>
                  {expiryLabel(p.credentialExpiresAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}

      {presence.collisions.map((col) => (
        <div
          key={`${col.changeEventId}:${col.checkoutId}`}
          data-testid="lease-collision"
          title={`A pending commit${col.by.length > 0 ? ` by ${col.by.join(', ')}` : ''} touched ${col.paths.join(', ')}: bound to work ${col.holder} holds. Resolve the change with the holder before it lands.`}
          style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 10px', borderRadius: '9px', border: `1px solid ${warn}`, backgroundColor: `${warn}12`, fontSize: '11.5px', color: c.text }}
        >
          <span style={{ fontFamily: MONO, fontSize: '10.5px', fontWeight: 700, color: warn }}>COLLISION</span>
          <span style={{ fontFamily: MONO, fontSize: '10.5px', color: c.textSecondary }}>{col.commitSha ? col.commitSha.slice(0, 7) : 'pending change'}</span>
          {col.by.length > 0 && <span style={{ fontWeight: 600 }}>{col.by.join(', ')}</span>}
          <span style={{ color: c.textSecondary }}>touched</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.paths[0]}{col.paths.length > 1 ? ` +${col.paths.length - 1}` : ''}</span>
          <span style={{ color: c.textSecondary }}>held by</span>
          <span style={{ fontWeight: 600 }}>{col.holder}</span>
          <span style={{ color: c.textSecondary }}>({col.refLabel})</span>
        </div>
      ))}
    </div>
  );
}

export const AgentRoster = memo(AgentRosterComponent);
