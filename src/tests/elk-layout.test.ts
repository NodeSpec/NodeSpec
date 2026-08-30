import { describe, it, expect } from 'vitest';
import { calculateElkLayout } from '../ui/utils/elk-layout.js';
import type { SpecGraphRFNode, SpecGraphRFEdge } from '../ui/adapters/graph-to-reactflow.js';

function node(id: string, nodeType: string, opts: Partial<SpecGraphRFNode> = {}): SpecGraphRFNode {
  return {
    id,
    type: opts.type ?? 'icon',
    position: { x: 0, y: 0 },
    data: { nodeType } as SpecGraphRFNode['data'],
    ...opts,
  } as SpecGraphRFNode;
}

function edge(id: string, source: string, target: string): SpecGraphRFEdge {
  return { id, source, target } as SpecGraphRFEdge;
}

describe('calculateElkLayout', () => {
  it('returns empty result for empty input', async () => {
    const result = await calculateElkLayout([], []);
    expect(result.positions).toEqual([]);
    expect(result.containerSizes.size).toBe(0);
  });

  it('orders partitioned nodes left-to-right by architectural column', async () => {
    const nodes = [
      node('db', 'database.postgres'),
      node('api', 'backend-service'),
      node('web', 'frontend.react-app'),
    ];
    const edges = [edge('e1', 'web', 'api'), edge('e2', 'api', 'db')];

    const { positions } = await calculateElkLayout(nodes, edges, { direction: 'LR' });
    const byId = new Map(positions.map((p) => [p.id, p]));

    expect(byId.get('web')!.x).toBeLessThan(byId.get('api')!.x);
    expect(byId.get('api')!.x).toBeLessThan(byId.get('db')!.x);
  });

  it('keeps partition columns even when edges pull the other way', async () => {
    // db -> web edge would put db left of web in a pure layered drawing;
    // partitioning must keep the client column left of the data column.
    const nodes = [
      node('db', 'database.postgres'),
      node('web', 'frontend.react-app'),
    ];
    const edges = [edge('e1', 'db', 'web')];

    const { positions } = await calculateElkLayout(nodes, edges, { direction: 'LR' });
    const byId = new Map(positions.map((p) => [p.id, p]));

    expect(byId.get('web')!.x).toBeLessThan(byId.get('db')!.x);
  });

  it('lays out container children parent-relative and sizes the container', async () => {
    const nodes = [
      node('box', 'orchestration.docker-compose', { type: 'container', width: 500, height: 400 }),
      node('svc-a', 'backend-service', { parentId: 'box' }),
      node('svc-b', 'backend-service', { parentId: 'box' }),
      node('outside', 'frontend.react-app'),
    ];
    const edges = [edge('e1', 'svc-a', 'svc-b'), edge('e2', 'outside', 'svc-a')];

    const { positions, containerSizes } = await calculateElkLayout(nodes, edges, { direction: 'LR' });
    const byId = new Map(positions.map((p) => [p.id, p]));

    // Children exist and are parent-relative: inside the container's box,
    // below the 90px header padding.
    const size = containerSizes.get('box');
    expect(size).toBeDefined();
    for (const childId of ['svc-a', 'svc-b']) {
      const pos = byId.get(childId)!;
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(80);
      expect(pos.x).toBeLessThanOrEqual(size!.width);
      expect(pos.y).toBeLessThanOrEqual(size!.height);
    }
    // Container grew to fit two 200x100 children plus padding.
    expect(size!.width).toBeGreaterThanOrEqual(300);
    expect(size!.height).toBeGreaterThanOrEqual(200);
  });

  it('produces no overlapping top-level nodes on a dense graph', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, 'backend-service'));
    const edges = Array.from({ length: 11 }, (_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`));

    const { positions } = await calculateElkLayout(nodes, edges, { direction: 'LR' });
    expect(positions).toHaveLength(12);

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const overlapX = Math.abs(a.x - b.x) < 200;
        const overlapY = Math.abs(a.y - b.y) < 100;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});
