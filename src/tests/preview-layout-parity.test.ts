import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { computePreviewLayout } from '../ui/utils/preview-layout.js';
import type { SpecGraphRFNode, SpecGraphRFEdge } from '../ui/adapters/graph-to-reactflow.js';

// Cross-runtime layout parity (anchor-golden pattern): the og-image edge
// function carries a Deno copy of computePreviewLayout, pinned to the SAME
// fixture by supabase/functions/tests/og-preview-layout_test.ts. This side
// asserts the ORIGINAL still produces the fixture, so any layout change
// fails both suites together and the fixture is regenerated deliberately
// (scratchpad script documented in the fixture's description field).
describe('preview layout cross-runtime parity', () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../supabase/functions/tests/fixtures/og-preview-layout-fixture.json'
      ),
      'utf-8'
    )
  ) as {
    nodes: Array<{ id: string; type: string; parentId?: string }>;
    edges: Array<{ source: string; target: string }>;
    positions: Array<{ id: string; x: number; y: number }>;
    sizes: Array<{ id: string; width: number; height: number }>;
  };

  it('client computePreviewLayout still produces the shared golden', () => {
    const result = computePreviewLayout(
      fixture.nodes as unknown as SpecGraphRFNode[],
      fixture.edges as unknown as SpecGraphRFEdge[]
    );
    expect(result.positions).toEqual(fixture.positions);
    expect(result.sizes).toEqual(fixture.sizes);
  });

  it('fixture containers are exactly the parentId-referenced nodes', () => {
    // The Deno copy derives container-ness from parentId references instead
    // of node.type; the fixture must keep both derivations equivalent.
    const referenced = new Set(fixture.nodes.map((n) => n.parentId).filter(Boolean));
    for (const node of fixture.nodes) {
      const isContainerByType = node.type === 'container';
      expect(referenced.has(node.id), node.id).toBe(isContainerByType);
    }
  });
});
