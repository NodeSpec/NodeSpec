// V3 8.1: which lane a proposal resolves in. The APP mirror of the server's
// approval-kind table (supabase/functions/_shared/spec-patch-schema.ts,
// SPEC_PATCH_KIND — cross-pinned in approvals-queue.test.ts) so the queue
// labels a proposal exactly as the server routes it: every spec op resolves
// server-side through resolve_proposal (the approvals queue); any graph op
// makes it a canvas proposal (ChangesPanel → ImportReviewPanel), which the
// server refuses to resolve. Promotion ops are the human act (R6) and get
// their own display kind.
import type { AIProposal } from '@nodespec/core/ai-proposal.js';
import { oauthClientName } from '../../../supabase/functions/_shared/oauth-client.js';

export type ApprovalKind = 'requirement' | 'outcome' | 'patch' | 'workflow';

/** Every spec op's approval kind — rows, not branches. */
export const SPEC_PATCH_KIND: Readonly<Record<string, ApprovalKind>> = {
  create_requirement: "requirement",
  update_requirement: "requirement",
  delete_requirement: "requirement",
  update_vision: "requirement",
  map_requirement: "requirement",
  relate_requirements: "requirement",
  create_constraint: "requirement",
  update_constraint: "requirement",
  delete_constraint: "requirement",
  create_candidate: "outcome",
  update_candidate: "outcome",
  dismiss_candidate: "outcome",
  promote_candidate: "outcome",
  attach_candidate: "outcome",
  settle_candidate: "outcome",
  upsert_workflow: "workflow",
  delete_workflow: "workflow",
  upsert_workflow_step: "workflow",
  delete_workflow_step: "workflow",
  set_outcome_step_maps: "workflow",
};

/** Approval kind for ANY proposal patch: spec ops by table, graph ops = 'patch'. */
export function patchKindOf(type: string): ApprovalKind {
  return SPEC_PATCH_KIND[type] ?? 'patch';
}

/** Crossing the promotion line is a human act at EVERY autonomy level (R6). */
export const NEVER_AUTO_APPLY: ReadonlySet<string> = new Set(['promote_candidate', 'attach_candidate', 'settle_candidate']);

/** The queue's display kinds: the four approval kinds plus PROMOTION for
 *  proposals that cross the line (the design's queued promotions), CONTEXT
 *  for the import's backfill proposal, and (V3 4.3) the three things the
 *  import leaves for a person plus the proposed work plan: IMPORTED
 *  candidates, MAPPINGS to review, open QUESTIONS, a PLAN waiting. */
export type QueueKind = ApprovalKind | 'promotion' | 'context' | 'imported' | 'mapping' | 'question' | 'plan';

/** V3 4.3: who left the item. Proposals and plans come from agents; the
 *  candidates, mappings and questions were left by the import. */
export type QueueOrigin = 'agents' | 'import';

export const QUEUE_ORIGIN_OF: Readonly<Record<QueueKind, QueueOrigin>> = {
  requirement: 'agents', outcome: 'agents', patch: 'agents', workflow: 'agents', promotion: 'agents', context: 'agents', plan: 'agents',
  imported: 'import', mapping: 'import', question: 'import',
};

export const QUEUE_ORIGIN_LABEL: Readonly<Record<QueueOrigin, string>> = {
  agents: 'From your agents',
  import: 'From your repository',
};

/** The agents section names the agent when one agent filed everything in
 *  it ("From claude-code"); several, or a teammate beside an agent (AL.2:
 *  the heading named the agent over a teammate's card), fall back to the
 *  generic heading. Pure. */
