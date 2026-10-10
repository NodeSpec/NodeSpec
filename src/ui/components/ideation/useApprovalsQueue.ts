// V3 8.1: the approvals queue, app side — the design's APPROVALS surface over
// ai_proposals. One read of the project's recent proposals (pending first,
// then the decided tail as the review log), targets resolved to names in
// batched selects, and ONE decision lane: Approve / Reject post the same
// resolve_proposal tool an agent would call, with the user's session — the
// channel decides the human act (R7), so promote and settle derive HERE and
// nowhere else. Graph proposals are listed but review in the canvas (the
// server refuses them by plane).
import { useCallback, useMemo, useState } from 'react';
import { useSharedPoll } from '../../hooks/useSharedPoll.js';
import { credentialLabel } from './useAgentPresence.js';
import type { Graph } from '@nodespec/core/types.js';
import type { Feature } from '../../config/feature-rules.js';
import { getSupabaseClient, callEdgeFunction } from '../../../persistence/supabase/client.js';
import { proposalKind, proposalOrigin, countWord, SPEC_PATCH_KIND, type ProposalOrigin, type QueueKind } from '../../utils/proposal-plane.js';
import { conflictsSince, describeConflicts, laterPatchFromRow, type LaterPatch, type PatchRowLike } from '@nodespec/core/patch-targets.js';
import { predictedRef } from './useDecision.js';
import { asCheckSpec, describeCheck, describeScope, type ScopeKind } from '../../../../supabase/functions/_shared/constraint-rules.js';

export const QUEUE_REFRESH_MS = 30 * 1000;
export const QUEUE_LOG_LIMIT = 40;

