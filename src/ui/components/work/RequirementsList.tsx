// V3 6.1 and 6.2 (owner's ruling 2026-09-21, boards P1 and P1b): the
// Requirements list. One row per requirement: ref, name, one state word,
// one proof count. Three shapes of the same list:
//
//   All requirements   every live requirement in ref order, with the
//                      Vision above it (its one act) and, at the bottom,
//                      one line for the outcomes not yet requirements and
//                      the proposals waiting on them;
//   a workflow         the same rows grouped under the workflow's steps
//                      (once each, "also steps a, b"); an outcome not yet
//                      a requirement shows on its step with its proposal
//                      link;
//   Imported           what the import left: its requirements first, then
//                      the candidates still undecided (decided under
//                      Proposals).
//
// A click on a requirement opens its record right under it (W, held to the
// approved mockup: a caret row, the record inline) and a second click
// closes it; an outcome row opens the outcome's rail (ItemRail) beside the
// list. Nothing here explains what a requirement is.
//
// W: with Workflows on the plan (Indie and above) the Constraints and the
// outcomes live in the Workflows space, so All carries one quiet line to
// them, and the outcomes line lists only the outcomes on no stage (the ones
// the space cannot draw).
//
// AC (owner 2026-09-24): "remove the CRUD portion of Workflows and
// Constraints from the Requirements view as this is reserved for the
// workflows view." No constraint is listed, added or removed here on any
// plan (below Indie constraints do not exist), and a workflow's steps carry
// no acts: an outcome or an existing requirement is filed on a stage in the
// Workflows space, and a workflow's heading carries the one quiet line there.
//
// K.2 (owner's live report 2026-09-21): ONE buttonology rule — every act
// sits where its result will appear. The vision edits in place (the text
// is the door; empty shows the dashed act in the text's position) and a
// requirement adds at the end of the list. Nothing floats on the far edge
// of a heading away from the thing it changes.
import { memo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { statusTones } from '../ideation/status-tones.js';
import { eyebrow, title, body, meta, identifier, stateWord } from '../ideation/typography.js';
import { markChipBase } from '../ideation/MarkLine.js';
import type { ProjectVisionApi } from '../ideation/useProjectVision.js';
import type { WorkSelection } from './work-selection.js';
import { importedHeaderLine, type ImportedView } from './steps-model.js';
import { alsoStepsLine, groupedHeaderLine, provenLine, type GroupedView, type OpenOutcomeRow, type RequirementListRow } from './requirements-model.js';
import { sentenceLabel } from './chain-model.js';
import type { VisionSentence } from '../../utils/vision-sentences.js';

/** AA.1: what a new requirement derives from: an open outcome, or a new one of the same name citing the vision. */
export type RequirementOrigin = { outcomeId: string } | { newOutcome: { serves: VisionSentence[] } };

export type ListMode =
  | { kind: 'all'; rows: RequirementListRow[]; outcomes: { count: number; proposals: number } }
  | { kind: 'workflow'; view: GroupedView }
  | { kind: 'imported'; view: ImportedView };

export interface RequirementsListProps {
  mode: ListMode;
  loading: boolean;
  selection: WorkSelection;
  onSelect: (sel: WorkSelection) => void;
  vision: ProjectVisionApi;
  /** The list has a project behind it: the acts are live. */
  hasProject: boolean;
  /** AA.1: below Workflows, an outcome is filed on the project from All. */
  onAddProjectOutcome?: (name: string, serves: VisionSentence[]) => Promise<string | null>;
  /** 6.1: New requirement, one name, written by the person; AA.1: and the outcome it serves. null on success, else the refusal. */
  onCreateRequirement?: (name: string, from: RequirementOrigin) => Promise<string | null>;
  /** AA.1: the chain as counts, the heading's line on All. */
  chainLine?: string | null;
  /** AA.1: the vision's sentences, offered when an outcome is filed. */
  sentences?: readonly VisionSentence[];
  /** AA.1: the sentence offered first (the first no outcome serves yet). */
  firstSentenceId?: string | null;
  /** AA.1: the open outcomes a new requirement can derive from. */
  attachable?: ReadonlyArray<{ id: string; name: string }>;
  /** Proposals waiting on outcomes are decided under Proposals. */
  onOpenChanges?: (proposalId?: string) => void;
  /** 6.1: the outcomes line at the bottom of All opens the outcomes as rows. */
  onShowOutcomes?: () => void;
  showingOutcomes?: boolean;
  outcomeRows?: readonly OpenOutcomeRow[];
  onWarning?: (message: string) => void;
  /** Node id → label, for the Imported rows. */
  nodeLabels?: Map<string, string>;
  /** W: the requirement whose record is open under its row. */
  expandedId?: string | null;
  /** W: the record itself, drawn under the expanded row. */
  renderRecord?: (requirementRowId: string) => React.ReactNode;
  /** W: Workflows is on the plan: Constraints and outcomes live in the space. */
  workflowsOn?: boolean;
  /** W: the quiet line to the space's Constraints lens. */
  onOpenConstraints?: () => void;
  /** AC: a workflow's heading opens it in the Workflows space, where its steps are shaped. */
  onOpenWorkflow?: (laneId: string) => void;
}

function RequirementsListComponent(props: RequirementsListProps) {
  const { mode, loading, selection, onSelect, vision, hasProject, onAddProjectOutcome, onCreateRequirement, onOpenChanges, onShowOutcomes, showingOutcomes, outcomeRows, onWarning, nodeLabels, expandedId, renderRecord, workflowsOn, onOpenConstraints, onOpenWorkflow, chainLine, sentences, firstSentenceId, attachable } = props;
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const [visionDraft, setVisionDraft] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // AA.1: the sentence a new outcome cites, and what a new requirement derives from ('' asks, 'new' files an outcome).
  const [sentenceId, setSentenceId] = useState('');
  const [originChoice, setOriginChoice] = useState('');
  const [addingProjectOutcome, setAddingProjectOutcome] = useState(false);
  const citeOf = (id: string): VisionSentence[] => (sentences ?? []).filter((v) => v.id === id);
  const startCiting = () => setSentenceId(firstSentenceId ?? sentences?.[0]?.id ?? '');

  const run = async (act: () => Promise<string | null>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    const err = await act();
    setBusy(false);
    if (err) { onWarning?.(err); return; }
    after?.();
  };

  // AA.1: a requirement is filed with the outcome it serves, or with a new outcome of the same name.
  const commitRequirement = () => {
    const name = newName.trim();
    if (!name || !onCreateRequirement) return;
    if (!originChoice) { onWarning?.('Pick the outcome it serves.'); return; }
    const from: RequirementOrigin = originChoice === 'new' ? { newOutcome: { serves: citeOf(sentenceId) } } : { outcomeId: originChoice };
    void run(() => onCreateRequirement(name, from), () => { setCreating(false); setNewName(''); });
  };

  const isSelected = (identity: string) => selection.kind === 'row' && selection.identity === identity;
  const quietLink: React.CSSProperties = { border: 'none', background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: '11px', fontWeight: 600, color: c.primary, cursor: 'pointer' };
  const dashedAct: React.CSSProperties = { border: `1px dashed ${c.border}`, borderRadius: '7px', padding: '5px 10px', fontSize: '11.5px', fontWeight: 600, background: 'transparent', color: c.text, cursor: 'pointer', fontFamily: 'inherit' };
  const outlineAct: React.CSSProperties = { border: `1px solid ${c.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '11.5px', fontWeight: 600, background: 'transparent', color: c.text, cursor: 'pointer', fontFamily: 'inherit' };
  const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: `1px solid ${c.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '12.5px', background: c.surface, color: c.text, outline: 'none', fontFamily: 'inherit' };
  const rowBase = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none', borderBottom: on ? 'none' : `1px solid ${c.border}66`,
    borderRadius: 0, background: on ? `${c.primary}0d` : 'transparent', cursor: 'pointer', font: 'inherit', color: c.text,
  });
  const proofTone = (proven: number, total: number, failing: boolean) => (failing ? tones.bad : total > 0 && proven === total ? tones.ok : c.textSecondary);

  // AA.1: the part of the vision an outcome serves, picked where the outcome is filed.
  const sentenceSelect = (testid: string) => ((sentences?.length ?? 0) > 0 ? (
    <select data-testid={testid} value={sentenceId} disabled={busy} title="The part of the vision it serves" onChange={(e) => setSentenceId(e.target.value)} style={{ ...inputStyle, flex: '0 1 280px' }}>
      {sentences!.map((v) => <option key={v.id} value={v.id}>{sentenceLabel(v)}</option>)}
    </select>
  ) : null);

  const requirementRow = (r: RequirementListRow, extra?: React.ReactNode, key?: string) => {
    const identity = `req:${r.id}`;
    const on = expandedId === r.id;
    return (
      <div key={key ?? identity} style={{ display: 'flex', flexDirection: 'column' }}>
        <button type="button" data-testid="work-row" data-kind="requirement" data-identity={identity} aria-expanded={on} onClick={() => onSelect(on ? { kind: 'lane' } : { kind: 'row', identity, outcomeId: '', requirementRowId: r.id, stepIndex: 0 })} style={rowBase(on)}>
          <span aria-hidden="true" style={{ width: '11px', flexShrink: 0, color: c.textSecondary, fontSize: '11px', lineHeight: 1 }}>{on ? '\u25be' : '\u25b8'}</span>
          <span style={{ ...identifier(on ? c.text : c.textSecondary), flexShrink: 0 }}>{r.ref}</span>
          <span style={{ ...title(c.text), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{extra}</span>
          <span data-testid="work-status" style={{ ...stateWord(r.state === 'Confirmed' ? c.primary : c.textSecondary), width: '96px', display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {r.state}{r.locked && <Lock data-testid="work-row-locked" size={10} aria-label="Locked" />}
          </span>
          <span data-testid="work-proven" style={{ ...meta(proofTone(r.proven, r.total, r.failing)), width: '44px', textAlign: 'right', flexShrink: 0 }}>{r.proven} of {r.total}</span>
        </button>
        {on && renderRecord?.(r.id)}
      </div>
    );
  };

  const outcomeRow = (o: { identity: string; id: string; name: string; proposalId: string | null; live: boolean; mark: string | null }, rightWord: string) => {
    const on = isSelected(o.identity);
    return (
      <button key={o.identity} type="button" data-testid="work-row" data-kind="outcome" data-identity={o.identity} aria-pressed={on} onClick={() => onSelect({ kind: 'row', identity: o.identity, outcomeId: o.id, requirementRowId: null, stepIndex: 0 })} style={rowBase(on)}>
        <span style={{ width: '54px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>{o.live && <span title="An agent is drafting this now" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: c.primary, animation: 'nsPulse 2.4s ease-in-out infinite' }} />}</span>
        {o.mark && <span data-testid="card-mark" style={{ ...markChipBase, color: tones.warn, border: `1px solid ${tones.warn}` }}>{o.mark}</span>}
        <span style={{ ...meta(c.text), fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
        {o.proposalId ? (
          <span data-testid="work-proposal-waiting" role="link" onClick={(e) => { e.stopPropagation(); onOpenChanges?.(o.proposalId!); }} style={{ ...stateWord(tones.warn), width: '96px', flexShrink: 0 }}>Proposal waiting</span>
        ) : (
          <span style={{ width: '96px', flexShrink: 0 }} />
        )}
        <span style={{ ...meta(c.textSecondary), width: '44px', textAlign: 'right', flexShrink: 0 }}>{rightWord}</span>
      </button>
    );
  };

  // ── the head: the Vision, on All only ──────────────────────────────────────
  const visionBlock = (
    <div data-testid="work-vision" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 10px 12px' }}>
      <span style={eyebrow(c.textSecondary)}>Vision</span>
      {visionDraft === null ? (
        vision.vision.trim() ? (
          <button
            type="button"
            data-testid="vision-edit"
            title={hasProject ? 'Edit the vision' : undefined}
            disabled={!hasProject}
            onClick={() => setVisionDraft(vision.vision)}
            style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: hasProject ? 'text' : 'default', font: 'inherit' }}
          >
            <p data-testid="vision-text" style={{ ...body(c.text), margin: 0, maxWidth: '82ch' }}>{vision.vision}</p>
          </button>
        ) : hasProject ? (
          <button type="button" data-testid="vision-edit" onClick={() => setVisionDraft('')} style={{ ...dashedAct, alignSelf: 'flex-start' }}>Write the vision</button>
        ) : null
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <textarea data-testid="vision-input" autoFocus rows={3} value={visionDraft} disabled={busy} placeholder="In one or two sentences, what is this product for?" onChange={(e) => setVisionDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setVisionDraft(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run(() => vision.save(visionDraft), () => setVisionDraft(null)); }} style={{ ...inputStyle, ...body(c.text), resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" data-testid="vision-save" disabled={busy} onClick={() => void run(() => vision.save(visionDraft), () => setVisionDraft(null))} style={{ ...outlineAct, borderColor: c.primary, background: c.primary, color: '#fff' }}>Save</button>
            <button type="button" onClick={() => setVisionDraft(null)} style={quietLink}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
  const heading = (text: string, line: string | null, right?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', padding: '0 10px 12px' }}>
      <h1 style={{ ...title(c.text), fontSize: '19px', letterSpacing: '-0.015em', margin: 0 }}>{text}</h1>
      {line && <span data-testid="work-list-line" style={meta(c.textSecondary)}>{line}</span>}
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );

  if (mode.kind === 'all') {
    return (
      <section data-testid="work-requirements" role="tabpanel" aria-label="Requirements" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        {heading('Requirements', chainLine ?? (mode.rows.length > 0 ? provenLine(mode.rows) : null))}
        {visionBlock}
        {workflowsOn ? (
          <div data-testid="work-constraints-moved" style={{ padding: '0 10px 16px', borderBottom: `1px solid ${c.border}` }}>
            <button type="button" data-testid="work-open-constraints" onClick={onOpenConstraints} disabled={!onOpenConstraints} style={{ ...quietLink, fontSize: '12px', color: c.textSecondary }}>
              Constraints and outcomes are in the Workflows space<span aria-hidden="true"> {'\u2192'}</span>
            </button>
          </div>
        ) : <div aria-hidden="true" style={{ borderBottom: `1px solid ${c.border}` }} />}
        {mode.rows.map((r) => requirementRow(r))}
        {mode.rows.length === 0 && !loading && !creating && (
          <div data-testid="work-requirements-empty" style={{ ...meta(c.textSecondary), padding: '14px 10px' }}>{hasProject ? 'No requirements yet.' : ''}</div>
        )}
        {creating && (
          <div data-testid="work-new-requirement-row" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', padding: '9px 10px', borderBottom: `1px solid ${c.border}66` }}>
            <span style={{ ...identifier(c.textSecondary), flexShrink: 0 }}>REQ</span>
            <input data-testid="work-new-requirement-input" autoFocus value={newName} placeholder="What must hold, in one line" disabled={busy} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
              if (e.key === 'Enter') commitRequirement();
            }} style={inputStyle} />
            {/* AA.1: every requirement derives from an outcome, so the row asks which one */}
            <select data-testid="work-new-requirement-origin" value={originChoice} disabled={busy} onChange={(e) => setOriginChoice(e.target.value)} style={{ ...inputStyle, flex: '0 1 240px' }}>
              <option value="" disabled>Which outcome does it serve?</option>
              {(attachable ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value="new">A new outcome of the same name</option>
            </select>
            {originChoice === 'new' && sentenceSelect('work-new-requirement-sentence')}
            <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={{ ...quietLink, color: c.textSecondary }}>Cancel</button>
          </div>
        )}
        {hasProject && onCreateRequirement && !creating && (
          <div style={{ padding: '9px 10px' }}>
            <button type="button" data-testid="work-new-requirement" onClick={() => { setCreating(true); setNewName(''); setOriginChoice((attachable?.length ?? 0) === 0 ? 'new' : ''); startCiting(); }} style={dashedAct}>New requirement</button>
          </div>
        )}
        {(mode.outcomes.count > 0 || (!workflowsOn && hasProject && !!onAddProjectOutcome)) && (
          <div data-testid="work-outcomes-line" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 10px 6px' }}>
            <button type="button" data-testid="work-outcomes-toggle" aria-expanded={!!showingOutcomes} onClick={onShowOutcomes} style={{ ...quietLink, color: c.textSecondary, display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span aria-hidden="true" style={{ display: 'inline-block', transform: showingOutcomes ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
              {workflowsOn ? 'Outcomes on no stage' : 'Outcomes, not yet requirements'}
              <span style={meta(c.textSecondary)}>{mode.outcomes.count}</span>
            </button>
            {mode.outcomes.proposals > 0 && (
              <button type="button" data-testid="work-outcomes-proposals" onClick={() => onOpenChanges?.()} style={{ ...quietLink, marginLeft: 'auto', color: tones.warn }}>{mode.outcomes.proposals} proposal{mode.outcomes.proposals === 1 ? '' : 's'} waiting</button>
            )}
          </div>
        )}
        {showingOutcomes && (outcomeRows ?? []).map((o) => outcomeRow({ identity: `outcome:${o.id}`, ...o }, 'outcome'))}
        {showingOutcomes && !workflowsOn && hasProject && onAddProjectOutcome && (
          <div data-testid="work-project-outcome-acts" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', padding: '6px 10px 8px' }}>
            {addingProjectOutcome ? (
              <>
                <input data-testid="work-add-project-outcome-input" autoFocus value={draft} placeholder="What the product should achieve" disabled={busy} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Escape') { setAddingProjectOutcome(false); setDraft(''); }
                  if (e.key === 'Enter' && draft.trim()) void run(() => onAddProjectOutcome(draft.trim(), citeOf(sentenceId)), () => { setDraft(''); setAddingProjectOutcome(false); });
                }} style={{ ...inputStyle, maxWidth: '420px' }} />
                {sentenceSelect('work-add-project-outcome-sentence')}
                <button type="button" onClick={() => { setAddingProjectOutcome(false); setDraft(''); }} style={{ ...quietLink, color: c.textSecondary }}>Cancel</button>
              </>
            ) : (
              <button type="button" data-testid="work-add-project-outcome" onClick={() => { setAddingProjectOutcome(true); setDraft(''); startCiting(); }} style={dashedAct}>Add an outcome</button>
            )}
          </div>
        )}
      </section>
    );
  }

  if (mode.kind === 'imported') {
    const v = mode.view;
    return (
      <section data-testid="work-imported-list" role="tabpanel" aria-label="Imported" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        {heading('Imported', <span data-testid="work-imported-line">{importedHeaderLine(v)}</span> as unknown as string)}
        {v.items.length === 0 ? (
          <div data-testid="work-imported-empty" style={{ ...meta(c.textSecondary), padding: '14px 10px' }}>Nothing from the import is left to decide.</div>
        ) : v.items.map((item) => {
          if (item.kind === 'requirement') {
            return requirementRow({ id: item.requirementRowId!, ref: item.reqRef ?? '', name: item.title, state: item.status === 'Confirmed requirement' ? 'Confirmed' : 'Unconfirmed', locked: item.locked, proven: item.proven, total: item.total, failing: false, backfilled: true },
              item.nodeId && nodeLabels?.get(item.nodeId) ? <span data-testid="work-on-node" style={{ ...meta(c.textSecondary), marginLeft: '8px' }}>on {nodeLabels.get(item.nodeId)}</span> : undefined);
          }
          const identity = item.identity;
          const on = isSelected(identity);
          return (
            <button key={identity} type="button" data-testid="work-row" data-kind="candidate" data-identity={identity} aria-pressed={on} onClick={() => onOpenChanges?.()} style={rowBase(on)}>
              <span style={{ ...identifier(c.textSecondary), flexShrink: 0 }}>{item.candidateKind}</span>
              <span style={{ ...title(c.text), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}{item.nodeId && nodeLabels?.get(item.nodeId) && <span data-testid="work-on-node" style={{ ...meta(c.textSecondary), marginLeft: '8px' }}>on {nodeLabels.get(item.nodeId)}</span>}</span>
              <span data-testid="work-proposal-waiting" style={{ ...stateWord(tones.warn), width: '96px', flexShrink: 0 }}>Review</span>
              <span style={{ ...meta(c.textSecondary), width: '44px', textAlign: 'right', flexShrink: 0 }}>0 of {item.total}</span>
            </button>
          );
        })}
      </section>
    );
  }

  // ── 6.2: a workflow, its steps, the rows under them ───────────────────────
  // AC: read here, shaped in the Workflows space.
  const v = mode.view;
  const toSpace = onOpenWorkflow ? (
    <button type="button" data-testid="work-open-workflow" onClick={() => onOpenWorkflow(v.laneId)} style={{ ...quietLink, fontSize: '12px', color: c.textSecondary }}>
      Shape it in the Workflows space<span aria-hidden="true"> {'\u2192'}</span>
    </button>
  ) : undefined;
  return (
    <section data-testid="work-requirements" data-workflow={v.laneId} role="tabpanel" aria-label="Requirements" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
      {heading(v.name, groupedHeaderLine(v), toSpace)}
      {v.steps.length === 0 && !loading && (
        <div data-testid="work-steps-empty" style={{ ...meta(c.textSecondary), padding: '14px 10px' }}>No steps yet.</div>
      )}
      {v.steps.map((step) => (
        <div key={step.id} data-testid="work-step" style={{ display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${c.border}66` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 10px 6px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: `${c.border}`, ...identifier(c.text) }}>{step.index}</span>
            <span style={{ ...meta(c.text), fontWeight: 600 }}>{step.name}</span>
          </div>
          {step.rows.map((row) => row.kind === 'requirement'
            ? requirementRow(
              { id: row.requirementRowId!, ref: row.reqRef ?? '', name: row.title, state: row.status === 'Confirmed requirement' ? 'Confirmed' : 'Unconfirmed', locked: row.locked, proven: row.proven, total: row.total, failing: false, backfilled: false },
              alsoStepsLine(row.alsoSteps) ? <span data-testid="work-also-steps" style={{ ...meta(c.textSecondary), marginLeft: '8px' }}>· {alsoStepsLine(row.alsoSteps)}</span> : undefined,
            )
            : outcomeRow({ identity: row.identity, id: row.outcomeId, name: row.title, proposalId: row.proposalId, live: row.live, mark: row.mark }, 'outcome'))}
        </div>
      ))}
    </section>
  );
}

export const RequirementsList = memo(RequirementsListComponent);
