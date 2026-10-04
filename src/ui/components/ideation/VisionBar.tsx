// The project VISION, at the head of the Workflow board.
//
// It used to sit in the Spec sidebar, one panel away from everything it
// governs. It belongs here: a workflow's lanes, outcomes and requirements are
// all answers to it, and a board whose first line is the product's intent
// reads as a considered surface rather than a grid of empty frames.
//
// Renders and asks. The hook owns the read and the write, and a refusal comes
// back in the database's own words.
import { useEffect, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { statusTones } from './status-tones.js';
import { eyebrow, body, meta, title } from './typography.js';

export interface VisionBarProps {
  vision: string;
  /** null on success, else the refusal. */
  onSave: (vision: string) => Promise<string | null>;
  /** Nothing to write against yet. */
  disabled?: boolean;
}

export function VisionBar({ vision, onSave, disabled = false }: VisionBarProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(null); setError(null); }, [vision]);

  const commit = async () => {
    if (draft === null) return;
    if (draft.trim() === vision.trim()) { setDraft(null); return; }
    setBusy(true);
    const refusal = await onSave(draft);
    setBusy(false);
    if (refusal) { setError(refusal); return; }
    setDraft(null);
  };

  // The head of the board, and the one line that governs everything under it,
  // so it is given the weight of a masthead: a tinted plate, a colour rule on
  // its left edge, and the vision itself set at reading size rather than at
  // the size of a caption.
  const framed: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '8px',
    padding: '14px 16px 15px',
    borderRadius: '14px',
    border: `1px solid ${c.border}`,
    borderLeft: `3px solid ${c.primary}`,
    backgroundColor: c.surface,
    backgroundImage: theme.mode === 'dark'
      ? `linear-gradient(100deg, ${c.primary}1f 0%, ${c.primary}08 38%, rgba(255,255,255,0) 72%)`
      : `linear-gradient(100deg, ${c.primary}14 0%, ${c.primary}06 38%, rgba(255,255,255,0) 72%)`,
    boxShadow: theme.mode === 'dark'
      ? 'inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 26px -20px rgba(0,0,0,0.8)'
      : 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px -20px rgba(16,24,40,0.35)',
  };
  // The written vision is read, so it gets the reading size; the invitation to
  // write one is guidance, so it stays at body size.
  const visionType: React.CSSProperties = vision
    ? { ...title(c.text), fontSize: '15px', fontWeight: 600, lineHeight: 1.45, letterSpacing: '-0.01em', maxWidth: '78ch' }
    : { ...body(c.textMuted), maxWidth: '78ch' };

  return (
    <div data-testid="vision-bar" style={framed}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <Eye size={13} style={{ color: c.primary, flexShrink: 0 }} />
        <span style={eyebrow(c.primary)}>Vision</span>
        <span style={{ flex: 1 }} />
        {draft === null && !disabled && (
          <button
            data-testid="vision-edit"
            onClick={() => { setDraft(vision); setError(null); }}
            title={vision ? 'Edit the vision' : 'Write the vision'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              border: `1px solid ${c.border}`, borderRadius: '8px', padding: '4px 10px',
              backgroundColor: c.surface, cursor: 'pointer',
              transition: 'border-color 0.15s ease, color 0.15s ease',
              ...meta(c.textSecondary), fontWeight: 600,
            }}
          >
            <Pencil size={11} />
            {vision ? 'Edit' : 'Write it'}
          </button>
        )}
      </div>

      {draft === null ? (
        <div data-testid="vision-text" style={visionType}>
          {vision || 'No vision yet. One or two sentences on what this product is for. Every lane, outcome and requirement below is an answer to it.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <textarea
            data-testid="vision-input"
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setDraft(null); setError(null); }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit();
            }}
            rows={3}
            placeholder="In one or two sentences, what is this product for?"
            style={{
              ...body(c.text),
              fontFamily: 'inherit',
              padding: '8px 10px', borderRadius: '8px',
              border: `1px solid ${c.border}`, backgroundColor: c.background,
              resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
            <button
              data-testid="vision-save"
              disabled={busy}
              onClick={() => void commit()}
              style={{
                ...meta('#fff'), fontWeight: 650,
                border: 'none', borderRadius: '7px', padding: '5px 12px',
                backgroundColor: c.primary, cursor: busy ? 'wait' : 'pointer',
              }}
            >
              Save
            </button>
            <button
              data-testid="vision-cancel"
              onClick={() => { setDraft(null); setError(null); }}
              style={{
                ...meta(c.textSecondary),
                border: `1px solid ${c.border}`, borderRadius: '7px', padding: '5px 12px',
                background: 'transparent', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <span style={meta(c.textMuted)}>Ctrl+Enter saves, Esc cancels</span>
          </div>
        </div>
      )}

      {error && <div data-testid="vision-error" role="alert" style={meta(tones.bad)}>{error}</div>}
    </div>
  );
}
