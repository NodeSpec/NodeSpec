// The design's One decision board: a promotion read on its own page before
// it is decided. What it says, top to bottom: the question ("Make this a
// requirement?"), who asked and when, and the rule (never automatic, at
// any autonomy level); the outcome with the criteria the requirement would
// take and where it lands (its ref, its section, its steps), said as the
// server will do it (unconfirmed until confirmed from its rail); the
// agent's reason in its own words; what it touches (the nodes, each a door
// into Architecture); the acts. Make it a requirement decides through the
// same resolve lane as the card. Edit first opens the outcome under Work.
// Not yet leaves it waiting.
import { memo } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { statusTones } from './status-tones.js';
import { eyebrow, title, body, meta, identifier } from './typography.js';
import { livesOn } from '../work/steps-model.js';
import { useDecision, becomesLine, askedLine } from './useDecision.js';
import type { QueueItem } from './useApprovalsQueue.js';

interface DecisionPageProps {
  item: QueueItem;
  projectId?: string | null;
  graph?: Graph | null;
  busy?: boolean;
  error?: string | null;
  onDecide: (action: 'accept' | 'reject') => void;
  onBack: () => void;
  /** Edit first: the outcome under Work, criteria and all. */
  onEditFirst?: (candidateId: string) => void;
  /** AC: the plan has Workflows; below it a promotion names no step. */
  workflows?: boolean;
  onOpenArchitecture?: (nodeId: string) => void;
}

function DecisionPageComponent({ item, projectId, graph, busy, error, onDecide, onBack, onEditFirst, onOpenArchitecture, workflows = false }: DecisionPageProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  const { record, loading, error: readError } = useDecision(projectId, item.proposalId, workflows);
  const home = record ? livesOn(graph, record.nodeId) : null;
  const act = (primary: boolean): React.CSSProperties => ({
    border: `1px solid ${primary ? c.primary : c.border}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 650,
    background: primary ? c.primary : 'transparent', color: primary ? '#fff' : c.text, cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1, font: 'inherit',
  });
  const quiet: React.CSSProperties = { border: 'none', background: 'transparent', color: c.textSecondary, fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '4px 6px', font: 'inherit' };

  return (
    <div data-testid="decision-page" style={{ maxWidth: '760px', padding: '18px 22px 28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <button type="button" data-testid="decision-back" onClick={onBack} style={{ ...quiet, alignSelf: 'flex-start', padding: 0 }}>← Proposals</button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ ...title(c.text), fontSize: '20px', margin: 0 }}>Make this a requirement?</h1>
        <span data-testid="decision-asked" style={body(c.textSecondary)}>{askedLine(record?.agent ?? item.origin.label, record?.askedAt ?? item.createdAt)}</span>
      </div>

      {(error || readError) && <div data-testid="decision-error" style={{ ...body(tones.bad), borderLeft: `2px solid ${tones.bad}`, paddingLeft: '8px' }}>{error ?? readError}</div>}
      {loading && !record && <span style={meta(c.textSecondary)}>Reading the outcome.</span>}

      {record && (
        <>
          <section data-testid="decision-outcome" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 18px', borderRadius: '12px', border: `1px solid ${c.border}`, backgroundColor: c.surface }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={eyebrow(c.textSecondary)}>Outcome</span>
              <span style={{ ...identifier(c.textSecondary), fontSize: '11px' }}>→</span>
              <span data-testid="decision-becomes-ref" style={eyebrow(c.primary)}>Requirement {record.nextRef ?? ''}, unconfirmed</span>
            </div>
            <span data-testid="decision-name" style={{ ...title(c.text), fontSize: '16px' }}>{record.name}</span>
            {record.description && <p data-testid="decision-description" style={{ ...body(c.textSecondary), margin: 0 }}>{record.description}</p>}
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {record.criteria.map((k) => (
                <li key={k.id} data-testid="decision-criterion" style={{ display: 'flex', alignItems: 'baseline', gap: '8px', ...body(c.text) }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: `1.5px solid ${c.textSecondary}`, flexShrink: 0, position: 'relative', top: '-1px' }} />
                  <span>{k.text}</span>
                </li>
              ))}
            </ul>
            <span data-testid="decision-becomes" style={meta(c.textSecondary)}>{becomesLine(record)}</span>
          </section>

          {record.reason && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={eyebrow(c.textSecondary)}>{record.agent}'s reason</span>
              <blockquote data-testid="decision-reason" style={{ ...body(c.text), margin: 0, paddingLeft: '12px', borderLeft: `3px solid ${c.primary}66` }}>{record.reason}</blockquote>
            </section>
          )}

          <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={eyebrow(c.textSecondary)}>Touches</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
              {(home?.nodes ?? []).map((n) => (
                <button key={n.id} type="button" data-testid="decision-touch" disabled={!onOpenArchitecture} onClick={() => onOpenArchitecture?.(n.id)} style={{ border: `1px solid ${c.border}`, borderRadius: '7px', padding: '4px 10px', fontSize: '11.5px', fontWeight: 600, background: 'transparent', color: c.text, cursor: onOpenArchitecture ? 'pointer' : 'default', font: 'inherit' }}>{n.label}</button>
              ))}
              {!home && <span data-testid="decision-touch-none" style={meta(c.textSecondary)}>No node yet.</span>}
            </div>
            {home?.detail && <span style={meta(c.textSecondary)}>{home.detail}</span>}
          </section>

          <section style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '6px', borderTop: `1px solid ${c.border}66` }}>
            <button type="button" data-testid="decision-accept" disabled={busy} onClick={() => onDecide('accept')} style={act(true)}>Make it a requirement</button>
            {onEditFirst && <button type="button" data-testid="decision-edit" disabled={busy} onClick={() => onEditFirst(record.candidateId)} style={act(false)}>Edit first</button>}
            <button type="button" data-testid="decision-not-yet" onClick={onBack} style={quiet}>Not yet</button>
            <button type="button" data-testid="decision-reject" disabled={busy} onClick={() => onDecide('reject')} style={{ ...quiet, marginLeft: 'auto' }}>Reject</button>
          </section>
        </>
      )}
    </div>
  );
}

export const DecisionPage = memo(DecisionPageComponent);
