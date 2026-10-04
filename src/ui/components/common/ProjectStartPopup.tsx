import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Sparkles, FileUp, GitBranch, X, Copy, Check, ExternalLink } from 'lucide-react';
import type { WorkflowOrigin } from '../panels/ProjectCreatePopup.js';
import type { StagedSpecImport } from '../../utils/spec-import-staging.js';
import { useViewport } from '../../hooks/useViewport.js';
import { canvasChromeLayout, VIEW_PILL } from './canvas-chrome.js';
import {
  MCP_TOOLS_DOCS_PATH,
  REPO_IMPORT_TOOL,
  SPEC_HANDOFF_TOOL,
  START_NEW_TOOLS,
  buildRepoImportPrompt,
  buildSpecHandoffPrompt,
  buildStartNewPrompt,
} from '../../utils/spec-import-staging.js';

// Owner spike 2026-09-04: the start paths moved OUT of project creation and
// onto the canvas. This card floats at the top of an empty project — no
// overlay, no dimming, the canvas and toolbar stay live — and offers the three
// ways in:
//   Start new              → tells the user which MCP tools their AI calls
//                             (update_vision first) and links the tool list.
//   Import a repository    → on plans with repo import (AL.21, owner
//                             2026-10-03). Records the start path, which
//                             get_project_status turns into the agent's lead,
//                             offers the Git window to connect the repository,
//                             and gives the note that sends the agent to
//                             run_repo_import. (The 2026-09-20 card only
//                             opened the Git window, and was removed for it.)
//   Import a specification → opens the staging window that hands the document
//                             to the user's AI through get_project_status.

export const START_PATHS: Array<{
  id: WorkflowOrigin;
  label: string;
  hint: string;
  icon: typeof Sparkles;
  color: string;
}> = [
  { id: 'idea', label: 'Start new', hint: 'Describe a vision to your AI', icon: Sparkles, color: '#f59e0b' },
  { id: 'code', label: 'Import a repository', hint: 'Bring in an existing codebase', icon: GitBranch, color: '#3b82f6' },
  { id: 'import-spec', label: 'Import a specification', hint: 'Hand a spec or PRD to your AI', icon: FileUp, color: '#10b981' },
];

/** The start paths this project's plan offers: Import a repository only where repo import runs. */
export function startPaths(canImportRepository: boolean): typeof START_PATHS {
  return START_PATHS.filter((p) => p.id !== 'code' || canImportRepository);
}

/** The start card floats over an EMPTY project (no vision, no requirements,
 *  no nodes) until it is dismissed, and never under another window: the
 *  project-create and staging windows, or the walkthrough, which ends on
 *  "Start your project" and hands over to this card when it closes. */
export function startCardShows(s: {
  projectId: string | null | undefined; walkthroughOpen: boolean; creatingProject: boolean; stagingSpec: boolean;
  dismissed: boolean; loading: boolean; vision: string | null | undefined; requirements: number; nodes: number;
}): boolean {
  return !!s.projectId && !s.walkthroughOpen && !s.creatingProject && !s.stagingSpec && !s.dismissed && !s.loading
    && !s.vision && s.requirements === 0 && s.nodes === 0;
}

interface ProjectStartPopupProps {
  projectName: string;
  stagedSpec: StagedSpecImport | null;
  /** The path the user already picked (from projects.metadata), if any. */
  workflowOrigin?: WorkflowOrigin;
  onStartNew: () => void;
  onImportSpecification: () => void;
  onDismiss: () => void;
  /** AL.21: the plan runs repo import (and this is not a view-only example). */
  canImportRepository?: boolean;
  /** owner/name of the connected repository, when there is one. */
  connectedRepository?: string | null;
  onImportRepository?: () => void;
  onConnectRepository?: () => void;
}

export function useCopyToClipboard(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    } catch {
      fallbackCopy(text, done);
    }
  }, []);
  return [copied, copy];
}

function fallbackCopy(text: string, done: () => void) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch {
    // Nothing else to try; the prompt is visible on screen to copy by hand.
  }
}

