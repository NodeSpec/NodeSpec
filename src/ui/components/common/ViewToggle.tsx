// V3 P3 (task 3.1): the two-view shell — Work | Architecture (Workflow
// Space design; ruling R4). V3 4.1: the upstream view reads "Work"; the
// internal 'ideation' id survives so persisted view state keeps working.
// Work hosts the Steps and Plan tabs, Architecture stays the flat React
// Flow canvas exactly as it was.
import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Tooltip } from './Tooltip.js';
import { useViewport } from '../../hooks/useViewport.js';
import {
  canvasChromeLayout, PILL_METRICS,
  VIEW_PILL, VIEW_PILL_NO_EXPORT,
} from './canvas-chrome.js';

export type CanvasViewMode = 'ideation' | 'architecture';

interface ViewToggleProps {
  viewMode: CanvasViewMode;
  onToggle: (mode: CanvasViewMode) => void;
  onExport?: () => void;
}

function ViewToggleComponent({ viewMode, onToggle, onExport }: ViewToggleProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const vp = useViewport();

  // 9.14: the pill's size is a LAYOUT decision, not a constant, and it is made
  // in canvas-chrome.ts. V3 4.1 retired the mode pill that used to share the
  // line with it, so this pill is the whole band in both views.
  const spec = onExport ? VIEW_PILL : VIEW_PILL_NO_EXPORT;
  const layout = canvasChromeLayout({
    vw: vp.width,
    modePill: null,
    viewPill: spec,
  });
  const m = PILL_METRICS[layout.density];
  const box = layout.viewPill!;

  const containerStyles: React.CSSProperties = {
    position: 'absolute',
    top: `${box.top}px`,
    right: '16px',
    zIndex: 100,
    display: 'flex',
    // A label the estimate under-measured must WRAP rather than push the pill
    // off the canvas, so the shell can never be wider than the gutters allow.
    maxWidth: 'calc(100% - 32px)',
    gap: `${m.shellGap}px`,
    backgroundColor: c.surface,
    borderRadius: `${m.radius}px`,
    padding: `${m.shellPad}px`,
    boxShadow: theme.mode === 'dark'
      ? '0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12)'
      : '0 4px 16px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08)',
    transition: 'all 0.2s ease',
    backdropFilter: 'blur(8px)',
  };

  const buttonBaseStyles: React.CSSProperties = {
    padding: `${m.padY}px ${m.padX}px`,
    border: 'none',
    borderRadius: `${m.buttonRadius}px`,
    cursor: 'pointer',
    fontSize: `${m.fontSize}px`,
    fontWeight: 600,
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: m.showLabel ? `${m.iconGap}px` : '0',
    outline: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const getButtonStyles = (isActive: boolean): React.CSSProperties => ({
    ...buttonBaseStyles,
    backgroundColor: isActive ? c.primary : 'transparent',
    color: isActive ? '#ffffff' : c.text,
    boxShadow: isActive ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
  });

  const hoverIn = (active: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
    }
  };
  const hoverOut = (active: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = 'transparent';
    }
  };

  return (
    <div data-testid="view-toggle" data-tour="views" data-density={layout.density} style={containerStyles}>
      <Tooltip content="Work · steps, requirements, proof and the plan">
        <button
          data-testid="view-toggle-ideation"
          aria-label="Work"
          aria-pressed={viewMode === 'ideation'}
          title={m.showLabel ? undefined : 'Work'}
          style={getButtonStyles(viewMode === 'ideation')}
          onClick={() => onToggle('ideation')}
          onMouseEnter={hoverIn(viewMode === 'ideation')}
          onMouseLeave={hoverOut(viewMode === 'ideation')}
        >
          <svg width={m.icon} height={m.icon} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <rect x="2" y="2" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <rect x="2" y="6.5" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <rect x="2" y="11" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="4" cy="3.5" r="0.8" fill="currentColor" />
            <circle cx="4" cy="8" r="0.8" fill="currentColor" />
            <circle cx="4" cy="12.5" r="0.8" fill="currentColor" />
          </svg>
          {m.showLabel && <span>Work</span>}
        </button>
      </Tooltip>

      <Tooltip content="Architecture — components and infrastructure on the canvas">
        <button
          data-testid="view-toggle-architecture"
          aria-label="Architecture"
          aria-pressed={viewMode === 'architecture'}
          title={m.showLabel ? undefined : 'Architecture'}
          style={getButtonStyles(viewMode === 'architecture')}
          onClick={() => onToggle('architecture')}
          onMouseEnter={hoverIn(viewMode === 'architecture')}
          onMouseLeave={hoverOut(viewMode === 'architecture')}
        >
          <svg width={m.icon} height={m.icon} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="3" cy="3" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="13" cy="3" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="3" cy="13" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="13" cy="13" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="4.5" y1="3.8" x2="6.5" y2="7" stroke="currentColor" strokeWidth="1.5" />
            <line x1="11.5" y1="3.8" x2="9.5" y2="7" stroke="currentColor" strokeWidth="1.5" />
            <line x1="6.5" y1="9" x2="4.5" y2="12" stroke="currentColor" strokeWidth="1.5" />
            <line x1="9.5" y1="9" x2="11.5" y2="12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {m.showLabel && <span>Architecture</span>}
        </button>
      </Tooltip>

      {onExport && (
        <>
          <div style={{
            width: '1px',
            alignSelf: 'stretch',
            margin: '4px 2px',
            backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          }} />
          <Tooltip content="Export project context for AI agents and documentation">
            <button
              data-testid="view-toggle-export"
              data-tour="export"
              aria-label="Export"
              title={m.showLabel ? undefined : 'Export'}
              style={{
                ...buttonBaseStyles,
                backgroundColor: 'transparent',
                color: c.text,
              }}
              onClick={onExport}
              onMouseEnter={hoverIn(false)}
              onMouseLeave={hoverOut(false)}
            >
              <svg width={m.icon} height={m.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {m.showLabel && <span>Export</span>}
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

export const ViewToggle = memo(ViewToggleComponent);
