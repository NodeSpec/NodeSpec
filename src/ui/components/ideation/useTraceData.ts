// V3 P5 (task 5.1): the Trace assembly — one pass, no N+1. Trace is
// assembly, not new data: the chain the tier planes already build
// (assembleTierItems), the task docs already in the graph (parsed with the
// SAME parseTaskDocTasks the server's delta lane uses), test_cases in one
// batched select joined through criterion.testId, bound files with drift
// from the pending git changes, and the lease board for `live`. The
// output is what the grid renders: one row per requirement chain, five
// tier cells, sub-records up/down with the five-state key (trace-state.ts).
import { computeArchivedRowIds } from '../board/derive-status.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { parseTaskDocTasks, taskDocDetails, type ParsedTask } from '../../../../supabase/functions/_shared/task-deltas.js';
import { taskEvidenceDone } from '../../../../supabase/functions/_shared/board-alignment.js';
import { findExistingTestArtifact, planCases, type PlanCase } from '../../../../supabase/functions/_shared/plan-cases.js';
import {
  assembleTierItems,
  type TierItem,
  type TierKey,
  type CandidateItemRow,
  type RequirementItemRow,
  type MappingItemRow,
  type StepMapRow,
} from './useTierItems.js';
import type { WorkflowLane } from './useWorkflowLanes.js';
import type { AgentHold } from './useAgentPresence.js';
import {
  type TraceState,
  TRACE_STATE_WORD,
  criterionTraceState,
  taskTraceState,
  testTraceState,
  artifactTraceState,
  rollupTraceState,
  countTraceStates,
} from './trace-state.js';
import type { VerifySource, StoredCriterion } from './verify-lane.js';

