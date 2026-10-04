// @vitest-environment jsdom
// V3 AE.6 (owner 2026-09-25): the Expand button on the Architecture rail
// stages an explode request for the person's agent to pick up over MCP.
// The row shows only on a node the depth rule lets an agent explode, one
// press stages it (a second withdraws it), and the request is dropped by
// the app once the parts land. The contract below runs the app's writer
// against the server's own reader and lead; the server's reads on the seed
// are ae6-staged-explode_test.ts; the live door is bench ae6-expand-request.
import { describe, expect, it, vi, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent } from '@testing-library/react';
import { renderCanvas } from './helpers/reactflow-dom.js';
import type { Graph } from '@nodespec/core/types.js';
import { setRoleResolver, type RoleInfo } from '@nodespec/core/container-types.js';
import type { NodeItems } from '../ui/components/panels/useNodeItems.js';
import { canRequestExplode, hasParts, pruneStagedExplodes, readStagedExplodes, stageExplode, stagedExplodeFor, withdrawExplode } from '../ui/utils/explode-staging.js';
// the server's own reader and lead (plain TypeScript, no Deno APIs)
import { readStagedExplodes as serverReadStagedExplodes, stagedExplodeLead } from '../../supabase/functions/_shared/staged-explodes.js';

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
const presence = { holds: [], byRef: new Map(), collisions: [], pendingProposals: 0, loading: false, refresh: vi.fn(async () => {}) };
vi.mock('../ui/components/ideation/useAgentPresence.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useAgentPresence: () => presence }));

const { ArchitectureRail } = await import('../ui/components/panels/ArchitectureRail.js');


const API = '10000000-0000-4000-8000-000000000001';
const WEB = '10000000-0000-4000-8000-000000000002';
const BOX = '10000000-0000-4000-8000-000000000003';
const DB = '10000000-0000-4000-8000-000000000004';
const GROUP = '10000000-0000-4000-8000-000000000005';
const LIB = '10000000-0000-4000-8000-000000000006';

// The catalog as the AA.3 migration seeds it: a backend service lists its
// parts, a frontend app here lists none, a table group is a part, a
// container admits by rule, not by parts.
const ROLES: Record<string, RoleInfo> = {
  'backend-service': { id: 'backend-service', provider: null, canContain: ['part-handler', 'part-repository'] },
  'frontend-app': { id: 'frontend-app', provider: null, canContain: [] },
  'database': { id: 'database', provider: null, canContain: ['part-table-group'] },
  'shared-library': { id: 'shared-library', provider: null, canContain: ['part-module'] },
  'part-handler': { id: 'part-handler', provider: null, canContain: [], isPart: true },
  'part-repository': { id: 'part-repository', provider: null, canContain: [], isPart: true },
  'part-table-group': { id: 'part-table-group', provider: null, canContain: [], isPart: true },
  'part-module': { id: 'part-module', provider: null, canContain: [], isPart: true },
  'kubernetes-cluster': { id: 'kubernetes-cluster', provider: null, isContainer: true, canContain: { natures: ['build'] } },
};
const resolveRole = (id: string) => ROLES[id] ?? null;
setRoleResolver(resolveRole);
afterAll(() => setRoleResolver(null));

const node = (id: string, label: string, type: string, parentId?: string) => ({ id, label, type, ports: [], artifacts: [], metadata: {}, ...(parentId ? { parentId } : {}) });
const graph = (): Graph => ({
  id: 'g', schemaVersion: 8, version: 1, hash: 'h',
  nodes: {
    [API]: node(API, 'API Service', 'backend-service'),
    [WEB]: node(WEB, 'Web', 'frontend-app'),
    [BOX]: node(BOX, 'Cluster', 'kubernetes-cluster'),
    [DB]: node(DB, 'Primary Database', 'database'),
    [GROUP]: node(GROUP, 'orders', 'part-table-group', DB),
    [LIB]: node(LIB, 'Shared types', 'services.shared-library'),
  },
  edges: {}, contracts: {}, artifacts: {},
} as unknown as Graph);

describe('AE.6 helpers: the staged list, the press, the prune, and who may be expanded', () => {
  it('reads the list tolerantly and stages one request per node', () => {
    expect(readStagedExplodes(undefined)).toEqual([]);
    expect(readStagedExplodes({ stagedExplodes: [null, { nodeId: 'x' }, { nodeId: API, label: ' API Service ', stagedAt: 't1', note: ' auth apart ' }, { nodeId: API }] }))
      .toEqual([{ nodeId: API, label: 'API Service', stagedAt: 't1', note: 'auth apart' }]);
    const now = new Date('2026-09-25T10:00:00.000Z');
    const one = stageExplode([], { id: API, label: 'API Service' }, now);
    expect(one).toEqual([{ nodeId: API, label: 'API Service', stagedAt: '2026-09-25T10:00:00.000Z' }]);
    const again = stageExplode(one, { id: API, label: 'API Service (renamed)' }, new Date('2026-09-25T11:00:00.000Z'));
    expect(again).toEqual([{ nodeId: API, label: 'API Service (renamed)', stagedAt: '2026-09-25T11:00:00.000Z' }]);
    expect(stagedExplodeFor(again, API)?.label).toBe('API Service (renamed)');
    expect(withdrawExplode(again, API)).toEqual([]);
  });

  it('a request is dropped once its node has parts; an absent node only when asked', () => {
    const g = graph();
    expect(hasParts(g, DB)).toBe(true);
    expect(hasParts(g, API)).toBe(false);
    const list = [{ nodeId: API, label: 'API Service', stagedAt: 't' }, { nodeId: DB, label: 'Primary Database', stagedAt: 't' }, { nodeId: '10000000-0000-4000-8000-000000000099', label: 'Gone', stagedAt: 't' }];
    expect(pruneStagedExplodes(list, g).map((e) => e.label)).toEqual(['API Service', 'Gone']);
    expect(pruneStagedExplodes(list, g, { dropAbsent: true }).map((e) => e.label)).toEqual(['API Service']);
  });

  it('the depth rule decides who may be expanded: a role listing a part, never a container, a part, an exploded node, or a role listing none', () => {
    const g = graph();
    expect(canRequestExplode(g, API, resolveRole)).toBe(true);
    expect(canRequestExplode(g, LIB, resolveRole)).toBe(true); // a prefixed type resolves by its tail
    expect(canRequestExplode(g, WEB, resolveRole)).toBe(false);
    expect(canRequestExplode(g, BOX, resolveRole)).toBe(false);
    expect(canRequestExplode(g, DB, resolveRole)).toBe(false);
    expect(canRequestExplode(g, GROUP, resolveRole)).toBe(false);
    expect(canRequestExplode(g, API, () => null)).toBe(false); // before the catalog is read
  });
});

describe('AE.6 rail: the Expand row', () => {
  it('shows on an expandable node, stages on press, then reads requested with a Withdraw', () => {
    const onRequestExplode = vi.fn();
    const onWithdrawExplode = vi.fn();
    const { getByTestId, queryByTestId, unmount } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={API} graph={graph()} onRequestExplode={onRequestExplode} onWithdrawExplode={onWithdrawExplode} />);
    const row = getByTestId('rail-expand');
    expect(row.getAttribute('data-state')).toBe('open');
    expect(row.textContent).toContain('Ask your agent to split this node into parts.');
    fireEvent.click(getByTestId('rail-expand-request'));
    expect(onRequestExplode).toHaveBeenCalledWith(API);
    expect(queryByTestId('rail-expand-withdraw')).toBeNull();
    unmount();

    const staged = [{ nodeId: API, label: 'API Service', stagedAt: '2026-09-25T10:00:00.000Z' }];
    const requested = renderCanvas(<ArchitectureRail projectId="p1" nodeId={API} graph={graph()} stagedExplodes={staged} onRequestExplode={onRequestExplode} onWithdrawExplode={onWithdrawExplode} />);
    const rowNow = requested.getByTestId('rail-expand');
    expect(rowNow.getAttribute('data-state')).toBe('requested');
    expect(rowNow.textContent).toContain('Expansion requested. Your agent picks it up over MCP on its next status read.');
    fireEvent.click(requested.getByTestId('rail-expand-withdraw'));
    expect(onWithdrawExplode).toHaveBeenCalledWith(API);
  });

  it('shows nothing on a node an agent cannot explode, and nothing without the press wired', () => {
    for (const id of [WEB, BOX, DB, GROUP]) {
      const { queryByTestId, unmount } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={id} graph={graph()} onRequestExplode={vi.fn()} onWithdrawExplode={vi.fn()} />);
      expect(queryByTestId('rail-expand'), id).toBeNull();
      unmount();
    }
    const { queryByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={API} graph={graph()} />);
    expect(queryByTestId('rail-expand')).toBeNull();
  });
});

