import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { FileText, CircleAlert as AlertCircle, ListChecks, Plus, X, ChevronDown, ChevronRight, RefreshCw, WifiOff, ToggleLeft, ToggleRight } from 'lucide-react';
import { useRealtimeSpecification } from '../../hooks/useRealtimeSpecification.js';
import { useRealtimeMappings } from '../../hooks/useRealtimeMappings.js';
import { useSpecification, useTestCase } from '../../context/ServiceContext.js';
import { SpecVisionEditor } from './SpecVisionEditor.js';
import { SpecRequirementCard } from './SpecRequirementCard.js';
import type { MappingDisplay, TestSummary, CouplingDisplay, LineageDisplay, SuggestionDisplay } from './SpecRequirementCard.js';
import { computeCouplingByRequirement, computeExpandSuggestions } from './coupling.js';
import type { CouplingGraphSlice } from './coupling.js';
import { SpecFilterBar, EMPTY_SPEC_FILTERS } from './SpecFilterBar.js';
import type { SpecFilters, ArchNodeOption } from './SpecFilterBar.js';
import { isRequirementCompleted } from './coupling.js';
import { shouldDefaultCollapse, computeSectionMetSummary, formatSectionSummary, isRecentlyAdded, computeExpansionOfCompletedIds, UNSECTIONED_KEY } from './scale.js';
import type { UpdateRequirementInput } from '../../services/SpecificationService.js';
import type { TestCase } from '../../../persistence/supabase/test-case-repository.js';
import type { Graph } from '@nodespec/core/types.js';

interface SpecificationPanelV3Props {
  specificationId: string | null;
  graph?: Graph;
  onNodeClick?: (nodeId: string) => void;
}

