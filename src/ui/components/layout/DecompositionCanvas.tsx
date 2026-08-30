import { memo, useEffect, useState, useMemo, useRef } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { FileText, CircleAlert as AlertCircle, Loader, ToggleLeft, Layers } from 'lucide-react';
import { useSpecification, useServices, useTestCase } from '../../context/ServiceContext.js';
import type { SpecificationSection, Requirement, RequirementMapping } from '../../services/SpecificationService.js';
import type { RequirementRelation } from '../../../persistence/supabase/requirement-relations-repository.js';
import { mapDbToRequirementRelation } from '../../../persistence/supabase/requirement-relations-repository.js';
import { computeArchivedLineage, findTestPlanArtifact } from '../spec-v3/scale.js';
import type { LineageChainEntry } from '../spec-v3/scale.js';
import type { Node as GraphNode, Graph } from '@nodespec/core/types.js';
import type { TestCase } from '../../../persistence/supabase/test-case-repository.js';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import { nodeTypes } from '../nodes/index.js';
import { NodeSidepane } from '../panels/NodeSidepane.js';
import { RequirementInspector } from '../panels/RequirementInspector.js';
import { TestInspector } from '../panels/TestInspector.js';
import { getNodeTypeById } from '@nodespec/core/node-types.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { EmptyCanvasPrompt } from '../common/index.js';
import type { RealtimeEvent, TestCaseRealtimeEvent, MappingRealtimeEvent } from '../../services/SpecificationRealtimeService.js';
import '@xyflow/react/dist/style.css';

interface ArchNodePort {
  id: string;
  // 'bidirectional' exists in graph data but the node components only render handles
  // for strict 'in'/'out' ports — so it satisfies neither direction here.
  direction: 'in' | 'out' | 'bidirectional';
  name?: string;
  [key: string]: unknown;
}

/**
 * Normalize an architecture node's ports for canvas rendering. The node components
 * render connection handles ONLY for ports that exist (handle ids `in-<i>`/`out-<i>`),
 * requirement→architecture edges always target `in-0`, and architecture→deployment
 * edges always source `out-0` — so BOTH directions must exist or React Flow silently
 * drops the edge. The pre-fix version ensured only `out`, which dropped every
 * requirement edge into out-port-only nodes (e.g. the seeded API Service; found live
 * on the bench 2026-07-14 — the DecompositionCanvas sibling of the SB-3 BaseNode
 * invisible-edges finding).
 */
export function normalizeArchNodePorts(graphPorts: ArchNodePort[] | undefined): ArchNodePort[] {
  const basePorts: ArchNodePort[] = graphPorts && graphPorts.length > 0
    ? graphPorts
    : [{ id: 'in-0', direction: 'in' as const, name: 'Input' }];

  const hasInPort = basePorts.some((p) => p.direction === 'in');
  const hasOutPort = basePorts.some((p) => p.direction === 'out');

  let ports = basePorts;
  if (!hasInPort) ports = [{ id: 'in-0', direction: 'in' as const, name: 'Input' }, ...ports];
  if (!hasOutPort) ports = [...ports, { id: 'out-0', direction: 'out' as const, name: 'Output' }];
  return ports;
}

function mapRealtimeToRequirement(row: any): Requirement {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    requirementId: row.requirement_id ?? row.requirementId,
    name: row.name,
    description: row.description || '',
    category: row.category,
    status: row.status,
    sectionId: row.section_id ?? row.sectionId ?? null,
    source: row.source || 'manual',
    locked: row.locked ?? false,
    confirmed: row.confirmed ?? false,
    acceptanceCriteria: row.acceptance_criteria ?? row.acceptanceCriteria ?? [],
    architectureTrace: row.architecture_trace ?? row.architectureTrace ?? [],
    metadata: row.metadata || {},
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  } as Requirement;
}

function mapRealtimeToSection(row: any): SpecificationSection {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    name: row.name,
    description: row.description || null,
    orderIndex: row.order_index ?? row.orderIndex ?? 0,
    aiGenerated: row.ai_generated ?? row.aiGenerated ?? false,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  } as SpecificationSection;
}

