// V3 4.1: the Steps tab's model, pure. One lane in, the numbered steps out,
// each with the rows a reader sees under it:
//
//   an OUTCOME that has derived nothing     "Not yet a requirement"
//   a REQUIREMENT an outcome derived         "Unconfirmed requirement" or
//                                            "Confirmed requirement" (the
//                                            `confirmed` column, ruling 3.5)
//
// A row is the same thing wherever it appears: an outcome filed on two
// steps is one row shown twice, and the second showing says "same as
// step N". Proof counts read `acceptance_criteria[].met` on a requirement;
// an outcome's draft criteria count as "0 of N proven" because nothing can
// prove a draft. The lane's counts are over DISTINCT rows, so a row on two
// steps is counted once.
//
// The one decision only a person can make is a promotion: an agent can
// only ask (NEVER_AUTO_APPLY), and the pending ask rides in as
// `pendingPromotions` (useApprovalsQueue) so the row says "proposal waiting".
//
// Nothing here reads a table. The hooks that exist feed it as they stand
// (useWorkflowLanes, useOutcomes, useRequirementBand, useApprovalsQueue).
import type { Graph } from '@nodespec/core/types.js';
import type { WorkflowLane } from '../ideation/useWorkflowLanes.js';
import type { Outcome } from '../ideation/useOutcomes.js';
import type { BandRequirement } from '../ideation/useRequirementBand.js';
import { identifiedFromRow } from '../ideation/criterion-identity.js';

export type StepItemStatus = 'Not yet a requirement' | 'Unconfirmed requirement' | 'Confirmed requirement';

/** What the model needs of a requirement row: the band's shape. */
export type StepRequirement = Pick<BandRequirement, 'id' | 'ref' | 'name' | 'confirmed' | 'locked' | 'criteriaCount' | 'metCount' | 'state' | 'archived'>;

export interface PendingPromotion { proposalId: string; agent: string }

export interface StepItem {
  /** Stable across steps: `outcome:<id>` or `req:<row id>`. */
  identity: string;
  kind: 'outcome' | 'requirement';
  /** The outcome this row came from (a requirement row: the outcome that derived it). */
  outcomeId: string;
  requirementRowId: string | null;
  title: string;
  reqRef: string | null;
  status: StepItemStatus;
  proven: number;
  total: number;
  /** A pending promotion is waiting on this outcome: the row's "proposal waiting". */
  needsYou: boolean;
  proposalId: string | null;
  /** 1-based index of the earlier step this same row first appeared on. */
  sameAsStep: number | null;
  nodeId: string | null;
  locked: boolean;
  /** An agent holds this outcome right now (the live dot). */
  live: boolean;
  /** 7.3: the classification mark (Government); only cleared viewers receive the row. */
  mark: string | null;
}

export interface StepView {
  id: string;
  name: string;
  /** 1-based, the number the reader sees. */
  index: number;
  items: StepItem[];
}

export interface LaneView {
  id: string;
  name: string;
  ownerLabel: string | null;
  steps: StepView[];
  /** Distinct rows in the lane (an outcome on two steps counts once). */
  rows: number;
  proven: number;
  total: number;
  /** Distinct rows waiting on a promotion decision. */
  decisions: number;
}

export function requirementStatus(r: Pick<StepRequirement, 'confirmed'>): StepItemStatus {
  return r.confirmed ? 'Confirmed requirement' : 'Unconfirmed requirement';
}

/** The rows one outcome contributes to a step it is filed on: one per
 *  derived requirement that still exists, plus the outcome itself while it
 *  has derived nothing or still holds unclaimed criteria (a partial
 *  derivation keeps the outcome promotable from what is left). */
export function outcomeRows(
  o: Outcome,
  requirementsById: ReadonlyMap<string, StepRequirement>,
  pending: ReadonlyMap<string, PendingPromotion>,
): StepItem[] {
  const out: StepItem[] = [];
  for (const d of o.derivations) {
    const r = requirementsById.get(d.requirementRowId);
    if (!r || r.archived) continue;
    out.push({
      identity: `req:${r.id}`,
      kind: 'requirement',
      outcomeId: o.id,
      requirementRowId: r.id,
      title: r.name,
      reqRef: r.ref,
      status: requirementStatus(r),
      proven: r.metCount,
      total: r.criteriaCount,
      needsYou: false,
      proposalId: null,
      sameAsStep: null,
      nodeId: o.node_id ?? null,
      locked: r.locked,
      live: false,
      mark: null,
    });
  }
  const all = identifiedFromRow(o.criteria);
  const unclaimed = all.filter((c) => !o.claimed[c.id]);
  const derivedSomething = out.length > 0 || o.derivations.length > 0;
  if (!o.settled && (!derivedSomething || unclaimed.length > 0)) {
    const ask = pending.get(o.id) ?? null;
    out.unshift({
      identity: `outcome:${o.id}`,
      kind: 'outcome',
      outcomeId: o.id,
      requirementRowId: null,
      title: o.name,
      reqRef: null,
      status: 'Not yet a requirement',
      proven: 0,
      total: derivedSomething ? unclaimed.length : all.length,
      needsYou: !!ask,
      proposalId: ask?.proposalId ?? null,
      sameAsStep: null,
      nodeId: o.node_id ?? null,
      locked: false,
      live: o.live,
      mark: o.mark ?? null,
    });
  }
  return out;
}