export interface TraceTestRow {
  id: string;
  requirement_id: string;
  test_id: string;
  name: string;
  status: string;
  stale: boolean | null;
  staleness_reason: string | null;
  test_type: string | null;
  framework: string | null;
  artifact_path: string | null;
  source_artifact_ids: string[] | null;
  expected_result: string | null;
  /** AL.27: what the case checks, in the agent's words (report_test_results, update_test_case). */
  description?: string | null;
  updated_at: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TraceTaskRow {
  id: string;
  node_id: string;
  task_key: string;
  display_id: string | null;
  title: string | null;
  done: boolean;
  orphaned: boolean;
  provenance: Record<string, unknown> | null;
}

export interface TraceArtifact {
  id: string;
  nodeId?: string | null;
  path?: string | null;
  kind?: string | null;
  /** AL.29: a test plan's content and its requirementId, for the plan lookup. */
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TraceDerivationRow { candidate_id: string; requirement_row_id: string | null }

/** What a criterion, tick or run says about where it came from (5.3). */
export interface TraceProvenance {
  source: string;
  commitSha?: string;
  actor?: string;
  at?: string;
  testCaseId?: string;
}

export type TraceSubKind = 'criterion' | 'task' | 'test' | 'source' | 'testfile';

export interface TraceSub {
  id: string;
  kind: TraceSubKind;
  title: string;
  /** The right-edge word: state word, a hash, a status. */
  right: string;
  state: TraceState;
  /** Who holds it (task / code leases) — the design's `live` marker. */
  live: string | null;
  provenance: TraceProvenance | null;
  /** Key → value pairs the side panel lists. */
  detail: Array<[string, string]>;
  /** Cross-links: the criterion a task serves / a test binds, the files a test covers. */
  links: string[];
  /** Y: a task a person added by hand (the doc's Added Tasks section). */
  byHand?: boolean;
  /** AL.27: a task's own lines in its doc, under its T# line: the work order's content. */
  body?: string[];
  /** AL.29 (R2): a work order that cites no criterion at all (the scaffold, the
   *  wiring, the final verification): every requirement on its node reads it. */
  citesNone?: true;
}

export interface TraceCard {
  id: string;
  tier: TierKey;
  label: string;
  ref: string | null;
  meta: string;
  live: string | null;
  state: TraceState;
  upLabel: string;
  up: TraceSub[];
  downLabel: string;
  down: TraceSub[];
}

export type TraceRowState = 'DRIFT' | 'COMPLETE' | 'PARTIAL';

export interface TraceRelationRow { from_requirement_id: string; to_requirement_id: string; relation_type: string }

export interface TraceChain {
  id: string;
  reqRowId: string;
  ref: string;
  title: string;
  /** The design's group: several requirements derived from one outcome. */
  groupId: string | null;
  /** AL.13: every outcome behind this requirement, the group's first. */
  originIds: string[];
  groupIndex: number;
  groupSize: number;
  cells: Record<TierKey, TraceCard[]>;
  rowState: TraceRowState;
  state: TraceState;
  counts: Record<TraceState, number>;
  /** 9.8: archived by the human act (archived_at) or by lineage (done AND superseded). Trace keeps it under the Archived filter. */
  archived: boolean;
  /** 9.11: what the verify lane (the requirement detail surface) edits and shows. */
  verify: VerifySource;
  /** AL.29: the requirement's test plan as the shared reader reads it (its cases
   *  and the statements kept for review); null while it has none. */
  plan?: { cases: PlanCase[]; review: string[] } | null;
}

export interface TraceInput {
  items: TierItem[];
  requirements: RequirementItemRow[];
  derivations: TraceDerivationRow[];
  /** 9.8: the authored relations — `expands` decides the lineage archive. */
  relations?: TraceRelationRow[];
  mappings: MappingItemRow[];
  tests: TraceTestRow[];
  taskItems: TraceTaskRow[];
  docTasksByNode: Map<string, DocTask[]>;
  artifacts: TraceArtifact[];
  holds: AgentHold[];
  /** Paths a PENDING git change touched — drift until the card resolves. */
  driftPaths: Set<string>;
}

type CriterionRow = { id?: unknown; text?: unknown; met?: boolean; evidenceStale?: unknown; verification?: string; testId?: string; provenance?: unknown };

const MANUAL_TITLE = /\(manual\)/i;

/** A task as its doc lists it, with the lines written under it (AL.27). */
export type DocTask = ParsedTask & { details?: string[] };

/** A task doc's list, each task with the lines under its T# line (AL.27). */
export function docTasksOf(content: string): DocTask[] {
  const details = taskDocDetails(content);
  return parseTaskDocTasks(content).tasks.map((t) => (t.key && details.get(t.key)?.length ? { ...t, details: details.get(t.key) } : t));
}
const short = (s: string | null | undefined, n = 7) => (s ? s.slice(0, n) : '');

function provenanceOf(v: unknown): TraceProvenance | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.source !== 'string') return null;
  return {
    source: p.source,
    ...(typeof p.commitSha === 'string' ? { commitSha: p.commitSha } : {}),
    ...(typeof p.actor === 'string' ? { actor: p.actor } : {}),
    ...(typeof p.at === 'string' ? { at: p.at } : {}),
    ...(typeof p.testCaseId === 'string' ? { testCaseId: p.testCaseId } : {}),
  };
}

export function provenanceLabel(p: TraceProvenance | null): string {
  if (!p) return 'not ticked';
  return [p.source, p.commitSha ? short(p.commitSha) : null, p.actor ?? null, p.at ? p.at.slice(0, 10) : null].filter(Boolean).join(' · ');
}

