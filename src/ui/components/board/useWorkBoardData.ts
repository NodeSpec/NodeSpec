// D1 (docs/WORK_LOOP_PLAN.md): the board's ONE data assembly — every
// projection (D3 canvas table, D2 BOARD.md) renders rows this hook shapes,
// so surfaces cannot diverge.
//
// NO N+1: the spec plane arrives through the two EXISTING realtime hooks
// (useRealtimeSpecification, useRealtimeMappings); tests are ONE batched
// test_cases select for the whole requirement set; task state is ONE batched
// task_items select for the project; and the task LIST derives from the task
// docs already sitting in the graph — parsed with the SAME
// parseTaskDocTasks the server's delta lane uses (a direct cross-runtime
// import, so client and server can never read a doc differently), memoized
// on the artifact contents.
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { useRealtimeSpecification } from '../../hooks/useRealtimeSpecification.js';
import { useRealtimeMappings } from '../../hooks/useRealtimeMappings.js';
import type { Requirement } from '../../../persistence/supabase/requirements-repository.js';
import type { SpecificationSection } from '../../../persistence/supabase/sections-repository.js';
import { computeArchivedLineage, findTestPlanArtifact } from '../spec-v3/scale.js';
import { parseTaskDocTasks } from '../../../../supabase/functions/_shared/task-deltas.js';
import { deriveWorkStatus, type WorkStatusResult } from './derive-status.js';
import { alignCriterionLanes, taskEvidenceDone, type AlignedLanes } from '../../../../supabase/functions/_shared/board-alignment.js';

export interface WorkBoardTask {
  nodeId: string;
  key: string;
  displayId: string;
  title: string;
  done: boolean;
  orphaned: boolean;
  provenance: Record<string, unknown> | null;
  /** D3 alignment: criteria this work order serves (from the doc's ↳ lines). */
  serves?: Array<{ reqId: string; text: string }>;
  /** Owner refinement 2026-09-01: `done` was DERIVED from criterion evidence
   *  (every served criterion met, evidence fresh) — no tick recorded. Display
   *  state only; the tick lane and task_items are untouched. */
  evidenceDone: boolean;
}

export interface WorkBoardTestSummary {
  total: number;
  passed: number;
  failed: number;
  stale: number;
}

export interface WorkBoardRow {
  requirement: Requirement;
  archived: boolean;
  nodes: Array<{ id: string; label: string }>;
  tests: WorkBoardTestSummary;
  /** D3 refinement: per-case detail for the row expansion — the same third
   *  lane BOARD.md's Tests section renders. Read-only (tests flip via
   *  report_test_results, never here). */
  testCases: Array<{ rowId?: string; testId: string; name: string; status: string; stale: boolean }>;
  /** The requirement's test-plan artifact path, when one exists. */
  planPath: string | null;
  tasks: WorkBoardTask[];
  /** D3 refinement 2: per-criterion lateral lanes — the SAME
   *  alignCriterionLanes BOARD.md renders from (exact linkage only:
   *  serves-lines for tasks, criterion.testId for tests). */
  alignment: AlignedLanes;
  status: WorkStatusResult;
}

interface TestCaseRow {
  id: string;
  requirement_id: string;
  test_id: string;
  name: string;
  status: string;
  stale: boolean | null;
}

interface TaskItemRow {
  node_id: string;
  task_key: string;
  done: boolean;
  orphaned: boolean;
  display_id: string | null;
  title: string | null;
  provenance: Record<string, unknown> | null;
}

const EMPTY_TESTS: WorkBoardTestSummary = { total: 0, passed: 0, failed: 0, stale: 0 };

