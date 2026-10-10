// W (owner 2026-09-23): the Workflows tab, implemented as the approved
// mockup draws it (workflow-space.html, v9) and wired to the tables Work
// already reads. Indie and above only; WorkSurface never mounts it below.
//
//   the lens         User Journey (a column per stage) | Constraints (a
//                    column per layer)
//   the journeys     one pill per workflow; the one in front is drawn, the
//                    rest stand behind; + names a new one
//   the strip        the ONLY place stages and layers are edited: each box
//                    renames in place, moves and removes; the last box adds
//   the 3D columns   space-scene.ts
//   the inspector    whatever is picked, walked up and down the chain, with
//                    the acts that belong to it, and the add forms
//   Team             the workflow's owner on its pill. The proposals your
//                    agents leave are decided in the one Proposals panel,
//                    under Agents in the header (AL.23, owner 2026-10-03:
//                    the space's own Proposals button repeated it)
//
// Every write goes through the hooks Work already holds and refuses in the
// database's words when it must; the refusal lands in the space's toast.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import type { WorkflowLanesApi } from '../../ideation/useWorkflowLanes.js';
import type { OutcomesApi } from '../../ideation/useOutcomes.js';
import type { ConstraintsApi, ConstraintType } from '../../ideation/useConstraints.js';
import type { BandRequirement } from '../../ideation/useRequirementBand.js';
import type { TraceChain } from '../../ideation/useTraceData.js';
import type { CandidateActions } from '../../ideation/useCandidateActions.js';
import { identifiedFromRow } from '../../ideation/criterion-identity.js';
import {
  OUT_WORD, LAYERS, hues, toneOf, layerColor,
  buildJourney, activeLayers, layerOf, scopeOf, layerCountLine, stripLabel, chainSegments,
  requirementProven, stageRemovalNote, workflowRemoval, shortName, outcomeRemovalRefusal, initialsOf, shortDate, isNarrowScope, idWords, fileableIn,
  type SpaceJourney, type SpaceStage, type SpaceOutcome, type SpaceRequirement, type SpaceMode,
} from './space-model.js';
import { asCheckSpec, describeCheck, ruleFromRow, ruleSignals, waiverHolds, type CheckSpec } from '../../../../../supabase/functions/_shared/constraint-rules.js';
import { createSpaceScene, type SceneFocus, type SceneHandle, type ScenePick } from './space-scene.js';
import { SPACE_CSS } from './space-css.js';
import { reachLine, sentenceLabel, servedBy, servesLine } from '../chain-model.js';
import type { VisionSentence } from '../../../utils/vision-sentences.js';

export interface WorkflowsSpaceProps {
  projectId: string | null | undefined;
  graph?: Graph | null;
  lanesApi: WorkflowLanesApi;
  outcomesApi: OutcomesApi;
  constraintsApi: ConstraintsApi;
  requirements: ReadonlyMap<string, BandRequirement>;
  chains: ReadonlyMap<string, TraceChain>;
  planSets?: ReadonlyMap<string, number>;
  filesByReq?: ReadonlyMap<string, ReadonlySet<string>>;
  candidateActions: CandidateActions;
  /** Deletes the requirement row (its derivations go with it). null on success. */
  onDeleteRequirement: (rowId: string) => Promise<string | null>;
  /** Team: owners on the journeys. */
  team: boolean;
  /** "Open in: Requirements list" on a requirement. */
  onOpenRequirement?: (laneId: string, requirementRowId: string) => void;
  onOpenArchitecture?: (nodeId: string) => void;
  /** Another surface asked for a lens (the Requirements link to Constraints), or a workflow (AC). */
  lensRequest?: { lens: Lens; at: number; journeyId?: string } | null;
  /** X: the app's light or dark setting; the space follows it. */
  mode?: SpaceMode;
  /** AA.1: the vision's sentences: a new outcome cites one, an outcome says which it serves. */
  sentences?: readonly VisionSentence[];
  /** AA.1: the sentence a new outcome offers first. */
  firstSentenceId?: string | null;
  /** AA.1: constraint id → the node packets it is carried in. */
  constraintReach?: ReadonlyMap<string, number>;
  /** AC: every live requirement; a stage files one that is not yet in its workflow. */
  requirementRows?: ReadonlyArray<{ id: string; ref: string; name: string }>;
  /** AJ.6: the account's example on a plan below Workflows: everything reads,
   *  and no act that writes is drawn. */
  viewOnly?: boolean;
}

export type Lens = 'journey' | 'layer';

type Form =
  | { kind: 'outcome'; stepId: string; outcomeId: string | null }
  | { kind: 'req'; stepId: string; outcomeId: string }
  | { kind: 'also'; stepId: string; outcomeId: string }
  | { kind: 'file'; stepId: string }
  | { kind: 'constraint'; ctype: string };

type Sel = Exclude<SceneFocus, null>;

const LENS_HINT: Record<Lens, string> = {
  journey: 'A column is a stage. The rows below it are how that stage gets built.',
  layer: 'A column is a layer. Each constraint below it is global, or holds for one workflow.',
};
const AVATAR_TONES = ['#5aa9e6', '#8B8FE6', '#5fd3c8', '#fbbf24', '#c07ae0'];
const avatarTone = (label: string) => AVATAR_TONES[[...label].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_TONES.length];

