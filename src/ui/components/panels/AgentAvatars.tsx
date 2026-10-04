// V3 R11 (owner ruling 2026-09-16): who is working, as a stack of faces on the
// Agents button.
//
// One avatar per AGENT, not per lease — see agent-roster.ts for why the
// credential is the identity and the name is only a nickname. Up to three
// stack, overlapping, newest in front; the rest collapse into a "+N" disc.
// A new agent appearing, or one changing status, animates in rather than
// popping, which is the point of putting it on a button: the header tells you
// something changed without anything moving on the canvas.
import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { workLabel, type AgentPrincipal, type AgentStatus } from '../ideation/agent-roster.js';

const MONO = 'ui-monospace, Menlo, monospace';
const SIZE = 24;
const OVERLAP = 6;
export const MAX_FACES = 3;

/** The ring around a face: what this agent is doing, at a glance. */
export function ringColor(status: AgentStatus, primary: string, ok: string, warn: string): string {
  return status === 'working' ? ok : status === 'drafting' ? primary : warn;
}

export const statusWord: Record<AgentStatus, string> = {
  working: 'working',
  drafting: 'drafting',
  stale: 'gone quiet',
};

function Avatar({ principal, index, surface }: { principal: AgentPrincipal; index: number; surface: string }) {
  const { theme } = useTheme();
  const tones = theme.mode === 'dark'
    ? { ok: '#4ade80', warn: '#fbbf24' }
    : { ok: '#1f7d52', warn: '#8a5a12' };
  const ring = ringColor(principal.status, theme.colors.primary, tones.ok, tones.warn);
  const light = theme.mode === 'dark' ? 62 : 42;
  return (
    <span
      data-testid="agent-avatar"
      data-status={principal.status}
      title={`${principal.credential ?? principal.label} — ${statusWord[principal.status]} · ${workLabel(principal)}`}
      style={{
        width: `${SIZE}px`, height: `${SIZE}px`, borderRadius: '50%', flexShrink: 0,
        marginLeft: index === 0 ? 0 : `-${OVERLAP}px`, zIndex: MAX_FACES - index,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: `hsl(${principal.hue} 52% ${light}%)`,
        color: '#fff', fontFamily: MONO, fontSize: '9px', fontWeight: 700, letterSpacing: '.02em',
        // The ring is the status; the surface-coloured gap keeps the stack readable.
        boxShadow: `0 0 0 1.5px ${surface}, 0 0 0 2.5px ${ring}`,
        opacity: principal.status === 'stale' ? 0.55 : 1,
        animation: 'nsAvatarIn .24s ease-out',
      }}
    >
      {principal.initials}
    </span>
  );
}

/** The stack itself — nothing clickable: it rides on the Agents button. */
function AgentAvatarsComponent({ principals }: { principals: AgentPrincipal[] }) {
  const { theme } = useTheme();
  const c = theme.colors;
  if (principals.length === 0) return null;
  const faces = principals.slice(0, MAX_FACES);
  const rest = principals.length - faces.length;
  return (
    <span data-testid="agent-avatars" style={{ display: 'inline-flex', alignItems: 'center', margin: '0 4px 0 2px' }}>
      {faces.map((p, i) => <Avatar key={p.id} principal={p} index={i} surface={c.surface} />)}
      {rest > 0 && (
        <span
          data-testid="agent-avatar-more"
          title={principals.slice(MAX_FACES).map((p) => p.credential ?? p.label).join(', ')}
          style={{
            width: `${SIZE}px`, height: `${SIZE}px`, borderRadius: '50%', flexShrink: 0,
            // Clear of the last face: overlapped like the others it read as a
            // smudge rather than a count.
            marginLeft: '2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: c.background, color: c.textSecondary,
            fontFamily: MONO, fontSize: '9.5px', fontWeight: 700,
            boxShadow: `0 0 0 1.5px ${c.border}`,
          }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

export const AgentAvatars = memo(AgentAvatarsComponent);
