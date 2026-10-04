import { useState, memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { ProjectExportData } from '../../utils/export-context.js';
import { downloadAsFile, copyToClipboard, exportCounts, exportPreviewLine } from '../../utils/export-context.js';
import { downloadProjectAsZip } from '../../utils/export-zip.js';
import { formatSpecificationReadme } from '../../utils/export-specification.js';
import { formatAsClaude, formatAsCursorRules, formatAsAgents } from '../../utils/export-agent-rules.js';
import { formatAsMermaid } from '../../utils/export-mermaid.js';
import { resolveSupabaseConfig } from '../../../persistence/supabase/client.js';
import { isHostedEdition } from '../../config/edition.js';

interface ProjectExportModalProps {
  data: ProjectExportData;
  onClose: () => void;
  hasGitIntegration?: boolean;
  onPushToGit?: () => void;
  /** Hosted edition only: opens the marketplace publish modal (owned by GraphEditor). */
  onPublishToMarketplace?: () => void;
}

interface ExportOption {
  id: string;
  label: string;
  filename: string;
  description: string;
  icon: React.ReactNode;
  getContent: () => string | null;
  isZip?: boolean;
  isGitPush?: boolean;
  isPublish?: boolean;
}

function buildTestPlanOption(data: ProjectExportData): ExportOption[] {
  const testPlanArtifacts = data.artifacts.filter(a => a.kind === 'test-plan' && a.content);
  if (testPlanArtifacts.length === 0) return [];

  return [{
    id: 'test-plans',
    label: 'Test Plans',
    filename: `${data.meta.projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}-test-plans.md`,
    description: `${testPlanArtifacts.length} test plan document${testPlanArtifacts.length > 1 ? 's' : ''} with acceptance criteria, strategy, and framework recommendations.`,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="2" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
    getContent: () => {
      const lines: string[] = [];
      lines.push(`# Test Plans: ${data.meta.projectName}`);
      lines.push('');
      lines.push(`> ${testPlanArtifacts.length} test plan document${testPlanArtifacts.length > 1 ? 's' : ''} | Exported: ${data.meta.exportedAt}`);
      lines.push('');
      lines.push('---');
      lines.push('');
      for (const artifact of testPlanArtifacts) {
        lines.push(`<!-- source: ${artifact.path} | node: ${artifact.nodeLabel} -->`);
        lines.push('');
        lines.push(artifact.content!);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      return lines.join('\n');
    },
  }];
}

function ProjectExportModalComponent({ data, onClose, hasGitIntegration, onPushToGit, onPublishToMarketplace }: ProjectExportModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [includeCode, setIncludeCode] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // The design's preview pane, folded under the card: the file's own line and its text.
  const [previewId, setPreviewId] = useState<string | null>(null);

  const buildFilteredData = (): ProjectExportData => {
    if (includeCode) return data;
    return {
      ...data,
      artifacts: data.artifacts.map(a => ({ ...a, content: undefined })),
    };
  };

  const exportOptions: ExportOption[] = [
    {
      id: 'git-push',
      label: 'Commit to Git',
      filename: '',
      description: !hasGitIntegration
        ? 'Connect a GitHub or GitLab repository to commit artifact files.'
        : 'Commit all artifact files directly to your connected GitHub or GitLab repository.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      ),
      getContent: () => null,
      isGitPush: true,
    },
    // 9.13 (owner): Specification.md sits directly under Commit to Git. It is
    // the document a PERSON reads — the vision, the requirements and whether
    // they are proved — so it leads the list of files; the three agent files
    // follow, because they are read by tools.
    {
      id: 'spec',
      label: 'Specification.md',
      filename: `${data.meta.projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}-specification.md`,
      description: 'For people: the vision, every requirement with its acceptance criteria met and unmet, test coverage and progress.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      ),
      getContent: () => formatSpecificationReadme(data),
    },
    // Hosted edition only: the marketplace publish card. Self-hosted builds
    // never pass the callback and isHostedEdition compiles the branch away.
    ...(isHostedEdition && onPublishToMarketplace ? [{
      id: 'publish-marketplace',
      label: 'Publish to NodeSpec Marketplace',
      filename: '',
      description: 'Share this architecture as a community template others can browse, upvote, and start from. Source code never leaves your project.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 2 7l10 5 10-5-10-5z" />
          <path d="m2 17 10 5 10-5" />
          <path d="m2 12 10 5 10-5" />
        </svg>
      ),
      getContent: () => null,
      isPublish: true,
    } satisfies ExportOption] : []),
    {
      id: 'claude',
      label: 'CLAUDE.md',
      filename: 'CLAUDE.md',
      description: 'For agents: architecture, constraints and every unmet acceptance criterion. Claude Code reads it each session and follows its @imports to per-node context.',
      icon: (
        <img
          src={`${resolveSupabaseConfig().url}/storage/v1/object/public/icons/anthropic.png`}
          alt="Anthropic"
          width={20}
          height={20}
          style={{ objectFit: 'contain' }}
        />
      ),
      getContent: () => formatAsClaude(buildFilteredData()),
    },
    {
      id: 'agents',
      label: 'AGENTS.md',
      filename: 'AGENTS.md',
      description: 'The same agent context, self-contained for tools with no import mechanism. Read by Codex, Jules, Copilot, Gemini CLI and 20+ others.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      getContent: () => formatAsAgents(buildFilteredData()),
    },
    {
      id: 'cursor',
      label: 'Cursor Rules',
      filename: '.cursor/rules/nodespec.mdc',
      description: 'The same agent context, kept terse: it auto-attaches by glob while you edit, so it carries directives and points at the context directory.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86h6.21c.36 0 .57-.4.36-.68L5.97 2.8a.5.5 0 0 0-.47.41Z" />
        </svg>
      ),
      getContent: () => formatAsCursorRules(buildFilteredData()),
    },
    {
      id: 'mermaid',
      label: 'Mermaid Diagram',
      filename: `${data.meta.projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}-architecture.mmd`,
      description: 'Architecture diagram as Mermaid flowchart -- paste into GitHub, Notion, docs, or mermaid.live.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" />
          <path d="M9 6h6" />
          <path d="M18 9v6" />
          <path d="M6 9v9a2 2 0 0 0 2 2h7" />
        </svg>
      ),
      getContent: () => formatAsMermaid(buildFilteredData()),
    },
    ...buildTestPlanOption(data),
    {
      id: 'zip',
      label: 'Full Project (.zip)',
      filename: `${data.meta.projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}-repo.zip`,
      description: 'All of the above + per-node RAG context files (.nodespec/context/) + source artifacts.',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      ),
      getContent: () => null,
      isZip: true,
    },
  ];

  const handleDownload = (option: ExportOption) => {
    if (option.isZip) {
      downloadProjectAsZip(buildFilteredData());
      return;
    }
    const content = option.getContent();
    if (!content) return;
    downloadAsFile(content, option.filename, 'text/markdown');
  };

  const handleCopy = async (option: ExportOption) => {
    if (option.isZip) return;
    const content = option.getContent();
    if (!content) return;
    const success = await copyToClipboard(content);
    if (success) {
      setCopiedId(option.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // V3 4.5: four counts, from the one pure function the tests read.
  const stats = exportCounts(data);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '560px', maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          backgroundColor: c.surface, borderRadius: '14px', border: `1px solid ${c.border}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px 14px', borderBottom: `1px solid ${c.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: c.text, marginBottom: '6px' }}>
              Export: {data.meta.projectName}
            </div>
            <div style={{ fontSize: '12px', color: c.textMuted, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {stats.map(s => (
                <span key={s.label}>
                  <span style={{ fontWeight: 600, color: c.textSecondary }}>{s.value}</span> {s.label}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '20px', lineHeight: 1,
            color: c.textMuted, cursor: 'pointer', padding: '2px 6px', borderRadius: '4px',
          }}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Export cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exportOptions.map(option => {
              if (option.isGitPush) {
                return (
                  <div
                    key={option.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '14px',
                      padding: '14px 16px', borderRadius: '10px',
                      border: `1px solid ${c.border}`,
                      backgroundColor: c.background,
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '8px',
                      backgroundColor: c.surface, border: `1px solid ${c.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: c.textSecondary, flexShrink: 0,
                    }}>
                      {option.icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                          {option.label}
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.4 }}>
                        {option.description}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      {!hasGitIntegration ? (
                        <button
                          onClick={onPushToGit}
                          style={{
                            padding: '6px 14px', fontSize: '12px', fontWeight: 500, borderRadius: '6px',
                            border: `1px solid ${c.border}`, backgroundColor: c.surface,
                            color: c.text, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '5px',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.primary; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = c.border; }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 3h6v6" />
                            <path d="M10 14 21 3" />
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          </svg>
                          Connect Repository
                        </button>
                      ) : (
                        <button
                          onClick={onPushToGit}
                          style={{
                            padding: '6px 14px', fontSize: '12px', fontWeight: 500, borderRadius: '6px',
                            border: '1px solid #059669', backgroundColor: '#f0fdf4',
                            color: '#059669', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '5px',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#dcfce7'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f0fdf4'; }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                            <polyline points="16 6 12 2 8 6" />
                            <line x1="12" y1="2" x2="12" y2="15" />
                          </svg>
                          Commit
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              if (option.isPublish) {
                return (
                  <div
                    key={option.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '14px',
                      padding: '14px 16px', borderRadius: '10px',
                      border: `1px solid ${c.border}`,
                      backgroundColor: c.background,
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '8px',
                      backgroundColor: c.surface, border: `1px solid ${c.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: c.textSecondary, flexShrink: 0,
                    }}>
                      {option.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                          {option.label}
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.4 }}>
                        {option.description}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <button
                        onClick={onPublishToMarketplace}
                        style={{
                          padding: '6px 14px', fontSize: '12px', fontWeight: 500, borderRadius: '6px',
                          border: `1px solid ${c.border}`, backgroundColor: c.surface,
                          color: c.text, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '5px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.primary; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = c.border; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                          <polyline points="16 6 12 2 8 6" />
                          <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                        Publish…
                      </button>
                    </div>
                  </div>
                );
              }

              const content = !option.isZip ? option.getContent() : 'zip';
              const isAvailable = content !== null;
              const isCopied = copiedId === option.id;
              const previewable = !option.isZip && isAvailable;
              const previewing = previewable && previewId === option.id;
              const line = exportPreviewLine(option.id, data);

              return (
                <div
                  key={option.id}
                  data-testid="export-card"
                  data-option={option.id}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: '10px',
                    padding: '14px 16px', borderRadius: '10px',
                    border: `1px solid ${previewing ? c.primary : c.border}`,
                    backgroundColor: c.background,
                    opacity: isAvailable ? 1 : 0.5,
                    transition: 'border-color 0.15s',
                  }}
                >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  {/* Icon */}
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '8px',
                    backgroundColor: c.surface, border: `1px solid ${c.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: c.textSecondary, flexShrink: 0,
                  }}>
                    {option.icon}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                        {option.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.4 }}>
                      {option.description}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    {previewable && (
                      <button
                        data-testid="export-preview-toggle"
                        aria-pressed={previewing}
                        onClick={() => setPreviewId(previewing ? null : option.id)}
                        title={previewing ? 'Hide the file' : 'Read the file here'}
                        style={{
                          padding: '6px 10px', fontSize: '12px', fontWeight: 500, borderRadius: '6px',
                          border: `1px solid ${previewing ? c.primary : c.border}`, backgroundColor: 'transparent',
                          color: previewing ? c.primary : c.textMuted, cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        {previewing ? 'Hide' : 'Preview'}
                      </button>
                    )}
                    {!option.isZip && isAvailable && (
                      <button
                        onClick={() => handleCopy(option)}
                        title="Copy to clipboard"
                        style={{
                          width: '32px', height: '32px', borderRadius: '6px',
                          border: `1px solid ${c.border}`, backgroundColor: 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', color: isCopied ? '#16a34a' : c.textMuted,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isCopied) e.currentTarget.style.backgroundColor = c.surface;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        {isCopied ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(option)}
                      disabled={!isAvailable}
                      style={{
                        padding: '6px 14px', fontSize: '12px', fontWeight: 500, borderRadius: '6px',
                        border: `1px solid ${c.border}`, backgroundColor: c.surface,
                        color: isAvailable ? c.text : c.textMuted, cursor: isAvailable ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', gap: '5px',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (isAvailable) e.currentTarget.style.borderColor = c.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = c.border;
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </button>
                  </div>
                </div>
                {previewing && (
                  <div data-testid="export-preview" style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: `1px solid ${c.border}`, paddingTop: '10px' }}>
                    {line && <span data-testid="export-preview-line" style={{ fontSize: '11.5px', fontWeight: 600, color: c.textSecondary }}>{line}</span>}
                    <pre style={{ margin: 0, maxHeight: '260px', overflow: 'auto', padding: '10px 12px', borderRadius: '8px', backgroundColor: c.surface, border: `1px solid ${c.border}`, fontSize: '11px', lineHeight: 1.5, color: c.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{content}</pre>
                  </div>
                )}
                </div>
              );
            })}
          </div>

          {/* Options */}
          {data.artifacts.filter(a => a.content).length > 0 && (
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${c.border}` }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                fontSize: '12px', color: c.text, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={includeCode}
                  onChange={() => setIncludeCode(!includeCode)}
                  style={{ accentColor: c.primary }}
                />
                Include source code in exports ({data.artifacts.filter(a => a.content).length} files with content)
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px', borderTop: `1px solid ${c.border}`,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
              border: `1px solid ${c.border}`, backgroundColor: c.background,
              color: c.text, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export const ProjectExportModal = memo(ProjectExportModalComponent);
