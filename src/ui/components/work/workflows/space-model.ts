// W (owner 2026-09-23): the Workflows space, held to the approved mockup
// (workflow-space.html, v9). This module is the whole read side of it and
// reads no table: it folds what Work already holds (lanes and steps, the
// outcomes with their step maps and derivations, the requirement band, the
// trace chains, the constraints, the graph) into the shape the strip, the
// 3D columns and the inspector draw.
//
// A column is a stage (workflow_steps). Under it, top to bottom:
//   Outcome       requirement_candidates kind outcome mapped to the stage
//                 (outcome_step_maps); the same outcome can sit on steps of
//                 other workflows too, and those are its "also on"
//   Requirement   each requirement the outcome derived (outcome_derivations)
//   Architecture  the first node the requirement is mapped to
//   Code          the file its tests run in or cover, with the commit the
//                 evidence was stamped with
//
// States, in the mockup's words:
//   an outcome    not built (nothing derived from it), being built (a
//                 requirement under it is not yet proven), ready to close
//                 (every requirement proven, not yet settled), done
//                 (settled, and every requirement proven)
//   a stage       reads as the worst outcome on it; no outcome is its own
//                 state
import type { Graph } from '@nodespec/core/types.js';
import { rehomePlan, type WorkflowLane } from '../../ideation/useWorkflowLanes.js';
import type { Outcome } from '../../ideation/useOutcomes.js';
import type { BandRequirement } from '../../ideation/useRequirementBand.js';
import type { TraceChain } from '../../ideation/useTraceData.js';
import type { ConstraintRow } from '../../ideation/useConstraints.js';
import { describeScope, type ScopeKind } from '../../../../../supabase/functions/_shared/constraint-rules.js';
import { recordOf, chainFilePaths, type RequirementRecordView } from '../requirements-model.js';
import { initialsOf as rosterInitials } from '../../ideation/agent-roster.js';

/** X (owner 2026-09-23): the space follows the app's light or dark setting. */
export type SpaceMode = 'dark' | 'light';

export interface SpaceHues {
  outcome: string; requirement: string; node: string; artifact: string;
  proven: string; open: string; gap: string; bad: string; accent: string;
}

/** The chain's hues on the dark ground, verbatim from the mockup. */
export const SPACE_COLOR: SpaceHues = {
  outcome: '#8B8FE6', requirement: '#5aa9e6', node: '#5fd39a', artifact: '#c07ae0',
  proven: '#4ade80', open: '#fbbf24', gap: '#6b7398', bad: '#f87171', accent: '#8B8FE6',
};

/** The same hues on the light ground: deep enough to read as text on white.
 *  Proven, open and not built are the app's own light inks (status-tones). */
export const SPACE_COLOR_LIGHT: SpaceHues = {
  outcome: '#5a5fd0', requirement: '#2b7bbd', node: '#1f8a5c', artifact: '#9a4fc7',
  proven: '#1f7d52', open: '#8a5a12', gap: '#6b7390', bad: '#a93b43', accent: '#5a5fd0',
};

export function hues(mode: SpaceMode = 'dark'): SpaceHues {
  return mode === 'light' ? SPACE_COLOR_LIGHT : SPACE_COLOR;
}

export type OutcomeState = 'unimpl' | 'open' | 'ready' | 'done';
export type StageState = 'none' | OutcomeState;

export const OUT_TONE: Record<StageState, string> = {
  none: SPACE_COLOR.gap, unimpl: SPACE_COLOR.bad, open: SPACE_COLOR.open, ready: SPACE_COLOR.proven, done: SPACE_COLOR.proven,
};
/** A state's tone in the given mode. */
export function toneOf(state: StageState, mode: SpaceMode = 'dark'): string {
  const c = hues(mode);
  return { none: c.gap, unimpl: c.bad, open: c.open, ready: c.proven, done: c.proven }[state];
}
export const OUT_WORD: Record<StageState, string> = {
  none: 'no outcome', unimpl: 'not built', open: 'being built', ready: 'ready to close', done: 'done',
};

