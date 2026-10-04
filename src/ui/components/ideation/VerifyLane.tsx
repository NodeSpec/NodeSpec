// V3 9.11 (R4 + R6's app half): the VERIFY LANE, the requirement detail
// surface. Trace opens it in the rail when a REQ card is selected. Criteria
// arrive ordered unbound → red → stale → green (verify-lane.ts), each with
// its binding state in words, a copyable EXACT criterion_text, an editor
// for its text and its verification lane, and the next step. The lock and
// the classification mark live here too. Renders and asks; the grid owns
// the one guarded write (a locked row refuses in the database's words).
import { useEffect, useMemo, useState } from 'react';
import { Lock, Unlock, Copy, Pencil, Trash2, Plus, Check, Archive, ArchiveRestore } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { TRACE_STATE_COLOR } from './trace-state.js';
import { MarkLine } from './MarkLine.js';
import { statusTones } from './status-tones.js';
import { stateWord, eyebrow, identifier, meta, sentenceCase, title as title_ } from './typography.js';
import { lockedRefusal } from './useCandidateActions.js';
import {
  verifyRows, verifyCounts, verifyCountsLabel, reword, setLane, addCriterion, removeCriterion,
  VERIFY_BUCKET_LABEL, VERIFY_BUCKET_MEANING, VERIFY_LOCK_NOTE,
  type VerifySource, type VerifyRow, type StoredCriterion,
} from './verify-lane.js';


/** One write at a time: the criteria list, the lock, the mark, the
 *  description, the explicit archive, or the delete (9.10: the sidebar's
 *  writes moved here). */
export type VerifyWrite =
  | { criteria: StoredCriterion[] }
  | { locked: boolean }
  | { mark: string | null }
  | { description: string }
  | { archived: boolean }
  | { delete: true };

export interface VerifyLaneProps {
  reqRef: string;
  title: string;
  source: VerifySource;
  /** 7.3: a Government account may set marks. */
  canClassify: boolean;
  /** null on success; else the refusal in the server's own words. */
  onWrite: (patch: VerifyWrite) => Promise<string | null>;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* clipboard unavailable */ }
  return false;
}

