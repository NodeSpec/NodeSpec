import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Lightbulb, GitBranch, FileUp, ArrowRight, ArrowLeft, X } from 'lucide-react';

export type WorkflowOrigin = 'idea' | 'code' | 'import-spec';

export interface OnboardingResult {
  name: string;
  workflowOrigin: WorkflowOrigin;
}

interface ProjectOnboardingWizardProps {
  onConfirm: (result: OnboardingResult) => void;
  onClose: () => void;
}

type Step = 'path' | 'name';

const BETA_WORKFLOWS: Set<WorkflowOrigin> = new Set(['code', 'import-spec']);

// Post-cutover (owner ruling 2026-08-12): every workflow is open on every tier.
// The old Indie/Architect locks were a V1-plan hangover — the only scale gate
// that survives anywhere is the 3-project Community cap.

const WORKFLOW_OPTIONS: Array<{
  id: WorkflowOrigin;
  icon: typeof Lightbulb;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  bgLight: string;
  bgDark: string;
  beta: boolean;
}> = [
  {
    id: 'idea',
    icon: Lightbulb,
    title: 'Start from an idea',
    subtitle: 'Design architecture from scratch',
    description: 'Describe your project vision and let AI help you design the architecture. Best for greenfield projects and early-stage planning.',
    color: '#f59e0b',
    bgLight: '#fffbeb',
    bgDark: '#3d2f1a',
    beta: false,
  },
  {
    id: 'code',
    icon: GitBranch,
    title: 'Start from existing code',
    subtitle: 'Reverse-engineer architecture',
    description: 'Import a repository to analyze its structure and visualize the architecture. Best for understanding and documenting existing systems.',
    color: '#3b82f6',
    bgLight: '#eff6ff',
    bgDark: '#1a2744',
    beta: true,
  },
  {
    id: 'import-spec',
    icon: FileUp,
    title: 'Import a specification',
    subtitle: 'Convert an existing spec into requirements',
    description: 'Have a spec, PRD, or requirements document? Your connected AI converts it into structured requirements with acceptance criteria — every change arrives as a proposal you review.',
    color: '#10b981',
    bgLight: '#ecfdf5',
    bgDark: '#1a3d2e',
    beta: true,
  },
];