/** The four rows under a stage. With the stage itself that is the whole
 *  line: Stage, Outcome, Requirement, Architecture, Code. */
export const BANDS = [
  { key: 'outcome', label: 'OUTCOME', y: 8.2, color: SPACE_COLOR.outcome },
  { key: 'req', label: 'REQUIREMENT', y: 3.0, color: SPACE_COLOR.requirement },
  { key: 'node', label: 'ARCHITECTURE', y: -2.2, color: SPACE_COLOR.node },
  { key: 'artifact', label: 'CODE', y: -7.4, color: SPACE_COLOR.artifact },
] as const;

/** The Constraints lens: one column per layer (project_constraints.ctype).
 *  The eyebrow is the card's, drawn on a canvas where no CSS can set the
 *  case, so it is written the way it is read (like BANDS). */
export const LAYERS = [
  { ctype: 'technology', label: 'Technology', eyebrow: 'TECHNOLOGY', color: '#8B8FE6', light: '#5a5fd0' },
  { ctype: 'architecture', label: 'Architecture', eyebrow: 'ARCHITECTURE', color: '#5aa9e6', light: '#2b7bbd' },
  { ctype: 'deployment', label: 'Deployment', eyebrow: 'DEPLOYMENT', color: '#c07ae0', light: '#9a4fc7' },
  { ctype: 'performance', label: 'Performance', eyebrow: 'PERFORMANCE', color: '#5fd39a', light: '#1f8a5c' },
  { ctype: 'security', label: 'Security', eyebrow: 'SECURITY', color: '#f87171', light: '#a93b43' },
  { ctype: 'compliance', label: 'Compliance', eyebrow: 'COMPLIANCE', color: '#fbbf24', light: '#8a5a12' },
  { ctype: 'cost', label: 'Cost', eyebrow: 'COST', color: '#5fd3c8', light: '#1d8a86' },
  { ctype: 'other', label: 'Other', eyebrow: 'OTHER', color: '#9aa2c0', light: '#5b6475' },
] as const;
export type LayerType = typeof LAYERS[number]['ctype'];
export type Layer = typeof LAYERS[number];

/** A layer's hue in the given mode. */
export function layerColor(layer: Pick<Layer, 'color' | 'light'>, mode: SpaceMode = 'dark'): string {
  return mode === 'light' ? layer.light : layer.color;
}

export interface SpaceTask { id: string; displayId: string; title: string; done: boolean; commit: string | null; planSet: number | null }
export interface SpaceTest { testId: string; name: string; status: string; type: string | null; framework: string | null; criterion: string | null }
export interface SpaceNode { id: string; label: string; tech: string; tasks: SpaceTask[]; taskTotal: number }
export interface SpaceArtifact {
  path: string; dir: string; file: string;
  /** The commit the requirement's evidence was stamped with, short. */
  sha: string | null;
  hash: string | null; language: string | null; kind: string | null;
  /** The tests that run in or cover it. */
  provenBy: string[];
}
export interface SpaceCriterion { text: string; met: boolean; manual: boolean; testRef: string | null }
export interface SpaceRequirement {
  /** specification_requirements row id. */
  id: string;
  ref: string;
  name: string;
  description: string;
  confirmed: boolean;
  locked: boolean;
  proven: number;
  total: number;
  criteria: SpaceCriterion[];
  node: SpaceNode | null;
  tests: SpaceTest[];
  artifact: SpaceArtifact | null;
  by: 'human' | 'agent';
  at: string | null;
  /** AL.13: the other outcomes that derived this same requirement, each
   *  with where it sits (its first placement, or its home workflow when it
   *  is not placed yet). A requirement shared by outcomes in two workflows
   *  is drawn under both; this says so on each. */
  also: SpaceReqAlso[];
}
export interface SpaceReqAlso { outcomeId: string; outcomeName: string; laneId: string; laneName: string; laneColor: string; stepId: string | null; stepName: string | null; stepIndex: number | null }
export interface SpaceAlso { laneId: string; laneName: string; laneColor: string; stepId: string; stepName: string; stepIndex: number }
export interface SpaceOutcome {
  id: string;
  name: string;
  description: string;
  state: OutcomeState;
  /** Still open to edits and new steps (requirement_candidates.status pending). */
  pending: boolean;
  /** An agent holds it now. */
  live: boolean;
  reqs: SpaceRequirement[];
  /** Every OTHER step it sits on. */
  also: SpaceAlso[];
  /** An agent filed it, or derived its first requirement. */
  byAgent: boolean;
  /** AL.7: that agent's name, when the app can name it. */
  agent: string | null;
  candidate: Outcome;
}

