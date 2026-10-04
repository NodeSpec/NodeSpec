// V3 6.1 and 6.2 (owner's ruling 2026-09-21, boards P1 and P1b): the
// Requirements list and the record, pure.
//
// The list is one row per requirement: its ref, its name, one state word
// (Confirmed or Unconfirmed, with the lock beside it) and one proof count.
// On All requirements the rows are every live requirement in ref order; in
// a workflow they group under its steps (the step an outcome is filed on
// is where its requirements show, once, with "also steps a, b" when the
// outcome touches more steps); under Imported they are what the import
// left. Outcomes not yet requirements fold into one line at the bottom of
// All, and show as their own row under a step.
//
// The record is everything one requirement is: description, criteria each
// with the test that proves it, the tasks that serve it (done tick, the
// commit that ticked it, or where it sits in the plan), the tests with
// their expected result, and the code files those tests touch, with an
// "also REQ-nnn" marker where another requirement touches the same file.
// All of it reads the trace chain the app already assembles (useTraceData)
// and the rows the band, the outcomes and the plan already hold. Nothing
// here reads a table, and no sentence is written from a model.
import type { TraceChain, TraceSub } from '../ideation/useTraceData.js';
import type { BandRequirement } from '../ideation/useRequirementBand.js';
import type { Outcome } from '../ideation/useOutcomes.js';
import type { WorkflowLane } from '../ideation/useWorkflowLanes.js';
import { outcomeRows, stepIndicesOf, type StepItem, type StepRequirement, type PendingPromotion } from './steps-model.js';
import type { VisionSentence } from '../../utils/vision-sentences.js';
import { servesLine } from './chain-model.js';

export type RequirementStateWord = 'Confirmed' | 'Unconfirmed';

export interface RequirementListRow {
  id: string;
  ref: string;
  name: string;
  state: RequirementStateWord;
  locked: boolean;
  proven: number;
  total: number;
  /** A test bound to one of its criteria failed: the count draws red. */
  failing: boolean;
  backfilled: boolean;
}

export function stateWordOf(r: Pick<BandRequirement, 'confirmed'>): RequirementStateWord {
  return r.confirmed ? 'Confirmed' : 'Unconfirmed';
}

/** Every live requirement, in ref order. Archived rows never list. */
export function allRequirementRows(rows: readonly BandRequirement[], chains: readonly TraceChain[]): RequirementListRow[] {
  const failByRow = new Map(chains.map((ch) => [ch.reqRowId, ch.counts.fail > 0]));
  return rows
    .filter((r) => !r.archived)
    .slice()
    .sort((a, b) => a.ref.localeCompare(b.ref))
    .map((r) => ({
      id: r.id, ref: r.ref, name: r.name, state: stateWordOf(r), locked: r.locked,
      proven: r.metCount, total: r.criteriaCount, failing: failByRow.get(r.id) ?? false, backfilled: r.backfilled,
    }));
}

/** "15 of 31 criteria proven" over the rows given. */
export function provenLine(rows: ReadonlyArray<Pick<RequirementListRow, 'proven' | 'total'>>): string {
  let proven = 0, total = 0;
  for (const r of rows) { proven += r.proven; total += r.total; }
  return `${proven} of ${total} criteria proven`;
}

export interface OpenOutcomeRow {
  id: string;
  name: string;
  proposalId: string | null;
  live: boolean;
  workflowId: string | null;
  mark: string | null;
}

/** The outcomes that are not yet requirements: the ones the steps model
 *  would still draw as an outcome row (nothing derived yet, or criteria
 *  still unclaimed). Settled and dismissed outcomes are gone; an outcome
 *  fully derived into requirements is those requirements now. Pure. */
export function openOutcomes(
  outcomes: readonly Outcome[],
  requirementsById: ReadonlyMap<string, StepRequirement>,
  pending: ReadonlyMap<string, PendingPromotion>,
): OpenOutcomeRow[] {
  const out: OpenOutcomeRow[] = [];
  for (const o of outcomes) {
    if (o.kind !== 'outcome' || o.status !== 'pending') continue;
    const row = outcomeRows(o, requirementsById, pending).find((r) => r.kind === 'outcome');
    if (!row) continue;
    out.push({ id: o.id, name: o.name, proposalId: row.proposalId, live: o.live, workflowId: o.workflowId, mark: o.mark ?? null });
  }
  return out;
}

