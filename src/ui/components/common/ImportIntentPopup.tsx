import { useState, useCallback } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Compass, Check, X, Loader as Loader2 } from 'lucide-react';
import { useViewport } from '../../hooks/useViewport.js';
import { canvasChromeLayout, VIEW_PILL } from './canvas-chrome.js';
import { IMPORT_INTENTS, isChangeIntent, type ImportIntent } from '../../utils/change-intent.js';
import { buildImportIntentPrompt } from '../../utils/spec-import-staging.js';
import { PromptBox } from './ProjectStartPopup.js';

// AA.2 (owner 2026-09-23): an import starts from intent. When the person
// accepts an import, the app asks what they are here to do. A change
// (migrate, harden, change a component, extend) becomes a workflow of its
// own, named by the person, with steps from the intent's template; describe
// the whole system is the path imports took before. The answer is recorded
// on the project (projects.metadata.importIntent) and the agent reads it
// through get_import_context, so it is never asked twice. Same anchored,
// non-blocking card as the other canvas popups (Indie and above: workflows).
//
// AL.21 (owner 2026-10-03): recording the answer did not reach the agent; it
// learned of it only if the person repeated it. The answer now leads the
// agent's get_project_status read until outcomes are filed for it, and once
// it is saved this card says so and gives the note that sends the agent
// there, instead of closing on a toast that promised a draft nothing started.

/** An example name per change, shown as a placeholder only. */
const EXAMPLE_NAME: Record<string, string> = {
  migrate: 'Move onto our own infrastructure',
  harden: 'Pass the security review',
  component: 'Replace the payment provider',
  extend: 'Add team accounts',
};

interface ImportIntentPopupProps {
  /** For the note the person pastes into their AI. */
  projectName: string;
  /** Resolves when the answer is recorded; throws with the reason in words. */
  onAnswer: (intent: ImportIntent, name: string | null) => Promise<void>;
  onClose: () => void;
}

export function ImportIntentPopup({ projectName, onAnswer, onClose }: ImportIntentPopupProps) {
  const { theme } = useTheme();
  const vp = useViewport();
  const cardTop = canvasChromeLayout({ vw: vp.width, modePill: null, viewPill: VIEW_PILL, startCard: true }).startCard!.top;
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const [picked, setPicked] = useState<ImportIntent | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ label: string; change: string | null } | null>(null);

  const choice = IMPORT_INTENTS.find((i) => i.intent === picked) ?? null;
  const isChange = picked !== null && isChangeIntent(picked);
  const ready = picked !== null && (!isChange || name.trim().length > 0);

  const submit = useCallback(async () => {
    if (!picked || !ready) return;
    setSaving(true);
    setError(null);
    try {
      await onAnswer(picked, isChange ? name.trim() : null);
      setStaged({ label: choice?.label ?? picked, change: isChange ? name.trim() : null });
      setSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The answer was not recorded.');
      setSaving(false);
    }
  }, [picked, ready, isChange, name, onAnswer, choice]);

  return (
    <div
      data-testid="import-intent-popup"
      style={{
        position: 'absolute', top: `${cardTop}px`, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', zIndex: 35, pointerEvents: 'none',
      }}
    >
      <style>{`@keyframes iip-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        role="dialog"
        aria-label="What are you here to do?"
        style={{
          pointerEvents: 'auto',
          width: 'min(640px, calc(100% - 32px))',
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
            width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#3b82f618',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Compass size={18} color="#3b82f6" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: c.text, letterSpacing: '-0.01em' }}>
              {staged ? 'Staged for your agent' : 'What are you here to do?'}
            </div>
            <div style={{ fontSize: '12.5px', color: c.textMuted, marginTop: '2px' }}>
              {staged
                ? 'Your answer is saved on the project. Your agent reads it the next time it checks the project status.'
                : 'The canvas shows the system as found. Your answer decides what your agent drafts next.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="import-intent-close"
            style={{ background: 'none', border: 'none', color: c.textMuted, cursor: 'pointer', padding: '4px', display: 'flex' }}
          >
            <X size={16} />
          </button>
        </div>

        {staged ? (
          <div data-testid="import-intent-staged" style={{ marginTop: '14px', fontSize: '13px', color: c.textSecondary, lineHeight: 1.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: c.text, fontWeight: 600 }}>
              <Check size={14} color="#10b981" />
              {staged.change ? `${staged.label}: ${staged.change}` : staged.label}
            </div>
            <div style={{ marginTop: '6px' }}>
              {staged.change
                ? 'Paste this into your AI to have it draft the change\'s outcomes now, What works today first. They arrive under Agents, Proposals for you to accept.'
                : 'Paste this into your AI to have it draft the lanes and outcomes the system serves now. They arrive under Agents, Proposals for you to accept.'}
            </div>
            <PromptBox testId="import-intent-prompt" text={buildImportIntentPrompt(projectName, staged.label, staged.change)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button
                type="button"
                data-testid="import-intent-done"
                onClick={onClose}
                style={{
                  padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, borderRadius: '8px', border: 'none',
                  backgroundColor: '#3b82f6', color: '#ffffff', cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (<>
        <div role="radiogroup" aria-label="What you are here to do" style={{ display: 'grid', gap: '8px', marginTop: '14px' }}>
          {IMPORT_INTENTS.map((option) => {
            const on = option.intent === picked;
            return (
              <button
                key={option.intent}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`import-intent-${option.intent}`}
                onClick={() => { setPicked(option.intent); setError(null); }}
                style={{
                  textAlign: 'left', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
                  border: `1px solid ${on ? '#3b82f6' : c.border}`,
                  backgroundColor: on ? (isDark ? 'rgba(59,130,246,0.14)' : 'rgba(59,130,246,0.07)') : 'transparent',
                  color: c.text,
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{option.label}</div>
                <div style={{ fontSize: '12px', color: c.textMuted, marginTop: '2px' }}>{option.detail}</div>
              </button>
            );
          })}
        </div>

        {choice && isChange && (
          <div style={{ marginTop: '14px' }}>
            <label htmlFor="import-intent-name" style={{ fontSize: '12px', fontWeight: 600, color: c.text }}>
              Name the change
            </label>
            <input
              id="import-intent-name"
              data-testid="import-intent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              placeholder={EXAMPLE_NAME[choice.intent] ?? ''}
              style={{
                display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '6px',
                padding: '8px 10px', fontSize: '13px', borderRadius: '8px',
                border: `1px solid ${c.border}`, backgroundColor: c.background, color: c.text,
              }}
            />
            <div data-testid="import-intent-steps" style={{ fontSize: '12px', color: c.textMuted, marginTop: '8px' }}>
              Its steps: {choice.steps.join(' · ')}. Rename or add steps in Work.
            </div>
          </div>
        )}

        {error && (
          <div role="alert" style={{ fontSize: '12px', color: '#ef4444', marginTop: '10px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button
            type="button"
            data-testid="import-intent-submit"
            disabled={!ready || saving}
            onClick={() => void submit()}
            style={{
              padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, borderRadius: '8px', border: 'none',
              backgroundColor: ready ? '#3b82f6' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
              color: ready ? '#ffffff' : c.textMuted, cursor: ready && !saving ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}
          >
            {saving && <Loader2 size={13} style={{ animation: 'iip-spin 1s linear infinite' }} />}
            {picked === 'describe' ? 'Describe the whole system' : 'Start the change'}
          </button>
        </div>
        </>)}
      </div>
    </div>
  );
}
