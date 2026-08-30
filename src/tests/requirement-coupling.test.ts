// R6 commit 7: pure pins for the client coupling helpers (spec-v3/coupling.ts).
// Coupling is DERIVED at read time from the mapping pivots + graph and never
// stored; suggestions are hints only — the accept click is the sole path to a
// stored relation row. Mirrors the server pins in mcp-requirements_test.ts.
import { describe, it, expect } from 'vitest';
import {
  computeCouplingByRequirement,
  computeExpandSuggestions,
  isRequirementCompleted,
} from '../ui/components/spec-v3/coupling.js';
import type { CouplingGraphSlice } from '../ui/components/spec-v3/coupling.js';
import type { RequirementMapping } from '../ui/services/MappingService.js';
import type { Requirement } from '../persistence/supabase/requirements-repository.js';
import type { RequirementRelation } from '../persistence/supabase/requirement-relations-repository.js';

const GRAPH: CouplingGraphSlice = {
  nodes: {
    'node-api': { label: 'API Service' },
    'node-db': { label: 'Primary Database' },
    'node-ui': { label: 'Web Frontend' },
  },
  edges: {
    e1: { source: 'node-api', target: 'node-db' },
  },
};

function mkMapping(requirementId: string, nodeId: string): RequirementMapping {
  return {
    id: `${requirementId}:${nodeId}`,
    specificationId: 's1',
    requirementId,
    nodeId,
    mappingType: 'implements',
    confidence: 1,
    createdAt: 't',
    createdBy: null,
  } as RequirementMapping;
}

function pivots(mappings: RequirementMapping[]) {
  const byRequirement = new Map<string, RequirementMapping[]>();
  const byNode = new Map<string, RequirementMapping[]>();
  for (const m of mappings) {
    if (m.requirementId) {
      byRequirement.set(m.requirementId, [...(byRequirement.get(m.requirementId) || []), m]);
    }
    byNode.set(m.nodeId, [...(byNode.get(m.nodeId) || []), m]);
  }
  return { byRequirement, byNode };
}

function mkReq(rowId: string, reqId: string, opts?: Partial<Requirement>): Requirement {
  return {
    id: rowId,
    specificationId: 's1',
    requirementId: reqId,
    name: reqId,
    description: '',
    category: 'functional',
    status: 'pending',
    confirmed: false,
    locked: false,
    sectionId: null,
    source: 'manual',
    acceptanceCriteria: [],
    metadata: {},
    createdAt: 't',
    updatedAt: 't',
    ...opts,
  } as Requirement;
}

function mkRelation(from: string, to: string, type: RequirementRelation['relationType']): RequirementRelation {
  return {
    id: `${from}->${to}:${type}`,
    specificationId: 's1',
    fromRequirementId: from,
    toRequirementId: to,
    relationType: type,
    source: 'user',
    createdBy: null,
    notes: null,
    createdAt: 't',
  };
}

describe('computeCouplingByRequirement', () => {
  it('shared node → shared_node coupling, via = the node LABEL, both directions', () => {
    const { byRequirement, byNode } = pivots([mkMapping('row-1', 'node-api'), mkMapping('row-2', 'node-api')]);
    const out = computeCouplingByRequirement(byNode, byRequirement, GRAPH);
    expect(out.get('row-1')).toEqual([{ requirementRowId: 'row-2', kind: 'shared_node', via: 'API Service' }]);
    expect(out.get('row-2')).toEqual([{ requirementRowId: 'row-1', kind: 'shared_node', via: 'API Service' }]);
  });

  it('edge-bridged nodes → adjacent coupling, via names the edge "src → tgt"', () => {
    const { byRequirement, byNode } = pivots([mkMapping('row-1', 'node-api'), mkMapping('row-2', 'node-db')]);
    const out = computeCouplingByRequirement(byNode, byRequirement, GRAPH);
    expect(out.get('row-1')).toEqual([{ requirementRowId: 'row-2', kind: 'adjacent', via: 'API Service → Primary Database' }]);
    expect(out.get('row-2')).toEqual([{ requirementRowId: 'row-1', kind: 'adjacent', via: 'API Service → Primary Database' }]);
  });

  it('NO false positive: distinct nodes without a bridging edge stay uncoupled', () => {
    const { byRequirement, byNode } = pivots([mkMapping('row-1', 'node-api'), mkMapping('row-2', 'node-ui')]);
    const out = computeCouplingByRequirement(byNode, byRequirement, GRAPH);
    expect(out.size).toBe(0);
  });

  it('shared_node WINS over adjacent for the same pair — one entry per pair', () => {
    const { byRequirement, byNode } = pivots([
      mkMapping('row-1', 'node-api'), mkMapping('row-1', 'node-db'),
      mkMapping('row-2', 'node-api'),
    ]);
    const out = computeCouplingByRequirement(byNode, byRequirement, GRAPH);
    expect(out.get('row-1')).toEqual([{ requirementRowId: 'row-2', kind: 'shared_node', via: 'API Service' }]);
    expect(out.get('row-2')).toHaveLength(1);
  });

  it('a requirement mapped to both edge endpoints never couples to itself', () => {
    const { byRequirement, byNode } = pivots([mkMapping('row-1', 'node-api'), mkMapping('row-1', 'node-db')]);
    const out = computeCouplingByRequirement(byNode, byRequirement, GRAPH);
    expect(out.size).toBe(0);
  });

  it('missing graph → node ids name the via, adjacency silently absent', () => {
    const { byRequirement, byNode } = pivots([mkMapping('row-1', 'n1'), mkMapping('row-2', 'n1')]);
    const out = computeCouplingByRequirement(byNode, byRequirement, undefined);
    expect(out.get('row-1')).toEqual([{ requirementRowId: 'row-2', kind: 'shared_node', via: 'n1' }]);
  });
});