export function SpecificationPanelV3({ specificationId, graph, onNodeClick }: SpecificationPanelV3Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const specificationService = useSpecification();
  const testCaseService = useTestCase();
  const specData = useRealtimeSpecification(specificationId);
  const mappingsData = useRealtimeMappings(specificationId);

  const [filters, setFilters] = useState<SpecFilters>({ ...EMPTY_SPEC_FILTERS });
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [draggedRequirementId, setDraggedRequirementId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddSection, setQuickAddSection] = useState('');

  const [showSectionAdd, setShowSectionAdd] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  const [testCasesByReqId, setTestCasesByReqId] = useState<Map<string, TestCase[]>>(new Map());
  const [testSummaryByReqId, setTestSummaryByReqId] = useState<Map<string, TestSummary>>(new Map());
  const [testCasesLoading, setTestCasesLoading] = useState(false);
  const [testRefresh] = useState(0);
  const [specToggling, setSpecToggling] = useState(false);
  const [focusedReqId, setFocusedReqId] = useState<string | null>(null);

  const specEnabled = specData.specification?.preferences?.specEnabled !== false;

  const handleToggleSpec = useCallback(async () => {
    if (!specificationId || !specData.specification || specToggling) return;
    const currentPrefs = specData.specification.preferences || {};
    const newEnabled = !specEnabled;
    setSpecToggling(true);
    try {
      await specificationService.updateSpecification(specificationId, {
        preferences: { ...currentPrefs, specEnabled: newEnabled },
      });
      await specificationService.setPhaseStatus(
        specificationId,
        newEnabled ? 'drafting_requirements' : 'architecture_first',
      );
      await specData.refresh();
    } catch (err) {
      console.error('[SpecificationPanelV3] Failed to toggle spec:', err);
    } finally {
      setSpecToggling(false);
    }
  }, [specificationId, specData, specEnabled, specToggling, specificationService]);




  useEffect(() => {
    const reqs = specData.requirements;
    if (reqs.length === 0) {
      setTestCasesByReqId(new Map());
      setTestSummaryByReqId(new Map());
      return;
    }
    let cancelled = false;
    setTestCasesLoading(true);
    (async () => {
      try {
        const allTests = await testCaseService.getTestCasesByRequirementIds(reqs.map(r => r.id));
        if (cancelled) return;
        const caseMap = new Map<string, TestCase[]>();
        const summaryMap = new Map<string, TestSummary>();
        for (const tc of allTests) {
          const existing = caseMap.get(tc.requirementId) || [];
          existing.push(tc);
          caseMap.set(tc.requirementId, existing);

          const s = summaryMap.get(tc.requirementId) || { total: 0, passed: 0, failed: 0 };
          s.total += 1;
          if (tc.status === 'passed') s.passed += 1;
          if (tc.status === 'failed') s.failed += 1;
          summaryMap.set(tc.requirementId, s);
        }
        if (!cancelled) {
          setTestCasesByReqId(caseMap);
          setTestSummaryByReqId(summaryMap);
        }
      } catch {
        if (!cancelled) {
          setTestCasesByReqId(new Map());
          setTestSummaryByReqId(new Map());
        }
      } finally {
        if (!cancelled) setTestCasesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [specData.requirements, testCaseService, testRefresh]);




  const nodeLabels = useMemo(() => {
    if (!graph) return new Map<string, string>();
    const labels = new Map<string, string>();
    for (const node of Object.values(graph.nodes)) {
      labels.set(node.id, node.label || node.id);
    }
    return labels;
  }, [graph]);

  const nodeRoles = useMemo(() => {
    if (!graph) return new Map<string, string>();
    const roles = new Map<string, string>();
    for (const node of Object.values(graph.nodes)) {
      if (node.type) roles.set(node.id, node.type);
    }
    return roles;
  }, [graph]);

  const getMappingsForRequirement = useCallback((requirementId: string): MappingDisplay[] => {
    const reqMappings = mappingsData.mappingsByRequirement.get(requirementId) || [];
    return reqMappings.map(m => ({
      nodeId: m.nodeId,
      nodeLabel: nodeLabels.get(m.nodeId) || m.nodeId,
      mappingType: m.mappingType,
      validationStatus: m.validationStatus,
      validationProvenance: m.validationProvenance ?? null,
    }));
  }, [mappingsData.mappingsByRequirement, nodeLabels]);

  // ── R6: derived coupling + authored lineage + expand suggestions ─────────────
  // Coupling is computed here at read time and never stored; lineage comes from
  // the authored relations table; a suggestion becomes a row ONLY via the
  // user's accept click below.
  const reqById = useMemo(() => new Map(specData.requirements.map(r => [r.id, r])), [specData.requirements]);

  const couplingByReq = useMemo(() => computeCouplingByRequirement(
    mappingsData.mappingsByNode,
    mappingsData.mappingsByRequirement,
    graph as CouplingGraphSlice | undefined,
  ), [mappingsData.mappingsByNode, mappingsData.mappingsByRequirement, graph]);

  const couplingDisplayByReq = useMemo(() => {
    const out = new Map<string, CouplingDisplay[]>();
    for (const [rowId, entries] of couplingByReq) {
      const display: CouplingDisplay[] = [];
      for (const e of entries) {
        const target = reqById.get(e.requirementRowId);
        if (!target) continue;
        display.push({ targetRowId: target.id, targetRequirementId: target.requirementId, kind: e.kind, via: e.via });
      }
      if (display.length > 0) out.set(rowId, display);
    }
    return out;
  }, [couplingByReq, reqById]);

  const lineageByReq = useMemo(() => {
    const out = new Map<string, LineageDisplay[]>();
    for (const rel of specData.relations) {
      if (rel.relationType !== 'expands') continue;
      const target = reqById.get(rel.toRequirementId);
      if (!target) continue;
      const list = out.get(rel.fromRequirementId) ?? [];
      list.push({ targetRowId: target.id, targetRequirementId: target.requirementId });
      out.set(rel.fromRequirementId, list);
    }
    return out;
  }, [specData.relations, reqById]);

  const suggestionsByReq = useMemo(() => {
    const raw = computeExpandSuggestions(specData.requirements, couplingByReq, specData.relations);
    const out = new Map<string, SuggestionDisplay[]>();
    for (const [rowId, entries] of raw) {
      out.set(rowId, entries.map(s => ({ targetRowId: s.targetRowId, targetRequirementId: s.targetRequirementId, via: s.via })));
    }
    return out;
  }, [specData.requirements, couplingByReq, specData.relations]);

  // R6 scale surface: the "expansions of completed work" filter membership.
  const expansionOfCompletedIds = useMemo(() => computeExpansionOfCompletedIds(
    specData.relations,
    (rowId) => {
      const req = reqById.get(rowId);
      return !!req && isRequirementCompleted(req);
    },
  ), [specData.relations, reqById]);

  const jumpToRequirement = useCallback((rowId: string) => {
    const req = reqById.get(rowId);
    if (!req) return;
    const sectionKey = req.sectionId || UNSECTIONED_KEY;
    setCollapsedSections(prev => {
      if (!prev.has(sectionKey)) return prev;
      const next = new Set(prev);
      next.delete(sectionKey);
      return next;
    });
    setFocusedReqId(rowId);
    // Let the un-collapse render before scrolling to the anchor.
    setTimeout(() => {
      document.getElementById(`spec-req-${rowId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    setTimeout(() => setFocusedReqId(current => (current === rowId ? null : current)), 2000);
  }, [reqById]);

  const handleAcceptSuggestion = useCallback(async (fromRowId: string, targetRowId: string) => {
    if (!specificationId) return;
    // The ONLY suggestion→row path: an explicit user click, recorded as source 'user'.
    await specificationService.createRequirementRelation({
      specificationId,
      fromRequirementId: fromRowId,
      toRequirementId: targetRowId,
      relationType: 'expands',
      source: 'user',
    });
    await specData.refresh();
  }, [specificationId, specificationService, specData]);

  const archNodeOptions = useMemo((): ArchNodeOption[] => {
    const nodeIds = new Set<string>();
    for (const reqMappings of mappingsData.mappingsByRequirement.values()) {
      for (const m of reqMappings) {
        nodeIds.add(m.nodeId);
      }
    }
    return [...nodeIds].map(id => ({
      id,
      label: nodeLabels.get(id) || id,
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [mappingsData.mappingsByRequirement, nodeLabels]);

  const filteredRequirements = useMemo(() => {
    return specData.requirements.filter(req => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matches = req.name.toLowerCase().includes(q) ||
          req.description.toLowerCase().includes(q) ||
          req.requirementId.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filters.categories.length > 0 && !filters.categories.includes(req.category)) {
        return false;
      }
      if (filters.lockStates.length > 0) {
        const reqLockState = req.locked ? 'locked' : 'unlocked';
        if (!filters.lockStates.includes(reqLockState)) return false;
      }
      if (filters.testCoverage.length > 0) {
        const summary = testSummaryByReqId.get(req.id);
        const hasTests = summary && summary.total > 0;
        const allPassing = hasTests && summary.passed === summary.total;
        const hasFailing = hasTests && (summary.failed > 0);
        const testCases = testCasesByReqId.get(req.id) || [];
        const hasStale = testCases.some(tc => tc.stale);

        let matchesCoverage = false;
        for (const f of filters.testCoverage) {
          if (f === 'has_tests_passing' && allPassing && !hasStale) matchesCoverage = true;
          if (f === 'has_tests_failing' && (hasFailing || hasStale)) matchesCoverage = true;
          if (f === 'no_tests' && !hasTests) matchesCoverage = true;
        }
        if (!matchesCoverage) return false;
      }
      if (filters.archNodeId) {
        const reqMappings = mappingsData.mappingsByRequirement.get(req.id) || [];
        const hasNode = reqMappings.some(m => m.nodeId === filters.archNodeId);
        if (!hasNode) return false;
      }
      if (filters.recentlyAdded && !isRecentlyAdded(req, Date.now())) {
        return false;
      }
      if (filters.expansionsOfCompleted && !expansionOfCompletedIds.has(req.id)) {
        return false;
      }
      return true;
    });
  }, [specData.requirements, filters, testSummaryByReqId, testCasesByReqId, mappingsData.mappingsByRequirement, expansionOfCompletedIds]);

  const sortedSections = useMemo(() => {
    return [...specData.sections].sort((a, b) => a.orderIndex - b.orderIndex);
  }, [specData.sections]);

  const unsectionedReqs = useMemo(() => {
    return filteredRequirements.filter(r => !r.sectionId);
  }, [filteredRequirements]);

  // R6 scale surface: past the threshold the panel STARTS collapsed (collapsed
  // sections unmount their cards — the render valve). One-time and ref-guarded:
  // the user's expand/collapse choices are never overridden afterwards.
  const didDefaultCollapse = useRef(false);
  useEffect(() => {
    if (didDefaultCollapse.current || specData.loading) return;
    if (specData.requirements.length === 0) return;
    didDefaultCollapse.current = true;
    if (!shouldDefaultCollapse(specData.requirements.length)) return;
    if (specData.sections.length === 0) return; // no section headers to re-expand from
    setCollapsedSections(new Set([...specData.sections.map(s => s.id), UNSECTIONED_KEY]));
  }, [specData.loading, specData.requirements.length, specData.sections]);

  // Section header summaries over the FULL (unfiltered) membership — a
  // section-level metric, not a filter readout.
  const sectionSummaryByKey = useMemo(() => {
    const out = new Map<string, string>();
    for (const section of specData.sections) {
      out.set(section.id, formatSectionSummary(computeSectionMetSummary(
        specData.requirements.filter(r => r.sectionId === section.id))));
    }
    out.set(UNSECTIONED_KEY, formatSectionSummary(computeSectionMetSummary(
      specData.requirements.filter(r => !r.sectionId))));
    return out;
  }, [specData.sections, specData.requirements]);

  const handleSaveVision = useCallback(async (vision: string) => {
    if (!specificationId) return;
    await specificationService.updateSpecification(specificationId, { vision });
    await specData.refresh();
  }, [specificationId, specificationService, specData]);

  const handleUpdateRequirement = useCallback(async (id: string, input: UpdateRequirementInput) => {
    await specificationService.updateRequirement(id, input);
    await specData.refresh();
  }, [specificationService, specData]);

  const handleDeleteRequirement = useCallback(async (id: string) => {
    await specificationService.deleteRequirement(id);
    await specData.refresh();
  }, [specificationService, specData]);

  const handleQuickAdd = useCallback(async () => {
    if (!specificationId || !quickAddName.trim()) return;

    // Discovered #8: numbering now lives in the service (fresh-rows compute +
    // retry on the unique violation) — the stale in-memory max+1 raced.
    await specificationService.createRequirementAutoNumbered({
      specificationId,
      name: quickAddName.trim(),
      description: '',
      category: 'functional',
      acceptanceCriteria: [],
      sectionId: quickAddSection || undefined,
      source: 'manual',
    });

    setQuickAddName('');
    setShowQuickAdd(false);
    await specData.refresh();
  }, [specificationId, quickAddName, quickAddSection, specData, specificationService]);

  const handleCreateSection = useCallback(async () => {
    if (!specificationId || !newSectionName.trim()) return;
    const maxOrderIndex = specData.sections.reduce((max, s) => Math.max(max, s.orderIndex), -1);
    await specificationService.createSection({
      specificationId,
      name: newSectionName.trim(),
      orderIndex: maxOrderIndex + 1,
      aiGenerated: false,
    });
    setNewSectionName('');
    setShowSectionAdd(false);
    await specData.refresh();
  }, [specificationId, newSectionName, specData, specificationService]);


  const handleDropRequirement = useCallback(async (requirementId: string, targetSectionId: string | null) => {
    await specificationService.updateRequirement(requirementId, { sectionId: targetSectionId });
    await specData.refresh();
    setDraggedRequirementId(null);
    setDragOverSectionId(null);
  }, [specificationService, specData]);

  const handleDeleteSection = useCallback(async (sectionId: string) => {
    await specificationService.deleteSection(sectionId);
    await specData.refresh();
  }, [specificationService, specData]);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const renderRequirementCard = useCallback((req: typeof specData.requirements[0]) => {
    const reqMappings = getMappingsForRequirement(req.id);

    return (
      <div
        key={req.id}
        id={`spec-req-${req.id}`}
        draggable
        onDragStart={(e) => {
          setDraggedRequirementId(req.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', req.id);
        }}
        onDragEnd={() => {
          setDraggedRequirementId(null);
          setDragOverSectionId(null);
        }}
        style={{
          opacity: draggedRequirementId === req.id ? 0.4 : 1,
          cursor: 'grab',
          transition: 'opacity 0.15s ease',
        }}
      >
        <SpecRequirementCard
          requirement={req}
          onUpdate={handleUpdateRequirement}
          onDelete={handleDeleteRequirement}

          mappingCount={reqMappings.length}
          mappings={reqMappings}
          testSummary={testSummaryByReqId.get(req.id)}
          testCases={testCasesByReqId.get(req.id) || []}
          testCasesLoading={testCasesLoading}
          onNodeClick={onNodeClick}
          nodeRoles={nodeRoles}
          coupling={couplingDisplayByReq.get(req.id)}
          lineage={lineageByReq.get(req.id)}
          suggestions={suggestionsByReq.get(req.id)}
          onJumpToRequirement={jumpToRequirement}
          onAcceptSuggestion={(targetRowId) => handleAcceptSuggestion(req.id, targetRowId)}
          focusRequested={focusedReqId === req.id}
        />
      </div>
    );
  }, [getMappingsForRequirement, handleUpdateRequirement, handleDeleteRequirement, draggedRequirementId, testSummaryByReqId, testCasesByReqId, testCasesLoading, onNodeClick, nodeRoles, couplingDisplayByReq, lineageByReq, suggestionsByReq, jumpToRequirement, handleAcceptSuggestion, focusedReqId]);

  if (specData.loading && !specData.specification) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textMuted, fontSize: '13px' }}>
        Loading specification...
      </div>
    );
  }

  if (specData.error && !specData.specification) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: c.error, padding: '24px' }}>
        <AlertCircle size={40} />
        <div style={{ fontSize: '13px', fontWeight: 600 }}>Failed to load specification</div>
        <div style={{ fontSize: '11px', textAlign: 'center', color: c.textMuted }}>{specData.error.message}</div>
        <button
          onClick={() => specData.refresh()}
          style={{
            marginTop: '8px',
            padding: '6px 16px',
            fontSize: '12px',
            fontWeight: 600,
            border: 'none',
            borderRadius: '6px',
            backgroundColor: c.primary,
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  if (!specificationId || !specData.specification) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', color: c.textMuted, padding: '48px 24px' }}>
        <FileText size={40} opacity={0.3} />
        <div style={{ fontSize: '13px', fontWeight: 600 }}>No specification found</div>
      </div>
    );
  }

  const reqCount = specData.requirements.length;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: c.background,
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${c.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FileText size={18} style={{ color: specEnabled ? c.primary : c.textMuted }} />
          <span style={{ fontSize: '14px', fontWeight: 600, color: specEnabled ? c.text : c.textMuted }}>
            {specData.specification.name || 'Specification'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleToggleSpec}
            disabled={specToggling}
            title="Enable or disable the specification workflow. When disabled, you can work directly with your architecture without defining requirements first."
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: specToggling ? 'wait' : 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              color: specEnabled ? '#10b981' : c.textMuted,
              opacity: specToggling ? 0.5 : 1,
              transition: 'color 0.2s ease, opacity 0.2s ease',
            }}
          >
            {specEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
          </button>
          <div style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            backgroundColor: specData.connected ? '#10b981' : '#6b7280',
            transition: 'background-color 0.3s ease',
          }} title={specData.connected ? 'Connected' : 'Disconnected'} />
        </div>
      </div>

      {specData.realtimeError && !specData.connected && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          backgroundColor: theme.mode === 'dark' ? 'rgba(251,191,36,0.08)' : 'rgba(245,158,11,0.06)',
          borderBottom: `1px solid ${theme.mode === 'dark' ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.12)'}`,
          fontSize: '11px',
          color: c.warning,
        }}>
          <WifiOff size={12} />
          <span style={{ flex: 1 }}>Live sync disconnected. Data may be stale.</span>
          <button
            onClick={() => specData.refresh()}
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              color: c.warning,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(251,191,36,0.12)' : 'rgba(245,158,11,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <RefreshCw size={10} />
            Refresh
          </button>
        </div>
      )}

      {!specEnabled && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '48px 24px',
          color: c.textMuted,
          textAlign: 'center',
        }}>
          <ToggleLeft size={40} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: '13px', fontWeight: 600 }}>
            Specification is disabled
          </div>
          <div style={{ fontSize: '12px', lineHeight: '1.5', maxWidth: '280px' }}>
            Your architecture operates independently. Toggle back on to generate or manage requirements.
          </div>
        </div>
      )}

      {specEnabled && (
        <>
      <SpecVisionEditor
        vision={specData.specification.vision}
        onSaveVision={handleSaveVision}
      />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 16px',
        borderBottom: `1px solid ${c.border}`,
      }}>
        <ListChecks size={14} style={{ color: c.primary }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: c.text }}>
          Requirements
        </span>
        {reqCount > 0 && (
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            backgroundColor: theme.mode === 'dark' ? 'rgba(139,143,230,0.2)' : 'rgba(139,143,230,0.12)',
            color: c.primary,
            padding: '1px 6px',
            borderRadius: '8px',
          }}>
            {reqCount}
          </span>
        )}
      </div>

      {reqCount > 4 && (
        <SpecFilterBar
          filters={filters}
          onChange={setFilters}
          totalCount={reqCount}
          filteredCount={filteredRequirements.length}
          archNodeOptions={archNodeOptions}
        />
      )}



      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ padding: '12px' }}>
            {sortedSections.map((section) => {
              const sectionReqs = filteredRequirements.filter(r => r.sectionId === section.id);
              const isCollapsed = collapsedSections.has(section.id);
              const isDragOver = dragOverSectionId === section.id && draggedRequirementId !== null;

              return (
                <div
                  key={section.id}
                  style={{ marginBottom: '16px' }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverSectionId(section.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverSectionId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const reqId = e.dataTransfer.getData('text/plain');
                    if (reqId) handleDropRequirement(reqId, section.id);
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: isDragOver ? `2px dashed ${c.primary}` : '2px dashed transparent',
                    backgroundColor: isDragOver
                      ? (theme.mode === 'dark' ? 'rgba(139,143,230,0.08)' : 'rgba(139,143,230,0.04)')
                      : 'transparent',
                    transition: 'all 0.15s ease',
                  }}
                    onClick={() => toggleSection(section.id)}
                  >
                    <div style={{ color: c.textMuted }}>
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </div>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: c.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      flex: 1,
                    }}>
                      {section.name}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      color: c.textMuted,
                      fontWeight: 500,
                    }}>
                      {sectionSummaryByKey.get(section.id) || sectionReqs.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this section? Requirements will be unassigned, not deleted.')) {
                          handleDeleteSection(section.id);
                        }
                      }}
                      style={{
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: c.textMuted,
                        cursor: 'pointer',
                        padding: '2px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: 0.4,
                        transition: 'opacity 0.15s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {sectionReqs.length === 0 ? (
                        <div style={{
                          padding: '12px',
                          textAlign: 'center',
                          fontSize: '11px',
                          color: c.textMuted,
                          borderRadius: '8px',
                          border: `1px dashed ${c.border}`,
                        }}>
                          No requirements in this section
                        </div>
                      ) : (
                        sectionReqs.map(req => renderRequirementCard(req))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {(unsectionedReqs.length > 0 || (draggedRequirementId && sortedSections.length > 0)) && (
              <div
                style={{ marginBottom: '16px' }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverSectionId('__unsectioned__');
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverSectionId(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const reqId = e.dataTransfer.getData('text/plain');
                  if (reqId) handleDropRequirement(reqId, null);
                }}
              >
                {sortedSections.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: dragOverSectionId === '__unsectioned__' && draggedRequirementId
                        ? `2px dashed ${c.primary}`
                        : '2px dashed transparent',
                      backgroundColor: dragOverSectionId === '__unsectioned__' && draggedRequirementId
                        ? (theme.mode === 'dark' ? 'rgba(139,143,230,0.08)' : 'rgba(139,143,230,0.04)')
                        : 'transparent',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => toggleSection(UNSECTIONED_KEY)}
                  >
                    <div style={{ color: c.textMuted }}>
                      {collapsedSections.has(UNSECTIONED_KEY) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </div>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: c.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      Unsectioned
                    </span>
                    <span style={{ fontSize: '10px', color: c.textMuted }}>
                      {sectionSummaryByKey.get(UNSECTIONED_KEY) || unsectionedReqs.length}
                    </span>
                  </div>
                )}
                {!(sortedSections.length > 0 && collapsedSections.has(UNSECTIONED_KEY)) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {unsectionedReqs.map(req => renderRequirementCard(req))}
                  </div>
                )}
              </div>
            )}

            {filteredRequirements.length === 0 && reqCount === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: c.textMuted,
              }}>
                <ListChecks size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
                <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
                  No requirements yet
                </div>
                <div style={{ fontSize: '11px' }}>
                  Add your first requirement below
                </div>
              </div>
            )}

            {filteredRequirements.length === 0 && reqCount > 0 && (
              <div style={{
                textAlign: 'center',
                padding: '24px 16px',
                color: c.textMuted,
                fontSize: '12px',
              }}>
                No requirements match the current filters
              </div>
            )}

            {!showSectionAdd ? (
              <button
                onClick={() => setShowSectionAdd(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  width: '100%',
                  padding: '8px 12px',
                  marginTop: '8px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: c.textMuted,
                  border: `1px dashed ${c.border}`,
                  borderRadius: '8px',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = c.primary;
                  e.currentTarget.style.color = c.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = c.border;
                  e.currentTarget.style.color = c.textMuted;
                }}
              >
                <Plus size={12} />
                Add Section
              </button>
            ) : (
              <div style={{
                display: 'flex',
                gap: '6px',
                marginTop: '8px',
                alignItems: 'center',
              }}>
                <input
                  type="text"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSection();
                    if (e.key === 'Escape') { setShowSectionAdd(false); setNewSectionName(''); }
                  }}
                  placeholder="Section name..."
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: '11px',
                    border: `1px solid ${c.border}`,
                    borderRadius: '6px',
                    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
                    color: c.text,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleCreateSection}
                  disabled={!newSectionName.trim()}
                  style={{
                    padding: '6px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: '6px',
                    backgroundColor: newSectionName.trim() ? c.primary : c.border,
                    color: '#fff',
                    cursor: newSectionName.trim() ? 'pointer' : 'default',
                    opacity: newSectionName.trim() ? 1 : 0.5,
                  }}
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowSectionAdd(false); setNewSectionName(''); }}
                  style={{
                    padding: '4px',
                    border: 'none',
                    borderRadius: '4px',
                    backgroundColor: 'transparent',
                    color: c.textMuted,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
      </div>

      <div style={{
        borderTop: `1px solid ${c.border}`,
        padding: '8px 12px',
        backgroundColor: theme.mode === 'dark' ? c.backgroundSecondary : '#fafafa',
      }}>
        {showQuickAdd ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedSections.length > 0 && (
              <select
                value={quickAddSection}
                onChange={(e) => setQuickAddSection(e.target.value)}
                style={{
                  padding: '5px 8px',
                  fontSize: '11px',
                  border: `1px solid ${c.border}`,
                  borderRadius: '6px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
                  color: c.text,
                }}
              >
                <option value="">No section</option>
                {sortedSections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={quickAddName}
                onChange={(e) => setQuickAddName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuickAdd();
                  if (e.key === 'Escape') { setShowQuickAdd(false); setQuickAddName(''); }
                }}
                placeholder="Requirement name..."
                autoFocus
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  fontSize: '12px',
                  border: `1px solid ${c.border}`,
                  borderRadius: '6px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
                  color: c.text,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleQuickAdd}
                disabled={!quickAddName.trim()}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: quickAddName.trim() ? c.primary : c.border,
                  color: '#fff',
                  cursor: quickAddName.trim() ? 'pointer' : 'default',
                  opacity: quickAddName.trim() ? 1 : 0.5,
                  transition: 'opacity 0.15s ease',
                }}
              >
                Add
              </button>
              <button
                onClick={() => { setShowQuickAdd(false); setQuickAddName(''); }}
                style={{
                  padding: '4px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: c.textMuted,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setShowQuickAdd(true);
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: 600,
              border: 'none',
              borderRadius: '8px',
              backgroundColor: c.primary,
              color: '#fff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = c.primaryHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = c.primary;
            }}
          >
            <Plus size={14} />
            Add Requirement
          </button>
        )}
      </div>
        </>
      )}
    </div>
  );
}
