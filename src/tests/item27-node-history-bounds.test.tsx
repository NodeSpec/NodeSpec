// @vitest-environment jsdom
//
// Item 27 (owner 2026-09-27): "we need to ensure node history does not
// become bloated especially since a node can contain n number of artifacts
// that change." The database half (a decision's first three reasons and how
// many there were; proposals and patches that never name the node passed over)
// runs on a real Postgres in scripts/db-lane/091_node_memory_bounds.sql. This
// is the app half, through the real rail and the real memory module (the
// server's, byte for byte): a decision's line says how many reasons it does
// not show, whatever their length, and the rail shows the newest twenty with
// the rest behind one fold that says what it holds.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderCanvas } from './helpers/reactflow-dom.js';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import type { Graph } from '@nodespec/core/types.js';
import type { NodeItems } from '../ui/components/panels/useNodeItems.js';
import type { NodeMemoryRead } from '../ui/components/panels/useNodeMemory.js';
import type { RawDecision } from '../ui/utils/node-memory.js';

const items: NodeItems = { requirements: [], candidates: [], job: null, loading: false, error: null };
vi.mock('../ui/components/panels/useNodeItems.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNodeItems: () => items }));
vi.mock('../ui/hooks/useFeatureGate.js', async () => {
  const { featureAllowed, FEATURE_RULES } = await import('../ui/config/feature-rules.js');
  return {
    useFeatureGate: () => ({
      plan: 'community', subscription: null, loading: false,
      can: (f: Parameters<typeof featureAllowed>[1]) => featureAllowed('community', f),
      check: (f: Parameters<typeof featureAllowed>[1]) => ({ allowed: featureAllowed('community', f), rule: FEATURE_RULES[f] }),
      projectLimitReached: () => false, refresh: vi.fn(async () => {}), refreshUntilActive: vi.fn(),
    }),
  };
});
vi.mock('../ui/components/ideation/useAgentPresence.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAgentPresence: () => ({ holds: [], byRef: new Map(), collisions: [], pendingProposals: 0, loading: false, refresh: vi.fn(async () => {}) }),
}));
const memoryRead = vi.hoisted(() => ({ value: { raw: null, you: null, loading: false, error: null } as NodeMemoryRead }));
vi.mock('../ui/components/panels/useNodeMemory.js', () => ({ useNodeMemory: () => memoryRead.value }));

const { ArchitectureRail, HISTORY_SHOWN } = await import('../ui/components/panels/ArchitectureRail.js');
const { nodeMemory } = await import('../ui/utils/node-memory.js');

const NODE = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 9, minute)).toISOString();
const decision = (i: number, over: Partial<RawDecision> = {}): RawDecision =>
  ({ proposalId: `p${i}`, at: at(i), who: 'claude · lead', explanations: [`Decision ${i}`], explanationCount: 1, intents: [], commit: null, ...over });

/** The task document's fingerprints: the context moved on at minute 3 and again at minute 4. */
const graph = (): Graph => ({
  id: 'g', schemaVersion: 1, version: 1, hash: 'h',
  nodes: { [NODE]: { id: NODE, type: 'backend-service', label: 'Orders API' }, [OTHER]: { id: OTHER, type: 'frontend-app', label: 'Web' } } as never,
  edges: {}, contracts: {},
  artifacts: {
    doc: {
      id: 'doc', nodeId: NODE, kind: 'task', path: '.nodespec/tasks/orders.task.md', content: '# Orders API\n',
      metadata: { fingerprintHistory: [{ fingerprint: 'A', since: at(0) }, { fingerprint: 'B', since: at(3) }, { fingerprint: 'C', since: at(4) }] },
    },
  } as never,
});

beforeEach(() => {
  // Twenty-five decisions, minutes 1 to 25. Those at minutes 1 to 3 were taken in by the
  // fingerprint of minute 3 and the context moved on at minute 4: three flagged, all hidden.
  memoryRead.value = { raw: { decisions: Array.from({ length: 25 }, (_, k) => decision(k + 1)), changes: [], handoffs: [], proven: [] }, you: null, loading: false, error: null };
});

