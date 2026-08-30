import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Graph, PatchOperation, ArtifactKind } from '@nodespec/core/types';
import type { GraphValidationResult, GraphValidationIssue, QuickFixAction } from '@nodespec/core/validation/types';
import { validationEngine } from '@nodespec/core/validation/engine';
import { useTheme } from '../../theme/ThemeContext';
import { createPatchMetadata, createAddArtifactPatch, createAddPortPatch, createUpdateArtifactPatch } from '@nodespec/core/patch-factory';
import { buildUpdateNodePatch } from '../../builders/patchBuilders';
import { generateUUID, computeContentHash, now } from '@nodespec/core/utils';
import { computeConfigFingerprint } from '@nodespec/core/configuration-fingerprint';

interface ValidationPanelProps {
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
  onNodeSelect?: (nodeId: string) => void;
  onEdgeSelect?: (edgeId: string) => void;
  onRegenerateTask?: (nodeId: string) => void;
  onRegenerateCode?: (nodeId: string) => void;
}

export function ValidationPanel({
  graph,
  onPatchGenerated,
  onNodeSelect,
  onEdgeSelect,
  onRegenerateTask,
  onRegenerateCode,
}: ValidationPanelProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [validationResult, setValidationResult] = useState<GraphValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  const runValidation = useCallback(async () => {
    setIsValidating(true);
    try {
      const result = await validationEngine.validateGraph(graph);
      setValidationResult(result);
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setIsValidating(false);
    }
  }, [graph]);

  useEffect(() => {
    runValidation();
  }, [runValidation]);

  const toggleIssue = useCallback((issueId: string) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const handleQuickFix = useCallback(
    (action: QuickFixAction) => {
      switch (action.type) {
        case 'create_artifact': {
          const artifactId = generateUUID();
          const content = action.templateContent || '';
          const kind = action.artifactKind as ArtifactKind;

          const extension = kind === 'schema' ? '.yaml' : kind === 'source' ? '.ts' : '.md';
          const path = `${kind}/${Date.now()}${extension}`;

          const artifact = {
            id: artifactId,
            nodeId: action.nodeId,
            kind,
            path,
            content,
            contentHash: computeContentHash(content),
            createdAt: now(),
            updatedAt: now(),
            metadata: {},
            status: 'draft' as const,
          };

          const addPatch = createAddArtifactPatch(artifact, {
            actorType: 'human',
            summary: `Create ${kind} artifact`,
          });

          const node = graph.nodes[action.nodeId];
          const updatePatch = buildUpdateNodePatch({
            nodeId: action.nodeId,
            updates: {
              artifacts: [...(node?.artifacts || []), artifactId],
            },
            actor: 'human',
            summary: `Link ${kind} artifact to node`,
          });

          onPatchGenerated(addPatch);
          onPatchGenerated(updatePatch);
          break;
        }

        case 'link_schema': {
          const patch: PatchOperation = {
            type: 'update_contract',
            metadata: createPatchMetadata({
              actorType: 'human',
              summary: 'Link schema to contract',
            }),
            payload: {
              id: action.contractId,
              changes: {
                schemaRef: action.artifactId,
              },
            },
          };
          onPatchGenerated(patch);
          break;
        }

        case 'add_port': {
          const directionLabel = action.direction === 'in' ? 'Input' : 'Output';
          const newPort = {
            id: generateUUID(),
            name: `${action.contractKind.toUpperCase()} ${directionLabel}`,
            direction: action.direction,
            required: false,
          };

          const patch = createAddPortPatch(
            action.nodeId,
            newPort,
            {
              actorType: 'human',
              summary: `Add ${action.direction}put port for ${action.contractKind}`,
            }
          );

          onPatchGenerated(patch);
          break;
        }

        case 'update_contract': {
          const patch: PatchOperation = {
            type: 'update_contract',
            metadata: createPatchMetadata({
              actorType: 'human',
              summary: 'Update contract',
            }),
            payload: {
              id: action.edgeId,
              changes: action.updates,
            },
          };
          onPatchGenerated(patch);
          break;
        }

        case 'run_ai_validation': {
          console.log('AI validation requested for node:', action.nodeId);
          break;
        }

        case 'reconcile_ports': {
          for (const sp of action.suggestedPorts) {
            const newPort = {
              id: generateUUID(),
              name: sp.name,
              direction: sp.direction,
              required: sp.required ?? false,
            };

            const patch = createAddPortPatch(
              action.nodeId,
              newPort,
              {
                actorType: 'human',
                summary: `Add missing ${sp.direction}put port "${sp.name}"`,
              }
            );

            onPatchGenerated(patch);
          }
          break;
        }

        case 'mark_artifacts_stale': {
          const node = graph.nodes[action.nodeId];
          if (!node) break;

          const nodeArtifactIds = node.artifacts ?? [];
          const fingerprint = computeConfigFingerprint(node.type, node.metadata ?? {});

          for (const aid of nodeArtifactIds) {
            const artifact = graph.artifacts[aid];
            if (artifact && artifact.status !== 'suggested') {
              const patch = createUpdateArtifactPatch(
                aid,
                {
                  metadata: {
                    ...(artifact.metadata as Record<string, unknown> ?? {}),
                    stale: true,
                    staleReason: action.reason,
                    lastConfigFingerprint: fingerprint,
                  },
                },
                {
                  actorType: 'human',
                  summary: `Mark artifact as stale: ${action.reason}`,
                }
              );
              onPatchGenerated(patch);
            }
          }
          break;
        }

        case 'regenerate_task': {
          if (onRegenerateTask) {
            onRegenerateTask(action.nodeId);
          }
          break;
        }

        case 'regenerate_code': {
          if (onRegenerateCode) {
            onRegenerateCode(action.nodeId);
          }
          break;
        }
      }

      setTimeout(() => runValidation(), 100);
    },
    [graph, onPatchGenerated, runValidation, onRegenerateTask, onRegenerateCode]
  );

  const issuesBySeverity = useMemo(() => {
    if (!validationResult) return { error: [], warning: [], info: [] };

    return {
      error: validationResult.issues.filter((i) => i.severity === 'error'),
      warning: validationResult.issues.filter((i) => i.severity === 'warning'),
      info: validationResult.issues.filter((i) => i.severity === 'info'),
    };
  }, [validationResult]);

  const panelStyles: React.CSSProperties = {
    position: 'fixed',
    left: '20px',
    bottom: '20px',
    width: '420px',
    maxHeight: '400px',
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '12px',
    boxShadow:
      theme.mode === 'dark'
        ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3)'
        : '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)',
    color: c.textSecondary,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 200,
  };

  const headerStyles: React.CSSProperties = {
    padding: '16px 20px',
    borderBottom: `1px solid ${c.border}`,
    fontSize: '14px',
    fontWeight: 600,
    color: c.text,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: c.backgroundSecondary,
    borderRadius: '12px 12px 0 0',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '4px 8px',
    backgroundColor: c.primary,
    border: 'none',
    borderRadius: '4px',
    color: 'white',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 500,
  };

  if (!validationResult) {
    return null;
  }

  const totalIssues = validationResult.issues.length;

  if (totalIssues === 0) {
    return (
      <div style={panelStyles}>
        <div style={headerStyles}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            ✅ Validation
          </span>
          <button style={buttonStyles} onClick={runValidation}>
            Refresh
          </button>
        </div>
        <div
          style={{
            padding: '20px',
            textAlign: 'center',
            color: c.success,
            fontSize: '14px',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>✓</div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>All Good!</div>
          <div style={{ fontSize: '12px', color: c.textMuted }}>
            No validation issues found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyles}>
      <div style={headerStyles}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ Validation Issues ({totalIssues})
        </span>
        <button
          style={buttonStyles}
          onClick={runValidation}
          disabled={isValidating}
        >
          {isValidating ? 'Validating...' : 'Refresh'}
        </button>
      </div>

      <div style={{
        padding: '10px 12px',
        backgroundColor: c.backgroundSecondary,
        borderBottom: `1px solid ${c.border}`,
        fontSize: '10px',
        color: c.textSecondary,
        lineHeight: '1.5',
      }}>
        <div style={{ fontWeight: 500, color: c.text, marginBottom: '3px' }}>
          🔍 What is Validation?
        </div>
        Validation checks ensure your components work together correctly. Issues indicate missing schemas, disconnected connection points, or architectural mismatches. Use quick-fix actions to resolve them.
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {issuesBySeverity.error.length > 0 && (
          <IssueSection
            title="Errors"
            icon="❌"
            color={c.error}
            bgColor={c.errorBg}
            issues={issuesBySeverity.error}
            expandedIssues={expandedIssues}
            onToggleIssue={toggleIssue}
            onQuickFix={handleQuickFix}
            onNodeSelect={onNodeSelect}
            onEdgeSelect={onEdgeSelect}
            theme={theme}
          />
        )}

        {issuesBySeverity.warning.length > 0 && (
          <IssueSection
            title="Warnings"
            icon="⚠️"
            color={c.warning}
            bgColor={c.warningBg}
            issues={issuesBySeverity.warning}
            expandedIssues={expandedIssues}
            onToggleIssue={toggleIssue}
            onQuickFix={handleQuickFix}
            onNodeSelect={onNodeSelect}
            onEdgeSelect={onEdgeSelect}
            theme={theme}
          />
        )}

        {issuesBySeverity.info.length > 0 && (
          <IssueSection
            title="Info"
            icon="ℹ️"
            color={c.primary}
            bgColor={c.backgroundTertiary}
            issues={issuesBySeverity.info}
            expandedIssues={expandedIssues}
            onToggleIssue={toggleIssue}
            onQuickFix={handleQuickFix}
            onNodeSelect={onNodeSelect}
            onEdgeSelect={onEdgeSelect}
            theme={theme}
          />
        )}
      </div>
    </div>
  );
}

interface IssueSectionProps {
  title: string;
  icon: string;
  color: string;
  bgColor: string;
  issues: GraphValidationIssue[];
  expandedIssues: Set<string>;
  onToggleIssue: (id: string) => void;
  onQuickFix: (action: QuickFixAction) => void;
  onNodeSelect?: (nodeId: string) => void;
  onEdgeSelect?: (edgeId: string) => void;
  theme: any;
}

function IssueSection({
  title,
  icon,
  color,
  bgColor,
  issues,
  expandedIssues,
  onToggleIssue,
  onQuickFix,
  onNodeSelect,
  onEdgeSelect,
  theme,
}: IssueSectionProps) {
  const c = theme.colors;

  return (
    <div style={{ borderBottom: `1px solid ${c.border}` }}>
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: bgColor,
          fontSize: '12px',
          fontWeight: 600,
          color,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>{icon}</span>
        <span>
          {title} ({issues.length})
        </span>
      </div>

      {issues.map((issue) => {
        const isExpanded = expandedIssues.has(issue.id);

        return (
          <div
            key={issue.id}
            style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${c.border}`,
              backgroundColor: c.background,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                cursor: 'pointer',
              }}
              onClick={() => onToggleIssue(issue.id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', color: c.text, fontWeight: 500 }}>
                  {issue.message}
                </div>
                {issue.nodeId && onNodeSelect && (
                  <div
                    style={{
                      fontSize: '10px',
                      color: c.primary,
                      marginTop: '4px',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNodeSelect(issue.nodeId!);
                    }}
                  >
                    View Node
                  </div>
                )}
                {issue.edgeId && onEdgeSelect && (
                  <div
                    style={{
                      fontSize: '10px',
                      color: c.primary,
                      marginTop: '4px',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdgeSelect(issue.edgeId!);
                    }}
                  >
                    View Edge
                  </div>
                )}
              </div>
              <span style={{ fontSize: '10px', color: c.textMuted }}>
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '8px' }}>
                {issue.description && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: c.textSecondary,
                      marginBottom: '8px',
                      lineHeight: '1.4',
                    }}
                  >
                    {issue.description}
                  </div>
                )}

                {issue.quickFixes.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div
                      style={{
                        fontSize: '10px',
                        color: c.textMuted,
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      Quick Fixes:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {issue.quickFixes.map((fix) => (
                        <button
                          key={fix.id}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: c.primary,
                            border: 'none',
                            borderRadius: '4px',
                            color: 'white',
                            fontSize: '11px',
                            cursor: 'pointer',
                            fontWeight: 500,
                            textAlign: 'left',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickFix(fix.action);
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = c.primaryHover || c.primary;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = c.primary;
                          }}
                        >
                          {fix.label}
                          {fix.description && (
                            <div style={{ fontSize: '10px', opacity: 0.9, marginTop: '2px' }}>
                              {fix.description}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