describe('isRequirementCompleted', () => {
  it('status implemented/validated counts; pending with unmet criteria does not', () => {
    expect(isRequirementCompleted(mkReq('r', 'REQ-001', { status: 'implemented' }))).toBe(true);
    expect(isRequirementCompleted(mkReq('r', 'REQ-001', { status: 'validated' }))).toBe(true);
    expect(isRequirementCompleted(mkReq('r', 'REQ-001', { acceptanceCriteria: [{ text: 'x', met: false }] as never }))).toBe(false);
  });

  it('all criteria met counts; zero criteria alone does NOT', () => {
    expect(isRequirementCompleted(mkReq('r', 'REQ-001', { acceptanceCriteria: [{ text: 'x', met: true }] as never }))).toBe(true);
    expect(isRequirementCompleted(mkReq('r', 'REQ-001'))).toBe(false);
  });
});

describe('computeExpandSuggestions', () => {
  const completed = mkReq('row-done', 'REQ-007', { status: 'implemented' });
  const fresh = mkReq('row-new', 'REQ-010');
  const shared = new Map([
    ['row-new', [{ requirementRowId: 'row-done', kind: 'shared_node' as const, via: 'API Service' }]],
    ['row-done', [{ requirementRowId: 'row-new', kind: 'shared_node' as const, via: 'API Service' }]],
  ]);

  it('incomplete req sharing a node with a COMPLETED one → suggestion citing the node', () => {
    const out = computeExpandSuggestions([completed, fresh], shared, []);
    expect(out.get('row-new')).toEqual([
      { targetRowId: 'row-done', targetRequirementId: 'REQ-007', via: 'API Service' },
    ]);
    // The completed req never gets a suggestion of its own.
    expect(out.has('row-done')).toBe(false);
  });

  it('an EXISTING expands relation between the pair suppresses the suggestion (either direction)', () => {
    const out = computeExpandSuggestions([completed, fresh], shared, [mkRelation('row-new', 'row-done', 'expands')]);
    expect(out.size).toBe(0);
    const reversed = computeExpandSuggestions([completed, fresh], shared, [mkRelation('row-done', 'row-new', 'expands')]);
    expect(reversed.size).toBe(0);
  });

  it('a non-expands relation does NOT suppress; a non-completed target never suggests', () => {
    const out = computeExpandSuggestions([completed, fresh], shared, [mkRelation('row-new', 'row-done', 'relates_to')]);
    expect(out.get('row-new')).toHaveLength(1);

    const incompleteTarget = mkReq('row-done', 'REQ-007'); // same row id, but pending
    const none = computeExpandSuggestions([incompleteTarget, fresh], shared, []);
    expect(none.size).toBe(0);
  });

  it('adjacent coupling is too weak to imply lineage — no suggestion', () => {
    const adjacent = new Map([
      ['row-new', [{ requirementRowId: 'row-done', kind: 'adjacent' as const, via: 'API Service → Primary Database' }]],
    ]);
    const out = computeExpandSuggestions([completed, fresh], adjacent, []);
    expect(out.size).toBe(0);
  });
});
