import { useState, useCallback, useRef, memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { ChevronDown, ChevronRight, CircleCheck as CheckCircle2, Circle, Lock, LockOpen as Unlock, Trash2, Plus, X, ArrowUp, ArrowDown, Network, TestTube as TestTube2, Link2, GitBranch } from 'lucide-react';
import type { Requirement } from '../../../persistence/supabase/requirements-repository.js';
import type { UpdateRequirementInput } from '../../services/SpecificationService.js';
import type { RequirementMapping } from '../../services/MappingService.js';
import type { TestCase } from '../../../persistence/supabase/test-case-repository.js';
import { InlineEditableText } from './InlineEditableText.js';
import { TestCaseListSection } from './TestCaseListSection.js';
import type { TestCaseListSectionHandle } from './TestCaseListSection.js';

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface MappingDisplay {
  nodeId: string;
  nodeLabel: string;
  mappingType: RequirementMapping['mappingType'];
  /** R5d: the per-node completion DECLARATION — shown beside criteria state, never instead of it. */
  validationStatus?: RequirementMapping['validationStatus'];
  validationProvenance?: RequirementMapping['validationProvenance'];
}

/** R6: a DERIVED architectural-coupling entry — computed at read time from
 *  mappings + the graph (spec-v3/coupling.ts), never stored. */
export interface CouplingDisplay {
  targetRowId: string;
  targetRequirementId: string;
  kind: 'shared_node' | 'adjacent';
  /** The shared node's label, or the bridging edge as "Source → Target". */
  via: string;
}

/** R6: AUTHORED expansion lineage — this requirement expands the target. */
export interface LineageDisplay {
  targetRowId: string;
  targetRequirementId: string;
}

/** R6: a coupling-derived hint; accepting it is the ONLY path from a
 *  suggestion to a stored relation row (source 'user'). */
export interface SuggestionDisplay {
  targetRowId: string;
  targetRequirementId: string;
  via: string;
}

interface SpecRequirementCardProps {
  requirement: Requirement;
  onUpdate: (id: string, input: UpdateRequirementInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  mappingCount?: number;
  mappings?: MappingDisplay[];
  testSummary?: TestSummary;
  testCases?: TestCase[];
  testCasesLoading?: boolean;
  onNodeClick?: (nodeId: string) => void;
  nodeRoles?: Map<string, string>;
  coupling?: CouplingDisplay[];
  lineage?: LineageDisplay[];
  suggestions?: SuggestionDisplay[];
  onJumpToRequirement?: (rowId: string) => void;
  onAcceptSuggestion?: (targetRowId: string) => void | Promise<void>;
  /** Briefly true after a jump lands on this card — renders the focus ring. */
  focusRequested?: boolean;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  functional: { label: 'FR', color: '#3b82f6' },
  'non-functional': { label: 'NFR', color: '#8b5cf6' },
  technical: { label: 'TR', color: '#f59e0b' },
  business: { label: 'BR', color: '#10b981' },
};

const MAPPING_TYPE_ABBR: Record<string, string> = {
  implements: 'impl',
  depends_on: 'dep',
  validates: 'val',
  supports: 'sup',
};

function SpecRequirementCardComponent({
  requirement,
  onUpdate,
  onDelete,
  mappingCount = 0,
  mappings = [],
  testSummary,
  testCases = [],
  testCasesLoading,
  onNodeClick,
  nodeRoles,
  coupling = [],
  lineage = [],
  suggestions = [],
  onJumpToRequirement,
  onAcceptSuggestion,
  focusRequested = false,
}: SpecRequirementCardProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const [newCriterion, setNewCriterion] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hoveredCriterionIdx, setHoveredCriterionIdx] = useState<number | null>(null);

  const testSectionRef = useRef<TestCaseListSectionHandle>(null);

  const cat = CATEGORY_CONFIG[requirement.category] || CATEGORY_CONFIG.functional;

  const criteriaCount = requirement.acceptanceCriteria?.length || 0;
  const criteriaMet = requirement.acceptanceCriteria?.filter(ac => ac.met).length || 0;

  const handleToggleLock = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onUpdate(requirement.id, { locked: !requirement.locked });
  }, [requirement.id, requirement.locked, onUpdate]);

  const handleSaveName = useCallback(async (name: string) => {
    await onUpdate(requirement.id, { name });
  }, [requirement.id, onUpdate]);

  const handleSaveDescription = useCallback(async (description: string) => {
    await onUpdate(requirement.id, { description });
  }, [requirement.id, onUpdate]);

  const handleAddCriterion = useCallback(async () => {
    if (!newCriterion.trim()) return;
    const updated = [...(requirement.acceptanceCriteria || []), { text: newCriterion.trim() }];
    await onUpdate(requirement.id, { acceptanceCriteria: updated });
    setNewCriterion('');
  }, [requirement.id, requirement.acceptanceCriteria, newCriterion, onUpdate]);

  const handleToggleCriterion = useCallback(async (index: number) => {
    const updated = requirement.acceptanceCriteria.map((ac, i) => {
      if (i !== index) return ac;
      // R5e: a human touching this criterion IS the re-verification — an explicit
      // met change clears any "evidence stale" mark, and the fresh decision is
      // UI-provenanced so the audit trail says who re-verified (R3-4b two-half
      // convention: the flag says what, the provenance says where it came from).
      const { evidenceStale: _cleared, ...rest } = ac as Record<string, unknown> & typeof ac;
      return {
        ...rest,
        met: !ac.met,
        provenance: { source: 'ui', at: new Date().toISOString() },
      };
    });
    await onUpdate(requirement.id, { acceptanceCriteria: updated });
  }, [requirement.id, requirement.acceptanceCriteria, onUpdate]);

  const handleRemoveCriterion = useCallback(async (index: number) => {
    const updated = requirement.acceptanceCriteria.filter((_, i) => i !== index);
    await onUpdate(requirement.id, { acceptanceCriteria: updated });
  }, [requirement.id, requirement.acceptanceCriteria, onUpdate]);

  const handleSaveCriterionText = useCallback(async (index: number, text: string) => {
    const updated = requirement.acceptanceCriteria.map((ac, i) =>
      i === index ? { ...ac, text } : ac
    );
    await onUpdate(requirement.id, { acceptanceCriteria: updated });
  }, [requirement.id, requirement.acceptanceCriteria, onUpdate]);

  const handleSwapCriteria = useCallback(async (indexA: number, indexB: number) => {
    const criteria = [...requirement.acceptanceCriteria];
    if (indexB < 0 || indexB >= criteria.length) return;
    [criteria[indexA], criteria[indexB]] = [criteria[indexB], criteria[indexA]];
    await onUpdate(requirement.id, { acceptanceCriteria: criteria });
  }, [requirement.id, requirement.acceptanceCriteria, onUpdate]);


  const handleCriterionTestClick = useCallback((testId: string) => {
    if (testSectionRef.current) {
      testSectionRef.current.expandAndScrollTo(testId);
    }
  }, []);

  const handleCategoryChange = useCallback(async (category: Requirement['category']) => {
    await onUpdate(requirement.id, { category });
  }, [requirement.id, onUpdate]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await onDelete(requirement.id);
  }, [requirement.id, confirmDelete, onDelete]);

  return (
    <div
      style={{
        borderRadius: '8px',
        border: `1px solid ${focusRequested ? c.primary : expanded ? c.primary + '40' : c.border}`,
        backgroundColor: expanded
          ? (theme.mode === 'dark' ? 'rgba(139,143,230,0.04)' : 'rgba(139,143,230,0.02)')
          : (theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : '#fff'),
        transition: 'all 0.2s ease',
        overflow: 'hidden',
        boxShadow: focusRequested
          ? `0 0 0 2px ${c.primary}50`
          : hovered && !expanded
            ? (theme.mode === 'dark' ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)')
            : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ color: c.textMuted, flexShrink: 0 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>

        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          fontFamily: 'monospace',
          color: c.primary,
          backgroundColor: c.primary + '18',
          padding: '2px 6px',
          borderRadius: '4px',
          flexShrink: 0,
        }}>
          {requirement.requirementId}
        </span>

        <span style={{
          fontSize: '12px',
          fontWeight: 500,
          color: c.text,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {requirement.name}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* R6: AUTHORED expansion lineage — click jumps to the expanded requirement. */}
          {lineage.map((l) => (
            <button
              key={l.targetRowId}
              onClick={(e) => { e.stopPropagation(); onJumpToRequirement?.(l.targetRowId); }}
              title={`This requirement expands ${l.targetRequirementId} — click to jump to it`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '9px',
                fontWeight: 600,
                color: theme.mode === 'dark' ? '#c4b5fd' : '#7c3aed',
                backgroundColor: theme.mode === 'dark' ? 'rgba(139,92,246,0.14)' : 'rgba(139,92,246,0.08)',
                border: 'none',
                padding: '2px 6px',
                borderRadius: '8px',
                cursor: onJumpToRequirement ? 'pointer' : 'default',
              }}
            >
              <GitBranch size={9} />
              expands {l.targetRequirementId}
            </button>
          ))}

          <span style={{
            fontSize: '9px',
            fontWeight: 700,
            color: cat.color,
            backgroundColor: cat.color + '18',
            padding: '2px 5px',
            borderRadius: '3px',
            textTransform: 'uppercase',
          }}>
            {cat.label}
          </span>

          {criteriaCount > 0 && (
            <span style={{
              fontSize: '10px',
              fontWeight: 600,
              color: criteriaMet === criteriaCount ? c.success : c.textMuted,
            }}>
              {criteriaMet}/{criteriaCount}
            </span>
          )}

          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              fontSize: '10px',
              fontWeight: 600,
              color: mappingCount > 0 ? c.primary : c.textMuted,
              opacity: mappingCount > 0 ? 1 : 0.4,
            }}
            title={`${mappingCount} architecture node${mappingCount !== 1 ? 's' : ''} mapped`}
          >
            <Network size={11} />
            {mappingCount > 0 && mappingCount}
          </span>

          {/* R6: DERIVED coupling — requirements sharing/adjacent to this one's
              nodes. Informational (computed, never stored) — details in the
              expanded "Coupled requirements" list. */}
          {coupling.length > 0 && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '10px',
                fontWeight: 600,
                color: theme.mode === 'dark' ? '#67e8f9' : '#0891b2',
              }}
              title={`Coupled to ${coupling.length} requirement${coupling.length !== 1 ? 's' : ''}:\n${coupling.map((cp) => `${cp.targetRequirementId} — ${cp.kind === 'shared_node' ? 'shares' : 'adjacent via'} ${cp.via}`).join('\n')}`}
            >
              <Link2 size={11} />
              {coupling.length}
            </span>
          )}

          {testSummary && testSummary.total > 0 ? (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '10px',
                fontWeight: 600,
                color: testSummary.failed > 0 ? '#ef4444'
                  : testSummary.passed === testSummary.total ? '#10b981'
                  : c.textMuted,
              }}
              title={`${testSummary.total} test${testSummary.total !== 1 ? 's' : ''}: ${testSummary.passed} passed, ${testSummary.failed} failed`}
            >
              <TestTube2 size={11} />
              {testSummary.passed}/{testSummary.total}
            </span>
          ) : criteriaCount > 0 && (!testSummary || testSummary.total === 0) ? (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '10px',
                fontWeight: 500,
                color: '#d97706',
              }}
              title="No test coverage yet"
            >
              <TestTube2 size={11} />
            </span>
          ) : null}

          <button
            onClick={handleToggleLock}
            title={requirement.locked ? 'Locked (click to unlock)' : 'Unlocked (click to lock)'}
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              color: requirement.locked ? '#d97706' : c.textMuted,
              borderRadius: '4px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {requirement.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: '0 12px 12px',
          borderTop: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
          paddingTop: '12px',
        }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '4px',
            }}>Name</label>
            <InlineEditableText
              value={requirement.name}
              onSave={handleSaveName}
              fontSize={13}
              fontWeight={600}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '4px',
            }}>Description</label>
            <InlineEditableText
              value={requirement.description}
              onSave={handleSaveDescription}
              placeholder="Add a description..."
              multiline
              fontSize={12}
              maxRows={4}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '10px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '4px',
            }}>Category</label>
            <select
              value={requirement.category}
              onChange={(e) => handleCategoryChange(e.target.value as Requirement['category'])}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                border: `1px solid ${c.border}`,
                borderRadius: '6px',
                backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
                color: c.text,
                cursor: 'pointer',
              }}
            >
              <option value="functional">Functional</option>
              <option value="non-functional">Non-Functional</option>
              <option value="technical">Technical</option>
              <option value="business">Business</option>
            </select>
          </div>

          {mappings.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '10px',
                fontWeight: 600,
                color: c.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
              }}>Architecture Trace</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {mappings.map((m) => {
                  const nodeTests = testCases.filter(tc => {
                    const nodeIds = tc.metadata?.archNodeIds as string[] | undefined;
                    return nodeIds?.includes(m.nodeId);
                  });
                  const hasTests = nodeTests.length > 0;
                  const allPassing = hasTests && nodeTests.every(tc => tc.status === 'passed');
                  const hasFailing = hasTests && nodeTests.some(tc => tc.status === 'failed' || tc.stale);
                  const coverageColor = hasFailing ? '#ef4444' : allPassing ? '#10b981' : hasTests ? '#6b7280' : '#d97706';

                  return (
                    <button
                      key={m.nodeId + m.mappingType}
                      onClick={(e) => { e.stopPropagation(); onNodeClick?.(m.nodeId); }}
                      style={{
                        fontSize: '10px',
                        fontWeight: 500,
                        color: theme.mode === 'dark' ? '#93c5fd' : '#2563eb',
                        backgroundColor: theme.mode === 'dark' ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)',
                        padding: '3px 8px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        border: `1px solid ${coverageColor}30`,
                        cursor: onNodeClick ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Network size={9} />
                      {m.nodeLabel}
                      {/* R5d: the implementer declared this node's side complete.
                          A DECLARATION, not proof — criteria state stays the
                          authority on what is actually proven, right below. */}
                      {m.validationStatus === 'valid' && (
                        <span
                          title={`Implementation declared complete${m.validationProvenance?.actor ? ` by ${m.validationProvenance.actor}` : ''}${m.validationProvenance?.at ? ` on ${new Date(m.validationProvenance.at).toLocaleString()}` : ''}${m.validationProvenance?.note ? ` — ${m.validationProvenance.note}` : ''}. This never implies the acceptance criteria are met — see the criteria list for what is proven.`}
                          style={{
                            fontSize: '8px', fontWeight: 700,
                            color: '#059669', backgroundColor: 'rgba(5,150,105,0.12)',
                            padding: '1px 4px', borderRadius: '6px',
                          }}
                        >
                          DONE
                        </span>
                      )}
                      <span style={{
                        fontSize: '8px',
                        fontWeight: 700,
                        opacity: 0.6,
                        textTransform: 'uppercase',
                      }}>
                        {MAPPING_TYPE_ABBR[m.mappingType] || m.mappingType}
                      </span>
                      <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: coverageColor,
                        flexShrink: 0,
                      }} title={hasFailing ? 'Has failing/stale tests' : allPassing ? 'All tests passing' : hasTests ? 'Tests not started' : 'No test coverage'} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(coupling.length > 0 || suggestions.length > 0) && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '10px',
                fontWeight: 600,
                color: c.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
              }}>Coupled Requirements</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {coupling.map((cp) => (
                  <button
                    key={cp.targetRowId + cp.kind}
                    onClick={(e) => { e.stopPropagation(); onJumpToRequirement?.(cp.targetRowId); }}
                    title={cp.kind === 'shared_node'
                      ? `${cp.targetRequirementId} maps the same node: ${cp.via}`
                      : `${cp.targetRequirementId} sits across the edge ${cp.via}`}
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: theme.mode === 'dark' ? '#67e8f9' : '#0891b2',
                      backgroundColor: theme.mode === 'dark' ? 'rgba(8,145,178,0.12)' : 'rgba(8,145,178,0.07)',
                      padding: '3px 8px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      border: `1px solid ${theme.mode === 'dark' ? 'rgba(8,145,178,0.3)' : 'rgba(8,145,178,0.2)'}`,
                      cursor: onJumpToRequirement ? 'pointer' : 'default',
                    }}
                  >
                    <Link2 size={9} />
                    {cp.targetRequirementId}
                    <span style={{ fontSize: '9px', opacity: 0.7 }}>
                      {cp.kind === 'shared_node' ? `shares ${cp.via}` : `via ${cp.via}`}
                    </span>
                  </button>
                ))}
                {/* R6: coupling-derived HINT — accepting it is the only path from a
                    suggestion to a stored relation row (source 'user'). */}
                {suggestions.map((s) => (
                  <button
                    key={'suggest-' + s.targetRowId}
                    onClick={(e) => { e.stopPropagation(); onAcceptSuggestion?.(s.targetRowId); }}
                    title={`Shares ${s.via} with completed ${s.targetRequirementId}. Click to record "expands ${s.targetRequirementId}" — nothing is stored until you accept.`}
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: theme.mode === 'dark' ? '#c4b5fd' : '#7c3aed',
                      backgroundColor: 'transparent',
                      padding: '3px 8px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      border: `1px dashed ${theme.mode === 'dark' ? 'rgba(139,92,246,0.5)' : 'rgba(124,58,237,0.4)'}`,
                      cursor: onAcceptSuggestion ? 'pointer' : 'default',
                    }}
                  >
                    <GitBranch size={9} />
                    possibly expands {s.targetRequirementId} — same nodes
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
            }}>
              <label style={{
                fontSize: '10px',
                fontWeight: 600,
                color: c.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>Acceptance Criteria</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              </div>
            </div>

            {(!requirement.acceptanceCriteria || requirement.acceptanceCriteria.length === 0) && (
              <div style={{
                padding: '8px 12px',
                fontSize: '11px',
                color: c.textMuted,
                fontStyle: 'italic',
              }}>
                No acceptance criteria yet
              </div>
            )}

            {requirement.acceptanceCriteria?.map((ac, idx) => {
              const isHovered = hoveredCriterionIdx === idx;

              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    padding: '6px 8px',
                    marginBottom: '4px',
                    borderRadius: '6px',
                    backgroundColor: ac.met
                      ? (theme.mode === 'dark' ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.06)')
                      : (theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
                    border: `1px solid ${ac.met ? c.success + '30' : 'transparent'}`,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={() => setHoveredCriterionIdx(idx)}
                  onMouseLeave={() => setHoveredCriterionIdx(null)}
                >
                  <button
                    onClick={() => handleToggleCriterion(idx)}
                    style={{
                      border: 'none',
                      backgroundColor: 'transparent',
                      cursor: 'pointer',
                      padding: '1px',
                      color: ac.met ? c.success : c.textMuted,
                      flexShrink: 0,
                      marginTop: '1px',
                    }}
                  >
                    {ac.met ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                  </button>

                  <div style={{
                    flex: 1,
                    minWidth: 0,
                    // R5e: a stale-evidence criterion is still met but needs eyes —
                    // do not strike it through like a settled one.
                    textDecoration: ac.met && !ac.evidenceStale ? 'line-through' : 'none',
                    opacity: ac.met && !ac.evidenceStale ? 0.7 : 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <InlineEditableText
                          value={ac.text}
                          onSave={(text) => handleSaveCriterionText(idx, text)}
                          fontSize={12}
                        />
                      </div>
                      {ac.verification === 'manual' && (
                        <span
                          title="Verified by hand — the test lane skips this criterion"
                          style={{
                            flexShrink: 0, padding: '1px 6px', borderRadius: '8px',
                            fontSize: '10px', fontWeight: 600,
                            color: c.textMuted,
                            backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                            border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
                          }}
                        >
                          (manual)
                        </span>
                      )}
                      {ac.met && ac.evidenceStale && (
                        <span
                          title={`The source this criterion's evidence vouched for changed on ${new Date(ac.evidenceStale.at).toLocaleString()}${ac.evidenceStale.commitSha ? ` (${ac.evidenceStale.commitSha.slice(0, 7)})` : ''}. Toggle the criterion to re-verify — that clears this flag.`}
                          style={{
                            flexShrink: 0, padding: '1px 6px', borderRadius: '8px',
                            fontSize: '10px', fontWeight: 600,
                            color: '#b45309', backgroundColor: 'rgba(217, 119, 6, 0.12)',
                            border: '1px solid rgba(217, 119, 6, 0.3)',
                          }}
                        >
                          evidence stale — re-verify
                        </span>
                      )}
                      {ac.testId && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCriterionTestClick(ac.testId!);
                          }}
                          title="Jump to linked test case"
                          style={{
                            border: 'none',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                            padding: '1px 2px',
                            display: 'flex',
                            alignItems: 'center',
                            flexShrink: 0,
                            borderRadius: '3px',
                            color: '#10b981',
                            opacity: 0.6,
                            transition: 'opacity 0.15s ease',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                        >
                          <TestTube2 size={10} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                    flexShrink: 0,
                    opacity: isHovered ? 1 : 0,
                    transition: 'opacity 0.15s ease',
                  }}>
                    <button
                      onClick={() => handleSwapCriteria(idx, idx - 1)}
                      disabled={idx === 0}
                      title="Move up"
                      style={{
                        border: 'none',
                        backgroundColor: 'transparent',
                        cursor: idx === 0 ? 'default' : 'pointer',
                        padding: '1px',
                        color: c.textMuted,
                        opacity: idx === 0 ? 0.2 : 0.6,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <ArrowUp size={10} />
                    </button>
                    <button
                      onClick={() => handleSwapCriteria(idx, idx + 1)}
                      disabled={idx === criteriaCount - 1}
                      title="Move down"
                      style={{
                        border: 'none',
                        backgroundColor: 'transparent',
                        cursor: idx === criteriaCount - 1 ? 'default' : 'pointer',
                        padding: '1px',
                        color: c.textMuted,
                        opacity: idx === criteriaCount - 1 ? 0.2 : 0.6,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <ArrowDown size={10} />
                    </button>
                  </div>

                  <button
                    onClick={() => handleRemoveCriterion(idx)}
                    style={{
                      border: 'none',
                      backgroundColor: 'transparent',
                      cursor: 'pointer',
                      padding: '1px',
                      color: c.textMuted,
                      opacity: isHovered ? 0.5 : 0,
                      flexShrink: 0,
                      transition: 'opacity 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = isHovered ? '0.5' : '0'; }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <input
                type="text"
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCriterion(); } }}
                placeholder="Add criterion..."
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: '11px',
                  border: `1px solid ${c.border}`,
                  borderRadius: '6px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : '#fff',
                  color: c.text,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleAddCriterion}
                disabled={!newCriterion.trim()}
                style={{
                  padding: '4px 8px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: newCriterion.trim() ? c.success : c.border,
                  color: '#fff',
                  cursor: newCriterion.trim() ? 'pointer' : 'default',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  opacity: newCriterion.trim() ? 1 : 0.4,
                  transition: 'opacity 0.15s ease',
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          {testCases.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <TestCaseListSection
                ref={testSectionRef}
                testCases={testCases}
                loading={testCasesLoading}
                compact
                autoExpandOnChange
                requirementId={requirement.requirementId}
                onNodeClick={onNodeClick}
                nodeRoles={nodeRoles}
              />
            </div>
          )}

          {testCases.length === 0 && criteriaCount > 0 && (
            <p style={{
              margin: '0 0 12px 0',
              fontSize: '11px',
              lineHeight: '1.5',
              color: c.textMuted,
              fontStyle: 'italic',
              opacity: 0.75,
            }}>
              No test results yet — your AI drafts the plan via get_test_plan and reports outcomes via report_test_results.
            </p>
          )}

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            paddingTop: '8px',
            borderTop: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
          }}>
            <button
              onClick={handleDelete}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '6px',
                backgroundColor: confirmDelete ? c.error : 'transparent',
                color: confirmDelete ? '#fff' : c.textMuted,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!confirmDelete) e.currentTarget.style.color = c.error;
              }}
              onMouseLeave={(e) => {
                if (!confirmDelete) e.currentTarget.style.color = c.textMuted;
              }}
            >
              <Trash2 size={12} />
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const SpecRequirementCard = memo(SpecRequirementCardComponent);