/** A note for the person to paste into their AI, with a Copy button. */
export function PromptBox({ text, testId }: { text: string; testId?: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [copied, copy] = useCopyToClipboard();
  return (
    <div data-testid={testId} style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      marginTop: '10px', padding: '10px 12px',
      backgroundColor: c.backgroundSecondary,
      border: `1px solid ${c.border}`, borderRadius: '8px',
    }}>
      <div style={{
        flex: 1, fontSize: '12.5px', lineHeight: 1.5, color: c.text,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {text}
      </div>
      <button
        onClick={() => copy(text)}
        title="Copy prompt"
        style={{
          display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
          padding: '5px 9px', fontSize: '12px', fontWeight: 500,
          borderRadius: '6px', border: `1px solid ${c.border}`,
          backgroundColor: c.surface, color: copied ? '#10b981' : c.text, cursor: 'pointer',
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function ProjectStartPopup({
  projectName,
  stagedSpec,
  workflowOrigin,
  onStartNew,
  onImportSpecification,
  onDismiss,
  canImportRepository = false,
  connectedRepository = null,
  onImportRepository,
  onConnectRepository,
}: ProjectStartPopupProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const paths = startPaths(canImportRepository);
  const [expanded, setExpanded] = useState<WorkflowOrigin | null>(
    stagedSpec ? 'import-spec' : (paths.some((p) => p.id === workflowOrigin) ? workflowOrigin ?? null : null),
  );
  // The plan's gate can resolve after the card mounts: a project started
  // from a repository opens on that path once the plan is known to run it.
  useEffect(() => {
    if (canImportRepository && workflowOrigin === 'code' && !stagedSpec) setExpanded((e) => e ?? 'code');
  }, [canImportRepository, workflowOrigin, stagedSpec]);
  const vp = useViewport();
  // The start card is the third thing in the top band, and the only one that
  // is centered. canvas-chrome decides whether it can sit beside the pills or
  // has to begin under them.
  const cardTop = canvasChromeLayout({
    vw: vp.width,
    modePill: null,
    viewPill: VIEW_PILL,
    startCard: true,
  }).startCard!.top;

  const choose = useCallback((id: WorkflowOrigin) => {
    setExpanded(id);
    if (id === 'idea') onStartNew();
    else if (id === 'code') onImportRepository?.();
    else onImportSpecification();
  }, [onStartNew, onImportSpecification, onImportRepository]);

  const handoffPrompt = buildSpecHandoffPrompt(projectName);
  const startPrompt = buildStartNewPrompt(projectName);

  const codeStyle: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    padding: '1px 5px',
    borderRadius: '4px',
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    color: c.text,
  };

  const promptBox = (text: string) => <PromptBox text={text} />;

  return (
    <div
      data-testid="project-start-popup"
      style={{
        // 9.14: was a flat `top: 16px`, which put this card on the same line
        // as the two corner pills. On a narrow window the card grows to the
        // gutters, reaches the view pill, and the pill — being at a higher
        // z-index — draws straight over the third start category. The band
        // now says where it ends and the card begins there.
        position: 'absolute', top: `${cardTop}px`, left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        zIndex: 25, pointerEvents: 'none',
      }}
    >
      <style>{`
        @keyframes psp-slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        role="region"
        aria-label="Choose how to start"
        style={{
          pointerEvents: 'auto',
          width: 'min(720px, calc(100% - 32px))',
          // Never taller than the canvas it floats over: on a phone the three
          // categories plus an expanded prompt box are well past a screen, and
          // a card that cannot scroll simply loses its bottom half.
          maxHeight: `calc(100vh - ${cardTop + 24}px)`,
          overflowY: 'auto',
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: '14px',
          boxShadow: isDark ? '0 16px 48px rgba(0, 0, 0, 0.5)' : '0 16px 48px rgba(0, 0, 0, 0.12)',
          padding: vp.isPhone ? '14px 14px 16px' : '16px 18px 18px',
          boxSizing: 'border-box',
          animation: 'psp-slideDown 0.25s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Held against Start.dc.html (2026-09-20): the heading is the
                design's one word. The project's name is in the header already. */}
            <div data-testid="start-heading" style={{ fontSize: '15px', fontWeight: 700, color: c.text, letterSpacing: '-0.01em' }}>
              Start{projectName ? <span style={{ color: c.textMuted, fontWeight: 500 }}> · {projectName}</span> : null}
            </div>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss (the toolbar and canvas stay available)"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: c.textMuted, padding: '4px', display: 'flex',
              borderRadius: '6px', flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Three across is the desktop shape. Below that the categories go to
            one column rather than three 90px slivers, which is where the
            labels wrapped to three lines each. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: vp.isPhone ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '10px',
          marginTop: '14px',
        }}>
          {paths.map((p) => {
            const Icon = p.icon;
            const active = expanded === p.id;
            return (
              <button
                key={p.id}
                data-start-path={p.id}
                onClick={() => choose(p.id)}
                style={{
                  // On a phone the icon sits BESIDE the label: a stacked card
                  // is 90px of height each, and three of them push the prompt
                  // box off the screen before it is opened.
                  display: 'flex',
                  flexDirection: vp.isPhone ? 'row' : 'column',
                  alignItems: vp.isPhone ? 'center' : 'flex-start',
                  gap: vp.isPhone ? '10px' : '8px',
                  padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                  borderRadius: '10px',
                  border: `1.5px solid ${active ? p.color + '80' : c.border}`,
                  backgroundColor: active ? p.color + (isDark ? '1f' : '12') : 'transparent',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = p.color + '60'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = c.border; }}
              >
                <div style={{
                  width: '30px', height: '30px', borderRadius: '8px',
                  backgroundColor: p.color + (isDark ? '26' : '18'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={16} color={p.color} />
                </div>
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: c.text }}>{p.label}</div>
                  <div style={{ fontSize: '11.5px', color: c.textMuted, marginTop: '2px' }}>{p.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

        {expanded === 'idea' && (
          <div style={{ marginTop: '14px', fontSize: '13px', color: c.textSecondary, lineHeight: 1.55 }}>
            Ask your connected AI to record the vision in your own words — it calls{' '}
            <code style={codeStyle}>{START_NEW_TOOLS[0]}</code>, then drafts requirements with{' '}
            <code style={codeStyle}>{START_NEW_TOOLS[1]}</code> and architecture with{' '}
            <code style={codeStyle}>{START_NEW_TOOLS[2]}</code>, every change arriving as a proposal you review.
            {' '}
            <a
              href={MCP_TOOLS_DOCS_PATH}
              target="_blank"
              rel="noreferrer"
              style={{ color: c.primary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
            >
              All MCP tools <ExternalLink size={12} />
            </a>
            {promptBox(startPrompt)}
          </div>
        )}

        {expanded === 'code' && canImportRepository && (
          <div data-testid="start-repository" style={{ marginTop: '14px', fontSize: '13px', color: c.textSecondary, lineHeight: 1.55 }}>
            {connectedRepository ? (
              <div data-testid="start-repository-connected" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: c.text, fontWeight: 600 }}>
                <Check size={14} color="#10b981" />
                Connected: {connectedRepository}
              </div>
            ) : (
              <>
                First connect the repository in the Git window: a token, then the owner, repository and branch.
                <div style={{ marginTop: '10px' }}>
                  <button
                    data-testid="start-repository-connect"
                    onClick={onConnectRepository}
                    style={{
                      padding: '8px 14px', fontSize: '12.5px', fontWeight: 600,
                      borderRadius: '8px', border: 'none',
                      backgroundColor: '#3b82f6', color: '#fff', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <GitBranch size={14} /> Connect the repository
                  </button>
                </div>
              </>
            )}
            <div style={{ marginTop: '12px' }}>
              {connectedRepository ? 'Now ask' : 'Then ask'} your connected AI to import it. It calls{' '}
              <code style={codeStyle}>{SPEC_HANDOFF_TOOL}</code>, then <code style={codeStyle}>{REPO_IMPORT_TOOL}</code>,
              and the draft comes back as a proposal you review.
            </div>
            {promptBox(buildRepoImportPrompt(projectName))}
          </div>
        )}

        {expanded === 'import-spec' && (
          <div style={{ marginTop: '14px', fontSize: '13px', color: c.textSecondary, lineHeight: 1.55 }}>
            {stagedSpec ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: c.text, fontWeight: 600 }}>
                  <Check size={14} color="#10b981" />
                  Specification staged ({stagedSpec.chars.toLocaleString()} characters)
                </div>
                <div style={{ marginTop: '4px' }}>
                  Now tell your connected AI to call this tool: <code style={codeStyle}>{SPEC_HANDOFF_TOOL}</code>.
                  The document rides its response and the AI converts it into vision and requirements for your review.
                </div>
                {promptBox(handoffPrompt)}
                <div style={{ marginTop: '10px' }}>
                  <button
                    onClick={onImportSpecification}
                    style={{
                      padding: '7px 12px', fontSize: '12px', fontWeight: 500,
                      borderRadius: '6px', border: `1px solid ${c.border}`,
                      backgroundColor: 'transparent', color: c.text, cursor: 'pointer',
                    }}
                  >
                    Replace or clear the document
                  </button>
                </div>
              </>
            ) : (
              <>
                Paste your spec, PRD, or requirements document in the import window. We stage it on the project and
                give you a one-line note for your AI — it calls <code style={codeStyle}>{SPEC_HANDOFF_TOOL}</code> and
                converts the document faithfully.
                <div style={{ marginTop: '10px' }}>
                  <button
                    onClick={onImportSpecification}
                    style={{
                      padding: '8px 14px', fontSize: '12.5px', fontWeight: 600,
                      borderRadius: '8px', border: 'none',
                      backgroundColor: '#10b981', color: '#fff', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <FileUp size={14} /> Open the import window
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
