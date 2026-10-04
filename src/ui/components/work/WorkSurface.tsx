// V3 4.1 → 6.1/6.2 (owner's ruling 2026-09-21, boards P1, P1b, P2) → W
// (owner 2026-09-23, held to the approved mockup): the Work view. One
// surface, three tabs by plan: Workflows (the 3D space, Indie and above),
// Requirements, Plan (Indie and above). Community sees Requirements alone,
// with no tab bar. Requirements has an aside of Workflows (All requirements,
// each workflow, Imported); a requirement's record opens INLINE under its
// row (RequirementRecord), and beside the list sits the rail of an outcome
// or of the workflow in focus (ItemRail).
//
// Every model is mounted here once and handed down: lanes, outcomes, the
// requirement band, the queue (for the promotions waiting), the vision,
// the constraints (Indie and above), the trace (criteria, tasks, tests,
// code per requirement), the lease board, and the plan (for "Set N in the
// plan").
//
// AC (owner 2026-09-24): workflows and constraints are shaped in the
// Workflows space only. The Requirements tab reads the workflows (the aside,
// a workflow's grouped rows) and adds none, renames none, deletes none; the
// rail beside it is an outcome's. Below Indie neither is read at all.
// Owner cleanup 2026-09-15 still holds: repo import belongs to the header's
// Git integration flow, autonomy to the Agents panel; nothing of either
// mounts here.
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { useProjectFeatureGate } from '../../hooks/useProjectFeatureGate.js';
import { useVariant } from '../../hooks/useVariant.js';
import { useViewport } from '../../hooks/useViewport.js';
import { canvasChromeLayout, VIEW_PILL } from '../common/canvas-chrome.js';
import { bannerText, withheldLabel } from '../../utils/classification.js';
import { eyebrow, meta, title } from '../ideation/typography.js';
import { statusTones } from '../ideation/status-tones.js';
import { useAgentPresence } from '../ideation/useAgentPresence.js';
import { useClassificationBanner } from '../ideation/useClassificationBanner.js';
import { useWorkflowLanes } from '../ideation/useWorkflowLanes.js';
import { useWorkLive } from './useWorkLive.js';
import { useProjectOwnership } from '../ideation/useProjectOwnership.js';
import { useAutonomySettings } from '../ideation/useAutonomySettings.js';
import { useOutcomes } from '../ideation/useOutcomes.js';
import { useRequirementBand } from '../ideation/useRequirementBand.js';
import { useApprovalsQueue, pendingPromotions, queuePlanFrom } from '../ideation/useApprovalsQueue.js';
import { useCandidateActions } from '../ideation/useCandidateActions.js';
import { useProjectVision } from '../ideation/useProjectVision.js';
import { useConstraints } from '../ideation/useConstraints.js';
import { useTraceData } from '../ideation/useTraceData.js';
import { usePriorityBoard } from '../priority/usePriorityBoard.js';
import { PlanTab, PlanLegend, type PlanFile } from './PlanTab.js';
import type { PlanViewItem } from '../priority/plan-view.js';
import { WORK_TABS, WORK_TAB_LABEL, loadWorkTab, saveWorkTab, type WorkTab } from './work-tabs.js';
import { laneRowCounts, importedView } from './steps-model.js';
import { allRequirementRows, groupedView, openOutcomes, pendingOutcomesLine, recordOf, planSetsOf, filesByRequirement, chainFilePaths, provenLine } from './requirements-model.js';
import { evidenceCommit, unplacedOutcomes } from './workflows/space-model.js';
import type { Lens } from './workflows/WorkflowsSpace.js';
import type { PatchOperation } from '@nodespec/core/types.js';
import { writeRequirementRow, tickTask, addTestCase, nextTestId, addTaskPatches, nextTaskIdOn } from './requirement-writes.js';
import { ALL_REQUIREMENTS, IMPORTED_LANE, resolveWorkFocus, type WorkFocus } from './work-focus.js';
import type { WorkSelection } from './work-selection.js';
import { RequirementsList, type ListMode, type RequirementOrigin } from './RequirementsList.js';
import { attachableOutcomes, chainCounts, chainLine, constraintReach, firstUnserved, packetNodeIds } from './chain-model.js';
import { visionSentences, type VisionSentence } from '../../utils/vision-sentences.js';
import { RequirementRecord } from './RequirementRecord.js';
import { ItemRail } from './ItemRail.js';
import { ViewOnlyNote } from '../common/ExampleNote.js';

// W: the 3D space and three.js load with the tab, in their own chunk.
const WorkflowsSpace = lazy(() => import('./workflows/WorkflowsSpace.js'));

