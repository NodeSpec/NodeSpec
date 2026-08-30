// N8.6(B): edge inspector completion + kill-list pins.
// (1) The Behavior section's patches (set_edge_direction / set_edge_criticality)
//     apply end-to-end — these were patch types with zero UI emitters until now.
// (2) One color/dash vocabulary: the shared tables cover EVERY enum value (the
//     EdgeLegend private copy had drifted to a subset — data_sync and ipc missing).
// (3) The port-name-prefix kind hack is dead: a port's kind comes only from its
//     connected edge's contract.
// (4) The @deprecated always-null mapNodeDragToPatch is deleted.
import { describe, it, expect } from 'vitest';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import { createPatchMetadata } from '@nodespec/core/patch-factory.js';
import { CONTRACT_KIND_VALUES, INTERACTION_KIND_VALUES } from '@nodespec/core/shared/enums.js';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import {
  CONTRACT_KIND_EDGE_COLORS,
  INTERACTION_KIND_DASH,
  getContractKindColor,
  getPortContractKind,
} from '../ui/components/panels/inspector/kind-maps.js';
import * as interactionAdapter from '../ui/adapters/interaction-to-patch.js';

const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const P1 = '55555555-5555-4555-8555-555555555555';

function graphWithEdge(): Graph {
  const g = createEmptyGraph() as Graph;
  g.nodes[N1] = { id: N1, type: 'backend-service', label: 'Api', metadata: {}, ports: [{ id: P1, name: 'Output', direction: 'out' }] } as Graph['nodes'][string];
  g.nodes[N2] = { id: N2, type: 'backend-service', label: 'Svc', metadata: {}, ports: [] } as Graph['nodes'][string];
  g.contracts[C1] = { id: C1, kind: 'grpc', name: 'Api → Svc', schema: {} } as Graph['contracts'][string];
  g.edges[E1] = { id: E1, source: N1, target: N2, sourcePortId: P1, contractId: C1, metadata: {} } as Graph['edges'][string];
  return g;
}

describe('Behavior section patches apply end-to-end (N8.6B)', () => {
  it('set_edge_direction updates the edge', () => {
    const patch: PatchOperation = {
      type: 'set_edge_direction',
      metadata: createPatchMetadata({ actorType: 'human', summary: 'Set direction to bidirectional' }),
      payload: { id: E1, direction: 'bidirectional' },
    };
    const result = applyPatch(graphWithEdge(), patch);
    expect(result.success).toBe(true);
    expect(result.graph?.edges[E1].direction).toBe('bidirectional');
  });

  it('set_edge_criticality updates the edge', () => {
    const patch: PatchOperation = {
      type: 'set_edge_criticality',
      metadata: createPatchMetadata({ actorType: 'human', summary: 'Set criticality to fallback' }),
      payload: { id: E1, criticality: 'fallback' },
    };
    const result = applyPatch(graphWithEdge(), patch);
    expect(result.success).toBe(true);
    expect(result.graph?.edges[E1].criticality).toBe('fallback');
  });
});

describe('one visual vocabulary — full enum coverage (N8.6B)', () => {
  it('CONTRACT_KIND_EDGE_COLORS covers every contract kind, both modes', () => {
    for (const kind of CONTRACT_KIND_VALUES) {
      expect(CONTRACT_KIND_EDGE_COLORS[kind], `missing color for ${kind}`).toBeDefined();
      expect(getContractKindColor(kind, 'dark')).toMatch(/^#/);
      expect(getContractKindColor(kind, 'light')).toMatch(/^#/);
    }
  });

  it('INTERACTION_KIND_DASH has a row for every interaction kind (subset drift is the bug class)', () => {
    for (const ik of INTERACTION_KIND_VALUES) {
      expect(ik in INTERACTION_KIND_DASH, `missing dash row for ${ik}`).toBe(true);
    }
  });
});

describe('port kind comes only from the connected contract (N8.6B)', () => {
  it('connected port resolves the contract kind', () => {
    const g = graphWithEdge();
    const edges = Object.values(g.edges);
    expect(getPortContractKind(P1, edges, g)).toBe('grpc');
  });

  it('unconnected port with a kind-prefixed NAME resolves nothing — the name hack is dead', () => {
    const g = graphWithEdge();
    const orphan = '66666666-6666-4666-8666-666666666666';
    (g.nodes[N1].ports as Array<{ id: string; name: string; direction: string }>).push(
      { id: orphan, name: 'REST Input', direction: 'in' },
    );
    expect(getPortContractKind(orphan, Object.values(g.edges), g)).toBeNull();
  });
});

describe('kill list (N8.6B)', () => {
  it('mapNodeDragToPatch is gone from the adapter module', () => {
    expect('mapNodeDragToPatch' in interactionAdapter).toBe(false);
  });
});
