import { useTheme } from '../../theme/ThemeContext.js';
import { useViewport } from '../../hooks/useViewport.js';
import { canvasChromeLayout, CHROME_GUTTER, CHROME_SPACING, VIEW_PILL } from './canvas-chrome.js';
import { changeLineText, type ChangeView } from '../ideation/change-scope-model.js';

// AA.2 (owner 2026-09-23): one line at the top of the canvas names the active
// change and its proof count, and turns its scope on and off (out of scope
// fades, crossing edges highlight). It sits on the band's left, where the
// retired mode pill stood, and never reaches the view pill: on a canvas too
// narrow for both it drops below the band.

interface ChangeScopeLineProps {
  changes: ChangeView[];
  activeId: string;
  scopeOn: boolean;
  onPick: (id: string) => void;
  onToggleScope: () => void;
}

export function ChangeScopeLine({ changes, activeId, scopeOn, onPick, onToggleScope }: ChangeScopeLineProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const vp = useViewport();
  const active = changes.find((ch) => ch.id === activeId) ?? changes[0];
  if (!active) return null;

  const layout = canvasChromeLayout({ vw: vp.width, modePill: null, viewPill: VIEW_PILL });
  const view = layout.viewPill!;
  const room = view.left - CHROME_GUTTER - CHROME_SPACING;
  const below = room < 260;
  const top = below ? layout.contentTop : view.top;
  const maxWidth = below ? `calc(100% - ${CHROME_GUTTER * 2}px)` : `${room}px`;

  return (
    <div
      data-testid="change-scope-line"
      style={{
        position: 'absolute', top: `${top}px`, left: `${CHROME_GUTTER}px`, maxWidth, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        padding: '6px 8px 6px 12px', borderRadius: '10px', boxSizing: 'border-box',
        backgroundColor: c.surface, color: c.text,
        boxShadow: isDark
          ? '0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12)'
          : '0 4px 16px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {changes.length > 1 ? (
          <select
            aria-label="Active change"
            data-testid="change-scope-pick"
            value={active.id}
            onChange={(e) => onPick(e.target.value)}
            style={{ fontSize: '12.5px', fontWeight: 600, color: c.text, background: 'transparent', border: 'none', padding: 0, maxWidth: '100%' }}
          >
            {changes.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </select>
        ) : (
          <div data-testid="change-scope-name" style={{ fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {active.name}
          </div>
        )}
        <div data-testid="change-scope-proof" style={{ fontSize: '11.5px', color: c.textMuted }}>{changeLineText(active)}</div>
      </div>
      <button
        type="button"
        data-testid="change-scope-toggle"
        aria-pressed={scopeOn}
        onClick={onToggleScope}
        disabled={active.scope.nodeIds.length === 0}
        title={active.scope.nodeIds.length === 0 ? 'Nothing is in scope until the change derives a requirement mapped to a node' : undefined}
        style={{
          fontSize: '12px', fontWeight: 600, padding: '5px 10px', borderRadius: '7px', whiteSpace: 'nowrap',
          border: `1px solid ${scopeOn ? '#3b82f6' : c.border}`,
          backgroundColor: scopeOn ? (isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.08)') : 'transparent',
          color: active.scope.nodeIds.length === 0 ? c.textMuted : (scopeOn ? '#3b82f6' : c.text),
          cursor: active.scope.nodeIds.length === 0 ? 'default' : 'pointer',
        }}
      >
        {scopeOn ? 'Hide scope' : 'Show scope'}
      </button>
    </div>
  );
}
