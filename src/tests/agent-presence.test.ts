import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  holdIsStale,
  sinceLabel,
  assembleHolds,
  holdsOnNode,
  PRESENCE_STALE_AFTER_MS,
  type LeaseRow,
} from '../ui/components/ideation/useAgentPresence.js';
import { statusTones } from '../ui/components/ideation/status-tones.js';

// V3 collision visibility (owner directive 2026-09-14): when an agent is on
// a workflow, requirement, outcome, task or artifact, BOTH sides must see
// it — the app through the AGENTS AT WORK strip and the per-card markers,
// the agents through get_work_queue's activeHolds (pinned in
// mcp-checkouts_test.ts). One table underneath: agent_checkouts. These
// pins cover the client half: staleness derivation mirrors the server's
// 30-minute threshold, hold assembly resolves the XOR ref with labels and
// sorts stale holds last, and the strip/inspector wiring is the one the
// design draws (AGENT panel on the selected outcome).

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

const lease = (over: Partial<LeaseRow>): LeaseRow => ({
  id: 'l1', level: 'task', holder_label: 'claude · bench',
  task_item_id: null, artifact_id: null, requirement_id: null, candidate_id: null,
  proposal_id: null, meta: null, since: '2026-09-14T10:00:00Z', heartbeat_at: '2026-09-14T10:00:00Z',
  ...over,
});

describe('staleness + age derive, never store', () => {
  const now = new Date('2026-09-14T12:00:00Z').getTime();
  it('mirrors the server threshold: 30 silent minutes → stale', () => {
    expect(holdIsStale(new Date(now - PRESENCE_STALE_AFTER_MS - 1000).toISOString(), now)).toBe(true);
    expect(holdIsStale(new Date(now - 5 * 60000).toISOString(), now)).toBe(false);
    expect(holdIsStale(null, now)).toBe(false);
  });
  it('sinceLabel: now / minutes / hours / days; junk reads empty', () => {
    expect(sinceLabel(new Date(now - 30000).toISOString(), now)).toBe('now');
    expect(sinceLabel(new Date(now - 4 * 60000).toISOString(), now)).toBe('4 min');
    expect(sinceLabel(new Date(now - 3 * 3600000).toISOString(), now)).toBe('3 h');
    expect(sinceLabel(new Date(now - 49 * 3600000).toISOString(), now)).toBe('2 d');
    expect(sinceLabel('garbage', now)).toBe('');
  });
});

describe('assembleHolds: XOR ref resolution, advisory flag, stale sorts last', () => {
  const now = new Date('2026-09-14T12:00:00Z').getTime();
  it('resolves the one set endpoint with its label, falls back to the id', () => {
    const labels = new Map([['t1', 'T1 · Wire the API'], ['c1', 'Ingest survives a 10× burst']]);
    const holds = assembleHolds([
      lease({ id: 'a', task_item_id: 't1', heartbeat_at: new Date(now).toISOString() }),
      lease({ id: 'b', level: 'outcome', candidate_id: 'c1', proposal_id: 'p1', meta: { proposal: 'Map to step 4' }, heartbeat_at: new Date(now).toISOString() }),
      lease({ id: 'c', level: 'code', artifact_id: 'unknown-art', heartbeat_at: new Date(now).toISOString() }),
    ], labels, now);
    expect(holds.find((h) => h.checkoutId === 'a')!.refLabel).toBe('T1 · Wire the API');
    expect(holds.find((h) => h.checkoutId === 'a')!.advisory).toBe(false);
    const outcome = holds.find((h) => h.checkoutId === 'b')!;
    expect(outcome.advisory).toBe(true);
    expect(outcome.refLabel).toBe('Ingest survives a 10× burst');
    expect(outcome.proposalId).toBe('p1');
    expect(outcome.meta).toEqual({ proposal: 'Map to step 4' });
    expect(holds.find((h) => h.checkoutId === 'c')!.refLabel).toBe('unknown-art');
  });
  it('v3u: a criterion hold is exclusive presentation — level kept, requirement label plus WHICH criterion', () => {
    const labels = new Map([['r1', 'REQ-001 · Ingest survives']]);
    const holds = assembleHolds([
      lease({ id: 'k', level: 'criterion', requirement_id: 'r1', criterion_id: 'ab12cd34', heartbeat_at: new Date(now).toISOString() }),
    ], labels, now);
    expect(holds[0].level).toBe('criterion');
    expect(holds[0].advisory).toBe(false);
    expect(holds[0].refLabel).toBe('REQ-001 · Ingest survives · criterion ab12cd34');
    // and the roster names the lane
    const roster = src('ui/components/panels/AgentRoster.tsx');
    expect(roster).toContain("criterion: 'criterion · verifying'");
  });
  it('stale holds sort after fresh ones — the claimable tail', () => {
    const holds = assembleHolds([
      lease({ id: 'stale', task_item_id: 't1', heartbeat_at: new Date(now - 60 * 60000).toISOString() }),
      lease({ id: 'fresh', task_item_id: 't2', heartbeat_at: new Date(now).toISOString() }),
    ], new Map(), now);
    expect(holds.map((h) => h.checkoutId)).toEqual(['fresh', 'stale']);
    expect(holds[1].stale).toBe(true);
  });
});

