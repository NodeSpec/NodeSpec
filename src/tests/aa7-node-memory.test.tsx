// @vitest-environment jsdom
//
// AA.7 (owner 2026-09-23): memory on the node, in the app. The rail's History
// section reads the node's memory (node_memory) through the same module the
// server uses, byte for byte, and flags what the node's context moved on
// from; the Agents panel says, per read, how much of a node's context an
// agent read beside the whole spec.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderCanvas } from './helpers/reactflow-dom.js';
import type { Graph } from '@nodespec/core/types.js';
import type { NodeItems } from '../ui/components/panels/useNodeItems.js';
import type { NodeMemoryRead } from '../ui/components/panels/useNodeMemory.js';
import type { AgentHold, AgentPresence } from '../ui/components/ideation/useAgentPresence.js';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

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
const presenceMock = { holds: [] as AgentHold[], byRef: new Map(), collisions: [], pendingProposals: 0, loading: false, refresh: vi.fn(async () => {}) };
vi.mock('../ui/components/ideation/useAgentPresence.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useAgentPresence: () => presenceMock }));
const memoryRead = vi.hoisted(() => ({ value: { raw: null, you: null, loading: false, error: null } as NodeMemoryRead }));
const memoryCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('../ui/components/panels/useNodeMemory.js', () => ({ useNodeMemory: (...a: unknown[]) => { memoryCalls.push(a); return memoryRead.value; } }));

const { ArchitectureRail, memoryMeta } = await import('../ui/components/panels/ArchitectureRail.js');
const { AgentRoster, contextReadLine, tokensShort } = await import('../ui/components/panels/AgentRoster.js');

const NODE = '00000000-0000-4000-8000-0000000000a1';
const T = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString();
const graph = (): Graph => ({
  id: 'g', schemaVersion: 1, version: 1, hash: 'h',
  nodes: { [NODE]: { id: NODE, type: 'backend-service', label: 'Checkout API' } } as never,
  edges: {}, contracts: {},
  artifacts: {
    doc: {
      id: 'doc', nodeId: NODE, kind: 'task', path: '.nodespec/tasks/checkout.task.md',
      content: '## Implementation Context\n\nStripe calls go through the idempotency middleware.\n## Tests',
      metadata: { fingerprintHistory: [{ fingerprint: 'A', since: T(1) }, { fingerprint: 'B', since: T(3) }, { fingerprint: 'C', since: T(5) }] },
    },
  } as never,
});

beforeEach(() => {
  memoryCalls.length = 0;
  memoryRead.value = {
    you: 'u-me', loading: false, error: null,
    raw: {
      decisions: [{ proposalId: 'p1', at: T(2), who: 'claude · lead', explanations: ['Idempotency keys: retries must not charge twice'], intents: [], commit: 'bbbbbbbcafe00' }],
      changes: [{ patchId: 'g1', at: T(6), actorId: 'u-me', summary: 'Rename to Checkout', type: 'update_node', commit: null }],
      handoffs: [{ checkoutId: 'c1', at: T(4), who: 'agent-a', level: 'task', reason: 'released', note: 'Charging works; refunds are next', proposalId: null, commit: 'ddddddd1234' }],
      proven: [],
    },
  };
});

describe('AA.7 · memory on the node, one module in two places', () => {
  it('the app mirror is byte-identical to the server module from the first export on', () => {
    const pure = (s: string) => s.slice(s.indexOf('export const IMPLEMENTATION_CONTEXT_HEADING'));
    const app = pure(read('src/ui/utils/node-memory.ts'));
    expect(app).toBe(pure(read('supabase/functions/_shared/node-memory.ts')));
    expect(app.length).toBeGreaterThan(4000);
  });
});

describe('AA.7 · the rail\'s History section', () => {
  it('reads the node\'s memory on the branch in view, on every plan', () => {
    renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={graph()} />);
    expect(memoryCalls[0]).toEqual(['p1', 'b1', NODE]);
  });

  it('the learning first, then newest first; each with who, when and commit; a review line where the context moved on', () => {
    const { getByTestId, getAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={graph()} />);
    expect(getByTestId('architecture-rail').textContent).toContain('History4, 2 to review');
    const rows = getAllByTestId('rail-history');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['learning', 'change', 'handoff', 'decision']);
    expect(rows.map((r) => r.querySelector('[data-testid="rail-history-meta"]')!.textContent)).toEqual([
      'Learning', 'Change · you · 6 Sep', 'Hand-off · agent-a · 4 Sep · @ddddddd', 'Decision · claude · lead · 2 Sep · @bbbbbbb',
    ]);
    expect(rows[0].textContent).toContain('Stripe calls go through the idempotency middleware.');
    expect(rows.map((r) => r.getAttribute('data-review'))).toEqual([null, null, 'yes', 'yes']);
    expect(rows[2].querySelector('[data-testid="rail-history-review"]')!.textContent).toBe("The node's context changed after this note was left (2026-09-05).");
    expect(rows[3].querySelector('[data-testid="rail-history-review"]')!.textContent).toBe("The node's context changed again after this was taken in (2026-09-05).");
  });

  it('says plainly when nothing is recorded, and when the history could not be read', () => {
    memoryRead.value = { raw: { decisions: [], changes: [], handoffs: [], proven: [] }, you: null, loading: false, error: null };
    const g = graph();
    (g.artifacts as Record<string, { content: string }>).doc.content = '## Implementation Context\n\n_Not yet authored._ author it\n';
    const empty = renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={g} />);
    expect(empty.getByTestId('rail-history-empty').textContent).toBe('Nothing recorded on this node yet.');
    empty.unmount();
    memoryRead.value = { raw: null, you: null, loading: false, error: 'The node\'s history could not be read.' };
    const failed = renderCanvas(<ArchitectureRail projectId="p1" branchId="b1" nodeId={NODE} graph={g} />);
    expect(failed.getByTestId('architecture-rail').textContent).toContain('The node\'s history could not be read.');
  });

  it('memoryMeta drops what an entry does not have', () => {
    expect(memoryMeta({ kind: 'proven', at: null, who: null, text: 'x' })).toBe('Proven');
  });
});

