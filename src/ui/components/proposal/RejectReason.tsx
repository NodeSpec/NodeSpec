// V3 AE.12 (owner 2026-09-25, "reason please"): a proposal rejected in the
// canvas carries the person's reason, as one rejected under Proposals does.
// The reason is what the agent reads back (get_proposal_status serves it as
// reviewNote), so it is asked for before the reject lands and never blank.
import { useState } from 'react';

export const REJECT_REASON_MAX = 500;

/** The reason as stored: trimmed, bounded; null when there is none. */
export function rejectionNote(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.length > REJECT_REASON_MAX ? trimmed.slice(0, REJECT_REASON_MAX) : trimmed;
}

export function RejectReason({ onReject, onKeep, busy, colors }: {
  onReject: (reason: string) => void;
  onKeep: () => void;
  busy: boolean;
  colors: { border: string; text: string; textMuted: string; surface: string };
}) {
  const [text, setText] = useState('');
  const note = rejectionNote(text);
  return (
    <div data-testid="reject-reason" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <label style={{ fontSize: '12.5px', fontWeight: 600, color: colors.text }}>
        Why not? Your agent reads this.
        <textarea
          data-testid="reject-reason-text"
          value={text}
          maxLength={REJECT_REASON_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="What is wrong with it, or what to do instead"
          rows={3}
          style={{
            display: 'block', width: '100%', marginTop: '6px', padding: '8px 10px', boxSizing: 'border-box',
            borderRadius: '8px', border: `1px solid ${colors.border}`, backgroundColor: colors.surface,
            color: colors.text, fontSize: '13px', fontFamily: 'inherit', resize: 'vertical',
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          data-testid="reject-reason-confirm"
          disabled={busy || !note}
          onClick={() => { if (note) onReject(note); }}
          style={{
            flex: 1, padding: '9px 14px', borderRadius: '8px', border: 'none',
            backgroundColor: '#ef4444', color: '#fff', fontSize: '12.5px', fontWeight: 700,
            cursor: busy || !note ? 'not-allowed' : 'pointer', opacity: busy || !note ? 0.6 : 1,
          }}
        >
          {busy ? 'Rejecting' : 'Reject with this reason'}
        </button>
        <button
          type="button"
          data-testid="reject-reason-keep"
          disabled={busy}
          onClick={onKeep}
          style={{
            padding: '9px 14px', borderRadius: '8px', border: `1px solid ${colors.border}`,
            backgroundColor: 'transparent', color: colors.textMuted, fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Keep reviewing
        </button>
      </div>
    </div>
  );
}
