import { memo, useState, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { X, Save, Trash2, Lock, LockOpen as Unlock, CircleCheck as CheckCircle2, Circle, Plus } from 'lucide-react';
import { useSpecification, useTestCase, useServices } from '../../context/ServiceContext.js';
import type { Requirement } from '../../services/SpecificationService.js';
import type { TestCase } from '../../../persistence/supabase/test-case-repository.js';
import type { Node as GraphNode } from '@nodespec/core/types.js';

interface RequirementInspectorProps {
  requirementId: string;
  projectId?: string;
  onClose: () => void;
  onDelete?: (requirementId: string) => void;
  onUpdate?: () => void;
}

function RequirementInspectorComponent({
  requirementId,
  projectId,
  onClose,
  onDelete,
  onUpdate
}: RequirementInspectorProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const specificationService = useSpecification();
  const testCaseService = useTestCase();
  const services = useServices();

  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'functional' | 'non-functional' | 'technical' | 'business'>('functional');
  const [locked, setLocked] = useState(false);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<Array<{ text: string; met?: boolean; testId?: string }>>([]);
  const [newCriterionText, setNewCriterionText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [_testCasesLoading, setTestCasesLoading] = useState(false);
  const [testRefresh] = useState(0);
  const [architectureTrace, setArchitectureTrace] = useState<string[]>([]);
  const [architectureNodes, setArchitectureNodes] = useState<GraphNode[]>([]);

  useEffect(() => {
    loadRequirement();
  }, [requirementId]);

  useEffect(() => {
    let cancelled = false;
    setTestCasesLoading(true);
    (async () => {
      try {
        const cases = await testCaseService.getTestCasesByRequirementIds([requirementId]);
        if (cancelled) return;
        if (!cancelled) setTestCases(cases);
      } catch {
        if (!cancelled) setTestCases([]);
      } finally {
        if (!cancelled) setTestCasesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requirementId, testCaseService, testRefresh]);

  useEffect(() => {
    if (requirement) {
      const criteriaChanged = JSON.stringify(acceptanceCriteria) !== JSON.stringify(requirement.acceptanceCriteria);
      const traceChanged = JSON.stringify(architectureTrace.sort()) !== JSON.stringify((requirement.architectureTrace || []).sort());
      const changed =
        name !== requirement.name ||
        description !== (requirement.description || '') ||
        category !== (requirement.category || '') ||
        locked !== (requirement.locked ?? false) ||
        criteriaChanged ||
        traceChanged;
      setHasChanges(changed);
    }
  }, [name, description, category, locked, acceptanceCriteria, architectureTrace, requirement]);

  const loadRequirement = async () => {
    try {
      const req = await specificationService.getRequirement(requirementId);
      setRequirement(req);
      setName(req.name);
      setDescription(req.description || '');
      setCategory(req.category);
      setLocked(req.locked ?? false);
      setAcceptanceCriteria(req.acceptanceCriteria || []);
      setArchitectureTrace(req.architectureTrace || []);
    } catch (err) {
      console.error('Failed to load requirement:', err);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const branchesResult = await services.persistence.getBranchRepository().listByProject(projectId);
        if (cancelled) return;
        if (branchesResult.success) {
          const mainBranch = branchesResult.data.find((b: any) => b.name === 'main');
          if (mainBranch) {
            const snapshotResult = await services.persistence.getGraphRepository().loadSnapshot(mainBranch.id);
            if (cancelled) return;
            if (snapshotResult.success && snapshotResult.data?.graphData?.nodes) {
              const nodesList = Object.entries(snapshotResult.data.graphData.nodes).map(([id, node]: [string, any]) => ({
                id, label: node.label || id, type: node.type, ...node,
              })) as GraphNode[];
              setArchitectureNodes(nodesList);
            }
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [projectId, services]);

  const handleSave = async () => {
    if (!requirement) return;

    try {
      setIsSaving(true);
      await specificationService.updateRequirement(requirement.id, {
        name,
        description: description || undefined,
        category: category || undefined,
        locked,
        acceptanceCriteria,
        architectureTrace: architectureTrace.length > 0 ? architectureTrace : [],
      });

      // P0-13: the Architecture Trace checkboxes are the user-facing connection control,
      // but requirement↔node connections have TWO stores: this trace (a JSON list on the
      // requirement) and specification_mappings rows (which drive the canvas edges — via
      // union — AND task-doc scoping per P0-2). Nothing in the UI deleted mapping rows,
      // so unchecking a node removed the trace entry while the mapping kept the edge
      // alive forever (found live on the bench 2026-07-14). Reconcile mappings to match
      // the checked set: delete unchecked, create newly checked.
      try {
        const existingMappings = await specificationService.getMappingsByRequirement(requirement.id);
        const checked = new Set(architectureTrace);
        const toDelete = existingMappings.filter(m => m.nodeId && !checked.has(m.nodeId));
        const alreadyMapped = new Set(existingMappings.map(m => m.nodeId));
        const toCreate = architectureTrace.filter(nodeId => !alreadyMapped.has(nodeId));

        await Promise.all(toDelete.map(m => services.mapping.deleteMapping(m.id)));
        if (toCreate.length > 0) {
          await services.mapping.bulkCreateMappings(toCreate.map(nodeId => ({
            specificationId: requirement.specificationId,
            requirementId: requirement.id,
            nodeId,
            mappingType: 'implements',
            confidence: 1.0,
          })));
        }
      } catch (mappingErr) {
        console.error('Failed to reconcile mappings with architecture trace:', mappingErr);
      }

      setRequirement({
        ...requirement,
        name,
        description,
        category,
        locked,
        acceptanceCriteria,
        architectureTrace,
      });
      setHasChanges(false);
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Failed to save requirement:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCriterion = () => {
    if (!newCriterionText.trim()) return;
    setAcceptanceCriteria(prev => [...prev, { text: newCriterionText.trim() }]);
    setNewCriterionText('');
  };

  const handleToggleCriterion = (index: number) => {
    setAcceptanceCriteria(prev =>
      prev.map((ac, i) => i === index ? { ...ac, met: !ac.met } : ac)
    );
  };

  const handleRemoveCriterion = (index: number) => {
    setAcceptanceCriteria(prev => prev.filter((_, i) => i !== index));
  };


  const handleDelete = async () => {
    if (!requirement || !confirm('Are you sure you want to delete this requirement?')) return;

    try {
      setIsDeleting(true);
      await specificationService.deleteRequirement(requirement.id);
      if (onDelete) onDelete(requirement.id);
      onClose();
    } catch (err) {
      console.error('Failed to delete requirement:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const criteriaCount = acceptanceCriteria.length;
  const criteriaMet = acceptanceCriteria.filter(ac => ac.met).length;
  const progressPct = criteriaCount > 0 ? (criteriaMet / criteriaCount) * 100 : 0;
  const allMet = criteriaCount > 0 && criteriaMet === criteriaCount;

  const borderColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const inputBorder = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';

  if (!requirement) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '540px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          backgroundColor: c.surface,
          borderRadius: '12px',
          boxShadow: theme.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.6)'
            : '0 8px 32px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: `1px solid ${borderColor}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: c.text }}>
              Requirement Inspector
            </span>
            {requirement.requirementId && (
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'monospace',
                color: c.primary,
                backgroundColor: c.primary + '18',
                padding: '2px 8px',
                borderRadius: '4px',
              }}>
                {requirement.requirementId}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '6px',
              border: 'none',
              background: 'transparent',
              color: c.textMuted,
              cursor: 'pointer',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter requirement name..."
              style={{
                padding: '10px 12px',
                border: `1px solid ${inputBorder}`,
                borderRadius: '6px',
                backgroundColor: c.background,
                color: c.text,
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the requirement in detail..."
              style={{
                padding: '10px 12px',
                border: `1px solid ${inputBorder}`,
                borderRadius: '6px',
                backgroundColor: c.background,
                color: c.text,
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
                minHeight: '80px',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                style={{
                  padding: '10px 12px',
                  border: `1px solid ${inputBorder}`,
                  borderRadius: '6px',
                  backgroundColor: c.background,
                  color: c.text,
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              >
                <option value="functional">Functional</option>
                <option value="non-functional">Non-Functional</option>
                <option value="technical">Technical</option>
                <option value="business">Business</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>Protection</label>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  border: `1px solid ${locked ? '#d97706' : inputBorder}`,
                  borderRadius: '6px',
                  backgroundColor: locked ? (theme.mode === 'dark' ? 'rgba(217, 119, 6, 0.15)' : 'rgba(217, 119, 6, 0.08)') : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => setLocked(!locked)}
              >
                {locked
                  ? <Lock size={16} style={{ color: '#d97706', flexShrink: 0 }} />
                  : <Unlock size={16} style={{ color: c.textMuted, flexShrink: 0 }} />
                }
                <span style={{ fontSize: '13px', fontWeight: 600, color: locked ? '#d97706' : c.text }}>
                  {locked ? 'Locked' : 'Unlocked'}
                </span>
              </button>
            </div>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '16px',
            borderRadius: '10px',
            border: `1px solid ${allMet ? '#22c55e30' : borderColor}`,
            backgroundColor: allMet
              ? (theme.mode === 'dark' ? 'rgba(34,197,94,0.05)' : 'rgba(34,197,94,0.03)')
              : (theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)'),
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                  Acceptance Criteria
                </label>
                {criteriaCount > 0 && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: allMet ? '#22c55e' : c.textMuted,
                    backgroundColor: allMet ? '#22c55e18' : (theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                    padding: '2px 8px',
                    borderRadius: '10px',
                  }}>
                    {criteriaMet}/{criteriaCount} met
                  </span>
                )}
              </div>
            </div>

            {criteriaCount > 0 && (
              <div style={{
                height: '4px',
                borderRadius: '2px',
                backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  backgroundColor: allMet ? '#22c55e' : '#3b82f6',
                  borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}


            {criteriaCount === 0 && (
              <div style={{
                padding: '12px 0 4px',
                fontSize: '12px',
                color: c.textMuted,
                fontStyle: 'italic',
                textAlign: 'center',
              }}>
                No acceptance criteria yet. Add criteria below to track what "done" looks like.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {acceptanceCriteria.map((criterion, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 12px',
                    backgroundColor: criterion.met
                      ? (theme.mode === 'dark' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.06)')
                      : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'),
                    borderRadius: '8px',
                    border: `1px solid ${criterion.met ? '#22c55e30' : (theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')}`,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <button
                    onClick={() => handleToggleCriterion(index)}
                    title={criterion.met ? 'Mark as not met' : 'Mark as met'}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: '2px',
                      color: criterion.met ? '#22c55e' : c.textMuted,
                      flexShrink: 0,
                      marginTop: '1px',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    {criterion.met ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </button>
                  <span style={{
                    flex: 1,
                    fontSize: '13px',
                    color: c.text,
                    lineHeight: '1.5',
                    textDecoration: criterion.met ? 'line-through' : 'none',
                    opacity: criterion.met ? 0.7 : 1,
                    transition: 'all 0.2s ease',
                  }}>
                    {criterion.text}
                  </span>
                  <button
                    onClick={() => handleRemoveCriterion(index)}
                    style={{
                      padding: '4px',
                      border: 'none',
                      background: 'transparent',
                      color: c.textMuted,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: '4px',
                      opacity: 0.4,
                      transition: 'all 0.2s ease',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>


            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={newCriterionText}
                onChange={(e) => setNewCriterionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCriterion();
                  }
                }}
                placeholder="Add acceptance criterion..."
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: `1px solid ${inputBorder}`,
                  borderRadius: '6px',
                  backgroundColor: c.background,
                  color: c.text,
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleAddCriterion}
                disabled={!newCriterionText.trim()}
                style={{
                  padding: '10px 16px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: newCriterionText.trim() ? '#22c55e' : c.border,
                  color: '#ffffff',
                  cursor: newCriterionText.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: newCriterionText.trim() ? 1 : 0.5,
                  transition: 'all 0.2s ease',
                }}
              >
                <Plus size={16} />
                Add
              </button>
            </div>
          </div>

          {projectId && architectureNodes.length > 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                Architecture Trace
                {architectureTrace.length > 0 && (
                  <span style={{ color: c.textMuted, fontWeight: 400, marginLeft: '8px' }}>
                    ({architectureTrace.length} node{architectureTrace.length > 1 ? 's' : ''} selected)
                  </span>
                )}
              </label>
              <div style={{
                maxHeight: '180px', overflowY: 'auto',
                border: `1px solid ${inputBorder}`, borderRadius: '6px', padding: '6px',
              }}>
                {architectureNodes.map((node) => (
                  <div
                    key={node.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', borderRadius: '5px',
                      backgroundColor: architectureTrace.includes(node.id)
                        ? (theme.mode === 'dark' ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.06)')
                        : (theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.01)'),
                      marginBottom: '2px', cursor: 'pointer',
                      transition: 'background-color 0.15s',
                    }}
                    onClick={() => {
                      setArchitectureTrace(prev =>
                        prev.includes(node.id)
                          ? prev.filter(id => id !== node.id)
                          : [...prev, node.id]
                      );
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={architectureTrace.includes(node.id)}
                      onChange={() => {}}
                      style={{ cursor: 'pointer', accentColor: '#22c55e' }}
                    />
                    <span style={{ fontSize: '12px', color: c.text }}>
                      {node.label || node.id}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(testCases.length > 0 || criteriaCount > 0) && (
            <div style={{
              padding: '14px 16px',
              backgroundColor: theme.mode === 'dark' ? 'rgba(6,182,212,0.06)' : 'rgba(6,182,212,0.03)',
              border: `1px solid ${theme.mode === 'dark' ? 'rgba(6,182,212,0.2)' : 'rgba(6,182,212,0.12)'}`,
              borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                  Test Cases
                </span>
                {testCases.length > 0 && (
                  <span style={{
                    fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
                    color: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.12)',
                    padding: '2px 8px', borderRadius: '4px',
                  }}>
                    {testCases.filter(t => t.status === 'passed').length}/{testCases.length} passed
                  </span>
                )}
                {testCases.length === 0 && (
                  <span style={{ fontSize: '12px', color: c.textMuted }}>None reported yet</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderTop: `1px solid ${borderColor}`,
          gap: '12px',
        }}>
          <button
            style={{
              padding: '10px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              backgroundColor: theme.mode === 'dark' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
            }}
            onClick={handleDelete}
            disabled={isDeleting}
            onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={(e) => { if (!isDeleting) e.currentTarget.style.opacity = '1'; }}
          >
            <Trash2 size={16} />
            <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
          </button>

          <button
            style={{
              padding: '10px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: hasChanges && !isSaving ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              backgroundColor: c.primary,
              color: '#ffffff',
              opacity: hasChanges && !isSaving ? 1 : 0.5,
            }}
            onClick={handleSave}
            disabled={!hasChanges || isSaving || !name.trim()}
          >
            <Save size={16} />
            <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export const RequirementInspector = memo(RequirementInspectorComponent);
