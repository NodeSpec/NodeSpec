// V3 8.1 → R13 → R17 (owner 2026-09-16): approvals are SECTIONS of the
// Changes panel, not a surface of their own.
//
// R13 collapsed two approval surfaces into one panel; the owner then pointed
// at the panel itself: it was still a separate popup living beside the header
// Changes view, which also lists pending work. Two doors to one room. So the
// dialog chrome is gone and what remains are the two halves the Changes panel
// mounts directly:
//
//   ApprovalsWaiting   everything that needs a decision, grouped by what kind
//                      of change it is, each category saying what deciding it
//                      does. Canvas changes carry Review (the side review
//                      panel is their lane); everything else approves and
//                      rejects inline through resolve_proposal.
//   ApprovalsHistory   every decision, newest first, auto-applied included —
//                      the review log, rendered inside the panel's History
//                      tab above the applied patch log.
//
// Decisions go through useApprovalsQueue.resolve (the server's
// resolve_proposal with the user's session); the caller refreshes the boards
// so a derivation shows at once.
//
// V3 6.4 (owner 2026-09-21, board P3): the act carries the consequence.
// Every primary button names what accepting does ("Accept as REQ-011 on
// S05", "Accept plan v1", "Keep on Axolotl body controller", "Add the edge
// from S06"); a refusal shows on the card, word for word, where the click
// was; a refusal the app can predict (a locked target) is said before the
// click, with the door in place of Accept.
import { memo, useMemo, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { statusTones } from './status-tones.js';
import { acceptLabel, lockedLine, unlockDoorLabel, type ApprovalsQueueApi, type QueueItem, type QueueAct } from './useApprovalsQueue.js';
import { splitQueue, splitByOrigin, type QueueKind, type QueueOrigin } from '../../utils/proposal-plane.js';
import { eyebrow, meta, stateWord, sentenceCase, identifier, title } from './typography.js';
import type { WorkTarget } from '../work/work-focus.js';
import { ViewOnlyNote } from '../common/ExampleNote.js';

/** The design's aside beside the list, folded into a chip row so it fits
 *  the side panel: All, one chip per origin, and the autonomy settings (the
 *  same overlay the header's Agents button opens). */
export type ProposalsFilter = 'all' | QueueOrigin;


function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface CardCtx {
  queue: ApprovalsQueueApi;
  focusProposalId?: string | null;
  onReviewCanvas?: (proposalId: string) => void;
  onDecided?: (item: QueueItem, action: QueueAct) => void;
  /** V3 4.3: node id → label, for a mapping's node and its move target. */
  nodeLabels?: Map<string, string>;
  /** A promotion can be read on its own page (the design's One decision);
   *  6.4: the card decides inline either way and offers "Read it first"
   *  beside the acts when the page exists. */
  onReadDecision?: (proposalId: string) => void;
  /** 6.4: the door a locked target opens: Work, on that requirement's record.
   *  6.3: a plan's See the diff opens Work's Plan tab with the diff shown. */
  onOpenWork?: (target: WorkTarget) => void;
}

function useKindStyle() {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const purple = theme.mode === 'dark' ? '#c07ae0' : '#7a3fa0';
  return (k: QueueKind): [string, string] => ({
    requirement: [tones.ok, `${tones.ok}22`],
    patch: [purple, `${purple}24`],
    outcome: [c.primary, `${c.primary}1f`],
    workflow: [tones.warn, `${tones.warn}24`],
    promotion: [c.primary, `${c.primary}1f`],
    context: [purple, `${purple}24`],
    plan: [c.primary, `${c.primary}1f`],
    imported: [tones.warn, `${tones.warn}24`],
    mapping: [tones.warn, `${tones.warn}24`],
  } as Record<QueueKind, [string, string]>)[k];
}

function ApprovalCard({ q, ctx }: { q: QueueItem; ctx: CardCtx }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const kindStyle = useKindStyle();
  const [kf, kb] = kindStyle(q.kind);
  const busy = ctx.queue.busyId === q.proposalId;
  const focused = ctx.focusProposalId === q.proposalId;
  const [moveTo, setMoveTo] = useState('');
  // 6.4: the refusal lives on the card that was clicked, in the server's words.
  const [refusal, setRefusal] = useState<string | null>(null);
  // R.2c: rejecting an agent's proposal asks why (optional); the agent reads
  // the note and may file it as a standing constraint for the user to accept.
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const asksWhy = (q.source ?? 'proposal') === 'proposal';
  const acts = q.acts ?? (q.reviewInCanvas ? [] : ['accept', 'reject']);
  const nodeLabel = (id: string | null | undefined) => (id ? (ctx.nodeLabels?.get(id) ?? id.slice(0, 8)) : 'no node');
  const heading = q.kind === 'promotion' ? `Make "${q.target}" a requirement` : q.target;
  const line = q.text;
  // Where a minting accept lands: the payload's section, else the row's node.
  const place = q.landsOn ?? (q.nodeId && ctx.nodeLabels?.has(q.nodeId) ? ctx.nodeLabels.get(q.nodeId)! : null);
  const accept = acceptLabel(q, ctx.queue.nextRequirementRef, place);
  const locked = q.pending ? q.targetLocked ?? null : null;

  const decide = async (action: QueueAct, payload?: { nodeId?: string; note?: string }) => {
    setRefusal(null);
    const r = await ctx.queue.resolve(q.proposalId, action, payload);
    if (!r.ok) { setRefusal(r.error ?? 'The decision did not apply.'); return; }
    ctx.onDecided?.(q, action);
  };
  const primaryAct: React.CSSProperties = { border: 'none', borderRadius: '7px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, backgroundColor: c.primary, color: '#fff', cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1 };
  const quietAct: React.CSSProperties = { border: `1px solid ${c.border}`, borderRadius: '7px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: c.textSecondary, cursor: busy ? 'wait' : 'pointer' };

  return (
    <div
      data-testid="approval-card"
      data-kind={q.kind}
      data-status={q.status}
      data-focused={focused ? 'true' : undefined}
      style={{
        display: 'flex', gap: '10px', padding: '10px 14px',
        borderBottom: `1px solid ${c.border}`,
        backgroundColor: focused ? `${c.primary}12` : 'transparent',
        boxShadow: focused ? `inset 3px 0 0 ${c.primary}` : 'none',
      }}
    >
      <span style={{ width: '7px', height: '7px', borderRadius: '2px', backgroundColor: kf, flexShrink: 0, marginTop: '5px' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ ...eyebrow(kf), letterSpacing: '0.06em', backgroundColor: kb, borderRadius: '4px', padding: '1px 5px' }}>
            {q.kind}
          </span>
          <span data-testid="approval-heading" style={{ fontSize: '11.5px', fontWeight: 600, color: c.text }}>{heading}</span>
          <span data-testid="approval-origin" title={q.origin.nickname ? `Calls itself "${q.origin.nickname}"` : undefined} style={{ fontSize: '11px', fontWeight: 500, color: c.textSecondary }}>{q.origin.label}</span>
          <span style={{ fontSize: '11px', color: c.textSecondary, opacity: .8 }}>{whenLabel(q.createdAt)}</span>
          {(q.conflicted ?? 0) > 0 && (
            <span data-testid="approval-conflicted" title={q.conflictText ?? undefined} style={stateWord(tones.warn)}>
              {q.conflicted} conflicted
            </span>
          )}
        </div>
        <div style={{ fontSize: '11.5px', lineHeight: 1.45, color: c.textSecondary, marginTop: '3px' }}>{line}</div>
        {q.pending && q.autoWait && (
          <div data-testid="approval-autowait" style={{ fontSize: '11.5px', lineHeight: 1.45, color: c.text, marginTop: '3px' }}>Waits for you under Auto: {q.autoWait}</div>
        )}
        {!q.pending && q.note && (
          <div data-testid="approval-note" style={{ fontSize: '11.5px', lineHeight: 1.45, color: c.text, marginTop: '3px' }}>Note: {q.note}</div>
        )}
        {q.flag && (
          <div data-testid="approval-flag" style={{ fontSize: '11.5px', lineHeight: 1.45, color: tones.bad, marginTop: '3px' }}>{q.flag}</div>
        )}
        {q.kind === 'mapping' && (
          <div data-testid="approval-mapping-node" style={{ ...meta(c.text), marginTop: '3px' }}>on <span style={identifier(c.text)}>{nodeLabel(q.nodeId)}</span></div>
        )}
        {q.detail && q.detail.length > 0 && (
          <ul data-testid="approval-evidence" style={{ margin: '5px 0 0', paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {q.detail.map((line, i) => <li key={i} style={{ ...identifier(c.textSecondary), fontWeight: 500, overflowWrap: 'anywhere' }}>{line}</li>)}
          </ul>
        )}
        {q.resolution && <div data-testid="approval-resolution" style={{ ...meta(c.text), marginTop: '5px' }}>{q.resolution}</div>}
        {locked && (
          <div data-testid="approval-locked" style={{ fontSize: '11.5px', lineHeight: 1.45, color: tones.bad, marginTop: '4px' }}>{lockedLine(locked.ref)}</div>
        )}
        {q.viewOnly && <ViewOnlyNote feature={q.viewOnly} style={{ marginTop: '6px', fontSize: '11px', padding: '4px 8px' }} />}
        {refusal && (
          <div data-testid="approval-refused" role="alert" style={{ display: 'flex', gap: '8px', marginTop: '6px', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${tones.bad}66`, backgroundColor: `${tones.bad}14`, fontSize: '11px', lineHeight: 1.45 }}>
            <span style={{ flexShrink: 0, fontWeight: 700, color: tones.bad }}>Refused</span>
            <span style={{ color: c.text, overflowWrap: 'anywhere' }}>{refusal}</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '7px', flexWrap: 'wrap' }}>
          {q.pending && q.reviewInCanvas && (
            <button
              data-testid="approval-review-canvas"
              onClick={() => ctx.onReviewCanvas?.(q.proposalId)}
              disabled={!ctx.onReviewCanvas}
              style={{ border: `1px solid ${c.border}`, borderRadius: '7px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: c.text, cursor: 'pointer' }}
            >
              Review in canvas
            </button>
          )}
          {q.pending && locked && acts.includes('accept') && (
            <button data-testid="approval-unlock" onClick={() => ctx.onOpenWork?.({ kind: 'requirement', id: locked.rowId })} disabled={!ctx.onOpenWork} style={{ ...quietAct, color: c.text }}>
              {unlockDoorLabel(locked.ref)}
            </button>
          )}
          {q.pending && !locked && acts.includes('accept') && (
            <button data-testid="approval-approve" onClick={() => { void decide('accept'); }} disabled={busy} style={primaryAct}>
              {busy ? 'Applying…' : accept}
            </button>
          )}
          {q.pending && acts.includes('reject') && !rejecting && (
            <button data-testid="approval-reject" onClick={() => { if (asksWhy) setRejecting(true); else void decide('reject'); }} disabled={busy} style={quietAct}>Reject</button>
          )}
          {q.pending && rejecting && (
            <>
              <input
                data-testid="approval-reject-why"
                aria-label="Why it is rejected"
                placeholder="Why, in a sentence (optional). The agent reads it."
                value={why}
                autoFocus
                onChange={(e) => setWhy(e.target.value)}
                style={{ flex: '1 1 220px', minWidth: 0, border: `1px solid ${c.border}`, borderRadius: '7px', padding: '4px 8px', fontSize: '11px', background: c.surface, color: c.text }}
              />
              <button data-testid="approval-reject-confirm" onClick={() => { void decide('reject', why.trim() ? { note: why.trim() } : undefined); }} disabled={busy} style={quietAct}>Reject</button>
              <button data-testid="approval-reject-cancel" onClick={() => { setRejecting(false); setWhy(''); }} disabled={busy} style={{ ...quietAct, border: 'none' }}>Cancel</button>
            </>
          )}
          {q.pending && q.kind === 'promotion' && ctx.onReadDecision && (
            <button data-testid="approval-read" onClick={() => ctx.onReadDecision?.(q.proposalId)} style={{ ...quietAct, marginLeft: 'auto', border: 'none', color: c.primary }}>Read it first</button>
          )}
          {q.pending && q.kind === 'plan' && ctx.onOpenWork && (
            <button data-testid="approval-see-diff" onClick={() => ctx.onOpenWork?.({ kind: 'plan', id: q.proposalId })} style={{ ...quietAct, marginLeft: 'auto', border: 'none', color: c.primary }}>See the diff</button>
          )}
          {q.pending && acts.includes('dismiss') && (
            <button data-testid="approval-dismiss" onClick={() => { void decide('dismiss'); }} disabled={busy} style={quietAct}>Reject</button>
          )}
          {q.pending && acts.includes('confirm') && (
            <button data-testid="approval-confirm" onClick={() => { void decide('confirm'); }} disabled={busy} style={primaryAct}>{busy ? 'Applying…' : `Keep on ${nodeLabel(q.nodeId)}`}</button>
          )}
          {q.pending && acts.includes('move') && (
            <>
              <select data-testid="approval-move-target" aria-label="The node to move it to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ border: `1px solid ${c.border}`, borderRadius: '7px', padding: '4px 6px', fontSize: '11px', background: c.surface, color: c.text }}>
                <option value="">Another node</option>
                {[...(ctx.nodeLabels ?? new Map<string, string>()).entries()].filter(([id]) => id !== q.nodeId).sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <button data-testid="approval-move" onClick={() => { void decide('move', { nodeId: moveTo }); }} disabled={busy || !moveTo} style={quietAct}>{moveTo ? `Move to ${nodeLabel(moveTo)}` : 'Move it'}</button>
            </>
          )}
          {!q.pending && q.decidedLabel && (
            <span data-testid="approval-decided" style={stateWord(q.decidedLabel === 'REJECTED' ? tones.bad : q.decidedLabel === 'PARTIAL' ? tones.warn : tones.ok)}>
              {sentenceCase(q.decidedLabel.toLowerCase())}
            </span>
          )}
          {!q.pending && q.decidedLabel === 'PARTIAL' && acts.includes('reject') && (
            <button data-testid="approval-close" onClick={() => { void decide('reject'); }} disabled={busy} style={{ ...quietAct, marginLeft: 'auto' }}>
              {busy ? 'Closing…' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface ApprovalsWaitingProps {
  queue: ApprovalsQueueApi;
  focusProposalId?: string | null;
  /** Canvas proposals review in the side review panel; this hands one over. */
  onReviewCanvas?: (proposalId: string) => void;
  /** A decision landed: refresh what it touched. */
  onDecided?: (item: QueueItem, action: QueueAct) => void;
  /** V3 4.3: node id → label, for the mapping rows. */
  nodeLabels?: Map<string, string>;
  /** A promotion can be read on its own page; the card offers it beside the acts. */
  onReadDecision?: (proposalId: string) => void;
  /** 6.4: a locked target's door: Work, on that requirement's record. */
  onOpenWork?: (target: WorkTarget) => void;
  /** The aside's last row: the autonomy settings, the same overlay the
   *  header's Agents button opens. Absent, the row is not drawn. */
  onOpenAutonomy?: () => void;
}

/** What needs a decision, to the design's queue board, named Proposals
 *  (owner 2026-09-20: the technical word; every row here is one, filed by
 *  an agent or left by the import): the heading, a
 *  filter row (All, one chip per origin, Autonomy settings), and the origin
 *  sections (your repository, your agent), each grouped by what kind of
 *  change it is. */
function ApprovalsWaitingComponent({ queue, focusProposalId, onReviewCanvas, onDecided, nodeLabels, onReadDecision, onOpenWork, onOpenAutonomy }: ApprovalsWaitingProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const [filter, setFilter] = useState<ProposalsFilter>('all');
  const sections = useMemo(() => splitByOrigin(queue.items), [queue.items]);
  const shown = filter === 'all' ? sections : sections.filter((s) => s.origin === filter);
  const ctx: CardCtx = { queue, focusProposalId, onReviewCanvas, onDecided, nodeLabels, onReadDecision, onOpenWork };
  const chip = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '6px', border: `1px solid ${on ? c.primary : c.border}`, borderRadius: '999px', padding: '4px 10px',
    background: on ? `${c.primary}14` : 'transparent', color: on ? c.primary : c.text, cursor: 'pointer', font: 'inherit', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap',
  });
  const count = (n: number) => <span style={{ ...meta(c.textSecondary), fontWeight: 700 }}>{n}</span>;

  return (
    <div data-testid="approvals-waiting" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 14px 6px' }}>
        <h1 style={{ ...title(c.text), fontSize: '17px', margin: 0 }}>Proposals</h1>
      </div>
      <div data-testid="proposals-filter" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '4px 14px 10px', borderBottom: `1px solid ${c.border}` }}>
        <button type="button" data-testid="proposals-filter-all" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} style={chip(filter === 'all')}>All{count(queue.pending)}</button>
        {(['import', 'agents'] as const).map((origin) => {
          const section = sections.find((s) => s.origin === origin);
          if (!section) return null;
          return (
            <button key={origin} type="button" data-testid={`proposals-filter-${origin}`} aria-pressed={filter === origin} onClick={() => setFilter(origin)} style={chip(filter === origin)}>
              {section.label}{count(section.count)}
            </button>
          );
        })}
        {onOpenAutonomy && (
          <button type="button" data-testid="proposals-autonomy" onClick={onOpenAutonomy} style={{ ...chip(false), marginLeft: 'auto', color: c.textSecondary }}>Autonomy settings</button>
        )}
      </div>
      {/* The queue's own read error. A decision's refusal shows on its card (6.4). */}
      {queue.error && (
        <div data-testid="approvals-queue-error" style={{ padding: '8px 14px', fontSize: '12px', color: tones.bad, borderBottom: `1px solid ${c.border}` }}>
          {queue.error}
        </div>
      )}
      {shown.length === 0 ? (
        <div style={{ padding: '18px 14px', fontSize: '12.5px', lineHeight: 1.5, color: c.textSecondary }}>
          {queue.loading
            ? 'Reading the queue…'
            : sections.length > 0 ? 'No proposals from here.' : 'No proposals waiting.'}
        </div>
      ) : shown.map((section) => (
        <section key={section.origin} data-testid="approvals-origin" data-origin={section.origin}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '12px 14px 6px' }}>
            <span style={eyebrow(c.primary)}>{section.label}</span>
            <span style={{ ...meta(c.textSecondary), fontWeight: 700 }}>{section.count}</span>
          </div>
          {section.groups.map((group) => (
            <div key={group.kind} data-testid="approvals-group" data-kind={group.kind}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', padding: '9px 14px 7px', backgroundColor: c.background, borderBottom: `1px solid ${c.border}` }}>
                <span style={{ fontSize: '12px', fontWeight: 650, color: c.text }}>{group.label}</span>
                <span style={{ ...meta(c.textSecondary), fontWeight: 700 }}>{group.items.length}</span>
              </div>
              {group.items.map((q) => <ApprovalCard key={q.proposalId} q={q} ctx={ctx} />)}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
export const ApprovalsWaiting = memo(ApprovalsWaitingComponent);

/** Every decision, newest first — the review log. */
function ApprovalsHistoryComponent({ queue }: { queue: ApprovalsQueueApi }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const split = useMemo(() => splitQueue(queue.items), [queue.items]);
  const ctx: CardCtx = { queue };

  return (
    <div data-testid="approvals-history">
      {split.history.length === 0 ? (
        <div data-testid="approvals-history-empty" style={{ padding: '14px', fontSize: '12px', lineHeight: 1.5, color: c.textSecondary }}>
          Nothing decided yet.
        </div>
      ) : (
        <>
          {split.history.map((q) => <ApprovalCard key={q.proposalId} q={q} ctx={ctx} />)}
        </>
      )}
    </div>
  );
}
export const ApprovalsHistory = memo(ApprovalsHistoryComponent);
