import { memo, useState, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { X, TestTube, CircleCheck as CheckCircle2, CircleX, Circle, Clock, FileCode as FileCode2, TriangleAlert as AlertTriangle } from 'lucide-react';
import { useTestCase, useServices, useSpecification } from '../../context/ServiceContext.js';
import type { TestCase } from '../../../persistence/supabase/test-case-repository.js';
import type { Node as GraphNode } from '@nodespec/core/types.js';

interface TestInspectorProps {
  testCaseId: string;
  projectId: string;
  archNodeIds?: string[];
  onClose: () => void;
}

const TEST_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  unit: { color: '#3b82f6', label: 'Unit' },
  integration: { color: '#8b5cf6', label: 'Integration' },
  e2e: { color: '#f59e0b', label: 'E2E' },
  acceptance: { color: '#10b981', label: 'Acceptance' },
  performance: { color: '#ef4444', label: 'Performance' },
  security: { color: '#ec4899', label: 'Security' },
};

const STATUS_CONFIG: Record<string, { color: string; label: string; Icon: typeof Circle }> = {
  not_started: { color: '#6b7280', label: 'Not Started', Icon: Circle },
  passed: { color: '#10b981', label: 'Passed', Icon: CheckCircle2 },
  failed: { color: '#ef4444', label: 'Failed', Icon: CircleX },
  skipped: { color: '#f59e0b', label: 'Skipped', Icon: Clock },
  running: { color: '#3b82f6', label: 'Running', Icon: Circle },
};