describe('AE.6 contract: what the app stages is what the server reads and asks the agent for', () => {
  const WEB = 'bf000000-0000-4000-8000-00000000a001';
  const PG = 'bf000000-0000-4000-8000-00000000a004';

  it('the app\'s staged list, written into projects.metadata as the editor writes it, reads back the same through the server\'s reader', () => {
    let list = stageExplode([], { id: WEB, label: 'Shelfie web app' }, new Date('2026-09-25T10:00:00Z'));
    list = stageExplode(list, { id: PG, label: 'Postgres' }, new Date('2026-09-25T10:01:00Z'));
    list = stageExplode(list, { id: WEB, label: 'Shelfie web app' }, new Date('2026-09-25T10:02:00Z'));
    const metadata = JSON.parse(JSON.stringify({ stagedExplodes: list })) as Record<string, unknown>;
    expect(serverReadStagedExplodes(metadata)).toEqual([
      { nodeId: PG, label: 'Postgres', stagedAt: '2026-09-25T10:01:00.000Z', note: null },
      { nodeId: WEB, label: 'Shelfie web app', stagedAt: '2026-09-25T10:02:00.000Z', note: null },
    ]);
    const withdrawn = withdrawExplode(list, PG);
    expect(serverReadStagedExplodes({ stagedExplodes: withdrawn.length > 0 ? withdrawn : undefined }).map((e) => e.nodeId)).toEqual([WEB]);
    expect(serverReadStagedExplodes({ stagedExplodes: undefined })).toEqual([]);
  });

  it('the server\'s lead for an app-staged request starts with the marker both skills teach, and its proposed form with the words that stop a second proposal', () => {
    const staged = serverReadStagedExplodes({ stagedExplodes: stageExplode([], { id: WEB, label: 'Shelfie web app' }) });
    const asked = stagedExplodeLead(staged.map((e) => ({ ...e, proposalId: null })));
    const marker = asked.split(' from the canvas')[0];
    expect(marker).toBe(marker.toUpperCase());
    const proposed = stagedExplodeLead(staged.map((e) => ({ ...e, proposalId: 'prop-1' })));
    for (const p of ['skills/nodespec-developer/SKILL.md', 'skills/nodespec-oss-developer/SKILL.md']) {
      const txt = readFileSync(resolve(__dirname, '../..', p), 'utf-8').replace(/\s+/g, ' ');
      expect(txt, p).toContain(`lead with ${marker}:`);
      expect(proposed).toContain('do not propose it again');
      expect(txt, p).toContain('do not propose it again');
    }
  });
});