describe('item 27: a decision says how many reasons it does not show', () => {
  it('three shown of three hundred: the line ends "and 297 more"', () => {
    const m = nodeMemory({ decisions: [decision(1, { explanations: ['Bind src/f1.ts', 'Bind src/f2.ts', 'Bind src/f3.ts'], explanationCount: 300 })], changes: [], handoffs: [], proven: [] }, null);
    expect(m.entries[0].text).toBe('Bind src/f1.ts; Bind src/f2.ts; Bind src/f3.ts; and 297 more');
  });

  it('long reasons are clipped, and the count survives the clip', () => {
    const long = 'x'.repeat(200);
    const m = nodeMemory({ decisions: [decision(1, { explanations: [long, long, long], explanationCount: 12 })], changes: [], handoffs: [], proven: [] }, null);
    expect(m.entries[0].text.endsWith('...; and 9 more')).toBe(true);
    expect(m.entries[0].text.length).toBeLessThanOrEqual(280);
  });

  it('all shown, or a server that sends no count: no "more"', () => {
    const all = nodeMemory({ decisions: [decision(1, { explanations: ['A', 'B'], explanationCount: 2 })], changes: [], handoffs: [], proven: [] }, null);
    expect(all.entries[0].text).toBe('A; B');
    const older = nodeMemory({ decisions: [decision(1, { explanations: ['A', 'B'], explanationCount: undefined })], changes: [], handoffs: [], proven: [] }, null);
    expect(older.entries[0].text).toBe('A; B');
  });

  it('a decision with no reason falls back to its intents, then "Accepted."', () => {
    const intents = nodeMemory({ decisions: [decision(1, { explanations: [], explanationCount: 0, intents: [{ kind: 'explode_node', summary: 'explode "Orders API"' }] })], changes: [], handoffs: [], proven: [] }, null);
    expect(intents.entries[0].text).toBe('explode "Orders API"');
    const bare = nodeMemory({ decisions: [decision(1, { explanations: [], explanationCount: 0 })], changes: [], handoffs: [], proven: [] }, null);
    expect(bare.entries[0].text).toBe('Accepted.');
  });
});

describe('item 27: the rail shows the newest twenty, the rest behind one fold', () => {
  const rows = (r: ReturnType<typeof renderCanvas>) => r.queryAllByTestId('rail-history').map((e) => e.querySelector('span:nth-child(2)')!.textContent);

  it('twenty-five lines: the twenty newest, then "5 more, 3 to review"; opened, all of them, then "Show fewer"', () => {
    expect(HISTORY_SHOWN).toBe(20);
    const r = renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={graph()} />);
    expect(rows(r)).toHaveLength(20);
    expect(rows(r)[0]).toBe('Decision 25');
    expect(rows(r)[19]).toBe('Decision 6');
    expect(r.getByTestId('rail-history-more').textContent).toBe('5 more, 3 to review');
    expect(r.getByTestId('architecture-rail').textContent).toContain('25, 3 to review');
    expect(r.queryByTestId('rail-history-fewer')).toBeNull();
    fireEvent.click(r.getByTestId('rail-history-more'));
    expect(rows(r)).toHaveLength(25);
    expect(rows(r)[24]).toBe('Decision 1');
    expect(r.queryByTestId('rail-history-more')).toBeNull();
    fireEvent.click(r.getByTestId('rail-history-fewer'));
    expect(rows(r)).toHaveLength(20);
  });

  it('the fold is per node: opening one node\'s history does not open the next one\'s', () => {
    const r = renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={graph()} />);
    fireEvent.click(r.getByTestId('rail-history-more'));
    expect(rows(r)).toHaveLength(25);
    r.rerender(<ThemeProvider defaultMode="light" readOnly><ArchitectureRail projectId="p1" branchId="b1" nodeId={OTHER} graph={graph()} /></ThemeProvider>);
    expect(rows(r)).toHaveLength(20);
    expect(r.getByTestId('rail-history-more').textContent).toBe('5 more');
  });

  it('twenty lines or fewer: no fold', () => {
    memoryRead.value = { ...memoryRead.value, raw: { decisions: Array.from({ length: 20 }, (_, k) => decision(k + 1)), changes: [], handoffs: [], proven: [] } };
    const r = renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={graph()} />);
    expect(rows(r)).toHaveLength(20);
    expect(r.queryByTestId('rail-history-more')).toBeNull();
  });
});
