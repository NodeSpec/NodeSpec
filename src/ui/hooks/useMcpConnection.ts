// MCP connection listener (owner request 2026-08-13).
//
// One fact the client cannot assemble itself: "has this user's AI actually
// connected?" The evidence lives in two tables the browser deliberately cannot
// read (mcp_oauth_tokens has no client SELECT policy), so detection rides the
// has_mcp_connection() RPC — SECURITY DEFINER, self-scoped to auth.uid(),
// returning a bare boolean.
//
// Connected means EVIDENCE OF A REAL CALL, not intent: an unrevoked, unexpired
// OAuth token, or an API key whose last_used_at has been stamped by an actual
// request. Creating a key does not count until the AI uses it.
//
// The onboarding gate (MCPConnectStep) polls this same RPC on its own tight
// loop because it is waiting on a connection in real time. This hook is the
// ambient version: slower cadence, pauses when the tab is hidden, and stops
// polling once connected (a connection does not spontaneously un-happen; a
// revoke shows up on the next mount or manual refresh).
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';

const POLL_MS = 30_000;

export type McpConnectionState = 'unknown' | 'connected' | 'disconnected';

export function useMcpConnection(enabled = true): {
  state: McpConnectionState;
  refresh: () => void;
} {
  const [state, setState] = useState<McpConnectionState>('unknown');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const probe = useCallback(async () => {
    try {
      const { data, error } = await getSupabaseClient().rpc('has_mcp_connection');
      if (error) return; // transient or not-yet-migrated — leave the last known state
      if (data === true) {
        setState('connected');
        // Stop POLLING but keep the timer alive: ticks early-return while
        // stopped, and refresh() can un-stop it — so a revocation surfaced by
        // a later manual refresh resumes ambient polling instead of leaving a
        // stale amber dot with no way to recover until remount.
        stoppedRef.current = true;
      } else {
        setState('disconnected');
        stoppedRef.current = false;
      }
    } catch { /* offline — next tick retries */ }
  }, []);

  const refresh = useCallback(() => {
    stoppedRef.current = false;
    void probe();
  }, [probe]);

  useEffect(() => {
    if (!enabled) return;
    void probe();
    const tick = () => {
      if (stoppedRef.current) return;
      if (document.visibilityState !== 'visible') return;
      void probe();
    };
    timerRef.current = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) void probe();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, probe]);

  return { state, refresh };
}
