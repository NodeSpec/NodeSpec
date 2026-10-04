// V3 AD.2b (owner 2026-09-24, D3): a load is a diff, applied through the SAME
// patch engine every accepted proposal goes through. The round trip: a canvas
// is written to model.json (version 2, configuration and schemas included,
// credentials withheld), another canvas loads it, and the patches the load
// proposes, applied by core's engine, leave that canvas holding the same
// design, while its positions, file content and credentials stay its own.
import { describe, it, expect } from 'vitest';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import { serializeModel, parseModel, sameDesign, type ModelAnchor } from '../../supabase/functions/_shared/model-anchor.ts';
import { anchorLoadPatches } from '../../supabase/functions/_shared/anchor-load.ts';
import { collectGitContentRequests, injectGitContent } from '../ui/utils/proposal-git-content.js';
import { isAutoApprovable } from '../ui/hooks/useProposalAutoApprove.js';
import { loadModelMessage } from '../ui/components/panels/repoActivity.js';
import { computeContentHash } from '@nodespec/core/utils.js';

const API = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CACHE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PORT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const E2 = '44444444-4444-4444-8444-444444444444';
const E3 = '45454545-4545-4545-8545-454545454545';
const F1 = '55555555-5555-4555-8555-555555555555';
const F2 = '66666666-6666-4666-8666-666666666666';
const GID = '77777777-7777-4777-8777-777777777777';
const T = '2026-09-24T00:00:00.000Z';
const HEAD = 'c'.repeat(40);

/** What git holds: the design as another canvas pushed it. */
function gitDesign(): Graph {
  return {
    id: GID, schemaVersion: 8, version: 5, hash: 'x',
    nodes: {
      [API]: {
        id: API, type: 'backend-service', label: 'Orders Service', technology: 'node',
        ports: [{ id: PORT, name: 'db', direction: 'out' }],
        metadata: { position: { x: 900, y: 900 }, config: { region: 'eu-west-2', dbPassword: 'their-secret' }, configSource: 'manual' },
      },
      [DB]: { id: DB, type: 'database', label: 'Orders DB', ports: [], metadata: { position: { x: 900, y: 0 } } },
      [CACHE]: { id: CACHE, type: 'cache', label: 'Cache', ports: [], metadata: { config: { ttl: 60 } } },
    },
    edges: {
      [E1]: { id: E1, source: API, target: DB, contractId: C1, sourcePortId: PORT, metadata: {} },
      [E2]: { id: E2, source: API, target: CACHE, contractId: C2, metadata: {} },
    },
    contracts: {
      [C1]: { id: C1, kind: 'rest', name: 'orders', schema: { type: 'object', properties: { id: { type: 'string' } } }, metadata: {} },
      [C2]: { id: C2, kind: 'rest', name: 'cache', schema: {}, metadata: {} },
    },
    artifacts: {
      [F1]: { id: F1, nodeId: API, path: 'src/api.ts', kind: 'source', content: 'git content', createdAt: T, updatedAt: T },
      // The side that pushed hashed its content, as the canvas does on save.
      [F2]: { id: F2, nodeId: CACHE, path: 'src/cache.ts', kind: 'source', content: 'cache from git', contentHash: computeContentHash('cache from git'), createdAt: T, updatedAt: T },
    },
  } as unknown as Graph;
}

/** The canvas that loads it: an older design with its own positions, file
 *  content and credential, a node git removed and an older schema. */
function canvas(): Graph {
  return {
    id: GID, schemaVersion: 8, version: 3, hash: 'y',
    nodes: {
      [API]: {
        id: API, type: 'backend-service', label: 'Orders API', technology: 'node',
        ports: [{ id: PORT, name: 'db', direction: 'out', required: true }],
        metadata: { position: { x: 10, y: 20 }, config: { region: 'eu-west-1', dbPassword: 'my-secret' }, configSource: 'manual', note: 'mine' },
      },
      [DB]: { id: DB, type: 'database', label: 'Orders DB', ports: [], metadata: { position: { x: 300, y: 20 } } },
      [OLD]: { id: OLD, type: 'worker', label: 'Old worker', ports: [], metadata: {} },
    },
    edges: {
      [E1]: { id: E1, source: API, target: DB, contractId: C1, sourcePortId: PORT, metadata: {} },
      [E3]: { id: E3, source: API, target: OLD, contractId: C1, metadata: {} },
    },
    contracts: {
      [C1]: { id: C1, kind: 'rest', name: 'orders', schema: { type: 'object' }, metadata: {} },
    },
    artifacts: {
      [F1]: { id: F1, nodeId: API, path: 'src/api.ts', kind: 'source', content: 'my local content', createdAt: T, updatedAt: T },
    },
  } as unknown as Graph;
}