function TestInspectorComponent({ testCaseId, projectId, archNodeIds = [], onClose }: TestInspectorProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const testCaseService = useTestCase();
  const services = useServices();
  const specificationService = useSpecification();

  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [requirementName, setRequirementName] = useState<string | null>(null);
  const [archNodes, setArchNodes] = useState<GraphNode[]>([]);
  const [sourceArtifacts, setSourceArtifacts] = useState<Array<{ id: string; path: string; language?: string }>>([]);
  // E2 maintenance lanes (rename / reassign / retire) — the same doctrine as
  // the update_test_case MCP tool, through TestCaseService.
  const [manageOpen, setManageOpen] = useState(false);
  const [renameTestId, setRenameTestId] = useState('');
  const [renameName, setRenameName] = useState('');
  const [reassignTarget, setReassignTarget] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [requirementOptions, setRequirementOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageNote, setManageNote] = useState<string | null>(null);

  useEffect(() => {
    loadTestCase();
  }, [testCaseId]);

  const loadTestCase = async () => {
    try {
      setLoading(true);
      const tc = await testCaseService.getTestCase(testCaseId);
      setTestCase(tc);
      if (tc) {
        setRenameTestId(tc.testId);
        setRenameName(tc.name);
      }

      if (tc?.requirementId) {
        try {
          const req = await specificationService.getRequirement(tc.requirementId);
          if (req) setRequirementName(req.requirementId ? `${req.requirementId}: ${req.name}` : req.name);
        } catch {}
      }

      if (archNodeIds.length > 0 && services.persistence) {
        try {
          const graphRepo = services.persistence.getGraphRepository();
          const branchRepo = services.persistence.getBranchRepository();
          const branchResult = await branchRepo.getByName(projectId, 'main');
          const mainBranch = branchResult.success ? branchResult.data : null;
          if (mainBranch) {
            const snapResult = await graphRepo.loadSnapshot(mainBranch.id);
            const snapshot = snapResult.success ? snapResult.data : null;
            if (snapshot?.graphData?.nodes) {
              const nodes: GraphNode[] = [];
              for (const nid of archNodeIds) {
                const node = snapshot.graphData.nodes[nid];
                if (node) nodes.push(node);
              }
              setArchNodes(nodes);
            }
          }
        } catch {}
      }

      if (tc?.sourceArtifactIds && tc.sourceArtifactIds.length > 0 && services.persistence) {
        try {
          const artifactRepo = services.persistence.getArtifactRepository();
          const artifacts: Array<{ id: string; path: string; language?: string }> = [];
          for (const artId of tc.sourceArtifactIds) {
            const artResult = await artifactRepo.loadArtifact(artId);
            if (artResult.success && artResult.data) {
              artifacts.push({
                id: artResult.data.id,
                path: artResult.data.path,
                language: artResult.data.language,
              });
            }
          }
          setSourceArtifacts(artifacts);
        } catch {}
      }
    } catch (err) {
      console.error('[TestInspector] Failed to load test case:', err);
    } finally {
      setLoading(false);
    }
  };

  const borderColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const mutedText = theme.mode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';

  if (loading) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={{ ...panelStyle(c, theme), padding: '40px', textAlign: 'center' as const }}
          onClick={e => e.stopPropagation()}>
          <Circle size={24} style={{ animation: 'spin 1s linear infinite', color: c.textMuted }} />
        </div>
      </div>
    );
  }

  if (!testCase) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={{ ...panelStyle(c, theme), padding: '40px', textAlign: 'center' as const }}
          onClick={e => e.stopPropagation()}>
          <p style={{ color: c.textMuted }}>Test case not found</p>
        </div>
      </div>
    );
  }

  const typeConf = TEST_TYPE_CONFIG[testCase.testType] || { color: '#6b7280', label: testCase.testType };
  const statusConf = STATUS_CONFIG[testCase.status] || STATUS_CONFIG.not_started;
  const StatusIcon = statusConf.Icon;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle(c, theme)} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: `1px solid ${borderColor}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <TestTube size={18} color="#06b6d4" />
            <span style={{ fontSize: '16px', fontWeight: 700, color: c.text }}>Test Inspector</span>
            <span style={{
              fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
              color: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.12)',
              padding: '2px 8px', borderRadius: '4px',
            }}>
              {testCase.testId}
            </span>
          </div>
          <button onClick={onClose} style={{
            padding: '6px', border: 'none', background: 'transparent',
            color: c.textMuted, cursor: 'pointer', borderRadius: '4px',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Test name */}
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: c.text, margin: '0 0 16px 0', lineHeight: 1.4 }}>
            {testCase.name}
          </h3>

          {/* Badges row: type, framework, status */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <span style={badgeStyle(typeConf.color)}>{typeConf.label}</span>
            {testCase.framework && (
              <span style={badgeStyle(theme.mode === 'dark' ? '#94a3b8' : '#64748b')}>
                {testCase.framework}
              </span>
            )}
            <span style={{
              ...badgeStyle(statusConf.color),
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <StatusIcon size={12} />
              {statusConf.label}
            </span>
          </div>

          {/* Stale banner */}
          {testCase.stale && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', marginBottom: '20px', borderRadius: '6px',
              backgroundColor: theme.mode === 'dark' ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
              border: `1px solid ${theme.mode === 'dark' ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.18)'}`,
            }}>
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: theme.mode === 'dark' ? '#fbbf24' : '#b45309', marginBottom: '2px' }}>
                  Test may be outdated
                </div>
                <div style={{ fontSize: '11px', color: theme.mode === 'dark' ? '#fcd34d' : '#92400e', lineHeight: 1.4 }}>
                  {testCase.stalenessReason || 'Source changed since this result was reported.'}
                </div>
              </div>
            </div>
          )}

          {/* Retired banner — soft state, never a delete; revival is one click
              (or a fresh report_test_results run). */}
          {testCase.retiredAt && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', marginBottom: '20px', borderRadius: '6px',
              backgroundColor: theme.mode === 'dark' ? 'rgba(107,114,128,0.12)' : 'rgba(107,114,128,0.08)',
              border: `1px solid ${theme.mode === 'dark' ? 'rgba(107,114,128,0.3)' : 'rgba(107,114,128,0.2)'}`,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: c.textSecondary, marginBottom: '2px' }}>
                  Retired — excluded from counts, evidence preserved
                </div>
                <div style={{ fontSize: '11px', color: c.textMuted, lineHeight: 1.4 }}>
                  {testCase.retiredReason || 'No reason recorded.'} A fresh reported run also revives it.
                </div>
              </div>
              <button onClick={() => void handleUnretire()} style={{
                padding: '5px 12px', border: `1px solid ${borderColor}`, borderRadius: '6px',
                cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                backgroundColor: 'transparent', color: c.text, flexShrink: 0,
              }}>
                Un-retire
              </button>
            </div>
          )}

          {/* Description */}
          {testCase.description && (
            <Section label="Description" mutedText={mutedText}>
              <p style={{ fontSize: '13px', color: c.text, lineHeight: 1.6, margin: 0 }}>
                {testCase.description}
              </p>
            </Section>
          )}

          {/* Expected result */}
          {testCase.expectedResult && (
            <Section label="Expected Result" mutedText={mutedText}>
              <p style={{ fontSize: '13px', color: c.text, lineHeight: 1.6, margin: 0 }}>
                {testCase.expectedResult}
              </p>
            </Section>
          )}

          {/* Traceability */}
          {(() => {
            const metaLabels = testCase.metadata?.archNodeLabels as Record<string, string> | undefined;
            const hasMetaLabels = metaLabels && Object.keys(metaLabels).length > 0;
            if (!requirementName && archNodes.length === 0 && !hasMetaLabels) return null;
            return (
            <Section label="Traceability" mutedText={mutedText}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                padding: '8px 10px',
                borderRadius: '6px',
                backgroundColor: theme.mode === 'dark' ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)',
                border: `1px solid ${theme.mode === 'dark' ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)'}`,
                marginBottom: '10px',
                fontSize: '12px',
              }}>
                {requirementName && (
                  <span style={{ fontWeight: 600, color: c.primary }}>
                    {requirementName.split(':')[0]}
                  </span>
                )}
                {requirementName && (archNodes.length > 0 || hasMetaLabels) && (
                  <span style={{ color: c.textMuted, fontSize: '14px' }}>&#8594;</span>
                )}
                {archNodes.length > 0 ? (
                  archNodes.map(node => (
                    <span key={node.id} style={{
                      color: '#22c55e',
                      backgroundColor: 'rgba(34,197,94,0.1)',
                      padding: '2px 8px', borderRadius: '4px',
                      border: '1px solid rgba(34,197,94,0.2)',
                      fontWeight: 500,
                    }}>
                      {node.label}
                    </span>
                  ))
                ) : hasMetaLabels ? (
                  Object.entries(metaLabels).map(([, label]) => (
                    <span key={label} style={{
                      color: '#22c55e',
                      backgroundColor: 'rgba(34,197,94,0.1)',
                      padding: '2px 8px', borderRadius: '4px',
                      border: '1px solid rgba(34,197,94,0.2)',
                      fontWeight: 500,
                    }}>
                      {label}
                    </span>
                  ))
                ) : null}
                {(requirementName || archNodes.length > 0 || hasMetaLabels) && (
                  <span style={{ color: c.textMuted, fontSize: '14px' }}>&#8594;</span>
                )}
                <span style={{
                  fontWeight: 700, color: '#06b6d4',
                  fontFamily: "'SF Mono', monospace",
                }}>
                  {testCase.testId}
                </span>
              </div>
              {requirementName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', color: mutedText, fontWeight: 600, minWidth: '80px' }}>Requirement</span>
                  <span style={{ fontSize: '12px', color: c.text }}>{requirementName}</span>
                </div>
              )}
            </Section>
            );
          })()}

          {/* Source files */}
          {sourceArtifacts.length > 0 && (
            <Section label="Source Files Under Test" mutedText={mutedText}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sourceArtifacts.map(art => (
                  <div key={art.id} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 10px', borderRadius: '6px',
                    backgroundColor: theme.mode === 'dark' ? 'rgba(6,182,212,0.06)' : 'rgba(6,182,212,0.03)',
                    border: `1px solid ${theme.mode === 'dark' ? 'rgba(6,182,212,0.15)' : 'rgba(6,182,212,0.1)'}`,
                  }}>
                    <FileCode2 size={14} color="#06b6d4" style={{ flexShrink: 0 }} />
                    <span style={{
                      fontSize: '12px', fontFamily: "'SF Mono', 'Fira Code', monospace",
                      color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {art.path}
                    </span>
                    {art.language && (
                      <span style={{
                        fontSize: '10px', fontWeight: 600, color: '#06b6d4',
                        backgroundColor: 'rgba(6,182,212,0.1)', padding: '1px 6px',
                        borderRadius: '3px', marginLeft: 'auto', flexShrink: 0,
                      }}>
                        {art.language}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* E2: the maintenance lanes — rename / reassign / retire, mirroring
              the update_test_case MCP tool. Reassigned cases arrive stale (a
              moved test has proven nothing about its new home); retire is soft
              and releases criterion bindings met-preserved. */}
          <Section label="Manage" mutedText={mutedText}>
            {!manageOpen ? (
              <button onClick={() => void openManage()} style={{
                padding: '6px 14px', border: `1px solid ${borderColor}`, borderRadius: '6px',
                cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                backgroundColor: 'transparent', color: c.text,
              }}>
                Rename · Reassign · Retire…
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {manageError && (
                  <div style={{ fontSize: '12px', color: '#dc2626', lineHeight: 1.4 }}>{manageError}</div>
                )}
                {manageNote && (
                  <div style={{ fontSize: '12px', color: '#16a34a', lineHeight: 1.4 }}>{manageNote}</div>
                )}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input value={renameTestId} onChange={(e) => setRenameTestId(e.target.value)}
                    placeholder="Test id" style={manageInputStyle(c, borderColor, '110px')} />
                  <input value={renameName} onChange={(e) => setRenameName(e.target.value)}
                    placeholder="Name" style={manageInputStyle(c, borderColor, '180px')} />
                  <button onClick={() => void handleRename()} style={manageButtonStyle(c, borderColor)}>Rename</button>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={reassignTarget} onChange={(e) => setReassignTarget(e.target.value)}
                    style={manageInputStyle(c, borderColor, '300px')}>
                    <option value="">Reassign to requirement…</option>
                    {requirementOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                  <button onClick={() => void handleReassign()} disabled={!reassignTarget}
                    title="The case moves deliberately stale — re-run it against its new requirement and report a fresh result."
                    style={{ ...manageButtonStyle(c, borderColor), opacity: reassignTarget ? 1 : 0.5 }}>
                    Reassign
                  </button>
                </div>
                {!testCase.retiredAt && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input value={retireReason} onChange={(e) => setRetireReason(e.target.value)}
                      placeholder='Retire reason (e.g. "superseded by TC-004")'
                      style={manageInputStyle(c, borderColor, '300px')} />
                    <button onClick={() => void handleRetire()} disabled={!retireReason.trim()}
                      title="Soft retirement: the row and its history survive; counts exclude it; bound criteria release met-preserved (evidence-due). Never a hard delete."
                      style={{ ...manageButtonStyle(c, borderColor), color: '#d97706', opacity: retireReason.trim() ? 1 : 0.5 }}>
                      Retire
                    </button>
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* Footer: status toggle */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px',
          borderTop: `1px solid ${borderColor}`,
        }}>
          <span style={{ fontSize: '12px', color: mutedText }}>Mark status:</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['not_started', 'passed', 'failed'] as const).map(status => {
              const conf = STATUS_CONFIG[status];
              const isActive = testCase.status === status;
              return (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 12px', border: `1px solid ${isActive ? conf.color : borderColor}`,
                    borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                    backgroundColor: isActive ? conf.color + '18' : 'transparent',
                    color: isActive ? conf.color : c.textMuted,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <conf.Icon size={12} />
                  {conf.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  async function handleStatusChange(newStatus: string) {
    if (!testCase || testCase.status === newStatus) return;
    try {
      await testCaseService.updateTestCase(testCase.id, { status: newStatus as TestCase['status'] });
      setTestCase({ ...testCase, status: newStatus as TestCase['status'] });
    } catch (err) {
      console.error('[TestInspector] Failed to update status:', err);
    }
  }

  async function openManage() {
    setManageOpen(true);
    setManageError(null);
    // The reassign select needs the spec's requirements (excluding the owner).
    try {
      const specs = await specificationService.getSpecificationsByProject(projectId);
      const spec = specs[0];
      if (spec) {
        const reqs = await specificationService.getRequirementsBySpecification(spec.id);
        setRequirementOptions(reqs
          .filter((r) => r.id !== testCase?.requirementId)
          .map((r) => ({ id: r.id, label: `${r.requirementId}: ${r.name}` })));
      }
    } catch (err) {
      console.error('[TestInspector] Failed to load requirements:', err);
    }
  }

  async function handleRename() {
    if (!testCase) return;
    setManageError(null); setManageNote(null);
    try {
      const updated = await testCaseService.renameTestCase(testCase.id, {
        testId: renameTestId, name: renameName,
      });
      setTestCase(updated);
      setManageNote('Renamed. Criterion bindings key on the row, so evidence linkage survives a rename.');
    } catch (err) {
      setManageError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReassign() {
    if (!testCase || !reassignTarget) return;
    setManageError(null); setManageNote(null);
    try {
      const updated = await testCaseService.reassignTestCase(testCase.id, reassignTarget);
      setTestCase(updated);
      setReassignTarget('');
      setManageNote('Reassigned — the case is deliberately stale on its new requirement. Re-run it there and report a fresh result; the old requirement’s released criteria read evidence-due.');
      void loadTestCase();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRetire() {
    if (!testCase || !retireReason.trim()) return;
    setManageError(null); setManageNote(null);
    try {
      const updated = await testCaseService.retireTestCase(testCase.id, retireReason);
      setTestCase(updated);
      setRetireReason('');
      setManageNote('Retired — excluded from counts, row and history preserved. A fresh reported run (or Un-retire) revives it.');
    } catch (err) {
      setManageError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUnretire() {
    if (!testCase) return;
    try {
      const updated = await testCaseService.unretireTestCase(testCase.id);
      setTestCase(updated);
    } catch (err) {
      console.error('[TestInspector] Failed to un-retire:', err);
    }
  }
}

function manageInputStyle(c: any, borderColor: string, width: string): React.CSSProperties {
  return {
    padding: '5px 8px', border: `1px solid ${borderColor}`, borderRadius: '6px',
    backgroundColor: 'transparent', color: c.text, fontSize: '12px', width,
  };
}

function manageButtonStyle(c: any, borderColor: string): React.CSSProperties {
  return {
    padding: '5px 12px', border: `1px solid ${borderColor}`, borderRadius: '6px',
    cursor: 'pointer', fontSize: '12px', fontWeight: 500,
    backgroundColor: 'transparent', color: c.text,
  };
}

function Section({ label, mutedText, children }: {
  label: string; mutedText: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <span style={{
        display: 'block', fontSize: '12px', fontWeight: 600,
        color: mutedText, textTransform: 'uppercase',
        letterSpacing: '0.5px', marginBottom: '8px',
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function badgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: '11px', fontWeight: 600,
    color, backgroundColor: color + '14',
    padding: '3px 10px', borderRadius: '4px',
    border: `1px solid ${color}30`,
  };
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000,
};

function panelStyle(c: any, theme: any): React.CSSProperties {
  return {
    width: '540px', maxWidth: '90vw', maxHeight: '85vh',
    backgroundColor: c.surface, borderRadius: '12px',
    boxShadow: theme.mode === 'dark' ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.15)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };
}

export const TestInspector = memo(TestInspectorComponent);