export function VerifyLane({ reqRef, title, source, canClassify, onWrite }: VerifyLaneProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const st = TRACE_STATE_COLOR[theme.mode];
  const tones = statusTones(theme.mode);
  const rows = useMemo(() => verifyRows(source.criteria, source.tests), [source.criteria, source.tests]);
  const counts = useMemo(() => verifyCounts(rows), [rows]);
  const locked = source.locked;
  const lockTitle = lockedRefusal(reqRef);

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [describing, setDescribing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setEditing(null); setNote(null); setError(null); setDescribing(null); setConfirmDelete(false); }, [reqRef]);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  const write = async (patch: VerifyWrite, afterNote: string | null = null) => {
    setBusy(true);
    setError(null);
    const refusal = await onWrite(patch);
    setBusy(false);
    if (refusal) { setError(refusal); return false; }
    setNote(afterNote);
    return true;
  };

  const saveEdit = async () => {
    if (!editing) return;
    const r = reword(source.criteria, editing.id, editing.text, source.tests);
    if (!r.changed) {
      if (r.reason === 'empty') { setError('A criterion needs text.'); return; }
      setEditing(null);
      return;
    }
    if (await write({ criteria: r.criteria }, r.note)) setEditing(null);
  };

  const toggleLane = async (row: VerifyRow) => {
    const next = setLane(source.criteria, row.id, row.lane === 'manual' ? 'automated' : 'manual');
    await write({ criteria: next.criteria }, next.note);
  };

  const remove = async (row: VerifyRow) => {
    await write({ criteria: removeCriterion(source.criteria, row.id) }, null);
  };

  const add = async () => {
    const next = addCriterion(source.criteria, adding);
    if (!next) { setError('A criterion needs text.'); return; }
    if (await write({ criteria: next }, null)) setAdding('');
  };

  const saveDescription = async () => {
    if (describing === null) return;
    const next = describing.trim();
    if (next === (source.description ?? '').trim()) { setDescribing(null); return; }
    if (await write({ description: next }, null)) setDescribing(null);
  };

  const remove_requirement = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setConfirmDelete(false);
    await write({ delete: true }, null);
  };

  const iconBtn = (disabled: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '5px',
    border: `1px solid ${c.border}66`, backgroundColor: 'transparent', color: disabled ? c.textMuted : c.textSecondary,
    cursor: disabled ? 'not-allowed' : 'pointer', padding: 0, flexShrink: 0,
  });
  const disabledTitle = locked ? lockTitle : undefined;

  return (
    <div data-testid="verify-lane" data-locked={locked ? 'true' : 'false'} style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={eyebrow(c.primary)}>Verify lane</span>
        <div style={title_(c.text)}>{reqRef} · {title}</div>
        <div data-testid="verify-counts" style={meta(c.textSecondary)}>
          {rows.length === 0 ? 'no criteria yet' : verifyCountsLabel(counts)}
        </div>
      </div>

      {/* the lock: the one door every write goes through (v3x) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <button
          data-testid="verify-lock"
          aria-pressed={locked}
          disabled={busy}
          onClick={() => void write({ locked: !locked }, null)}
          title={locked ? 'Unlock: every write refuses it until you do.' : 'Lock: every write refuses it until you unlock it here.'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px', alignSelf: 'flex-start', padding: '6px 10px', borderRadius: '7px',
            border: `1px solid ${locked ? tones.warn : c.border}`, backgroundColor: locked ? `${tones.warn}22` : 'transparent',
            color: locked ? tones.warn : c.text, fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {locked ? <Lock size={13} /> : <Unlock size={13} />}
          {locked ? 'Locked' : 'Unlocked'}
        </button>
        {locked && (
          <div data-testid="verify-locked" style={{ fontSize: '11px', lineHeight: 1.5, color: tones.warn }}>{VERIFY_LOCK_NOTE}</div>
        )}
        <MarkLine mark={source.mark} canClassify={canClassify} disabled={locked} disabledTitle={disabledTitle} onCommit={(mark) => void write({ mark }, null)} />
      </div>

      {/* 9.10: the description, edited here now that the sidebar is read-only */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ ...eyebrow(c.textSecondary) }}>Description</span>
        {describing === null ? (
          <button
            data-testid="verify-description"
            disabled={locked}
            title={disabledTitle ?? 'Edit the description'}
            onClick={() => setDescribing(source.description ?? '')}
            style={{ textAlign: 'left', fontSize: '12px', lineHeight: 1.45, color: source.description ? c.text : c.textMuted, background: 'transparent', border: `1px dashed ${c.border}66`, borderRadius: '6px', padding: '6px 8px', cursor: locked ? 'not-allowed' : 'text', fontFamily: 'inherit', overflowWrap: 'anywhere' }}
          >
            {source.description || (locked ? 'No description.' : 'Add a description')}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <textarea
              data-testid="verify-description-input"
              autoFocus
              value={describing}
              onChange={(e) => setDescribing(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setDescribing(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveDescription(); }}
              rows={3}
              style={{ fontFamily: 'inherit', fontSize: '12px', lineHeight: 1.45, padding: '6px 8px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: c.background, color: c.text, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button data-testid="verify-description-save" disabled={busy} onClick={() => void saveDescription()} style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${c.primary}`, backgroundColor: `${c.primary}1f`, color: c.primary, cursor: 'pointer' }}>Save</button>
              <button data-testid="verify-description-cancel" onClick={() => setDescribing(null)} style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.textSecondary, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {error && <div data-testid="verify-error" style={{ fontSize: '11.5px', lineHeight: 1.5, color: tones.bad }}>{error}</div>}
      {note && !error && <div data-testid="verify-note" style={{ fontSize: '11.5px', lineHeight: 1.5, color: c.textSecondary }}>{note}</div>}

      {/* the criteria, unbound → red → stale → green */}
      <div data-testid="verify-rows" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map((row) => {
          const isEditing = editing?.id === row.id;
          return (
            <div
              key={row.id}
              data-testid="verify-row"
              data-bucket={row.bucket}
              data-criterion-id={row.id}
              style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '8px 10px', borderRadius: '9px', border: `1px solid ${st[row.state]}55`, backgroundColor: c.surface, minWidth: 0 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: st[row.state], flexShrink: 0 }} />
                <span style={identifier(c.textSecondary)}>AC{row.index + 1}</span>
                <span data-testid="verify-bucket" title={VERIFY_BUCKET_MEANING[row.bucket]} style={stateWord(st[row.state])}>{VERIFY_BUCKET_LABEL[row.bucket]}</span>
                <span data-testid="verify-lane-kind" style={{ ...meta(c.textSecondary), border: `1px solid ${c.border}`, borderRadius: '3px', padding: '0 4px' }}>{sentenceCase(row.lane)}</span>
                <span style={{ flex: 1 }} />
                <button data-testid="verify-copy" title="Copy the exact criterion_text report_test_results matches" onClick={() => void copyText(row.exact).then((ok) => setCopied(ok ? row.id : null))} style={iconBtn(false)}>
                  {copied === row.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <button data-testid="verify-edit" disabled={locked || busy} title={disabledTitle ?? 'Edit the text (the binding holds by id)'} onClick={() => { setEditing({ id: row.id, text: row.text }); setError(null); }} style={iconBtn(locked)}>
                  <Pencil size={12} />
                </button>
                <button data-testid="verify-remove" disabled={locked || busy} title={disabledTitle ?? 'Remove this criterion'} onClick={() => void remove(row)} style={iconBtn(locked)}>
                  <Trash2 size={12} />
                </button>
              </div>
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <textarea
                    data-testid="verify-edit-input"
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ id: row.id, text: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveEdit(); }}
                    rows={3}
                    style={{ fontFamily: 'inherit', fontSize: '12px', lineHeight: 1.45, padding: '6px 8px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: c.background, color: c.text, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button data-testid="verify-edit-save" disabled={busy} onClick={() => void saveEdit()} style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${c.primary}`, backgroundColor: `${c.primary}1f`, color: c.primary, cursor: 'pointer' }}>Save</button>
                    <button data-testid="verify-edit-cancel" onClick={() => setEditing(null)} style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.textSecondary, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div data-testid="verify-text" title={row.exact} style={{ fontSize: '12px', lineHeight: 1.45, color: c.text, overflowWrap: 'anywhere' }}>{row.text}</div>
              )}
              {copied === row.id && <div data-testid="verify-copied" style={{ ...meta(st.ok) }}>Copied the exact text</div>}
              <div data-testid="verify-binding" style={{ ...identifier(st[row.state]), fontWeight: 600, lineHeight: 1.45 }}>{row.binding}</div>
              <div data-testid="verify-next" style={{ fontSize: '11px', lineHeight: 1.5, color: c.textSecondary }}>{row.next}</div>
              <button
                data-testid="verify-lane-toggle"
                disabled={locked || busy}
                title={disabledTitle ?? (row.lane === 'manual' ? 'Switch to the automated lane: a binding test proves it' : 'Switch to the manual lane: the task-doc tick and your approval prove it')}
                onClick={() => void toggleLane(row)}
                style={{ alignSelf: 'flex-start', ...meta(locked ? c.textMuted : c.textSecondary), fontWeight: 600, padding: '3px 8px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: 'transparent', cursor: locked ? 'not-allowed' : 'pointer' }}
              >
                {row.lane === 'manual' ? 'Make automated' : 'Make manual'}
              </button>
            </div>
          );
        })}
      </div>

      {/* add: the sidebar's create moves here (9.10) */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          data-testid="verify-add-input"
          value={adding}
          disabled={locked || busy}
          title={disabledTitle}
          placeholder={locked ? 'Locked' : 'Add a criterion, in the words a test can prove'}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: c.background, color: c.text }}
        />
        <button data-testid="verify-add" disabled={locked || busy || !adding.trim()} title={disabledTitle ?? 'Add'} onClick={() => void add()} style={iconBtn(locked || !adding.trim())}>
          <Plus size={13} />
        </button>
      </div>
      <div style={{ fontSize: '11px', lineHeight: 1.5, color: c.textSecondary }}>
        Criteria flip only from evidence: a reported test result, or an approved manual tick. Agents bind by the exact text; copy it from here.
      </div>

      {/* 9.10: the archive and the delete live on the Trace row now; Trace keeps the record */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingTop: '8px', borderTop: `1px solid ${c.border}66` }}>
        <button
          data-testid="verify-archive"
          disabled={locked || busy}
          title={disabledTitle ?? (source.archivedAt ? 'Restore from the archive' : 'Archive: it leaves every working set; Trace keeps the record')}
          onClick={() => void write({ archived: !source.archivedAt }, null)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: locked ? c.textMuted : c.textSecondary, cursor: locked ? 'not-allowed' : 'pointer' }}
        >
          {source.archivedAt ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          {source.archivedAt ? 'Restore' : 'Archive'}
        </button>
        <span style={{ flex: 1 }} />
        <button
          data-testid="verify-delete"
          disabled={locked || busy}
          title={disabledTitle ?? (confirmDelete ? 'Click again to delete this requirement' : 'Delete this requirement; its mappings, relations and derivations go with it')}
          onClick={() => void remove_requirement()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${confirmDelete ? tones.bad : c.border}`, backgroundColor: confirmDelete ? `${tones.bad}22` : 'transparent', color: locked ? c.textMuted : confirmDelete ? tones.bad : c.textSecondary, cursor: locked ? 'not-allowed' : 'pointer' }}
        >
          <Trash2 size={12} />
          {confirmDelete ? 'Confirm delete' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
