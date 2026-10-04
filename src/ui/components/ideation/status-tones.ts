/** Status tones per theme — the design's light palette swaps ink values
 *  because the dark tones fail as text on white. One module (9.11) so the
 *  boards, the queue and the verify lane read the same three inks. */
export function statusTones(mode: 'dark' | 'light') {
  return mode === 'dark'
    ? { ok: '#4ade80', warn: '#fbbf24', bad: '#f87171' }
    : { ok: '#1f7d52', warn: '#8a5a12', bad: '#a93b43' };
}