/** AL.7: an agent's name on a card, cut to fit. Pure. */
export function shortName(name: string, max = 18): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** AL.7: the outcome card's eyebrow: the agent it came from, by name, when
 *  the team view shows who did what. Pure. */
export function outcomeEyebrow(o: Pick<SpaceOutcome, 'byAgent' | 'agent'>, team: boolean): string {
  if (!team || !o.byAgent) return 'OUTCOME';
  return `OUTCOME · ${o.agent ? shortName(o.agent) : 'AGENT'}`;
}

/** AL.7: the card's foot: the other STEP it sits on, by name (every
 *  outcome in a workflow sat in that workflow, so naming the workflow said
 *  the same thing on every card), and how many more. Pure. */
export function alsoLine(o: Pick<SpaceOutcome, 'also'>): string | null {
  if (o.also.length === 0) return null;
  const more = o.also.length - 1;
  return `also on ${o.also[0].stepName}${more > 0 ? ` and ${more} more` : ''}`;
}
export interface SpaceStage { id: string; index: number; name: string; outcomes: SpaceOutcome[]; state: StageState; proven: number; total: number }
export interface SpaceJourney { id: string; name: string; color: string; ownerLabel: string | null; stages: SpaceStage[] }

/** AC (owner 2026-09-24): filing an existing requirement on a stage lives
 *  here, in the Workflows space, not in the Requirements list. What a stage
 *  can file: every live requirement not already in this workflow. */
export function fileableIn<R extends { id: string }>(journey: Pick<SpaceJourney, 'stages'> | null, all: readonly R[]): R[] {
  if (!journey) return [];
  const filed = new Set(journey.stages.flatMap((s) => s.outcomes.flatMap((o) => o.reqs.map((r) => r.id))));
  return all.filter((r) => !filed.has(r.id));
}

/** A requirement is proven when it has criteria and every one is met. */
export function requirementProven(r: Pick<SpaceRequirement, 'proven' | 'total'>): boolean {
  return r.total > 0 && r.proven === r.total;
}

export function outcomeState(o: { settled: boolean; reqs: ReadonlyArray<Pick<SpaceRequirement, 'proven' | 'total'>> }): OutcomeState {
  if (o.reqs.length === 0) return 'unimpl';
  if (!o.reqs.every(requirementProven)) return 'open';
  return o.settled ? 'done' : 'ready';
}

/** A stage reads as the worst thing under it. */
export function stageState(outcomes: ReadonlyArray<Pick<SpaceOutcome, 'state'>>): StageState {
  if (outcomes.length === 0) return 'none';
  const s = outcomes.map((o) => o.state);
  if (s.includes('unimpl')) return 'unimpl';
  if (s.includes('open')) return 'open';
  if (s.includes('ready')) return 'ready';
  return 'done';
}

/** "3 of 4 criteria proven". */
export function criteriaLine(reqs: ReadonlyArray<Pick<SpaceRequirement, 'proven' | 'total'>>): string {
  let p = 0; let t = 0;
  for (const r of reqs) { p += r.proven; t += r.total; }
  return `${p} of ${t} criteria proven`;
}

