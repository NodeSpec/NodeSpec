// N8.6(C): client export surfaces carry edge behavior fields, present-only.
// The anchor slice (per-node export.json) and GraphRefExport dropped
// direction/criticality entirely; present-only serialization keeps slices of
// untouched graphs hash-identical to pre-(C) output.
import { describe, it, expect } from 'vitest';
import { buildNodeAnchorSlice } from '@nodespec/core/anchor-slice.js';
import { buildProjectExport, buildGraphRefExport } from '../ui/utils/export-context.js';
import type { Graph } from '@nodespec/core/types.js';

const S = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

function graphWith(edgeExtra: Record<string, unknown>): Graph {
  return {
    id: 'g', name: 'g', version: 1,
    nodes: {
      [S]: { id: S, type: 'backend-service', label: 'Api', metadata: {}, ports: [] },
      [T]: { id: T, type: 'backend-service', label: 'Svc', metadata: {}, ports: [] },
    },
    edges: { e1: { id: 'e1', source: S, target: T, contractId: 'c1', metadata: {}, ...edgeExtra } },
    contracts: { c1: { id: 'c1', kind: 'rest', name: 'Api → Svc', interactionKind: 'request_response', transport: 'http', specFormat: 'openapi', schema: {} } },
    artifacts: {},
  } as unknown as Graph;
}

describe('anchor slice carries edge behavior fields (N8.6C)', () => {
  it('present-only: unset fields add no keys and do not move the contentHash', async () => {
    const plain = await buildNodeAnchorSlice(graphWith({}), S);
    const set = await buildNodeAnchorSlice(graphWith({ direction: 'bidirectional', criticality: 'fallback' }), S);
    if (!plain || !set) throw new Error('slice builder returned null for a live node');
    expect('direction' in plain.edges[0]).toBe(false);
    expect('criticality' in plain.edges[0]).toBe(false);
    expect(set.edges[0].direction).toBe('bidirectional');
    expect(set.edges[0].criticality).toBe('fallback');
    expect(set.edges[0].contentHash).not.toBe(plain.edges[0].contentHash);
  });
});

describe('exports carry REACHABLE contracts only (N8.6C-fix, owner bench catch)', () => {
  it('orphaned stubs and unreferenced contracts never cross into the project export', () => {
    const g = graphWith({});
    (g.contracts as Record<string, unknown>)['dead1'] = { id: 'dead1', kind: 'amqp', name: 'Stub: AMQP In', schema: {}, metadata: { isStub: true } };
    (g.contracts as Record<string, unknown>)['dead2'] = { id: 'dead2', kind: 'rest', name: 'rest contract', schema: {} };
    const data = buildProjectExport(g, 'p');
    expect(data.contracts.map(c => c.id)).toEqual(['c1']);
  });
});

describe('project export carries edge behavior + full contract descriptors (N8.6C)', () => {
  it('ProjectExportData edges + GraphRefExport edges include direction/criticality', () => {
    const data = buildProjectExport(graphWith({ direction: 'bidirectional', criticality: 'optional' }), 'p');
    expect(data.edges[0].direction).toBe('bidirectional');
    expect(data.edges[0].criticality).toBe('optional');

    const ref = buildGraphRefExport({ ...data, meta: { schemaVersion: 7, graphHash: 'h', exportedAt: 't' } } as Parameters<typeof buildGraphRefExport>[0]);
    expect(ref.edges[0].direction).toBe('bidirectional');
    expect(ref.edges[0].criticality).toBe('optional');
    expect(ref.contractIndex['c1'].interactionKind).toBe('request_response');
  });
});