/** The All list's last line: how many outcomes are not yet requirements,
 *  and how many of those carry a promotion an agent asked for. Pure. */
export function pendingOutcomesLine(open: readonly OpenOutcomeRow[]): { count: number; proposals: number } {
  return { count: open.length, proposals: open.filter((o) => o.proposalId).length };
}

// ── 6.2: the same rows grouped under a workflow's steps ─────────────────────

export interface GroupedRow extends StepItem {
  /** Other steps of the same workflow the row's outcome is filed on (1-based). */
  alsoSteps: number[];
}

export interface GroupedStep {
  id: string;
  name: string;
  index: number;
  rows: GroupedRow[];
  /** Outcomes filed on this step, shown here or on an earlier step. An
   *  empty step (nothing filed) is the one that offers Add an outcome. */
  filed: number;
}

export interface GroupedView {
  laneId: string;
  name: string;
  steps: GroupedStep[];
  /** Distinct rows in the workflow (a row on two steps counts once). */
  rows: number;
  proven: number;
  total: number;
}

/** One workflow's steps with the rows under them. A row shows once, on the
 *  first step its outcome is filed on, and says which other steps it also
 *  touches. Pure. */
export function groupedView(
  lane: WorkflowLane,
  outcomes: readonly Outcome[],
  requirementsById: ReadonlyMap<string, StepRequirement>,
  pending: ReadonlyMap<string, PendingPromotion> = new Map(),
): GroupedView {
  const seen = new Set<string>();
  let proven = 0, total = 0;
  const steps: GroupedStep[] = lane.steps.map((step, i) => {
    const index = i + 1;
    const rows: GroupedRow[] = [];
    let filed = 0;
    for (const o of outcomes) {
      if (!o.stepIds.includes(step.id)) continue;
      filed += 1;
      const also = stepIndicesOf(lane, o.stepIds).filter((n) => n !== index);
      for (const row of outcomeRows(o, requirementsById, pending)) {
        if (seen.has(row.identity)) continue;
        seen.add(row.identity);
        proven += row.proven; total += row.total;
        rows.push({ ...row, sameAsStep: null, alsoSteps: also });
      }
    }
    return { id: step.id, name: step.name, index, rows, filed };
  });
  return { laneId: lane.id, name: lane.name, steps, rows: seen.size, proven, total };
}

/** "6 steps · 11 of 24 criteria proven" */
export function groupedHeaderLine(view: Pick<GroupedView, 'steps' | 'proven' | 'total'>): string {
  const n = view.steps.length;
  return `${n} step${n === 1 ? '' : 's'} · ${view.proven} of ${view.total} criteria proven`;
}

/** "also steps 5, 6" · "also step 5" · null */
export function alsoStepsLine(also: readonly number[]): string | null {
  if (also.length === 0) return null;
  return `also step${also.length === 1 ? '' : 's'} ${also.join(', ')}`;
}

// ── the record ──────────────────────────────────────────────────────────────

export interface RecordCriterion {
  id: string;
  text: string;
  met: boolean;
  verification: 'automated' | 'manual';
  /** The bound test's TC id, when a test proves it. */
  testRef: string | null;
  /** The bound test's row id, for the trace between the two sections. */
  testRowId: string | null;
  /** The bound test failed: the dot draws red. */
  failing: boolean;
}

export interface RecordTask {
  /** `task:<node>:<key>`: the plan's own id for the same item. */
  id: string;
  displayId: string;
  title: string;
  done: boolean;
  /** The commit that ticked it, short. */
  commit: string | null;
  /** Where an open task sits in the plan (Set N), when the plan knows it. */
  planSet: number | null;
  /** An agent holds it now. */
  live: string | null;
  /** Y: a person added it by hand; the rest are the agent's work orders. */
  byHand: boolean;
}

export interface RecordTest {
  rowId: string;
  testId: string;
  name: string;
  /** passed, failed, running, skipped, not started, stale. */
  status: string;
  expected: string | null;
  path: string | null;
  /** The criterion it is bound to, as the record numbers them ("AC2"); null while unbound. */
  criterion: string | null;
  /** 'manual' when the person added it in Work (bound to its criterion at creation). */
  source: 'manual' | null;
  /** The case's type (unit, integration, e2e) and framework, when it names them. */
  type: string | null;
  framework: string | null;
}