describe('theme discipline (owner refinement: dark-mode text held its dark inks)', () => {
  it('status tones swap ink values per mode — the dark set never renders as text on white', () => {
    expect(statusTones('dark')).toEqual({ ok: '#4ade80', warn: '#fbbf24', bad: '#f87171' });
    expect(statusTones('light')).toEqual({ ok: '#1f7d52', warn: '#8a5a12', bad: '#a93b43' });
  });
  it('placeholders and selects are themed via the scoped style — the UA default ignored dark mode', () => {
    const space = src('ui/components/work/WorkSurface.tsx');
    expect(space).toContain('.ns-work input::placeholder');
    expect(space).toContain('color-scheme: ${theme.mode}');
    expect(space).toContain('@keyframes nsPulse');
  });
});

describe('wiring: both sides see the same board', () => {
  it('WorkSurface mounts ONE presence read for every tab (V3 4.1)', () => {
    const space = src('ui/components/work/WorkSurface.tsx');
    expect(space).toContain('useAgentPresence(projectId)');
    // R17: presence and approvals live in the header Changes panel now; the
    // canvas floats nothing over the boards.
    expect(space).not.toContain('AgentPresenceStrip');
    expect(space).not.toContain('presence-open-queue');
  });
  it('the strip renders holder · level · target · age, stale as claimable, and the queue count', () => {
    const strip = src('ui/components/panels/AgentRoster.tsx');
    expect(strip).toContain('AGENTS AT WORK');
    expect(strip).toContain("'stale — claimable'");
    expect(strip).toContain('pending proposal');
    expect(strip).toContain("requirement: 'requirement · drafting'");
  });
  it('the rail shows the AGENT panel on a held outcome (the design’s AGENT PROPOSING card; V3 4.1: Work’s rail)', () => {
    const board = src('ui/components/work/ItemRail.tsx');
    expect(board).toContain("holds.filter((h) => h.level === 'outcome' && h.refId === outcome.id && !h.stale)");
    expect(board).toContain('Agent on this outcome');
    // R13: the card reports presence. It used to also announce that a change
    // awaited the user and offer no way to decide it, which made it a second
    // approvals surface; it links into the one panel now.
    expect(board).toContain('data-testid="agent-open-approval"');
    expect(board).toContain('Review in Proposals');
  });
  it('the server half exists: get_work_queue publishes the same board as activeHolds', () => {
    const server = readFileSync(resolve(__dirname, '../../supabase/functions/mcp-server/tools/checkouts.ts'), 'utf-8');
    expect(server).toContain('activeHolds');
    expect(server).toContain('mine: isMine(auth, me, l)');
  });
});

describe('what survived the board (V3 4.1: the rail keeps the criterion add)', () => {
  const rail = src('ui/components/work/ItemRail.tsx');
  it('the draft-criterion add commits from BOTH the Enter key and the + button', () => {
    expect(rail).toContain('data-testid="add-criterion-input"');
    expect(rail).toContain('data-testid="add-criterion-button"');
  });
  it('nothing measures the DOM to draw a line any more', () => {
    for (const f of ['ui/components/work/WorkSurface.tsx', 'ui/components/work/RequirementsList.tsx', 'ui/components/work/RequirementRecord.tsx', 'ui/components/work/ItemRail.tsx']) {
      expect(src(f)).not.toContain('new ResizeObserver');
      expect(src(f)).not.toContain('.getBoundingClientRect()');
    }
  });
});

// ── V3 2.3 (2026-09-19): holds on the node ───────────────────────────────────
describe('V3 2.3: holds on the node', () => {
  const lease = (over: Partial<LeaseRow>): LeaseRow => ({
    id: 'l', level: 'task', holder_label: 'hermes', task_item_id: null, artifact_id: null, requirement_id: null, candidate_id: null,
    proposal_id: null, meta: null, since: '2026-09-19T10:00:00Z', heartbeat_at: new Date().toISOString(), ...over,
  });
  it('assembleHolds derives nodeId from the task or artifact row; holdsOnNode filters by it', () => {
    const holds = assembleHolds(
      [lease({ id: 'l1', task_item_id: 't1' }), lease({ id: 'l2', level: 'code', artifact_id: 'a1' }), lease({ id: 'l3', level: 'requirement', requirement_id: 'r1' })],
      new Map(), Date.now(), new Map(), new Map(), new Map([['t1', 'n1'], ['a1', 'n2']]),
    );
    const by = (id: string) => holds.find((h) => h.checkoutId === id);
    expect(by('l1')?.nodeId).toBe('n1');
    expect(by('l2')?.nodeId).toBe('n2');
    expect(by('l3')?.nodeId).toBeNull();
    expect(holdsOnNode(holds, 'n1').map((h) => h.checkoutId)).toEqual(['l1']);
    expect(holdsOnNode(holds, 'n9')).toEqual([]);
  });
  it('the hook reads node_id with the task and artifact labels (no extra query)', () => {
    const src = readFileSync(resolve(__dirname, '../ui/components/ideation/useAgentPresence.ts'), 'utf-8');
    expect(src).toContain("from('task_items').select('id, title, display_id, node_id')");
    expect(src).toContain("from('artifacts').select('id, path, node_id')");
    expect(src).toContain('assembleHolds(rows, labels, Date.now(), keyNames, horizons, nodeOf)');
  });
});
