// AA.1 (owner 2026-09-23): the chain in the app, pure.
//
// "Having vision with zero downstream provenance makes the field and data
// useless." Every outcome cites the vision sentence or sentences it serves
// (evidence.serves, the ids the server checks: src/ui/utils/vision-sentences.ts
// is the server's module byte for byte), every requirement derives from an
// outcome, and a constraint is carried into the node packets it applies to.
// This module reads what Work already holds (the vision, the outcomes with
// their derivations, the requirement rows, the graph's task documents) and
// answers the questions the surfaces ask: how far the chain reaches (the
// Requirements header), which sentence an outcome serves (the rail, the
// record's origin line), which sentence a new outcome should offer first,
// and how many packets carry each constraint. Nothing here reads a table.
import { visionSentences, type VisionSentence } from '../../utils/vision-sentences.js';
import type { Outcome } from '../ideation/useOutcomes.js';

/** An outcome is a link of the chain when it was filed as one, or once it derived a requirement (the server's rule). */
export function inChain(o: Pick<Outcome, 'kind' | 'derivations'>): boolean {
  return o.kind === 'outcome' || o.derivations.length > 0;
}

export interface ChainCounts {
  sentences: number;
  served: number;
  outcomes: number;
  requirements: number;
  withOutcome: number;
}

export function chainCounts(input: {
  vision: string;
  outcomes: readonly Outcome[];
  requirementIds: readonly string[];
}): ChainCounts {
  const sentences = visionSentences(input.vision);
  const live = new Set(sentences.map((s) => s.id));
  const links = input.outcomes.filter(inChain);
  const served = new Set<string>();
  for (const o of links) for (const v of o.serves) if (live.has(v.id)) served.add(v.id);
  const derived = new Set(input.outcomes.flatMap((o) => o.derivations.map((d) => d.requirementRowId)));
  return {
    sentences: sentences.length,
    served: served.size,
    outcomes: links.length,
    requirements: input.requirementIds.length,
    withOutcome: input.requirementIds.filter((id) => derived.has(id)).length,
  };
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "2 of 3 vision sentences served · 4 outcomes · 3 of 4 requirements from an outcome", then the proof line. */
export function chainLine(c: ChainCounts, proven: string | null): string {
  const parts = [
    c.sentences === 0 ? 'No vision yet' : `${c.served} of ${n(c.sentences, 'vision sentence', 'vision sentences')} served`,
    n(c.outcomes, 'outcome', 'outcomes'),
    c.requirements === 0 ? 'no requirements' : `${c.withOutcome} of ${n(c.requirements, 'requirement', 'requirements')} from an outcome`,
  ];
  if (proven) parts.push(proven);
  return parts.join(' · ');
}

/** The sentence a new outcome offers first: the first no outcome serves yet, else the first. */
export function firstUnserved(sentences: readonly VisionSentence[], outcomes: readonly Outcome[]): VisionSentence | null {
  const served = new Set(outcomes.filter(inChain).flatMap((o) => o.serves.map((v) => v.id)));
  return sentences.find((s) => !served.has(s.id)) ?? sentences[0] ?? null;
}

/** What an outcome cites, against the vision as it is now. */
export function servedBy(o: Pick<Outcome, 'serves'>, sentences: readonly VisionSentence[]): { current: VisionSentence[]; lost: VisionSentence[] } {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const current: VisionSentence[] = [];
  const lost: VisionSentence[] = [];
  for (const v of o.serves) {
    const now = byId.get(v.id);
    if (now) current.push(now); else lost.push(v);
  }
  return { current, lost };
}

/** One line on what an outcome serves. Pure. */
export function servesLine(o: Pick<Outcome, 'serves'>, sentences: readonly VisionSentence[]): string {
  const { current, lost } = servedBy(o, sentences);
  if (current.length > 0) return `Serves the vision: ${current.map((v) => `“${v.text}”`).join(' and ')}`;
  if (lost.length > 0) return `Cites a sentence the vision no longer has${lost[0].text ? `: “${lost[0].text}”` : ''}`;
  return 'Serves no sentence of the vision yet';
}

/** The outcomes a requirement can derive from: open outcomes, by name. */
export function attachableOutcomes(outcomes: readonly Outcome[]): Array<{ id: string; name: string }> {
  return outcomes
    .filter((o) => o.kind === 'outcome' && o.status === 'pending')
    .map((o) => ({ id: o.id, name: o.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A sentence as an option label: short enough for a select. */
export function sentenceLabel(v: VisionSentence, max = 72): string {
  return v.text.length > max ? `${v.text.slice(0, max - 3)}...` : v.text;
}

/** The node ids that carry a task document (a packet), from the graph's artifacts. */
export function packetNodeIds(artifacts: Record<string, { path?: string; nodeId?: string | null }> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const a of Object.values(artifacts ?? {})) {
    if (a.nodeId && typeof a.path === 'string' && a.path.startsWith('.nodespec/tasks/')) out.add(a.nodeId);
  }
  return out;
}

/**
 * Constraint id → the node packets it is carried in. A project-wide one is
 * in every packet; one scoped to a workflow is in the packets of the nodes
 * its outcomes' requirements map to (the server's loader, node-constraints.ts).
 */
export function constraintReach(input: {
  constraints: ReadonlyArray<{ id: string; workflow_id: string | null }>;
  outcomes: readonly Outcome[];
  requirementNodes: ReadonlyMap<string, readonly string[]>;
  packets: ReadonlySet<string>;
}): Map<string, number> {
  const nodesByLane = new Map<string, Set<string>>();
  for (const o of input.outcomes) {
    if (!o.workflowId) continue;
    const set = nodesByLane.get(o.workflowId) ?? new Set<string>();
    for (const d of o.derivations) for (const node of input.requirementNodes.get(d.requirementRowId) ?? []) if (input.packets.has(node)) set.add(node);
    nodesByLane.set(o.workflowId, set);
  }
  const out = new Map<string, number>();
  for (const c of input.constraints) out.set(c.id, c.workflow_id ? (nodesByLane.get(c.workflow_id)?.size ?? 0) : input.packets.size);
  return out;
}

/** "In 4 node packets" · "In 1 node packet" · "In no node packet yet". Pure. */
export function reachLine(count: number): string {
  return count === 0 ? 'In no node packet yet' : `In ${n(count, 'node packet', 'node packets')}`;
}