export interface QueueRow {
  id: string;
  source_branch_id: string;
  status: string;
  patches: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface QueueItem {
  proposalId: string;
  kind: QueueKind;
  status: string;
  pending: boolean;
  /** Decided rows: how — the review-log label. */
  decidedLabel: 'APPROVED' | 'APPLIED' | 'REJECTED' | 'PARTIAL' | null;
  target: string;
  origin: ProposalOrigin;
  text: string;
  patchCount: number;
  /** V3 2.1: patches a later change on the branch overtook (stored by a refused accept, or computed live against base_sequence). */
  conflicted?: number;
  conflictText?: string | null;
  /** V3 4.1: the candidate a spec op targets (promote, attach, settle,
   *  dismiss, update, step maps), so Work can say "an agent asked for this". */
  candidateId?: string | null;
  createdAt: string;
  /** Graph ops: the server refuses them — the canvas is their lane. */
  reviewInCanvas: boolean;
  /** V3 4.3: where the row came from; absent reads 'proposal'. */
  source?: QueueSource;
  /** V3 4.3: the acts this row takes, in the order the card draws them. */
  acts?: QueueAct[];
  /** V3 4.3: evidence lines (an open question's), shown under the text. */
  detail?: string[];
  /** V3 4.3: the node a mapping or a question sits on. */
  nodeId?: string | null;
  /** V3 4.3: the concrete edit an open question resolves by, in the import's words. */
  resolution?: string | null;
  /** The open question's kind (unresolved_edge, ungrouped_node, missing_contract_schema, ...). */
  questionKind?: string | null;
  /** An imported candidate NodeSpec flagged as wrong, in its words; such a
   *  row takes one act, reject. */
  flag?: string | null;
  /** V3 6.4: where a promotion lands in the specification, from the
   *  payload's section. The card says "Accept as REQ-011 on <this>"; absent,
   *  the candidate's node stands in (nodeId). */
  landsOn?: string | null;
  /** V3 6.4: a proposal whose target requirement is locked: the server will
   *  refuse the accept, so the card says so before the click and offers the
   *  door (Unlock REQ-005, then accept) in place of Accept. */
  targetLocked?: { ref: string; rowId: string } | null;
  /** V3 6.4: a plan's version and how many items it orders ("Accept plan v1"). */
  planVersion?: number;
  itemCount?: number | null;
  /** AJ.6: in the account's example, a pending row of a feature the owner's
   *  plan does not carry: it reads, and takes no act. */
  viewOnly?: Feature | null;
  /** AL.2: on a decided proposal, the reviewer's own words (a reject's
   *  reason): the agent reads them back, and the history shows them. */
  note?: string | null;
  /** AL.24: every lane it touches is at Auto, and it still waits for the
   *  person: why, as the server recorded it (metadata.autoWait). */
  autoWait?: string | null;
}

export type QueueSource = 'proposal' | 'candidate' | 'mapping' | 'question' | 'plan';
/** accept/reject: a proposal or a plan. accept/dismiss: an imported candidate.
 *  confirm/move: a mapping. open: a question (the concrete edit is made in
 *  Architecture; nothing here flags it). */
export type QueueAct = 'accept' | 'reject' | 'dismiss' | 'confirm' | 'move' | 'open';

// ── V3 4.3: the sources the import leaves for a person ──────────────────────

export interface CandidateQueueRow { id: string; name: string; description: string | null; kind: string; key: string; node_id: string | null; criteria: unknown; evidence: Record<string, unknown> | null; created_at?: string | null }
export interface MappingQueueRow { id: string; requirement_id: string | null; node_id: string | null; notes: string | null; confidence: number | null; created_at?: string | null }
export interface OpenQuestion { id?: string; kind?: string; group?: string; nodeId?: string; summary?: string; detail?: string; evidence?: string[]; whyRefused?: string; resolution?: string }
export interface ImportJobQueueRow { id: string; open_questions: unknown; metrics: Record<string, unknown> | null; created_at?: string | null; updated_at?: string | null }
export interface PlanQueueRow { id: string; version: number; summary: string | null; proposed_by: string | null; created_at: string; source_hash: string; branch_id: string }

const IMPORT_ORIGIN: ProposalOrigin = { kind: 'agent', label: 'the import' };

/** Pending backfill candidates (kind api, data or behavior): accept mints
 *  the requirement on its node through backfill_requirements; dismiss is
 *  terminal. Outcomes are not here: they live on Work's steps. */
export function assembleCandidateItems(rows: readonly CandidateQueueRow[]): QueueItem[] {
  return rows.filter((r) => r.kind !== 'outcome').map((r) => {
    const n = Array.isArray(r.criteria) ? r.criteria.length : 0;
    // A candidate NodeSpec flagged as wrong (evidence.reviewNote) takes one
    // act: reject. Accepting it would mint a requirement the import itself
    // said is wrong.
    const flag = typeof r.evidence?.reviewNote === 'string' && r.evidence.reviewNote.trim() ? r.evidence.reviewNote.trim() : null;
    return {
      proposalId: r.id, kind: 'imported', status: 'pending', pending: true, decidedLabel: null,
      target: r.name, origin: IMPORT_ORIGIN,
      text: `${r.description?.trim() || `Derived from ${r.kind} evidence.`} ${countWord(n, true)} draft criteri${n === 1 ? 'on' : 'a'}.`,
      patchCount: 1, candidateId: r.id, createdAt: r.created_at ?? '', reviewInCanvas: false,
      source: 'candidate', acts: flag ? ['dismiss'] : ['accept', 'dismiss'], nodeId: r.node_id ?? null, flag,
    };
  });
}

/** Mappings the import marked needs-review: confirm the node, or move the
 *  mapping to the right one. The one app-side write 4.3 adds. */
export function assembleMappingItems(rows: readonly MappingQueueRow[], labels: QueueLabels): QueueItem[] {
  return rows.map((r) => ({
    proposalId: r.id, kind: 'mapping', status: 'pending', pending: true, decidedLabel: null,
    // The design asks the question the row is: "Is REQ-003 Shelf Sync behaviour on the right node?"
    target: `Is ${r.requirement_id ? (labels.requirements.get(r.requirement_id) ?? r.requirement_id) : 'this requirement'} on the right node?`,
    origin: IMPORT_ORIGIN,
    text: r.notes?.trim() || `Mapped at ${Math.round((r.confidence ?? 0) * 100)}% confidence from a file path. Confirm the node or move it.`,
    patchCount: 1, createdAt: r.created_at ?? '', reviewInCanvas: false,
    source: 'mapping', acts: ['confirm', 'move'], nodeId: r.node_id ?? null,
  }));
}

/** Resolution by DERIVATION, never by a flag: an open question is closed
 *  when the graph shows the edit it asked for. An unresolved edge: an edge
 *  now names one of the question's evidence files. An ungrouped node: the
 *  graph holds more nodes than the import drew. A missing contract schema:
 *  no contract is without one. Any other kind stays open until the import
 *  runs again. Pure. */
export function questionResolved(q: OpenQuestion, graph: Graph | null | undefined, metrics: Record<string, unknown> | null | undefined): boolean {
  if (!graph) return false;
  switch (q.kind) {
    case 'unresolved_edge': {
      const files = questionFiles(q);
      if (files.length === 0) return false;
      return Object.values(graph.edges).some((e) => { const text = `${e.label ?? ''} ${JSON.stringify(e.metadata ?? {})}`; return files.some((f) => text.includes(f)); });
    }
    case 'ungrouped_node': {
      const drawn = typeof metrics?.nodes === 'number' ? metrics.nodes : null;
      return drawn !== null && Object.keys(graph.nodes).length > drawn;
    }
    case 'missing_contract_schema':
      return Object.values(graph.contracts).every((c) => (c.schema && Object.keys(c.schema).length > 0) || !!c.schemaRef);
    default:
      return false;
  }
}

/** The file paths an open question's evidence names: the token before
 *  the first space or colon, when it looks like a path. Pure. */
export function questionFiles(q: Pick<OpenQuestion, 'evidence'>): string[] {
  return (q.evidence ?? []).map((e) => e.split(/[\s:]/)[0]).filter((f) => f.includes('/') || f.includes('.'));
}

/** The node an open question sits on, by DERIVATION and never by guess:
 *  the id it carries; else the node whose label is the question's group
 *  (the import lane writes the group's label, which becomes the node's);
 *  else the node holding an artifact at a file the evidence names. Null
 *  when nothing in the graph says. Pure. */
export function questionNodeId(q: OpenQuestion, graph: Graph | null | undefined): string | null {
  if (!graph) return null;
  if (typeof q.nodeId === 'string' && graph.nodes[q.nodeId]) return q.nodeId;
  const label = typeof q.group === 'string' ? q.group.trim().toLowerCase() : '';
  if (label) {
    const byLabel = Object.values(graph.nodes).find((n) => n.label.trim().toLowerCase() === label);
    if (byLabel) return byLabel.id;
  }
  const files = questionFiles(q);
  if (files.length === 0) return null;
  for (const a of Object.values(graph.artifacts)) {
    if (!a.nodeId || !a.path) continue;
    if (files.some((f) => a.path === f || a.path.endsWith(`/${f}`) || f.endsWith(`/${a.path}`))) return a.nodeId;
  }
  return null;
}

/** A question's title, as a question: the design's rows ask. Pure. */
export const QUESTION_KIND_LABEL: Readonly<Record<string, string>> = {
  unresolved_edge: 'An outbound call with no edge',
  ungrouped_node: 'Everything resolved to one node',
  missing_contract_schema: 'A contract with no schema',
  'dependency-cycle': 'A dependency cycle',
  'frame-near-tie': 'A frame the import could not decide',
  'low-confidence-group': 'A group the import was unsure of',
  'unknown-technology': 'A technology the import did not recognise',
  'deployment-mismatch': 'A deployment that does not match the code',
  // AA.4c: what the backing-service table and the deploy path could not settle.
  'backing-service': 'A backing service the import could not settle',
  'deploy-step': 'A deploy step the import could not place',
  // AJ.1: a group enrich could not finish, and a listing that stopped early.
  'group-not-analyzed': 'A group the import could not analyze',
  'tree-truncated': 'Files the import could not list',
};

/** The newest import job's open questions that the graph has not yet
 *  answered. The act is the concrete edit, made in Architecture. */
export function assembleQuestionItems(job: ImportJobQueueRow | null, graph: Graph | null | undefined): QueueItem[] {
  if (!job || !Array.isArray(job.open_questions)) return [];
  const out: QueueItem[] = [];
  (job.open_questions as OpenQuestion[]).forEach((q, i) => {
    if (!q || typeof q !== 'object') return;
    if (questionResolved(q, graph, job.metrics)) return;
    const id = q.id ?? `q${i + 1}`;
    out.push({
      proposalId: `${job.id}:${id}`, kind: 'question', status: 'pending', pending: true, decidedLabel: null,
      target: QUESTION_KIND_LABEL[q.kind ?? ''] ?? (q.kind ?? 'question').replace(/[_-]/g, ' '), origin: IMPORT_ORIGIN,
      text: q.summary ?? q.detail ?? 'The import left a question.',
      patchCount: 1, createdAt: job.created_at ?? '', reviewInCanvas: false,
      source: 'question', acts: ['open'], detail: Array.isArray(q.evidence) ? q.evidence : [], resolution: q.resolution ?? q.whyRefused ?? null,
      nodeId: questionNodeId(q, graph), questionKind: q.kind ?? null,
    });
  });
  return out;
}

/** A proposed work plan: accepting it is the Plan tab's order from then on.
 *  6.4: the heading counts what it orders ("Plan v1 · 94 tasks and tests")
 *  when the items were read. */
export function assemblePlanItems(rows: readonly PlanQueueRow[], itemCounts: ReadonlyMap<string, number> = new Map(), keyNames: ReadonlyMap<string, string> = new Map()): QueueItem[] {
  return rows.map((r) => {
    const n = itemCounts.get(r.id) ?? null;
    return {
      proposalId: r.id, kind: 'plan', status: 'pending', pending: true, decidedLabel: null,
      // O.2: proposed_by is the delegate ('key:<id>'); show the key's name, never the raw id.
      // AL.2: a person's plan carries their email; a bare account id names nobody.
      target: `Plan v${r.version}${n !== null ? ` · ${n} tasks and tests` : ''}`, origin: r.proposed_by && r.proposed_by.includes('@') ? { kind: 'human', label: r.proposed_by } : { kind: 'agent', label: (r.proposed_by ? (credentialLabel(r.proposed_by, keyNames) ?? 'a person') : 'agent') },
      text: r.summary?.trim() || 'An order of operations over the task docs, waiting for your accept.',
      patchCount: 1, createdAt: r.created_at, reviewInCanvas: false, source: 'plan', acts: ['accept', 'reject'],
      planVersion: r.version, itemCount: n,
    };
  });
}

export interface QueueLabels {
  candidates: Map<string, string>;
  /** By row uuid AND by REQ-xxx id. */
  requirements: Map<string, string>;
  workflows: Map<string, string>;
  steps: Map<string, string>;
  /** 6.4: candidate id → the node it sits on (a promotion lands there when the payload names no section). */
  candidateNodes?: Map<string, string>;
  /** 6.4: the locked requirements among the targets, by row uuid AND by REQ-xxx id. */
  lockedRequirements?: Map<string, { ref: string; rowId: string }>;
  /** R.2b: constraint id → its title, else its words. */
  constraints?: Map<string, string>;
}

// ── V3 6.4: the act carries the consequence ─────────────────────────────────
// Every primary button names what accepting does. NodeSpec writes none of
// these from a model: the ref is the server's minting rule mirrored
// (predictedRef), the place is the payload's section or the row's node, the
// version is the plan's. Pure.

/** "Accept as REQ-011 on S05 · Restoration Garden" (a promotion or an
 *  imported candidate), "Accept plan v1", else "Accept". The next ref is
 *  the same on every minting card: it is what accepting THIS card now
 *  does; after any accept the queue re-reads and the labels advance. */
export function acceptLabel(item: Pick<QueueItem, 'kind' | 'source' | 'planVersion'>, nextRef: string | null, place: string | null): string {
  if (item.kind === 'promotion' || item.source === 'candidate') {
    return `Accept as ${nextRef ?? 'a requirement'}${place ? ` on ${place}` : ''}`;
  }
  if (item.kind === 'plan') return item.planVersion !== undefined ? `Accept plan v${item.planVersion}` : 'Accept the plan';
  return 'Accept';
}

/** The door a locked target opens in place of Accept: "Unlock REQ-005, then accept". */
export function unlockDoorLabel(ref: string): string {
  return `Unlock ${ref}, then accept`;
}

/** The lock line above it, in the database's own head: "REQ-005 is locked". */
export function lockedLine(ref: string): string {
  return `${ref} is locked`;
}

/** The server's refusal, word for word. backfill_requirements answers a
 *  failed decision with a count in `error` and the reason per candidate in
 *  `data.failed[].error`; the reason is what the card shows. Every other
 *  lane's `error` is already the sentence. */
export function decisionRefusal(r: { error?: string; data?: { failed?: Array<{ candidateId?: string; error?: string }> } }, fallback: string): string {
  const reasons = (r.data?.failed ?? []).map((f) => f.error?.trim()).filter((e): e is string => !!e);
  if (reasons.length > 0) return reasons.join(' ');
  return r.error?.trim() || fallback;
}

const REQUIREMENT_TARGET_OPS = new Set(['update_requirement', 'delete_requirement', 'map_requirement', 'relate_requirements']);

/** The locked requirement a proposal targets, if any: the first op whose
 *  requirementId (or either end of a relation) resolves to a locked row.
 *  The server would refuse the accept (v3x); the card says so first. Pure. */
export function lockedTargetOf(entries: readonly Entry[], labels: Pick<QueueLabels, 'lockedRequirements'>): { ref: string; rowId: string } | null {
  const locked = labels.lockedRequirements;
  if (!locked || locked.size === 0) return null;
  for (const e of entries) {
    const type = e.patch?.type ?? '';
    if (!REQUIREMENT_TARGET_OPS.has(type)) continue;
    const p = (e.patch?.payload ?? {}) as AnyRec;
    for (const k of ['requirementId', 'fromRequirementId', 'toRequirementId']) {
      const id = p[k];
      if (typeof id === 'string' && locked.has(id)) return locked.get(id)!;
    }
  }
  return null;
}

type Entry = { patch?: { type?: string; payload?: Record<string, unknown>; metadata?: Record<string, unknown> }; explanation?: string; status?: string; conflictReason?: string };
type AnyRec = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const short = (id: unknown): string => (typeof id === 'string' ? id.slice(0, 8) : '—');

/** The entity a spec op is about, by name when the batch resolved it. */
export function targetOf(entry: Entry, labels: QueueLabels): string {
  const type = entry.patch?.type ?? '';
  const p = (entry.patch?.payload ?? {}) as AnyRec;
  const req = (id: unknown) => (typeof id === 'string' ? (labels.requirements.get(id) ?? id) : '—');
  const cand = (id: unknown) => (typeof id === 'string' ? (labels.candidates.get(id) ?? `outcome ${short(id)}`) : '—');
  switch (type) {
    case 'create_requirement': return str(p.name) ?? 'New requirement';
    case 'update_requirement': case 'delete_requirement': case 'map_requirement': return req(p.requirementId);
    case 'relate_requirements': return `${req(p.fromRequirementId)} → ${req(p.toRequirementId)}`;
    case 'update_vision': return 'Vision';
    case 'create_constraint': return `New ${p.kind === 'check' ? 'check' : 'constraint'}: ${str(p.title) ?? str(p.description) ?? 'untitled'}`;
    case 'update_constraint': case 'delete_constraint':
      return typeof p.constraintId === 'string' ? (labels.constraints?.get(p.constraintId) ?? `constraint ${short(p.constraintId)}`) : 'A constraint';
    case 'create_candidate': return str(p.name) ? `New outcome: ${str(p.name)}` : 'New outcome';
    case 'update_candidate': case 'dismiss_candidate': case 'promote_candidate': case 'attach_candidate': case 'settle_candidate': case 'set_outcome_step_maps':
      return cand(p.candidateId);
    case 'upsert_workflow': return str(p.name) ?? (typeof p.id === 'string' ? (labels.workflows.get(p.id) ?? `lane ${short(p.id)}`) : 'New lane');
    case 'delete_workflow': return typeof p.id === 'string' ? (labels.workflows.get(p.id) ?? `lane ${short(p.id)}`) : '—';
    case 'upsert_workflow_step': return str(p.name) ?? (typeof p.id === 'string' ? (labels.steps.get(p.id) ?? `step ${short(p.id)}`) : 'New step');
    case 'delete_workflow_step': return typeof p.id === 'string' ? (labels.steps.get(p.id) ?? `step ${short(p.id)}`) : '—';
    default: return type || '—';
  }
}

const FIELD_WORD: Readonly<Record<string, string>> = {
  name: 'the name', description: 'the description', category: 'the category', criteria: 'the acceptance criteria',
  status: 'the status', section: 'the section',
};

/** "a, b and c". Pure. */
function listWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** What the op does — the agent's explanation when it gave one, else a
 *  deterministic sentence from the payload. AL.2: a routed tool (create,
 *  update, map a requirement; the vision) files its own patch summary as
 *  the explanation ("Update requirement REQ-005"), which says nothing the
 *  heading does not; that reads as no explanation, so the payload speaks. */
export function describeEntry(entry: Entry): string {
  const given = str(entry.explanation);
  const summary = str(entry.patch?.metadata?.summary);
  if (given && given !== 'No explanation provided' && given !== summary) return given;
  const type = entry.patch?.type ?? '';
  const p = (entry.patch?.payload ?? {}) as AnyRec;
  switch (type) {
    case 'promote_candidate': {
      const ids = Array.isArray(p.criteriaIds) ? p.criteriaIds.length : 0;
      const name = str(p.name);
      return `Derive a requirement${name ? ` "${name}"` : ''} from ${ids > 0 ? `${ids} selected criteri${ids === 1 ? 'on' : 'a'}` : 'every unclaimed criterion'}`;
    }
    case 'attach_candidate': {
      const ids = Array.isArray(p.criteriaIds) ? p.criteriaIds.length : 0;
      return `Attach the outcome to ${str(p.requirementId) ?? 'an existing requirement'} as an origin${ids > 0 ? ` (${ids} criteri${ids === 1 ? 'on' : 'a'})` : ''}`;
    }
    case 'settle_candidate': return 'Settle the outcome — fully derived, nothing more to promote';
    case 'dismiss_candidate': return 'Dismiss the outcome (terminal)';
    case 'create_candidate': return 'Draft a new outcome';
    case 'update_candidate': return `Update ${Object.keys((p.changes as AnyRec) ?? {}).join(', ') || 'the outcome'}`;
    case 'set_outcome_step_maps': return `Map the outcome to ${Array.isArray(p.stepIds) ? p.stepIds.length : 0} step(s)`;
    case 'create_requirement': {
      const n = Array.isArray(p.criteria) ? p.criteria.length : 0;
      return `A new requirement${n > 0 ? ` with ${countWord(n)} acceptance criteri${n === 1 ? 'on' : 'a'}` : ''}${str(p.section) ? `, under ${str(p.section)}` : ''}`;
    }
    case 'update_requirement': {
      const changes = (p.changes as AnyRec) ?? {};
      if (changes.archived === true) return 'Archives it';
      if (changes.archived === false) return 'Restores it from the archive';
      const words = Object.keys(changes).map((k) => FIELD_WORD[k] ?? k);
      return words.length > 0 ? `Changes ${listWords(words)}` : 'Changes the requirement';
    }
    case 'delete_requirement': return p.force === true ? 'Deletes it, with its mappings and test evidence' : 'Deletes it';
    case 'map_requirement': {
      const n = Array.isArray(p.nodeIds) ? p.nodeIds.length : 0;
      const nodes = `${countWord(n)} node${n === 1 ? '' : 's'}`;
      if (p.mode === 'remove') return `Unmaps it from ${nodes}`;
      if (p.mode === 'replace') return `Maps it to ${nodes}, in place of the nodes it had`;
      return `Maps it to ${nodes}`;
    }
    case 'relate_requirements': {
      if (p.mode === 'remove') return 'Removes the relation';
      return p.relationType === 'expands' ? 'Records that the first extends the second'
        : p.relationType === 'depends_on' ? 'Records that the first depends on the second'
          : 'Records that the two are related';
    }
    case 'update_vision': {
      const v = str(p.vision)?.replace(/\s+/g, ' ').trim();
      if (!v) return 'Rewrites the project vision';
      return `Sets the vision: "${v.length > 140 ? `${v.slice(0, v.lastIndexOf(' ', 140) > 80 ? v.lastIndexOf(' ', 140) : 140)}…` : v}"`;
    }
    case 'create_constraint': {
      const sc = (p.scope ?? null) as AnyRec | null;
      const scope = str(p.workflowName) ?? (typeof p.workflowId === 'string' ? 'one workflow' : null)
        ?? (sc && typeof sc.value === 'string' && ['role', 'technology', 'contract_kind', 'node'].includes(String(sc.kind))
          ? describeScope({ scopeKind: sc.kind as ScopeKind, scopeValue: sc.value, workflowId: null }, { node: () => 'one node' })
          : null);
      const check = p.kind === 'check' && p.check && typeof p.check === 'object' ? asCheckSpec(p.check) : null;
      if (check) return `Add a check that ${check.severity === 'refuse' ? 'refuses' : 'warns on'} a change breaking it: ${describeCheck(check)} (${scope ? `on ${scope}` : 'the whole project'})`;
      return `Add a ${str(p.ctype) ?? 'standing'} constraint${scope ? ` on ${scope}` : ' for the whole project'}`;
    }
    case 'update_constraint': {
      const w = (p.addWaiver ?? null) as AnyRec | null;
      if (w) return `Waive it for ${str(w.target) ? short(w.target) : 'one target'}: ${str(w.reason) ?? 'no reason given'}${str(w.expiresAt) ? ` (until ${String(w.expiresAt).slice(0, 10)})` : ''}`;
      if (str(p.removeWaiver)) return 'Lift a waiver';
      const ch = (p.changes ?? {}) as AnyRec;
      const check = ch.check && typeof ch.check === 'object' ? asCheckSpec(ch.check) : null;
      return check ? `Change the check to: ${describeCheck(check)}` : `Update ${Object.keys(ch).join(', ') || 'the constraint'}`;
    }
    case 'delete_constraint': return `Retire it: ${str(p.reason) ?? 'no reason given'}`;
    case 'upsert_workflow': return p.id ? 'Rename or restyle the lane' : 'Add a lane';
    case 'delete_workflow': return 'Delete the lane';
    case 'upsert_workflow_step': return p.id ? 'Rename or reorder the step' : 'Add a step';
    case 'delete_workflow_step': return 'Delete the step';
    default: return type ? `${type.replace(/_/g, ' ')}` : 'Change';
  }
}

const GRAPH_NOUN: Readonly<Record<string, string>> = { node: 'node', edge: 'edge', contract: 'contract', artifact: 'file' };
const GRAPH_VERB: Readonly<Record<string, string>> = { add: 'Adds', update: 'Changes', remove: 'Removes' };

/** "Adds two nodes and one edge; changes one contract": what a batch of
 *  graph patches does, counted by op. Pure. */
export function graphOpsSentence(entries: readonly Entry[]): string {
  const counts = new Map<string, Map<string, number>>();
  let other = 0;
  for (const e of entries) {
    const m = /^(add|update|remove)_(node|edge|contract|artifact)$/.exec(e.patch?.type ?? '');
    if (!m) { other += 1; continue; }
    const byNoun = counts.get(m[1]) ?? new Map<string, number>();
    byNoun.set(m[2], (byNoun.get(m[2]) ?? 0) + 1);
    counts.set(m[1], byNoun);
  }
  const parts = (['add', 'update', 'remove'] as const).filter((v) => counts.has(v)).map((v, i) => {
    const things = [...counts.get(v)!.entries()].map(([noun, n]) => `${countWord(n)} ${GRAPH_NOUN[noun]}${n === 1 ? '' : 's'}`);
    const verb = GRAPH_VERB[v];
    return `${i === 0 ? verb : verb.toLowerCase()} ${listWords(things)}`;
  });
  if (other > 0) parts.push(`${parts.length === 0 ? 'Makes' : 'makes'} ${countWord(other)} other change${other === 1 ? '' : 's'}`);
  return parts.join('; ') || 'No changes';
}

const sha7 = (v: unknown): string | null => (typeof v === 'string' && v.length >= 7 ? v.slice(0, 7) : null);

/** AL.2 (owner 2026-10-01): a canvas proposal said "N canvas changes" and
 *  "Architecture proposal, review and apply it in the canvas" whoever filed
 *  it and whatever it carried, decided or not. Now the heading names what
 *  it is (a repository import, task documents, a test plan, a design read
 *  from git, a commit reconciled, else the count) and the line says what it
 *  does: the import's own summary, the agent's explanation, or the ops
 *  counted. Pure. */
export function canvasCard(meta: Record<string, unknown> | null, entries: readonly Entry[]): { target: string; text: string } {
  const m = meta ?? {};
  const n = entries.length;
  const ops = graphOpsSentence(entries);
  const firstWords = (() => {
    const e = entries.find((x) => { const g = str(x.explanation); return !!g && g !== 'No explanation provided' && g !== str(x.patch?.metadata?.summary); });
    return e ? str(e.explanation) : null;
  })();
  const reconciles = (m.reconcilesChange ?? null) as AnyRec | null;
  if (reconciles) return { target: `Reconcile commit ${sha7(reconciles.commitSha) ?? ''}`.trim(), text: firstWords ?? ops };
  switch (m.source) {
    case 'repo-import':
      return { target: 'Repository import', text: str(m.summary) ?? `The architecture the import drew. ${ops}` };
    case 'mcp-task-docs': {
      const docs = entries.filter((e) => e.patch?.type === 'add_artifact' || e.patch?.type === 'update_artifact').length;
      return { target: 'Task documents', text: `${countWord(docs, true)} task document${docs === 1 ? '' : 's'}, written from the requirements and contracts on each node` };
    }
    case 'mcp-test-plan':
      return { target: `Test plan for ${str(m.requirementId) ?? 'a requirement'}`, text: 'The test plan file, written from the requirement, its criteria and the nodes it maps to, linked to the node it tests' };
    case 'git-load': {
      const at = sha7(((m.loadsModel ?? {}) as AnyRec).headSha);
      return { target: `Design from git${at ? ` at ${at}` : ''}`, text: ops };
    }
    case 'git-adopt': {
      const at = sha7(m.adoptHeadSha);
      return { target: `Design adopted from git${at ? ` at ${at}` : ''}`, text: ops };
    }
    default:
      return { target: `${countWord(n, true)} canvas change${n === 1 ? '' : 's'}`, text: firstWords ? `${firstWords}${n > 1 ? ` (${ops.charAt(0).toLowerCase()}${ops.slice(1)})` : ''}` : ops };
  }
}

function decidedLabelOf(status: string, meta: Record<string, unknown> | null): QueueItem['decidedLabel'] {
  if (status === 'pending') return null;
  if (status === 'rejected') return 'REJECTED';
  if (status === 'partial') return 'PARTIAL';
  if (status === 'merged') return meta?.auto === true ? 'APPLIED' : 'APPROVED';
  return null;
}

/** Rows → cards. Pending first (newest first within), then the decided
 *  tail — the review log the design dims. Pure. */
export function assembleQueueItems(rows: QueueRow[], labels: QueueLabels, laterByBranch: Map<string, LaterPatch[]> = new Map(), keyNames: ReadonlyMap<string, string> = new Map()): QueueItem[] {
  const items = rows.map((r) => {
    const entries = (Array.isArray(r.patches) ? r.patches : []) as Entry[];
    const kind = proposalKind({ patches: r.patches as never });
    const reviewInCanvas = kind === 'patch';
    // V3 2.1: what a refused accept stored, plus what base_sequence says now,
    // so the card says which patches before anyone approves.
    const stored = entries.map((e, i) => (e.status === 'conflicted' ? i : -1)).filter((i) => i >= 0);
    const base = typeof r.metadata?.baseSequence === 'number' ? (r.metadata.baseSequence as number) : null;
    const live = (r.status === 'pending' && reviewInCanvas && base !== null)
      ? conflictsSince(entries.map((e) => e.patch ?? {}), (laterByBranch.get(r.source_branch_id) ?? []).filter((l) => l.sequence > base))
      : [];
    const conflictedIdx = new Set<number>([...stored, ...live.map((c) => c.index)]);
    const conflictText = live.length > 0
      ? describeConflicts(live)
      : (stored.map((i) => entries[i].conflictReason).filter(Boolean).join(' ') || null);
    const first = entries[0];
    const canvas = reviewInCanvas ? canvasCard(r.metadata, entries) : null;
    const target = canvas
      ? canvas.target
      : (first ? targetOf(first, labels) : '—') + (entries.length > 1 ? ` +${entries.length - 1}` : '');
    // V3 3.1: a proposal filed from intents says what the agent wants in the
    // agent's own structured words; no explanation paragraph, no patch talk.
    const intents = Array.isArray(r.metadata?.intents) ? (r.metadata!.intents as Array<{ summary?: unknown }>) : [];
    const intentSummaries = intents.map((i) => (typeof i.summary === 'string' ? i.summary : null)).filter((x): x is string => !!x);
    const intentTitle = intentSummaries.length === 0 ? null
      : `Wants to ${intentSummaries.length === 1 ? intentSummaries[0] : `${intentSummaries.slice(0, -1).join(', ')}, and ${intentSummaries[intentSummaries.length - 1]}`}`;
    const firstPayload = (first?.patch?.payload ?? {}) as AnyRec;
    // A drafted outcome says how many criteria it brings before the agent's
    // reason: "Two criteria · found while reading 0001_init.sql: ...".
    const drafted = first?.patch?.type === 'create_candidate' && Array.isArray(firstPayload.criteria) ? (firstPayload.criteria as unknown[]).length : null;
    const text = intentTitle ?? (canvas
      ? canvas.text
      : (first ? `${drafted !== null ? `${countWord(drafted, true)} criteri${drafted === 1 ? 'on' : 'a'} · ` : ''}${describeEntry(first)}` : 'Empty proposal'));
    // AL.2: the reviewer's words on a decided proposal (resolve_proposal
    // writes resolveNote; the canvas reject wrote rejectionReason).
    const noteRaw = r.status !== 'pending' ? (str(r.metadata?.resolveNote) ?? str(r.metadata?.rejectionReason)) : null;
    const candidateId = typeof firstPayload.candidateId === 'string' ? firstPayload.candidateId : null;
    // 6.4: where a promotion lands (the payload's section, else the
    // candidate's node), and the lock the server would refuse on.
    const promotion = kind === 'promotion' && candidateId;
    return {
      proposalId: r.id,
      kind,
      status: r.status,
      pending: r.status === 'pending',
      decidedLabel: decidedLabelOf(r.status, r.metadata),
      target,
      origin: proposalOrigin(r.metadata, keyNames),
      text,
      patchCount: entries.length,
      conflicted: conflictedIdx.size,
      conflictText,
      candidateId,
      createdAt: r.created_at,
      reviewInCanvas,
      ...(promotion ? { landsOn: str(firstPayload.section), nodeId: labels.candidateNodes?.get(candidateId) ?? null } : {}),
      targetLocked: r.status === 'pending' && !reviewInCanvas ? lockedTargetOf(entries, labels) : null,
      note: noteRaw ? noteRaw.trim() : null,
      autoWait: r.status === 'pending' ? str((r.metadata?.autoWait as AnyRec | undefined)?.reason) : null,
    };
  });
  return items.sort((a, b) => (a.pending === b.pending ? b.createdAt.localeCompare(a.createdAt) : a.pending ? -1 : 1));
}

/** V3 4.1: candidate id → the pending promotion waiting on it (the first,
 *  oldest one when several agents asked), with who asked. Pure. */
export function pendingPromotions(items: readonly QueueItem[]): Map<string, { proposalId: string; agent: string }> {
  const out = new Map<string, { proposalId: string; agent: string }>();
  const pending = items.filter((i) => i.pending && i.kind === 'promotion' && i.candidateId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const i of pending) if (!out.has(i.candidateId!)) out.set(i.candidateId!, { proposalId: i.proposalId, agent: i.origin.label });
  return out;
}

/** The server's refusal text, if the thrown edge-function error wrapped one. */
export function serverErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const brace = msg.indexOf('{');
  if (brace >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(brace)) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    } catch { /* not JSON — fall through */ }
  }
  return msg;
}

