import { useTheme } from '../../theme/ThemeContext.js';
import { useViewport } from '../../hooks/useViewport.js';
import { Sparkles, GitBranch, FileUp } from 'lucide-react';
import type { WorkflowOrigin } from '../panels/ProjectCreatePopup.js';

interface EmptyCanvasPromptProps {
  workflowOrigin?: WorkflowOrigin;
}

const WORKFLOW_CONTENT: Record<WorkflowOrigin, { title: string; subtitle: string; icon: typeof Sparkles; beta: boolean }> = {
  idea: {
    title: 'Describe Your Vision',
    subtitle: 'Tell your connected AI what you want to build — it records the vision and proposes requirements and architecture for your review. Or add requirements yourself in the Specification panel.',
    icon: Sparkles,
    beta: false,
  },
  code: {
    title: 'Connect Your Repository',
    subtitle: 'Open Git Integration from the toolbar to import your codebase and visualize its architecture',
    icon: GitBranch,
    beta: true,
  },
  'import-spec': {
    title: 'Import Your Specification',
    subtitle: 'Stage your spec or PRD from the start card, then tell your connected AI to call get_project_status — it converts the document into vision and requirements you review and apply.',
    icon: FileUp,
    beta: true,
  },
};

const DEFAULT_CONTENT = {
  title: 'Welcome to Your Canvas',
  subtitle: 'Pick a start path above, describe your vision to your connected AI, or add requirements and components by hand',
  icon: Sparkles,
  beta: false,
};

export function EmptyCanvasPrompt({ workflowOrigin }: EmptyCanvasPromptProps = {}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const vp = useViewport();

  const content = workflowOrigin ? WORKFLOW_CONTENT[workflowOrigin] : DEFAULT_CONTENT;
  const Icon = content.icon;

  const overlayStyles: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 5,
  };

  // 9.14: 48px of padding around a 500px column overflows a 360px phone
  // before a word is drawn. The column gives way to the viewport, and the
  // padding comes in with it.
  const promptContainerStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: vp.isPhone ? '16px' : '24px',
    padding: vp.isPhone ? '24px 20px' : '48px',
    width: '100%',
    maxWidth: '500px',
    boxSizing: 'border-box',
    textAlign: 'center',
  };

  const iconContainerStyles: React.CSSProperties = {
    width: vp.isPhone ? '60px' : '80px',
    height: vp.isPhone ? '60px' : '80px',
    flexShrink: 0,
    borderRadius: '50%',
    background: `linear-gradient(135deg, ${c.primary}20, ${c.primary}10)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
    animation: 'ecp-pulse 2s ease-in-out infinite',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: vp.isPhone ? '19px' : '24px',
    fontWeight: 600,
    color: c.text,
    marginBottom: '8px',
  };

  const subtitleStyles: React.CSSProperties = {
    fontSize: vp.isPhone ? '13.5px' : '15px',
    color: c.textMuted,
    lineHeight: '1.6',
  };

  return (
    <>
      <style>
        {`
          @keyframes ecp-pulse {
            0%, 100% {
              transform: scale(1);
              opacity: 1;
            }
            50% {
              transform: scale(1.05);
              opacity: 0.8;
            }
          }
        `}
      </style>
      <div style={overlayStyles}>
        <div style={promptContainerStyles}>
          <div style={iconContainerStyles}>
            <Icon size={vp.isPhone ? 26 : 36} color={c.primary} />
          </div>

          <div>
            <div style={titleStyles}>
              {content.title}
              {content.beta && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase' as const,
                  color: '#0369a1',
                  backgroundColor: '#e0f2fe',
                  border: '1px solid #bae6fd',
                  borderRadius: '4px',
                  marginLeft: '10px',
                  verticalAlign: 'middle',
                  userSelect: 'none' as const,
                }}>
                  Beta
                </span>
              )}
            </div>
            <div style={subtitleStyles}>
              {content.subtitle}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
