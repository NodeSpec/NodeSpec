import { useState, useCallback } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { FileUp, X, Copy, Check, CircleAlert as AlertCircle, Loader as Loader2 } from 'lucide-react';
import type { StagedSpecImport } from '../../utils/spec-import-staging.js';
import {
  SPEC_HANDOFF_TOOL,
  SPEC_STAGE_MAX_CHARS,
  buildSpecHandoffPrompt,
  buildSpecInlinePrompt,
  buildStagedSpecImport,
} from '../../utils/spec-import-staging.js';
import { useCopyToClipboard } from './ProjectStartPopup.js';
import { useViewport } from '../../hooks/useViewport.js';
import { canvasChromeLayout, VIEW_PILL } from './canvas-chrome.js';

// Owner spike 2026-09-04: the import window. It used to stream the document to
// an in-app agent endpoint that no longer exists ("failed to fetch"). Now it
// STAGES the document on the project (projects.metadata.stagedSpecImport) and
// hands off: the user's own AI calls get_project_status, receives the document
// in the response, and converts it through the spec tools. Same anchored,
// non-blocking card style as the rest of the canvas popups.

interface SpecImportStagingPopupProps {
  projectName: string;
  staged: StagedSpecImport | null;
  onStage: (staged: StagedSpecImport) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}

type Phase = 'input' | 'saving' | 'staged';

