// In-app connection popup (owner ruling 2026-08-13): the routing fix for
// "connection instructions" while logged in. Navigating to /docs/mcp is a trap
// for a signed-in user — the boot sequence yanks any session straight to /app
// — so the instructions come to the user instead: this modal hosts the SAME
// McpConnectGuide the onboarding gate shows, with live connection detection.
import { useEffect } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { McpConnectGuide } from '../common/McpConnectGuide.js';
import { useMcpConnection } from '../../hooks/useMcpConnection.js';

export function McpConnectModal({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const { state, refresh } = useMcpConnection();

  // The 30s ambient cadence is too lazy for someone actively following the
  // steps — poll faster while the modal is up (stops itself once connected).
  useEffect(() => {
    if (state === 'connected') return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [state, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const connected = state === 'connected';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10005,
        backgroundColor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Connect your AI over MCP"
        style={{
          width: 'min(560px, 94vw)', maxHeight: '86vh', overflowY: 'auto',
          backgroundColor: c.surface, border: `1px solid ${c.border}`,
          borderRadius: '12px', boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          padding: '20px 22px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: c.text }}>Connect your AI</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: '28px', height: '28px', borderRadius: '6px', border: `1px solid ${c.border}`,
              backgroundColor: 'transparent', color: c.textMuted, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* live status — same evidence rule as onboarding: a REAL call, not intent */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
          borderRadius: '8px', fontSize: '13px', fontWeight: 600, marginBottom: '14px',
          border: `1px solid ${connected ? '#15803d' : c.border}`,
          backgroundColor: connected ? 'rgba(21,128,61,0.1)' : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
          color: connected ? '#15803d' : c.textMuted,
        }}>
          {connected
            ? <><Check size={16} /> Your AI is connected. Ask it to list your NodeSpec projects.</>
            : <><Loader2 size={14} style={{ animation: 'spin 1.2s linear infinite' }} /> Waiting for your AI to connect — this updates by itself.</>}
        </div>

        {!connected && <McpConnectGuide isDark={isDark} c={c as unknown as Record<string, string>} />}
      </div>
    </div>
  );
}