/** The lane as the Steps tab renders it. */
export function buildLaneView(
  lane: WorkflowLane,
  outcomes: readonly Outcome[],
  requirementsById: ReadonlyMap<string, StepRequirement>,
  pending: ReadonlyMap<string, PendingPromotion> = new Map(),
): LaneView {
  const firstSeen = new Map<string, number>();
  const distinct = new Map<string, StepItem>();
  const steps: StepView[] = lane.steps.map((step, i) => {
    const index = i + 1;
    const items: StepItem[] = [];
    for (const o of outcomes) {
      if (!o.stepIds.includes(step.id)) continue;
      for (const row of outcomeRows(o, requirementsById, pending)) {
        const seen = firstSeen.get(row.identity);
        if (seen === undefined) { firstSeen.set(row.identity, index); distinct.set(row.identity, row); }
        items.push({ ...row, sameAsStep: seen ?? null });
      }
    }
    return { id: step.id, name: step.name, index, items };
  });
  let proven = 0, total = 0, decisions = 0;
  for (const row of distinct.values()) { proven += row.proven; total += row.total; if (row.needsYou) decisions += 1; }
  return { id: lane.id, name: lane.name, ownerLabel: lane.ownerLabel, steps, rows: distinct.size, proven, total, decisions };
}

/** "A reader tracks a book · Product · 5 steps · 0 of 8 criteria proven" */
export function laneHeaderLine(view: Pick<LaneView, 'name' | 'ownerLabel' | 'steps' | 'proven' | 'total'>): string {
  const n = view.steps.length;
  return [view.name, view.ownerLabel, `${n} step${n === 1 ? '' : 's'}`, `${view.proven} of ${view.total} criteria proven`].filter(Boolean).join(' · ');
}

/** "One proposal waiting" · "3 proposals waiting", or null when none waits. */
export function decisionLine(decisions: number): string | null {
  if (decisions <= 0) return null;
  return `${decisions === 1 ? 'One proposal' : `${decisions} proposals`} waiting`;
}

