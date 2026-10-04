// The Plan tab's build order, to the design's Plan board (P2, E4): with no
// task docs there is nothing to order, so the tab shows the architecture's
// own order in the same Set columns, one row per node with what Work has
// filed on it (criteria and outcomes, no tasks yet). Pure.
//
// The ORDER is the server's (get_build_readiness: Kahn over sync outgoing
// contracts and containers). The sets are read off it with the graph: a
// node's set is one past the highest set of the upstream nodes that
// PRECEDE it in that order (outgoing edges' targets and its container), so
// the sets can never contradict the order they were read from.
import type { Graph } from '@nodespec/core/types.js';

export interface OrderedNode { nodeId: string; label: string }
/** What Work has filed on a node: criteria on its requirements, pending outcomes. */
export interface NodeWork { criteria: number; outcomes: number }
export interface StagedNode extends OrderedNode { line: string; after: string[] }
export interface BuildStage { index: number; title: string; nodes: StagedNode[] }

/** The nodes this one comes after, in scope: its outgoing edges' targets and
 *  the container it sits in. Distinct, in edge order. */
export function upstreamOf(graph: Graph | null | undefined, nodeId: string, scope: ReadonlySet<string>): string[] {
  if (!graph) return [];
  const out: string[] = [];
  for (const e of Object.values(graph.edges)) if (e.source === nodeId && scope.has(e.target) && e.target !== nodeId && !out.includes(e.target)) out.push(e.target);
  const parent = graph.nodes[nodeId]?.parentId;
  if (parent && scope.has(parent) && !out.includes(parent)) out.push(parent);
  return out;
}

/** The nodes a container hosts, in scope. */
export function hostedBy(graph: Graph | null | undefined, nodeId: string, scope: ReadonlySet<string>): string[] {
  if (!graph) return [];
  return Object.values(graph.nodes).filter((n) => n.parentId === nodeId && scope.has(n.id)).map((n) => n.id);
}

/** The board's cell line: "9 criteria, no tasks yet" · "3 criteria, 1 outcome,
 *  no tasks yet" · "hosts Shelfie web app" · "no requirements". What comes
 *  after what is the column, not the line. */
export function nodeWorkLine(work: NodeWork | undefined, hosts: readonly string[]): string {
  const c = work?.criteria ?? 0;
  const o = work?.outcomes ?? 0;
  const parts: string[] = [];
  if (c > 0) parts.push(`${c} criteri${c === 1 ? 'on' : 'a'}`);
  if (o > 0) parts.push(`${o} outcome${o === 1 ? '' : 's'}`);
  if (parts.length > 0) return `${parts.join(', ')}, no tasks yet`;
  if (hosts.length > 0) return `hosts ${hosts.join(', ')}`;
  return 'no requirements';
}

/** The server's order in sets (Set 1 to Set n), each node with its cell line. */
export function stageBuildOrder(order: readonly OrderedNode[], graph: Graph | null | undefined, work: ReadonlyMap<string, NodeWork>): BuildStage[] {
  const scope = new Set(order.map((n) => n.nodeId));
  const position = new Map(order.map((n, i) => [n.nodeId, i]));
  const label = new Map(order.map((n) => [n.nodeId, n.label]));
  const stageOf = new Map<string, number>();
  const afterOf = new Map<string, string[]>();
  for (const n of order) {
    const ups = upstreamOf(graph, n.nodeId, scope).filter((u) => (position.get(u) ?? Infinity) < (position.get(n.nodeId) ?? 0));
    afterOf.set(n.nodeId, ups);
    stageOf.set(n.nodeId, ups.length === 0 ? 0 : 1 + Math.max(...ups.map((u) => stageOf.get(u) ?? 0)));
  }
  const count = order.length === 0 ? 0 : Math.max(...[...stageOf.values()]) + 1;
  const stages: BuildStage[] = [];
  for (let i = 0; i < count; i++) {
    const nodes = order.filter((n) => stageOf.get(n.nodeId) === i).map((n) => {
      const after = (afterOf.get(n.nodeId) ?? []).map((u) => label.get(u) ?? u);
      const hosts = hostedBy(graph, n.nodeId, scope).map((h) => label.get(h) ?? h);
      return { ...n, after, line: nodeWorkLine(work.get(n.nodeId), hosts) };
    });
    stages.push({ index: i, title: `Set ${i + 1}`, nodes });
  }
  return stages;
}

/** Criteria per node from the requirements mapped to it, and pending
 *  outcomes per node: what Work has filed there. */
export function workByNode(
  requirements: ReadonlyArray<{ nodeIds: readonly string[]; criteriaCount: number; archived: boolean }>,
  outcomes: ReadonlyArray<{ kind: string; status: string; node_id: string | null }>,
): Map<string, NodeWork> {
  const out = new Map<string, NodeWork>();
  const at = (id: string) => { const w = out.get(id) ?? { criteria: 0, outcomes: 0 }; out.set(id, w); return w; };
  for (const r of requirements) if (!r.archived) for (const id of r.nodeIds) at(id).criteria += r.criteriaCount;
  for (const o of outcomes) if (o.kind === 'outcome' && o.status === 'pending' && o.node_id) at(o.node_id).outcomes += 1;
  return out;
}
