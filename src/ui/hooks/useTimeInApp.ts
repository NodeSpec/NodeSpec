// Time in app (owner 2026-09-29): how long people use the app, on the managed
// service only. While a signed-in tab is on /app, is visible and has been used
// in the last five minutes, it sends one heartbeat a minute to
// app_session_beat. The server credits the time since the last beat (at most
// 90 seconds) and starts a new session after a 30 minute gap, so the count is
// the server's, not the tab's. Nothing about the project or what the person
// did is sent: a heartbeat carries only its session id.
import { useEffect } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import { isHostedEdition } from '../config/edition.js';

export const BEAT_MS = 60_000;
export const IDLE_MS = 5 * 60_000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** Whether this minute counts: the tab is visible, on the app, and was used recently. */
export function shouldBeat(s: { visible: boolean; path: string; now: number; lastInputAt: number }): boolean {
  return s.visible && (s.path === '/app' || s.path.startsWith('/app/')) && s.now - s.lastInputAt <= IDLE_MS;
}

export interface BeatClient {
  rpc(fn: 'app_session_beat', args: { p_session: string | null }): PromiseLike<{ data: unknown; error: unknown }>;
}

interface Env {
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'> & { location: { pathname: string } };
  doc: { visibilityState: string };
  now: () => number;
}

/** Starts the heartbeat and returns the function that stops it. */
export function startTimeInApp(client: BeatClient, env: Env = { win: window, doc: document, now: () => Date.now() }): () => void {
  const { win, doc, now } = env;
  let session: string | null = null;
  let lastInputAt = now();
  let inflight = false;
  const onInput = () => { lastInputAt = now(); };
  for (const e of INPUT_EVENTS) win.addEventListener(e, onInput, { passive: true });
  const beat = async () => {
    if (inflight) return;
    if (!shouldBeat({ visible: doc.visibilityState === 'visible', path: win.location.pathname, now: now(), lastInputAt })) return;
    inflight = true;
    try {
      const { data } = await client.rpc('app_session_beat', { p_session: session });
      // Only an opened or kept session answers an id. A refused beat has no
      // data, and a self-hosted database answers null and records nothing.
      if (typeof data === 'string') session = data;
    } catch {
      // Counting time never gets in the way of the app.
    } finally {
      inflight = false;
    }
  };
  const timer = win.setInterval(() => { void beat(); }, BEAT_MS);
  void beat();
  return () => {
    win.clearInterval(timer);
    for (const e of INPUT_EVENTS) win.removeEventListener(e, onInput);
  };
}

/** Mounted once for the signed-in app; does nothing outside the managed build. */
export function useTimeInApp(userId: string | null): void {
  useEffect(() => {
    if (!isHostedEdition || !userId) return;
    return startTimeInApp(getSupabaseClient() as unknown as BeatClient);
  }, [userId]);
}
