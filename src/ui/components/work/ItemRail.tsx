// V3 4.1 → 6.1/6.2: the rail beside the Requirements list, for an OUTCOME
// (a requirement's record is RequirementRecord, inline under its row): Make
// it a requirement (the promotion, a human act at every autonomy level; an
// agent's pending ask is the same act, reviewed under Proposals), its draft
// criteria, where it lives.
//
// AC (owner 2026-09-24): "remove the CRUD portion of Workflows and
// Constraints from the Requirements view as this is reserved for the
// workflows view." The workflow rail (name, steps, delete) and the outcome's
// step toggles are gone from here; with Workflows on the plan the eyebrow
// still says which steps the outcome sits on, and below it steps are never
// named.
//
// Every write goes through the hooks that already exist and refuses in
// the database's own words when it must; the rail shows them.
import { memo, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { Graph } from '@nodespec/core/types.js';
import { statusTones } from '../ideation/status-tones.js';
import { eyebrow, title, body, meta, identifier } from '../ideation/typography.js';
import { MarkLine } from '../ideation/MarkLine.js';
import { criterionChips, CHIP_COLOR } from '../ideation/criteria-chips.js';
import { sinceLabel, type AgentHold } from '../ideation/useAgentPresence.js';
import { identifiedFromRow } from '../ideation/criterion-identity.js';
import { promotionGate, type CandidateActions } from '../ideation/useCandidateActions.js';
import type { WorkflowLane } from '../ideation/useWorkflowLanes.js';
import type { Outcome, OutcomesApi } from '../ideation/useOutcomes.js';
import { livesOn, originLine, stepsLine, stepIndicesOf, type PendingPromotion } from './steps-model.js';
import type { WorkSelection } from './work-selection.js';
import { sentenceLabel, servedBy, servesLine } from './chain-model.js';
import type { VisionSentence } from '../../utils/vision-sentences.js';

export const OUTCOME_STATUS_SENTENCE = 'Not yet a requirement.';

interface ItemRailProps {
  projectId?: string | null;
  selection: WorkSelection;
  /** The lanes as read; empty below Indie (they are not read there). */
  lanes: WorkflowLane[];
  outcomes: Outcome[];
  graph?: Graph | null;
  pending: Map<string, PendingPromotion>;
  holds: AgentHold[];
  canClassify: boolean;
  outcomesApi: OutcomesApi;
  candidateActions: CandidateActions;
  onOpenChanges?: (proposalId?: string) => void;
  /** The Lives on chips open Architecture on that node. */
  onOpenArchitecture?: (nodeId: string) => void;
  onSelect: (sel: WorkSelection) => void;
  onWarning?: (message: string) => void;
  /** AA.1: the vision's sentences; an outcome's rail says which it serves and takes a new pick. */
  sentences?: readonly VisionSentence[];
}

/** A value that edits in place and commits on Enter or blur. */
function InlineText({ value, placeholder, onCommit, style, testid, disabled, title: hint, multiline }: {
  value: string; placeholder?: string; onCommit: (next: string) => void; style?: React.CSSProperties; testid?: string; disabled?: boolean; title?: string; multiline?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [value]);
  const commit = () => { if (draft !== null && draft.trim() !== value.trim()) onCommit(draft.trim()); setDraft(null); };
  const shared = {
    'data-testid': testid, value: draft ?? value, placeholder, disabled, title: hint,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    style: { width: '100%', border: '1px solid transparent', borderRadius: '6px', padding: '3px 6px', background: 'transparent', font: 'inherit', color: 'inherit', outline: 'none', resize: 'vertical' as const, ...style },
  };
  return multiline
    ? <textarea {...shared} rows={3} onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }} />
    : <input {...shared} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }} />;
}

