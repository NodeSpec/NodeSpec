// @vitest-environment jsdom
//
// Item 25 (owner 2026-09-27): read, write or both is the agent's to state,
// and the exploded database has to work for a project drawn from nothing and
// for one imported from a repository, without touching the import.
//
// Driven through the real adapter (mapGraphToRFNodes) and the real card
// (TableGroupNode), fed the node the adapter draws:
//   - a database the person drew keeps its own table list and is a database
//     wherever it sits; only a table group draws as a group card;
//   - a drawn database's groups list tables with no file, and nothing opens;
//   - an imported one whose schema sits with the service: the table names the
//     service's migration, and its row opens it on the service, the node that
//     holds it; a file bound on the group itself wins.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { TableGroupNode } from '../ui/components/nodes/TableGroupNode.js';
import { mapGraphToRFNodes, mapGraphToRFEdges, type SpecGraphRFNode } from '../ui/adapters/graph-to-reactflow.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { CatalogResolver } from '../persistence/supabase/catalog-repository.js';
import type { Artifact, Contract, Edge, Graph, Node } from '@nodespec/core/types.js';

const HOST = '00000000-0000-4000-8000-0000000000a0';
const DB = '00000000-0000-4000-8000-0000000000db';
const API = '00000000-0000-4000-8000-0000000000a1';
const ORDERS = '00000000-0000-4000-8000-0000000000b1';
const MIGRATION = '00000000-0000-4000-8000-0000000000f1';
const ON_GROUP = '00000000-0000-4000-8000-0000000000f2';

// As in the real catalog: Docker Compose hosts a database; a table group is a part whose interface is data.
const catalog = {
  getRole: (r: string) => (r === 'part-table-group'
    ? { id: r, capabilityTags: ['part'], interfaceKind: 'data' }
    : r === 'docker-compose'
      ? { id: r, isContainer: true, containerStyle: 'hosting', capabilityTags: [], interfaceKind: 'service' }
      : { id: r, capabilityTags: [], interfaceKind: r === 'database' ? 'data' : 'service' }),
  getTechnology: (t: string) => (t === 'postgresql' ? { id: t, aiContext: { dataModel: 'relational' } } : null),
  resolveNodeType: (t: string) => (t === 'docker-compose'
    ? { role: { id: t, isContainer: true, containerStyle: 'hosting', rfVisualType: 'container', canContain: ['database', 'backend-service'] }, technology: null }
    : null),
} as unknown as CatalogResolver;

const node = (id: string, type: string, label: string, extra: Partial<Node> = {}): Node =>
  ({ id, type, label, data: {}, metadata: {}, ...extra }) as Node;

/** A database the person drew inside Docker Compose, with its tables typed in. */
function drawn(): Graph {
  const g = createEmptyGraph();
  g.nodes[HOST] = node(HOST, 'docker-compose', 'Compose');
  g.nodes[DB] = node(DB, 'database', 'Orders DB', { technology: 'postgresql', parentId: HOST, metadata: { tables: [{ name: 'orders', fields: ['id', 'total'] }] } });
  g.nodes[API] = node(API, 'backend-service', 'Orders API', { parentId: HOST });
  return g;
}

/** The same database exploded: one group, the API's edge taken by it. */
function exploded(tables: Array<Record<string, unknown>>, artifacts: Artifact[] = []): Graph {
  const g = createEmptyGraph();
  g.nodes[DB] = node(DB, 'database', 'Orders DB', { technology: 'postgresql', metadata: { partsShown: true } });
  g.nodes[API] = node(API, 'backend-service', 'Orders API');
  g.nodes[ORDERS] = node(ORDERS, 'part-table-group', 'orders', { parentId: DB, metadata: { tables } });
  g.contracts.c = { id: 'c', kind: 'sql', name: 'Orders', schema: {}, metadata: {} } as Contract;
  g.edges.e = { id: 'e', source: API, target: ORDERS, contractId: 'c', metadata: { access: 'write' } } as Edge;
  for (const a of artifacts) g.artifacts[a.id] = a;
  return g;
}