export default function WorkflowsSpace(props: WorkflowsSpaceProps) {
  const { projectId, graph, lanesApi, outcomesApi, constraintsApi, requirements, chains, planSets, filesByReq, candidateActions, onDeleteRequirement, team, onOpenRequirement, onOpenArchitecture, lensRequest, mode = 'dark', sentences = [], firstSentenceId = null, constraintReach, requirementRows = [], viewOnly = false } = props;
  const edit = !viewOnly;
  const lanes = lanesApi.lanes;
  // R.2b: what a constraint can hold for, from this project's own graph.
  const nodeName = useCallback((id: string) => ((graph?.nodes ?? {}) as Record<string, { label?: string }>)[id]?.label ?? id.slice(0, 8), [graph]);
  const targetName = (id: string) => {
    const e = ((graph?.edges ?? {}) as Record<string, { source: string; target: string }>)[id];
    return e ? `${nodeName(e.source)} to ${nodeName(e.target)}` : nodeName(id);
  };
  const systemShape = useMemo(() => shapeOfSystem(graph ?? null), [graph]);
  // X: every hue on screen comes from the mode; the greys are CSS variables.
  const H = hues(mode);
  const tone = (s: Parameters<typeof toneOf>[0]) => toneOf(s, mode);

  const [lens, setLens] = useState<Lens>('journey');
  const [wfId, setWfId] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [stageDraft, setStageDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [journeyDraft, setJourneyDraft] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; warn: boolean; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  // What a write just made, selected once the re-read shows it.
  const [awaiting, setAwaiting] = useState<{ kind: 'step' | 'outcome' | 'req'; stepId?: string; outcomeId?: string; name: string; known: Set<string> } | null>(null);

  // ── the model ──────────────────────────────────────────────────────────────
  const journeys = useMemo<SpaceJourney[]>(() => lanes.map((lane) => buildJourney({
    lane, lanes, outcomes: outcomesApi.outcomes, requirements, chains, graph, planSets, filesByReq,
  })), [lanes, outcomesApi.outcomes, requirements, chains, graph, planSets, filesByReq]);
  const focused = useMemo(() => journeys.find((j) => j.id === wfId) ?? journeys[0] ?? null, [journeys, wfId]);
  const layers = useMemo(() => activeLayers(constraintsApi.rows), [constraintsApi.rows]);
  const laneNames = useMemo(() => new Map(lanes.map((l) => [l.id, { name: l.name, color: l.color ?? H.accent }])), [lanes, H.accent]);

  // ── the scene ──────────────────────────────────────────────────────────────
  const host = useRef<HTMLDivElement | null>(null);
  const scene = useRef<SceneHandle | null>(null);
  const pickRef = useRef<(p: ScenePick | null) => void>(() => {});
  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = createSpaceScene(host.current, (p) => pickRef.current(p));
    } catch {
      setSceneFailed(true);
    }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, []);
  useEffect(() => {
    scene.current?.setModel({ lens, focused, ghosts: journeys.filter((j) => j !== focused), layers, laneNames, team, mode, editable: edit });
  }, [lens, focused, journeys, layers, laneNames, team, mode, edit]);
  useEffect(() => { scene.current?.setFocus(sel); }, [sel, focused, layers]);

  const say = useCallback((msg: string, warn = false) => setToast({ msg, warn, at: Date.now() }), []);
  // AE.7: a teammate's edit filed as a proposal says so here.
  useEffect(() => { if (lanesApi.notice) say(lanesApi.notice.text); }, [lanesApi.notice, say]);
  useEffect(() => { if (outcomesApi.notice) say(outcomesApi.notice.text); }, [outcomesApi.notice, say]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (act: () => Promise<string | null>, ok?: () => void): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const err = await act();
    setBusy(false);
    if (err) { say(err, true); return false; }
    ok?.();
    return true;
  };

  // A lens asked for from another surface.
  const lastLens = useRef<number | null>(null);
  useEffect(() => {
    if (!lensRequest || lastLens.current === lensRequest.at) return;
    lastLens.current = lensRequest.at;
    setLens(lensRequest.lens); setSel(null); setForm(null); scene.current?.home();
    if (lensRequest.journeyId) setWfId(lensRequest.journeyId);
  }, [lensRequest]);

  // ── resolving the selection ────────────────────────────────────────────────
  const stageOf = (id: string | undefined) => (id ? focused?.stages.find((s) => s.id === id) ?? null : null);
  const outcomeOf = (st: SpaceStage | null, id: string | undefined) => (st && id ? st.outcomes.find((o) => o.id === id) ?? null : null);

  // A write's result is selected once the re-read carries it.
  useEffect(() => {
    if (!awaiting || !focused) return;
    if (awaiting.kind === 'step') {
      const s = focused.stages.find((x) => !awaiting.known.has(x.id) && x.name === awaiting.name);
      if (s) { setSel({ kind: 'step', stepId: s.id }); setAwaiting(null); }
      return;
    }
    const st = stageOf(awaiting.stepId);
    if (!st) return;
    if (awaiting.kind === 'outcome') {
      const o = st.outcomes.find((x) => !awaiting.known.has(x.id) && x.name === awaiting.name);
      if (o) { setSel({ kind: 'outcome', stepId: st.id, outcomeId: o.id }); setAwaiting(null); }
      return;
    }
    const o = outcomeOf(st, awaiting.outcomeId);
    const r = o?.reqs.find((x) => !awaiting.known.has(x.id));
    if (o && r) { setSel({ kind: 'req', stepId: st.id, outcomeId: o.id, reqId: r.id }); setAwaiting(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, focused]);

  const goto = (next: Sel) => { setSel(next); setForm(null); setConfirmDelete(null); scene.current?.settle(next); };
  const close = () => { setSel(null); setForm(null); setConfirmDelete(null); scene.current?.recenter(); };

  pickRef.current = (p) => {
    setConfirmDelete(null);
    if (!p) { setSel(null); setForm(null); scene.current?.recenter(); return; }
    if (p.kind === 'wf') { setWfId(p.wfId); setSel(null); setForm(null); scene.current?.home(); return; }
    if (p.kind === 'addout') { setSel({ kind: 'step', stepId: p.stepId }); setForm(edit ? { kind: 'outcome', stepId: p.stepId, outcomeId: null } : null); return; }
    if (p.kind === 'constraint') {
      const c = constraintsApi.rows.find((r) => r.id === p.id);
      setSel({ kind: 'constraint', id: p.id, ctype: layerOf(c?.ctype ?? 'other').ctype }); setForm(null); return;
    }
    setSel(p); setForm(null);
  };

  const switchJourney = (id: string) => { setWfId(id); setSel(null); setForm(null); setStageDraft(null); scene.current?.home(); };
  const switchLens = (next: Lens) => {
    if (next === lens) return;
    setLens(next); setSel(null); setForm(null); setStageDraft(null); scene.current?.home();
  };

  // ── writes ─────────────────────────────────────────────────────────────────
  const addStage = (name: string) => {
    if (!focused) return;
    const known = new Set(focused.stages.map((s) => s.id));
    void run(() => lanesApi.addStep(focused.id, name), lanesApi.proposing ? () => { setStageDraft(null); setForm(null); } : () => {
      setStageDraft(null); setForm(null);
      setAwaiting({ kind: 'step', name, known });
      say(`"${name}" added. It has no outcome yet.`);
    });
  };
  const renameStage = (id: string, name: string) => {
    const cur = stageOf(id);
    setRenaming(null);
    if (!cur || !name.trim() || name.trim() === cur.name) return;
    void run(() => lanesApi.renameStep(id, name.trim()));
  };
  const moveStage = (s: SpaceStage, dir: 'up' | 'down') => {
    if (!focused) return;
    void run(() => lanesApi.moveStep(focused.id, s.id, dir));
  };
  const removeStage = (s: SpaceStage) => {
    if (!focused) return;
    // AE.7 (ruling 16): a stage that holds outcomes goes on the second press;
    // its outcomes are left without a stage, for the person to place again.
    const note = stageRemovalNote(s);
    if (note && confirmDelete !== `step:${s.id}`) { setConfirmDelete(`step:${s.id}`); say(note, true); return; }
    setConfirmDelete(null);
    void run(() => lanesApi.deleteStep(s.id), lanesApi.proposing ? undefined : () => {
      if (sel && 'stepId' in sel && sel.stepId === s.id) { setSel(null); setForm(null); }
      say(note ? `"${s.name}" removed from ${focused.name}. Its outcomes wait to be placed again.` : `"${s.name}" removed from ${focused.name}.`);
    });
  };
  const removeJourney = (j: SpaceJourney) => {
    const lane = lanes.find((l) => l.id === j.id);
    if (!lane) return;
    // AL.5: a workflow goes on the second press; the first says what goes
    // with it, and where its outcomes move.
    const word = workflowRemoval(lane, lanes, outcomesApi.outcomes);
    if ('refusal' in word) { setConfirmDelete(null); say(word.refusal, true); return; }
    if (confirmDelete !== `wf:${j.id}`) { setConfirmDelete(`wf:${j.id}`); say(word.note, true); return; }
    setConfirmDelete(null);
    void run(() => lanesApi.deleteLane(j.id), lanesApi.proposing ? undefined : () => {
      setWfId(null); setSel(null); setForm(null); setStageDraft(null); scene.current?.home();
      void outcomesApi.refresh();
      say(`"${j.name}" removed.`);
    });
  };
  const addJourney = (name: string) => {
    void run(async () => {
      const r = await lanesApi.createLane(name);
      if ('error' in r) return r.error;
      if (r.proposed) { setJourneyDraft(null); return null; }
      setJourneyDraft(null); switchJourney(r.id);
      say(`${name} created. Add its first stage in the strip.`);
      return null;
    });
  };

  const saveOutcome = (f: Extract<Form, { kind: 'outcome' }>, text: string, sentenceId: string) => {
    if (!focused) return;
    const st = stageOf(f.stepId);
    if (!text.trim()) { say('An outcome needs a statement.', true); return; }
    const serves = sentences.filter((v) => v.id === sentenceId);
    if (f.outcomeId) {
      const cur = outcomesApi.outcomes.find((o) => o.id === f.outcomeId);
      const reCite = serves.length > 0 && !(cur?.serves.some((v) => v.id === serves[0].id));
      void run(async () => (await outcomesApi.updateOutcome(f.outcomeId!, { name: text.trim() })) ?? (reCite ? outcomesApi.setServes(f.outcomeId!, serves) : null), () => {
        setForm(null); setSel({ kind: 'outcome', stepId: f.stepId, outcomeId: f.outcomeId! }); say('Outcome updated.');
      });
      return;
    }
    const known = new Set(st?.outcomes.map((o) => o.id) ?? []);
    void run(() => outcomesApi.createOutcome(text.trim(), focused.id, f.stepId, serves), () => {
      setForm(null); setSel({ kind: 'step', stepId: f.stepId });
      setAwaiting({ kind: 'outcome', stepId: f.stepId, name: text.trim(), known });
      say(`Outcome filed on ${st?.name ?? 'the stage'}. Nothing builds it yet.`);
    });
  };

  const saveRequirement = (o: SpaceOutcome, stepId: string, input: { name: string; description: string; criterion: string }) => {
    if (!input.name.trim()) { say('A requirement needs a name.', true); return; }
    if (!input.criterion.trim()) { say('A requirement needs at least one criterion.', true); return; }
    const known = new Set(o.reqs.map((r) => r.id));
    void run(async () => {
      // The outcome's criteria are what a promotion carries: the new one is
      // added to them, then the outcome as it stands becomes the requirement.
      const drafts = identifiedFromRow(o.candidate.criteria).map((c) => ({ id: c.id, text: c.text, verification: c.verification }));
      const setErr = await outcomesApi.setCriteria(o.id, [...drafts, { text: input.criterion.trim() }]);
      if (setErr) return setErr;
      const live = { ...o.candidate, criteria: [...(o.candidate.criteria ?? []), { text: input.criterion.trim() }] };
      return candidateActions.promote(live, { name: input.name.trim(), description: input.description.trim() || input.name.trim() });
    }, () => {
      setForm(null); setSel({ kind: 'outcome', stepId, outcomeId: o.id });
      setAwaiting({ kind: 'req', stepId, outcomeId: o.id, name: input.name.trim(), known });
      say('Requirement added under this outcome.');
    });
  };

  const fileRequirement = (stepId: string, rowId: string) => {
    if (!focused) return;
    const row = requirementRows.find((r) => r.id === rowId);
    if (!row) { say('That requirement is gone. Refresh and try again.', true); return; }
    void run(() => outcomesApi.fileRequirement({ rowId: row.id, name: row.name, ref: row.ref }, focused.id, stepId), () => {
      setForm(null); setSel({ kind: 'step', stepId });
      say(`${row.ref} filed on ${stageOf(stepId)?.name ?? 'the stage'}.`);
    });
  };

  const putOnStep = (o: SpaceOutcome, stepId: string, targetStepId: string) => {
    const target = lanes.flatMap((l) => l.steps.map((s) => ({ l, s }))).find((x) => x.s.id === targetStepId);
    if (!target) { say('Pick a step.', true); return; }
    void run(() => outcomesApi.toggleStepMap(o.id, targetStepId), () => {
      setForm(null); setSel({ kind: 'outcome', stepId, outcomeId: o.id });
      say(`Also on ${target.l.name} · ${target.s.name}.`);
    });
  };
  const unmap = (o: SpaceOutcome, stepId: string) => void run(() => outcomesApi.toggleStepMap(o.id, stepId), () => say('Removed from that step.'));
  const closeOutcome = (o: SpaceOutcome) => void run(() => candidateActions.settle(o.candidate), () => say('Closed. Every requirement under it is proven.'));
  const removeOutcome = (o: SpaceOutcome, st: SpaceStage) => {
    const refusal = outcomeRemovalRefusal(o);
    if (refusal) { say(refusal, true); return; }
    void run(() => candidateActions.dismiss(o.candidate), () => {
      setSel({ kind: 'step', stepId: st.id }); setForm(null); say(`Outcome removed from ${st.name}.`);
    });
  };
  const removeRequirement = (r: SpaceRequirement, stepId: string, outcomeId: string) => {
    void run(() => onDeleteRequirement(r.id), () => {
      setConfirmDelete(null); setSel({ kind: 'outcome', stepId, outcomeId }); say(`${r.ref} removed.`);
    });
  };
  const saveConstraint = (input: ConstraintInput) => {
    if (!input.title.trim()) { say('A constraint needs a rule.', true); return; }
    // R.2b: "role:backend-service" and the like hold for part of the system; a bare id is a workflow.
    const at = input.scope.indexOf(':');
    const prefix = at > 0 ? input.scope.slice(0, at) : '';
    const narrow = (['role', 'technology', 'contract_kind', 'node'] as const).find((k) => k === prefix);
    const scope = narrow ? { kind: narrow, value: input.scope.slice(at + 1) } : null;
    const extra = { title: input.title, rationale: input.rationale, ...(scope ? { scope } : {}), ...(input.check ? { check: input.check } : {}) };
    void run(() => constraintsApi.add(input.ctype as ConstraintType, input.description.trim() || input.title.trim(), scope ? null : (input.scope || null), extra), () => {
      setForm(null); setSel({ kind: 'layer', ctype: input.ctype }); say(`${input.check ? 'Check' : 'Constraint'} filed under ${layerOf(input.ctype).label}.`);
    });
  };
  const liftWaiver = (id: string, waiverId: string) => void run(() => constraintsApi.liftWaiver(id, waiverId), () => say('Waiver lifted. The check holds there again.'));
  const removeConstraint = (id: string, ctype: string) => void run(() => constraintsApi.remove(id), () => {
    setSel({ kind: 'layer', ctype }); setForm(null); say('Constraint removed.');
  });

  // ── the strip ──────────────────────────────────────────────────────────────
  const avatar = (label: string | null | undefined) => (team && label?.trim()
    ? <span className="av" style={{ background: avatarTone(label) }} title={label}>{initialsOf(label)}</span>
    : null);

  const journeyStrip = focused ? (
    <>
      {focused.stages.map((s, i) => {
        const on = !!sel && 'stepId' in sel && sel.stepId === s.id && sel.kind === 'step';
        const loud = s.state === 'unimpl' || s.state === 'none';
        const segs = chainSegments(s, mode);
        const lblColor = loud ? tone(s.state) : (s.state === 'ready' || s.state === 'done') ? H.proven : 'var(--ws-text-4)';
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            data-testid="space-stage"
            data-state={s.state}
            className={`sbox b${s.state === 'unimpl' ? ' loud' : ''}`}
            aria-pressed={on}
            onClick={(e) => { if ((e.target as HTMLElement).closest('.sacts,input')) return; goto({ kind: 'step', stepId: s.id }); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') goto({ kind: 'step', stepId: s.id }); }}
          >
            <span className="r1">
              <span className="num">{i + 1}</span>
              {renaming?.id === s.id ? (
                <input className="nm" aria-label="Stage name" autoFocus value={renaming.value}
                  onChange={(e) => setRenaming({ id: s.id, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') renameStage(s.id, renaming.value); if (e.key === 'Escape') setRenaming(null); }}
                  onBlur={() => renameStage(s.id, renaming.value)} />
              ) : <span className="nm">{s.name}</span>}
            </span>
            <span className="chain">{segs.map((c, k) => <i key={k} style={c ? { background: c } : undefined} />)}</span>
            <span className="lbl" style={{ color: lblColor, fontWeight: s.state === 'unimpl' ? 650 : undefined }}>{stripLabel(s)}</span>
            {edit && <span className="sacts">
              <button type="button" data-testid="space-stage-rename" title="Rename" aria-label={`Rename ${s.name}`} onClick={() => setRenaming({ id: s.id, value: s.name })}>&#9998;</button>
              {i > 0 && <button type="button" title="Move earlier" aria-label="Move earlier" onClick={() => moveStage(s, 'up')}>&#9664;</button>}
              {i < focused.stages.length - 1 && <button type="button" title="Move later" aria-label="Move later" onClick={() => moveStage(s, 'down')}>&#9654;</button>}
              <button type="button" className="rm" data-testid="space-stage-remove" title="Remove this stage" aria-label={`Remove ${s.name}`} onClick={() => removeStage(s)}>×</button>
            </span>}
          </div>
        );
      })}
      {!edit ? null : stageDraft === null ? (
        <button type="button" className="addbox b" data-testid="space-add-stage" title="Add a stage" onClick={() => setStageDraft('')}>+</button>
      ) : (
        <div className="addbox wide">
          <input data-testid="space-stage-draft" aria-label="New stage" placeholder="Name the stage" autoFocus value={stageDraft}
            onChange={(e) => setStageDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { if (stageDraft.trim()) addStage(stageDraft.trim()); else setStageDraft(null); } if (e.key === 'Escape') setStageDraft(null); }}
            onBlur={() => { if (!stageDraft.trim()) setStageDraft(null); }} />
        </div>
      )}
    </>
  ) : null;

  const layerStrip = (
    <>
      {layers.map(({ layer, rows }, i) => {
        const on = sel?.kind === 'layer' && sel.ctype === layer.ctype;
        return (
          <div key={layer.ctype} role="button" tabIndex={0} data-testid="space-layer" className="sbox b" aria-pressed={on}
            onClick={(e) => { if ((e.target as HTMLElement).closest('.sacts')) return; setSel({ kind: 'layer', ctype: layer.ctype }); setForm(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSel({ kind: 'layer', ctype: layer.ctype }); setForm(null); } }}>
            <span className="r1"><span className="num">{i + 1}</span><span className="nm">{layer.label}</span></span>
            <span className="chain"><i style={{ background: layerColor(layer, mode) }} /></span>
            <span className="lbl">{layerCountLine(rows)}</span>
            {edit && <span className="sacts">
              <button type="button" title="Add a constraint here" aria-label={`Add a constraint in ${layer.label}`} onClick={() => { setSel({ kind: 'layer', ctype: layer.ctype }); setForm({ kind: 'constraint', ctype: layer.ctype }); }}>+</button>
            </span>}
          </div>
        );
      })}
      {edit && <button type="button" className="addbox b" data-testid="space-add-constraint" title="Add a constraint" onClick={() => {
        const first = layers[0]?.layer.ctype ?? 'technology';
        setSel({ kind: 'layer', ctype: first }); setForm({ kind: 'constraint', ctype: first });
      }}>+</button>}
    </>
  );

  // ── the inspector ──────────────────────────────────────────────────────────
  const head = (label: string, color: string) => (
    <div className="ihead">
      <span className="eyebrow" style={{ color }}>{label}</span>
      <button type="button" className="ix b" data-testid="space-inspector-close" aria-label="Close" onClick={close}>×</button>
    </div>
  );
  const kv = (k: string, v: string | null | undefined, plain = false) => (v ? <div className="kv"><span className="k">{k}</span><span className={`v${plain ? ' plain' : ''}`}>{v}</span></div> : null);
  const lnk = (key: string, dot: string, text: string, right: React.ReactNode, onClick?: () => void, extra?: { disabled?: boolean; testid?: string; rightColor?: string }) => (
    <button key={key} type="button" className="lnk b" data-testid={extra?.testid} disabled={extra?.disabled || !onClick} onClick={onClick}>
      <span className="dot" style={{ background: dot }} />
      <span className="t">{text}</span>
      <span className="g" style={{ color: extra?.rightColor }}>{right}</span>
    </button>
  );

  function renderForm(f: Form): { cap: string; body: React.ReactNode } {
    if (f.kind === 'outcome') {
      const st = stageOf(f.stepId);
      const o = outcomeOf(st, f.outcomeId ?? undefined);
      const cited = o ? servedBy(o.candidate, sentences).current[0]?.id ?? '' : '';
      return { cap: H.outcome, body: <OutcomeForm key={`${f.stepId}:${f.outcomeId ?? 'new'}`} stageName={st?.name ?? ''} editing={!!f.outcomeId} initial={o?.name ?? ''} sentences={sentences} initialSentence={f.outcomeId ? cited : (firstSentenceId ?? sentences[0]?.id ?? '')} busy={busy} head={head} hue={H.outcome} onSave={(text, sentenceId) => saveOutcome(f, text, sentenceId)} onCancel={() => setForm(null)} /> };
    }
    if (f.kind === 'req') {
      const o = outcomeOf(stageOf(f.stepId), f.outcomeId);
      if (!o) return { cap: H.requirement, body: null };
      return { cap: H.requirement, body: <RequirementForm key={o.id} outcomeName={o.name} busy={busy} head={head} hue={H.requirement} onSave={(input) => saveRequirement(o, f.stepId, input)} onCancel={() => setForm(null)} /> };
    }
    if (f.kind === 'also') {
      const o = outcomeOf(stageOf(f.stepId), f.outcomeId);
      if (!o) return { cap: H.outcome, body: null };
      const sitting = new Set(o.candidate.stepIds);
      const options = lanes.flatMap((l) => l.steps.filter((s) => !sitting.has(s.id)).map((s) => ({ id: s.id, label: `${l.name} · ${s.name}` })));
      return { cap: H.outcome, body: <AlsoForm key={o.id} outcomeName={o.name} options={options} busy={busy} head={head} hue={H.outcome} onSave={(target) => putOnStep(o, f.stepId, target)} onCancel={() => setForm(null)} /> };
    }
    if (f.kind === 'file') {
      const st = stageOf(f.stepId);
      if (!st) return { cap: H.requirement, body: null };
      return { cap: H.requirement, body: <FileForm key={st.id} stageName={st.name} options={fileableIn(focused, requirementRows)} busy={busy} head={head} hue={H.requirement} onSave={(rowId) => fileRequirement(st.id, rowId)} onCancel={() => setForm(null)} /> };
    }
    const L = layerOf(f.ctype);
    return { cap: layerColor(L, mode), body: <ConstraintForm key={f.ctype} ctype={L.ctype} lanes={lanes} shape={systemShape} busy={busy} head={head} mode={mode} onSave={saveConstraint} onCancel={() => setForm(null)} /> };
  }

  function renderPane(d: Sel): { cap: string; body: React.ReactNode } | null {
    if (d.kind === 'layer') {
      const L = layerOf(d.ctype), LC = layerColor(L, mode);
      const rows = constraintsApi.rows.filter((r) => layerOf(r.ctype).ctype === L.ctype);
      const glob = rows.filter((r) => !r.workflow_id && !isNarrowScope(r)), per = rows.filter((r) => !!r.workflow_id), narrow = rows.filter((r) => isNarrowScope(r));
      const conRow = (c: typeof rows[number]) => {
        const sc = scopeOf(c, lanes, mode, nodeName);
        return lnk(c.id, sc.tone, c.title || c.description, sc.word, () => setSel({ kind: 'constraint', id: c.id, ctype: L.ctype }), { testid: 'space-constraint', rightColor: sc.tone });
      };
      return {
        cap: LC, body: (
          <>
            {head('Layer', LC)}
            <h2 className="ititle">{L.label}</h2>
            <p className="inote">{rows.length} constraint{rows.length === 1 ? '' : 's'} filed under this layer.</p>
            {!rows.length && <p className="inote" style={{ fontStyle: 'italic' }}>Nothing here yet.</p>}
            {glob.length > 0 && <><p className="sec">Global</p>{glob.map(conRow)}</>}
            {per.length > 0 && <><div style={{ height: 8 }} /><p className="sec">For one workflow</p>{per.map(conRow)}</>}
            {narrow.length > 0 && <><div style={{ height: 8 }} /><p className="sec">For part of the system</p>{narrow.map(conRow)}</>}
            {edit && <button type="button" className="fixit b" data-testid="space-new-constraint" onClick={() => setForm({ kind: 'constraint', ctype: L.ctype })}>Add a constraint</button>}
          </>
        ),
      };
    }
    if (d.kind === 'constraint') {
      const c = constraintsApi.rows.find((r) => r.id === d.id);
      if (!c) return null;
      const L = layerOf(c.ctype), sc = scopeOf(c, lanes, mode, nodeName), LC = layerColor(L, mode);
      // R.2b and R.2c: what it checks, how it has been used, where it does not hold.
      const check = c.kind === 'check' ? asCheckSpec(c.check_spec) : null;
      const st = c.stats ?? {};
      const fired = st.fired ?? 0;
      const useLine = fired > 0 || (st.violated ?? 0) > 0 || (st.waived ?? 0) > 0
        ? `${[
          check ? `Held against ${fired} proposal${fired === 1 ? '' : 's'}` : `Carried into task documents ${fired} time${fired === 1 ? '' : 's'}`,
          st.violated ? `broken by ${st.violated}` : '',
          st.waived ? `waived ${st.waived} time${st.waived === 1 ? '' : 's'}` : '',
          st.lastFiredAt ? `last on ${shortDate(st.lastFiredAt)}` : '',
        ].filter(Boolean).join(', ')}.`
        : null;
      const originLine = c.origin?.source === 'review' ? "From a reviewer's reason for rejecting a proposal."
        : c.origin?.source === 'recurring_gap' ? `From a gap found on ${c.origin.nodeIds?.length ?? 'several'} nodes.`
        : c.origin?.source === 'implementation_context' ? `From what ${c.origin.nodeIds?.length ?? 'several'} nodes' Implementation Context says.`
        : null;
      const waivers = (c.waivers ?? []).filter((w) => waiverHolds(w, new Date()));
      const signals = ruleSignals([ruleFromRow(c as unknown as Record<string, unknown>)]);
      return {
        cap: LC, body: (
          <>
            {head('Constraint', LC)}
            <h2 className="ititle">{c.title || c.description}</h2>
            {c.title && c.description !== c.title && <p className="inote">{c.description}</p>}
            <div className="chips">
              <span className="chip">{L.label}</span>
              <span className="chip" style={{ color: sc.tone }}>{sc.global ? 'Global' : `Only ${sc.word}`}</span>
              {check && <span className="chip" data-testid="space-constraint-kind">{check.severity === 'refuse' ? 'Check, refuses' : 'Check, warns'}</span>}
              {team && c.author && <span className="chip">{c.author}</span>}
            </div>
            {check && <><p className="sec">What it checks</p><p className="inote" data-testid="space-constraint-check">{describeCheck(check, { role: idWords, technology: idWords })} {check.severity === 'refuse' ? 'A proposal that breaks it is refused.' : 'A proposal that breaks it files with a warning.'}</p></>}
            {c.rationale && <><p className="sec">Why it is here</p><p className="inote">{c.rationale}</p></>}
            {originLine && <p className="inote" data-testid="space-constraint-origin">{originLine}</p>}
            {useLine && <p className="inote" data-testid="space-constraint-use">{useLine}</p>}
            {signals.map((g) => <p key={g.signal} className="inote" data-testid="space-constraint-signal">{g.detail} {g.signal === 'often_waived' ? 'It may no longer hold as written.' : 'It may no longer apply.'}</p>)}
            {waivers.length > 0 && (
              <>
                <p className="sec">Not held against</p>
                {waivers.map((w) => (
                  <p key={w.id} className="inote" data-testid="space-constraint-waiver">
                    {targetName(w.target)}: {w.reason}{w.expiresAt ? ` Until ${shortDate(w.expiresAt)}.` : ''}{' '}
                    {edit && <button type="button" className="b" data-testid="space-lift-waiver" disabled={busy} onClick={() => liftWaiver(c.id, w.id)}>Lift</button>}
                  </p>
                ))}
              </>
            )}
            {constraintReach?.has(c.id) && <p className="inote" data-testid="space-constraint-reach">{reachLine(constraintReach.get(c.id)!)}.</p>}
            {edit && <button type="button" className="fixit danger b" data-testid="space-remove-constraint" disabled={busy} onClick={() => removeConstraint(c.id, L.ctype)}>Remove this constraint</button>}
          </>
        ),
      };
    }

    const st = stageOf(d.stepId);
    if (!st || !focused) return null;

    if (d.kind === 'step') {
      const ss = st.state, cap = tone(ss);
      return {
        cap, body: (
          <>
            {head(`Stage ${st.index + 1}`, cap)}
            <h2 className="ititle">{st.name}</h2>
            <p className="inote">{ss === 'none' ? 'This stage has no outcome yet. Nothing below it can exist until it does.'
              : ss === 'unimpl' ? 'Something on this stage says what it should do, and nothing builds it.'
                : ss === 'done' ? 'Everything on this stage is proven and closed.'
                  : ss === 'ready' ? 'Everything on this stage is proven. Close it when you agree.'
                    : 'This stage is being built.'}</p>
            {team && focused.ownerLabel && <div className="attrib">{avatar(focused.ownerLabel)}<span>{focused.ownerLabel} owns this workflow</span></div>}
            <p className="sec">{st.outcomes.length || 'No'} outcome{st.outcomes.length === 1 ? '' : 's'} on this stage</p>
            {st.outcomes.map((o) => (
              <div key={o.id}>
                {lnk(o.id, tone(o.state), o.name, OUT_WORD[o.state], () => goto({ kind: 'outcome', stepId: st.id, outcomeId: o.id }), { testid: 'space-goto-outcome', rightColor: tone(o.state) })}
                <p className="inote" style={{ margin: '2px 0 10px' }}>
                  {o.reqs.length ? `${o.reqs.length} requirement${o.reqs.length === 1 ? '' : 's'}` : 'nothing builds it'}
                  {team && o.byAgent ? ` · from ${o.agent ? shortName(o.agent) : 'an agent'}` : ''}
                  {o.also.length ? ` · also on ${o.also[0].laneName} · ${o.also[0].stepName}` : ''}
                </p>
              </div>
            ))}
            {edit && <button type="button" className="fixit b" data-testid="space-new-outcome" onClick={() => setForm({ kind: 'outcome', stepId: st.id, outcomeId: null })}>Add an outcome</button>}
            {edit && fileableIn(focused, requirementRows).length > 0 && (
              <button type="button" className="fixit quiet b" data-testid="space-file-requirement" onClick={() => setForm({ kind: 'file', stepId: st.id })}>File a requirement here</button>
            )}
          </>
        ),
      };
    }

    const o = outcomeOf(st, d.outcomeId);
    if (!o) return renderPane({ kind: 'step', stepId: st.id });

    if (d.kind === 'outcome') {
      const oTone = tone(o.state);
      return {
        cap: oTone, body: (
          <>
            {head('Outcome', H.outcome)}
            <h2 className="ititle">{o.name}</h2>
            {o.description && <p className="inote">{o.description}</p>}
            {sentences.length > 0 && (
              <div data-testid="space-serves">
                <p className="inote" style={{ marginBottom: 4 }}>{servesLine(o.candidate, sentences)}</p>
                <label className="fld"><span>Serves the vision</span>
                  <select data-testid="space-serves-select" value={servedBy(o.candidate, sentences).current[0]?.id ?? ''} disabled={busy || !edit} onChange={(e) => {
                    const pick = sentences.find((v) => v.id === e.target.value);
                    if (pick) void run(() => outcomesApi.setServes(o.id, [pick]), () => say('The outcome now cites that part of the vision.'));
                  }}>
                    <option value="" disabled>Which part of the vision?</option>
                    {sentences.map((v) => <option key={v.id} value={v.id}>{sentenceLabel(v)}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="attrib">
              <span className="dotlive" style={{ background: oTone }} />
              <span>Stage {st.index + 1} · {st.name}</span>
              <span style={{ marginLeft: 'auto', color: oTone, fontWeight: 650 }}>{OUT_WORD[o.state]}</span>
            </div>
            {o.live && <div className="attrib"><span className="dotlive" /><span>An agent is working on this now.</span></div>}
            <p className="sec">Also on</p>
            {!o.also.length && <p className="inote" style={{ fontStyle: 'italic', marginBottom: 6 }}>Only this stage.</p>}
            {o.also.map((a) => (
              <button key={a.stepId} type="button" className="lnk b" data-testid="space-also" onClick={(e) => {
                if ((e.target as HTMLElement).hasAttribute('data-unmap')) { e.stopPropagation(); unmap(o, a.stepId); return; }
                setWfId(a.laneId); setSel({ kind: 'step', stepId: a.stepId }); setForm(null); scene.current?.home();
              }}>
                <span className="dot" style={{ background: a.laneColor }} />
                <span className="t">{a.laneName} · {a.stepName}</span>
                {o.pending && edit && <span className="g" data-unmap="1" data-testid="space-unmap" role="button" title="Remove from that step">×</span>}
              </button>
            ))}
            {o.pending
              ? edit && <button type="button" className="fixit quiet b" data-testid="space-also-form" onClick={() => setForm({ kind: 'also', stepId: st.id, outcomeId: o.id })}>Put it on another step</button>
              : <p className="inote" style={{ marginTop: 8 }}>Closed: it keeps the steps it was closed on.</p>}

            {o.state === 'unimpl' ? (
              <div className="deadend" style={{ marginTop: 12 }}><b>Nothing builds this.</b> An outcome with no requirement under it is a wish. No node carries it and no file proves it.</div>
            ) : (
              <>
                <div style={{ height: 12 }} />
                <p className="sec">Built by {o.reqs.length} requirement{o.reqs.length === 1 ? '' : 's'}</p>
                {o.reqs.map((r) => (
                  <div key={r.id}>
                    {lnk(r.id, requirementProven(r) ? H.proven : H.open, r.name, r.ref, () => goto({ kind: 'req', stepId: st.id, outcomeId: o.id, reqId: r.id }), { testid: 'space-goto-req', rightColor: H.requirement })}
                    <p className="inote" style={{ margin: '2px 0 10px' }}>{r.proven} of {r.total} criteria proven · from {r.by === 'agent' ? 'an agent' : 'you'}{r.at ? ` on ${shortDate(r.at)}` : ''}</p>
                  </div>
                ))}
                {o.state === 'ready' && (
                  <>
                    <div className="covered"><b>Ready to close.</b> Every requirement under this outcome is proven, so it is already achieved by what those requirements show. NodeSpec will not close it for you.</div>
                    {edit && <button type="button" className="fixit b" data-testid="space-close-outcome" disabled={busy} onClick={() => closeOutcome(o)}>Close this outcome</button>}
                  </>
                )}
                {o.state === 'done' && <div className="covered"><b>Done.</b> Proven by its requirements, and you closed it.</div>}
              </>
            )}
            {o.pending && edit && (
              <>
                <button type="button" className="fixit b" data-testid="space-new-req" onClick={() => setForm({ kind: 'req', stepId: st.id, outcomeId: o.id })}>Add a requirement</button>
                <button type="button" className="fixit quiet b" data-testid="space-edit-outcome" onClick={() => setForm({ kind: 'outcome', stepId: st.id, outcomeId: o.id })}>Edit the statement</button>
                <button type="button" className="fixit danger b" data-testid="space-remove-outcome" disabled={busy} onClick={() => removeOutcome(o, st)}>Remove this outcome</button>
              </>
            )}
          </>
        ),
      };
    }

    const r = o.reqs.find((x) => x.id === d.reqId);
    if (!r) return renderPane({ kind: 'outcome', stepId: st.id, outcomeId: o.id });
    const idx = o.reqs.indexOf(r);

    if (d.kind === 'req') {
      return {
        cap: H.requirement, body: (
          <>
            {head(r.ref, H.requirement)}
            <h2 className="ititle">{r.name}</h2>
            {r.description && <p className="inote">{r.description}</p>}
            <div className="chips">
              <span className="chip" style={r.confirmed ? { color: H.accent } : undefined}>{r.locked ? 'Locked' : r.confirmed ? 'Confirmed' : 'Open'}</span>
              <span className="chip" style={requirementProven(r) ? { color: H.proven } : undefined}>{r.proven} of {r.total} proven</span>
              {o.reqs.length > 1 && <span className="chip">{idx + 1} of {o.reqs.length} under this outcome</span>}
            </div>
            {r.locked && <p className="inote">Locked: an agent cannot change this. Evidence still lands, and only you unlock it.</p>}
            <p className="sec">Acceptance criteria</p>
            {!r.criteria.length && <p className="inote" style={{ fontStyle: 'italic' }}>None yet.</p>}
            {r.criteria.map((c, i) => (
              <div key={i} className="crit">
                <span className="tick" style={{ color: c.met ? H.proven : H.open }}>{c.met ? '✓' : '○'}</span>
                <span>{c.text}{c.manual && <span className="sub"> · manual</span>}</span>
                <span className="bind">{c.testRef ?? `AC${i + 1}`}</span>
              </div>
            ))}
            <div style={{ height: 12 }} />
            <p className="sec">{r.also.length ? 'Under the outcomes' : 'Under the outcome'}</p>
            {lnk('o', tone(o.state), o.name, OUT_WORD[o.state], () => goto({ kind: 'outcome', stepId: st.id, outcomeId: o.id }), { rightColor: tone(o.state) })}
            {/* AL.13: the other outcomes behind this requirement, each in
                its workflow; a click brings that journey forward on it. */}
            {r.also.map((a) => lnk(`also-${a.outcomeId}`, a.laneColor, a.outcomeName, `${a.laneName}${a.stepName ? `, ${a.stepName}` : ', unplaced'}`, () => {
              setWfId(a.laneId);
              setSel(a.stepId ? { kind: 'outcome', stepId: a.stepId, outcomeId: a.outcomeId } : null);
              setForm(null); setConfirmDelete(null); scene.current?.home();
            }, { testid: 'space-req-also' }))}
            <div style={{ height: 12 }} />
            <p className="sec">Lives on</p>
            {lnk('n', r.node ? H.node : H.gap, r.node ? r.node.label : 'no node yet', '→', r.node ? () => goto({ kind: 'node', stepId: st.id, outcomeId: o.id, reqId: r.id }) : undefined, { testid: 'space-goto-node' })}
            <div style={{ height: 12 }} />
            <p className="sec">Open in</p>
            {lnk('l', H.accent, 'Requirements list', '→', onOpenRequirement ? () => onOpenRequirement(focused.id, r.id) : undefined, { testid: 'space-open-requirements' })}
            {!edit ? null : confirmDelete === r.id ? (
              <div className="attrib warn" style={{ marginTop: 10 }}>
                <span style={{ flex: 1 }}>Remove {r.ref}, its criteria and its tests?</span>
                <button type="button" className="ix b bad" style={{ width: 'auto', padding: '0 8px' }} data-testid="space-remove-req-confirm" disabled={busy} onClick={() => removeRequirement(r, st.id, o.id)}>Remove</button>
                <button type="button" className="ix b" style={{ width: 'auto', padding: '0 8px' }} onClick={() => setConfirmDelete(null)}>Keep</button>
              </div>
            ) : (
              <button type="button" className="fixit danger b" data-testid="space-remove-req" onClick={() => setConfirmDelete(r.id)}>Remove this requirement</button>
            )}
          </>
        ),
      };
    }

    if (d.kind === 'node') {
      const nd = r.node;
      if (!nd) return renderPane({ kind: 'req', stepId: st.id, outcomeId: o.id, reqId: r.id });
      const done = nd.tasks.filter((t) => t.done).length;
      return {
        cap: H.node, body: (
          <>
            {head('Architecture', H.node)}
            <h2 className="ititle">{nd.label}</h2>
            <div className="chips">
              {nd.tech && <span className="chip">{nd.tech}</span>}
              <span className="chip">{done} of {nd.tasks.length} tasks done</span>
              <span className="chip">{r.ref}</span>
            </div>
            <p className="sec">Tasks</p>
            {!nd.tasks.length && <p className="inote" style={{ fontStyle: 'italic' }}>No tasks on this node yet.</p>}
            {nd.tasks.map((t) => (
              <div key={t.id} className="crit">
                <span className="tick" style={{ color: t.done ? H.proven : H.open }}>{t.done ? '✓' : '○'}</span>
                <span>{t.title}{(t.commit || t.planSet !== null) && <><br /><span className="sub">{t.done && t.commit ? `ticked at ${t.commit}` : t.planSet !== null ? `Set ${t.planSet} in the build order` : ''}</span></>}</span>
                <span className="bind">{t.displayId}</span>
              </div>
            ))}
            {nd.taskTotal > 0 && <p className="inote" style={{ marginTop: 8 }}>{nd.tasks.length} of {nd.taskTotal} tasks on {nd.label} serve this stage.</p>}
            <p className="sec">Test plan</p>
            {!r.tests.length && <p className="inote" style={{ fontStyle: 'italic' }}>No test cases bound yet. Nothing proves this node.</p>}
            {r.tests.map((t) => {
              const col = t.status === 'passed' ? H.proven : t.status === 'failed' ? H.bad : 'var(--ws-text-4)';
              const line = [t.type, t.framework, t.criterion ? `proves ${t.criterion}` : null].filter(Boolean).join(' · ');
              return (
                <div key={t.testId} className="crit">
                  <span className="tick" style={{ color: col }}>{t.status === 'passed' ? '✓' : t.status === 'failed' ? '✕' : '○'}</span>
                  <span>{t.name}{line && <><br /><span className="sub">{line}</span></>}</span>
                  <span className="bind">{t.testId}</span>
                </div>
              );
            })}
            <div style={{ height: 12 }} />
            <p className="sec">Carried into</p>
            {lnk('a', r.artifact ? H.artifact : H.gap, r.artifact ? r.artifact.path : 'nothing in the repository yet', r.artifact?.sha ?? '', r.artifact ? () => goto({ kind: 'artifact', stepId: st.id, outcomeId: o.id, reqId: r.id }) : undefined, { testid: 'space-goto-artifact', rightColor: r.artifact ? H.artifact : H.gap })}
            <div style={{ height: 12 }} />
            <p className="sec">Open in</p>
            {lnk('arch', H.accent, 'Architecture canvas', '→', onOpenArchitecture ? () => onOpenArchitecture(nd.id) : undefined, { testid: 'space-open-architecture' })}
          </>
        ),
      };
    }

    const ar = r.artifact;
    if (!ar) return renderPane({ kind: 'req', stepId: st.id, outcomeId: o.id, reqId: r.id });
    return {
      cap: H.artifact, body: (
        <>
          {head('Code', H.artifact)}
          <h2 className="ititle">{ar.file}</h2>
          <p className="inote">The file that carries {r.ref} into the repository.</p>
          {kv('Folder', ar.dir)}{kv('File', ar.file)}{kv('Commit', ar.sha)}{kv('Content hash', ar.hash)}
          {kv('Language', ar.language, true)}{kv('Kind', ar.kind, true)}{kv('Proven by', ar.provenBy.join(', '))}
          <div style={{ height: 12 }} />
          <p className="sec">Back up the chain</p>
          {r.node && lnk('n', H.node, r.node.label, 'Architecture', () => goto({ kind: 'node', stepId: st.id, outcomeId: o.id, reqId: r.id }), { rightColor: H.node })}
          {lnk('s', 'var(--ws-text)', st.name, `Stage ${st.index + 1}`, () => goto({ kind: 'step', stepId: st.id }))}
        </>
      ),
    };
  }

  const pane = form ? renderForm(form) : sel ? renderPane(sel) : null;

  // A selection whose record is gone (deleted elsewhere) clears itself.
  useEffect(() => {
    if (sel && !form && pane === null) setSel(null);
  });

  const empty = !lanesApi.loading && lens === 'journey' && !focused
    ? <><b>No workflow yet.</b><br />Name one with + above, then lay out its stages in the strip.</>
    : !lanesApi.loading && lens === 'journey' && focused && focused.stages.length === 0
      ? <><b>{focused.name} has no stages yet.</b><br />Add the first with + in the strip.</>
      : !constraintsApi.loading && lens === 'layer' && layers.length === 0
        ? <><b>No constraint filed yet.</b><br />Add one with + in the strip.</>
        : null;

  return (
    <div className="ns-ws" data-testid="workflows-space" data-lens={lens} data-mode={mode}>
      <style>{SPACE_CSS}</style>
      <div ref={host} className="ns-ws-scene" />
      <div className="ns-ws-vignette" />
      {sceneFailed && <div className="ns-ws-empty glass" data-testid="space-unavailable">3D view unavailable.</div>}
      {!sceneFailed && empty && <div className="ns-ws-empty glass" data-testid="space-empty">{empty}</div>}

      <div className="ns-ws-top">
        <div className="pills glass" role="tablist" aria-label="Lens">
          <button type="button" role="tab" className="b" data-testid="space-lens-journey" aria-pressed={lens === 'journey'} onClick={() => switchLens('journey')}>User Journey</button>
          <button type="button" role="tab" className="b" data-testid="space-lens-layer" aria-pressed={lens === 'layer'} onClick={() => switchLens('layer')}>Constraints</button>
        </div>
        {lens === 'journey' && (
          <div className="pills small glass" aria-label="Journeys">
            {journeys.map((j) => (
              <Fragment key={j.id}>
                <button type="button" className="b" data-testid="space-journey" aria-pressed={j.id === focused?.id} onClick={() => switchJourney(j.id)}>
                  {avatar(j.ownerLabel)}<span>{j.name}</span>
                </button>
                {edit && j.id === focused?.id && (
                  <button type="button" className="rmpill b" data-testid="space-journey-remove" title="Remove this workflow" aria-label={`Remove ${j.name}`} disabled={busy} onClick={() => removeJourney(j)}>×</button>
                )}
              </Fragment>
            ))}
            {!edit ? null : journeyDraft === null ? (
              <button type="button" className="addpill b" data-testid="space-add-journey" title="New workflow" aria-label="New workflow" disabled={!projectId} onClick={() => setJourneyDraft('')}>+</button>
            ) : (
              <input data-testid="space-journey-draft" aria-label="New workflow" placeholder="Name the workflow" autoFocus value={journeyDraft}
                onChange={(e) => setJourneyDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { if (journeyDraft.trim()) addJourney(journeyDraft.trim()); else setJourneyDraft(null); } if (e.key === 'Escape') setJourneyDraft(null); }}
                onBlur={() => { if (!journeyDraft.trim()) setJourneyDraft(null); }} />
            )}
          </div>
        )}
        <div className="ns-ws-hint">{LENS_HINT[lens]}</div>
        {(lens === 'layer' || focused) && (
          <div className="glass ns-ws-strip scroll" aria-label={lens === 'layer' ? 'Layers' : 'Stages'} data-testid="space-strip">
            {lens === 'layer' ? layerStrip : journeyStrip}
          </div>
        )}
      </div>

      {pane && (
        <aside className="glass ns-ws-insp" data-testid="space-inspector" data-kind={form ? `form:${form.kind}` : sel?.kind}>
          <div className="cap" style={{ background: pane.cap }} />
          <div className="ibody scroll">{pane.body}</div>
        </aside>
      )}

      {toast && (
        <div key={toast.at} className={`ns-ws-toast${toast.warn ? ' warn' : ''}`} role="status" data-testid="space-toast">
          <span className="dotlive" /><span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

// ── the add forms ────────────────────────────────────────────────────────────
type Head = (label: string, color: string) => React.ReactNode;

function OutcomeForm({ stageName, editing, initial, sentences, initialSentence, busy, head, hue, onSave, onCancel }: { stageName: string; editing: boolean; initial: string; sentences: readonly VisionSentence[]; initialSentence: string; busy: boolean; head: Head; hue: string; onSave: (text: string, sentenceId: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [sentenceId, setSentenceId] = useState(initialSentence);
  return (
    <>
      {head(editing ? 'Edit the outcome' : 'New outcome', hue)}
      <h2 className="ititle">{stageName}</h2>
      <p className="inote">What this stage should achieve, stated so a requirement can be derived from it. A stage can hold as many as it needs.</p>
      <label className="fld"><span>The outcome</span>
        <textarea data-testid="space-outcome-text" rows={3} autoFocus placeholder="An analyst sees severity and blast radius on one screen" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {sentences.length > 0 && (
        <label className="fld"><span>Serves the vision</span>
          <select data-testid="space-outcome-sentence" value={sentenceId} onChange={(e) => setSentenceId(e.target.value)}>
            {!sentenceId && <option value="" disabled>Which part of the vision?</option>}
            {sentences.map((v) => <option key={v.id} value={v.id}>{sentenceLabel(v)}</option>)}
          </select>
        </label>
      )}
      <div className="formacts">
        <button type="button" className="save b" data-testid="space-form-save" disabled={busy} onClick={() => onSave(text, sentenceId)}>{editing ? 'Save' : 'File the outcome'}</button>
        <button type="button" className="cancel b" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

function RequirementForm({ outcomeName, busy, head, hue, onSave, onCancel }: { outcomeName: string; busy: boolean; head: Head; hue: string; onSave: (input: { name: string; description: string; criterion: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [criterion, setCriterion] = useState('');
  return (
    <>
      {head('New requirement', hue)}
      <h2 className="ititle">{outcomeName}</h2>
      <p className="inote">One outcome can need several requirements. They are not the same thing: the outcome is what should happen, a requirement is what must hold for it to.</p>
      <label className="fld"><span>What must hold</span><input data-testid="space-req-name" autoFocus placeholder="Alert enrichment" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="fld"><span>In full</span><textarea data-testid="space-req-description" rows={3} placeholder="Stated so an agent can build against it" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="fld"><span>First acceptance criterion</span><textarea data-testid="space-req-criterion" rows={2} placeholder="Something a test can prove or fail" value={criterion} onChange={(e) => setCriterion(e.target.value)} /></label>
      <div className="formacts">
        <button type="button" className="save b" data-testid="space-form-save" disabled={busy} onClick={() => onSave({ name, description, criterion })}>Add the requirement</button>
        <button type="button" className="cancel b" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

function FileForm({ stageName, options, busy, head, hue, onSave, onCancel }: { stageName: string; options: ReadonlyArray<{ id: string; ref: string; name: string }>; busy: boolean; head: Head; hue: string; onSave: (rowId: string) => void; onCancel: () => void }) {
  const [target, setTarget] = useState(options[0]?.id ?? '');
  return (
    <>
      {head('File a requirement here', hue)}
      <h2 className="ititle">{stageName}</h2>
      <p className="inote">An existing requirement, filed on this stage. It stays one requirement; the stage reads it as built when it is proven.</p>
      {options.length === 0 ? (
        <p className="inote" style={{ fontStyle: 'italic' }}>Every requirement is already in this workflow.</p>
      ) : (
        <label className="fld"><span>Requirement</span>
          <select data-testid="space-file-requirement-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.ref} · {o.name}</option>)}
          </select>
        </label>
      )}
      <div className="formacts">
        <button type="button" className="save b" data-testid="space-form-save" disabled={busy || !target} onClick={() => onSave(target)}>File it here</button>
        <button type="button" className="cancel b" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

function AlsoForm({ outcomeName, options, busy, head, hue, onSave, onCancel }: { outcomeName: string; options: Array<{ id: string; label: string }>; busy: boolean; head: Head; hue: string; onSave: (stepId: string) => void; onCancel: () => void }) {
  const [target, setTarget] = useState(options[0]?.id ?? '');
  return (
    <>
      {head('Put it on another step', hue)}
      <h2 className="ititle">{outcomeName}</h2>
      <p className="inote">The same outcome can sit on a step in another journey. It stays one outcome: prove it once and both journeys read as built.</p>
      {options.length === 0 ? (
        <p className="inote" style={{ fontStyle: 'italic' }}>It already sits on every step there is.</p>
      ) : (
        <label className="fld"><span>Step</span>
          <select data-testid="space-also-step" value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      )}
      <div className="formacts">
        <button type="button" className="save b" data-testid="space-form-save" disabled={busy || !target} onClick={() => onSave(target)}>Put it there</button>
        <button type="button" className="cancel b" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

type ConstraintInput = { ctype: string; title: string; description: string; rationale: string; scope: string; check: CheckSpec | null };

interface SystemShape { roles: string[]; technologies: string[]; contractKinds: string[]; nodes: Array<{ id: string; label: string }> }

/** R.2b: the node types, technologies, connection kinds and nodes this project has. */
function shapeOfSystem(graph: Graph | null): SystemShape {
  if (!graph) return { roles: [], technologies: [], contractKinds: [], nodes: [] };
  const nodes = Object.values(graph.nodes ?? {}) as Array<{ id: string; type: string; label?: string; technology?: string | null }>;
  const whole = nodes.filter((n) => !String(n.type).startsWith('part-'));
  return {
    roles: [...new Set(whole.map((n) => n.type).filter(Boolean))].sort(),
    technologies: [...new Set(whole.map((n) => n.technology).filter((t): t is string => !!t))].sort(),
    contractKinds: [...new Set(Object.values(graph.contracts ?? {}).map((c) => (c as { kind?: string }).kind).filter((k): k is string => !!k))].sort(),
    nodes: whole.map((n) => ({ id: n.id, label: n.label ?? n.id.slice(0, 8) })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

const PREDICATE_WORDS: Record<CheckSpec['predicate'], string> = {
  contract_has_schema: 'Every connection carries a contract with a schema',
  no_calls_between_roles: 'No direct connection from one node type to another',
  technology_in_list: 'Built only with the technologies chosen',
  sync_calls_at_most: 'A limit on synchronous calls out of a node',
};

function ConstraintForm({ ctype, lanes, shape, busy, head, mode, onSave, onCancel }: { ctype: string; lanes: ReadonlyArray<{ id: string; name: string }>; shape: SystemShape; busy: boolean; head: Head; mode: SpaceMode; onSave: (input: ConstraintInput) => void; onCancel: () => void }) {
  const [ct, setCt] = useState(ctype);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rationale, setRationale] = useState('');
  const [scope, setScope] = useState('');
  // R.2b: guidance, or a check on the architecture with this project's own parameters.
  const [kind, setKind] = useState<'guide' | 'check'>('guide');
  const [predicate, setPredicate] = useState<CheckSpec['predicate']>('contract_has_schema');
  const [severity, setSeverity] = useState<'warn' | 'refuse'>('warn');
  const [fromRole, setFromRole] = useState('');
  const [toRole, setToRole] = useState('');
  const [techs, setTechs] = useState<string[]>([]);
  const [max, setMax] = useState(3);
  const check = kind === 'check'
    ? asCheckSpec({ predicate, severity, params: predicate === 'no_calls_between_roles' ? { from: fromRole, to: toRole } : predicate === 'technology_in_list' ? { technologies: techs } : predicate === 'sync_calls_at_most' ? { max } : {} })
    : null;
  const L = layerOf(ct);
  return (
    <>
      {head('New constraint', layerColor(L, mode))}
      <h2 className="ititle">{L.label}</h2>
      <p className="inote">A rule the work is held to. It binds every stage in its scope.</p>
      <label className="fld"><span>Layer</span>
        <select data-testid="space-con-layer" value={ct} onChange={(e) => setCt(e.target.value)}>
          {LAYERS.map((x) => <option key={x.ctype} value={x.ctype}>{x.label}</option>)}
        </select>
      </label>
      <label className="fld"><span>The rule</span><input data-testid="space-con-title" autoFocus placeholder="Alerts route through the existing SIEM" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="fld"><span>What it means</span><textarea data-testid="space-con-description" rows={3} placeholder="Stated so an agent reading it knows what it may not do" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="fld"><span>Why it is here</span><textarea data-testid="space-con-rationale" rows={2} placeholder="The reason, so nobody relitigates it later" value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      <label className="fld"><span>Applies to</span>
        <select data-testid="space-con-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Global (the whole project)</option>
          {lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          {shape.roles.length > 0 && <optgroup label="Every node of a type">{shape.roles.map((r) => <option key={r} value={`role:${r}`}>{idWords(r)}</option>)}</optgroup>}
          {shape.technologies.length > 0 && <optgroup label="Every node built with">{shape.technologies.map((t) => <option key={t} value={`technology:${t}`}>{idWords(t)}</option>)}</optgroup>}
          {shape.contractKinds.length > 0 && <optgroup label="Every connection of a kind">{shape.contractKinds.map((k) => <option key={k} value={`contract_kind:${k}`}>{k}</option>)}</optgroup>}
          {shape.nodes.length > 0 && <optgroup label="One node and what it holds">{shape.nodes.map((n) => <option key={n.id} value={`node:${n.id}`}>{n.label}</option>)}</optgroup>}
        </select>
      </label>
      <label className="fld"><span>Kind</span>
        <select data-testid="space-con-kind" value={kind} onChange={(e) => setKind(e.target.value as 'guide' | 'check')}>
          <option value="guide">Guidance the agent reads</option>
          <option value="check">A check on the architecture</option>
        </select>
      </label>
      {kind === 'check' && (
        <>
          <label className="fld"><span>What it checks</span>
            <select data-testid="space-con-predicate" value={predicate} onChange={(e) => setPredicate(e.target.value as CheckSpec['predicate'])}>
              {(Object.keys(PREDICATE_WORDS) as Array<CheckSpec['predicate']>).map((p) => <option key={p} value={p}>{PREDICATE_WORDS[p]}</option>)}
            </select>
          </label>
          {predicate === 'no_calls_between_roles' && (
            <>
              <label className="fld"><span>From</span>
                <select data-testid="space-con-from" value={fromRole} onChange={(e) => setFromRole(e.target.value)}>
                  <option value="">A node type</option>
                  {shape.roles.map((r) => <option key={r} value={r}>{idWords(r)}</option>)}
                </select>
              </label>
              <label className="fld"><span>To</span>
                <select data-testid="space-con-to" value={toRole} onChange={(e) => setToRole(e.target.value)}>
                  <option value="">A node type</option>
                  {shape.roles.map((r) => <option key={r} value={r}>{idWords(r)}</option>)}
                </select>
              </label>
            </>
          )}
          {predicate === 'technology_in_list' && (
            <label className="fld"><span>Technologies</span>
              <select data-testid="space-con-techs" multiple value={techs} onChange={(e) => setTechs(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {shape.technologies.map((t) => <option key={t} value={t}>{idWords(t)}</option>)}
              </select>
            </label>
          )}
          {predicate === 'sync_calls_at_most' && (
            <label className="fld"><span>At most</span>
              <input data-testid="space-con-max" type="number" min={0} max={100} value={max} onChange={(e) => setMax(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
            </label>
          )}
          <label className="fld"><span>When a change breaks it</span>
            <select data-testid="space-con-severity" value={severity} onChange={(e) => setSeverity(e.target.value as 'warn' | 'refuse')}>
              <option value="warn">File it with a warning</option>
              <option value="refuse">Refuse the change</option>
            </select>
          </label>
        </>
      )}
      <div className="formacts">
        <button type="button" className="save b" data-testid="space-form-save" disabled={busy || (kind === 'check' && !check)} onClick={() => onSave({ ctype: ct, title, description, rationale, scope, check })}>{kind === 'check' ? 'File the check' : 'File the constraint'}</button>
        <button type="button" className="cancel b" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}