export function SpecImportStagingPopup({ projectName, staged, onStage, onClear, onClose }: SpecImportStagingPopupProps) {
  const { theme } = useTheme();
  const vp = useViewport();
  const cardTop = canvasChromeLayout({
    vw: vp.width, modePill: null, viewPill: VIEW_PILL, startCard: true,
  }).startCard!.top;
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const [phase, setPhase] = useState<Phase>(staged ? 'staged' : 'input');
  const [text, setText] = useState(staged?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<StagedSpecImport | null>(staged);
  const [copiedShort, copyShort] = useCopyToClipboard();
  const [copiedFull, copyFull] = useCopyToClipboard();

  const handleStage = useCallback(async () => {
    const built = buildStagedSpecImport(text);
    if (!built.ok) {
      setError(built.reason === 'empty'
        ? 'Paste a document first.'
        : `That document is ${built.chars.toLocaleString()} characters; the limit is ${SPEC_STAGE_MAX_CHARS.toLocaleString()}. Split it and stage the first part.`);
      return;
    }
    setError(null);
    setPhase('saving');
    try {
      await onStage(built.staged);
      setCurrent(built.staged);
      setPhase('staged');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stage the document');
      setPhase('input');
    }
  }, [text, onStage]);

  const handleClear = useCallback(async () => {
    setPhase('saving');
    try {
      await onClear();
      setCurrent(null);
      setText('');
      setPhase('input');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the document');
      setPhase('staged');
    }
  }, [onClear]);

  const chars = text.trim().length;
  const overLimit = chars > SPEC_STAGE_MAX_CHARS;
  const handoffPrompt = buildSpecHandoffPrompt(projectName);
  const inlinePrompt = current ? buildSpecInlinePrompt(projectName, current.text) : '';

  const codeStyle: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px', padding: '1px 5px', borderRadius: '4px',
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: c.text,
  };

  const secondaryButton: React.CSSProperties = {
    padding: '8px 14px', fontSize: '12.5px', fontWeight: 500,
    borderRadius: '8px', border: `1px solid ${c.border}`,
    backgroundColor: 'transparent', color: c.text, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '6px',
  };

  return (
    <div
      data-testid="spec-import-staging-popup"
      style={{
        // 9.14: the same band the start card is in, and the same rule — it
        // begins below the pills whenever it would otherwise reach them.
        position: 'absolute', top: `${cardTop}px`, left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        zIndex: 35, pointerEvents: 'none',
      }}
    >
      <style>{`@keyframes sisp-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        role="dialog"
        aria-label="Import a specification"
        style={{
          pointerEvents: 'auto',
          width: 'min(720px, calc(100% - 32px))',
          maxHeight: `calc(100vh - ${cardTop + 24}px)`,
          overflowY: 'auto',
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: '14px',
          boxShadow: isDark ? '0 16px 48px rgba(0, 0, 0, 0.5)' : '0 16px 48px rgba(0, 0, 0, 0.12)',
          padding: vp.isPhone ? '14px 14px 16px' : '16px 18px 18px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#10b98118',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <FileUp size={18} color="#10b981" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: c.text, letterSpacing: '-0.01em' }}>
              Import a specification
            </div>
            <div style={{ fontSize: '12.5px', color: c.textMuted, marginTop: '2px' }}>
              {phase === 'staged'
                ? 'Staged on the project — hand it to your AI'
                : 'Paste the document; your connected AI converts it into requirements'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: c.textMuted,
              padding: '4px', display: 'flex', borderRadius: '6px', flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
          >
            <X size={16} />
          </button>
        </div>

        {(phase === 'input' || phase === 'saving') && (
          <>
            <textarea
              style={{
                width: '100%', minHeight: '240px', marginTop: '14px', padding: '12px 14px',
                fontSize: '13px', lineHeight: 1.6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                backgroundColor: c.backgroundSecondary, color: c.text,
                border: `1.5px solid ${overLimit ? c.error : c.border}`, borderRadius: '10px',
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null); }}
              onFocus={(e) => { if (!overLimit) e.currentTarget.style.borderColor = c.primary; }}
              onBlur={(e) => { if (!overLimit) e.currentTarget.style.borderColor = c.border; }}
              placeholder={'Paste your specification, PRD, requirements document, or feature list here...\n\nMarkdown, plain text, bullet lists — any format your AI can read.'}
              disabled={phase === 'saving'}
              aria-label="Specification document"
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', gap: '10px' }}>
              <div style={{ fontSize: '12px', color: overLimit ? c.error : c.textMuted }}>
                {chars > 0
                  ? `${chars.toLocaleString()} / ${SPEC_STAGE_MAX_CHARS.toLocaleString()} characters`
                  : 'Nothing leaves the project: the document is stored on it for your AI to read.'}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={onClose} style={secondaryButton}>Cancel</button>
                <button
                  onClick={handleStage}
                  disabled={chars === 0 || overLimit || phase === 'saving'}
                  style={{
                    padding: '8px 16px', fontSize: '12.5px', fontWeight: 600,
                    borderRadius: '8px', border: 'none',
                    backgroundColor: chars > 0 && !overLimit ? '#10b981' : c.border,
                    color: chars > 0 && !overLimit ? '#fff' : c.textMuted,
                    cursor: chars > 0 && !overLimit && phase !== 'saving' ? 'pointer' : 'not-allowed',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  {phase === 'saving'
                    ? <Loader2 size={14} style={{ animation: 'sisp-spin 1s linear infinite' }} />
                    : <FileUp size={14} />}
                  Stage for your AI
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'staged' && current && (
          <div style={{ marginTop: '14px', fontSize: '13px', color: c.textSecondary, lineHeight: 1.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: c.text, fontWeight: 600 }}>
              <Check size={14} color="#10b981" />
              Document staged ({current.chars.toLocaleString()} characters)
            </div>
            <div style={{ marginTop: '6px' }}>
              In your connected AI, call this tool: <code style={codeStyle}>{SPEC_HANDOFF_TOOL}</code>.
              The response carries the document and a nextAction that walks the AI through the conversion
              (vision first, then each requirement with its acceptance criteria). Every change lands as a proposal you review.
            </div>
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px', padding: '10px 12px',
              backgroundColor: c.backgroundSecondary, border: `1px solid ${c.border}`, borderRadius: '8px',
            }}>
              <div style={{
                flex: 1, fontSize: '12.5px', lineHeight: 1.5, color: c.text,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {handoffPrompt}
              </div>
              <button
                onClick={() => copyShort(handoffPrompt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                  padding: '5px 9px', fontSize: '12px', fontWeight: 500,
                  borderRadius: '6px', border: `1px solid ${c.border}`,
                  backgroundColor: c.surface, color: copiedShort ? '#10b981' : c.text, cursor: 'pointer',
                }}
              >
                {copiedShort ? <Check size={13} /> : <Copy size={13} />}
                {copiedShort ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
              <button onClick={() => copyFull(inlinePrompt)} style={secondaryButton} title="A prompt with the whole document inline, for an AI that should not read it from status first">
                {copiedFull ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                {copiedFull ? 'Copied' : 'Copy prompt with document'}
              </button>
              <button onClick={() => { setPhase('input'); setText(current.text); }} style={secondaryButton}>
                Edit document
              </button>
              <button onClick={handleClear} style={{ ...secondaryButton, color: c.error }}>
                Clear staged document
              </button>
              <div style={{ flex: 1 }} />
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px', fontSize: '12.5px', fontWeight: 600,
                  borderRadius: '8px', border: 'none', backgroundColor: c.primary, color: '#fff', cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '12px', padding: '10px 12px',
            backgroundColor: isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px',
          }}>
            <AlertCircle size={15} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '12.5px', color: '#ef4444', lineHeight: 1.5 }}>{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
