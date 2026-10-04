// AA.3 (owner 2026-09-23) and AB.7 (owner 2026-09-24): an exploded node's
// parts are what it is made of, not where it runs. The deployment view never
// shows them: the node is itself and every edge to a part lands on it. The
// functional view shows the node as a card, closed until the viewer opens it
// (metadata.partsShown); opened, its parts and their edges show inside it.
import { describe, expect, it } from 'vitest';
import {
  isBoxNode, isExplodedNode, mapGraphToRFEdges, mapGraphToRFNodes, visibleEndpoint,
} from '../ui/adapters/graph-to-reactflow.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { Graph, Node, Edge, Contract } from '@nodespec/core/types.js';

const BOX = '00000000-0000-4000-8000-00000000000b';
const ROUTES = '00000000-0000-4000-8000-000000000001';
const DATA = '00000000-0000-4000-8000-000000000002';
const WEB = '00000000-0000-4000-8000-000000000003';
const DB = '00000000-0000-4000-8000-000000000004';

const node = (id: string, type: string, label: string, parentId?: string, metadata: Record<string, unknown> = {}): Node =>
  ({ id, type, label, data: {}, metadata, ...(parentId ? { parentId } : {}) }) as Node;
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target, contractId: 'c', metadata: {} }) as Edge;

function graph(partsShown = false): Graph {
  const g = createEmptyGraph();
  g.contracts.c = { id: 'c', kind: 'rest', name: 'API', schema: {}, metadata: {} } as Contract;
  g.nodes[BOX] = node(BOX, 'backend-service', 'Checkout API', undefined, partsShown ? { partsShown: true } : {});
  g.nodes[ROUTES] = node(ROUTES, 'part-handler', 'Routes', BOX);
  g.nodes[DATA] = node(DATA, 'part-repository', 'Data access', BOX);
  g.nodes[WEB] = node(WEB, 'frontend-app', 'Web');
  g.nodes[DB] = node(DB, 'database', 'Orders DB');
  g.edges.webToBox = edge('webToBox', WEB, BOX);
  g.edges.webToRoutes = edge('webToRoutes', WEB, ROUTES);
  g.edges.routesToData = edge('routesToData', ROUTES, DATA);
  g.edges.dataToDb = edge('dataToDb', DATA, DB);
  return g;
}

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

describe('AA.3 and AB.7 · an exploded node', () => {
  it('is a node whose role is not a container and that has parts; it is not a box that collapses', () => {
    const g = graph();
    expect(isExplodedNode(g.nodes[BOX], g)).toBe(true);
    expect(isExplodedNode(g.nodes[WEB], g)).toBe(false);
    expect(isBoxNode(g.nodes[BOX], g)).toBe(false);
    expect(isBoxNode(g.nodes[ROUTES], g)).toBe(false);
  });

  it('deployment view: the node is itself, its parts never show, and every edge to a part lands on it', () => {
    for (const shown of [false, true]) {
      const g = graph(shown);
      const nodes = byId(mapGraphToRFNodes(g, 'nested'));
      expect(nodes.get(BOX)!.type).toBe('icon');
      expect(nodes.get(BOX)!.data.exploded).toBeUndefined();
      expect([nodes.get(ROUTES)!.hidden, nodes.get(DATA)!.hidden]).toEqual([true, true]);
      const edges = byId(mapGraphToRFEdges(g, 'nested'));
      expect([edges.get('webToRoutes')!.target, edges.get('webToRoutes')!.data!.rolledUp]).toEqual([BOX, true]);
      expect(edges.get('dataToDb')!.source).toBe(BOX);
      expect(edges.get('routesToData')!.hidden).toBe(true);
      // Two edges now share the pair Web -> node: staggered, not drawn on top of each other.
      expect(edges.get('webToBox')!.data!.curveOffset).not.toBe(edges.get('webToRoutes')!.data!.curveOffset);
    }
  });

  it('functional view, closed by default: a card that says it has parts; they roll up into it', () => {
    const g = graph();
    const nodes = byId(mapGraphToRFNodes(g, 'flat'));
    expect(nodes.get(BOX)!.type).toBe('container');
    expect(nodes.get(BOX)!.data.exploded).toBe(true);
    expect([nodes.get(BOX)!.width, nodes.get(BOX)!.height]).toEqual([240, 80]);
    expect(nodes.get(ROUTES)!.hidden).toBe(true);
    expect(visibleEndpoint(ROUTES, g, 'flat')).toBe(BOX);
    const edges = byId(mapGraphToRFEdges(g, 'flat'));
    expect(edges.get('webToRoutes')!.target).toBe(BOX);
    expect(edges.get('routesToData')!.hidden).toBe(true);
  });

  it('functional view, opened: the parts show inside it, with their edges', () => {
    const g = graph(true);
    const nodes = byId(mapGraphToRFNodes(g, 'flat'));
    expect(nodes.get(BOX)!.type).toBe('container');
    expect(nodes.get(BOX)!.zIndex).toBe(1);
    expect([nodes.get(ROUTES)!.hidden, nodes.get(ROUTES)!.parentId, nodes.get(ROUTES)!.type]).toEqual([false, BOX, 'icon']);
    expect(visibleEndpoint(ROUTES, g, 'flat')).toBe(ROUTES);
    const edges = byId(mapGraphToRFEdges(g, 'flat'));
    expect(edges.get('webToRoutes')!.target).toBe(ROUTES);
    expect(edges.get('webToRoutes')!.data!.rolledUp).toBeUndefined();
    expect(edges.get('routesToData')!.hidden).toBeFalsy();
  });

  it('a collapsed hosting box shows its outside edges too, on the outermost collapsed box', () => {
    const g = graph();
    const VPC = '00000000-0000-4000-8000-0000000000cc';
    g.nodes[VPC] = node(VPC, 'vpc', 'VPC', undefined, { containerExpanded: false });
    g.nodes[BOX] = { ...g.nodes[BOX], parentId: VPC };
    expect(visibleEndpoint(ROUTES, g, 'nested')).toBe(VPC);
    const edges = byId(mapGraphToRFEdges(g, 'nested'));
    expect(edges.get('webToRoutes')!.target).toBe(VPC);
  });
});
