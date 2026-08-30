// Ambient MCP connection indicator (owner request 2026-08-13).
//
// Answers "is my AI actually hooked up?" at a glance, anywhere in the app.
// Connected is proven by a real call — an unrevoked OAuth token, or an API key
// whose last_used_at has been stamped — never by intent, so a user who pasted
// config but never let their AI call sees "Not connected" and knows to finish.
//
// Deliberately quiet: a small dot on a button, muted until it matters. The
// popover carries the one-line fix and a link to the full per-client guides
// rather than restating them here.
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { useMcpConnection } from '../../hooks/useMcpConnection.js';
import { McpConnectModal } from './McpConnectModal.js';

export function McpStatusIndicator({ buttonStyle }: { buttonStyle: React.CSSProperties }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { state, refresh } = useMcpConnection();
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const connected = state === 'connected';
  const dotColor = state === 'unknown' ? c.textMuted : connected ? '#16a34a' : '#d97706';
  // Self-explanatory header label (owner UX ruling 2026-08-29): the state IS
  // the button text — no icon to decode.
  const label = state === 'unknown' ? 'MCP' : connected ? 'MCP connected' : 'MCP disconnected';
  const title = state === 'unknown'
    ? 'Checking your AI connection…'
    : connected
      ? 'Your AI is connected over MCP'
      : 'No AI connected over MCP yet';

  return (
    <div ref={wrapRef} id="nodespec-mcp-header-anchor" data-tour="mcp" style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen((o) => !o); if (!connected) refresh(); }}
        title={title}
        aria-label={title}
        style={{
          ...buttonStyle,
          width: 'auto',
          padding: '0 10px',
          gap: '7px',
          fontSize: '12px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          ...(open ? { backgroundColor: c.primary, color: '#ffffff', borderColor: c.primary } : {}),
        }}
      >
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
          backgroundColor: dotColor,
        }} />
        {label}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: '280px',
          backgroundColor: c.surface, border: `1px solid ${c.border}`,
          borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
          zIndex: 1000, padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: dotColor }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: c.text }}>
              {state === 'unknown' ? 'Checking…' : connected ? 'AI connected' : 'No AI connected'}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.55, margin: '0 0 10px' }}>
            {connected
              ? 'An assistant has authenticated and called NodeSpec. Ask it to list your projects to confirm which one.'
              : 'Connect Claude, Claude Code, Cursor, or Codex to NodeSpec so it can read your architecture and build against it.'}
          </p>
          {!connected && (
            <button
              onClick={() => { setOpen(false); setGuideOpen(true); }}
              style={{
                fontSize: '12px', fontWeight: 600, color: c.primary, cursor: 'pointer',
                background: 'none', border: 'none', padding: 0, textAlign: 'left',
              }}
            >
              Connection instructions →
            </button>
          )}
        </div>
      )}
      {guideOpen && <McpConnectModal onClose={() => { setGuideOpen(false); refresh(); }} />}
    </div>
  );
}