describe('AA.7 · the per-read line in the Agents panel', () => {
  const hold = (over: Partial<AgentHold>): AgentHold => ({
    checkoutId: 'l1', level: 'node' as never, advisory: false, holder: 'claude · lead', credential: 'key · lead', credentialExpiresAt: null,
    refId: NODE, refLabel: 'Checkout API', nodeId: NODE, since: new Date().toISOString(), stale: false, proposalId: null, meta: null, ...over,
  });

  it('says the node\'s context beside the whole spec, from the newest read', () => {
    expect(tokensShort(3120)).toBe('3.1k');
    expect(tokensShort(41234)).toBe('41k');
    expect(tokensShort(800)).toBe('800');
    const line = contextReadLine([
      hold({ meta: { contextRead: { label: 'Checkout API', tokens: 3120, wholeSpecTokens: 41234, at: T(5) } } }),
      hold({ checkoutId: 'l2', meta: { contextRead: { label: 'Web', tokens: 900, wholeSpecTokens: 41234, at: T(4) } } }),
    ]);
    expect(line).toBe("Checkout API's context: 3.1k tokens; the whole spec: 41k");
    expect(contextReadLine([hold({ meta: { commitSha: 'abc' } })])).toBeNull();
  });

  it('renders under the agent that read it', () => {
    const presence = { ...presenceMock, holds: [hold({ meta: { contextRead: { label: 'Checkout API', tokens: 3120, wholeSpecTokens: 41234, at: T(5) } } })] } as unknown as AgentPresence;
    const { getByTestId } = renderCanvas(<AgentRoster presence={presence} showQueueLink={false} />);
    expect(getByTestId('agent-context-read').textContent).toBe("Checkout API's context: 3.1k tokens; the whole spec: 41k");
  });
});
