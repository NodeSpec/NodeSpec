import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Tooltip } from './Tooltip.js';

export type CanvasViewMode = 'decomposition' | 'architecture' | 'specification';

interface ViewToggleProps {
  viewMode: CanvasViewMode;
  onToggle: (mode: CanvasViewMode) => void;
  onExport?: () => void;
}

function ViewToggleComponent({ viewMode, onToggle, onExport }: ViewToggleProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const containerStyles: React.CSSProperties = {
    position: 'absolute',
    top: '16px',
    right: '16px',
    zIndex: 100,
    display: 'flex',
    gap: '4px',
    backgroundColor: c.surface,
    borderRadius: '12px',
    padding: '6px',
    boxShadow: theme.mode === 'dark'
      ? '0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12)'
      : '0 4px 16px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08)',
    transition: 'all 0.2s ease',
    backdropFilter: 'blur(8px)',
  };

  const buttonBaseStyles: React.CSSProperties = {
    padding: '10px 16px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    outline: 'none',
    userSelect: 'none',
  };

  const getButtonStyles = (isActive: boolean): React.CSSProperties => ({
    ...buttonBaseStyles,
    backgroundColor: isActive ? c.primary : 'transparent',
    color: isActive ? '#ffffff' : c.text,
    boxShadow: isActive ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
  });

  return (
    <div style={containerStyles}>
      <Tooltip content="Edit the full specification as markdown">
        <button
          style={getButtonStyles(viewMode === 'specification')}
          onClick={() => onToggle('specification')}
          onMouseEnter={(e) => {
            if (viewMode !== 'specification') {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
            }
          }}
          onMouseLeave={(e) => {
            if (viewMode !== 'specification') {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="5.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="5.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="5.5" y1="10" x2="8.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span>Specification</span>
        </button>
      </Tooltip>

      <Tooltip content="Decomposition view - See requirements, features, and architecture mappings">
        <button
          style={getButtonStyles(viewMode === 'decomposition')}
          onClick={() => onToggle('decomposition')}
          onMouseEnter={(e) => {
            if (viewMode !== 'decomposition') {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
            }
          }}
          onMouseLeave={(e) => {
            if (viewMode !== 'decomposition') {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <rect x="2" y="6.5" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <rect x="2" y="11" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="4" cy="3.5" r="0.8" fill="currentColor" />
            <circle cx="4" cy="8" r="0.8" fill="currentColor" />
            <circle cx="4" cy="12.5" r="0.8" fill="currentColor" />
          </svg>
          <span>Decomposition</span>
        </button>
      </Tooltip>

      <Tooltip content="Architecture view - Visualize components and infrastructure">
        <button
          style={getButtonStyles(viewMode === 'architecture')}
          onClick={() => onToggle('architecture')}
          onMouseEnter={(e) => {
            if (viewMode !== 'architecture') {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
            }
          }}
          onMouseLeave={(e) => {
            if (viewMode !== 'architecture') {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
          <span>Architecture</span>
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
              style={{
                ...buttonBaseStyles,
                backgroundColor: 'transparent',
                color: c.text,
              }}
              onClick={onExport}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <span>Export</span>
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

export const ViewToggle = memo(ViewToggleComponent);
