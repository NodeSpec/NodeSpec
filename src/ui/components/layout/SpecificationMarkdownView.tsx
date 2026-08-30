import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from '../../theme/ThemeContext.js';
import { useSpecification, useServices } from '../../context/ServiceContext.js';
import type { SpecificationData } from '../../hooks/useRealtimeSpecification.js';
import type { Graph } from '@nodespec/core/types.js';
import type { ProjectExportSpecification, ProjectExportTestCase } from '../../utils/export-context.js';
import { buildProjectExport } from '../../utils/export-context.js';
import { formatSpecificationReadme } from '../../utils/export-specification.js';
import { parseSpecificationMarkdown } from '../../utils/parse-specification-markdown.js';
import { applySpecificationEdits } from '../../utils/apply-specification-edits.js';
import { FileUp, ArrowRight, Loader as Loader2, CircleCheck as CheckCircle2, CircleAlert as AlertCircle } from 'lucide-react';
import { WorkBoardView } from '../board/WorkBoardView.js';

interface SpecificationMarkdownViewProps {
  projectId: string;
  branchId?: string;
  specRealtimeData: SpecificationData;
  graph: Graph;
  projectName: string;
  testSuite?: ProjectExportTestCase[];
  onWarning?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  workflowOrigin?: string;
  onSpecImportComplete?: () => void;
}

function buildMarkdown(
  specRealtimeData: SpecificationData,
  graph: Graph,
  projectName: string,
  testSuite?: ProjectExportTestCase[],
): string | null {
  const spec = specRealtimeData.specification;
  const hasContent = spec?.vision || specRealtimeData.requirements.length > 0;
  if (!spec || !hasContent) return null;

  const sections = specRealtimeData.sections;
  const requirements = specRealtimeData.requirements;

  const sectionMap = new Map(sections.map(s => [s.id, s.name]));

  const specExport: ProjectExportSpecification = {
    vision: spec.vision || '',
    sections: sections.map(s => ({ name: s.name, description: s.description || undefined })),
    requirements: requirements.map(r => ({
      requirementId: r.requirementId,
      name: r.name,
      description: r.description,
      category: r.category,
      status: r.status,
      sectionName: r.sectionId ? sectionMap.get(r.sectionId) : undefined,
      acceptanceCriteria: r.acceptanceCriteria.map(ac => ({ text: ac.text, met: ac.met })),
    })),
    constraints: spec.constraints || [],
    preferences: spec.preferences || {},
  };

  const exportData = buildProjectExport(graph, projectName, testSuite, specExport);
  return formatSpecificationReadme(exportData);
}