/** "on steps 1 and 3" · "on step 4" · "on no step yet" */
export function stepsLine(indices: readonly number[]): string {
  const list = [...new Set(indices)].sort((a, b) => a - b);
  if (list.length === 0) return 'on no step yet';
  if (list.length === 1) return `on step ${list[0]}`;
  return `on steps ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The 1-based indices of this lane's steps an outcome is filed on. */
export function stepIndicesOf(lane: Pick<WorkflowLane, 'steps'>, stepIds: readonly string[]): number[] {
  const out: number[] = [];
  lane.steps.forEach((s, i) => { if (stepIds.includes(s.id)) out.push(i + 1); });
  return out;
}

/** Where a candidate came from, in words: the import's evidence names the
 *  file it read; the owner's note names the owner; anything else was
 *  drafted in the app. */
export function originLine(evidence: Record<string, unknown> | null | undefined): string {
  const e = evidence ?? {};
  const source = typeof e.source === 'string' ? e.source.trim() : '';
  if (e.draftedBy === 'get_import_context') {
    const file = source.split(',')[0]?.trim();
    return file ? `found by the import in ${file}` : 'found by the import';
  }
  if (/^owner\b/i.test(source)) return 'written by the owner';
  return 'drafted in the app';
}

export interface LivesOn {
  label: string;
  detail: string | null;
  /** The nodes the row lives on, as the rail's chips: the home node first,
   *  then the far end of the edge that supplied the detail. */
  nodes: Array<{ id: string; label: string }>;
}

/** The node a row lives on and the one edge that best says what it does
 *  there: the first edge touching the node that carries a label, else its
 *  contract's name. Null when the graph has no such node. */
export function livesOn(graph: Graph | null | undefined, nodeId: string | null | undefined): LivesOn | null {
  if (!graph || !nodeId) return null;
  const node = graph.nodes[nodeId];
  if (!node) return null;
  const edges = Object.values(graph.edges).filter((e) => e.source === nodeId || e.target === nodeId).sort((a, b) => a.id.localeCompare(b.id));
  const labelled = edges.find((e) => typeof e.label === 'string' && e.label.trim().length > 0);
  const withContract = edges.find((e) => graph.contracts[e.contractId]);
  const chosen = labelled ?? withContract ?? null;
  const nodes: LivesOn['nodes'] = [{ id: node.id, label: node.label }];
  if (chosen) {
    const farId = chosen.source === nodeId ? chosen.target : chosen.source;
    const far = graph.nodes[farId];
    if (far && farId !== nodeId) nodes.push({ id: far.id, label: far.label });
  }
  if (labelled) return { label: node.label, detail: labelled.label!.trim(), nodes };
  return { label: node.label, detail: withContract ? graph.contracts[withContract.contractId].name : null, nodes };
}

/** The aside's count per lane: distinct rows. */
export function laneRowCounts(
  lanes: readonly WorkflowLane[],
  outcomes: readonly Outcome[],
  requirementsById: ReadonlyMap<string, StepRequirement>,
  pending: ReadonlyMap<string, PendingPromotion> = new Map(),
): Map<string, number> {
  return new Map(lanes.map((l) => [l.id, buildLaneView(l, outcomes, requirementsById, pending).rows]));
}

/** What the import left for review and nobody has confirmed: pending
 *  candidates that are not outcomes, plus backfilled requirements still
 *  unconfirmed. The aside's "Imported" line. */
export function importedCount(
  outcomes: readonly Pick<Outcome, 'kind' | 'status'>[],
  requirements: readonly Pick<BandRequirement, 'backfilled' | 'confirmed' | 'archived'>[],
): number {
  const candidates = outcomes.filter((o) => o.kind !== 'outcome' && o.status === 'pending').length;
  const rows = requirements.filter((r) => r.backfilled && !r.confirmed && !r.archived).length;
  return candidates + rows;
}

// ── the Imported lane ───────────────────────────────────────────────────────
// The aside's Imported row is a lane in the design's sense: a list with a
// rail. It holds what the import read out of the repository and nobody has
// decided: the requirements it minted (backfill) and the candidates (api,
// data, behavior) still pending. A candidate is decided under Proposals; a
// requirement is confirmed from its rail here.

export type ImportedRequirement = StepRequirement & Pick<BandRequirement, 'backfilled' | 'nodeIds'>;

export interface ImportedItem {
  /** `req:<row id>` or `candidate:<id>`. */
  identity: string;
  kind: 'requirement' | 'candidate';
  requirementRowId: string | null;
  candidateId: string | null;
  title: string;
  reqRef: string | null;
  status: StepItemStatus;
  proven: number;
  total: number;
  nodeId: string | null;
  locked: boolean;
  /** The evidence kind the import derived a candidate from (api, data, behavior). */
  candidateKind: string | null;
}

export interface ImportedView {
  items: ImportedItem[];
  /** What nobody has confirmed or decided: the aside's count. */
  undecided: number;
  proven: number;
  total: number;
}

export function importedView(
  outcomes: readonly Outcome[],
  requirements: readonly ImportedRequirement[],
): ImportedView {
  const reqs = requirements.filter((r) => r.backfilled && !r.archived)
    .sort((a, b) => (a.confirmed === b.confirmed ? a.ref.localeCompare(b.ref) : a.confirmed ? 1 : -1));
  const items: ImportedItem[] = reqs.map((r) => ({
    identity: `req:${r.id}`, kind: 'requirement', requirementRowId: r.id, candidateId: null, title: r.name, reqRef: r.ref,
    status: requirementStatus(r), proven: r.metCount, total: r.criteriaCount, nodeId: r.nodeIds[0] ?? null, locked: r.locked, candidateKind: null,
  }));
  for (const o of outcomes) {
    if (o.kind === 'outcome' || o.status !== 'pending') continue;
    items.push({
      identity: `candidate:${o.id}`, kind: 'candidate', requirementRowId: null, candidateId: o.id, title: o.name, reqRef: null,
      status: 'Not yet a requirement', proven: 0, total: identifiedFromRow(o.criteria).length, nodeId: o.node_id ?? null, locked: false, candidateKind: o.kind,
    });
  }
  let proven = 0, total = 0;
  for (const i of items) { proven += i.proven; total += i.total; }
  return { items, undecided: importedCount(outcomes, requirements), proven, total };
}

/** "6 imported · 6 undecided · 0 of 11 criteria proven" */
export function importedHeaderLine(view: Pick<ImportedView, 'items' | 'undecided' | 'proven' | 'total'>): string {
  const n = view.items.length;
  return [`${n} imported`, `${view.undecided} undecided`, `${view.proven} of ${view.total} criteria proven`].join(' · ');
}