/** Rows → chains. Pure; the hook feeds it and the grid renders it. */
export function assembleTrace(input: TraceInput): TraceChain[] {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const holdByRef = new Map<string, AgentHold>();
  for (const h of input.holds) if (h.refId && !h.stale && !holdByRef.has(h.refId)) holdByRef.set(h.refId, h);
  const liveOf = (refId: string | null | undefined) => (refId ? (holdByRef.get(refId)?.holder ?? null) : null);

  // outcome ← requirement, every derivation. AL.13: a requirement can have
  // several outcomes behind it (attach_candidate); every one of them groups
  // it, and the first is the group the row sits under.
  const originsByReq = new Map<string, string[]>();
  const addOrigin = (reqId: string, cand: string) => {
    const list = originsByReq.get(reqId) ?? [];
    if (!list.includes(cand)) originsByReq.set(reqId, [...list, cand]);
  };
  for (const d of input.derivations) if (d.requirement_row_id) addOrigin(d.requirement_row_id, d.candidate_id);
  for (const i of input.items) if (i.tier === 'req') for (const pid of i.parentIds) addOrigin(i.id, pid);
  const originByReq = new Map<string, string>([...originsByReq].map(([reqId, cands]) => [reqId, cands[0]]));
  const reqsByOrigin = new Map<string, string[]>();
  for (const [reqId, cands] of originsByReq) for (const cand of cands) reqsByOrigin.set(cand, [...(reqsByOrigin.get(cand) ?? []), reqId]);

  const nodesByReq = new Map<string, string[]>();
  for (const m of input.mappings) {
    if (!m.requirement_id || !m.node_id || !byId.has(m.node_id)) continue;
    const list = nodesByReq.get(m.requirement_id) ?? [];
    if (!list.includes(m.node_id)) list.push(m.node_id);
    nodesByReq.set(m.requirement_id, list);
  }
  const testsByReq = new Map<string, TraceTestRow[]>();
  for (const t of input.tests) testsByReq.set(t.requirement_id, [...(testsByReq.get(t.requirement_id) ?? []), t]);
  const artifactsByNode = new Map<string, TraceArtifact[]>();
  const artifactById = new Map<string, TraceArtifact>();
  const artifactRecord: Record<string, TraceArtifact> = {};
  for (const a of input.artifacts) {
    artifactById.set(a.id, a);
    artifactRecord[a.id] = a;
    if (a.nodeId) artifactsByNode.set(a.nodeId, [...(artifactsByNode.get(a.nodeId) ?? []), a]);
  }
  const taskStateByNodeKey = new Map<string, TraceTaskRow>();
  for (const t of input.taskItems) taskStateByNodeKey.set(`${t.node_id}::${t.task_key}`, t);
  const testPaths = new Set(input.tests.map((t) => t.artifact_path).filter(Boolean) as string[]);
  const staleTestPaths = new Set(input.tests.filter((t) => t.stale === true).map((t) => t.artifact_path).filter(Boolean) as string[]);
  const coveredByStale = new Set<string>();
  for (const t of input.tests) if (t.stale === true) for (const id of t.source_artifact_ids ?? []) coveredByStale.add(id);

  const chains: TraceChain[] = [];
  const reqRows = input.requirements.slice().sort((a, b) => a.requirement_id.localeCompare(b.requirement_id));
  // 9.7 (owner ruling 2): the outcome tier READS its requirements' states — a
  // settled outcome whose requirement later fails reads fail here, a stale
  // one reads stale — and writes nothing back. Upstream is derived, never
  // written down: the candidate's status is untouched by any evidence.
  const reqStateById = new Map<string, TraceState>();
  for (const req of reqRows) {
    const criteria = (Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : []) as CriterionRow[];
    reqStateById.set(req.id, rollupTraceState(criteria.map((c) => criterionTraceState(c))));
  }
  // 9.8: the archive is ONE rule for every surface (derive-status): the
  // explicit act, or done and superseded by an `expands` relation.
  const archivedIds = computeArchivedRowIds(
    reqRows.map((r) => ({
      id: r.id, status: 'pending',
      acceptanceCriteria: (Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : []) as Array<{ met?: boolean }>,
      archivedAt: r.archived_at ?? null,
    })),
    (input.relations ?? []).map((rel) => ({ fromRequirementId: rel.from_requirement_id, toRequirementId: rel.to_requirement_id, relationType: rel.relation_type })),
  );
  for (const req of reqRows) {
    const reqItem = byId.get(req.id);
    if (!reqItem) continue;
    const originId = originByReq.get(req.id) ?? null;
    const originIds = originsByReq.get(req.id) ?? [];
    const siblings = originId ? (reqsByOrigin.get(originId) ?? [req.id]) : [req.id];
    const criteria = (Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : []) as CriterionRow[];
    const criterionIdOf = (i: number) => `${req.id}:c${i}`;
    const criterionIndexByText = new Map(criteria.map((c, i) => [String(c.text ?? ''), i]));
    const reqTests = testsByReq.get(req.id) ?? [];
    const testByRowId = new Map(reqTests.map((t) => [t.id, t]));

    // req card — up: the criteria.
    const critSubs: TraceSub[] = criteria.map((c, i) => {
      const state = criterionTraceState(c);
      const bound = typeof c.testId === 'string' ? testByRowId.get(c.testId) ?? null : null;
      const prov = provenanceOf(c.provenance);
      return {
        id: criterionIdOf(i), kind: 'criterion', title: `AC${i + 1} · ${String(c.text ?? '')}`,
        right: c.met === true ? (state === 'stale' ? 'stale' : 'met') : c.verification === 'manual' ? 'awaiting approval' : 'unmet',
        state, live: null, provenance: prov,
        detail: [
          ['lane', c.verification === 'manual' ? 'manual — task-doc tick + approved change card' : 'automated — one binding test'],
          ['evidence', bound ? `${bound.test_id} ${bound.name} (${bound.stale ? 'stale' : bound.status})` : c.verification === 'manual' ? 'no test — proven by approval' : 'no binding test yet'],
          ['provenance', provenanceLabel(prov)],
        ],
        links: bound ? [`tc:${bound.id}`] : [],
      };
    });
    const reqCard: TraceCard = {
      id: req.id, tier: 'req', label: req.name, ref: req.requirement_id,
      meta: `${criteria.filter((c) => c.met === true).length}/${criteria.length} criteria met`,
      live: liveOf(req.id), state: rollupTraceState(critSubs.map((s) => s.state)),
      upLabel: 'ACCEPTANCE CRITERIA', up: critSubs, downLabel: '', down: [],
    };

    // AL.13: one card per outcome behind it (outcome_derivations is many to
    // many); each rolls up the requirements it derives.
    const outcomeCards: TraceCard[] = originIds.flatMap((id) => {
      const o = byId.get(id);
      if (!o) return [];
      const sibs = reqsByOrigin.get(id) ?? [req.id];
      return [{
        id: o.id, tier: 'outcome' as const, label: o.label, ref: null,
        meta: sibs.length > 1 ? `derives ${sibs.length} requirements` : o.sub ?? 'outcome',
        live: liveOf(o.id), state: rollupTraceState(sibs.map((r) => reqStateById.get(r) ?? 'open')), upLabel: '', up: [], downLabel: '', down: [],
      }];
    });

    const nodeIds = nodesByReq.get(req.id) ?? [];
    const archCards: TraceCard[] = [];
    const planCards: TraceCard[] = [];
    const codeCards: TraceCard[] = [];
    for (const nodeId of nodeIds) {
      const node = byId.get(nodeId)!;
      archCards.push({
        id: node.id, tier: 'arch', label: node.label, ref: null, meta: node.sub ?? 'node',
        live: null, state: 'ok', upLabel: '', up: [], downLabel: '', down: [],
      });

      // plan card — up: the doc's tasks (state merged by key), down: the requirement's test cases.
      const docTasks = input.docTasksByNode.get(nodeId) ?? [];
      const seen = new Set<string>();
      const taskSubs: TraceSub[] = [];
      const pushTask = (t: { key: string; displayId: string; title: string; done: boolean; orphaned: boolean; serves?: Array<{ reqId: string; text: string }>; provenance: Record<string, unknown> | null; rowId: string | null; added?: boolean; details?: string[] }) => {
        const evidenceDone = taskEvidenceDone({ requirementId: req.requirement_id, criteria: criteria as never, task: t });
        const live = liveOf(t.rowId);
        const manual = MANUAL_TITLE.test(t.title);
        const state = taskTraceState({ done: t.done, evidenceDone, orphaned: t.orphaned, manual, live });
        const served = (t.serves ?? []).filter((s) => s.reqId === req.requirement_id && criterionIndexByText.has(s.text));
        const prov = provenanceOf(t.provenance);
        taskSubs.push({
          id: `task:${nodeId}:${t.key}`, kind: 'task', title: `${t.displayId} · ${t.title}`,
          right: live ? 'in work' : t.done || evidenceDone ? (evidenceDone && !t.done ? 'done · evidence' : 'done') : manual ? 'awaiting action' : t.orphaned ? 'orphaned' : 'open',
          state, live, provenance: prov,
          detail: [
            ['node', node.label],
            ['serves', served.length > 0 ? served.map((s) => `AC${criterionIndexByText.get(s.text)! + 1} — ${s.text}`).join('; ') : '—'],
            ['provenance', provenanceLabel(prov)],
            ['anchor', `t:${t.key} — identity is the title, not the position`],
          ],
          links: served.map((s) => criterionIdOf(criterionIndexByText.get(s.text)!)),
          ...(t.added ? { byHand: true } : {}),
          ...(t.details && t.details.length > 0 ? { body: t.details } : {}),
          ...(!t.orphaned && !(t.serves ?? []).length ? { citesNone: true as const } : {}),
        });
      };
      for (const d of docTasks) {
        if (!d.key) continue;
        seen.add(d.key);
        const state = taskStateByNodeKey.get(`${nodeId}::${d.key}`);
        pushTask({ key: d.key, displayId: d.displayId, title: d.title, done: state?.done ?? d.checked, orphaned: false, serves: d.serves, provenance: state?.provenance ?? null, rowId: state?.id ?? null, added: d.added, details: d.details });
      }
      for (const row of input.taskItems) {
        if (row.node_id !== nodeId || seen.has(row.task_key)) continue;
        pushTask({ key: row.task_key, displayId: row.display_id ?? '', title: row.title ?? row.task_key, done: row.done, orphaned: true, provenance: row.provenance, rowId: row.id });
      }
      const testSubs: TraceSub[] = reqTests.map((t) => {
        const state = testTraceState(t);
        const boundIdx = criteria.findIndex((c) => c.testId === t.id);
        const covers = (t.source_artifact_ids ?? []).map((id) => artifactById.get(id)?.path ?? id);
        return {
          id: `tc:${t.id}`, kind: 'test', title: `${t.test_id} · ${t.name}`,
          right: t.stale ? 'stale' : t.status.replace('_', ' '),
          state, live: null, provenance: null,
          detail: [
            ['type', [t.test_type, t.framework].filter(Boolean).join(' · ') || '—'],
            ['binds', boundIdx >= 0 ? `AC${boundIdx + 1} — ${String(criteria[boundIdx].text ?? '')}` : 'no criterion'],
            ['expects', t.expected_result ?? '—'],
            ['test code', t.artifact_path ?? '—'],
            ['covers', covers.join(', ') || '—'],
            ['last run', `${t.updated_at ? t.updated_at.slice(0, 10) : 'never'}${t.stale && t.staleness_reason ? ` — ${t.staleness_reason}` : ''}`],
          ],
          links: [
            ...(boundIdx >= 0 ? [criterionIdOf(boundIdx)] : []),
            ...(t.artifact_path ? [`af:${t.artifact_path}`] : []),
            ...(t.source_artifact_ids ?? []).map((id) => `af:${artifactById.get(id)?.path ?? id}`),
          ],
        };
      });
      const planLive = taskSubs.find((s) => s.live)?.live ?? null;
      planCards.push({
        id: `plan:${nodeId}`, tier: 'plan', label: `${node.label} · tasks`, ref: null,
        meta: `${taskSubs.filter((s) => s.state === 'ok').length}/${taskSubs.length} done · ${testSubs.length} test case${testSubs.length === 1 ? '' : 's'}`,
        live: planLive, state: rollupTraceState([...taskSubs, ...testSubs].map((s) => s.state)),
        upLabel: 'TASKS', up: taskSubs, downLabel: 'TEST CASES', down: testSubs,
      });

      // code card — up: source files, down: test files (a bound file that a
      // test case names, or the artifact's own kind says so).
      const bound = artifactsByNode.get(nodeId) ?? [];
      const fileSub = (a: TraceArtifact, isTest: boolean): TraceSub => {
        const path = a.path ?? a.id;
        const drift = input.driftPaths.has(path);
        const stale = isTest ? staleTestPaths.has(path) : coveredByStale.has(a.id);
        const live = liveOf(a.id);
        const state = artifactTraceState({ drift, stale, live });
        const runs = reqTests.filter((t) => t.artifact_path === path || (t.source_artifact_ids ?? []).includes(a.id));
        return {
          id: `af:${path}`, kind: isTest ? 'testfile' : 'source', title: path,
          right: live ? 'in work' : drift ? 'drift' : stale ? 'stale' : isTest ? 'test' : 'bound',
          state, live, provenance: null,
          detail: [
            ['kind', [isTest ? 'test' : 'source', a.kind ?? null].filter(Boolean).join(' · ')],
            [isTest ? 'runs' : 'covered by', runs.map((t) => `${t.test_id} ${t.name}`).join(', ') || 'no test references this file'],
            ['state', drift ? 'changed in the repo after the last accepted state — every test covering it is stale upstream' : stale ? 'a run that covers it is stale' : 'bound to the node'],
          ],
          links: runs.map((t) => `tc:${t.id}`),
        };
      };
      // AL.29: a node's task doc and a requirement's test plan are NodeSpec's own
      // documents, not its code.
      const sources = bound.filter((a) => a.kind !== 'test' && !testPaths.has(a.path ?? '') && a.kind !== 'task' && a.kind !== 'test-plan');
      const testFiles = bound.filter((a) => a.kind === 'test' || testPaths.has(a.path ?? ''));
      const sourceSubs = sources.map((a) => fileSub(a, false));
      const testFileSubs = testFiles.map((a) => fileSub(a, true));
      if (sourceSubs.length + testFileSubs.length > 0) {
        codeCards.push({
          id: `code:${nodeId}`, tier: 'code', label: `${node.label} · code`, ref: null,
          meta: `${sourceSubs.length} source · ${testFileSubs.length} test file${testFileSubs.length === 1 ? '' : 's'}${sourceSubs.some((s) => s.right === 'drift') ? ' · drift' : ''}`,
          live: [...sourceSubs, ...testFileSubs].find((s) => s.live)?.live ?? null,
          state: rollupTraceState([...sourceSubs, ...testFileSubs].map((s) => s.state)),
          upLabel: 'SOURCE FILES', up: sourceSubs, downLabel: 'TEST FILES', down: testFileSubs,
        });
      }
    }

    const cells: Record<TierKey, TraceCard[]> = {
      outcome: outcomeCards, req: [reqCard], arch: archCards, plan: planCards, code: codeCards,
    };
    const subStates = [reqCard, ...planCards, ...codeCards].flatMap((c) => [...c.up, ...c.down].map((s) => s.state));
    const state = rollupTraceState(subStates);
    const complete = (['outcome', 'req', 'arch', 'plan', 'code'] as TierKey[]).every((t) => cells[t].length > 0);
    const rowState: TraceRowState = codeCards.some((c) => c.up.some((s) => s.right === 'drift') || c.state === 'stale') ? 'DRIFT' : complete ? 'COMPLETE' : 'PARTIAL';
    const planArtifact = findExistingTestArtifact(artifactRecord, req.requirement_id, req.name, req.id);
    chains.push({
      id: req.id, reqRowId: req.id, ref: req.requirement_id, title: req.name,
      groupId: originId, groupIndex: siblings.indexOf(req.id), groupSize: siblings.length, originIds,
      cells, rowState, state, counts: countTraceStates(subStates),
      archived: archivedIds.has(req.id),
      verify: {
        locked: req.locked === true,
        mark: req.mark ?? null,
        updatedAt: req.updated_at ?? null,
        criteria: criteria.map((c) => ({ ...c, text: String(c.text ?? '') })) as unknown as StoredCriterion[],
        tests: reqTests.map((t) => ({ id: t.id, test_id: t.test_id, name: t.name, status: t.status, stale: t.stale, source: typeof t.metadata?.source === 'string' ? (t.metadata.source as string) : null, testType: t.test_type ?? null, framework: t.framework ?? null, description: t.description ?? null })),
        description: req.description ?? '',
        archivedAt: req.archived_at ?? null,
      },
      plan: planArtifact?.content ? planCases(planArtifact.content) : null,
    });
  }
  return chains;
}