function mapRealtimeToTestCase(row: any): TestCase {
  return {
    id: row.id,
    requirementId: row.requirement_id ?? row.requirementId,
    testId: row.test_id ?? row.testId,
    name: row.name,
    description: row.description ?? undefined,
    testType: row.test_type ?? row.testType,
    framework: row.framework ?? undefined,
    status: row.status,
    implementation: row.implementation ?? undefined,
    expectedResult: row.expected_result ?? row.expectedResult ?? undefined,
    artifactId: row.artifact_id ?? row.artifactId ?? undefined,
    artifactPath: row.artifact_path ?? row.artifactPath ?? undefined,
    sourceArtifactIds: row.source_artifact_ids ?? row.sourceArtifactIds ?? undefined,
    sourceContextHash: row.source_context_hash ?? row.sourceContextHash ?? undefined,
    stale: row.stale ?? false,
    stalenessReason: row.staleness_reason ?? row.stalenessReason ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function mapRealtimeToMapping(row: any): RequirementMapping {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    requirementId: row.requirement_id ?? row.requirementId ?? null,
    nodeId: row.node_id ?? row.nodeId,
    mappingType: row.mapping_type ?? row.mappingType,
    confidence: row.confidence ?? 1.0,
    notes: row.notes ?? undefined,
    createdAt: row.created_at ?? row.createdAt,
    createdBy: row.created_by ?? row.createdBy ?? null,
    isOrphan: row.is_orphan ?? row.isOrphan ?? false,
  };
}

interface DecompositionCanvasProps {
  projectId: string | null;
  hasEmptyState?: boolean;
  refreshCounter?: number;
  workflowOrigin?: 'idea' | 'code' | 'import-spec';
  testRefreshCounter?: number;
  /** The editor's LIVE working graph (P1-7 decomposition-freshness). When provided, the
   *  Architecture column derives from it directly — no waiting on the autosave snapshot,
   *  no refresh needed. Snapshot load remains the fallback when absent. */
  liveGraph?: Graph | null;
}

function DecompositionCanvasComponent({ projectId, hasEmptyState, refreshCounter, workflowOrigin, testRefreshCounter, liveGraph }: DecompositionCanvasProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const specificationService = useSpecification();
  const services = useServices();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [sections, setSections] = useState<SpecificationSection[]>([]);
  const [mappings, setMappings] = useState<RequirementMapping[]>([]);
  const [relations, setRelations] = useState<RequirementRelation[]>([]);
  const [architectureNodes, setArchitectureNodes] = useState<Map<string, GraphNode>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedArchNodeId, setSelectedArchNodeId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<Graph | null>(null);
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(null);
  const [selectedTestArchIds, setSelectedTestArchIds] = useState<string[]>([]);
  const [specificationId, setSpecificationId] = useState<string | null>(null);
  const [specEnabled, setSpecEnabled] = useState<boolean>(true);
  const [graphNodeCount, setGraphNodeCount] = useState(0);
  const testCaseService = useTestCase();
  const [testSummaryByReqId, setTestSummaryByReqId] = useState<Map<string, { total: number; passed: number; failed: number }>>(new Map());
  const [allTestCases, setAllTestCases] = useState<TestCase[]>([]);
  const requirementsRef = useRef(requirements);
  requirementsRef.current = requirements;
  const requirementIdsKey = useMemo(() => requirements.map(r => r.id).sort().join(','), [requirements]);
  const archivedCount = useMemo(
    () => computeArchivedLineage(requirements, relations).archivedRowIds.size,
    [requirements, relations],
  );
  const allTestCasesRef = useRef(allTestCases);
  allTestCasesRef.current = allTestCases;
  // Section G 7b: archived (superseded + completed) requirements leave the canvas;
  // the lineage panel is the time surface. showArchived re-admits them, dimmed.
  const [showArchived, setShowArchived] = useState(false);
  // Owner 2026-08-05: bottom dock toggles filter the four columns; a VISIBLE empty
  // column says so explicitly ("No tests yet") instead of leaving the user guessing.
  const [visibleColumns, setVisibleColumns] = useState({ requirements: true, architecture: true, tests: true });
  // Owner refinement 2026-08-22: type-to-filter over requirement,
  // architecture, and test content — non-matching cards dim in place.
  const [columnFilter, setColumnFilter] = useState('');
  const [lineagePanel, setLineagePanel] = useState<{ forLabel: string; chain: LineageChainEntry[] } | null>(null);

  const handleToggleRequirementConfirm = async (reqId: string) => {
    const req = requirements.find(r => r.id === reqId);
    if (!req) return;

    try {
      await specificationService.updateRequirement(reqId, { confirmed: !req.confirmed });
      setRequirements(prev => prev.map(r => r.id === reqId ? { ...r, confirmed: !r.confirmed } : r));
    } catch (err) {
      console.error('Failed to toggle requirement confirmation:', err);
    }
  };


  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    async function loadRequirementsData() {
      try {
        const specs = await specificationService.getSpecificationsByProject(projectId!);
        if (specs.length === 0) {
          setLoading(false);
          return;
        }

        const specData = specs[0];
        setSpecificationId(specData.id);
        setSpecEnabled(specData.preferences?.specEnabled !== false);

        const [reqs, secs, maps, rels] = await Promise.all([
          specificationService.getRequirementsBySpecification(specData.id),
          specificationService.getSectionsBySpecification(specData.id),
          specificationService.getMappingsBySpecification(specData.id),
          specificationService.getRelationsBySpecification(specData.id),
        ]);

        setRequirements(reqs);
        setSections(secs);
        setMappings(maps);
        setRelations(rels);

        // Graph source: the LIVE editor graph when the parent supplies it (P1-7
        // decomposition-freshness — a node added on the architecture canvas shows here
        // immediately, no snapshot wait, no refresh). Snapshot load is the fallback for
        // contexts that render this canvas without an editor graph.
        let graph: Graph | null = liveGraph ?? null;
        if (!graph && projectId) {
          const branchesResult = await services.persistence.getBranchRepository().listByProject(projectId);
          if (branchesResult.success) {
            const mainBranch = branchesResult.data.find((b: any) => b.name === 'main');
            if (mainBranch) {
              const snapshotResult = await services.persistence.getGraphRepository().loadSnapshot(mainBranch.id);
              if (snapshotResult.success && snapshotResult.data?.graphData) {
                graph = snapshotResult.data.graphData;
              }
            }
          }
        }

        if (graph) {
          setGraphData(graph);
          setGraphNodeCount(Object.keys(graph.nodes).length);

          // Hold the FULL node set — the Architecture column shows every non-container
          // node, mapped or not (unmapped ones render as coverage gaps). Filtering to
          // mapped-only here is what made unmapped nodes invisible on this canvas.
          const nodesMap = new Map<string, GraphNode>();
          Object.values(graph.nodes).forEach((node: GraphNode) => {
            nodesMap.set(node.id, node);
          });
          setArchitectureNodes(nodesMap);

          // Independent of what we render: flag mappings pointing at nodes no longer in
          // the graph as orphans (they carry no live node).
          const validGraphNodeIds = Object.keys(graph.nodes);
          const hasOrphanCandidates = maps.some(
            m => !m.isOrphan && !validGraphNodeIds.includes(m.nodeId)
          );
          if (hasOrphanCandidates) {
            specificationService.runOrphanMappingSync(specData.id).then(result => {
              if (result.orphanedCount > 0) {
                setMappings(prev => prev.map(m =>
                  validGraphNodeIds.includes(m.nodeId) ? m : { ...m, isOrphan: true }
                ));
              }
            }).catch(() => {});
          }
        }

        setLoading(false);
      } catch (err) {
        console.error('[DecompositionCanvas] Load error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load requirements');
        setLoading(false);
      }
    }

    loadRequirementsData();
  }, [projectId, specificationService, services, refreshCounter]);

  // Live-graph updates WHILE mounted: re-derive the Architecture column only. Requirements/
  // mappings are unaffected by graph edits, so this deliberately skips the data reload —
  // an added/removed node reflects immediately without a refetch or refresh.
  useEffect(() => {
    if (!liveGraph) return;
    setGraphData(liveGraph);
    setGraphNodeCount(Object.keys(liveGraph.nodes).length);
    const nodesMap = new Map<string, GraphNode>();
    Object.values(liveGraph.nodes).forEach((node: GraphNode) => nodesMap.set(node.id, node));
    setArchitectureNodes(nodesMap);
  }, [liveGraph]);

  useEffect(() => {
    if (requirements.length === 0) {
      setTestSummaryByReqId(new Map());
      setAllTestCases([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const reqIds = requirements.map(r => r.id);
        const allTests = await testCaseService.getTestCasesByRequirementIds(reqIds);
        if (cancelled) return;

        const summaryMap = new Map<string, { total: number; passed: number; failed: number }>();
        for (const tc of allTests) {
          const existing = summaryMap.get(tc.requirementId) || { total: 0, passed: 0, failed: 0 };
          existing.total += 1;
          if (tc.status === 'passed') existing.passed += 1;
          if (tc.status === 'failed') existing.failed += 1;
          summaryMap.set(tc.requirementId, existing);
        }

        if (!cancelled) {
          setTestSummaryByReqId(summaryMap);
          setAllTestCases(allTests);
        }
      } catch {
        if (!cancelled) {
          setTestSummaryByReqId(new Map());
          setAllTestCases([]);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [requirements, testCaseService, refreshCounter, testRefreshCounter]);

  // Subscribe to realtime feature changes
  useEffect(() => {
    if (!specificationId) {
      return;
    }

    const subscription = services.specificationRealtime.subscribeToSpecification(
      specificationId,
      {
        onSectionChange: (event: RealtimeEvent) => {
          setSections(prev => {
            const updated = [...prev];
            if (event.eventType === 'INSERT' && event.new) {
              const exists = updated.some(s => s.id === (event.new as any).id);
              if (!exists) {
                updated.push(mapRealtimeToSection(event.new));
              }
            } else if (event.eventType === 'UPDATE' && event.new) {
              const index = updated.findIndex(s => s.id === (event.new as any).id);
              if (index !== -1) {
                updated[index] = mapRealtimeToSection(event.new);
              }
            } else if (event.eventType === 'DELETE' && event.old) {
              const index = updated.findIndex(s => s.id === (event.old as any).id);
              if (index !== -1) {
                updated.splice(index, 1);
              }
            }
            return updated;
          });
        },
        onRequirementChange: (event: RealtimeEvent) => {
          setRequirements(prev => {
            const updated = [...prev];
            if (event.eventType === 'INSERT' && event.new) {
              const exists = updated.some(r => r.id === (event.new as any).id);
              if (!exists) {
                updated.push(mapRealtimeToRequirement(event.new));
              }
            } else if (event.eventType === 'UPDATE' && event.new) {
              const index = updated.findIndex(r => r.id === (event.new as any).id);
              if (index !== -1) {
                updated[index] = mapRealtimeToRequirement(event.new);
              }
            } else if (event.eventType === 'DELETE' && event.old) {
              const index = updated.findIndex(r => r.id === (event.old as any).id);
              if (index !== -1) {
                updated.splice(index, 1);
              }
            }
            return updated;
          });
        },
        onMappingChange: (event: RealtimeEvent<MappingRealtimeEvent>) => {
          if (event.eventType === 'INSERT' && event.new) {
            const mapped = mapRealtimeToMapping(event.new);
            setMappings(prev => {
              if (prev.some(m => m.id === mapped.id)) return prev;
              return [...prev, mapped];
            });
          } else if (event.eventType === 'UPDATE' && event.new) {
            const mapped = mapRealtimeToMapping(event.new);
            setMappings(prev => prev.map(m => m.id === mapped.id ? mapped : m));
          } else if (event.eventType === 'DELETE' && event.old) {
            const deletedId = (event.old as any).id;
            setMappings(prev => prev.filter(m => m.id !== deletedId));
          }
        },
        onRelationChange: (event: RealtimeEvent) => {
          // Relations are add/remove facts — INSERT and DELETE are the only lanes.
          if (event.eventType === 'INSERT' && event.new) {
            const mapped = mapDbToRequirementRelation(event.new);
            setRelations(prev => prev.some(r => r.id === mapped.id) ? prev : [...prev, mapped]);
          } else if (event.eventType === 'DELETE' && event.old) {
            const deletedId = (event.old as any).id;
            setRelations(prev => prev.filter(r => r.id !== deletedId));
          }
        },
        onTestCaseChange: (event: RealtimeEvent<TestCaseRealtimeEvent>) => {
          const reqIds = new Set(requirementsRef.current.map(r => r.id));
          if (event.eventType === 'INSERT' && event.new) {
            const row = event.new as TestCaseRealtimeEvent;
            if (!reqIds.has(row.requirement_id)) return;
            const tc = mapRealtimeToTestCase(row);
            setAllTestCases(prev => {
              if (prev.some(t => t.id === tc.id)) return prev;
              return [...prev, tc];
            });
            setTestSummaryByReqId(prev => {
              const next = new Map(prev);
              const existing = next.get(tc.requirementId) || { total: 0, passed: 0, failed: 0 };
              next.set(tc.requirementId, {
                total: existing.total + 1,
                passed: existing.passed + (tc.status === 'passed' ? 1 : 0),
                failed: existing.failed + (tc.status === 'failed' ? 1 : 0),
              });
              return next;
            });
          } else if (event.eventType === 'UPDATE' && event.new) {
            const row = event.new as TestCaseRealtimeEvent;
            if (!reqIds.has(row.requirement_id)) return;
            const tc = mapRealtimeToTestCase(row);
            setAllTestCases(prev => prev.map(t => t.id === tc.id ? tc : t));
            setTestSummaryByReqId(prev => {
              const next = new Map(prev);
              const allForReq = allTestCasesRef.current
                .map(t => t.id === tc.id ? tc : t)
                .filter(t => t.requirementId === tc.requirementId);
              next.set(tc.requirementId, {
                total: allForReq.length,
                passed: allForReq.filter(t => t.status === 'passed').length,
                failed: allForReq.filter(t => t.status === 'failed').length,
              });
              return next;
            });
          } else if (event.eventType === 'DELETE' && event.old) {
            const old = event.old as TestCaseRealtimeEvent;
            const deletedId = old.id;
            const reqId = old.requirement_id;
            setAllTestCases(prev => prev.filter(t => t.id !== deletedId));
            if (reqId) {
              setTestSummaryByReqId(prev => {
                const next = new Map(prev);
                const remaining = allTestCasesRef.current
                  .filter(t => t.id !== deletedId && t.requirementId === reqId);
                if (remaining.length === 0) {
                  next.delete(reqId);
                } else {
                  next.set(reqId, {
                    total: remaining.length,
                    passed: remaining.filter(t => t.status === 'passed').length,
                    failed: remaining.filter(t => t.status === 'failed').length,
                  });
                }
                return next;
              });
            }
          }
        },
        onConnectionChange: () => {},
        onError: (error: Error) => {
          console.error('[DecompositionCanvas] Realtime error:', error);
        },
      },
      { requirementIds: requirementIdsKey ? requirementIdsKey.split(',') : [] }
    );

    return () => { subscription.unsubscribe(); };
  }, [specificationId, services.specificationRealtime, requirementIdsKey]);

  const containerStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    backgroundColor: theme.mode === 'dark' ? c.backgroundSecondary : '#fafafa',
    position: 'relative',
  };

  const emptyStateStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '16px',
    color: c.textMuted,
  };

  const filterNeedle = columnFilter.trim().toLowerCase();

  const { nodes: baseNodes, edges } = useMemo(() => {
    const columnWidth = 340;
    const columnSpacing = 60;
    const baseCardHeight = 130;
    const descriptionExtra = 60;
    const criteriaExtra = 56;
    const cardSpacing = 14;
    const sectionHeaderHeight = 44;
    const sectionPadding = 12;
    const sectionSpacing = 20;

    const estimateCardHeight = (req: typeof requirements[0]) => {
      let h = baseCardHeight;
      if (req.description && req.description.trim().length > 0) h += descriptionExtra;
      if (req.acceptanceCriteria && req.acceptanceCriteria.length > 0) h += criteriaExtra;
      return h;
    };

    const resultNodes: any[] = [];
    const resultEdges: any[] = [];

    // Build requirement-to-architecture mapping for highlighting
    const reqToArch = new Map<string, string[]>();
    requirements.forEach(req => {
      const reqNodeId = `req-${req.id}`;
      if (req.architectureTrace && Array.isArray(req.architectureTrace)) {
        const archIds = req.architectureTrace.map(entry =>
          `arch-${typeof entry === 'string' ? entry : (entry as any)?.nodeId}`
        ).filter(id => id !== 'arch-undefined');
        if (archIds.length > 0) reqToArch.set(reqNodeId, archIds);
      }
    });

    // Build requirement-to-test mapping for highlighting
    const reqToTests = new Map<string, string[]>();
    for (const tc of allTestCases) {
      const reqNodeId = `req-${tc.requirementId}`;
      const testNodeId = `test-${tc.id}`;
      if (!reqToTests.has(reqNodeId)) reqToTests.set(reqNodeId, []);
      reqToTests.get(reqNodeId)!.push(testNodeId);
    }

    // Section G 7b: supersession is temporal, the canvas is structural — archived
    // requirements (completed + superseded via 'expands') leave the canvas and NO
    // req→req edge is ever drawn. The superseding card carries the lineage chip.
    const lineage = computeArchivedLineage(requirements, relations);
    const isArchived = (id: string) => lineage.archivedRowIds.has(id);
    const renderableReqsAll = requirements.filter(req => !isArchived(req.id) || showArchived);

    // Type-to-filter, refined (owner 2026-08-22 round 2): the filter
    // COLLAPSES the columns to the match plus its LINKED nodes, one hop out —
    // a matched requirement keeps its mapped architecture and its tests; a
    // matched architecture node keeps the requirements mapped to it (NOT
    // their other architecture); a matched test keeps its requirement's
    // group and that requirement's architecture. Everything unrelated leaves
    // the canvas entirely and the survivors re-pack, because the layout
    // below runs on these filtered inputs.
    let keepReqIds: Set<string> | null = null;
    let keepArchIds: Set<string> | null = null;
    if (filterNeedle) {
      const matchText = (...vals: unknown[]) =>
        vals.some((v) => typeof v === 'string' && v.toLowerCase().includes(filterNeedle));

      // requirement → its combined arch leaves (trace + mappings — the same
      // union the req→arch edges draw from).
      const archLeafIdSet = new Set(
        Array.from(architectureNodes.keys()).filter((id) => {
          const n = architectureNodes.get(id);
          return !!n?.type && !getContainerTypeById(n.type);
        }),
      );
      const reqArchIds = new Map<string, Set<string>>();
      for (const req of requirements) {
        const ids = new Set<string>();
        for (const entry of req.architectureTrace || []) {
          const id = typeof entry === 'string' ? entry : (entry as any)?.nodeId;
          if (id && archLeafIdSet.has(id)) ids.add(id);
        }
        reqArchIds.set(req.id, ids);
      }
      for (const m of mappings) {
        if (m.isOrphan || !m.requirementId || !archLeafIdSet.has(m.nodeId)) continue;
        if (!reqArchIds.has(m.requirementId)) reqArchIds.set(m.requirementId, new Set());
        reqArchIds.get(m.requirementId)!.add(m.nodeId);
      }

      const matchedReqIds = new Set(
        requirements
          .filter((req) => matchText(
            req.requirementId, req.name, req.description,
            ...(req.acceptanceCriteria ?? []).map((ac: { text?: string }) => ac?.text),
          ))
          .map((r) => r.id),
      );
      const matchedArchIds = new Set(
        [...archLeafIdSet].filter((id) => {
          const n = architectureNodes.get(id);
          return matchText(n?.label, n?.technology, n?.type, n?.type ? getNodeTypeById(n.type)?.label : undefined);
        }),
      );
      const matchedTestReqIds = new Set(
        allTestCases.filter((tc) => matchText(tc.testId, tc.name)).map((tc) => tc.requirementId),
      );

      keepReqIds = new Set<string>([...matchedReqIds, ...matchedTestReqIds]);
      for (const [reqId, archIds] of reqArchIds) {
        if ([...archIds].some((id) => matchedArchIds.has(id))) keepReqIds.add(reqId);
      }
      keepArchIds = new Set<string>(matchedArchIds);
      for (const reqId of [...matchedReqIds, ...matchedTestReqIds]) {
        for (const id of reqArchIds.get(reqId) ?? []) keepArchIds.add(id);
      }
    }
    const renderableReqs = keepReqIds
      ? renderableReqsAll.filter((r) => keepReqIds!.has(r.id))
      : renderableReqsAll;
    // Tests collapse with their requirement: groups render only for kept ones.
    const visibleTestCases = keepReqIds
      ? allTestCases.filter((tc) => keepReqIds!.has(tc.requirementId))
      : allTestCases;

    // Column 1: Requirements organized by sections WITH parent containers
    const requirementsX = 40;
    let currentYPosition = 40;

    // Sort sections by orderIndex (a hidden column builds nothing).
    const sortedSections = (visibleColumns.requirements ? [...sections].sort((a, b) => a.orderIndex - b.orderIndex) : [])
      .filter((section) => !keepReqIds || renderableReqs.some((r) => r.sectionId === section.id));
    const unsectionedRequirements = visibleColumns.requirements ? renderableReqs.filter(req => !req.sectionId) : [];

    // Empty-state placeholder: a visible column with nothing in it says so.
    const pushEmptyColumn = (id: string, x: number, label: string, message: string) => {
      resultNodes.push({
        id: `placeholder-${id}`, type: 'group', position: { x, y: 40 }, draggable: false,
        data: { label, nodeType: 'empty-column', nodeTypeLabel: message, artifacts: [], ports: [], hasError: false, isDraft: false, metadata: {} },
        style: {
          width: columnWidth, height: 96,
          backgroundColor: 'transparent',
          border: `2px dashed ${theme.mode === 'dark' ? 'rgba(148,163,184,0.25)' : 'rgba(100,116,139,0.2)'}`,
          borderRadius: '10px',
        },
      });
    };
    if (visibleColumns.requirements && renderableReqs.length === 0) {
      pushEmptyColumn('requirements', requirementsX, 'Requirements', filterNeedle ? 'No matches' : 'No requirements yet');
    }

    sortedSections.forEach((section) => {
      const sectionRequirements = renderableReqs.filter(req => req.sectionId === section.id);

      const emptySectionHeight = sectionHeaderHeight + sectionPadding * 2 + 40;
      const totalReqHeight = sectionRequirements.reduce((sum, req) => sum + estimateCardHeight(req), 0);
      const sectionHeight = sectionRequirements.length === 0
        ? emptySectionHeight
        : sectionHeaderHeight + sectionPadding +
          totalReqHeight +
          ((sectionRequirements.length - 1) * cardSpacing) +
          sectionPadding;

      const sectionGroupNode = {
        id: `section-${section.id}`,
        type: 'group',
        position: { x: requirementsX, y: currentYPosition },
        data: {
          label: section.name,
          nodeType: 'section',
          nodeTypeLabel: sectionRequirements.length === 0
            ? 'Empty section'
            : `${sectionRequirements.length} Requirements`,
          artifacts: [],
          ports: [],
          hasError: false,
          isDraft: false,
          metadata: { sectionId: section.id },
        },
        style: {
          width: columnWidth,
          height: sectionHeight,
          backgroundColor: theme.mode === 'dark' ? 'rgba(99, 102, 241, 0.06)' : 'rgba(99, 102, 241, 0.02)',
          border: `2px solid ${theme.mode === 'dark' ? 'rgba(99, 102, 241, 0.35)' : 'rgba(99, 102, 241, 0.2)'}`,
          borderRadius: '10px',
        },
        draggable: false,
      };
      resultNodes.push(sectionGroupNode);

      let runningY = sectionHeaderHeight + sectionPadding;
      sectionRequirements.forEach((req) => {
        const thisCardHeight = estimateCardHeight(req);

        const requirementNode = {
          id: `req-${req.id}`,
          type: 'requirement',
          position: { x: sectionPadding, y: runningY },
          parentId: `section-${section.id}`,
          extent: 'parent' as const,
          expandParent: true,
          draggable: false,
          data: {
            label: req.name,
            nodeType: 'requirement',
            nodeTypeLabel: req.category,
            artifacts: [],
            // R6: in-0 receives authored relation edges (RequirementNode already
            // renders in-direction handles); out-0 keeps the trace edges.
            ports: [
              { id: 'in-0', direction: 'in' as const },
              { id: 'out-0', direction: 'out' as const },
            ],
            hasError: false,
            isDraft: false,
            highlighted: selectedNodes.length > 0 && (
              selectedNodes.includes(`req-${req.id}`) ||
              selectedNodes.some(nodeId => reqToArch.get(`req-${req.id}`)?.includes(nodeId)) ||
              selectedNodes.some(nodeId => reqToTests.get(`req-${req.id}`)?.includes(nodeId))
            ),
            metadata: {
              dbId: req.id,
              requirementId: req.requirementId,
              status: req.status,
              locked: req.locked ?? false,
              category: req.category,
              description: req.description,
              sectionName: section.name,
              acceptanceCriteria: req.acceptanceCriteria,
              confirmed: req.confirmed || false,
              onToggleConfirm: handleToggleRequirementConfirm,
              onClick: () => setSelectedRequirementId(req.id),
              testSummary: testSummaryByReqId.get(req.id),
              archived: isArchived(req.id),
              lineage: lineage.chainByRowId.get(req.id) ?? null,
              onLineageClick: () => {
                const chain = lineage.chainByRowId.get(req.id);
                if (chain) setLineagePanel({ forLabel: req.requirementId, chain });
              },
            },
          },
          style: {
            width: columnWidth - (sectionPadding * 2),
            height: thisCardHeight,
            ...(isArchived(req.id) ? { opacity: 0.45 } : {}),
          },
        };
        resultNodes.push(requirementNode);
        runningY += thisCardHeight + cardSpacing;
      });

      currentYPosition += sectionHeight + sectionSpacing;
    });

    if (unsectionedRequirements.length > 0) {
      const totalUnsectionedReqHeight = unsectionedRequirements.reduce(
        (sum, req) => sum + estimateCardHeight(req), 0
      );
      const unsectionedHeight = sectionHeaderHeight + sectionPadding +
        totalUnsectionedReqHeight +
        ((unsectionedRequirements.length - 1) * cardSpacing) +
        sectionPadding;

      const unsectionedGroupNode = {
        id: 'section-unsectioned',
        type: 'group',
        position: { x: requirementsX, y: currentYPosition },
        data: {
          label: 'Uncategorized',
          nodeType: 'section',
          nodeTypeLabel: `${unsectionedRequirements.length} Requirements`,
          artifacts: [],
          ports: [],
          hasError: false,
          isDraft: false,
          metadata: {},
        },
        style: {
          width: columnWidth,
          height: unsectionedHeight,
          backgroundColor: theme.mode === 'dark' ? 'rgba(150, 150, 150, 0.06)' : 'rgba(150, 150, 150, 0.02)',
          border: `2px dashed ${theme.mode === 'dark' ? 'rgba(150, 150, 150, 0.35)' : 'rgba(150, 150, 150, 0.2)'}`,
          borderRadius: '10px',
        },
        draggable: false,
      };
      resultNodes.push(unsectionedGroupNode);

      let unsectionedRunningY = sectionHeaderHeight + sectionPadding;
      unsectionedRequirements.forEach((req) => {
        const thisCardHeight = estimateCardHeight(req);

        resultNodes.push({
          id: `req-${req.id}`,
          type: 'requirement',
          position: { x: sectionPadding, y: unsectionedRunningY },
          parentId: 'section-unsectioned',
          extent: 'parent' as const,
          expandParent: true,
          draggable: false,
          data: {
            label: req.name,
            nodeType: 'requirement',
            nodeTypeLabel: req.category,
            artifacts: [],
            ports: [
              { id: 'in-0', direction: 'in' as const },
              { id: 'out-0', direction: 'out' as const },
            ],
            hasError: false,
            isDraft: false,
            highlighted: selectedNodes.length > 0 && (
              selectedNodes.includes(`req-${req.id}`) ||
              selectedNodes.some(nodeId => reqToArch.get(`req-${req.id}`)?.includes(nodeId)) ||
              selectedNodes.some(nodeId => reqToTests.get(`req-${req.id}`)?.includes(nodeId))
            ),
            metadata: {
              dbId: req.id,
              requirementId: req.requirementId,
              status: req.status,
              locked: req.locked ?? false,
              category: req.category,
              description: req.description,
              sectionName: 'Uncategorized',
              acceptanceCriteria: req.acceptanceCriteria,
              confirmed: req.confirmed || false,
              onToggleConfirm: handleToggleRequirementConfirm,
              onClick: () => setSelectedRequirementId(req.id),
              testSummary: testSummaryByReqId.get(req.id),
              archived: isArchived(req.id),
              lineage: lineage.chainByRowId.get(req.id) ?? null,
              onLineageClick: () => {
                const chain = lineage.chainByRowId.get(req.id);
                if (chain) setLineagePanel({ forLabel: req.requirementId, chain });
              },
            },
          },
          style: {
            width: columnWidth - (sectionPadding * 2),
            height: thisCardHeight,
            ...(isArchived(req.id) ? { opacity: 0.45 } : {}),
          },
        });
        unsectionedRunningY += thisCardHeight + cardSpacing;
      });

      currentYPosition += unsectionedHeight + sectionSpacing;
    }

    // Column 2: Architecture (post-generation). Hidden columns yield their slot —
    // later columns shift left instead of leaving a gap.
    const architectureX = visibleColumns.requirements ? requirementsX + columnWidth + columnSpacing : requirementsX;
    // Which nodes are traced to a requirement (via specification_mappings or architectureTrace).
    // These get traceability edges + full styling; every OTHER architecture node still shows,
    // marked as unmapped (a requirement-coverage gap) rather than being hidden.
    const nodeIdsFromMappingsInRender = mappings.filter(m => !m.isOrphan).map(m => m.nodeId);
    const nodeIdsFromReqTraces = requirements.flatMap(r =>
      (r.architectureTrace || []).map((entry: any) =>
        typeof entry === 'string' ? entry : entry?.nodeId
      ).filter(Boolean)
    );
    const mappedNodeIdSet = new Set([...nodeIdsFromMappingsInRender, ...nodeIdsFromReqTraces]);
    // Render ALL non-container architecture nodes — architectureNodes now holds the full graph.
    const allArchLeafIds = Array.from(architectureNodes.keys()).filter(nodeId => {
      const graphNode = architectureNodes.get(nodeId);
      if (!graphNode || !graphNode.type) return false;
      return !getContainerTypeById(graphNode.type);
    });
    const keptArchLeafIds = keepArchIds ? allArchLeafIds.filter((id) => keepArchIds!.has(id)) : allArchLeafIds;
    const uniqueNodeIds = visibleColumns.architecture ? keptArchLeafIds : [];
    if (visibleColumns.architecture && keptArchLeafIds.length === 0) {
      pushEmptyColumn('architecture', architectureX, 'Architecture', filterNeedle ? 'No matches' : 'No architecture yet');
    }
    const archNodeSize = 120;
    const archNodeSpacing = 16;

    // Deployment wrappers (owner refinement 2026-08-22): the deployment
    // column is retired — architecture nodes deployed into the same
    // infrastructure/orchestration/runtime container now render INSIDE a
    // light dashed wrapper carrying that container's icon + label (the same
    // ancestor walk the old column used). Arch node ids stay `arch-<id>`, so
    // req→arch and arch→test edges are untouched.
    // Y positions RELATIVE to the architecture column group, tracked during
    // layout — the tests column anchors to these (scanning nodes by
    // parentId === 'architecture-group' broke once nodes nest in wrappers).
    const archColumnRelY = new Map<string, number>();

    if (uniqueNodeIds.length > 0) {
      const unmappedCount = uniqueNodeIds.filter(id => !mappedNodeIdSet.has(id)).length;

      const deploymentLayers = new Set(['infrastructure', 'orchestration', 'runtime']);
      type DeployGroup = { id: string; label: string; type: string; layer: string; icon: string; childArchIds: string[] };
      const deploymentContainers = new Map<string, DeployGroup>();
      const archToDeployment = new Map<string, string>();
      if (graphData) {
        for (const nodeId of uniqueNodeIds) {
          const leaf = graphData.nodes[nodeId];
          if (!leaf) continue;
          let current: GraphNode | undefined = leaf;
          while (current?.parentId) {
            const parent: GraphNode | undefined = graphData.nodes[current.parentId];
            if (!parent) break;
            const containerDef = getContainerTypeById(parent.type);
            if (containerDef && deploymentLayers.has(containerDef.layer)) {
              if (!deploymentContainers.has(parent.id)) {
                deploymentContainers.set(parent.id, {
                  id: parent.id,
                  label: parent.label,
                  type: parent.type,
                  layer: containerDef.layer,
                  icon: containerDef.icon,
                  childArchIds: [],
                });
              }
              deploymentContainers.get(parent.id)!.childArchIds.push(nodeId);
              archToDeployment.set(nodeId, parent.id);
              break;
            }
            current = parent;
          }
        }
      }

      // Layout order: wrapped clusters first (infrastructure → orchestration
      // → runtime, the old column's order), then undeployed nodes.
      const layerOrder: Record<string, number> = { infrastructure: 0, orchestration: 1, runtime: 2 };
      const sortedDeployGroups = Array.from(deploymentContainers.values())
        .sort((a, b) => (layerOrder[a.layer] ?? 3) - (layerOrder[b.layer] ?? 3));
      const undeployedIds = uniqueNodeIds.filter(id => !archToDeployment.has(id));

      const wrapHeaderH = 30;
      const wrapPad = 6;
      const wrapPadBottom = 8;

      type ArchPlacement = { nodeId: string; parentId: string; x: number; y: number };
      const archPlacements: ArchPlacement[] = [];
      const wrapperPlacements: Array<{ group: DeployGroup; y: number; height: number }> = [];

      let archCursorY = sectionHeaderHeight + sectionPadding;
      for (const deploy of sortedDeployGroups) {
        const n = deploy.childArchIds.length;
        const wrapperHeight = wrapHeaderH + (n * archNodeSize) + ((n - 1) * archNodeSpacing) + wrapPadBottom;
        wrapperPlacements.push({ group: deploy, y: archCursorY, height: wrapperHeight });
        deploy.childArchIds.forEach((nodeId, idx) => {
          const yInWrapper = wrapHeaderH + idx * (archNodeSize + archNodeSpacing);
          archPlacements.push({ nodeId, parentId: `deploy-wrap-${deploy.id}`, x: sectionPadding - wrapPad, y: yInWrapper });
          archColumnRelY.set(nodeId, archCursorY + yInWrapper);
        });
        archCursorY += wrapperHeight + archNodeSpacing;
      }
      for (const nodeId of undeployedIds) {
        archPlacements.push({ nodeId, parentId: 'architecture-group', x: sectionPadding, y: archCursorY });
        archColumnRelY.set(nodeId, archCursorY);
        archCursorY += archNodeSize + archNodeSpacing;
      }

      const groupHeight = archCursorY - archNodeSpacing + (sectionPadding * 1.5);

      // Add architecture group container
      const architectureGroupNode = {
        id: 'architecture-group',
        type: 'group',
        position: { x: architectureX, y: 40 },
        data: {
          label: 'Architecture',
          nodeType: 'architecture-group',
          nodeTypeLabel: `${uniqueNodeIds.length} Node${uniqueNodeIds.length !== 1 ? 's' : ''}${unmappedCount > 0 ? ` · ${unmappedCount} unmapped` : ''}`,
          artifacts: [],
          ports: [],
          hasError: false,
          isDraft: false,
          metadata: {},
        },
        style: {
          width: columnWidth,
          height: groupHeight,
          backgroundColor: theme.mode === 'dark' ? 'rgba(34, 197, 94, 0.06)' : 'rgba(34, 197, 94, 0.02)',
          border: `2px solid ${theme.mode === 'dark' ? 'rgba(34, 197, 94, 0.35)' : 'rgba(34, 197, 94, 0.2)'}`,
          borderRadius: '10px',
        },
        draggable: false,
      };
      resultNodes.push(architectureGroupNode);

      // Wrappers push BEFORE their children (React Flow requires parents
      // earlier in the array). Pure chrome: unselectable, no ports.
      for (const wp of wrapperPlacements) {
        const containerDef = getContainerTypeById(wp.group.type);
        const layerLabel = wp.group.layer.charAt(0).toUpperCase() + wp.group.layer.slice(1);
        resultNodes.push({
          id: `deploy-wrap-${wp.group.id}`,
          type: 'deploymentWrapper',
          position: { x: wrapPad, y: wp.y },
          parentId: 'architecture-group',
          extent: 'parent' as const,
          draggable: false,
          selectable: false,
          data: {
            label: wp.group.label,
            nodeType: wp.group.type,
            nodeTypeLabel: `${layerLabel} \u00B7 ${containerDef?.label || wp.group.type}`,
            artifacts: [],
            ports: [],
            hasError: false,
            isDraft: false,
            metadata: {
              originalNodeId: wp.group.id,
              layer: wp.group.layer,
              icon: wp.group.icon,
              childCount: wp.group.childArchIds.length,
            },
          },
          style: {
            width: columnWidth - (wrapPad * 2),
            height: wp.height,
          },
        });
      }

      for (const placement of archPlacements) {
        const nodeId = placement.nodeId;
        const graphNode = architectureNodes.get(nodeId);

        const nodeTypeInfo = graphNode?.type ? getNodeTypeById(graphNode.type) : undefined;
        const nodeIcon = nodeTypeInfo?.icon || '\u{1F4E6}';
        const resolvedTypeLabel = nodeTypeInfo?.label ||
          (graphNode?.type
            ? graphNode.type.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
            : 'Node');

        const nodePorts = normalizeArchNodePorts(graphNode?.ports);
        const isUnmapped = !mappedNodeIdSet.has(nodeId);

        const archNodeId = `arch-${nodeId}`;
        const isArchHighlighted = selectedNodes.length > 0 && (
          selectedNodes.includes(archNodeId) ||
          Array.from(reqToArch.entries()).some(([reqId, archIds]) =>
            archIds.includes(archNodeId) && selectedNodes.includes(reqId)
          )
        );

        const archNode = {
          id: archNodeId,
          type: 'architectureExplanation',
          position: { x: placement.x, y: placement.y },
          parentId: placement.parentId,
          extent: 'parent' as const,
          expandParent: true,
          draggable: false,
          data: {
            label: graphNode?.label || 'Unnamed Node',
            nodeType: graphNode?.type || 'node',
            nodeTypeLabel: resolvedTypeLabel,
            technology: graphNode?.technology || '',
            icon: nodeIcon,
            artifacts: graphNode?.artifacts || [],
            ports: nodePorts,
            hasError: false,
            isDraft: false,
            highlighted: isArchHighlighted,
            metadata: {
              ...graphNode?.metadata,
              rationale: (graphNode?.metadata as Record<string, unknown>)?.rationale || '',
              originalNodeId: nodeId,
              unmapped: isUnmapped,
            },
          },
          style: {
            width: columnWidth - (sectionPadding * 2),
            height: archNodeSize,
          },
        };
        resultNodes.push(archNode);
      }
    }

    // Requirement-to-architecture edges: direct from requirements via architectureTrace + mappings.
    // Archived requirements never draw edges — even when shown, they are history, not flow.
    const addedReqArchEdges = new Set<string>();
    const traceEdgeSources = (visibleColumns.requirements && visibleColumns.architecture)
      ? renderableReqs.filter(req => !isArchived(req.id))
      : [];
    traceEdgeSources.forEach(req => {
      const traceIds = (req.architectureTrace || []).map((entry: any) =>
        typeof entry === 'string' ? entry : entry?.nodeId
      ).filter(Boolean);

      const mappingIds = mappings
        .filter(m => m.requirementId === req.id && !m.isOrphan)
        .map(m => m.nodeId);

      const combinedArchIds = Array.from(new Set([...traceIds, ...mappingIds]));

      combinedArchIds.forEach(archNodeId => {
        if (!uniqueNodeIds.includes(archNodeId)) return;
        const edgeId = `req-${req.id}-to-arch-${archNodeId}`;
        if (addedReqArchEdges.has(edgeId)) return;
        addedReqArchEdges.add(edgeId);

        const sourceNodeId = `req-${req.id}`;
        const targetNodeId = `arch-${archNodeId}`;
        const isHighlighted = selectedNodes.length > 0 && (
          selectedNodes.includes(sourceNodeId) || selectedNodes.includes(targetNodeId)
        );

        resultEdges.push({
          id: edgeId,
          source: sourceNodeId,
          target: targetNodeId,
          sourceHandle: 'out-0',
          targetHandle: 'in-0',
          type: 'default',
          animated: isHighlighted,
          style: {
            stroke: isHighlighted
              ? (theme.mode === 'dark' ? 'rgba(251, 146, 60, 0.9)' : 'rgba(251, 146, 60, 0.8)')
              : (theme.mode === 'dark' ? 'rgba(251, 146, 60, 0.55)' : 'rgba(251, 146, 60, 0.45)'),
            strokeWidth: isHighlighted ? 2.5 : 2,
            opacity: selectedNodes.length > 0 && !isHighlighted ? 0.3 : 1,
          },
          data: {
            requirementId: req.id,
            architectureNodeId: archNodeId,
          },
        });
      });
    });

    // Section G 7b supersedes the R6 commit-8 relation edges: req→req edges are
    // NEVER drawn — supersession is temporal, and the lineage chip + panel carry it.

    // Column 4: Tests — Section G 7c: cards are ONE state row each (status + id +
    // name; framework/path live in the inspector), the group header carries the
    // roll-up, and arch→test edges bundle to ONE per source at the group boundary.
    const testsX = visibleColumns.architecture ? architectureX + columnWidth + columnSpacing : architectureX;

    // Plan↔evidence alignment: which live requirements carry a stored test-plan
    // artifact on THIS graph (client mirror of the server's matcher — see
    // findTestPlanArtifact). Evidence rows without a plan are orphans the repo
    // cannot explain; a plan without runs is upstream work awaiting downstream —
    // both are STATE the column must show, never hide.
    const planByReqRow = new Map<string, string>();
    if (visibleColumns.tests && graphData?.artifacts) {
      for (const req of requirements) {
        if (isArchived(req.id)) continue;
        if (keepReqIds && !keepReqIds.has(req.id)) continue;
        const plan = findTestPlanArtifact(graphData.artifacts, req.requirementId, req.name);
        if (plan) planByReqRow.set(req.id, plan.path ?? '');
      }
    }

    if (visibleColumns.tests && visibleTestCases.length === 0 && planByReqRow.size === 0) {
      pushEmptyColumn('tests', testsX, 'Tests', filterNeedle ? 'No matches' : 'No tests yet');
    }
    const testCardHeight = 36;
    const testCardSpacing = 6;
    const testGroupPadding = 8;
    // Owner fix 2026-08-22 (cards overlapped the group header): NodeGroup's
    // rendered header is ~47px tall (12px padding ×2 + 21px roll-up badge +
    // 2px border) — 28 placed the first card INSIDE it. 50 clears it.
    const testGroupHeaderH = 50;

    if (visibleColumns.tests && (visibleTestCases.length > 0 || planByReqRow.size > 0)) {
      const renderedArchSet = new Set(uniqueNodeIds);
      const reqToRenderedArchIds = new Map<string, string[]>();
      for (const m of mappings) {
        if (!m.requirementId || m.isOrphan || !renderedArchSet.has(m.nodeId)) continue;
        const existing = reqToRenderedArchIds.get(m.requirementId) || [];
        if (!existing.includes(m.nodeId)) existing.push(m.nodeId);
        reqToRenderedArchIds.set(m.requirementId, existing);
      }

      const testsByReq = new Map<string, TestCase[]>();
      for (const tc of visibleTestCases) {
        if (isArchived(tc.requirementId)) continue; // archived history renders no test group
        const existing = testsByReq.get(tc.requirementId) || [];
        existing.push(tc);
        testsByReq.set(tc.requirementId, existing);
      }

      // Anchoring uses archColumnRelY — the y positions recorded during the
      // architecture layout (wrapper-nesting aware), relative to the column
      // group like everything here.

      const testGroupSpacing = 12;
      let innerY = sectionHeaderHeight + sectionPadding;

      type TestGroupEntry = {
        reqId: string;
        label: string;
        tests: TestCase[];
        archNodeIds: string[];
        y: number;
        height: number;
      };
      const testGroupEntries: TestGroupEntry[] = [];

      // Column membership is the UNION of both alignment directions: requirements
      // with reported evidence (testsByReq) and requirements whose plan is stored
      // but has no runs yet — the latter renders a slim header-only group.
      const testColumnReqIds = [...testsByReq.keys()];
      for (const rowId of planByReqRow.keys()) {
        if (!testsByReq.has(rowId)) testColumnReqIds.push(rowId);
      }

      for (const reqId of testColumnReqIds) {
        const tests = testsByReq.get(reqId) ?? [];
        const archIds = reqToRenderedArchIds.get(reqId) || [];
        const groupInnerH = tests.length === 0
          ? testGroupHeaderH + testGroupPadding * 2
          : testGroupHeaderH + testGroupPadding +
            (tests.length * testCardHeight) +
            ((tests.length - 1) * testCardSpacing) + testGroupPadding;

        let targetY = innerY;
        if (archIds.length > 0) {
          const firstArchRelY = archColumnRelY.get(archIds[0]);
          if (firstArchRelY !== undefined) targetY = firstArchRelY;
        }
        const placedY = Math.max(innerY, targetY);

        const req = requirements.find(r => r.id === reqId);
        const reqLabel = req?.requirementId || req?.name || 'Tests';

        testGroupEntries.push({
          reqId,
          label: reqLabel,
          tests,
          archNodeIds: archIds,
          y: placedY,
          height: groupInnerH,
        });
        innerY = placedY + groupInnerH + testGroupSpacing;
      }

      const lastEntry = testGroupEntries[testGroupEntries.length - 1];
      const totalTestsHeight = lastEntry
        ? lastEntry.y + lastEntry.height + sectionPadding
        : sectionHeaderHeight + sectionPadding * 2 + 40;

      resultNodes.push({
        id: 'tests-column-group',
        type: 'group',
        position: { x: testsX, y: 40 },
        data: {
          label: 'Tests',
          nodeType: 'test-column-group',
          nodeTypeLabel: visibleTestCases.length > 0
            ? `${visibleTestCases.length} Test${visibleTestCases.length !== 1 ? 's' : ''}`
            : `${planByReqRow.size} plan${planByReqRow.size !== 1 ? 's' : ''} · no runs yet`,
          artifacts: [],
          ports: [],
          hasError: false,
          isDraft: false,
          metadata: {},
        },
        style: {
          width: columnWidth + 16,
          height: totalTestsHeight,
          backgroundColor: theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.04)' : 'rgba(6, 182, 212, 0.015)',
          border: `2px solid ${theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.25)' : 'rgba(6, 182, 212, 0.15)'}`,
          borderRadius: '10px',
        },
        draggable: false,
      });

      for (const entry of testGroupEntries) {
        const { reqId, label, tests, archNodeIds, y: groupY, height: groupH } = entry;
        const groupId = `test-group-${reqId}`;

        const isGroupHighlighted = selectedNodes.length > 0 && (
          selectedNodes.includes(`req-${reqId}`) ||
          archNodeIds.some(aid => selectedNodes.includes(`arch-${aid}`)) ||
          tests.some(tc => selectedNodes.includes(`test-${tc.id}`))
        );

        // 7c roll-up: the header answers "how is verification going" at a glance.
        // Plan↔evidence state rides the same line: results with no stored plan are
        // flagged 'no plan' (orphaned evidence), a stored plan with no results reads
        // 'plan stored · no runs yet' (upstream awaiting downstream).
        const hasPlan = planByReqRow.has(reqId);
        const passed = tests.filter(t => t.status === 'passed' && !t.stale).length;
        const failed = tests.filter(t => t.status === 'failed').length;
        const staleCount = tests.filter(t => t.stale).length;
        const pending = tests.length - passed - failed - staleCount;
        const rollup = tests.length === 0
          ? 'plan stored · no runs yet'
          : ([
            passed > 0 ? `${passed} ✓` : null,
            failed > 0 ? `${failed} ✗` : null,
            staleCount > 0 ? `${staleCount} stale` : null,
            pending > 0 ? `${pending} pending` : null,
          ].filter(Boolean).join(' · ') || `${tests.length} test${tests.length !== 1 ? 's' : ''}`)
            + (hasPlan ? '' : ' · no plan');

        resultNodes.push({
          id: groupId,
          type: 'group',
          position: { x: 8, y: groupY },
          parentId: 'tests-column-group',
          extent: 'parent' as const,
          draggable: false,
          data: {
            label,
            nodeType: 'test-group',
            nodeTypeLabel: rollup,
            artifacts: [],
            ports: [{ id: 'in-0', direction: 'in' as const }],
            hasError: false,
            isDraft: false,
            metadata: {},
          },
          style: {
            width: columnWidth,
            height: groupH,
            backgroundColor: isGroupHighlighted
              ? (theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.10)' : 'rgba(6, 182, 212, 0.05)')
              : 'transparent',
            border: `1.5px solid ${isGroupHighlighted
              ? (theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.5)' : 'rgba(6, 182, 212, 0.35)')
              : (theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(6, 182, 212, 0.08)')}`,
            borderRadius: '8px',
          },
        });

        // 7c bundling: ONE edge per arch source landing on the GROUP boundary port
        // (was N arch × M tests fanning into every card — the single biggest noise
        // source in the column).
        for (const archId of visibleColumns.architecture ? archNodeIds : []) {
          const sourceArchNodeId = `arch-${archId}`;
          const isEdgeHighlighted = selectedNodes.length > 0 && (
            selectedNodes.includes(sourceArchNodeId) || isGroupHighlighted
          );
          resultEdges.push({
            id: `arch-${archId}-to-testgroup-${reqId}`,
            source: sourceArchNodeId,
            target: groupId,
            sourceHandle: 'out-0',
            targetHandle: 'in-0',
            type: 'default',
            animated: isEdgeHighlighted,
            style: {
              stroke: isEdgeHighlighted
                ? (theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.9)' : 'rgba(6, 182, 212, 0.8)')
                : (theme.mode === 'dark' ? 'rgba(6, 182, 212, 0.45)' : 'rgba(6, 182, 212, 0.35)'),
              strokeWidth: isEdgeHighlighted ? 2.5 : 1.75,
              opacity: selectedNodes.length > 0 && !isEdgeHighlighted ? 0.2 : 1,
            },
            data: { archNodeId: archId, requirementId: reqId },
          });
        }

        let cardY = testGroupHeaderH + testGroupPadding;

        for (const tc of tests) {
          const testNodeId = `test-${tc.id}`;

          const isTestHighlighted = selectedNodes.length > 0 && (
            selectedNodes.includes(testNodeId) ||
            selectedNodes.includes(`req-${reqId}`) ||
            archNodeIds.some(aid => selectedNodes.includes(`arch-${aid}`))
          );

          resultNodes.push({
            id: testNodeId,
            type: 'testCase',
            position: { x: testGroupPadding, y: cardY },
            parentId: groupId,
            extent: 'parent' as const,
            expandParent: true,
            draggable: false,
            data: {
              label: tc.name,
              nodeType: 'testCase',
              nodeTypeLabel: tc.testType,
              artifacts: [],
              ports: [
                { id: 'in-0', direction: 'in' as const },
              ],
              hasError: false,
              isDraft: false,
              highlighted: isTestHighlighted,
              metadata: {
                testCaseDbId: tc.id,
                testId: tc.testId,
                testType: tc.testType,
                framework: tc.framework,
                status: tc.status,
                description: tc.description,
                artifactId: tc.artifactId,
                artifactPath: tc.artifactPath,
                stale: tc.stale,
                stalenessReason: tc.stalenessReason,
                requirementId: reqId,
                archNodeIds,
              },
            },
            style: {
              width: columnWidth - (testGroupPadding * 2),
              height: testCardHeight,
            },
          });

          cardY += testCardHeight + testCardSpacing;
        }
      }
    }

    return {
      nodes: resultNodes,
      edges: resultEdges,
    };
  }, [sections, requirements, mappings, relations, architectureNodes, graphData, theme.mode, selectedNodes, testSummaryByReqId, allTestCases, showArchived, visibleColumns, filterNeedle]);

  const nodes = baseNodes;

  const handleNodeClick = (_event: React.MouseEvent, node: any) => {
    if (node.type === 'group') return;

    // If it's a requirement node, show requirement inspector
    if (node.type === 'requirement' && node.id.startsWith('req-')) {
      const requirementId = node.id.replace('req-', '');
      setSelectedRequirementId(requirementId);
      setSelectedArchNodeId(null);
      setSelectedTestCaseId(null);
      setSelectedNodes([node.id]);
      return;
    }

    // If it's a test node, open the dedicated TestInspector
    if (node.type === 'testCase' && node.id.startsWith('test-')) {
      const testCaseDbId = node.data.metadata?.testCaseDbId as string;
      const reqId = node.data.metadata?.requirementId;
      const archIds: string[] = node.data.metadata?.archNodeIds || [];

      setSelectedTestCaseId(testCaseDbId || null);
      setSelectedTestArchIds(archIds);
      setSelectedRequirementId(null);
      setSelectedArchNodeId(null);

      const highlights: string[] = [node.id];
      archIds.forEach((aid: string) => highlights.push(`arch-${aid}`));
      if (reqId) highlights.push(`req-${reqId}`);
      setSelectedNodes(highlights);
      return;
    }

    // If it's an architecture node, show inspector (deployment wrappers are
    // pure chrome — unselectable, clicks fall through to the wrapped nodes).
    if (node.id.startsWith('arch-')) {
      const originalNodeId = node.data.metadata?.originalNodeId;
      if (originalNodeId) {
        setSelectedArchNodeId(originalNodeId);
        setSelectedRequirementId(null);
        setSelectedTestCaseId(null);
        setSelectedNodes([node.id]);
        return;
      }
    }

    // Otherwise, just highlight connections
    setSelectedArchNodeId(null);
    setSelectedRequirementId(null);
    setSelectedTestCaseId(null);
    setSelectedNodes(prev => {
      if (prev.includes(node.id)) {
        return [];
      }
      return [node.id];
    });
  };

  const handlePaneClick = () => {
    setSelectedNodes([]);
    setSelectedArchNodeId(null);
    setSelectedRequirementId(null);
    setSelectedTestCaseId(null);
    setSelectedTestArchIds([]);
  };


  if (loading) {
    return (
      <div style={containerStyles}>
        <div style={emptyStateStyles}>
          <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
          <p>Loading requirements...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyles}>
        <div style={emptyStateStyles}>
          <AlertCircle size={32} color={c.error} />
          <p style={{ color: c.error }}>{error}</p>
        </div>
      </div>
    );
  }

  // Empty states only when there is genuinely nothing to draw. With zero requirements but a
  // populated graph, fall through: the Architecture column renders every node marked unmapped
  // (coverage gaps) — hiding existing nodes behind a "No Requirements Yet" panel was the bug
  // (bench 2026-07-19; same principle as the earlier decomposition-shows-unmapped fix).
  if (!projectId || (requirements.length === 0 && graphNodeCount === 0)) {
    return (
      <div style={containerStyles}>
        {hasEmptyState ? (
          <EmptyCanvasPrompt workflowOrigin={workflowOrigin} />
        ) : !specEnabled ? (
          <div style={emptyStateStyles}>
            <ToggleLeft size={48} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '16px', fontWeight: 500 }}>Specification is currently disabled</p>
            <p style={{ fontSize: '13px', textAlign: 'center', maxWidth: '420px', lineHeight: '1.5' }}>
              Your architecture operates without requirements. Enable the specification workflow from the Spec panel to create requirements and traceability.
            </p>
          </div>
        ) : graphNodeCount > 0 ? (
          <div style={emptyStateStyles}>
            <Layers size={48} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '16px', fontWeight: 500 }}>No Requirements Yet</p>
            <p style={{ fontSize: '13px', textAlign: 'center', maxWidth: '420px', lineHeight: '1.5' }}>
              Your architecture has {graphNodeCount} component{graphNodeCount !== 1 ? 's' : ''} but no specification yet. Use the AI chat to generate requirements from your existing architecture, or enable the specification workflow from the Spec panel.
            </p>
          </div>
        ) : (
          <div style={emptyStateStyles}>
            <FileText size={48} />
            <p style={{ fontSize: '16px', fontWeight: 500 }}>No Requirements</p>
            <p style={{ fontSize: '13px', textAlign: 'center', maxWidth: '400px' }}>
              Parse a specification document to generate requirements and see their mappings to architecture nodes
            </p>
          </div>
        )}
      </div>
    );
  }

  const handleCanvasDrop = async (event: React.DragEvent) => {
    event.preventDefault();

    const nodeType = event.dataTransfer.getData('application/specgraph-node');

    if (!nodeType.startsWith('requirements.')) {
      return;
    }

    if (!specificationId) {
      return;
    }

    const reactFlowBounds = event.currentTarget.getBoundingClientRect();
    const position = {
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    };

    const droppedSection = sections.find(section => {
      const sectionNode = baseNodes.find(n => n.id === `section-${section.id}`);
      if (!sectionNode) return false;

      const sectionX = sectionNode.position.x;
      const sectionY = sectionNode.position.y;
      const sectionWidth = sectionNode.style?.width as number || 360;
      const sectionHeight = sectionNode.style?.height as number || 200;

      return position.x >= sectionX &&
             position.x <= sectionX + sectionWidth &&
             position.y >= sectionY &&
             position.y <= sectionY + sectionHeight;
    });

    if (!droppedSection) {
      return;
    }

    try {
      const requirementId = `REQ-${Date.now()}`;
      const category = nodeType.replace('requirements.', '') as 'functional' | 'non-functional' | 'technical' | 'business';

      const newRequirement = await specificationService.createRequirement({
        specificationId,
        requirementId,
        name: `New ${category} requirement`,
        description: '',
        category,
        acceptanceCriteria: [],
        sectionId: droppedSection.id,
        source: 'manual',
      });

      setRequirements(prev => [...prev, newRequirement]);
    } catch (err) {
      console.error('Failed to create requirement:', err);
    }
  };

  const handleCanvasDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  return (
    <div style={containerStyles}>
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <div
          style={{ flex: 1, position: 'relative' }}
          onDrop={handleCanvasDrop}
          onDragOver={handleCanvasDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            fitView
            fitViewOptions={{ padding: 0.2, minZoom: 0.4, maxZoom: 1.2 }}
            minZoom={0.3}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            panOnDrag={true}
            zoomOnScroll={true}
            proOptions={{ hideAttribution: true }}
            nodeOrigin={[0, 0]}
          >
            <Background
              color={theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}
              gap={20}
              size={1}
            />
            <Controls style={{ bottom: '360px' }} />
          </ReactFlow>
          {/* Type-to-filter (owner 2026-08-22), right above the column dock. */}
          <div style={{
            position: 'absolute', bottom: '52px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <input
              value={columnFilter}
              onChange={(e) => setColumnFilter(e.target.value)}
              placeholder="Filter requirements, nodes, tests…"
              style={{
                width: '260px', padding: '6px 12px', fontSize: '12px',
                borderRadius: '12px', border: `1px solid ${columnFilter ? c.primary : c.border}`,
                backgroundColor: theme.mode === 'dark' ? 'rgba(30,30,40,0.92)' : 'rgba(255,255,255,0.95)',
                color: c.text, outline: 'none',
                boxShadow: theme.mode === 'dark' ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.1)',
              }}
            />
            {columnFilter && (
              <button
                onClick={() => setColumnFilter('')}
                title="Clear the filter"
                style={{
                  border: 'none', borderRadius: '10px', cursor: 'pointer',
                  padding: '5px 9px', fontSize: '11px', fontWeight: 600,
                  backgroundColor: theme.mode === 'dark' ? 'rgba(30,30,40,0.92)' : 'rgba(255,255,255,0.95)',
                  color: c.textMuted,
                  boxShadow: theme.mode === 'dark' ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.1)',
                }}
              >
                ×
              </button>
            )}
          </div>
          {/* Bottom dock (owner 2026-08-05, mirrors the Architecture canvas menu):
              column visibility toggles. */}
          <div style={{
            position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, display: 'flex', gap: '4px', padding: '5px 8px',
            backgroundColor: theme.mode === 'dark' ? 'rgba(30,30,40,0.92)' : 'rgba(255,255,255,0.95)',
            border: `1px solid ${c.border}`, borderRadius: '14px',
            boxShadow: theme.mode === 'dark' ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.1)',
          }}>
            {([['requirements', 'Requirements'], ['architecture', 'Architecture'], ['tests', 'Tests']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setVisibleColumns(v => ({ ...v, [key]: !v[key] }))}
                title={`${visibleColumns[key] ? 'Hide' : 'Show'} the ${label} column`}
                style={{
                  padding: '4px 11px', fontSize: '11px', fontWeight: 600,
                  border: 'none', borderRadius: '10px', cursor: 'pointer',
                  backgroundColor: visibleColumns[key]
                    ? (theme.mode === 'dark' ? 'rgba(139,143,230,0.22)' : 'rgba(139,143,230,0.14)')
                    : 'transparent',
                  color: visibleColumns[key] ? c.primary : c.textMuted,
                  textDecoration: visibleColumns[key] ? 'none' : 'line-through',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Section G 7b: the time surface. Toggle re-admits archived versions
              (dimmed, edge-less); the panel shows a chip's version chain. */}
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(v => !v)}
              style={{
                position: 'absolute', top: '10px', right: '12px', zIndex: 10,
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                border: `1px solid ${showArchived ? c.primary : c.border}`,
                borderRadius: '12px', cursor: 'pointer',
                backgroundColor: showArchived
                  ? (theme.mode === 'dark' ? 'rgba(139,143,230,0.15)' : 'rgba(139,143,230,0.08)')
                  : (theme.mode === 'dark' ? 'rgba(30,30,40,0.85)' : 'rgba(255,255,255,0.9)'),
                color: showArchived ? c.primary : c.textMuted,
              }}
            >
              <Layers size={11} />
              {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
            </button>
          )}
          {lineagePanel && (
            <div style={{
              position: 'absolute', top: '44px', right: '12px', zIndex: 11, width: '300px',
              backgroundColor: theme.mode === 'dark' ? '#1e1e28' : '#fff',
              border: `1px solid ${c.border}`, borderRadius: '10px',
              boxShadow: theme.mode === 'dark' ? '0 4px 16px rgba(0,0,0,0.5)' : '0 4px 16px rgba(0,0,0,0.12)',
              padding: '12px', fontSize: '12px', color: c.text,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700 }}>Requirement lineage · {lineagePanel.forLabel}</span>
                <button onClick={() => setLineagePanel(null)} style={{ border: 'none', background: 'transparent', color: c.textMuted, cursor: 'pointer', fontSize: '14px' }}>×</button>
              </div>
              <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '8px' }}>
                Newest first · archived versions stay out of the graph
              </div>
              {lineagePanel.chain.map((entry, i) => (
                <div key={entry.rowId} style={{
                  display: 'flex', alignItems: 'baseline', gap: '8px', padding: '6px 8px',
                  borderRadius: '6px', marginBottom: '4px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', fontWeight: 700, color: c.primary, flexShrink: 0 }}>
                    {entry.requirementId}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.name}>
                    {entry.name}
                  </span>
                  <span style={{ fontSize: '9px', color: c.textMuted, flexShrink: 0 }}>
                    v-{lineagePanel.chain.length - i} · {entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {selectedArchNodeId && graphData && projectId && (
          <NodeSidepane
            selectedNodeId={selectedArchNodeId}
            selectedEdgeId={null}
            graph={graphData}
            onPatchGenerated={() => {}}
            tab="details"
            onTabChange={() => {}}
            detailsOnly
          />
        )}
        {selectedRequirementId && (
          <RequirementInspector
            requirementId={selectedRequirementId}
            projectId={projectId || undefined}
            onClose={() => setSelectedRequirementId(null)}
            onDelete={(reqId) => {
              setRequirements(prev => prev.filter(r => r.id !== reqId));
              setSelectedRequirementId(null);
            }}
            onUpdate={async () => {
              if (projectId) {
                try {
                  const specs = await specificationService.getSpecificationsByProject(projectId);
                  if (specs.length > 0) {
                    const reqs = await specificationService.getRequirementsBySpecification(specs[0].id);
                    setRequirements(reqs);
                  }
                } catch (err) {
                  console.error('[DecompositionCanvas] Failed to reload data:', err);
                }
              }
            }}
          />
        )}
        {selectedTestCaseId && projectId && (
          <TestInspector
            testCaseId={selectedTestCaseId}
            projectId={projectId}
            archNodeIds={selectedTestArchIds}
            onClose={() => {
              setSelectedTestCaseId(null);
              setSelectedTestArchIds([]);
              setSelectedNodes([]);
            }}
          />
        )}
      </div>
    </div>
  );
}

export const DecompositionCanvas = memo(DecompositionCanvasComponent);