export interface RecordFile {
  path: string;
  /** The tests that run in or cover this file, by TC id; empty for a bound source no test names. */
  touchedBy: string[];
  /** Other requirements whose tests or tasks touch the same file. */
  also: string[];
  isTest: boolean;
}

export interface RequirementRecordView {
  ref: string;
  name: string;
  description: string;
  state: RequirementStateWord;
  locked: boolean;
  proven: number;
  total: number;
  criteria: RecordCriterion[];
  /** The tasks that serve this requirement (a serves-line names one of its criteria). */
  tasks: RecordTask[];
  /** How many tasks the serving nodes hold in all: "3 of S03's 8 serve this". */
  nodeTaskTotal: number;
  nodeLabel: string | null;
  tests: RecordTest[];
  files: RecordFile[];
  nodes: Array<{ id: string; label: string }>;
  /** The workflow and step the first deriving outcome is filed on, when any. */
  step: { laneId: string; laneName: string; index: number } | null;
  /** AL.13: every workflow and stage any deriving outcome is filed on, the
   *  first one first; a requirement derived from outcomes in two workflows
   *  sits in both. */
  steps: Array<{ laneId: string; laneName: string; index: number }>;
  /** Where it came from: the first outcome that derived it, or the import.
   *  AA.1: the outcome's line on the vision sentence it serves rides along. */
  origin: { kind: 'outcome'; outcomeId: string; name: string; by: 'human' | 'agent'; at: string; serves: string } | { kind: 'import' } | null;
  /** AL.13: every outcome that derived it (outcome_derivations is many to
   *  many: attach_candidate puts a second outcome behind one requirement),
   *  oldest first. `origin` is the first of these. */
  origins: RecordOrigin[];
}

export interface RecordOrigin {
  outcomeId: string;
  name: string;
  by: 'human' | 'agent';
  at: string;
  serves: string;
  /** The outcome's home workflow and first stage, when it is filed on one. */
  step: { laneId: string; laneName: string; index: number } | null;
}

const short = (s: string | null | undefined, n = 7) => (s ? s.slice(0, n) : null);

/** The item id `task:<node>:<key>` → the 1-based set it sits in, from the
 *  plan's layers (Set N is layer N + 1). */
export function planSetsOf(items: ReadonlyArray<{ id: string; layer: number; done: boolean }> | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items ?? []) if (!it.done) out.set(it.id, it.layer + 1);
  return out;
}

/** path → the refs of every requirement whose tests or code cells touch it,
 *  over all chains: what the record's "also REQ-nnn" reads. Pure. */
export function filesByRequirement(chains: readonly TraceChain[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const ch of chains) {
    for (const p of chainFilePaths(ch)) {
      const set = out.get(p) ?? new Set<string>();
      set.add(ch.ref);
      out.set(p, set);
    }
  }
  return out;
}

/** The files one chain touches: its tests' own files and the files they
 *  cover; the node's bound sources only when a test names them (a node's
 *  whole file list is the Architecture rail's, not the requirement's).
 *  6.3: the Plan rail's Code section reads the same list per item. */
export function chainFilePaths(ch: TraceChain): string[] {
  const paths = new Set<string>();
  for (const plan of ch.cells.plan) {
    for (const t of plan.down) for (const l of t.links) if (l.startsWith('af:')) paths.add(l.slice(3));
  }
  return [...paths];
}

const TEST_LINK = /^tc:(.+)$/;