function SpecificationMarkdownViewComponent({
  projectId,
  branchId,
  specRealtimeData,
  graph,
  projectName,
  testSuite,
  onWarning,
  onDirtyChange,
  workflowOrigin,
  onSpecImportComplete,
}: SpecificationMarkdownViewProps) {
  const { theme } = useTheme();
  const specService = useSpecification();
  const services = useServices();
  const [editedMarkdown, setEditedMarkdown] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [infoBannerDismissed, setInfoBannerDismissed] = useState(
    () => localStorage.getItem('spec-editor-info-dismissed') === '1',
  );
  // D3: [Specification | Work Board] sub-view, remembered per browser.
  const [subView, setSubView] = useState<'spec' | 'board'>(() => {
    try { return localStorage.getItem('spec-subview') === 'board' ? 'board' : 'spec'; }
    catch { return 'spec'; }
  });
  const originalMarkdownRef = useRef<string | null>(null);

  type ImportPhase = 'input' | 'converting' | 'done' | 'error';
  const [importPhase, setImportPhase] = useState<ImportPhase>('input');
  const [importText, setImportText] = useState('');
  const [importStatusMessages, setImportStatusMessages] = useState<string[]>([]);
  const [importError, setImportError] = useState('');
  const [importDismissed, setImportDismissed] = useState(false);
  const importAbortRef = useRef<AbortController | null>(null);
  const importStatusEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    importStatusEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [importStatusMessages]);

  const addImportStatus = useCallback((msg: string) => {
    setImportStatusMessages(prev => [...prev, msg]);
  }, []);

  const handleImportConvert = useCallback(async () => {
    const trimmed = importText.trim();
    if (!trimmed || !projectId || !branchId) return;

    setImportPhase('converting');
    setImportStatusMessages([]);
    setImportError('');
    addImportStatus('Starting specification conversion...');

    const controller = new AbortController();
    importAbortRef.current = controller;

    const prompt = `Convert the following specification document into structured requirements with acceptance criteria.

INSTRUCTIONS:
1. Extract a clear, concise vision statement from the document.
2. Organize requirements into logical sections (e.g., "User Management", "Core Features", "Data & Storage").
3. Create specific, testable requirements (REQ-001, REQ-002, etc.) with:
   - A short descriptive name
   - A detailed description
   - A category (functional, non-functional, technical, or business)
   - 2-5 acceptance criteria per requirement
4. Preserve the intent and scope of the original document faithfully.
5. Do NOT generate architecture, features, or code. Only specification and requirements.
6. After creating all requirements, provide a brief summary of what was created.

SPECIFICATION DOCUMENT:
---
${trimmed}`;

    const providerParams: Record<string, string> = { endpoint: 'agent-orchestrator-v4' };
    try {
      const stored = localStorage.getItem('nodal-selected-model');
      if (stored) {
        const parsed = JSON.parse(stored) as { id: string; provider: string };
        if (parsed.provider === 'platform') {
          providerParams.provider = 'platform';
        } else if (parsed.provider && parsed.id) {
          providerParams.provider = parsed.provider;
          providerParams.model = parsed.id;
        }
      }
    } catch {}

    try {
      await services.agent.streamAgent(
        { projectId, branchId, message: prompt, maxTurns: 15, ...providerParams },
        {
          onStatus: (status) => addImportStatus(status),
          onSpecificationSaved: (spec) => {
            addImportStatus('Vision statement created');
            if (spec.vision) {
              const preview = spec.vision.length > 80 ? spec.vision.slice(0, 80) + '...' : spec.vision;
              addImportStatus(`  "${preview}"`);
            }
          },
          onSectionCreated: (section) => addImportStatus(`Section: ${section.name}`),
          onRequirementCreated: (req) => addImportStatus(`${req.requirementId}: ${req.name}`),
          onError: (msg) => { setImportError(msg); setImportPhase('error'); },
          onComplete: (summary) => {
            addImportStatus('---');
            addImportStatus(summary || 'Conversion complete.');
            setImportPhase('done');
          },
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setImportError(msg);
      setImportPhase('error');
    }
  }, [importText, projectId, branchId, services.agent, addImportStatus]);

  const handleImportCancel = useCallback(() => {
    importAbortRef.current?.abort();
    setImportPhase('input');
    setImportStatusMessages([]);
  }, []);

  const handleImportDone = useCallback(() => {
    setImportDismissed(true);
    specRealtimeData.refresh();
    onSpecImportComplete?.();
  }, [specRealtimeData, onSpecImportComplete]);

  const showImportView = workflowOrigin === 'import-spec' && !importDismissed;

  const generatedMarkdown = useMemo(
    () => buildMarkdown(specRealtimeData, graph, projectName, testSuite),
    [specRealtimeData, graph, projectName, testSuite],
  );

  useEffect(() => {
    if (editedMarkdown === null && generatedMarkdown) {
      originalMarkdownRef.current = generatedMarkdown;
      setEditedMarkdown(generatedMarkdown);
    }
  }, [generatedMarkdown, editedMarkdown]);

  const isDirty = editedMarkdown !== null && editedMarkdown !== originalMarkdownRef.current;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!editedMarkdown || saving) return;
    setSaving(true);
    try {
      const parsed = parseSpecificationMarkdown(editedMarkdown);
      const summary = await applySpecificationEdits(parsed, specRealtimeData, specService);

      const parts: string[] = [];
      if (summary.visionUpdated) parts.push('vision');
      if (summary.requirementsUpdated > 0) parts.push(`${summary.requirementsUpdated} requirement(s)`);
      if (summary.acceptanceCriteriaUpdated > 0) parts.push(`${summary.acceptanceCriteriaUpdated} acceptance criteria status(es) updated`);

      if (parts.length > 0) {
        onWarning?.(`Saved: ${parts.join(', ')}`);
      } else {
        onWarning?.('No changes detected');
      }

      originalMarkdownRef.current = editedMarkdown;

      specRealtimeData.refresh();
    } catch (err) {
      onWarning?.(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [editedMarkdown, saving, specRealtimeData, specService, onWarning]);

  const handleRegenerate = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm('You have unsaved edits. Refresh will discard them. Continue?');
      if (!ok) return;
    }
    const fresh = buildMarkdown(specRealtimeData, graph, projectName, testSuite);
    if (fresh) {
      originalMarkdownRef.current = fresh;
      setEditedMarkdown(fresh);
    }
  }, [isDirty, specRealtimeData, graph, projectName, testSuite]);

  const c = theme.colors;

  if (specRealtimeData.loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.backgroundTertiary,
        color: c.textMuted,
        fontSize: '15px',
      }}>
        Loading specification...
      </div>
    );
  }

  const hasAnyContent = specRealtimeData.specification?.vision || specRealtimeData.requirements.length > 0;
  if (!hasAnyContent) {
    if (showImportView) {
      return (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.backgroundTertiary,
          padding: '48px 24px',
        }}>
          <div style={{
            width: '100%',
            maxWidth: '640px',
            backgroundColor: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: '16px',
            boxShadow: theme.mode === 'dark'
              ? '0 16px 48px rgba(0, 0, 0, 0.4)'
              : '0 16px 48px rgba(0, 0, 0, 0.08)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '28px 32px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: '#10b98118',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <FileUp size={22} color="#10b981" />
              </div>
              <div>
                <div style={{
                  fontSize: '18px', fontWeight: 700, color: c.text,
                  letterSpacing: '-0.01em',
                }}>
                  Import a Specification
                </div>
                <div style={{
                  fontSize: '13px', color: c.textMuted, marginTop: '2px',
                }}>
                  {importPhase === 'input' && 'Paste your specification document below'}
                  {importPhase === 'converting' && 'Converting to structured requirements...'}
                  {importPhase === 'done' && 'Conversion complete'}
                  {importPhase === 'error' && 'Conversion failed'}
                </div>
              </div>
            </div>

            <div style={{ padding: '24px 32px 32px' }}>
              {importPhase === 'input' && (
                <>
                  <textarea
                    style={{
                      width: '100%',
                      minHeight: '280px',
                      padding: '14px 16px',
                      fontSize: '13px',
                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                      lineHeight: '1.6',
                      backgroundColor: c.backgroundSecondary,
                      color: c.text,
                      border: `1.5px solid ${c.border}`,
                      borderRadius: '10px',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.15s',
                    }}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    onFocus={(e) => { e.currentTarget.style.borderColor = c.primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = c.border; }}
                    placeholder={`Paste your specification, PRD, requirements document, or feature list here...\n\nExample:\n# Project: E-Commerce Platform\n## Vision\nBuild a modern e-commerce platform with user accounts, product catalog, shopping cart, and checkout.\n\n## Requirements\n- Users can register and log in\n- Product catalog with search and filtering\n- Shopping cart with add/remove items\n- Secure checkout with payment processing\n...`}
                    autoFocus
                  />
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: '16px',
                  }}>
                    <div style={{ fontSize: '12px', color: c.textMuted }}>
                      {importText.trim().length > 0
                        ? `${importText.trim().split(/\s+/).length} words`
                        : 'Supports markdown, plain text, bullet lists, or any document format'}
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => setImportDismissed(true)}
                        style={{
                          padding: '10px 18px', fontSize: '13px', fontWeight: 500,
                          borderRadius: '8px', border: `1px solid ${c.border}`,
                          backgroundColor: 'transparent', color: c.textMuted,
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
                      >
                        Skip
                      </button>
                      <button
                        onClick={handleImportConvert}
                        disabled={!importText.trim()}
                        style={{
                          padding: '10px 24px', fontSize: '13px', fontWeight: 600,
                          borderRadius: '8px', border: 'none',
                          backgroundColor: importText.trim() ? '#10b981' : c.border,
                          color: importText.trim() ? '#fff' : c.textMuted,
                          cursor: importText.trim() ? 'pointer' : 'not-allowed',
                          transition: 'all 0.15s',
                          display: 'flex', alignItems: 'center', gap: '6px',
                        }}
                        onMouseEnter={(e) => { if (importText.trim()) e.currentTarget.style.backgroundColor = '#059669'; }}
                        onMouseLeave={(e) => { if (importText.trim()) e.currentTarget.style.backgroundColor = '#10b981'; }}
                      >
                        Convert to Requirements
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {(importPhase === 'converting' || importPhase === 'done' || importPhase === 'error') && (
                <div style={{
                  backgroundColor: c.backgroundSecondary,
                  border: `1px solid ${c.border}`,
                  borderRadius: '10px',
                  padding: '16px',
                  maxHeight: '360px',
                  overflowY: 'auto',
                }}>
                  {importStatusMessages.map((msg, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: '13px',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                        lineHeight: '1.7',
                        color: msg.startsWith('---')
                          ? c.border
                          : msg.startsWith('  ')
                            ? c.textMuted
                            : msg.startsWith('REQ-')
                              ? '#10b981'
                              : c.text,
                        borderTop: msg.startsWith('---') ? `1px solid ${c.border}` : 'none',
                        paddingTop: msg.startsWith('---') ? '8px' : '0',
                        marginTop: msg.startsWith('---') ? '8px' : '0',
                      }}
                    >
                      {msg.startsWith('---') ? '' : msg}
                    </div>
                  ))}
                  {importPhase === 'converting' && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      marginTop: '8px', color: c.textMuted, fontSize: '13px',
                    }}>
                      <Loader2 size={14} style={{ animation: 'specImportSpin 1s linear infinite' }} />
                      Processing...
                    </div>
                  )}
                  <div ref={importStatusEndRef} />
                </div>
              )}

              {importPhase === 'error' && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  marginTop: '16px', padding: '12px 14px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '8px',
                }}>
                  <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />
                  <div style={{ fontSize: '13px', color: '#ef4444', lineHeight: '1.5' }}>
                    {importError || 'An error occurred during conversion.'}
                  </div>
                </div>
              )}

              {(importPhase === 'done' || importPhase === 'error') && (
                <div style={{
                  display: 'flex', gap: '12px', justifyContent: 'flex-end',
                  marginTop: '20px',
                }}>
                  {importPhase === 'error' && (
                    <button
                      onClick={() => { setImportPhase('input'); setImportStatusMessages([]); }}
                      style={{
                        padding: '10px 20px', fontSize: '13px', fontWeight: 500,
                        borderRadius: '8px', border: `1px solid ${c.border}`,
                        backgroundColor: 'transparent', color: c.text,
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.surfaceHover; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      Try Again
                    </button>
                  )}
                  {importPhase === 'done' && (
                    <button
                      onClick={handleImportDone}
                      style={{
                        padding: '10px 24px', fontSize: '13px', fontWeight: 600,
                        borderRadius: '8px', border: 'none',
                        backgroundColor: '#10b981', color: '#fff',
                        cursor: 'pointer', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', gap: '8px',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}
                    >
                      <CheckCircle2 size={16} />
                      View Requirements
                    </button>
                  )}
                </div>
              )}

              {importPhase === 'converting' && (
                <div style={{
                  display: 'flex', justifyContent: 'flex-end', marginTop: '16px',
                }}>
                  <button
                    onClick={handleImportCancel}
                    style={{
                      padding: '8px 16px', fontSize: '12px', fontWeight: 500,
                      borderRadius: '6px', border: `1px solid ${c.border}`,
                      backgroundColor: 'transparent', color: c.textMuted,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
          <style>{`@keyframes specImportSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }

    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.backgroundTertiary,
        color: c.textMuted,
        fontSize: '15px',
      }}>
        No specification data yet. Add requirements or a project vision to get started.
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      minHeight: 0,
      backgroundColor: c.backgroundTertiary,
    }}>
      {/* D3 (owner refinement 2026-08-21): the Work Board lives HERE, as a
          sub-view — the board's rows ARE requirements, so tracking sits one
          toggle from authoring. The markdown editor stays mounted-in-state:
          unsaved edits survive a trip to the board and back.
          minHeight 68px: the floating view pill (absolute top 16, ~50px tall)
          must land INSIDE this header band, clear of the board's facet bar. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '8px 16px', minHeight: '68px', boxSizing: 'border-box',
        borderBottom: `1px solid ${c.border}`, flexShrink: 0,
      }}>
        {(['spec', 'board'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => {
              setSubView(mode);
              try { localStorage.setItem('spec-subview', mode); } catch { /* private mode */ }
            }}
            style={{
              padding: '5px 14px', borderRadius: '7px', fontSize: '12.5px', fontWeight: 600,
              border: 'none', cursor: 'pointer',
              backgroundColor: subView === mode ? c.primary : 'transparent',
              color: subView === mode ? '#fff' : c.textMuted,
            }}
          >
            {mode === 'spec' ? 'Specification' : 'Work Board'}
          </button>
        ))}
      </div>
      {subView === 'board' ? (
        <WorkBoardView
          projectId={projectId}
          specificationId={specRealtimeData.specification?.id ?? null}
          graph={graph}
        />
      ) : (
      <>
      {!infoBannerDismissed && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          fontSize: '12px',
          color: c.textMuted,
          backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          borderBottom: `1px solid ${c.border}`,
          flexShrink: 0,
        }}>
          <span>Edits to vision, requirement text, and acceptance criteria checkboxes sync back to the spec. Auto-generated sections are read-only.</span>
          <button
            onClick={() => {
              setInfoBannerDismissed(true);
              localStorage.setItem('spec-editor-info-dismissed', '1');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: c.textMuted,
              cursor: 'pointer',
              padding: '0 0 0 12px',
              fontSize: '14px',
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
      <Editor
        height="100%"
        language="markdown"
        theme={theme.mode === 'dark' ? 'vs-dark' : 'light'}
        value={editedMarkdown ?? ''}
        onChange={(val) => setEditedMarkdown(val ?? '')}
        options={{
          minimap: { enabled: false },
          wordWrap: 'on',
          lineNumbers: 'on',
          fontSize: 14,
          padding: { top: 16 },
          scrollBeyondLastLine: false,
          renderWhitespace: 'none',
          automaticLayout: true,
        }}
      />
      </div>

      <div style={{
        position: 'absolute',
        bottom: '24px',
        right: '24px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        zIndex: 10,
      }}>
        {isDirty && (
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#f59e0b',
            flexShrink: 0,
          }} />
        )}
        <button
          onClick={handleRegenerate}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: `1px solid ${c.border}`,
            backgroundColor: c.surface,
            color: c.text,
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = c.surface;
          }}
          title="Rebuild markdown from the current specification data"
        >
          Refresh from spec
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          style={{
            padding: '8px 20px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: isDirty ? c.primary : c.border,
            color: isDirty ? '#ffffff' : c.textMuted,
            fontSize: '13px',
            fontWeight: 600,
            cursor: isDirty && !saving ? 'pointer' : 'default',
            opacity: isDirty ? 1 : 0.6,
            transition: 'all 0.15s ease',
            boxShadow: isDirty ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      </>
      )}
    </div>
  );
}

export const SpecificationMarkdownView = memo(SpecificationMarkdownViewComponent);