const drawnAs = (g: Graph, mode: 'nested' | 'flat', id: string) => mapGraphToRFNodes(g, mode, catalog).find((n) => n.id === id)!;

function renderGroup(rf: SpecGraphRFNode, onOpenFile: (a: string, n: string) => void) {
  const props = {
    id: rf.id, type: rf.type, selected: false, dragging: false, zIndex: 1, isConnectable: false, positionAbsoluteX: 0, positionAbsoluteY: 0,
    data: { ...rf.data, onOpenFile },
  } as unknown as React.ComponentProps<typeof TableGroupNode>;
  return render(<ThemeProvider><ReactFlowProvider><TableGroupNode {...props} /></ReactFlowProvider></ThemeProvider>);
}

describe('item 25: a database the person drew is a database wherever it sits', () => {
  it('inside Docker Compose, with its tables typed in: the deployment view draws the database, not a table group', () => {
    const db = drawnAs(drawn(), 'nested', DB);
    expect(db.type).toBe('icon');
    expect(db.data.group).toBeUndefined();
    expect((db.data.metadata as { tables?: unknown }).tables).toEqual([{ name: 'orders', fields: ['id', 'total'] }]);
  });

  it('a table group under an exploded database still draws as its card', () => {
    expect(drawnAs(exploded([{ name: 'orders', columns: 7 }]), 'flat', ORDERS).type).toBe('tableGroup');
  });
});

describe('item 25: a drawn database, exploded', () => {
  it('its group lists the tables; nothing opens, and the edge the group took says write', () => {
    const g = exploded([{ name: 'orders', columns: 7 }, { name: 'order_lines', columns: 5 }]);
    const open = vi.fn();
    const { getByText } = renderGroup(drawnAs(g, 'flat', ORDERS), open);
    expect(getByText('schema · 2 tables')).toBeTruthy();
    const row = getByText('order_lines').parentElement!;
    expect(row.tagName).toBe('DIV');
    fireEvent.click(row);
    expect(open).not.toHaveBeenCalled();
    expect(mapGraphToRFEdges(g, 'flat', catalog).find((e) => e.id === 'e')!.data!.access).toBe('write');
  });
});

describe('item 25: an imported database whose schema sits with the service', () => {
  const migration = { id: MIGRATION, nodeId: API, path: 'api/migrations/001_orders.sql', kind: 'schema', status: 'draft' } as Artifact;

  it('the row names the service\'s migration and opens it on the service, which holds it', () => {
    const g = exploded([{ name: 'orders', columns: 7, file: 'api/migrations/001_orders.sql' }], [migration]);
    const open = vi.fn();
    const { getByTitle } = renderGroup(drawnAs(g, 'flat', ORDERS), open);
    fireEvent.click(getByTitle('Opens api/migrations/001_orders.sql'));
    expect(open).toHaveBeenCalledWith(MIGRATION, API);
  });

  it('a file bound on the group itself wins over the same path elsewhere', () => {
    const own = { id: ON_GROUP, nodeId: ORDERS, path: 'api/migrations/001_orders.sql', kind: 'schema', status: 'draft' } as Artifact;
    const g = exploded([{ name: 'orders', file: 'api/migrations/001_orders.sql' }], [migration, own]);
    const open = vi.fn();
    const { getByTitle } = renderGroup(drawnAs(g, 'flat', ORDERS), open);
    fireEvent.click(getByTitle('Opens api/migrations/001_orders.sql'));
    expect(open).toHaveBeenCalledWith(ON_GROUP, ORDERS);
  });

  it('NodeSpec\'s own documents are never what a table opens', () => {
    const doc = { id: 'doc', nodeId: API, path: 'docs/tasks/orders-api.md', kind: 'task', status: 'draft' } as Artifact;
    const g = exploded([{ name: 'orders', file: 'docs/tasks/orders-api.md' }], [doc]);
    const open = vi.fn();
    const { getByTitle } = renderGroup(drawnAs(g, 'flat', ORDERS), open);
    const row = getByTitle('docs/tasks/orders-api.md');
    expect(row.tagName).toBe('DIV');
  });
});
