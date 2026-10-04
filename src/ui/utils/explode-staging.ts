// V3 AE.6 (owner 2026-09-25): the Expand button stages an explode request
// for the person's agent to pick up over MCP (MCP is not event driven; the
// agent reads it on its next get_project_status). The request lives in
// projects.metadata.stagedExplodes, beside stagedSpecImport; the server's
// reader is supabase/functions/_shared/staged-explodes.ts. Pure.
import type { Graph } from '@nodespec/core/types.js';
import { getCanContainRoleIds, type RoleInfo } from '@nodespec/core/container-types.js';

export interface StagedExplode {
  nodeId: string;
  label: string;
  stagedAt: string;
  note?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The staged requests in a project's metadata, tolerating anything else. */
export function readStagedExplodes(metadata: Record<string, unknown> | null | undefined): StagedExplode[] {
  const raw = metadata?.stagedExplodes;
  if (!Array.isArray(raw)) return [];
  const out: StagedExplode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const nodeId = typeof r.nodeId === 'string' ? r.nodeId.trim() : '';
    if (!UUID_RE.test(nodeId) || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
    out.push({
      nodeId,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : nodeId.slice(0, 8),
      stagedAt: typeof r.stagedAt === 'string' ? r.stagedAt : '',
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/** Stage a request for the node; a second press replaces the first. */
export function stageExplode(list: readonly StagedExplode[], node: { id: string; label: string }, now: Date = new Date()): StagedExplode[] {
  return [...list.filter((e) => e.nodeId !== node.id), { nodeId: node.id, label: node.label, stagedAt: now.toISOString() }];
}

export function withdrawExplode(list: readonly StagedExplode[], nodeId: string): StagedExplode[] {
  return list.filter((e) => e.nodeId !== nodeId);
}

export function stagedExplodeFor(list: readonly StagedExplode[], nodeId: string): StagedExplode | null {
  return list.find((e) => e.nodeId === nodeId) ?? null;
}

/** Whether a node is exploded: some node names it as parent. */
export function hasParts(graph: Graph, nodeId: string): boolean {
  return Object.values(graph.nodes).some((n) => n.parentId === nodeId);
}

/** A request is dropped once its node is exploded (the proposal landed);
 *  with `dropAbsent`, once the node is gone from the graph. */
export function pruneStagedExplodes(list: readonly StagedExplode[], graph: Graph, opts: { dropAbsent?: boolean } = {}): StagedExplode[] {
  return list.filter((e) => {
    if (hasParts(graph, e.nodeId)) return false;
    if (opts.dropAbsent && !graph.nodes[e.nodeId]) return false;
    return true;
  });
}

/** The Expand button shows on a node the depth rule lets an agent explode:
 *  not a container or boundary, not itself a part, not already exploded,
 *  and of a role that lists at least one part role. Before the catalog is
 *  read (resolve answers null) nothing is offered. */
export function canRequestExplode(graph: Graph, nodeId: string, resolve: (roleId: string) => RoleInfo | null): boolean {
  const node = graph.nodes[nodeId];
  if (!node || hasParts(graph, nodeId)) return false;
  const tail = node.type.includes('.') ? node.type.split('.').pop()! : node.type;
  const info = resolve(node.type) ?? resolve(tail);
  if (!info || info.isContainer || info.isPart) return false;
  const listed = info.canContain ? getCanContainRoleIds({ canContain: info.canContain }) : [];
  return listed.some((id) => resolve(id)?.isPart === true);
}
