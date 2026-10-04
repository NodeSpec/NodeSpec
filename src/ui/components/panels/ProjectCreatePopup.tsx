import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { FolderPlus, ArrowRight, X } from 'lucide-react';

// Owner spike 2026-09-04: project creation is ONE light step — a name. The
// three "how would you like to start" categories the old wizard front-loaded
// are gone from creation; they live on the canvas afterwards as the start
// popup (ProjectStartPopup), where the user picks a path with the project
// already open. This popup never dims or blocks the canvas: no fixed overlay,
// no backdrop — it sits anchored at the top of the canvas and the rest of the
// app stays live underneath.

/** How a project was started, recorded in projects.metadata.workflowOrigin by
 *  the start popup (not at creation any more). get_project_status reads
 *  'import-spec' to route the user's AI at the staged document. */
export type WorkflowOrigin = 'idea' | 'code' | 'import-spec';

export interface ProjectCreateResult {
  name: string;
}

interface ProjectCreatePopupProps {
  onConfirm: (result: ProjectCreateResult) => void;
  onClose: () => void;
  /** 'canvas' anchors the card inside a position:relative canvas wrapper;
   *  'standalone' paints its own full-screen ground (the first-project screen,
   *  where no canvas exists yet). */
  variant?: 'canvas' | 'standalone';
}

export function validateProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Project name is required';
  if (trimmed.length < 3) return 'Project name must be at least 3 characters';
  return null;
}

export function ProjectCreatePopup({ onConfirm, onClose, variant = 'canvas' }: ProjectCreatePopupProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';

  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (variant !== 'canvas') return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, variant]);

  const handleSubmit = useCallback(() => {
    const problem = validateProjectName(projectName);
    if (problem) {
      setError(problem);
      return;
    }
    onConfirm({ name: projectName.trim() });
  }, [projectName, onConfirm]);

  const cardStyles: React.CSSProperties = {
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '14px',
    boxShadow: isDark
      ? '0 16px 48px rgba(0, 0, 0, 0.5)'
      : '0 16px 48px rgba(0, 0, 0, 0.12)',
    width: 'min(440px, calc(100% - 32px))',
    padding: '20px 22px 22px',
    boxSizing: 'border-box',
    animation: 'pcp-slideDown 0.25s ease-out',
    pointerEvents: 'auto',
  };

  const anchorStyles: React.CSSProperties = variant === 'canvas'
    ? {
      position: 'absolute',
      top: '16px',
      left: 0,
      right: 0,
      display: 'flex',
      justifyContent: 'center',
      zIndex: 30,
      pointerEvents: 'none',
    }
    : {
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.backgroundTertiary,
    };

  return (
    <>
      <style>{`
        @keyframes pcp-slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={anchorStyles} data-testid="project-create-popup">
        <div style={cardStyles} role="dialog" aria-label="New project">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              backgroundColor: `${c.primary}${isDark ? '26' : '18'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <FolderPlus size={18} color={c.primary} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c.text, letterSpacing: '-0.01em' }}>
                New project
              </div>
              <div style={{ fontSize: '12.5px', color: c.textMuted, marginTop: '2px' }}>
                Name it now — you choose how to start on the canvas.
              </div>
            </div>
            {variant === 'canvas' && (
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: c.textMuted, padding: '4px', display: 'flex',
                  borderRadius: '6px', flexShrink: 0, transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          <input
            type="text"
            style={{
              width: '100%',
              marginTop: '16px',
              padding: '10px 13px',
              fontSize: '14px',
              fontFamily: 'inherit',
              backgroundColor: c.backgroundSecondary,
              color: c.text,
              border: `1.5px solid ${error ? c.error : c.border}`,
              borderRadius: '8px',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            value={projectName}
            onChange={(e) => { setProjectName(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            onFocus={(e) => { if (!error) e.currentTarget.style.borderColor = c.primary; }}
            onBlur={(e) => { if (!error) e.currentTarget.style.borderColor = c.border; }}
            placeholder="e.g. SaaS Analytics Platform"
            aria-label="Project name"
            autoFocus
          />

          {error && (
            <div style={{
              padding: '7px 11px', marginTop: '8px',
              backgroundColor: c.errorBg,
              border: `1px solid ${c.error}30`,
              borderRadius: '6px',
              color: c.error,
              fontSize: '12px',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            {variant === 'canvas' && (
              <button
                style={{
                  padding: '9px 16px', fontSize: '13px', fontWeight: 500,
                  borderRadius: '8px', border: `1px solid ${c.border}`,
                  backgroundColor: 'transparent', color: c.text,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onClick={onClose}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.surfaceHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                Cancel
              </button>
            )}
            <button
              style={{
                padding: '9px 20px', fontSize: '13px', fontWeight: 600,
                borderRadius: '8px', border: 'none',
                backgroundColor: c.primary, color: '#fff',
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
              onClick={handleSubmit}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.primaryHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = c.primary; }}
            >
              Create project
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