function ItemRailComponent(props: ItemRailProps) {
  const { selection, lanes, outcomes, graph, pending, holds, canClassify, outcomesApi, candidateActions, onOpenChanges, onOpenArchitecture, onSelect, onWarning, sentences } = props;
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);

  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'dismiss' | 'settle' | null>(null);
  const [newCriterion, setNewCriterion] = useState('');
  useEffect(() => { setNote(null); setConfirming(null); setNewCriterion(''); }, [selection]);

  // Every write: the refusal lands in the rail and in the app's warning line.
  const run = async (act: () => Promise<string | null>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    const err = await act();
    setBusy(false);
    if (err) { setNote(err); onWarning?.(err); return; }
    setNote(null);
    after?.();
  };

  const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' };
  const act = (primary = true): React.CSSProperties => ({
    alignSelf: 'flex-start', border: `1px solid ${primary ? c.primary : c.border}`, borderRadius: '8px', padding: '6px 12px', fontSize: '12.5px', fontWeight: 650,
    background: primary ? c.primary : 'transparent', color: primary ? '#fff' : c.text, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1,
  });
  const quiet: React.CSSProperties = { border: 'none', background: 'transparent', color: c.textSecondary, fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', padding: '2px 4px' };
  const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: `1px solid ${c.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '12.5px', background: c.surface, color: c.text, outline: 'none' };
  const noteLine = note && <div data-testid="work-rail-note" role="status" style={{ ...body(tones.warn), borderLeft: `2px solid ${tones.warn}`, paddingLeft: '8px' }}>{note}</div>;

  const outcome = selection.kind === 'row' && !selection.requirementRowId ? outcomes.find((o) => o.id === selection.outcomeId) ?? null : null;
  // An outcome's steps are its HOME workflow's, wherever the list showed it.
  const homeLane = outcome ? lanes.find((l) => l.id === outcome.workflowId) ?? null : null;
  const homeNodeId = outcome?.node_id ?? null;
  const home = useMemo(() => livesOn(graph, homeNodeId), [graph, homeNodeId]);

  // The design's Lives on: the nodes as chips, each a door to Architecture,
  // and the edge's own sentence under them.
  const livesOnBlock = home && (
    <div data-testid="work-lives-on" style={section}>
      <span style={eyebrow(c.textSecondary)}>Lives on</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {home.nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            data-testid="work-lives-on-node"
            disabled={!onOpenArchitecture}
            title={onOpenArchitecture ? `Open ${n.label} in Architecture` : undefined}
            onClick={() => onOpenArchitecture?.(n.id)}
            style={{ border: `1px solid ${c.border}`, borderRadius: '7px', padding: '4px 10px', fontSize: '11.5px', fontWeight: 600, background: 'transparent', color: c.text, cursor: onOpenArchitecture ? 'pointer' : 'default', font: 'inherit' }}
          >
            {n.label}
          </button>
        ))}
      </div>
      {home.detail && <span style={meta(c.textSecondary)}>{home.detail}</span>}
    </div>
  );

  // ── an outcome ────────────────────────────────────────────────────────────
  if (selection.kind !== 'row' || selection.requirementRowId) return null;
  if (!outcome) return <aside data-testid="work-rail" data-mode="empty" style={railStyle(c)}><span style={body(c.textSecondary)}>That row is gone. Pick another.</span></aside>;
  const decided = outcome.status !== 'pending';
  const ask = pending.get(outcome.id) ?? null;
  const criteria = identifiedFromRow(outcome.criteria);
  const unclaimed = criteria.filter((k) => !outcome.claimed[k.id]);
  const outcomeHolds = holds.filter((h) => h.level === 'outcome' && h.refId === outcome.id && !h.stale);
  const gate = promotionGate(outcome, { claimed: outcome.claimed });
  const derived = outcome.derivations.length;
  const steps = homeLane ? stepIndicesOf(homeLane, outcome.stepIds) : [];
  return (
    <aside data-testid="work-rail" data-mode="outcome" style={railStyle(c)}>
      <span data-testid="work-rail-origin" style={eyebrow(c.primary)}>Outcome · {originLine(outcome.evidence)}{homeLane ? ` · ${stepsLine(steps)}` : ''}</span>
      <InlineText testid="work-rail-title" value={outcome.name} disabled={decided} onCommit={(name) => void run(() => outcomesApi.updateOutcome(outcome.id, { name }))} style={{ ...title(c.text), fontSize: '15px' }} />
      <InlineText testid="work-rail-description" multiline value={outcome.description ?? ''} placeholder="What this outcome means, in a sentence or two." disabled={decided} onCommit={(description) => void run(() => outcomesApi.updateOutcome(outcome.id, { description }))} style={body(c.textSecondary)} />
      <MarkLine mark={outcome.mark ?? null} canClassify={canClassify} disabled={decided} onCommit={(mark) => void run(() => outcomesApi.updateOutcome(outcome.id, { mark }))} />
      {/* AA.1: the part of the vision it serves. A citation is provenance, so a settled outcome still takes a new one. */}
      {(sentences?.length ?? 0) > 0 && (
        <div data-testid="work-rail-serves" style={section}>
          <span style={meta(servedBy(outcome, sentences!).current.length > 0 ? c.textSecondary : tones.warn)}>{servesLine(outcome, sentences!)}</span>
          {outcome.status !== 'dismissed' && (
            <select
              data-testid="work-rail-serves-select"
              value={servedBy(outcome, sentences!).current[0]?.id ?? ''}
              disabled={busy}
              onChange={(e) => { const pick = sentences!.find((v) => v.id === e.target.value); if (pick) void run(() => outcomesApi.setServes(outcome.id, [pick])); }}
              style={{ ...inputStyle, flex: '0 1 auto' }}
            >
              <option value="" disabled>Which part of the vision does it serve?</option>
              {sentences!.map((v) => <option key={v.id} value={v.id}>{sentenceLabel(v)}</option>)}
            </select>
          )}
        </div>
      )}

      <div style={section}>
        <span data-testid="work-rail-status" style={body(c.text)}>
          {decided ? `${outcome.status === 'accepted' ? 'Settled' : 'Dismissed'}. ${derived > 0 ? `It derived ${derived} requirement${derived === 1 ? '' : 's'}; they carry on.` : 'Decided is terminal; a refile is a new outcome.'}` : OUTCOME_STATUS_SENTENCE}
        </span>
        {!decided && (
          <button type="button" data-testid="work-act-promote" disabled={busy} title={gate.allowed ? undefined : gate.reason} style={act(true)} onClick={() => { if (!gate.allowed) { setNote(gate.reason ?? null); return; } void run(() => candidateActions.promote(outcome)); }}>
            Make it a requirement
          </button>
        )}
        {ask && (
          <div data-testid="work-agent-asked" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${c.primary}55`, backgroundColor: `${c.primary}14` }}>
            <span style={meta(c.text)}>{ask.agent} asked for this.</span>
            <button type="button" data-testid="work-act-review" disabled={!onOpenChanges} style={act(false)} onClick={() => onOpenChanges?.(ask.proposalId)}>Review</button>
          </div>
        )}
      </div>

      {outcomeHolds.length > 0 && (
        <div data-testid="agent-proposing" style={{ borderRadius: '10px', border: `1px solid ${c.primary}55`, backgroundColor: `${c.primary}14`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: c.primary, animation: 'nsPulse 2.4s ease-in-out infinite' }} />
            <span style={eyebrow(c.primary)}>Agent on this outcome</span>
            <span style={{ flex: 1 }} />
            <span style={meta(c.textSecondary)}>{sinceLabel(outcomeHolds[0].since)} ago</span>
          </div>
          {outcomeHolds.map((hold) => (
            <div key={hold.checkoutId}>
              <div style={{ ...meta(c.text), fontWeight: 650 }}>
                {hold.holder}
                {hold.credential && <span style={{ ...identifier(c.textSecondary), fontWeight: 500, marginLeft: '6px' }}>{hold.credential}</span>}
              </div>
              <div style={meta(c.textSecondary)}>
                {typeof hold.meta?.proposal === 'string' ? hold.meta.proposal : hold.proposalId ? 'Drafting, with a change filed.' : 'Drafting. Nothing filed yet.'}
              </div>
              {hold.proposalId && (
                <button type="button" data-testid="agent-open-approval" onClick={() => onOpenChanges?.(hold.proposalId!)} disabled={!onOpenChanges} style={{ ...act(false), marginTop: '6px', padding: '4px 9px', fontSize: '11px' }}>
                  Review in Proposals
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={section}>
        <span data-testid="work-rail-criteria-line" style={eyebrow(c.textSecondary)}>Criteria · 0 of {criteria.length} proven</span>
        {criteria.map((k) => (
          <div key={k.id} data-testid="work-criterion" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ ...meta(c.text), flex: 1, minWidth: 0 }}>{k.text}</span>
            <span data-testid="criteria-strip" style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              {criterionChips({ tier: 'outcome' }, k).map((chip) => (
                <span key={chip.key} style={{ ...meta(CHIP_COLOR[chip.key]), fontWeight: 600, border: `1px solid ${CHIP_COLOR[chip.key]}66`, borderRadius: '4px', padding: '1px 5px' }}>{chip.label}</span>
              ))}
            </span>
            {outcome.claimed[k.id] && <span data-testid="claimed-chip" style={identifier(c.textSecondary)}>{outcome.claimed[k.id]}</span>}
            {!decided && !outcome.claimed[k.id] && (
              <button type="button" title="Remove this draft criterion" style={quiet} onClick={() => void run(() => outcomesApi.setCriteria(outcome.id, criteria.filter((x) => x.id !== k.id)))}>×</button>
            )}
          </div>
        ))}
        {!decided && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              data-testid="add-criterion-input"
              value={newCriterion}
              placeholder="A criterion a test can prove"
              onChange={(e) => setNewCriterion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newCriterion.trim()) void run(() => outcomesApi.setCriteria(outcome.id, [...criteria, { text: newCriterion }]), () => setNewCriterion('')); }}
              style={inputStyle}
            />
            <button type="button" data-testid="add-criterion-button" disabled={!newCriterion.trim() || busy} style={act(false)} onClick={() => void run(() => outcomesApi.setCriteria(outcome.id, [...criteria, { text: newCriterion }]), () => setNewCriterion(''))}>+</button>
          </div>
        )}
        {unclaimed.length < criteria.length && unclaimed.length > 0 && <span style={meta(c.textSecondary)}>{unclaimed.length} still unclaimed.</span>}
      </div>

      {livesOnBlock}

      {!decided && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {derived > 0 ? (
            confirming === 'settle'
              ? <><span style={meta(c.text)}>Settle it as fully covered? It derives no further.</span><button type="button" style={act(false)} onClick={() => void run(() => candidateActions.settle(outcome), () => setConfirming(null))}>Settle</button><button type="button" style={quiet} onClick={() => setConfirming(null)}>Keep it open</button></>
              : <button type="button" data-testid="work-act-settle" style={quiet} onClick={() => setConfirming('settle')}>Settle</button>
          ) : (
            confirming === 'dismiss'
              ? <><span style={meta(c.text)}>Dismissed is terminal. Dismiss it?</span><button type="button" style={act(false)} onClick={() => void run(() => candidateActions.dismiss(outcome), () => { setConfirming(null); onSelect({ kind: 'lane' }); })}>Dismiss</button><button type="button" style={quiet} onClick={() => setConfirming(null)}>Keep it</button></>
              : <button type="button" data-testid="work-act-dismiss" style={quiet} onClick={() => setConfirming('dismiss')}>Dismiss</button>
          )}
        </div>
      )}
      {noteLine}
    </aside>
  );
}

function railStyle(c: { surface: string; border: string }): React.CSSProperties {
  return { width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '14px 16px', borderRadius: '12px', border: `1px solid ${c.border}`, backgroundColor: c.surface, alignSelf: 'flex-start', position: 'sticky', top: 0, maxHeight: '100%', overflowY: 'auto' };
}

export const ItemRail = memo(ItemRailComponent);