export interface ApprovalsQueueApi {
  items: QueueItem[];
  pending: number;
  loading: boolean;
  error: string | null;
  busyId: string | null;
  /** 6.4: the REQ ref the next minting accept takes (the server's rule,
   *  mirrored by predictedRef over the specification's refs); null until read. */
  nextRequirementRef: string | null;
  refresh: () => Promise<void>;
  /** V3 4.3: one lane, every act. A proposal takes accept and reject; a plan
   *  accept (the server) and reject (6.3, the app's one plan write); an
   *  imported candidate accept and dismiss; a mapping confirm and move
   *  (with the node); a question is opened, never resolved here. */
  resolve: (itemId: string, action: QueueAct, payload?: { nodeId?: string; note?: string }) => Promise<{ ok: boolean; error?: string }>;
}

/** Q (owner 2026-09-22): what the account's plan carries. Below it the
 *  queue neither reads nor shows the paid lanes: no proposed plans
 *  (Priority), no import leftovers (repo import), no workflow proposals or
 *  their labels (Workflows). Omitted means every lane, as before. */
export interface QueuePlan {
  workflows: boolean; priority: boolean; repoImport: boolean;
  /** AJ.6: the lanes the example shows above the owner's plan: read only. */
  viewOnly?: { workflows?: boolean; priority?: boolean; repoImport?: boolean };
}
const EVERY_LANE: QueuePlan = { workflows: true, priority: true, repoImport: true };