/** The line under a stage's name in the strip. */
export function stripLabel(stage: Pick<SpaceStage, 'state' | 'proven' | 'total' | 'outcomes'>): string {
  switch (stage.state) {
    case 'none': return 'no outcome yet';
    case 'unimpl': return 'nothing builds this';
    case 'done': return 'done';
    case 'ready': return 'ready to close';
    default: return `${stage.proven} of ${stage.total} proven${stage.outcomes.length > 1 ? ` · ${stage.outcomes.length} outcomes` : ''}`;
  }
}

/** The strip's four chain segments: the outcome's tone, then whether any
 *  requirement, node and file stands under the stage. Null draws unlit. */
export function chainSegments(stage: Pick<SpaceStage, 'state' | 'outcomes'>, mode: SpaceMode = 'dark'): Array<string | null> {
  const reqs = stage.outcomes.flatMap((o) => o.reqs);
  const c = hues(mode);
  return [
    stage.outcomes.length ? toneOf(stage.state, mode) : null,
    reqs.length ? c.requirement : null,
    reqs.some((r) => r.node) ? c.node : null,
    reqs.some((r) => r.artifact) ? c.artifact : null,
  ];
}

const SHORT = (s: string | null | undefined, n = 7) => (s ? s.slice(0, n) : null);

/** The commit a requirement's evidence was last stamped with. */
export function evidenceCommit(chain: Pick<TraceChain, 'verify'> | null): string | null {
  if (!chain) return null;
  let best: { at: string; sha: string } | null = null;
  for (const c of chain.verify.criteria) {
    const sha = c.provenance?.commitSha;
    if (!sha) continue;
    const at = c.provenance?.at ?? '';
    if (!best || at > best.at) best = { at, sha };
  }
  return SHORT(best?.sha);
}

function splitPath(path: string): { dir: string; file: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', file: path } : { dir: path.slice(0, i), file: path.slice(i + 1) };
}

/** The file that carries a requirement: the first source its tests cover,
 *  else the first test file (the files the tests name, as the Plan rail reads
 *  them; AL.29 R3 changed the record's Code only). Hash, language and kind come
 *  from the graph's artifact of the same path, when it has one. */
export function artifactOf(record: Pick<RequirementRecordView, 'tasks'>, chain: Pick<TraceChain, 'verify' | 'cells'> | null, graph: Graph | null | undefined): SpaceArtifact | null {
  const subs = chain?.cells.plan.flatMap((p) => p.down) ?? [];
  const testFiles = new Set(subs.map((s) => s.detail.find(([k]) => k === 'test code')?.[1]));
  const paths = chain ? chainFilePaths(chain).sort((a, b) => a.localeCompare(b)) : [];
  const path = paths.find((p) => !testFiles.has(p)) ?? paths[0];
  if (!path) return null;
  const art = graph ? Object.values(graph.artifacts ?? {}).find((a) => a.path === path) ?? null : null;
  const taskCommit = record.tasks.find((t) => t.commit)?.commit ?? null;
  return {
    path, ...splitPath(path),
    sha: evidenceCommit(chain) ?? taskCommit,
    hash: SHORT(art?.contentHash, 12), language: art?.language ?? null, kind: art?.kind ?? null,
    provenBy: subs.filter((s) => s.links.includes(`af:${path}`)).map((s) => s.title.split(' \u00b7 ')[0]).sort(),
  };
}

