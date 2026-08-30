// Golden regression for the server-side graph-mutation tools. A scripted sequence of
// tool calls runs through executeTool; the resulting graph + patches log is normalized
// (UUIDs to stable placeholders, timestamps to "<TS>") and compared against a checked-in
// fixture. Set UPDATE_GOLDENS=1 to rewrite the fixture after a legitimate behavior change;
// every bit of drift then shows up as a diff in the PR.
//
// Note (S1-2 reverted 2026-07-14): tool-executor uses its own hand-rolled mutation, NOT
// core.applyPatch — importing core's source into a Deno edge function crashes the runtime
// (bare `zod` + `.js`-on-.ts specifiers). So the fixture reflects hand-rolled semantics:
// removing a node does NOT garbage-collect the edge's contract here. Contract GC lives in
// core and reaches the CLIENT path (MCP propose→approve applies patches in the browser via
// @nodespec/core). The server agent loop that uses these tools is frozen under FULL
// INVERSION, so its lack of GC is acceptable.

import { executeTool, type ToolContext, type GraphState } from '../_shared/tool-executor.ts';
import { SSEEmitter } from '../_shared/streaming.ts';
import type { CatalogData, NodeRoleRow } from '../_shared/catalog-loader.ts';
import { assertEquals } from './helpers.ts';

const GOLDEN_PATH = new URL('./tool-executor.golden.json', import.meta.url).pathname;

function role(id: string, extra: Partial<NodeRoleRow> = {}): NodeRoleRow {
  return {
    id, label: id, description: '', icon_name: '', color: '', rf_visual_type: '',
    palette_category: '', nature: 'build', interface_kind: 'service', is_container: false, container_layer: null,
    container_style: null, can_contain: [], metadata_schema: {}, default_ports: [],
    suggested_contracts: [], sort_order: 0, capability_tags: [], default_technology: null,
    when_to_use: null, deprecated: false,
    ...extra,
  };
}

const CATALOGS: CatalogData = {
  nodeRoles: {
    'backend-service': role('backend-service'),
    'database': role('database'),
    'container': role('container', {
      is_container: true,
      container_layer: 'logical',
      container_style: 'logical-boundary',
      can_contain: ['backend-service', 'database'],
    }),
  },
  technologies: {},
  deploymentTargets: {},
  legacyTypeMappings: {},
  cloudProviderPatterns: [],
  scopeArchetypes: {},
};

// This sequence must not need Supabase — the tools we exercise are all graph-only.
const STUB_SUPABASE = new Proxy({}, {
  get: () => { throw new Error('supabase should not be called by this golden sequence'); },
}) as never;

function makeCtx(): ToolContext {
  return {
    supabase: STUB_SUPABASE,
    userId: '00000000-0000-0000-0000-000000000001',
    projectId: '00000000-0000-0000-0000-000000000002',
    branchId: '00000000-0000-0000-0000-000000000003',
    graph: { nodes: {}, edges: {}, contracts: {}, artifacts: {} } as GraphState,
    lockedNodeIds: new Set(),
    patches: [],
    pendingTraceUpdates: [],
    emitter: new SSEEmitter({ runId: 'r', projectId: 'p', userId: 'u', persistEvents: false }),
    catalogs: CATALOGS,
  };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const isSeededUuid = (u: string) => /^00000000-0000-0000-0000-\d{12}$/.test(u);

function normalize(value: unknown): unknown {
  const uuidMap = new Map<string, string>();
  const nextUuid = () => `uuid-${uuidMap.size + 1}`;
  const rewriteString = (s: string): string =>
    s.replace(ISO_RE, () => '<TS>')
     .replace(UUID_RE, (m) => {
       if (isSeededUuid(m)) return m;
       if (!uuidMap.has(m)) uuidMap.set(m, nextUuid());
       return uuidMap.get(m)!;
     });
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return rewriteString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[rewriteString(k)] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

// The scripted sequence — exercises every mutation tool at least once. Notes on
// specific choices below:
//   * remove_node API at the end: API owns an artifact + ports + is a parent, so this
//     exercises core's cascade (artifacts get deleted; hand-rolled today only kills edges).
//   * set_parent DB → null: exercises the unparent path (currently produces an invalid
//     `parentId: null` payload that core would reject — kept as an intentional exception
//     documented in tool-executor.ts).
const SEQUENCE: Array<[string, Record<string, unknown>]> = [
  ['add_node',        { label: 'API',     role: 'backend-service' }],
  ['add_node',        { label: 'DB',      role: 'database' }],
  ['add_node',        { label: 'Region',  role: 'container' }],
  ['set_parent',      { nodeLabel: 'API', parentLabel: 'Region' }],
  ['set_parent',      { nodeLabel: 'DB',  parentLabel: 'Region' }],
  ['add_edge',        { source: 'API',    target: 'DB', contractName: 'API-to-DB',
                        interactionKind: 'call_api', transport: 'http', contractKind: 'rest' }],
  ['set_parent',      { nodeLabel: 'DB',  parentLabel: null }],
  ['update_node',     { label: 'API',     description: 'Public REST', rationale: 'External clients' }],
  ['add_port',        { nodeLabel: 'API', portName: 'grpc-out', direction: 'out' }],
  ['add_artifact',    { nodeLabel: 'API', path: 'src/index.ts', content: 'export {}', kind: 'source' }],
  ['update_artifact', { nodeLabel: 'API', path: 'src/index.ts', content: 'export const x = 1' }],
  ['add_contract',    { name: 'Payments', kind: 'rest', interactionKind: 'call_api', transport: 'http' }],
  ['remove_edge',     { source: 'API',    target: 'DB' }],
  ['remove_node',     { label: 'API' }],
];

Deno.test('graph-mutation tool sequence matches golden fixture', async () => {
  const ctx = makeCtx();
  for (const [tool, args] of SEQUENCE) {
    const r = await executeTool(ctx, tool, args);
    if (!r.success) {
      throw new Error(`Sequence step "${tool}" failed: ${r.error}`);
    }
  }
  const actual = normalize({ graph: ctx.graph, patches: ctx.patches });
  const actualStr = JSON.stringify(actual, null, 2) + '\n';

  if (Deno.env.get('UPDATE_GOLDENS') === '1') {
    await Deno.writeTextFile(GOLDEN_PATH, actualStr);
    console.log(`Wrote golden: ${GOLDEN_PATH}`);
    return;
  }

  const expectedStr = await Deno.readTextFile(GOLDEN_PATH);
  assertEquals(actualStr, expectedStr,
    'Graph/patches drifted from fixture. Re-run with UPDATE_GOLDENS=1 to accept — but only after auditing every diff.');
});