/** The queue's plan from the app's feature gate; nothing while the plan is
 *  still loading (the queue re-reads once it resolves). */
export function queuePlanFrom(gate: { loading: boolean; can: (feature: Feature) => boolean; viewOnly?: (feature: Feature) => boolean }): QueuePlan {
  const readOnly = (f: Feature) => !gate.loading && !!gate.viewOnly?.(f);
  return {
    workflows: !gate.loading && gate.can('workflow_space'),
    priority: !gate.loading && gate.can('priority_board'),
    repoImport: !gate.loading && gate.can('repo_import'),
    viewOnly: { workflows: readOnly('workflow_space'), priority: readOnly('priority_board'), repoImport: readOnly('repo_import') },
  };
}

/** AJ.6: the feature a pending row belongs to, when the example shows that
 *  feature above the owner's plan; null when the row is the owner's to decide.
 *  A proposal is a workflow row when it shapes a workflow or touches a
 *  constraint (paidProposals); a plan row is the Plan's; an imported
 *  candidate, a mapping and an open question are the import's. Pure. */
export function viewOnlyFeature(item: Pick<QueueItem, 'proposalId' | 'source' | 'pending'>, readOnly: QueuePlan['viewOnly'], paidProposals: ReadonlySet<string>): Feature | null {
  if (!item.pending || !readOnly) return null;
  const source = item.source ?? 'proposal';
  if (source === 'plan') return readOnly.priority ? 'priority_board' : null;
  if (source === 'proposal') return readOnly.workflows && paidProposals.has(item.proposalId) ? 'workflow_space' : null;
  return readOnly.repoImport ? 'repo_import' : null;
}