/** The side counts the design shows: "3 done · 1 stale · 2 in work". */
export function traceCountsLabel(counts: Record<TraceState, number>): string {
  return (['ok', 'stale', 'open', 'live', 'fail'] as TraceState[])
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${TRACE_STATE_WORD[s]}`)
    .join(' · ');
}

export interface TraceDataApi {
  chains: TraceChain[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTraceData(
  projectId: string | null | undefined,
  graph: Graph | null,
  lanes: WorkflowLane[],
  holds: AgentHold[],
): TraceDataApi {
  const [rows, setRows] = useState<{
    candidates: CandidateItemRow[]; requirements: RequirementItemRow[]; mappings: MappingItemRow[];
    taskItems: TraceTaskRow[]; stepMaps: StepMapRow[]; derivations: TraceDerivationRow[]; relations: TraceRelationRow[];
    tests: TraceTestRow[]; driftPaths: string[];
  }>({ candidates: [], requirements: [], mappings: [], taskItems: [], stepMaps: [], derivations: [], relations: [], tests: [], driftPaths: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      const supabase = getSupabaseClient();
      // ONE select per table — the tier chain's reads plus Trace's own.
      const [candsRes, specRes, tasksRes, driftRes] = await Promise.all([
        supabase.from('requirement_candidates').select('id, name, description, category, kind, key, status, node_id, criteria, requirement_row_id').eq('project_id', projectId).neq('status', 'dismissed'),
        supabase.from('project_specifications').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('task_items').select('id, node_id, task_key, display_id, title, done, orphaned, provenance').eq('project_id', projectId),
        supabase.from('git_change_events').select('changed_files').eq('project_id', projectId).eq('status', 'pending'),
      ]);
      if (candsRes.error) throw new Error(candsRes.error.message);
      if (tasksRes.error) throw new Error(tasksRes.error.message);
      const candidates = (candsRes.data ?? []) as CandidateItemRow[];
      let requirements: RequirementItemRow[] = [];
      let mappings: MappingItemRow[] = [];
      let relations: TraceRelationRow[] = [];
      let tests: TraceTestRow[] = [];
      if (specRes.data?.id) {
        const [reqsRes, mapsRes, relsRes] = await Promise.all([
          supabase.from('specification_requirements').select('id, requirement_id, name, description, acceptance_criteria, metadata, archived_at, locked, mark, updated_at').eq('specification_id', specRes.data.id),
          supabase.from('specification_mappings').select('requirement_id, node_id').eq('specification_id', specRes.data.id),
          supabase.from('specification_requirement_relations').select('from_requirement_id, to_requirement_id, relation_type').eq('specification_id', specRes.data.id),
        ]);
        if (reqsRes.error) throw new Error(reqsRes.error.message);
        if (mapsRes.error) throw new Error(mapsRes.error.message);
        requirements = (reqsRes.data ?? []) as RequirementItemRow[];
        mappings = (mapsRes.data ?? []) as MappingItemRow[];
        relations = (relsRes.data ?? []) as TraceRelationRow[];
        if (requirements.length > 0) {
          const { data: testRows, error: testErr } = await supabase
            .from('test_cases')
            .select('id, requirement_id, test_id, name, description, status, stale, staleness_reason, test_type, framework, artifact_path, source_artifact_ids, expected_result, updated_at, metadata')
            .in('requirement_id', requirements.map((r) => r.id))
            .is('retired_at', null);
          if (testErr) throw new Error(testErr.message);
          tests = (testRows ?? []) as TraceTestRow[];
        }
      }
      let stepMaps: StepMapRow[] = [];
      let derivations: TraceDerivationRow[] = [];
      if (candidates.length > 0) {
        const [smRes, derRes] = await Promise.all([
          supabase.from('outcome_step_maps').select('candidate_id, step_id').in('candidate_id', candidates.map((c) => c.id)),
          supabase.from('outcome_derivations').select('candidate_id, requirement_row_id').in('candidate_id', candidates.map((c) => c.id)),
        ]);
        stepMaps = (smRes.data ?? []) as StepMapRow[];
        derivations = (derRes.data ?? []) as TraceDerivationRow[];
      }
      const driftPaths: string[] = [];
      for (const e of (driftRes.data ?? []) as Array<{ changed_files: unknown }>) {
        for (const f of Array.isArray(e.changed_files) ? e.changed_files : []) {
          const p = typeof f === 'string' ? f : (f && typeof (f as { path?: unknown }).path === 'string' ? (f as { path: string }).path : null);
          if (p) driftPaths.push(p);
        }
      }
      setRows({ candidates, requirements, mappings, taskItems: (tasksRes.data ?? []) as TraceTaskRow[], stepMaps, derivations, relations, tests, driftPaths });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the trace');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // The task LIST comes from the docs (the A-series doctrine), parsed with
  // the server's own parser and memoized on the doc contents. AL.27: each
  // task carries the lines written under it, so the record shows what the
  // work order says without opening the doc.
  const docTasksByNode = useMemo(() => {
    const byNode = new Map<string, DocTask[]>();
    for (const artifact of Object.values(graph?.artifacts ?? {})) {
      if (artifact.kind !== 'task' || !artifact.content || !artifact.nodeId) continue;
      byNode.set(artifact.nodeId, docTasksOf(artifact.content));
    }
    return byNode;
  }, [graph?.artifacts]);

  const chains = useMemo(() => {
    const items = assembleTierItems({
      candidates: rows.candidates, requirements: rows.requirements, mappings: rows.mappings,
      taskItems: rows.taskItems.map((t) => ({ id: t.id, node_id: t.node_id, display_id: t.display_id, title: t.title ?? t.task_key, done: t.done, orphaned: t.orphaned })),
      stepMaps: rows.stepMaps, graph, lanes,
    });
    return assembleTrace({
      items, requirements: rows.requirements, derivations: rows.derivations, relations: rows.relations, mappings: rows.mappings,
      tests: rows.tests, taskItems: rows.taskItems, docTasksByNode,
      artifacts: Object.values(graph?.artifacts ?? {}) as TraceArtifact[],
      holds, driftPaths: new Set(rows.driftPaths),
    });
  }, [rows, graph, lanes, holds, docTasksByNode]);

  return { chains, loading, error, refresh };
}