export function originSectionLabel(origin: QueueOrigin, items: ReadonlyArray<{ origin?: { kind: string; label: string } }>): string {
  if (origin !== 'agents') return QUEUE_ORIGIN_LABEL[origin];
  const who = new Set(items.map((i) => i.origin).filter((o): o is { kind: string; label: string } => !!o).map((o) => `${o.kind}:${o.label}`));
  const only = who.size === 1 ? [...who][0] : null;
  return only && only.startsWith('agent:') ? `From ${only.slice('agent:'.length)}` : QUEUE_ORIGIN_LABEL.agents;
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Small counts as words, the way the design writes them ("Nine things",
 *  "Two criteria"); thirteen and up stay digits. Pure. */
export function countWord(n: number, capital = false): string {
  const w = n >= 0 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/** 9.6: a CONTEXT proposal is the brownfield backfill in one decision: the
 *  vision draft together with the lanes, steps or outcomes read from the
 *  imported repository. It is the shape get_import_context asks the agent
 *  to file (update_vision + upsert_workflow / upsert_workflow_step /
 *  create_candidate in ONE propose_patches call). A vision alone stays a
 *  requirement-kind change; a lane alone stays a workflow change. */
const CONTEXT_COMPANIONS: ReadonlySet<string> = new Set(['upsert_workflow', 'upsert_workflow_step', 'create_candidate', 'set_outcome_step_maps']);

export function isContextProposal(types: readonly string[]): boolean {
  return types.includes('update_vision') && types.some((t) => CONTEXT_COMPANIONS.has(t));
}

type PatchEntry = { patch?: { type?: unknown } };

export function patchTypesOf(p: Pick<AIProposal, 'patches'>): string[] {
  return (Array.isArray(p.patches) ? (p.patches as unknown as PatchEntry[]) : [])
    .map((e) => String(e?.patch?.type ?? ''));
}

/** Every patch is a spec op → the server resolves it. Any graph op (or an
 *  empty proposal) → the canvas lane. */
export function isSpecPlaneProposal(p: Pick<AIProposal, 'patches'>): boolean {
  const types = patchTypesOf(p);
  return types.length > 0 && types.every((t) => t in SPEC_PATCH_KIND);
}

export function proposalKind(p: Pick<AIProposal, 'patches'>): QueueKind {
  const types = patchTypesOf(p);
  if (types.length === 0 || types.some((t) => !(t in SPEC_PATCH_KIND))) return 'patch';
  if (types.some((t) => NEVER_AUTO_APPLY.has(t))) return 'promotion';
  if (isContextProposal(types)) return 'context';
  return patchKindOf(types[0]);
}

export interface ProposalOrigin {
  kind: 'agent' | 'human';
  /** What the person sees. O.2: the proven credential (the key's name) when
   *  the row carries one; the self-declared nickname only for rows written
   *  before the server stamped credentials. */
  label: string;
  /** The agent's self-declared `external_agent`, when it differs from the
   *  label. Claimed, never proven: a tooltip, not an identity. */
  nickname?: string;
}

/** Who filed it. The channel decides (R7): a JWT session is a human, every
 *  delegate credential is an agent. Owner edition has one human; Team (7.0)
 *  names the member and enforces proposer ≠ approver (R6). */
/** The fallback literals older rows carried when the agent sent no nickname.
 *  None of them is an identity. */
const NOT_A_NAME = new Set(['unknown', 'unknown agent', 'external-mcp-agent', 'agent']);

/** Mirror of the server's credentialLabel (mcp-server/shared.ts) for a
 *  delegate id: 'key · <name or id prefix>', 'oauth · <client>'. */
function delegateLabel(delegate: string, keyNames: ReadonlyMap<string, string>): string | null {
  if (delegate.startsWith('key:')) { const id = delegate.slice(4); return `key · ${keyNames.get(id) ?? id.slice(0, 8)}`; }
  if (delegate.startsWith('oauth:')) { const rest = delegate.slice(6); return `oauth · ${oauthClientName(rest.slice(rest.indexOf(':') + 1))}`; }
  return null;
}

/** AL.2: rows no agent filed, named by what wrote them: the repository
 *  import's draft, and a design read from git. */
const SOURCE_LABEL: Readonly<Record<string, string>> = { 'repo-import': 'the import', 'git-load': 'git', 'git-adopt': 'git' };

/** O.2 (owner 2026-09-22): the identity shown is the CREDENTIAL that filed
 *  the proposal, never the nickname. Rows the server stamped carry
 *  `credentialLabel`; older rows carry `credential` or `apiKeyId`, resolved
 *  through the key-name map the roster already fetches; rows with neither
 *  fall back to the nickname the agent gave, then to "agent". */
export function proposalOrigin(meta: Record<string, unknown> | null | undefined, keyNames: ReadonlyMap<string, string> = new Map()): ProposalOrigin {
  const m = meta ?? {};
  const nick = typeof m.externalAgent === 'string' && m.externalAgent.trim() && !NOT_A_NAME.has(m.externalAgent.trim().toLowerCase())
    ? m.externalAgent.trim() : null;
  // AE.7: a teammate's edit from the app files as their session and names
  // them (their sign-in email); an unnamed session stays 'human · session'.
  const stamped = typeof m.credentialLabel === 'string' && m.credentialLabel.trim() ? m.credentialLabel.trim() : null;
  // AL.2: a session's stamped label is the person's sign-in email.
  if (m.authMethod === 'jwt') return { kind: 'human', label: nick ?? stamped ?? 'human · session' };
  const fromDelegate = typeof m.credential === 'string' && m.credential ? delegateLabel(m.credential, keyNames) : null;
  const fromKeyId = typeof m.apiKeyId === 'string' && m.apiKeyId ? delegateLabel(`key:${m.apiKeyId}`, keyNames) : null;
  const fromSource = typeof m.source === 'string' ? SOURCE_LABEL[m.source] ?? null : null;
  const label = stamped ?? fromDelegate ?? fromKeyId ?? nick ?? fromSource ?? 'agent';
  return nick && nick !== label ? { kind: 'agent', label, nickname: nick } : { kind: 'agent', label };
}

// ─── R13: one approvals surface ────────────────────────────────────────────
// The board had two places that said a change was waiting: the queue panel,
// and the "AGENT ON THIS OUTCOME" card in the Workflow inspector, which
// announced "waiting for your approval" and offered no way to approve. Two
// vocabularies for one fact, and only one of them could act on it.
//
// These helpers give the single surface its shape: what is WAITING, split by
// what kind of change it is, and what has been DECIDED, which is the history.

/** The order categories are shown in: the decisions that change the spec come
 *  before the ones that change how work is organised. */
export const QUEUE_KIND_ORDER: readonly QueueKind[] = ['promotion', 'context', 'plan', 'requirement', 'outcome', 'workflow', 'patch', 'imported', 'mapping', 'question'];

/** Plural headings. A category is only drawn when it has something in it, so
 *  these never appear with a zero beside them. */
export const QUEUE_KIND_LABEL: Readonly<Record<QueueKind, string>> = {
  promotion: 'Promotions',
  context: 'Context backfill',
  requirement: 'Requirements',
  outcome: 'Outcomes',
  workflow: 'Workflow steps',
  patch: 'Canvas changes',
  plan: 'Work plans',
  imported: 'Imported candidates',
  mapping: 'Mappings to review',
  question: 'Open questions',
};

export interface QueueGroup<T> { kind: QueueKind; label: string; items: T[] }

export interface QueueOriginSection<T> { origin: QueueOrigin; label: string; groups: QueueGroup<T>[]; count: number }

/** V3 4.3: the waiting list in its two origin sections, each grouped by
 *  kind in QUEUE_KIND_ORDER. A section with nothing in it is not drawn. Pure. */
export function splitByOrigin<T extends { kind: QueueKind; pending: boolean; createdAt: string; origin?: { kind: string; label: string } }>(items: T[]): QueueOriginSection<T>[] {
  const { waiting } = splitQueue(items);
  const out: QueueOriginSection<T>[] = [];
  for (const origin of ['agents', 'import'] as const) {
    const groups = waiting.filter((g) => QUEUE_ORIGIN_OF[g.kind] === origin);
    if (groups.length > 0) out.push({ origin, label: originSectionLabel(origin, groups.flatMap((g) => g.items)), groups, count: groups.reduce((n, g) => n + g.items.length, 0) });
  }
  return out;
}

export interface QueueSplit<T> {
  /** Still to decide, grouped by kind in QUEUE_KIND_ORDER. */
  waiting: QueueGroup<T>[];
  /** Already decided, newest first. The review log. */
  history: T[];
  waitingCount: number;
}

/** Split the queue into what needs a decision and what already got one.
 *  Pure, so the panel can be a renderer and this can be tested on its own. */
export function splitQueue<T extends { kind: QueueKind; pending: boolean; createdAt: string }>(items: T[]): QueueSplit<T> {
  const waiting: QueueGroup<T>[] = [];
  for (const kind of QUEUE_KIND_ORDER) {
    const inKind = items.filter((i) => i.pending && i.kind === kind);
    if (inKind.length > 0) {
      waiting.push({ kind, label: QUEUE_KIND_LABEL[kind], items: inKind });
    }
  }
  const history = items.filter((i) => !i.pending).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { waiting, history, waitingCount: items.filter((i) => i.pending).length };
}