export interface JourneyInput {
  lane: WorkflowLane;
  lanes: readonly WorkflowLane[];
  outcomes: readonly Outcome[];
  requirements: ReadonlyMap<string, BandRequirement>;
  chains: ReadonlyMap<string, TraceChain>;
  graph?: Graph | null;
  planSets?: ReadonlyMap<string, number>;
  filesByReq?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** AL.13: the other outcomes behind a requirement, each with where it sits. */
function alsoUnder(rowId: string, outcomeId: string, input: JourneyInput): SpaceReqAlso[] {
  const out: SpaceReqAlso[] = [];
  for (const o of input.outcomes) {
    if (o.id === outcomeId || o.kind !== 'outcome' || o.status === 'dismissed') continue;
    if (!o.derivations.some((d) => d.requirementRowId === rowId)) continue;
    const at = placements(o, input.lanes)[0] ?? null;
    const home = at ? null : input.lanes.find((l) => l.id === o.workflowId) ?? null;
    if (!at && !home) continue;
    out.push(at
      ? { outcomeId: o.id, outcomeName: o.name, laneId: at.laneId, laneName: at.laneName, laneColor: at.laneColor, stepId: at.stepId, stepName: at.stepName, stepIndex: at.stepIndex }
      : { outcomeId: o.id, outcomeName: o.name, laneId: home!.id, laneName: home!.name, laneColor: home!.color ?? SPACE_COLOR.accent, stepId: null, stepName: null, stepIndex: null });
  }
  return out;
}

/** "also under "Warehouse ships every order"" · "also under 2 other outcomes" · null. Pure. */
export function reqAlsoLine(r: Pick<SpaceRequirement, 'also'>): string | null {
  if (r.also.length === 0) return null;
  if (r.also.length === 1) return `also under "${shortName(r.also[0].outcomeName, 28)}"`;
  return `also under ${r.also.length} other outcomes`;
}

function requirementOf(rowId: string, derivation: Outcome['derivations'][number], input: JourneyInput, outcomeId: string): SpaceRequirement | null {
  const band = input.requirements.get(rowId);
  if (!band || band.archived) return null;
  const chain = input.chains.get(rowId) ?? null;
  const record = chain ? recordOf(chain, { requirement: band, outcomes: input.outcomes, lanes: input.lanes, planSets: input.planSets, filesByReq: input.filesByReq }) : null;
  const archNode = chain?.cells.arch[0] ?? null;
  const graphNode = archNode ? input.graph?.nodes?.[archNode.id] : undefined;
  return {
    id: band.id, ref: band.ref, name: band.name,
    description: chain?.verify.description ?? '',
    confirmed: band.confirmed, locked: band.locked,
    proven: band.metCount, total: band.criteriaCount,
    criteria: (record?.criteria ?? []).map((c) => ({ text: c.text, met: c.met, manual: c.verification === 'manual', testRef: c.testRef })),
    node: archNode ? {
      id: archNode.id, label: archNode.label, tech: graphNode?.technology ?? '',
      tasks: (record?.tasks ?? []).map((t) => ({ id: t.id, displayId: t.displayId, title: t.title, done: t.done, commit: t.commit, planSet: t.planSet })),
      taskTotal: record?.nodeTaskTotal ?? 0,
    } : null,
    tests: (record?.tests ?? []).map((t) => ({ testId: t.testId, name: t.name, status: t.status, type: t.type, framework: t.framework, criterion: t.criterion })),
    artifact: record ? artifactOf(record, chain, input.graph) : null,
    by: derivation.proposedByKind,
    at: derivation.createdAt ?? null,
    also: alsoUnder(rowId, outcomeId, input),
  };
}

/** Every step, in every workflow, an outcome sits on. */
function placements(o: Pick<Outcome, 'stepIds'>, lanes: readonly WorkflowLane[]): SpaceAlso[] {
  const out: SpaceAlso[] = [];
  for (const l of lanes) {
    l.steps.forEach((s, i) => {
      if (o.stepIds.includes(s.id)) out.push({ laneId: l.id, laneName: l.name, laneColor: l.color ?? SPACE_COLOR.accent, stepId: s.id, stepName: s.name, stepIndex: i });
    });
  }
  return out;
}

export function buildOutcome(o: Outcome, stepId: string, input: JourneyInput): SpaceOutcome {
  const reqs = o.derivations
    .map((d) => requirementOf(d.requirementRowId, d, input, o.id))
    .filter((r): r is SpaceRequirement => r !== null);
  return {
    id: o.id, name: o.name, description: o.description ?? '',
    state: outcomeState({ settled: o.settled, reqs }),
    pending: o.status === 'pending',
    live: o.live,
    reqs,
    also: placements(o, input.lanes).filter((p) => p.stepId !== stepId),
    byAgent: !!o.agent || o.derivations[0]?.proposedByKind === 'agent',
    agent: o.agent ?? null,
    candidate: o,
  };
}

/** One workflow as the space draws it. */
export function buildJourney(input: JourneyInput): SpaceJourney {
  const outcomes = input.outcomes.filter((o) => o.kind === 'outcome' && o.status !== 'dismissed');
  const stages: SpaceStage[] = input.lane.steps.map((s, index) => {
    const outs = outcomes.filter((o) => o.stepIds.includes(s.id)).map((o) => buildOutcome(o, s.id, input));
    const reqs = outs.flatMap((o) => o.reqs);
    return {
      id: s.id, index, name: s.name, outcomes: outs, state: stageState(outs),
      proven: reqs.reduce((a, r) => a + r.proven, 0), total: reqs.reduce((a, r) => a + r.total, 0),
    };
  });
  return { id: input.lane.id, name: input.lane.name, color: input.lane.color ?? SPACE_COLOR.accent, ownerLabel: input.lane.ownerLabel, stages };
}

/** Outcomes on no stage of any workflow (an agent filed one without a
 *  step, or it was made before Workflows): Requirements lists these so none
 *  is out of sight. */
export function unplacedOutcomes(outcomes: readonly Outcome[], lanes: readonly WorkflowLane[]): Outcome[] {
  const steps = new Set(lanes.flatMap((l) => l.steps.map((s) => s.id)));
  return outcomes.filter((o) => o.kind === 'outcome' && o.status === 'pending' && !o.stepIds.some((id) => steps.has(id)));
}

/** Why a stage cannot be removed yet, or null. Removing a step drops its
 *  outcome maps; a settled outcome's map may not change (the terminal rule),
 *  and an open one would drop out of sight, so a stage that holds outcomes
 *  keeps them until they move. */
/** AE.7 (owner 2026-09-25): a stage may be removed while it holds outcomes;
 *  they are left without a stage and the person places them again. This is
 *  the word before the second press, or null when nothing is orphaned. */
export function stageRemovalNote(stage: Pick<SpaceStage, 'name' | 'outcomes'>): string | null {
  const n = stage.outcomes.length;
  if (n === 0) return null;
  return `"${stage.name}" still holds ${n === 1 ? 'an outcome' : `${n} outcomes`}. Removing it leaves ${n === 1 ? 'it' : 'them'} without a stage, for you to place again. Press Remove again to go ahead.`;
}

/** AL.5: the word before the second press on a workflow's remove, or the
 *  refusal when its outcomes have nowhere to go. Its stages go with it; its
 *  outcomes move where the delete moves them (rehomePlan), for the person
 *  to place again. Pure. */
export function workflowRemoval(
  lane: Pick<WorkflowLane, 'id' | 'name' | 'steps'>,
  lanes: readonly WorkflowLane[],
  outcomes: ReadonlyArray<Pick<Outcome, 'id' | 'workflowId' | 'stepIds'>>,
): { note: string } | { refusal: string } {
  const homed = outcomes.filter((o) => o.workflowId === lane.id);
  const plan = rehomePlan(lane.id, lanes, homed.map((o) => ({ id: o.id, stepIds: o.stepIds })));
  if ('refusal' in plan) return plan;
  const names = [...plan.moves.keys()].map((id) => `"${lanes.find((l) => l.id === id)?.name ?? id}"`);
  const where = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const k = lane.steps.length;
  const n = homed.length;
  const stages = k === 0 ? '' : k === 1 ? ' and its stage' : ` and its ${k} stages`;
  const moving = n === 0 ? '' : ` ${n === 1 ? 'Its outcome moves' : `Its ${n} outcomes move`} to ${where}, to be placed again.`;
  return { note: `This removes "${lane.name}"${stages}.${moving} Press Remove again to go ahead.` };
}

/** Why an outcome cannot be removed, or null (dismiss is for outcomes that derived nothing). */
export function outcomeRemovalRefusal(o: Pick<SpaceOutcome, 'reqs' | 'candidate'>): string | null {
  if (o.candidate.derivations.length === 0) return null;
  const refs = o.reqs.map((r) => r.ref);
  return `Remove its requirements first${refs.length ? `: ${refs.join(', ')}` : ''}.`;
}

export function layerOf(ctype: string): Layer {
  return LAYERS.find((l) => l.ctype === ctype) ?? LAYERS[LAYERS.length - 1];
}

export interface SpaceLayer { layer: Layer; rows: ConstraintRow[] }

/** The layers that hold at least one constraint, in the canonical order. */
export function activeLayers(rows: readonly ConstraintRow[]): SpaceLayer[] {
  return LAYERS
    .map((layer) => ({ layer, rows: rows.filter((r) => layerOf(r.ctype).ctype === layer.ctype) }))
    .filter((l) => l.rows.length > 0);
}

/** R.2b: a scope narrower than the project that is not a workflow (a node type, a technology, a connection kind, one node). */
export function isNarrowScope(row: Pick<ConstraintRow, 'workflow_id' | 'scope_kind'>): boolean {
  return !row.workflow_id && !!row.scope_kind && row.scope_kind !== 'project' && row.scope_kind !== 'workflow';
}

/** A node type or technology id in words: "backend-service" is "backend service". */
export const idWords = (id: string): string => id.replace(/[-_]+/g, ' ');

/** A constraint holds for the whole project (Global), for one workflow, named,
 *  or (R.2b) for part of the system, said in words. */
export function scopeOf(
  row: Pick<ConstraintRow, 'workflow_id'> & Partial<Pick<ConstraintRow, 'scope_kind' | 'scope_value'>>,
  lanes: readonly Pick<WorkflowLane, 'id' | 'name' | 'color'>[],
  mode: SpaceMode = 'dark',
  nodeLabel: (id: string) => string = (id) => id.slice(0, 8),
): { global: boolean; word: string; tone: string } {
  const w = row.workflow_id ? lanes.find((l) => l.id === row.workflow_id) ?? null : null;
  if (w) return { global: false, word: w.name, tone: w.color ?? hues(mode).accent };
  if (isNarrowScope({ workflow_id: row.workflow_id ?? null, scope_kind: row.scope_kind }) && row.scope_value) {
    return {
      global: false,
      word: describeScope({ scopeKind: row.scope_kind as ScopeKind, scopeValue: row.scope_value, workflowId: null }, { role: idWords, technology: idWords, node: nodeLabel }),
      tone: hues(mode).accent,
    };
  }
  return { global: true, word: 'Global', tone: mode === 'light' ? '#5b6475' : '#8a8f9e' };
}

/** "2 global · 1 for a workflow · 1 for part of the system". */
export function layerCountLine(rows: readonly (Pick<ConstraintRow, 'workflow_id'> & Partial<Pick<ConstraintRow, 'scope_kind'>>)[]): string {
  const narrow = rows.filter((r) => isNarrowScope({ workflow_id: r.workflow_id, scope_kind: r.scope_kind })).length;
  const w = rows.filter((r) => !!r.workflow_id).length;
  const g = rows.length - w - narrow;
  return [g ? `${g} global` : '', w ? `${w} for a workflow` : '', narrow ? `${narrow} for part of the system` : ''].filter(Boolean).join(' · ');
}

/** Initials for the Team avatars: the roster's own rule ("Ana Kohl" is AK). */
export function initialsOf(label: string | null | undefined): string {
  return label?.trim() ? rosterInitials(label.trim()) : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Sep". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