export interface WorkSurfaceProps {
  projectId: string | null | undefined;
  branchId?: string | null;
  graph?: import('@nodespec/core/types.js').Graph | null;
  /** THE approvals surface is the Agents panel. Passing a proposal id lands
   *  the user on that proposal's card. */
  onOpenChanges?: (focusProposalId?: string) => void;
  /** Bumped by the shell above when a decision lands in the panel: every
   *  read here re-runs at once instead of waiting out a poll. */
  refreshSignal?: number;
  onWarning?: (message: string) => void;
  /** The node chips open Architecture on that node. */
  onOpenArchitecture?: (nodeId: string) => void;
  /** A record another surface asked Work to open (the Architecture rail's
   *  rows, a proposal's unlock door). Applied once per `at`, when the rows
   *  have loaded. */
  focus?: WorkFocus | null;
  /** Y: the branch store's patch sink (the canvas's own). A task added by
   *  hand is an update_artifact on the node's task doc. Absent: no act. */
  onPatches?: (patches: PatchOperation[]) => void;
}

const TASK_ID = /^task:([^:]+):(.+)$/;
const TEST_ID = /^test:([^:]+):(.+)$/;

function WorkSurfaceComponent({ projectId, branchId, graph, onOpenChanges, refreshSignal, onWarning, onOpenArchitecture, focus, onPatches }: WorkSurfaceProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const vp = useViewport();
  // Decision 1: what the project carries is its owner's plan.
  const gate = useProjectFeatureGate(projectId);
  const { variant } = useVariant(projectId);
  const [tab, setTab] = useState<WorkTab>(() => loadWorkTab(projectId));
  const [selection, setSelection] = useState<WorkSelection>({ kind: 'lane' });
  const [focusedLaneId, setFocusedLaneId] = useState<string>(ALL_REQUIREMENTS);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  // 6.3: the Plan tab's doors in: a proposal card's See the diff (the diff
  // clock) and a record's "Set N in the plan" (the chip to land on).
  const [diffClock, setDiffClock] = useState(0);
  const [planFocus, setPlanFocus] = useState<{ id: string; at: number } | null>(null);
  // W: a lens the Requirements list asked the Workflows space for, spent on leaving the tab.
  const [lensRequest, setLensRequest] = useState<{ lens: Lens; at: number; journeyId?: string } | null>(null);

  // Collision visibility: one lease board for the whole view, the same
  // agent_checkouts rows agents read from get_work_queue's activeHolds.
  const presence = useAgentPresence(projectId);
  // Q (owner 2026-09-22): below Indie the Plan tab is not shown and the plan
  // is not read (no tier tag, no refusal state): Free and Community see only
  // what their plan carries. The server and the database refuse it anyway.
  const canPriority = !gate.loading && gate.can('priority_board');
  const canClassify = !gate.loading && gate.can('classification');
  // P (2026-09-22): Workflows start at Indie, with as many as the work needs.
  // Below it the aside shows requirements only; nothing is deleted, and a
  // workflow made on a paid plan comes back on upgrade. While the plan is
  // still loading the aside draws the baseline, never a flash of lanes.
  // Q: below Indie the lanes are not read either.
  const canWorkflows = !gate.loading && gate.can('workflow_space');
  // AJ.6: the account's example shows both on every plan; below them they read only.
  const workflowsViewOnly = canWorkflows && !!gate.viewOnly?.('workflow_space');
  const planViewOnly = canPriority && !!gate.viewOnly?.('priority_board');
  // W: the tabs this plan carries, in the mockup's order.
  const tabs = WORK_TABS.filter((t) => t === 'requirements' || (t === 'workflows' && canWorkflows) || (t === 'plan' && canPriority));
  const activeTab: WorkTab = tabs.includes(tab) ? tab : 'requirements';
  const queuePlan = queuePlanFrom(gate);
  const classification = useClassificationBanner(canClassify ? projectId : null, dataVersion);
  const banner = canClassify ? bannerText(classification.marks) : null;
  const withheld = canClassify ? withheldLabel(classification.withheld) : null;

  // AE.7 (owner 2026-09-25): a teammate's Workflows edit is a proposal the
  // owner decides under Proposals, unless the project's Outcomes & workflow
  // setting is Auto-apply, in which case it writes; the owner writes. While
  // the setting is still being read a teammate proposes.
  const ownership = useProjectOwnership(canWorkflows ? projectId : null);
  const teammate = ownership.loaded && !ownership.isOwner;
  const autonomy = useAutonomySettings(teammate ? projectId : null);
  const proposeEdits = teammate && (autonomy.loading || autonomy.policy.candidates < 2);
  const lanesApi = useWorkflowLanes(canWorkflows ? projectId : null, { propose: proposeEdits, email: ownership.email });
  const outcomesApi = useOutcomes(projectId, branchId, canWorkflows, { propose: proposeEdits, email: ownership.email });
  const bandApi = useRequirementBand(projectId, dataVersion);
  const queue = useApprovalsQueue(projectId, queuePlan);
  const visionApi = useProjectVision(projectId, dataVersion);
  // AC: constraints are Indie and above; below it they are not read.
  const constraintsApi = useConstraints(canWorkflows ? projectId : null);
  const trace = useTraceData(projectId, graph ?? null, lanesApi.lanes, presence.holds);
  // 6.1: the plan is read once here, for the record's "Set N in the plan"
  // and for the Plan tab.
  const board = usePriorityBoard(canPriority ? projectId : null, branchId);
  const refreshAll = useCallback(() => {
    void outcomesApi.refresh(); void bandApi.refresh(); void trace.refresh(); void queue.refresh(); void board.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomesApi.refresh, bandApi.refresh, trace.refresh, queue.refresh, board.refresh]);
  const candidateActions = useCandidateActions(projectId, refreshAll);
  // AL.4: what an agent, a teammate or another tab writes shows here shortly
  // after it lands, without a reload.
  const rereadLive = useCallback(() => {
    refreshAll(); void lanesApi.refresh(); void constraintsApi.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAll, lanesApi.refresh, constraintsApi.refresh]);
  useWorkLive(projectId, branchId, rereadLive);

  // A decision in the Agents panel bumps refreshSignal upstream; every read
  // here re-runs through the same dataVersion the queue decisions used.
  const [lastSignal, setLastSignal] = useState(refreshSignal ?? 0);
  if ((refreshSignal ?? 0) !== lastSignal) { setLastSignal(refreshSignal ?? 0); setDataVersion((v) => v + 1); void presence.refresh(); refreshAll(); }

  const handleTab = useCallback((next: WorkTab) => {
    setTab(next); saveWorkTab(next, projectId);
    // Leaving the Plan tab spends its doors: coming back shows the plan as it is.
    if (next !== 'plan') { setDiffClock(0); setPlanFocus(null); }
    if (next !== 'workflows') setLensRequest(null);
  }, [projectId]);

  const showImported = focusedLaneId === IMPORTED_LANE;
  const showAll = focusedLaneId === ALL_REQUIREMENTS;
  const lane = useMemo(() => (!canWorkflows || showImported || showAll ? null : lanesApi.lanes.find((l) => l.id === focusedLaneId) ?? null), [canWorkflows, lanesApi.lanes, focusedLaneId, showImported, showAll]);
  // A focused workflow that is gone (deleted, or another project loaded) falls back to All.
  // A focus on a lane that is not drawn falls back to All. Not while the plan
  // is loading: canWorkflows is false then, and an Indie focus would be lost.
  useEffect(() => { if (!gate.loading && !showImported && !showAll && !lanesApi.loading && !lane) setFocusedLaneId(ALL_REQUIREMENTS); }, [gate.loading, showImported, showAll, lanesApi.loading, lane]);

  const requirementsById = useMemo(() => new Map(bandApi.rows.map((r) => [r.id, r])), [bandApi.rows]);
  const pending = useMemo(() => pendingPromotions(queue.items), [queue.items]);
  const allRows = useMemo(() => allRequirementRows(bandApi.rows, trace.chains), [bandApi.rows, trace.chains]);
  const grouped = useMemo(() => (lane ? groupedView(lane, outcomesApi.outcomes, requirementsById, pending) : null), [lane, outcomesApi.outcomes, requirementsById, pending]);
  const counts = useMemo(() => laneRowCounts(lanesApi.lanes, outcomesApi.outcomes, requirementsById, pending), [lanesApi.lanes, outcomesApi.outcomes, requirementsById, pending]);
  const imported = useMemo(() => importedView(outcomesApi.outcomes, bandApi.rows), [outcomesApi.outcomes, bandApi.rows]);
  // W: with Workflows on, the outcomes live in the space; All lists only the
  // ones on no stage, which the space cannot draw.
  const unplacedIds = useMemo(() => (canWorkflows ? new Set(unplacedOutcomes(outcomesApi.outcomes, lanesApi.lanes).map((o) => o.id)) : null), [canWorkflows, outcomesApi.outcomes, lanesApi.lanes]);
  const openOutcomeRows = useMemo(() => {
    const open = openOutcomes(outcomesApi.outcomes, requirementsById, pending);
    return unplacedIds ? open.filter((o) => unplacedIds.has(o.id)) : open;
  }, [outcomesApi.outcomes, requirementsById, pending, unplacedIds]);
  const outcomesLine = useMemo(() => pendingOutcomesLine(openOutcomeRows), [openOutcomeRows]);
  const nodeLabels = useMemo(() => new Map(Object.values(graph?.nodes ?? {}).map((n) => [n.id, n.label])), [graph]);
  const chainsById = useMemo(() => new Map(trace.chains.map((ch) => [ch.reqRowId, ch])), [trace.chains]);
  const planSets = useMemo(() => planSetsOf(board.view?.graph.items), [board.view]);
  const filesByReq = useMemo(() => filesByRequirement(trace.chains), [trace.chains]);

  // A focus from another surface: resolved against the rows once they have
  // loaded, applied once per clock value, and it lands on the Requirements tab.
  const appliedFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || appliedFocus.current === focus.at) return;
    if (gate.loading) return;
    if (focus.kind === 'tab') {
      // The walkthrough shows a tab as it is; one the plan does not carry stays closed.
      appliedFocus.current = focus.at;
      if (focus.tab && tabs.includes(focus.tab)) handleTab(focus.tab);
      return;
    }
    if (focus.kind === 'plan') {
      // 6.3: See the diff on a proposal card: the Plan tab, the diff shown.
      // Q: below Indie there is no Plan tab to land on.
      appliedFocus.current = focus.at;
      if (!canPriority) return;
      setTab('plan'); saveWorkTab('plan', projectId);
      setDiffClock(focus.at);
      return;
    }
    if (lanesApi.loading || outcomesApi.loading || bandApi.loading) return;
    appliedFocus.current = focus.at;
    const r = resolveWorkFocus(focus, lanesApi.lanes, outcomesApi.outcomes, focusedLaneId);
    setTab('requirements'); saveWorkTab('requirements', projectId);
    setFocusedLaneId(r.laneId);
    setSelection(r.selection);
  }, [focus, gate.loading, canPriority, tabs, handleTab, lanesApi.loading, outcomesApi.loading, bandApi.loading, lanesApi.lanes, outcomesApi.outcomes, projectId, focusedLaneId]);

  const focusLane = useCallback((id: string) => { setFocusedLaneId(id); setSelection({ kind: 'lane' }); setShowOutcomes(false); }, []);
  // AA.1: the chain, read from what Work already holds. The vision's
  // sentences are what an outcome cites; the first one no outcome serves is
  // offered first; the header reads the chain as counts; a requirement
  // derives from an open outcome; a constraint says how many packets carry it.
  const sentences = useMemo(() => visionSentences(visionApi.vision), [visionApi.vision]);
  const firstSentenceId = useMemo(() => firstUnserved(sentences, outcomesApi.outcomes)?.id ?? null, [sentences, outcomesApi.outcomes]);
  const attachable = useMemo(() => attachableOutcomes(outcomesApi.outcomes), [outcomesApi.outcomes]);
  const allChainLine = useMemo(() => (projectId
    ? chainLine(chainCounts({ vision: visionApi.vision, outcomes: outcomesApi.outcomes, requirementIds: allRows.map((r) => r.id) }), allRows.length > 0 ? provenLine(allRows) : null)
    : null), [projectId, visionApi.vision, outcomesApi.outcomes, allRows]);
  const reach = useMemo(() => constraintReach({
    constraints: constraintsApi.rows,
    outcomes: outcomesApi.outcomes,
    requirementNodes: new Map(bandApi.rows.map((r) => [r.id, r.nodeIds])),
    packets: packetNodeIds(graph?.artifacts as Record<string, { path?: string; nodeId?: string | null }> | undefined),
  }), [constraintsApi.rows, outcomesApi.outcomes, bandApi.rows, graph]);
  const addProjectOutcome = useCallback(async (name: string, serves: VisionSentence[]) => {
    const r = await outcomesApi.fileOutcome(name, serves);
    return 'error' in r ? r.error : null;
  }, [outcomesApi]);
  // AC: a stage in the Workflows space files any of these that is not yet in its workflow.
  const requirementRows = useMemo(() => allRows.map((r) => ({ id: r.id, ref: r.ref, name: r.name })), [allRows]);
  const createRequirement = useCallback(async (name: string, from: RequirementOrigin) => {
    const r = await bandApi.create(name);
    if ('error' in r) return r.error;
    setSelection({ kind: 'row', identity: `req:${r.id}`, outcomeId: '', requirementRowId: r.id, stepIndex: 0 });
    // AA.1: it derives from the outcome it serves, picked in the same row.
    let outcomeId: string;
    if ('outcomeId' in from) {
      outcomeId = from.outcomeId;
    } else {
      const filed = await outcomesApi.fileOutcome(name, from.newOutcome.serves);
      if ('error' in filed) { void trace.refresh(); return `The requirement is filed, but its outcome was not: ${filed.error}`; }
      outcomeId = filed.id;
    }
    const linkErr = await outcomesApi.attachRequirement(outcomeId, r.id);
    void trace.refresh();
    return linkErr ? `The requirement is filed, but not linked to its outcome: ${linkErr}` : null;
  }, [bandApi, trace, outcomesApi]);
  const writeDeps = useMemo(() => ({
    traceRefresh: trace.refresh, bandRefresh: bandApi.refresh, outcomesRefresh: outcomesApi.refresh,
    onDeleted: () => setSelection({ kind: 'lane' }),
  }), [trace.refresh, bandApi.refresh, outcomesApi.refresh]);

  // 6.3: what the Plan tab reads from Work's rows. A workflow focus keeps
  // the nodes its outcomes sit on and the nodes their requirements map to;
  // a test chip's state is its last run; an item's code is its
  // requirements' files (the tests' own files and the files they cover)
  // with the other requirements and the other tasks on the same file.
  const laneNodeIds = useMemo(() => {
    if (!lane) return null;
    const stepIds = new Set(lane.steps.map((s) => s.id));
    const nodes = new Set<string>();
    for (const o of outcomesApi.outcomes) {
      if (o.workflowId !== lane.id && !o.stepIds.some((s) => stepIds.has(s))) continue;
      if (o.node_id) nodes.add(o.node_id);
      for (const d of o.derivations) for (const n of requirementsById.get(d.requirementRowId)?.nodeIds ?? []) nodes.add(n);
    }
    return nodes;
  }, [lane, outcomesApi.outcomes, requirementsById]);
  const testStatus = useMemo(() => {
    const m = new Map<string, string>();
    for (const ch of trace.chains) for (const t of ch.verify.tests) m.set(`test:${ch.reqRowId}:${t.test_id}`, t.stale ? 'stale' : t.status);
    return m;
  }, [trace.chains]);
  const filesOf = useCallback((item: PlanViewItem): PlanFile[] => {
    const out = new Map<string, Set<string>>();
    const own = new Set<string>();
    const test = item.kind === 'test' ? TEST_ID.exec(item.id) : null;
    if (test) {
      const ch = chainsById.get(test[1]);
      if (ch) own.add(ch.ref);
      const sub = ch?.cells.plan.flatMap((p) => p.down).find((t) => t.title.startsWith(`${test[2]} ·`));
      for (const l of sub?.links ?? []) if (l.startsWith('af:')) out.set(l.slice(3), out.get(l.slice(3)) ?? new Set());
    } else {
      for (const rid of item.requirementIds) {
        const ch = chainsById.get(rid);
        if (!ch) continue;
        own.add(ch.ref);
        for (const p of chainFilePaths(ch)) out.set(p, out.get(p) ?? new Set());
      }
    }
    for (const [p, also] of out) for (const ref of filesByReq.get(p) ?? []) if (!own.has(ref)) also.add(ref);
    for (const other of board.view?.graph.items ?? []) {
      if (other.id === item.id || other.kind !== 'task' || other.nodeId !== item.nodeId) continue;
      for (const rid of other.requirementIds) {
        const ch = chainsById.get(rid);
        if (!ch) continue;
        for (const p of chainFilePaths(ch)) out.get(p)?.add(other.displayId);
      }
    }
    return [...out].map(([path, also]) => ({ path, also: [...also] }));
  }, [chainsById, filesByReq, board.view]);
  const openRequirement = useCallback((rowId: string) => {
    handleTab('requirements'); setFocusedLaneId(ALL_REQUIREMENTS); setShowOutcomes(false);
    setSelection({ kind: 'row', identity: `req:${rowId}`, outcomeId: '', requirementRowId: rowId, stepIndex: 0 });
  }, [handleTab]);
  const openPlanAt = useCallback((taskId: string) => { handleTab('plan'); setPlanFocus({ id: taskId, at: Date.now() }); }, [handleTab]);
  const boardRefresh = board.refresh;
  const tickPlanTask = useCallback(async (item: PlanViewItem, done: boolean) => {
    if (!projectId || !item.nodeId) return 'That task has no row to tick.';
    const err = await tickTask({ projectId, nodeId: item.nodeId, taskKey: item.itemKey, displayId: item.displayId, title: item.title, done }, writeDeps);
    if (!err) void boardRefresh();
    return err;
  }, [projectId, writeDeps, boardRefresh]);
  const queueRefresh = queue.refresh;
  const planDecided = useCallback(() => { void queueRefresh(); }, [queueRefresh]);

  // The record's lock: the band row is the source of truth (setLocked
  // re-reads it), and the trace re-reads too so its updated_at token, the
  // next edit's precondition, is not the pre-lock value.
  const traceRefresh = trace.refresh;
  const recordBand = useMemo(() => ({
    rename: bandApi.rename, confirm: bandApi.confirm,
    setLocked: async (id: string, locked: boolean) => { const r = await bandApi.setLocked(id, locked); if (!r) void traceRefresh(); return r; },
  }), [bandApi.rename, bandApi.confirm, bandApi.setLocked, traceRefresh]);

  const selectedRequirement = selection.kind === 'row' && selection.requirementRowId ? requirementsById.get(selection.requirementRowId) ?? null : null;
  const selectedChain = selectedRequirement ? chainsById.get(selectedRequirement.id) ?? null : null;
  const record = useMemo(() => (selectedChain && selectedRequirement
    ? recordOf(selectedChain, { requirement: selectedRequirement, outcomes: outcomesApi.outcomes, lanes: lanesApi.lanes, planSets, filesByReq, sentences })
    : null), [selectedChain, selectedRequirement, outcomesApi.outcomes, lanesApi.lanes, planSets, filesByReq, sentences]);

  const listMode: ListMode = showImported
    ? { kind: 'imported', view: imported }
    : grouped
      ? { kind: 'workflow', view: grouped }
      : { kind: 'all', rows: allRows, outcomes: outcomesLine };

  // The view pill (Work | Architecture | Export) is the only chrome over
  // this surface now; the content starts under it.
  const layout = canvasChromeLayout({ vw: vp.width, modePill: null, viewPill: VIEW_PILL });
  const phone = vp.isPhone;

  // Held against Phone.dc.html (2026-09-20): at phone width the aside is a
  // strip of chips across the top so the list starts within the first screen.
  const asideRow = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '8px', width: phone ? 'auto' : '100%', flexShrink: 0, textAlign: 'left', border: 'none', borderRadius: '8px', padding: phone ? '8px 12px' : '7px 10px',
    background: on ? `${c.primary}14` : phone ? c.surface : 'transparent', color: on ? c.primary : c.text, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
  });
  const count = (n: number) => <span style={{ ...meta(c.textSecondary), marginLeft: phone ? '2px' : 'auto' }}>{n}</span>;
  const tabButton = (t: WorkTab): React.CSSProperties => ({
    border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: 650, cursor: 'pointer',
    background: activeTab === t ? c.primary : 'transparent', color: activeTab === t ? '#fff' : c.textSecondary, display: 'flex', alignItems: 'center', gap: '6px',
  });

  // W: the record opens under its row; the list draws it where it is asked.
  const nodeInfo = useCallback((nodeId: string) => { const n = graph?.nodes?.[nodeId]; return n ? { tech: n.technology ?? null } : null; }, [graph]);
  const fileLanguage = useCallback((path: string) => Object.values(graph?.artifacts ?? {}).find((a) => a.path === path)?.language ?? null, [graph]);
  const renderRecord = (rowId: string) => {
    if (!selectedRequirement || selectedRequirement.id !== rowId) return null;
    return (
      <RequirementRecord
        requirement={selectedRequirement}
        chain={selectedChain}
        record={record}
        holds={presence.holds}
        canClassify={canClassify}
        bandApi={recordBand}
        onWrite={(patch) => (selectedChain ? writeRequirementRow(selectedChain, patch, writeDeps) : Promise.resolve('Still reading this requirement.'))}
        onTickTask={(task, done) => {
          const m = TASK_ID.exec(task.id);
          if (!m || !projectId) return Promise.resolve('That task has no row to tick.');
          return tickTask({ projectId, nodeId: m[1], taskKey: m[2], displayId: task.displayId, title: task.title, done }, writeDeps);
        }}
        onAddTest={(input) => (selectedChain
          ? addTestCase({ chain: selectedChain, requirementRowId: selectedRequirement.id, testId: nextTestId(selectedChain.verify.tests), ...input }, writeDeps)
          : Promise.resolve('Still reading this requirement.'))}
        nextTestId={nextTestId(selectedChain?.verify.tests ?? [])}
        onAddTask={onPatches ? async ({ nodeId, criterionId, title }) => {
          const k = record?.criteria.find((x) => x.id === criterionId);
          if (!k) return 'That criterion is gone.';
          const r = addTaskPatches(graph, { nodeId, title, serves: { reqId: selectedRequirement.ref, text: k.text } });
          if ('refusal' in r) return r.refusal;
          onPatches(r.patches);
          return null;
        } : undefined}
        nextTaskId={(nodeId) => nextTaskIdOn(graph, nodeId)}
        nodeInfo={nodeInfo}
        fileLanguage={fileLanguage}
        evidenceCommit={evidenceCommit(selectedChain)}
        onOpenArchitecture={onOpenArchitecture}
        onOpenWorkflow={canWorkflows ? (laneId) => { setFocusedLaneId(laneId); setShowOutcomes(false); } : undefined}
        onOpenPlan={canPriority ? openPlanAt : undefined}
        onOpenChanges={onOpenChanges}
        onWarning={onWarning}
        attachable={attachable}
        onAttach={async (outcomeId) => {
          const err = await outcomesApi.attachRequirement(outcomeId, selectedRequirement.id);
          if (!err) void trace.refresh();
          return err;
        }}
      />
    );
  };

  // Beside the list: an outcome's rail (AC: a workflow is shaped in the space).
  const outcomeSelected = selection.kind === 'row' && !selection.requirementRowId;
  const rightPane = outcomeSelected ? (
    <ItemRail
      projectId={projectId}
      selection={selection}
      lanes={lanesApi.lanes}
      outcomes={outcomesApi.outcomes}
      graph={graph}
      pending={pending}
      holds={presence.holds}
      canClassify={canClassify}
      outcomesApi={outcomesApi}
      candidateActions={candidateActions}
      onOpenChanges={onOpenChanges}
      onOpenArchitecture={onOpenArchitecture}
      onSelect={setSelection}
      onWarning={onWarning}
      sentences={sentences}
    />
  ) : null;

  // W: what the Workflows tab needs beyond the hooks: the delete through
  // the record's guarded write, the Team proposals count, the doors out.
  const deleteRequirement = useCallback(async (rowId: string) => {
    const ch = chainsById.get(rowId);
    return ch ? writeRequirementRow(ch, { delete: true }, writeDeps) : 'Still reading this requirement.';
  }, [chainsById, writeDeps]);
  const spaceProposals = useMemo(() => {
    const waiting = queue.items.filter((i) => i.pending && (i.kind === 'workflow' || i.kind === 'outcome'));
    return { count: waiting.length, firstId: waiting[0]?.proposalId ?? null };
  }, [queue.items]);
  const openRequirementFromSpace = useCallback((laneId: string, rowId: string) => {
    handleTab('requirements'); setFocusedLaneId(laneId); setShowOutcomes(false);
    setSelection({ kind: 'row', identity: `req:${rowId}`, outcomeId: '', requirementRowId: rowId, stepIndex: 0 });
  }, [handleTab]);
  const openConstraints = useCallback(() => { handleTab('workflows'); setLensRequest({ lens: 'layer', at: Date.now() }); }, [handleTab]);
  const openWorkflowInSpace = useCallback((laneId: string) => { handleTab('workflows'); setLensRequest({ lens: 'journey', at: Date.now(), journeyId: laneId }); }, [handleTab]);

  return (
    <div
      data-testid="work-surface"
      className="ns-work"
      style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px',
        padding: `${layout.contentTop}px ${phone ? 14 : 24}px ${phone ? 16 : 24}px`,
        backgroundColor: c.background, overflowY: 'auto', position: 'relative', fontFamily: 'inherit', fontSize: '14px',
      }}
    >
      {/* Scoped chrome the inline-style system cannot express: themed
          placeholders (the UA default ignores dark mode) and the presence pulse. */}
      <style>{`
        .ns-work input::placeholder, .ns-work textarea::placeholder { color: ${c.textSecondary}; opacity: .65; }
        .ns-work select, .ns-work option { color-scheme: ${theme.mode}; }
        @keyframes nsPulse { 0%, 100% { opacity: .4 } 50% { opacity: 1 } }
      `}</style>
      {(banner || withheld) && (
        <div data-testid="classification-banner" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', height: '22px', borderRadius: '6px', backgroundColor: c.warning, ...eyebrow('#12151f'), letterSpacing: '.12em' }}>
          {banner && <span>{banner}</span>}
          {withheld && <span data-testid="classification-withheld" style={{ letterSpacing: '.04em', opacity: .85 }}>· {withheld}</span>}
        </div>
      )}
      {/* Every project-scoped read here short-circuits to an empty list without
          a project id, and none raises. A blank board is indistinguishable
          from an empty project, so say it. */}
      {!projectId && (
        <div data-testid="work-no-project" role="alert" style={{ fontSize: '13px', lineHeight: 1.6, color: c.textSecondary, border: `1px dashed ${c.border}`, borderRadius: '10px', padding: '12px 14px' }}>
          <span style={{ fontWeight: 700, color: c.text }}>No project is loaded, so this view has nothing to read.</span>
          {' '}{canWorkflows ? 'Workflows, outcomes, constraints and requirements are' : 'Outcomes and requirements are'} all read per project. Open or create a project first; nothing here is empty because you have not filled it in.
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0, flexDirection: phone ? 'column' : 'row' }}>
        {activeTab !== 'workflows' && <aside data-testid="work-lanes" data-shape={phone ? 'strip' : 'column'} style={{ width: phone ? '100%' : '220px', flexShrink: 0, display: 'flex', flexDirection: phone ? 'row' : 'column', alignItems: phone ? 'center' : 'stretch', gap: '4px', overflowX: phone ? 'auto' : 'visible', paddingBottom: phone ? '4px' : 0 }}>
          {!phone && <span style={{ ...eyebrow(c.textSecondary), padding: '0 10px 4px' }}>{canWorkflows ? 'Workflows' : 'Requirements'}</span>}
          {lanesApi.error && <span data-testid="work-lanes-error" role="alert" style={{ ...meta(tones.bad), padding: '0 10px 4px' }}>{lanesApi.error}</span>}
          <button type="button" data-testid="work-all" aria-pressed={showAll} onClick={() => focusLane(ALL_REQUIREMENTS)} style={asideRow(showAll)}>
            <span style={{ ...title(showAll ? c.primary : c.text), flex: 1, minWidth: 0 }}>All requirements</span>
            {count(allRows.length)}
          </button>
          {canWorkflows && lanesApi.lanes.map((l) => (
            <button key={l.id} type="button" data-testid="work-lane" aria-pressed={lane?.id === l.id} onClick={() => focusLane(l.id)} style={asideRow(lane?.id === l.id)}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: l.color ?? c.primary, flexShrink: 0 }} />
              <span style={{ ...title(lane?.id === l.id ? c.primary : c.text), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
              {count(counts.get(l.id) ?? 0)}
            </button>
          ))}
          {(imported.items.length > 0 || showImported) && (
            <button type="button" data-testid="work-imported" aria-pressed={showImported} onClick={() => focusLane(IMPORTED_LANE)} style={asideRow(showImported)}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: showImported ? c.primary : c.textSecondary, opacity: showImported ? 1 : .55, flexShrink: 0 }} />
              <span style={{ ...title(showImported ? c.primary : c.text), flex: 1, minWidth: 0 }}>Imported</span>
              {count(imported.undecided)}
            </button>
          )}
          {activeTab === 'plan' && !phone && <PlanLegend />}
        </aside>}

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Q: one tab below Indie is no choice at all, so no tab bar. */}
          {tabs.length > 1 && (
            <div role="tablist" aria-label="Work" style={{ display: 'flex', gap: '4px', alignSelf: 'flex-start', padding: '4px', borderRadius: '10px', backgroundColor: c.surface, border: `1px solid ${c.border}66` }}>
              {tabs.map((t) => (
                <button key={t} role="tab" aria-selected={activeTab === t} aria-label={WORK_TAB_LABEL[t]} onClick={() => handleTab(t)} style={tabButton(t)}>
                  {WORK_TAB_LABEL[t]}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'workflows' && workflowsViewOnly && <ViewOnlyNote feature="workflow_space" />}
          {activeTab === 'plan' && planViewOnly && <ViewOnlyNote feature="priority_board" />}
          {activeTab === 'workflows' ? (
            <div role="tabpanel" aria-label="Workflows" data-tour="work-workflows" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <Suspense fallback={<div data-testid="workflows-loading" style={{ flex: 1, minHeight: '560px', borderRadius: '14px', background: theme.mode === 'dark' ? '#0a0c13' : '#f3f4f8' }} />}>
                <WorkflowsSpace
                  projectId={projectId}
                  graph={graph}
                  lanesApi={lanesApi}
                  outcomesApi={outcomesApi}
                  constraintsApi={constraintsApi}
                  requirements={requirementsById}
                  chains={chainsById}
                  planSets={planSets}
                  filesByReq={filesByReq}
                  candidateActions={candidateActions}
                  onDeleteRequirement={deleteRequirement}
                  team={variant === 'team'}
                  proposals={spaceProposals}
                  onOpenChanges={onOpenChanges}
                  onOpenRequirement={openRequirementFromSpace}
                  onOpenArchitecture={onOpenArchitecture}
                  lensRequest={lensRequest}
                  mode={theme.mode}
                  sentences={sentences}
                  firstSentenceId={firstSentenceId}
                  constraintReach={reach}
                  requirementRows={requirementRows}
                  viewOnly={workflowsViewOnly}
                />
              </Suspense>
            </div>
          ) : activeTab === 'requirements' ? (
            <div data-tour="work-requirements" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexDirection: phone ? 'column' : 'row', minHeight: 0 }}>
              <RequirementsList
                mode={listMode}
                loading={lanesApi.loading || bandApi.loading}
                selection={selection}
                onSelect={setSelection}
                vision={visionApi}
                hasProject={!!projectId}
                onCreateRequirement={projectId ? createRequirement : undefined}
                onAddProjectOutcome={projectId && !canWorkflows ? addProjectOutcome : undefined}
                chainLine={allChainLine}
                sentences={sentences}
                firstSentenceId={firstSentenceId}
                attachable={attachable}
                onOpenChanges={onOpenChanges}
                onShowOutcomes={() => setShowOutcomes((v) => !v)}
                showingOutcomes={showOutcomes}
                outcomeRows={openOutcomeRows}
                onWarning={onWarning}
                nodeLabels={nodeLabels}
                expandedId={selectedRequirement?.id ?? null}
                renderRecord={renderRecord}
                workflowsOn={canWorkflows}
                onOpenConstraints={openConstraints}
                onOpenWorkflow={canWorkflows ? openWorkflowInSpace : undefined}
              />
              {rightPane}
            </div>
          ) : (
            <div role="tabpanel" aria-label="Plan" data-tour="work-plan" style={{ flex: 1, minHeight: 0 }}>
              <PlanTab
                projectId={projectId}
                branchId={branchId}
                holds={presence.holds}
                dataVersion={dataVersion}
                onWarning={onWarning}
                graph={graph}
                requirements={bandApi.rows}
                outcomes={outcomesApi.outcomes}
                board={board}
                testStatus={testStatus}
                rowFilter={laneNodeIds}
                filesOf={filesOf}
                onOpenRequirement={openRequirement}
                onOpenArchitecture={onOpenArchitecture ? () => onOpenArchitecture('') : undefined}
                onTickTask={tickPlanTask}
                diffRequested={diffClock}
                focusItem={planFocus}
                onDecided={planDecided}
                viewOnly={planViewOnly}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export const WorkSurface = memo(WorkSurfaceComponent);