export function recordOf(
  chain: TraceChain,
  input: {
    requirement: Pick<BandRequirement, 'confirmed' | 'backfilled' | 'metCount' | 'criteriaCount'>;
    outcomes: readonly Outcome[];
    lanes: readonly WorkflowLane[];
    planSets?: ReadonlyMap<string, number>;
    filesByReq?: ReadonlyMap<string, ReadonlySet<string>>;
    /** AA.1: the vision's sentences, for the origin's serves line. */
    sentences?: readonly VisionSentence[];
  },
): RequirementRecordView {
  const testSubs: TraceSub[] = chain.cells.plan.flatMap((p) => p.down);
  const testByRowId = new Map(chain.verify.tests.map((t) => [t.id, t]));
  const testSubByRowId = new Map(testSubs.map((s) => [s.id.replace(TEST_LINK, '$1'), s]));

  const criteria: RecordCriterion[] = chain.verify.criteria.map((c, i) => {
    const bound = typeof c.testId === 'string' ? testByRowId.get(c.testId) ?? null : null;
    return {
      id: typeof c.id === 'string' && c.id ? c.id : `c${i + 1}`,
      text: c.text,
      met: c.met === true,
      verification: c.verification === 'manual' ? 'manual' : 'automated',
      testRef: bound?.test_id ?? null,
      testRowId: bound?.id ?? null,
      failing: bound?.status === 'failed',
    };
  });

  // Tasks: the plan cards' up subs, one per task on a serving node; the
  // ones that serve this requirement carry a criterion link.
  const tasks: RecordTask[] = [];
  let nodeTaskTotal = 0;
  const seenTasks = new Set<string>();
  for (const plan of chain.cells.plan) {
    for (const t of plan.up) {
      if (seenTasks.has(t.id)) continue;
      seenTasks.add(t.id);
      nodeTaskTotal += 1;
      if (t.links.length === 0) continue;
      const [displayId, ...rest] = t.title.split(' · ');
      tasks.push({
        id: t.id, displayId: displayId ?? '', title: rest.join(' · ') || t.title,
        done: t.state === 'ok' || t.right === 'done' || t.right === 'done · evidence',
        commit: short(t.provenance?.commitSha),
        planSet: input.planSets?.get(t.id) ?? null,
        live: t.live,
        byHand: t.byHand === true,
      });
    }
  }

  const tests: RecordTest[] = chain.verify.tests.map((t) => {
    const sub = testSubByRowId.get(t.id) ?? null;
    const expects = sub?.detail.find(([k]) => k === 'expects')?.[1] ?? null;
    const path = sub?.detail.find(([k]) => k === 'test code')?.[1] ?? null;
    const boundIdx = chain.verify.criteria.findIndex((c) => c.testId === t.id);
    return {
      rowId: t.id, testId: t.test_id, name: t.name,
      status: t.stale ? 'stale' : t.status.replace('_', ' '),
      expected: expects && expects !== '—' ? expects : null,
      path: path && path !== '—' ? path : null,
      criterion: boundIdx >= 0 ? `AC${boundIdx + 1}` : null,
      source: t.source === 'manual' ? 'manual' : null,
      type: t.testType ?? null,
      framework: t.framework ?? null,
    };
  });

  // Code: the test files and the files those tests cover, each with the
  // TC ids touching it and the other requirements on the same path.
  const touched = new Map<string, { tests: Set<string>; isTest: boolean }>();
  for (const s of testSubs) {
    const tc = s.title.split(' · ')[0];
    for (const l of s.links) {
      if (!l.startsWith('af:')) continue;
      const path = l.slice(3);
      const entry = touched.get(path) ?? { tests: new Set<string>(), isTest: false };
      entry.tests.add(tc);
      const own = s.detail.find(([k]) => k === 'test code')?.[1];
      if (own === path) entry.isTest = true;
      touched.set(path, entry);
    }
  }
  const files: RecordFile[] = [...touched.entries()]
    .sort((a, b) => Number(a[1].isTest) - Number(b[1].isTest) || a[0].localeCompare(b[0]))
    .map(([path, e]) => ({
      path, isTest: e.isTest,
      touchedBy: [...e.tests].sort(),
      also: [...(input.filesByReq?.get(path) ?? [])].filter((r) => r !== chain.ref).sort(),
    }));

  const nodes = chain.cells.arch.map((n) => ({ id: n.id, label: n.label }));

  // AL.13: every outcome that derived it, oldest first; the first is the
  // origin the record leads with. Each carries its home workflow and the
  // first stage it is filed on; the record lists every stage any of them
  // sits on, so a requirement shared across workflows reads as being in all.
  const origins: RecordOrigin[] = [];
  const steps: RequirementRecordView['steps'] = [];
  const seenStep = new Set<string>();
  for (const o of input.outcomes) {
    const d = o.derivations.find((x) => x.requirementRowId === chain.reqRowId);
    if (!d) continue;
    let home: RecordOrigin['step'] = null;
    for (const lane of input.lanes) {
      for (const idx of stepIndicesOf(lane, o.stepIds)) {
        const key = `${lane.id}:${idx}`;
        if (seenStep.has(key)) continue;
        seenStep.add(key);
        steps.push({ laneId: lane.id, laneName: lane.name, index: idx });
      }
      if (lane.id === o.workflowId) {
        const idx = stepIndicesOf(lane, o.stepIds)[0] ?? null;
        if (idx !== null) home = { laneId: lane.id, laneName: lane.name, index: idx };
      }
    }
    origins.push({ outcomeId: o.id, name: o.name, by: d.proposedByKind, at: d.createdAt, serves: servesLine(o, input.sentences ?? []), step: home });
  }
  const origin = origins[0] ?? null;
  const step = origin?.step ?? null;

  return {
    ref: chain.ref, name: chain.title, description: chain.verify.description,
    state: stateWordOf(input.requirement), locked: chain.verify.locked,
    proven: input.requirement.metCount, total: input.requirement.criteriaCount,
    criteria, tasks, nodeTaskTotal, nodeLabel: nodes[0]?.label ?? null, tests, files, nodes, step, steps,
    origin: origin
      ? { kind: 'outcome', outcomeId: origin.outcomeId, name: origin.name, by: origin.by, at: origin.at, serves: origin.serves }
      : input.requirement.backfilled ? { kind: 'import' } : null,
    origins,
  };
}