async function anchorOf(g: Graph): Promise<ModelAnchor> {
  const parsed = parseModel(await serializeModel(g as unknown as Record<string, unknown>));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.model;
}

async function load(into: Graph, from: Graph) {
  const plan = await anchorLoadPatches(into as unknown as Record<string, unknown>, await anchorOf(from), { actorId: 'git-load', sourceCommit: HEAD, nowIso: T });
  // The accept path fills new bindings from git before applying (C1).
  const patches = plan.patches as unknown as PatchOperation[];
  const { requests } = collectGitContentRequests(patches);
  const files = new Map([['src/cache.ts', 'cache from git']]);
  const injected = injectGitContent(patches, requests, files);
  const result = applyPatches(into, injected.patches);
  return { plan, requests, injected, result };
}

describe('AD.2b: a load through the real patch engine', () => {
  it('leaves the canvas holding git\'s whole design', async () => {
    const { result, injected } = await load(canvas(), gitDesign());
    expect(injected.missing).toEqual([]);
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    const after = await anchorOf(result.graph!);
    expect(await sameDesign(after, await anchorOf(gitDesign()))).toBe(true);
  });

  it('keeps positions, other metadata, port details, file content and the canvas\'s own credential', async () => {
    const g = (await load(canvas(), gitDesign())).result.graph!;
    const api = g.nodes[API];
    expect(api.label).toBe('Orders Service');
    expect((api.metadata as Record<string, unknown>).position).toEqual({ x: 10, y: 20 });
    expect((api.metadata as Record<string, unknown>).note).toBe('mine');
    expect((api.metadata as Record<string, unknown>).config).toEqual({ region: 'eu-west-2', dbPassword: 'my-secret' });
    expect(api.ports?.[0]).toMatchObject({ id: PORT, required: true });
    expect(g.artifacts[F1].content).toBe('my local content');
    expect(g.contracts[C1].schema).toEqual({ type: 'object', properties: { id: { type: 'string' } } });
  });

  it('adds what git added (content from git), removes what git removed', async () => {
    const g = (await load(canvas(), gitDesign())).result.graph!;
    expect(g.nodes[CACHE]).toBeDefined();
    expect((g.nodes[CACHE].metadata as Record<string, unknown>).config).toEqual({ ttl: 60 });
    expect(g.artifacts[F2].content).toBe('cache from git');
    expect(g.nodes[OLD]).toBeUndefined();
    expect(g.edges[E3]).toBeUndefined();
    expect(g.contracts[C2]).toBeDefined();
  });

  it('a second load proposes nothing', async () => {
    const once = (await load(canvas(), gitDesign())).result.graph!;
    const again = await anchorLoadPatches(once as unknown as Record<string, unknown>, await anchorOf(gitDesign()), { actorId: 'git-load', sourceCommit: HEAD, nowIso: T });
    expect(again.patches).toEqual([]);
  });

  it('a binding whose file git never committed lands empty instead of failing the accept', async () => {
    const { plan } = await load(canvas(), gitDesign());
    const patches = plan.patches as unknown as PatchOperation[];
    const { requests } = collectGitContentRequests(patches);
    expect(requests.every((r) => r.optional)).toBe(true);
    const none = injectGitContent(patches, requests, new Map());
    expect(none.missing).toEqual([]);
    const add = none.patches.find((p) => p.type === 'add_artifact') as unknown as { payload: { content: string; contentHash?: string } };
    expect(add.payload.content).toBe('');
    expect(add.payload.contentHash).toBeUndefined();
  });
});

describe('AD.2b: nothing loads without a person', () => {
  const proposal = (source: string) => ({ id: 'p', metadata: { source }, patches: [] }) as never;

  it('auto-approve never accepts a load of git\'s model or the adopt at connect', () => {
    expect(isAutoApprovable(proposal('git-load'))).toBe(false);
    expect(isAutoApprovable(proposal('git-adopt'))).toBe(false);
    expect(isAutoApprovable(proposal('mcp-server'))).toBe(true);
  });

  it('the app says where the load waits, and when there is nothing to load', () => {
    expect(loadModelMessage({ status: 'filed', patchCount: 3 })).toBe(
      "The repository's model is waiting in Proposals: 3 changes to review. Nothing on the canvas changes until you accept it.",
    );
    expect(loadModelMessage({ status: 'filed', patchCount: 1, notApplied: ['Node A: x.'] })).toContain('1 change in git cannot be proposed and stays as the canvas has it: Node A: x.');
    expect(loadModelMessage({ status: 'identical', note: 'Noted.' })).toBe("The canvas already holds the repository's model. Noted.");
    for (const m of [loadModelMessage({ status: 'filed', patchCount: 2 }), loadModelMessage({ status: 'identical' })]) {
      expect(m).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
