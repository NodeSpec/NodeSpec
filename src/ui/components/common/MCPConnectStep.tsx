import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { McpConnectGuide } from './McpConnectGuide.js';

/*
  Onboarding MCP connect step (owner direction 2026-08-11; UN-gated 2026-08-29;
  offline-first 2026-08-31): detects a real MCP connection and celebrates it,
  but NEVER blocks — the community container's default context is a machine
  that may be fully offline with any of a dozen harnesses (or none yet), so
  the step says out loud that skipping is fine and everything works by hand.
  Detection is the has_mcp_connection() RPC: an unrevoked OAuth token (browser
  sign-in) or an API key with last_used_at stamped — evidence of an actual
  connection, not just intent.

  Owner ruling 2026-08-13: the instruction content is the SHARED McpConnectGuide
  (six client lanes, OAuth-first, one URL) — the same guide the in-app
  connection popup shows, so onboarding and the app can never teach different
  instructions. The old per-client content with its inline API-key mint lane
  lived here; the key fallback now rides the guide's "Other" tab.
*/

interface MCPConnectStepProps {
  isDark: boolean;
  c: Record<string, string>;
  onConnectedChange: (connected: boolean) => void;
}

export function MCPConnectStep({ isDark, c, onConnectedChange }: MCPConnectStepProps) {
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── connection polling ────────────────────────────────────────────────────
  useEffect(() => {
    if (connected) return;
    const supabase = getSupabaseClient();
    const probe = async () => {
      try {
        const { data } = await supabase.rpc('has_mcp_connection');
        if (data === true) {
          setConnected(true);
          onConnectedChange(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* transient — next poll retries */ }
    };
    void probe();
    pollRef.current = setInterval(probe, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [connected, onConnectedChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <p style={{ fontSize: '13.5px', color: c.textMuted, lineHeight: 1.6, margin: 0 }}>
        NodeSpec never runs a model of its own — your AI does the building, connected over MCP.
        Hook up the assistant you already use; the moment it connects, you're through to your
        first project.
      </p>

      {/* connection status banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
        borderRadius: '8px', fontSize: '13px', fontWeight: 600,
        border: `1px solid ${connected ? '#15803d' : c.border}`,
        backgroundColor: connected ? 'rgba(21,128,61,0.1)' : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
        color: connected ? '#15803d' : c.textMuted,
      }}>
        {connected
          ? <><Check size={16} /> Your AI is connected. You're ready to build.</>
          : <><Loader2 size={14} style={{ animation: 'spin 1.2s linear infinite' }} /> Waiting for your AI to connect… (optional — skip ahead any time)</>}
      </div>

      {!connected && (
        <div style={{
          fontSize: '12.5px', lineHeight: 1.6, color: c.textMuted,
          padding: '10px 14px', borderRadius: '8px',
          border: `1px solid ${c.border}`,
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        }}>
          <strong style={{ color: c.text }}>No AI on hand, or working offline?</strong> Skip this step —
          nothing here is required. The whole model can be built by hand on the canvas, and any
          MCP-capable assistant can connect later from the <strong>MCP disconnected</strong> button in
          the header, whenever you (and your network) are ready.
        </div>
      )}

      {!connected && <McpConnectGuide isDark={isDark} c={c} />}
    </div>
  );
}