/** AL.13: the origin line for a requirement with several outcomes behind it:
 *  'From the outcomes "A", "B" and "C", derived by you.' (or from agents'
 *  proposals, or both). One outcome, or none, reads as originLineOf. Pure. */
export function originsLineOf(record: Pick<RequirementRecordView, 'origin' | 'origins'>): string | null {
  if (record.origins.length <= 1) return originLineOf(record.origin);
  const names = record.origins.map((o) => `"${o.name}"`);
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const human = record.origins.some((o) => o.by === 'human');
  const agent = record.origins.some((o) => o.by === 'agent');
  const by = human && agent ? "derived by you and from agents' proposals" : agent ? "derived from agents' proposals" : 'derived by you';
  return `From the outcomes ${list}, ${by}.`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "From the outcome "X", derived by godot-level-agent's proposal, 11 Sep."
 *  · "Read out of the repository by the import." · null. Pure. */
export function originLineOf(origin: RequirementRecordView['origin']): string | null {
  if (!origin) return null;
  if (origin.kind === 'import') return 'Read out of the repository by the import.';
  const d = new Date(origin.at);
  const when = Number.isNaN(d.getTime()) ? '' : `, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `From the outcome "${origin.name}", ${origin.by === 'agent' ? "derived from an agent's proposal" : 'derived by you'}${when}.`;
}

/** "3 of S03's 8 serve this" · "3 tasks serve this" · "No task serves this yet". Pure. */
export function tasksLine(record: Pick<RequirementRecordView, 'tasks' | 'nodeTaskTotal' | 'nodeLabel'>): string {
  const n = record.tasks.length;
  if (n === 0) return 'No task serves this yet';
  if (record.nodeLabel && record.nodeTaskTotal > n) return `${n} of ${record.nodeLabel}'s ${record.nodeTaskTotal} serve this`;
  return `${n} task${n === 1 ? '' : 's'} serve${n === 1 ? 's' : ''} this`;
}

/** M.1 (owner's report 2026-09-22): what a row's brake MEANS for an agent.
 *  The ladder is V3 2.4's, and until now the app showed the two words
 *  ("Confirmed", "Locked") without ever saying what they buy, so Confirm
 *  read as decoration. Open rows follow the lane's Autonomy level; a
 *  confirmed row turns an agent's apply into a proposal (change-router
 *  `effectiveRoute`); a locked row refuses every write but the unlock and
 *  evidence. */
export function rowBrakeLine(confirmed: boolean, locked: boolean): string {
  if (locked) return 'Locked: an agent cannot change this. Evidence still lands, and only you unlock it.';
  if (confirmed) return "Confirmed: an agent's edit comes back as a proposal for you to decide.";
  return "Open: an agent's edit follows your Autonomy setting for requirements.";
}