export function ProjectOnboardingWizard({ onConfirm, onClose }: ProjectOnboardingWizardProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';

  const [step, setStep] = useState<Step>('path');
  const [selectedPath, setSelectedPath] = useState<WorkflowOrigin | null>(null);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hoveredOption, setHoveredOption] = useState<WorkflowOrigin | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handlePathSelect = useCallback((path: WorkflowOrigin) => {
    setSelectedPath(path);
    setStep('name');
    setError(null);
  }, []);

  const handleBack = useCallback(() => {
    setStep('path');
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = projectName.trim();
    if (!trimmed) {
      setError('Project name is required');
      return;
    }
    if (trimmed.length < 3) {
      setError('Project name must be at least 3 characters');
      return;
    }
    if (!selectedPath) return;
    onConfirm({ name: trimmed, workflowOrigin: selectedPath });
  }, [projectName, selectedPath, onConfirm]);

  const overlayStyles: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11000,
    backdropFilter: 'blur(6px)',
    animation: 'onb-fadeIn 0.2s ease-out',
  };

  const dialogStyles: React.CSSProperties = {
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '16px',
    boxShadow: isDark
      ? '0 24px 64px rgba(0, 0, 0, 0.6)'
      : '0 24px 64px rgba(0, 0, 0, 0.18)',
    maxWidth: step === 'path' ? '640px' : '480px',
    width: '92%',
    padding: '0',
    overflow: 'hidden',
    animation: 'onb-slideUp 0.3s ease-out',
    transition: 'max-width 0.3s ease',
  };

  const headerStyles: React.CSSProperties = {
    padding: '24px 28px 0',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  };

  return (
    <>
      <style>{`
        @keyframes onb-fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes onb-slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={overlayStyles} onClick={onClose}>
        <div style={dialogStyles} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyles}>
            <div style={{ flex: 1 }}>
              {step === 'path' ? (
                <>
                  <div style={{
                    fontSize: '20px', fontWeight: 700, color: c.text,
                    letterSpacing: '-0.01em', lineHeight: '1.3',
                  }}>
                    New Project
                  </div>
                  <div style={{
                    fontSize: '14px', color: c.textMuted, marginTop: '6px',
                    lineHeight: '1.5',
                  }}>
                    How would you like to get started?
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      onClick={handleBack}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: c.textMuted, padding: '4px', display: 'flex',
                        borderRadius: '6px', transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <div style={{
                      fontSize: '20px', fontWeight: 700, color: c.text,
                      letterSpacing: '-0.01em',
                    }}>
                      Name your project
                    </div>
                  </div>
                  <div style={{
                    fontSize: '13px', color: c.textMuted, marginTop: '6px',
                    marginLeft: '32px',
                  }}>
                    {selectedPath === 'idea'
                      ? 'After creation, describe your vision to your connected AI'
                      : selectedPath === 'code'
                        ? 'You\'ll connect a repository to import after creation'
                        : 'After creation, paste your document into your connected AI'}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: c.textMuted, padding: '6px', display: 'flex',
                borderRadius: '6px', flexShrink: 0, transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: '20px 28px 28px' }}>
            {step === 'path' ? (
              <PathSelection
                options={WORKFLOW_OPTIONS}
                hoveredOption={hoveredOption}
                onHover={setHoveredOption}
                onSelect={handlePathSelect}
                isDark={isDark}
                colors={c}
              />
            ) : (
              <NameEntry
                projectName={projectName}
                onNameChange={(v) => { setProjectName(v); setError(null); }}
                error={error}
                selectedPath={selectedPath!}
                onSubmit={handleSubmit}
                colors={c}
                isDark={isDark}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function PathSelection({
  options,
  hoveredOption,
  onHover,
  onSelect,
  isDark,
  colors: c,
}: {
  options: typeof WORKFLOW_OPTIONS;
  hoveredOption: WorkflowOrigin | null;
  onHover: (id: WorkflowOrigin | null) => void;
  onSelect: (id: WorkflowOrigin) => void;
  isDark: boolean;
  colors: ReturnType<typeof useTheme>['theme']['colors'];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {options.map((opt) => {
        const isHovered = hoveredOption === opt.id;
        const Icon = opt.icon;
        const bg = isDark ? opt.bgDark : opt.bgLight;

        return (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            onMouseEnter={() => onHover(opt.id)}
            onMouseLeave={() => onHover(null)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '16px',
              padding: '18px 20px',
              border: `1.5px solid ${isHovered ? opt.color + '60' : c.border}`,
              borderRadius: '12px',
              background: isHovered ? bg : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              transition: 'all 0.2s ease',
              transform: isHovered ? 'translateY(-1px)' : 'none',
            }}
          >
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: opt.color + (isDark ? '20' : '15'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background-color 0.2s',
            }}>
              <Icon size={22} color={opt.color} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '8px',
              }}>
                <div>
                  <div style={{
                    fontSize: '15px', fontWeight: 600, color: c.text,
                    lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    {opt.title}
                    {opt.beta && <BetaBadge />}
                  </div>
                  <div style={{
                    fontSize: '13px', color: c.textMuted, marginTop: '2px',
                  }}>
                    {opt.subtitle}
                  </div>
                </div>
                <ArrowRight
                  size={16}
                  color={c.textMuted}
                  style={{
                    opacity: isHovered ? 1 : 0,
                    transform: isHovered ? 'translateX(0)' : 'translateX(-4px)',
                    transition: 'all 0.2s ease',
                    flexShrink: 0,
                  }}
                />
              </div>
              {isHovered && (
                <div style={{
                  fontSize: '12px',
                  color: c.textSecondary,
                  marginTop: '8px',
                  lineHeight: '1.5',
                  animation: 'onb-fadeIn 0.15s ease-out',
                }}>
                  {opt.description}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function NameEntry({
  projectName,
  onNameChange,
  error,
  selectedPath,
  onSubmit,
  colors: c,
  isDark,
}: {
  projectName: string;
  onNameChange: (v: string) => void;
  error: string | null;
  selectedPath: WorkflowOrigin;
  onSubmit: () => void;
  colors: ReturnType<typeof useTheme>['theme']['colors'];
  isDark: boolean;
}) {
  const opt = WORKFLOW_OPTIONS.find(o => o.id === selectedPath)!;

  const placeholders: Record<WorkflowOrigin, string> = {
    idea: 'e.g. SaaS Analytics Platform',
    code: 'e.g. Frontend Monorepo',
    'import-spec': 'e.g. Product Requirements Doc v2',
  };

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 14px', borderRadius: '10px',
        backgroundColor: isDark ? opt.bgDark : opt.bgLight,
        border: `1px solid ${opt.color}20`,
        marginBottom: '20px',
      }}>
        <opt.icon size={16} color={opt.color} />
        <span style={{ fontSize: '13px', fontWeight: 500, color: c.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {opt.title}
          {BETA_WORKFLOWS.has(selectedPath) && <BetaBadge />}
        </span>
      </div>

      <label style={{
        display: 'block', fontSize: '13px', fontWeight: 600,
        marginBottom: '8px', color: c.text,
      }}>
        Project Name
      </label>
      <input
        type="text"
        style={{
          width: '100%',
          padding: '11px 14px',
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
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        onFocus={(e) => {
          if (!error) e.currentTarget.style.borderColor = c.primary;
        }}
        onBlur={(e) => {
          if (!error) e.currentTarget.style.borderColor = c.border;
        }}
        placeholder={placeholders[selectedPath]}
        autoFocus
      />

      {error && (
        <div style={{
          padding: '8px 12px', marginTop: '8px',
          backgroundColor: c.errorBg,
          border: `1px solid ${c.error}30`,
          borderRadius: '6px',
          color: c.error,
          fontSize: '12px',
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'flex', gap: '12px', justifyContent: 'flex-end',
        marginTop: '24px',
      }}>
        <button
          style={{
            padding: '10px 20px', fontSize: '13px', fontWeight: 500,
            borderRadius: '8px', border: `1px solid ${c.border}`,
            backgroundColor: 'transparent', color: c.text,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onClick={() => onNameChange('')}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.surfaceHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          Cancel
        </button>
        <button
          style={{
            padding: '10px 24px', fontSize: '13px', fontWeight: 600,
            borderRadius: '8px', border: 'none',
            backgroundColor: c.primary, color: '#fff',
            cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
          onClick={onSubmit}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.primaryHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = c.primary; }}
        >
          Create Project
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function BetaBadge() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 6px',
      fontSize: '10px',
      fontWeight: 700,
      lineHeight: '16px',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: '#0369a1',
      backgroundColor: '#e0f2fe',
      border: '1px solid #bae6fd',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      userSelect: 'none',
    }}>
      Beta
    </span>
  );
}
