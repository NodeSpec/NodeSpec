// V3 6.1 → W (owner 2026-09-23, held to the approved mockup): the record
// opens INLINE, under its row, instead of in a pane beside the list. The
// row already says the ref, the name, the state word and the proof count;
// the record says where the requirement runs, what serves it and what
// proves it, in the mockup's four sections, each row a tick, the text, a
// meta line and an id. Y (owner 2026-09-23): Architecture comes first, so
// the node a task lives on is read before the tasks are:
//
//   Architecture   the node it lives on (a door to the canvas), its
//                  technology, how many of the node's tasks serve this
//   Tasks          done or not, "ticked at <commit>" or "Set N" (a door to
//                  the plan), the task id
//   Tests          passed, failed or not run, "<type> · proves ACn", the TC id
//   Code           the file, its language and the other requirements on it,
//                  the commit the evidence was stamped with
//
// The mockup's record carries no acts; the app's record did, and they stay
// (nothing a person could do here yesterday is gone): the brake line with
// Confirm, Lock and Edit above the sections, the criteria (what the proof
// count counts) first, a task ticks from its tick, Add a criterion sits on
// its section's line. Tasks and tests are the agent's to write over MCP; a
// person can still add one, and the act says so by its wording alone: "Add
// by hand", quiet and muted on the section's line, and what it adds carries
// "yours" beside the agent's. Every control is one of four acts: verify,
// edit, decide (nothing here: decisions live under Proposals), or follow
// the trace.
import { memo, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { statusTones } from '../ideation/status-tones.js';
import { eyebrow, title, body, meta, identifier } from '../ideation/typography.js';
import { MarkLine } from '../ideation/MarkLine.js';
import { sinceLabel, type AgentHold } from '../ideation/useAgentPresence.js';
import { lockedRefusal } from '../ideation/useCandidateActions.js';
import { addCriterion, removeCriterion, reword } from '../ideation/verify-lane.js';
import type { VerifyWrite } from '../ideation/VerifyLane.js';
import type { TraceChain } from '../ideation/useTraceData.js';
import type { BandRequirement, RequirementBandApi } from '../ideation/useRequirementBand.js';
import { originsLineOf, rowBrakeLine, type RequirementRecordView, type RecordTask } from './requirements-model.js';

export interface RequirementRecordProps {
  requirement: BandRequirement;
  /** Null while the trace is still reading: the acts render, the sections wait. */
  chain: TraceChain | null;
  record: RequirementRecordView | null;
  holds: AgentHold[];
  canClassify: boolean;
  bandApi: Pick<RequirementBandApi, 'rename' | 'confirm' | 'setLocked'>;
  /** The guarded write: criteria, description, mark. null on success, else the refusal. */
  onWrite: (patch: VerifyWrite) => Promise<string | null>;
  onTickTask: (task: RecordTask, done: boolean) => Promise<string | null>;
  /** A test the person adds proves ONE criterion, chosen here; it is bound at creation. */
  onAddTest: (input: { criterionId: string; name: string; expected: string }) => Promise<string | null>;
  /** The TC id the next added test takes. */
  nextTestId: string;
  /** Y: a task the person adds serves ONE criterion and lives on one of the
   *  requirement's nodes (its task doc). Absent: no act. */
  onAddTask?: (input: { nodeId: string; criterionId: string; title: string }) => Promise<string | null>;
  /** The T id the next added task takes on that node. */
  nextTaskId?: (nodeId: string) => string;
  /** Node id → its technology and task count, for the Architecture rows. */
  nodeInfo?: (nodeId: string) => { tech: string | null } | null;
  /** Path → the file's language, when the graph knows it. */
  fileLanguage?: (path: string) => string | null;
  /** The commit the requirement's evidence was stamped with, short. */
  evidenceCommit?: string | null;
  onOpenArchitecture?: (nodeId: string) => void;
  onOpenWorkflow?: (laneId: string) => void;
  /** 6.3: lands on that task's chip in the plan. */
  onOpenPlan?: (taskId: string) => void;
  onOpenChanges?: (proposalId?: string) => void;
  onWarning?: (message: string) => void;
  /** AA.1: a requirement with no outcome behind it offers the open outcomes it can derive from. */
  attachable?: ReadonlyArray<{ id: string; name: string }>;
  /** AA.1: the person picks the outcome it serves. null on success, else the refusal. */
  onAttach?: (outcomeId: string) => Promise<string | null>;
}

function RequirementRecordComponent(props: RequirementRecordProps) {
  const { requirement, chain, record, holds, canClassify, bandApi, onWrite, onTickTask, onAddTest, nextTestId, onAddTask, nextTaskId, nodeInfo, fileLanguage, evidenceCommit, onOpenArchitecture, onOpenWorkflow, onOpenPlan, onOpenChanges, onWarning, attachable, onAttach } = props;
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const muted = c.textSecondary;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [adding, setAdding] = useState<'criterion' | 'test' | 'task' | null>(null);
  const [draft, setDraft] = useState('');
  const [expected, setExpected] = useState('');
  const [formCriterion, setFormCriterion] = useState<string | null>(null);
  const [taskNode, setTaskNode] = useState<string | null>(null);
  useEffect(() => { setNote(null); setEditing(false); setNameDraft(null); setDescDraft(null); setAdding(null); setDraft(''); setExpected(''); setFormCriterion(null); setTaskNode(null); }, [requirement.id]);

  // The band's row is the lock's source of truth: setLocked re-reads it at
  // once, while the trace's copy (record.locked) arrives with its own read.
  const locked = requirement.locked;
  const lockNote = lockedRefusal(requirement.ref);
  // AL.13: the open outcomes it could still derive from: the ones not
  // already behind it. A requirement may serve several outcomes.
  const attachableHere = useMemo(() => {
    const behind = new Set((record?.origins ?? []).map((o) => o.outcomeId));
    return (attachable ?? []).filter((o) => !behind.has(o.id));
  }, [attachable, record]);

  const run = async (act: () => Promise<string | null>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    const err = await act();
    setBusy(false);
    if (err) { setNote(err); onWarning?.(err); return; }
    setNote(null);
    after?.();
  };

  const act = (primary = false): React.CSSProperties => ({
    border: `1px solid ${primary ? c.primary : c.border}`, borderRadius: '7px', padding: '4px 10px', fontSize: '11.5px', fontWeight: 600,
    background: primary ? c.primary : 'transparent', color: primary ? '#fff' : c.text, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1, fontFamily: 'inherit',
  });
  const quietLink: React.CSSProperties = { border: 'none', background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: '11px', fontWeight: 600, color: c.primary, cursor: 'pointer' };
  const disabledLink: React.CSSProperties = { ...quietLink, color: muted, opacity: .6, cursor: 'not-allowed' };
  // Y: tasks and tests are the agent's to write; adding one by hand is the
  // quieter act, muted beside Add a criterion.
  const handLink: React.CSSProperties = { ...quietLink, color: muted, fontWeight: 500 };
  const yours = (testId: string) => <span data-testid={testId} title="Added by you in Work" style={{ ...meta(muted), marginLeft: '6px' }}>yours</span>;
  const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: `1px solid ${c.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '12px', background: c.surface, color: c.text, outline: 'none', fontFamily: 'inherit' };

  // The mockup's record: a section head (eyebrow, count, and the section's
  // one act on the right), then rows of tick · text · meta · id.
  const recHead = (label: string, count: string, right?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '12px 0 5px' }}>
      <span style={eyebrow(muted)}>{label}</span>
      <span style={meta(muted)}>{count}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
  const recEmpty = (text: string) => <div style={{ ...meta(muted), padding: '3px 0 2px', fontStyle: 'italic' }}>{text}</div>;
  const recRow: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '5px 0', borderBottom: `1px solid ${c.border}40` };
  const tick = (color: string): React.CSSProperties => ({ width: '12px', flexShrink: 0, fontSize: '11px', fontWeight: 700, lineHeight: 1.4, color, textAlign: 'center' });
  const rt: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: '12px', fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const rm: React.CSSProperties = { ...meta(muted), flexShrink: 0, whiteSpace: 'nowrap' };
  const rid: React.CSSProperties = { ...identifier(muted), width: '58px', textAlign: 'right', flexShrink: 0 };
  const testTone = (status: string) => (status === 'passed' ? tones.ok : status === 'failed' ? tones.bad : status === 'running' ? c.primary : status === 'stale' ? tones.warn : muted);
  const testGlyph = (status: string) => (status === 'passed' ? '✓' : status === 'failed' ? '✕' : '○');
  const reqHolds = holds.filter((h) => h.level === 'requirement' && h.refId === requirement.id && !h.stale);

  const commitName = () => {
    const next = nameDraft?.trim() ?? '';
    setNameDraft(null);
    if (!next || next === requirement.name) return;
    void run(() => bandApi.rename(requirement.id, next));
  };
  const commitDescription = () => {
    const next = descDraft ?? '';
    setDescDraft(null);
    if (!chain || next.trim() === chain.verify.description.trim()) return;
    void run(() => onWrite({ description: next.trim() }));
  };

  const tasksDone = record?.tasks.filter((t) => t.done).length ?? 0;
  const testsPassing = record?.tests.filter((t) => t.status === 'passed').length ?? 0;

  return (
    <div data-testid="work-record" data-locked={locked ? 'true' : undefined} style={{ padding: '4px 10px 16px 32px', borderBottom: `1px solid ${c.border}66`, display: 'flex', flexDirection: 'column' }}>
      {/* ── the brake and its acts ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '6px' }}>
        <span data-testid="record-brake" style={{ ...meta(muted), flex: '1 1 260px' }}>{rowBrakeLine(requirement.confirmed, locked)}</span>
        {locked && <span data-testid="record-locked" title={lockNote} style={{ ...meta(c.text), fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Lock size={10} />Locked</span>}
        <span style={{ display: 'flex', gap: '6px' }}>
          {!requirement.confirmed && !locked && (
            <button type="button" data-testid="record-confirm" title="An agent's edit will come back as a proposal instead of applying." disabled={busy} style={act(true)} onClick={() => void run(() => bandApi.confirm(requirement.id))}>Confirm</button>
          )}
          <button type="button" data-testid="work-act-lock" aria-pressed={locked} disabled={busy} style={act(false)} onClick={() => void run(() => bandApi.setLocked(requirement.id, !locked))}>
            {locked ? `Unlock ${requirement.ref}` : `Lock ${requirement.ref}`}
          </button>
          <button type="button" data-testid="record-edit" aria-pressed={editing} disabled={locked || busy} title={locked ? lockNote : undefined} style={{ ...act(false), ...(locked ? { color: muted, cursor: 'not-allowed', opacity: .6 } : {}) }} onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </span>
      </div>
      {editing && (
        <input data-testid="record-name-input" autoFocus value={nameDraft ?? requirement.name} onChange={(e) => setNameDraft(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') setNameDraft(null); }} style={{ ...inputStyle, ...title(c.text), marginTop: '8px' }} />
      )}
      {editing ? (
        <textarea data-testid="record-description-input" rows={3} value={descDraft ?? record?.description ?? ''} placeholder="What this requirement means, in a sentence or two." onChange={(e) => setDescDraft(e.target.value)} onBlur={commitDescription} onKeyDown={(e) => { if (e.key === 'Escape') setDescDraft(null); }} style={{ ...inputStyle, ...body(c.text), resize: 'vertical', marginTop: '6px' }} />
      ) : record?.description ? (
        <p data-testid="record-description" style={{ ...body(muted), margin: '8px 0 0', maxWidth: '82ch' }}>{record.description}</p>
      ) : null}
      {record && (record.step || record.steps.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 12px', marginTop: '6px' }}>
          {record.step && (
            <button type="button" data-testid="record-step" disabled={!onOpenWorkflow} onClick={() => onOpenWorkflow?.(record.step!.laneId)} style={{ ...quietLink, color: muted, fontWeight: 500, cursor: onOpenWorkflow ? 'pointer' : 'default' }}>{record.step.laneName}, step {record.step.index}</button>
          )}
          {/* AL.13: a requirement derived from outcomes in other workflows, or
              filed on other stages, is in those too. */}
          {record.steps.filter((s) => !(record.step && s.laneId === record.step.laneId && s.index === record.step.index)).map((s) => (
            <button key={`${s.laneId}:${s.index}`} type="button" data-testid="record-step-also" disabled={!onOpenWorkflow} onClick={() => onOpenWorkflow?.(s.laneId)} style={{ ...quietLink, color: muted, fontWeight: 500, cursor: onOpenWorkflow ? 'pointer' : 'default' }}>also {s.laneName}, step {s.index}</button>
          ))}
        </div>
      )}
      <div style={{ marginTop: '6px' }}>
        <MarkLine mark={chain?.verify.mark ?? null} canClassify={canClassify} disabled={locked} disabledTitle={lockNote} onCommit={(mark) => void run(() => onWrite({ mark }))} />
      </div>

      {reqHolds.length > 0 && (
        <div data-testid="agent-proposing" style={{ marginTop: '10px', borderRadius: '10px', border: `1px solid ${c.primary}55`, backgroundColor: `${c.primary}14`, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={eyebrow(c.primary)}>Agent on this requirement</span>
          {reqHolds.map((hold) => (
            <div key={hold.checkoutId} style={meta(c.text)}>
              {hold.holder}{hold.credential && <span style={{ ...identifier(muted), fontWeight: 500, marginLeft: '6px' }}>{hold.credential}</span>}
              <span style={{ color: muted }}> · {sinceLabel(hold.since)} ago</span>
              {hold.proposalId && <button type="button" data-testid="agent-open-approval" onClick={() => onOpenChanges?.(hold.proposalId!)} disabled={!onOpenChanges} style={{ ...quietLink, marginLeft: '8px' }}>Review in Proposals</button>}
            </div>
          ))}
        </div>
      )}

      {!record || !chain ? (
        <span style={{ ...meta(muted), paddingTop: '12px' }}>Reading its criteria, tasks and tests.</span>
      ) : (
        <>
          {/* ── Criteria (what the row's proof count counts) ─────────────── */}
          <section data-testid="record-criteria">
            {recHead('Criteria', `${record.criteria.filter((k) => k.met).length} of ${record.criteria.length} proven`,
              <button type="button" data-testid="record-add-criterion" disabled={locked || busy} title={locked ? lockNote : undefined} style={locked ? disabledLink : quietLink} onClick={() => { setAdding('criterion'); setDraft(''); }}>Add a criterion</button>)}
            {record.criteria.map((k) => (
              <div key={k.id} data-testid="record-criterion" data-met={k.met ? 'true' : 'false'} style={recRow}>
                <span style={tick(k.failing ? tones.bad : k.met ? tones.ok : tones.warn)}>{k.failing ? '✕' : k.met ? '✓' : '○'}</span>
                {editing ? (
                  <input defaultValue={k.text} data-testid="record-criterion-input" onBlur={(e) => { const r = reword(chain.verify.criteria, k.id, e.target.value, chain.verify.tests); if (r.changed) void run(() => onWrite({ criteria: r.criteria })); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} style={inputStyle} />
                ) : (
                  <span style={{ ...rt, whiteSpace: 'normal' }}>{k.text}{k.verification === 'manual' && <span data-testid="record-criterion-manual" title="A person proves this one: the task tick and your approval, never a test case" style={{ ...meta(muted), marginLeft: '6px' }}>proven by a person</span>}</span>
                )}
                {editing && <button type="button" title="Remove this criterion" disabled={busy} style={{ ...quietLink, color: muted }} onClick={() => void run(() => onWrite({ criteria: removeCriterion(chain.verify.criteria, k.id) }))}>×</button>}
                <span data-testid={k.testRef ? 'record-criterion-test' : undefined} style={{ ...rid, color: k.testRef ? (k.failing ? tones.bad : k.met ? tones.ok : c.primary) : muted }}>{k.testRef ?? `AC${record.criteria.indexOf(k) + 1}`}</span>
              </div>
            ))}
            {adding === 'criterion' && (
              <div style={recRow}>
                <input data-testid="record-add-criterion-input" autoFocus value={draft} placeholder="A criterion a test can prove" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Escape') { setAdding(null); setDraft(''); }
                  if (e.key === 'Enter' && draft.trim()) { const next = addCriterion(chain.verify.criteria, draft); if (next) void run(() => onWrite({ criteria: next }), () => { setAdding(null); setDraft(''); }); }
                }} style={inputStyle} />
              </div>
            )}
            {record.criteria.length === 0 && adding !== 'criterion' && recEmpty('No criterion yet. A requirement is proven by its criteria.')}
          </section>

          {/* ── Architecture ─────────────────────────────────────────── */}
          <section data-testid="record-architecture">
            {recHead('Architecture', record.nodes.length ? `${record.nodes.length} node${record.nodes.length === 1 ? '' : 's'}` : 'none')}
            {record.nodes.length === 0 && recEmpty('This requirement does not live on a node yet.')}
            {record.nodes.map((n, i) => (
              <div key={n.id} style={recRow}>
                <span style={tick(tones.ok)}>{'●'}</span>
                <button type="button" data-testid="record-node" disabled={!onOpenArchitecture} title={onOpenArchitecture ? `Open ${n.label} in Architecture` : undefined} onClick={() => onOpenArchitecture?.(n.id)} style={{ ...rt, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: onOpenArchitecture ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: '12px', fontWeight: 500 }}>{n.label}</button>
                {nodeInfo?.(n.id)?.tech && <span style={rm}>{nodeInfo(n.id)!.tech}</span>}
                <span style={rid}>{i === 0 ? `${record.tasks.length}/${record.nodeTaskTotal}` : ''}</span>
              </div>
            ))}
          </section>

          {/* ── Tasks ────────────────────────────────────────────────── */}
          <section data-testid="record-tasks">
            {recHead('Tasks', record.tasks.length ? `${tasksDone} of ${record.tasks.length} done` : 'none',
              onAddTask && record.nodes.length > 0
                ? <button type="button" data-testid="record-add-task" disabled={busy} style={handLink} onClick={() => { setAdding('task'); setDraft(''); setFormCriterion(null); setTaskNode(null); }}>Add by hand</button>
                : undefined)}
            {record.tasks.length === 0 && adding !== 'task' && recEmpty('No task serves this requirement yet.')}
            {record.tasks.map((t) => (
              <div key={t.id} data-testid="record-task" data-done={t.done ? 'true' : 'false'} style={recRow}>
                <button type="button" role="checkbox" data-testid="record-task-tick" aria-checked={t.done} aria-label={`${t.displayId} done`} disabled={busy}
                  onClick={() => void run(() => onTickTask(t, !t.done))}
                  style={{ ...tick(t.done ? tones.ok : tones.warn), border: 'none', background: 'transparent', padding: 0, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{t.done ? '✓' : '○'}</button>
                <span style={rt} title={t.title}>{t.title}{t.byHand && yours('record-task-yours')}</span>
                {t.live ? (
                  <span data-testid="record-task-live" style={{ ...rm, color: c.primary, fontWeight: 600 }}>{t.live}</span>
                ) : t.done && t.commit ? (
                  <span data-testid="record-task-commit" style={rm}>ticked at {t.commit}</span>
                ) : t.planSet !== null ? (
                  <button type="button" data-testid="record-task-plan" disabled={!onOpenPlan} onClick={() => onOpenPlan?.(t.id)} style={{ ...quietLink, flexShrink: 0 }}>Set {t.planSet}</button>
                ) : null}
                <span style={rid}>{t.displayId}</span>
              </div>
            ))}
            {adding === 'task' && onAddTask && (() => {
              // A task serves one criterion and lives on one of the nodes
              // above; the node's choice shows only when there is one to make.
              const nodeId = taskNode ?? record.nodes[0]?.id ?? null;
              const chosen = formCriterion ?? record.criteria.find((k) => !k.met)?.id ?? record.criteria[0]?.id ?? null;
              const submit = () => {
                if (!nodeId || !chosen || !draft.trim()) return;
                void run(() => onAddTask({ nodeId, criterionId: chosen, title: draft }), () => { setAdding(null); setDraft(''); setFormCriterion(null); setTaskNode(null); });
              };
              const keys = (e: React.KeyboardEvent) => { if (e.key === 'Escape') setAdding(null); if (e.key === 'Enter') submit(); };
              return (
                <div data-testid="record-add-task-form" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '7px 0', borderBottom: `1px solid ${c.border}40` }}>
                  {record.criteria.length === 0 ? (
                    <span data-testid="record-add-task-none" style={meta(muted)}>A task serves a criterion. Add a criterion first.</span>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span data-testid="record-add-task-id" style={{ ...identifier(muted), width: '46px', flexShrink: 0 }}>{nodeId && nextTaskId ? nextTaskId(nodeId) : ''}</span>
                        {record.nodes.length > 1 && (
                          <select data-testid="record-add-task-node" aria-label="The node this task lives on" value={nodeId ?? ''} onChange={(e) => setTaskNode(e.target.value)} style={{ ...inputStyle, flex: '0 1 34%', minWidth: 0 }}>
                            {record.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                          </select>
                        )}
                        <select data-testid="record-add-task-criterion" aria-label="The criterion this task serves" value={chosen ?? ''} onChange={(e) => setFormCriterion(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
                          {record.criteria.map((k, i) => <option key={k.id} value={k.id}>{`AC${i + 1} · ${k.text}`}</option>)}
                        </select>
                      </div>
                      <input data-testid="record-add-task-title" autoFocus value={draft} placeholder="What needs doing" onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} style={{ ...inputStyle, marginLeft: '56px' }} />
                    </>
                  )}
                </div>
              );
            })()}
          </section>

          {/* ── Tests ────────────────────────────────────────────────── */}
          <section data-testid="record-tests">
            {recHead('Tests', record.tests.length ? `${testsPassing} of ${record.tests.length} passing` : 'none',
              <button type="button" data-testid="record-add-test" disabled={locked || busy} title={locked ? lockNote : undefined} style={locked ? disabledLink : handLink} onClick={() => { setAdding('test'); setDraft(''); setExpected(''); setFormCriterion(null); }}>Add by hand</button>)}
            {record.tests.length === 0 && adding !== 'test' && recEmpty('Nothing proves this requirement yet.')}
            {record.tests.map((t) => (
              <div key={t.rowId} data-testid="record-test" data-status={t.status} title={t.expected ?? undefined} style={recRow}>
                <span data-testid="record-test-status" aria-label={t.status} style={tick(testTone(t.status))}>{testGlyph(t.status)}</span>
                <span style={rt}>{t.name}{t.source === 'manual' && yours('record-test-yours')}</span>
                <span style={rm}>
                  {t.type}{t.type && t.criterion ? ' · ' : ''}
                  {t.criterion && <span data-testid="record-test-criterion" title="The criterion this test proves">proves {t.criterion}</span>}
                </span>
                <span style={{ ...rid, color: testTone(t.status) }}>{t.testId}</span>
              </div>
            ))}
            {adding === 'test' && (() => {
              // A test proves one criterion: the ones without a test, and not
              // manual (those are proven by a person, never a test case).
              const open = record.criteria.filter((k) => !k.testRef && k.verification !== 'manual');
              const chosen = formCriterion ?? open[0]?.id ?? null;
              const submit = () => {
                if (!chosen) return;
                void run(() => onAddTest({ criterionId: chosen, name: draft, expected }), () => { setAdding(null); setDraft(''); setExpected(''); setFormCriterion(null); });
              };
              const keys = (e: React.KeyboardEvent) => { if (e.key === 'Escape') setAdding(null); if (e.key === 'Enter') submit(); };
              return (
                <div data-testid="record-add-test-form" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '7px 0', borderBottom: `1px solid ${c.border}40` }}>
                  {open.length === 0 ? (
                    <span data-testid="record-add-test-none" style={meta(muted)}>Every criterion has its test. Add a criterion first.</span>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ ...identifier(muted), width: '46px', flexShrink: 0 }}>{nextTestId}</span>
                        <select data-testid="record-add-test-criterion" aria-label="The criterion this test proves" value={chosen ?? ''} onChange={(e) => setFormCriterion(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
                          {open.map((k) => <option key={k.id} value={k.id}>{`AC${record.criteria.indexOf(k) + 1} · ${k.text}`}</option>)}
                        </select>
                      </div>
                      <input data-testid="record-add-test-name" autoFocus value={draft} placeholder="Name (the criterion's words if blank)" onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} style={{ ...inputStyle, marginLeft: '56px' }} />
                      <input data-testid="record-add-test-expected" value={expected} placeholder="Expected result" onChange={(e) => setExpected(e.target.value)} onKeyDown={keys} style={{ ...inputStyle, marginLeft: '56px' }} />
                    </>
                  )}
                </div>
              );
            })()}
          </section>

          {/* ── Code ─────────────────────────────────────────────────── */}
          <section data-testid="record-code">
            {recHead('Code', record.files.length ? `${record.files.length} file${record.files.length === 1 ? '' : 's'}` : 'none')}
            {record.files.length === 0 && recEmpty('Nothing in the repository carries this yet.')}
            {record.files.map((f) => (
              <div key={f.path} data-testid="record-file" style={recRow}>
                <span style={tick('#c07ae0')}>{'●'}</span>
                <span style={{ ...rt, ...identifier(c.text), fontWeight: 600 }} title={f.path}>{f.path}</span>
                <span style={rm}>{[fileLanguage?.(f.path), f.touchedBy.join(', ')].filter(Boolean).join(' · ')}</span>
                {f.also.map((ref) => (
                  <span key={ref} data-testid="record-file-also" style={{ ...meta(tones.warn), fontWeight: 650, border: `1px solid ${tones.warn}88`, borderRadius: '4px', padding: '0 6px', flexShrink: 0 }}>also {ref}</span>
                ))}
                <span style={{ ...rid, color: '#c07ae0' }}>{evidenceCommit ?? ''}</span>
              </div>
            ))}
          </section>

          {originsLineOf(record) && <span data-testid="record-origin" style={{ ...meta(muted), paddingTop: '10px' }}>{originsLineOf(record)}</span>}
          {/* AL.13: one serves line per outcome behind it; the same sentence
              served twice reads once. */}
          {record.origins
            .filter((o, i, all) => all.findIndex((x) => x.serves === o.serves) === i)
            .map((o, i) => <span key={o.outcomeId} data-testid={i === 0 ? 'record-serves' : 'record-serves-also'} style={meta(muted)}>{o.serves}.</span>)}
          {onAttach && attachableHere.length > 0 && (
            <div data-testid="record-attach" style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '10px' }}>
              <span style={meta(muted)}>{record.origins.length > 0 ? 'Serves another outcome too?' : 'No outcome behind this yet.'}</span>
              <select
                data-testid="record-attach-select"
                value=""
                disabled={busy || locked}
                title={locked ? lockNote : undefined}
                onChange={(e) => { const id = e.target.value; if (id) void run(() => onAttach(id)); }}
                style={{ ...inputStyle, flex: '0 1 auto', maxWidth: '360px' }}
              >
                <option value="" disabled>{record.origins.length > 0 ? 'Which other outcome does it serve?' : 'Which outcome does it serve?'}</option>
                {attachableHere.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
        </>
      )}
      {note && <div data-testid="work-rail-note" role="status" style={{ ...body(tones.warn), borderLeft: `2px solid ${tones.warn}`, paddingLeft: '8px', marginTop: '10px' }}>{note}</div>}
    </div>
  );
}

export const RequirementRecord = memo(RequirementRecordComponent);
