// Discovered 2026-07-14 (live bench, raised by the owner): deleting a node via MCP
// proposal removed the node and its edge but stranded the edge's contract —
// totalContracts stayed inflated while nothing listed the contract anywhere (all
// contract listings are edge-driven). Fix: remove_node/remove_edge cascades now GC
// contracts that end up with no edge AND no port referencing them. Scoped GC only:
// standalone contracts created deliberately via add_contract are never candidates.
import { describe, it, expect } from 'vitest';
import { applyPatch, validatePatch } from '@nodespec/core/patch-engine.js';
import {
  createRemoveNodePatch,
  createRemoveEdgePatch,
  createRemoveContractPatch,
} from '@nodespec/core/patch-factory.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Node, Edge, Contract, Graph } from '@nodespec/core/types.js';

const actorOptions = { actorType: 'human' as const, summary: 'Contract GC test' };

function testNode(id: string, ports: Node['ports'] = undefined): Node {
  const node: Node = { id, type: 'service', label: `Node ${id.slice(0, 8)}`, data: {}, metadata: {} };
  if (ports) node.ports = ports;
  return node;
}

function testContract(id: string): Contract {
  return { id, kind: 'sql', name: `Contract ${id.slice(0, 8)}`, schema: {}, metadata: {} };
}

function testEdge(id: string, source: string, target: string, contractId: string): Edge {
  return { id, source, target, contractId, label: 'test-edge', metadata: {} };
}

/** Two nodes joined by one edge whose contract is referenced by nothing else. */
function graphWithSoleContractEdge() {
  const graph = createEmptyGraph();
  const a = generateUUID();
  const b = generateUUID();
  const contractId = generateUUID();
  const edgeId = generateUUID();
  graph.nodes[a] = testNode(a);
  graph.nodes[b] = testNode(b);
  graph.contracts[contractId] = testContract(contractId);
  graph.edges[edgeId] = testEdge(edgeId, a, b, contractId);
  return { graph, a, b, contractId, edgeId };
}

function mustApply(graph: Graph, patch: Parameters<typeof applyPatch>[1]): Graph {
  const result = applyPatch(graph, patch);
  expect(result.success, JSON.stringify(result.error)).toBe(true);
  return result.graph!;
}

describe('contract GC on remove cascades', () => {
  it('remove_edge GCs a contract referenced only by that edge (the live bug)', () => {
    const { graph, contractId, edgeId } = graphWithSoleContractEdge();
    const next = mustApply(graph, createRemoveEdgePatch(edgeId, actorOptions));
    expect(next.edges[edgeId]).toBeUndefined();
    expect(next.contracts[contractId]).toBeUndefined();
  });

  it('remove_node GCs the contracts of every cascaded edge', () => {
    const { graph, a, b, contractId } = graphWithSoleContractEdge();
    // Second edge b->a with its own contract; deleting node a cascades both edges.
    const contract2 = generateUUID();
    const edge2 = generateUUID();
    graph.contracts[contract2] = testContract(contract2);
    graph.edges[edge2] = testEdge(edge2, b, a, contract2);

    const next = mustApply(graph, createRemoveNodePatch(a, actorOptions));
    expect(Object.keys(next.edges)).toHaveLength(0);
    expect(next.contracts[contractId]).toBeUndefined();
    expect(next.contracts[contract2]).toBeUndefined();
  });

  it('a contract shared with a surviving edge is NOT GCd', () => {
    const { graph, b, contractId, edgeId } = graphWithSoleContractEdge();
    // Third node c; edge b->c reuses the SAME contract.
    const c = generateUUID();
    const edge2 = generateUUID();
    graph.nodes[c] = testNode(c);
    graph.edges[edge2] = testEdge(edge2, b, c, contractId);

    const next = mustApply(graph, createRemoveEdgePatch(edgeId, actorOptions));
    expect(next.contracts[contractId]).toBeDefined();
    expect(next.edges[edge2]).toBeDefined();
  });

  it('a contract still referenced by a node port survives edge removal', () => {
    const { graph, b, contractId, edgeId } = graphWithSoleContractEdge();
    // Give node b a port bound to the contract.
    const portId = generateUUID();
    graph.nodes[b].ports = [{ id: portId, name: 'sql-in', direction: 'in', contractId }];

    const next = mustApply(graph, createRemoveEdgePatch(edgeId, actorOptions));
    expect(next.contracts[contractId]).toBeDefined();
  });

  it('standalone contracts (never referenced by the removed edges) are untouched', () => {
    const { graph, a } = graphWithSoleContractEdge();
    // Deliberately-created contract awaiting wiring — must survive an unrelated remove.
    const standalone = generateUUID();
    graph.contracts[standalone] = testContract(standalone);

    const next = mustApply(graph, createRemoveNodePatch(a, actorOptions));
    expect(next.contracts[standalone]).toBeDefined();
  });

  it('CONTRACT_IN_USE now also rejects removing a port-referenced contract', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const contractId = generateUUID();
    const portId = generateUUID();
    graph.contracts[contractId] = testContract(contractId);
    graph.nodes[nodeId] = testNode(nodeId, [
      { id: portId, name: 'sql-in', direction: 'in', contractId },
    ]);

    const result = validatePatch(graph, createRemoveContractPatch(contractId, actorOptions));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'CONTRACT_IN_USE')).toBe(true);
  });

  it('explicit remove_contract of a genuinely orphaned contract still works', () => {
    // The owner's cleanup path for pre-existing orphans: propose remove_contract.
    const graph = createEmptyGraph();
    const contractId = generateUUID();
    graph.contracts[contractId] = testContract(contractId);

    const next = mustApply(graph, createRemoveContractPatch(contractId, actorOptions));
    expect(next.contracts[contractId]).toBeUndefined();
  });
});