/** A proposal that shapes a workflow (any workflow-kind patch). Pure. */
export function shapesWorkflow(patches: unknown): boolean {
  return (Array.isArray(patches) ? patches : []).some((e) => SPEC_PATCH_KIND[(e as Entry)?.patch?.type ?? ''] === 'workflow');
}

const CONSTRAINT_OPS = new Set(['create_constraint', 'update_constraint', 'delete_constraint']);
/** AC: a proposal that files, changes or retires a constraint. Pure. */
export function touchesConstraint(patches: unknown): boolean {
  return (Array.isArray(patches) ? patches : []).some((e) => CONSTRAINT_OPS.has((e as Entry)?.patch?.type ?? ''));
}

interface QueueData {
  base: QueueItem[];
  paidProposals: ReadonlySet<string>;
  nextRequirementRef: string | null;
}

const NO_QUEUE: QueueData = { base: [], paidProposals: new Set(), nextRequirementRef: null };

/** One read of everything waiting on a decision. Throws on a failed read; the
 *  shared entry keeps the list it last showed and carries the error. */
async function loadQueue(projectId: string, planWorkflows: boolean, planPriority: boolean, planImport: boolean): Promise<QueueData> {
  const supabase = getSupabaseClient();
  const { data: branches } = await supabase.from('branches').select('id').eq('project_id', projectId);
  const branchIds = ((branches ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (branchIds.length === 0) return NO_QUEUE;
  const { data: rowsRaw, error: readErr } = await supabase
    .from('ai_proposals')
    .select('id, source_branch_id, status, patches, metadata, created_at, reviewed_at')
    .in('source_branch_id', branchIds)
    .in('status', ['pending', 'merged', 'rejected', 'partial'])
    .order('created_at', { ascending: false })
    .limit(QUEUE_LOG_LIMIT);
  if (readErr) throw readErr;
  // Below Indie a proposal that shapes a workflow or touches a constraint
  // (one filed on a paid plan) is not shown: neither exists on the plan.
  const rows = ((rowsRaw ?? []) as QueueRow[]).filter((r) => planWorkflows || (!shapesWorkflow(r.patches) && !touchesConstraint(r.patches)));

  // V3 2.1: the patches appended after each pending graph proposal's
  // read, one select per branch, only when a proposal carries a base.
  const laterByBranch = new Map<string, LaterPatch[]>();
  const withBase = rows.filter((r) => r.status === 'pending' && typeof r.metadata?.baseSequence === 'number');
  for (const branchId of new Set(withBase.map((r) => r.source_branch_id))) {
    const minBase = Math.min(...withBase.filter((r) => r.source_branch_id === branchId).map((r) => r.metadata!.baseSequence as number));
    const { data: later } = await supabase
      .from('graph_patches')
      .select('sequence, patch_type, payload, actor_type, summary')
      .eq('branch_id', branchId)
      .gt('sequence', minBase)
      .order('sequence', { ascending: true })
      .limit(500);
    laterByBranch.set(branchId, ((later ?? []) as PatchRowLike[]).map(laterPatchFromRow));
  }

  // Targets by name, one select per table, only what the rows reference.
  const candidateIds = new Set<string>();
  const reqRefs = new Set<string>();
  const workflowIds = new Set<string>();
  const stepIds = new Set<string>();
  const constraintIds = new Set<string>();
  for (const r of rows) {
    for (const e of (Array.isArray(r.patches) ? r.patches : []) as Entry[]) {
      const p = (e.patch?.payload ?? {}) as AnyRec;
      const t = e.patch?.type ?? '';
      if (typeof p.candidateId === 'string') candidateIds.add(p.candidateId);
      for (const k of ['requirementId', 'fromRequirementId', 'toRequirementId']) if (typeof p[k] === 'string') reqRefs.add(p[k] as string);
      if ((t === 'upsert_workflow' || t === 'delete_workflow') && typeof p.id === 'string') workflowIds.add(p.id);
      if ((t === 'upsert_workflow_step' || t === 'delete_workflow_step') && typeof p.id === 'string') stepIds.add(p.id);
      if ((t === 'update_constraint' || t === 'delete_constraint') && typeof p.constraintId === 'string') constraintIds.add(p.constraintId);
    }
  }
  const labels: QueueLabels = { candidates: new Map(), requirements: new Map(), workflows: new Map(), steps: new Map(), candidateNodes: new Map(), lockedRequirements: new Map(), constraints: new Map() };
  if (constraintIds.size > 0) {
    const { data } = await supabase.from('project_constraints').select('id, title, description').in('id', [...constraintIds]);
    for (const c of (data ?? []) as Array<{ id: string; title: string | null; description: string }>) labels.constraints!.set(c.id, c.title || c.description);
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (candidateIds.size > 0) {
    // 6.4: the node too, so a promotion can say where it lands.
    const { data } = await supabase.from('requirement_candidates').select('id, name, node_id').in('id', [...candidateIds]);
    for (const c of (data ?? []) as Array<{ id: string; name: string | null; node_id: string | null }>) {
      if (c.name) labels.candidates.set(c.id, c.name);
      if (c.node_id) labels.candidateNodes!.set(c.id, c.node_id);
    }
  }
  const reqUuids = [...reqRefs].filter((x) => UUID.test(x));
  const reqCodes = [...reqRefs].filter((x) => !UUID.test(x));
  type ReqLabelRow = { id: string; requirement_id: string | null; name: string | null; locked?: boolean | null };
  const noteReq = (r: ReqLabelRow) => {
    const label = `${r.requirement_id ?? ''}${r.name ? ` · ${r.name}` : ''}`.trim() || r.id;
    labels.requirements.set(r.id, label);
    if (r.requirement_id) labels.requirements.set(r.requirement_id, label);
    // 6.4: a locked target is said before the click, not after the refusal.
    if (r.locked === true) {
      const hit = { ref: r.requirement_id ?? r.id, rowId: r.id };
      labels.lockedRequirements!.set(r.id, hit);
      if (r.requirement_id) labels.lockedRequirements!.set(r.requirement_id, hit);
    }
  };
  if (reqUuids.length > 0) {
    const { data } = await supabase.from('specification_requirements').select('id, requirement_id, name, locked').in('id', reqUuids);
    for (const r of (data ?? []) as ReqLabelRow[]) noteReq(r);
  }
  if (reqCodes.length > 0) {
    const { data } = await supabase.from('specification_requirements').select('id, requirement_id, name, locked').in('requirement_id', reqCodes);
    for (const r of (data ?? []) as ReqLabelRow[]) noteReq(r);
  }
  if (planWorkflows && workflowIds.size > 0) {
    const { data } = await supabase.from('workflows').select('id, name').in('id', [...workflowIds]);
    for (const w of (data ?? []) as Array<{ id: string; name: string | null }>) if (w.name) labels.workflows.set(w.id, w.name);
  }
  if (planWorkflows && stepIds.size > 0) {
    const { data } = await supabase.from('workflow_steps').select('id, name').in('id', [...stepIds]);
    for (const s of (data ?? []) as Array<{ id: string; name: string | null }>) if (s.name) labels.steps.set(s.id, s.name);
  }
  // V3 4.3: what the import leaves for a person, and the proposed plan. One
  // select each; none touches an engine. AL.21 (owner 2026-10-03): the
  // import's open questions are not listed here; Architecture shows each on
  // its node.
  // Q: below the plan, the paid lanes are not read at all.
  const none = Promise.resolve({ data: null });
  const [candRes, specRes, planRes] = await Promise.all([
    // AL.24: an accepted candidate has derived its requirement (it stays
    // pending until settled in Work): nothing is left to decide here.
    planImport ? supabase.from('requirement_candidates').select('id, name, description, kind, key, node_id, criteria, evidence, created_at').eq('project_id', projectId).eq('status', 'pending').neq('kind', 'outcome').is('requirement_row_id', null) : none,
    supabase.from('project_specifications').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    planPriority ? supabase.from('work_plans').select('id, version, summary, proposed_by, created_at, source_hash, branch_id').in('branch_id', branchIds).eq('status', 'proposed').order('version', { ascending: false }) : none,
  ]);
  let mappingRows: MappingQueueRow[] = [];
  let nextRef: string | null = null;
  if (specRes.data?.id) {
    const [{ data: maps }, { data: refs }] = await Promise.all([
      supabase.from('specification_mappings').select('id, requirement_id, node_id, notes, confidence, created_at').eq('specification_id', specRes.data.id).eq('validation_status', 'needs-review'),
      // 6.4: every ref on the specification, so the cards can say which REQ the next accept mints.
      supabase.from('specification_requirements').select('requirement_id').eq('specification_id', specRes.data.id),
    ]);
    nextRef = predictedRef(((refs ?? []) as Array<{ requirement_id: string | null }>).map((x) => x.requirement_id ?? ''));
    mappingRows = (maps ?? []) as MappingQueueRow[];
    const missing = mappingRows.map((m) => m.requirement_id).filter((id): id is string => !!id && !labels.requirements.has(id));
    if (missing.length > 0) {
      const { data } = await supabase.from('specification_requirements').select('id, requirement_id, name, locked').in('id', missing);
      for (const r of (data ?? []) as ReqLabelRow[]) noteReq(r);
    }
  } else {
    // No specification yet: the first accept creates it and mints REQ-001.
    nextRef = predictedRef([]);
  }
  // 6.4: how many items each proposed plan orders, one select for all of them.
  const planRows = (planRes.data ?? []) as PlanQueueRow[];
  const planItemCounts = new Map<string, number>();
  if (planRows.length > 0) {
    const { data: planItems } = await supabase.from('work_plan_items').select('plan_id').in('plan_id', planRows.map((p) => p.id));
    for (const it of (planItems ?? []) as Array<{ plan_id: string }>) planItemCounts.set(it.plan_id, (planItemCounts.get(it.plan_id) ?? 0) + 1);
  }
  // O.2: the identity a card shows is the CREDENTIAL that filed it. Rows
  // the server stamped carry credentialLabel; older rows carry the key id,
  // resolved here through the same one select the roster makes (RLS
  // returns the person's own keys; another member's stay an id prefix).
  const keyNames = new Map<string, string>();
  const keyIds = new Set<string>();
  for (const r of rows) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    if (typeof m.apiKeyId === 'string' && m.apiKeyId) keyIds.add(m.apiKeyId);
    if (typeof m.credential === 'string' && m.credential.startsWith('key:')) keyIds.add(m.credential.slice(4));
  }
  for (const pr of planRows) if (typeof pr.proposed_by === 'string' && pr.proposed_by.startsWith('key:')) keyIds.add(pr.proposed_by.slice(4));
  if (keyIds.size > 0) {
    const { data: keys } = await supabase.from('mcp_api_keys').select('id, name').in('id', [...keyIds]);
    for (const k of (keys ?? []) as Array<{ id: string; name: string | null }>) if (k.name) keyNames.set(k.id, k.name);
  }
  return {
    paidProposals: new Set(rows.filter((r) => shapesWorkflow(r.patches) || touchesConstraint(r.patches)).map((r) => r.id)),
    base: [
    ...assembleQueueItems(rows, labels, laterByBranch, keyNames),
    ...assembleCandidateItems((candRes.data ?? []) as CandidateQueueRow[]),
    ...assembleMappingItems(mappingRows, labels),
    ...assemblePlanItems(planRows, planItemCounts, keyNames),
    ],
    nextRequirementRef: nextRef,
  };
}

export function useApprovalsQueue(projectId: string | null | undefined, plan: QueuePlan = EVERY_LANE): ApprovalsQueueApi {
  const { workflows: planWorkflows, priority: planPriority, repoImport: planImport } = plan;
  const roWorkflows = !!plan.viewOnly?.workflows, roPriority = !!plan.viewOnly?.priority, roImport = !!plan.viewOnly?.repoImport;
  // AL.20: the Agents panel and Work share one queue per project and plan,
  // read on one timer that waits while the tab is hidden and slows to a
  // minute while nothing changes.
  const { data, loading, error, refresh } = useSharedPoll<QueueData>({
    key: projectId ? `queue:${projectId}:${planWorkflows ? 1 : 0}${planPriority ? 1 : 0}${planImport ? 1 : 0}` : null,
    load: () => loadQueue(projectId as string, !!planWorkflows, !!planPriority, !!planImport),
    empty: NO_QUEUE,
    intervalMs: QUEUE_REFRESH_MS,
    maxBackoff: 2,
  });
  const { base, paidProposals, nextRequirementRef } = data;
  const items = useMemo(() => {
    const readOnly = { workflows: roWorkflows, priority: roPriority, repoImport: roImport };
    return base.map((q) => {
      const f = viewOnlyFeature(q, readOnly, paidProposals);
      return f ? { ...q, viewOnly: f, acts: [] } : q;
    });
  }, [base, roWorkflows, roPriority, roImport, paidProposals]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The decision: the SAME tool an agent calls, with the user's session — the
  // direct request path ({ tool, arguments }, Authorization: Bearer <jwt>).
  // resolve_proposal is where promote/settle are accepted at all (R6/R7).
  const resolve = useCallback(async (itemId: string, action: QueueAct, payload: { nodeId?: string; note?: string } = {}) => {
    if (!projectId) return { ok: false, error: 'No project selected.' };
    const item = items.find((i) => i.proposalId === itemId);
    const source = item?.source ?? 'proposal';
    setBusyId(itemId);
    try {
      if (source === 'candidate') {
        // The same channel an agent uses (backfill_requirements decide), with the user's session.
        if (action !== 'accept' && action !== 'dismiss') return { ok: false, error: 'An imported candidate is accepted or dismissed.' };
        const r = await callEdgeFunction<{ success: boolean; error?: string; data?: { failed?: Array<{ candidateId?: string; error?: string }> } }>('mcp-server', {
          tool: 'backfill_requirements',
          arguments: { project_id: projectId, ...(action === 'accept' ? { accept: [itemId] } : { dismiss: [itemId] }) },
        });
        // 6.4: the reason is in data.failed[].error; the count sentence in
        // `error` is not a reason.
        if (!r.success) return { ok: false, error: decisionRefusal(r, 'The server refused the decision.') };
      } else if (source === 'mapping') {
        // V3 4.3: the one new app-side write. Confirm keeps the node; move
        // takes the node the user chose. Either way the status is valid and
        // the provenance says a person decided it here.
        if (action !== 'confirm' && action !== 'move') return { ok: false, error: 'A mapping is confirmed or moved.' };
        if (action === 'move' && !payload.nodeId) return { ok: false, error: 'Choose the node to move the mapping to.' };
        const supabase = getSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();
        const provenance = { source: 'ui', actor: user?.email ?? user?.id ?? 'owner', at: new Date().toISOString(), note: action === 'move' ? 'moved under Proposals' : 'confirmed under Proposals' };
        // AL.24: only while it still needs review: a second decision (another
        // tab, a teammate) never moves a mapping someone just confirmed.
        const { data: decided, error: err } = await supabase
          .from('specification_mappings')
          .update({ validation_status: 'valid', validation_provenance: provenance, ...(action === 'move' ? { node_id: payload.nodeId } : {}) })
          .eq('id', itemId)
          .eq('validation_status', 'needs-review')
          .select('id');
        if (err) return { ok: false, error: err.message };
        if (!Array.isArray(decided) || decided.length === 0) return { ok: false, error: 'This mapping was already decided. Look again to see how.' };
      } else if (source === 'plan') {
        if (action === 'reject') {
          // 6.3: the one app-side write on a plan: proposed to rejected, under
          // the policy migration 20260921110000 added. Accepting stays the
          // server's (the source hash is checked there).
          const { data, error: err } = await getSupabaseClient()
            .from('work_plans').update({ status: 'rejected', updated_at: new Date().toISOString() })
            .eq('id', itemId).eq('status', 'proposed').select('id').maybeSingle();
          if (err) return { ok: false, error: err.message };
          if (!data) return { ok: false, error: 'That plan is no longer proposed.' };
        } else {
          if (action !== 'accept') return { ok: false, error: 'A proposed plan is accepted or rejected.' };
          const r = await callEdgeFunction<{ success: boolean; error?: string }>('mcp-server', {
            tool: 'accept_work_plan',
            arguments: { project_id: projectId, plan_id: itemId },
          });
          if (!r.success) return { ok: false, error: r.error ?? 'The plan was not accepted.' };
        }
      } else {
        if (action !== 'accept' && action !== 'reject') return { ok: false, error: 'A proposal is accepted or rejected.' };
        const r = await callEdgeFunction<{ success: boolean; error?: string }>('mcp-server', {
          tool: 'resolve_proposal',
          // R.2c: the reviewer's reason rides the reject; the agent reads it back.
          arguments: { project_id: projectId, proposal_id: itemId, action, ...(action === 'reject' && payload.note ? { note: payload.note } : {}) },
        });
        if (!r.success) return { ok: false, error: r.error ?? 'The server refused the decision.' };
      }
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: serverErrorText(err) };
    } finally {
      setBusyId(null);
    }
  }, [projectId, items, refresh]);

  return { items, pending: items.filter((i) => i.pending).length, loading, error, busyId, nextRequirementRef, refresh, resolve };
}