export function useWorkBoardData(args: {
  projectId: string | null;
  specificationId: string | null;
  graph: Graph;
}): {
  rows: WorkBoardRow[];
  sections: SpecificationSection[];
  loading: boolean;
  refresh: () => void;
} {
  const spec = useRealtimeSpecification(args.specificationId);
  const maps = useRealtimeMappings(args.specificationId);
  const [testRows, setTestRows] = useState<TestCaseRow[]>([]);
  const [taskItemRows, setTaskItemRows] = useState<TaskItemRow[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const requirementIdsKey = useMemo(
    () => spec.requirements.map((r) => r.id).sort().join(','),
    [spec.requirements],
  );

  // ONE batch per table, for the whole board.
  useEffect(() => {
    if (!args.projectId || spec.requirements.length === 0) {
      setTestRows([]);
      setTaskItemRows([]);
      return;
    }
    let cancelled = false;
    setBatchesLoading(true);
    const supabase = getSupabaseClient();
    void (async () => {
      try {
        const [tests, tasks] = await Promise.all([
          supabase
            .from('test_cases')
            .select('id, requirement_id, test_id, name, status, stale')
            .in('requirement_id', requirementIdsKey.split(','))
            .is('retired_at', null),
          supabase
            .from('task_items')
            .select('node_id, task_key, done, orphaned, display_id, title, provenance')
            .eq('project_id', args.projectId),
        ]);
        if (cancelled) return;
        setTestRows((tests.data as TestCaseRow[]) ?? []);
        setTaskItemRows((tasks.data as TaskItemRow[]) ?? []);
      } finally {
        if (!cancelled) setBatchesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [args.projectId, requirementIdsKey, refreshTick]);

  // The task LIST comes from the docs (the A-series doctrine: docs derive the
  // list, task_items holds only state). Memoized on the doc contents.
  const docTasksByNode = useMemo(() => {
    const byNode = new Map<string, ReturnType<typeof parseTaskDocTasks>['tasks']>();
    for (const artifact of Object.values(args.graph.artifacts ?? {})) {
      if (artifact.kind !== 'task' || !artifact.content || !artifact.nodeId) continue;
      byNode.set(artifact.nodeId, parseTaskDocTasks(artifact.content).tasks);
    }
    return byNode;
  }, [args.graph.artifacts]);

  const rows = useMemo<WorkBoardRow[]>(() => {
    const lineage = computeArchivedLineage(spec.requirements, spec.relations);
    const testsByReq = new Map<string, WorkBoardTestSummary>();
    const casesByReq = new Map<string, Array<{ rowId: string; testId: string; name: string; status: string; stale: boolean }>>();
    for (const t of testRows) {
      const bucket = testsByReq.get(t.requirement_id) ?? { total: 0, passed: 0, failed: 0, stale: 0 };
      bucket.total += 1;
      if (t.status === 'passed') bucket.passed += 1;
      if (t.status === 'failed') bucket.failed += 1;
      if (t.stale === true) bucket.stale += 1;
      testsByReq.set(t.requirement_id, bucket);
      const cases = casesByReq.get(t.requirement_id) ?? [];
      cases.push({ rowId: t.id, testId: t.test_id, name: t.name, status: t.status, stale: t.stale === true });
      casesByReq.set(t.requirement_id, cases);
    }
    const stateByNodeKey = new Map<string, TaskItemRow>();
    for (const row of taskItemRows) stateByNodeKey.set(`${row.node_id}::${row.task_key}`, row);

    return spec.requirements.map((requirement) => {
      const mappings = maps.mappingsByRequirement.get(requirement.id) ?? [];
      const nodes = mappings
        .map((m) => ({ id: m.nodeId, label: args.graph.nodes?.[m.nodeId]?.label ?? m.nodeId.slice(0, 8) }))
        .filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i);

      // Tasks for this requirement = the mapped nodes' doc tasks, with DB
      // state (done/provenance) merged by stable key; orphaned DB rows whose
      // key the doc no longer emits still count (evidence never vanishes).
      const criteria = requirement.acceptanceCriteria ?? [];
      const withEvidence = (t: Omit<WorkBoardTask, 'evidenceDone'>): WorkBoardTask => ({
        ...t,
        // Owner refinement 2026-09-01: evidence-derived completion — the same
        // shared rule BOARD.md renders with (display only, never written).
        evidenceDone: taskEvidenceDone({ requirementId: requirement.requirementId, criteria, task: t }),
      });
      const tasks: WorkBoardTask[] = [];
      for (const node of nodes) {
        const seen = new Set<string>();
        for (const docTask of docTasksByNode.get(node.id) ?? []) {
          if (!docTask.key) continue;
          seen.add(docTask.key);
          const state = stateByNodeKey.get(`${node.id}::${docTask.key}`);
          tasks.push(withEvidence({
            nodeId: node.id,
            key: docTask.key,
            displayId: docTask.displayId,
            title: docTask.title,
            done: state?.done ?? docTask.checked,
            orphaned: false,
            provenance: state?.provenance ?? null,
            ...(docTask.serves ? { serves: docTask.serves } : {}),
          }));
        }
        for (const row of taskItemRows) {
          if (row.node_id !== node.id || seen.has(row.task_key)) continue;
          tasks.push(withEvidence({
            nodeId: node.id,
            key: row.task_key,
            displayId: row.display_id ?? '',
            title: row.title ?? row.task_key,
            done: row.done,
            orphaned: true,
            provenance: row.provenance ?? null,
          }));
        }
      }

      const tests = testsByReq.get(requirement.id) ?? EMPTY_TESTS;
      const testCases = [...(casesByReq.get(requirement.id) ?? [])].sort((a, b) => a.testId.localeCompare(b.testId));
      // Same match rule as the server board + freshness lane (client mirror).
      const planPath = findTestPlanArtifact(
        (args.graph.artifacts ?? {}) as Record<string, { kind: string; path?: string; metadata?: Record<string, unknown> | null }>,
        requirement.requirementId,
        requirement.name,
      )?.path ?? null;
      const nodeLabelById = new Map(nodes.map((n) => [n.id, n.label]));
      const alignment = alignCriterionLanes({
        requirementId: requirement.requirementId,
        criteria: (requirement.acceptanceCriteria ?? []).map((ac) => ({ text: ac.text, testId: ac.testId })),
        tasks: tasks.map((t) => ({
          displayId: t.displayId,
          title: t.title,
          done: t.done || t.evidenceDone,
          evidenceDone: t.evidenceDone,
          nodeLabel: nodeLabelById.get(t.nodeId) ?? t.nodeId.slice(0, 8),
          serves: t.serves,
        })),
        tests: testCases,
      });
      const archived = lineage.archivedRowIds.has(requirement.id);
      const status = deriveWorkStatus({
        archived,
        requirementStatus: requirement.status,
        criteria: requirement.acceptanceCriteria ?? [],
        tests,
        tasks: { total: tasks.length, done: tasks.filter((t) => t.done || t.evidenceDone).length },
      });
      return { requirement, archived, nodes, tests, testCases, planPath, tasks, alignment, status };
    });
  }, [spec.requirements, spec.relations, maps.mappingsByRequirement, testRows, taskItemRows, docTasksByNode, args.graph.nodes]);

  return {
    rows,
    sections: spec.sections,
    loading: spec.loading || maps.loading || batchesLoading,
    refresh,
  };
}
