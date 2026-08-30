import { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { ChevronDown, ChevronRight, TestTube as TestTube2, Loader as Loader2, Circle, CircleCheck as CheckCircle2, CircleX, TriangleAlert as AlertTriangle, Network } from 'lucide-react';
import type { TestCase } from '../../../persistence/supabase/test-case-repository.js';

const TEST_TYPE_COLORS: Record<string, string> = {
  unit: '#3b82f6',
  integration: '#8b5cf6',
  e2e: '#f59e0b',
  acceptance: '#10b981',
  performance: '#ef4444',
  security: '#ec4899',
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  not_started: { color: '#6b7280', label: 'Not Started' },
  passed: { color: '#10b981', label: 'Passed' },
  failed: { color: '#ef4444', label: 'Failed' },
  skipped: { color: '#f59e0b', label: 'Skipped' },
  running: { color: '#3b82f6', label: 'Running' },
};

const ROLE_TEST_CONTEXT: Record<string, Record<string, string>> = {
  frontend_app: { unit: 'unit (component)', integration: 'integration (UI)', e2e: 'e2e (flow)' },
  web_frontend: { unit: 'unit (component)', integration: 'integration (UI)', e2e: 'e2e (flow)' },
  api_gateway: { unit: 'unit (handler)', integration: 'integration (API)', e2e: 'e2e (endpoint)' },
  backend_service: { unit: 'unit (handler)', integration: 'integration (service)', e2e: 'e2e (workflow)' },
  rest_api: { unit: 'unit (handler)', integration: 'integration (API)', e2e: 'e2e (endpoint)' },
  graphql_api: { unit: 'unit (resolver)', integration: 'integration (schema)', e2e: 'e2e (query)' },
  database: { unit: 'unit (query)', integration: 'integration (schema)', e2e: 'e2e (migration)' },
  relational_database: { unit: 'unit (query)', integration: 'integration (schema)', e2e: 'e2e (migration)' },
  document_database: { unit: 'unit (query)', integration: 'integration (collection)', e2e: 'e2e (migration)' },
  cache: { unit: 'unit (operation)', integration: 'integration (cache)', e2e: 'e2e (invalidation)' },
  message_queue: { unit: 'unit (handler)', integration: 'integration (messaging)', e2e: 'e2e (pipeline)' },
  event_bus: { unit: 'unit (handler)', integration: 'integration (event)', e2e: 'e2e (pipeline)' },
  serverless_function: { unit: 'unit (handler)', integration: 'integration (invocation)', e2e: 'e2e (trigger)' },
  auth_provider: { unit: 'unit (guard)', integration: 'integration (auth)', e2e: 'e2e (auth flow)' },
  inference_service: { unit: 'unit (prompt)', integration: 'integration (AI)', e2e: 'e2e (pipeline)' },
  object_storage: { unit: 'unit (operation)', integration: 'integration (storage)', e2e: 'e2e (upload)' },
  mobile_app: { unit: 'unit (screen)', integration: 'integration (navigation)', e2e: 'e2e (flow)' },
  shared_library: { unit: 'unit (function)', integration: 'integration (module)', e2e: 'e2e (dependency)' },
};

function formatStalenessReason(reason: string | undefined): string {
  if (!reason) return 'Source changed since this result was reported';
  const lower = reason.toLowerCase();
  if (lower.includes('requirement') || lower.includes('criteria')) {
    return 'Requirement criteria updated';
  }
  if (lower.includes('artifact') || lower.includes('source') || lower.includes('code')) {
    return 'Source code changed';
  }
  if (lower.includes('mapping') || lower.includes('architecture')) {
    return 'Architecture mapping modified';
  }
  return reason;
}

function getContextualTestType(testType: string, nodeRole: string | undefined): string {
  if (!nodeRole) return testType;
  const ctx = ROLE_TEST_CONTEXT[nodeRole];
  if (!ctx) return testType;
  return ctx[testType] || testType;
}

interface NodeGroup {
  nodeId: string;
  nodeLabel: string;
  nodeRole?: string;
  tests: TestCase[];
}

function groupTestsByNode(testCases: TestCase[], nodeRoles?: Map<string, string>): { grouped: NodeGroup[]; ungrouped: TestCase[] } {
  const nodeMap = new Map<string, { label: string; role?: string; tests: TestCase[] }>();
  const ungrouped: TestCase[] = [];

  for (const tc of testCases) {
    const nodeIds = tc.metadata?.archNodeIds as string[] | undefined;
    const nodeLabels = tc.metadata?.archNodeLabels as Record<string, string> | undefined;

    if (nodeIds && nodeIds.length > 0 && nodeLabels) {
      const primaryNodeId = nodeIds[0];
      const label = nodeLabels[primaryNodeId] || primaryNodeId;
      if (!nodeMap.has(primaryNodeId)) {
        nodeMap.set(primaryNodeId, { label, role: nodeRoles?.get(primaryNodeId), tests: [] });
      }
      nodeMap.get(primaryNodeId)!.tests.push(tc);
    } else {
      ungrouped.push(tc);
    }
  }

  const grouped: NodeGroup[] = [];
  for (const [nodeId, data] of nodeMap) {
    grouped.push({ nodeId, nodeLabel: data.label, nodeRole: data.role, tests: data.tests });
  }
  grouped.sort((a, b) => a.nodeLabel.localeCompare(b.nodeLabel));

  return { grouped, ungrouped };
}

export interface TestCaseListSectionHandle {
  expandAndScrollTo: (testId: string) => void;
  expand: () => void;
}

interface TestCaseListSectionProps {
  testCases: TestCase[];
  loading?: boolean;
  compact?: boolean;
  autoExpandOnChange?: boolean;
  requirementId?: string;
  onNodeClick?: (nodeId: string) => void;
  nodeRoles?: Map<string, string>;
}

export const TestCaseListSection = forwardRef<TestCaseListSectionHandle, TestCaseListSectionProps>(function TestCaseListSection({
  testCases,
  loading,
  compact = false,
  autoExpandOnChange,
  requirementId,
  onNodeClick,
  nodeRoles,
}, ref) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const testRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevTestCountRef = useRef(testCases.length);

  useImperativeHandle(ref, () => ({
    expandAndScrollTo(testId: string) {
      setExpanded(true);
      setExpandedTestId(testId);
      requestAnimationFrame(() => {
        const el = testRefs.current.get(testId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    },
    expand() {
      setExpanded(true);
    },
  }), []);

  useEffect(() => {
    if (autoExpandOnChange && testCases.length > 0 && testCases.length > prevTestCountRef.current) {
      setExpanded(true);
    }
    prevTestCountRef.current = testCases.length;
  }, [testCases.length, autoExpandOnChange]);

  const toggleTest = useCallback((testId: string) => {
    setExpandedTestId(prev => prev === testId ? null : testId);
  }, []);

  if (testCases.length === 0) {
    return null;
  }

  const passed = testCases.filter(tc => tc.status === 'passed').length;
  const failed = testCases.filter(tc => tc.status === 'failed').length;
  const total = testCases.length;

  const sectionPadding = compact ? '8px' : '12px';
  const fontSize = compact ? '10px' : '12px';
  const headerFontSize = compact ? '10px' : '11px';

  const shouldGroup = testCases.length >= 3 && testCases.some(tc => tc.metadata?.archNodeIds);
  const { grouped, ungrouped } = shouldGroup
    ? groupTestsByNode(testCases, nodeRoles)
    : { grouped: [], ungrouped: testCases };

  const renderTestCard = (tc: TestCase, nodeRole?: string) => {
    const isExpanded = expandedTestId === tc.id;
    const typeColor = TEST_TYPE_COLORS[tc.testType] || c.textMuted;
    const statusConf = STATUS_CONFIG[tc.status] || STATUS_CONFIG.not_started;
    const contextualType = getContextualTestType(tc.testType, nodeRole);
    const formattedStaleness = formatStalenessReason(tc.stalenessReason ?? undefined);

    return (
      <div
        key={tc.id}
        ref={(el) => {
          if (el) testRefs.current.set(tc.id, el);
          else testRefs.current.delete(tc.id);
        }}
        style={{
          marginBottom: '4px',
          borderRadius: compact ? '4px' : '6px',
          border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
          overflow: 'hidden',
          transition: 'all 0.15s ease',
        }}
      >
        <div
          onClick={() => toggleTest(tc.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: compact ? '5px 8px' : '8px 10px',
            cursor: 'pointer',
            backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
            userSelect: 'none',
          }}
        >
          <div style={{ color: statusConf.color, flexShrink: 0 }}>
            {tc.status === 'passed' ? <CheckCircle2 size={compact ? 12 : 14} /> :
             tc.status === 'failed' ? <CircleX size={compact ? 12 : 14} /> :
             <Circle size={compact ? 12 : 14} />}
          </div>

          <span style={{
            fontSize,
            fontWeight: 500,
            color: c.text,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {tc.name}
          </span>

          {tc.stale && (
            <span title={formattedStaleness} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              fontSize: compact ? '8px' : '9px',
              fontWeight: 700,
              color: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.12)',
              padding: '1px 5px',
              borderRadius: '3px',
              flexShrink: 0,
            }}>
              <AlertTriangle size={compact ? 8 : 9} />
              Stale
            </span>
          )}

          <span style={{
            fontSize: compact ? '8px' : '9px',
            fontWeight: 700,
            color: typeColor,
            backgroundColor: typeColor + '18',
            padding: '1px 5px',
            borderRadius: '3px',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            {contextualType}
          </span>

          {tc.framework && (
            <span style={{
              fontSize: compact ? '8px' : '9px',
              fontWeight: 600,
              color: c.textMuted,
              backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              padding: '1px 5px',
              borderRadius: '3px',
              flexShrink: 0,
            }}>
              {tc.framework}
            </span>
          )}

          <div style={{ color: c.textMuted, flexShrink: 0 }}>
            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </div>
        </div>

        {isExpanded && (
          <div style={{
            borderTop: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
            padding: compact ? '8px' : '10px',
          }}>
            {tc.description && (
              <div style={{
                fontSize: compact ? '10px' : '11px',
                color: c.textSecondary,
                marginBottom: '8px',
                lineHeight: '1.5',
              }}>
                {tc.description}
              </div>
            )}

            {/* Traceability breadcrumb */}
            {(() => {
              const archNodeLabels = tc.metadata?.archNodeLabels as Record<string, string> | undefined;
              const hasTrace = requirementId || (archNodeLabels && Object.keys(archNodeLabels).length > 0);
              if (!hasTrace) return null;
              const nodeEntries = archNodeLabels ? Object.entries(archNodeLabels) : [];
              return (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginBottom: '8px',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)',
                  border: `1px solid ${theme.mode === 'dark' ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)'}`,
                  flexWrap: 'wrap',
                  fontSize: compact ? '9px' : '10px',
                }}>
                  {requirementId && (
                    <span style={{ fontWeight: 600, color: c.primary, fontFamily: 'monospace' }}>
                      {requirementId}
                    </span>
                  )}
                  {requirementId && nodeEntries.length > 0 && (
                    <span style={{ color: c.textMuted }}>&#8594;</span>
                  )}
                  {nodeEntries.map(([nodeId, label], i) => (
                    <span key={nodeId} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      {i > 0 && <span style={{ color: c.textMuted }}>,</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); onNodeClick?.(nodeId); }}
                        style={{
                          border: 'none',
                          backgroundColor: 'transparent',
                          cursor: onNodeClick ? 'pointer' : 'default',
                          padding: '0 2px',
                          color: theme.mode === 'dark' ? '#93c5fd' : '#2563eb',
                          fontWeight: 500,
                          fontSize: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        <Network size={compact ? 8 : 9} />
                        {label}
                      </button>
                    </span>
                  ))}
                  {(requirementId || nodeEntries.length > 0) && (
                    <span style={{ color: c.textMuted }}>&#8594;</span>
                  )}
                  <span style={{ fontWeight: 600, color: '#06b6d4', fontFamily: 'monospace' }}>
                    {tc.testId}
                  </span>
                </div>
              );
            })()}

            {tc.expectedResult && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{
                  fontSize: compact ? '9px' : '10px',
                  fontWeight: 600,
                  color: c.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  marginBottom: '3px',
                }}>
                  Expected Result
                </div>
                <div style={{
                  fontSize: compact ? '10px' : '11px',
                  color: c.text,
                  lineHeight: '1.4',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.04)',
                  border: `1px solid ${theme.mode === 'dark' ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)'}`,
                }}>
                  {tc.expectedResult}
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
              paddingTop: '6px',
              borderTop: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}`,
            }}>
              <span style={{
                fontSize: compact ? '8px' : '9px',
                fontWeight: 700,
                color: statusConf.color,
                backgroundColor: statusConf.color + '15',
                padding: '2px 6px',
                borderRadius: '3px',
                textTransform: 'uppercase',
              }}>
                {statusConf.label}
              </span>
              <span style={{
                fontSize: compact ? '8px' : '9px',
                color: c.textMuted,
              }}>
                ID: {tc.testId}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      borderRadius: compact ? '6px' : '8px',
      border: `1px solid ${total > 0
        ? (failed > 0 ? '#ef444430' : passed === total ? '#10b98130' : c.border)
        : c.border
      }`,
      backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: `${sectionPadding} ${compact ? '10px' : '12px'}`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ color: c.textMuted, flexShrink: 0 }}>
          {expanded ? <ChevronDown size={compact ? 12 : 14} /> : <ChevronRight size={compact ? 12 : 14} />}
        </div>

        <TestTube2 size={compact ? 12 : 14} style={{
          color: total > 0
            ? (failed > 0 ? '#ef4444' : passed === total ? '#10b981' : c.textMuted)
            : c.textMuted,
          flexShrink: 0,
        }} />

        <span style={{
          fontSize: headerFontSize,
          fontWeight: 600,
          color: c.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          flex: 1,
        }}>
          Test Cases
        </span>

        {total > 0 && (
          <span style={{
            fontSize: compact ? '9px' : '10px',
            fontWeight: 700,
            color: failed > 0 ? '#ef4444' : passed === total ? '#10b981' : c.textMuted,
            backgroundColor: (failed > 0 ? '#ef4444' : passed === total ? '#10b981' : c.textMuted) + '15',
            padding: '2px 6px',
            borderRadius: '8px',
          }}>
            {passed}/{total}
          </span>
        )}

      </div>

      {expanded && (
        <div style={{
          borderTop: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
          padding: compact ? '6px' : '8px',
        }}>
          {loading && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '12px',
              fontSize: '11px',
              color: c.textMuted,
            }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              Loading test cases...
            </div>
          )}

          {!loading && testCases.length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: compact ? '10px 8px' : '16px 12px',
              fontSize: compact ? '10px' : '11px',
              color: c.textMuted,
              fontStyle: 'italic',
            }}>
              No test cases reported yet.
            </div>
          )}

          {shouldGroup ? (
            <>
              {grouped.map(group => (
                <div key={group.nodeId} style={{ marginBottom: '8px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      marginBottom: '4px',
                      borderRadius: '4px',
                      backgroundColor: theme.mode === 'dark' ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)',
                      border: `1px solid ${theme.mode === 'dark' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.06)'}`,
                    }}
                  >
                    <Network size={compact ? 9 : 10} style={{ color: theme.mode === 'dark' ? '#93c5fd' : '#2563eb', flexShrink: 0 }} />
                    <button
                      onClick={() => onNodeClick?.(group.nodeId)}
                      style={{
                        border: 'none',
                        backgroundColor: 'transparent',
                        cursor: onNodeClick ? 'pointer' : 'default',
                        padding: 0,
                        fontSize: compact ? '9px' : '10px',
                        fontWeight: 600,
                        color: theme.mode === 'dark' ? '#93c5fd' : '#2563eb',
                      }}
                    >
                      {group.nodeLabel}
                    </button>
                    <span style={{
                      fontSize: compact ? '8px' : '9px',
                      color: c.textMuted,
                      marginLeft: 'auto',
                    }}>
                      {group.tests.length} test{group.tests.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {group.tests.map(tc => renderTestCard(tc, group.nodeRole))}
                </div>
              ))}
              {ungrouped.length > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  {grouped.length > 0 && (
                    <div style={{
                      padding: '4px 8px',
                      marginBottom: '4px',
                      fontSize: compact ? '9px' : '10px',
                      fontWeight: 600,
                      color: c.textMuted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3px',
                    }}>
                      General
                    </div>
                  )}
                  {ungrouped.map(tc => renderTestCard(tc))}
                </div>
              )}
            </>
          ) : (
            testCases.map(tc => renderTestCard(tc))
          )}
        </div>
      )}
    </div>
  );
});
