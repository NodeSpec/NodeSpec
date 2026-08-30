// N8.4a-3c (owner, second report: "I still don't see any of the configuration
// information in the Context node export json") — the PER-NODE export
// (buildNodeExportContext / NodeExportModal) omitted ALL node metadata while the
// project export carried it since N5.5. These pins hold every configuration state on
// the per-node surface, JSON and prompt formats both.
import { describe, it, expect } from 'vitest';
import { buildNodeExportContext, formatNodeExportAsPrompt } from '../ui/utils/export-context.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { Graph } from '@nodespec/core/types.js';

const N1 = '11111111-1111-1111-1111-111111111111';

function graphWith(metadata: Record<string, unknown>): Graph {
  const g = createEmptyGraph();
  (g.nodes as Record<string, unknown>)[N1] = {
    id: N1, type: 'serverless-function', label: 'Thumbnailer',
    technology: 'aws-lambda', metadata, ports: [],
  };
  return g;
}

const OPTS = { includeArtifactContent: false };

describe('N8.4a-3c per-node export carries the inspector configuration', () => {
  it('user-specified values appear as configuration + source', () => {
    const ctx = buildNodeExportContext(N1, graphWith({ config: { memoryMb: 512, runtime: 'nodejs22.x' }, rationale: 'resizes uploads' }), OPTS)!;
    expect(ctx.node.configuration).toEqual({ memoryMb: 512, runtime: 'nodejs22.x' });
    expect(ctx.node.configurationSource).toBe('user-specified');
    expect(ctx.node.rationale).toBe('resizes uploads');

    const prompt = formatNodeExportAsPrompt(ctx);
    expect(prompt).toContain('### Configuration (user-selected — honor these choices)');
    expect(prompt).toContain('- **memoryMb:** 512');
  });

  it('"AI decides" exports the delegation, never silence', () => {
    const ctx = buildNodeExportContext(N1, graphWith({ configSource: 'ai' }), OPTS)!;
    expect(ctx.node.configuration).toBeUndefined();
    expect(ctx.node.configurationSource).toBe('delegated-to-ai');
    expect(formatNodeExportAsPrompt(ctx)).toContain('Delegated to the implementing AI');
  });

  it('no choice, no config → both fields absent (no fabricated keys)', () => {
    const ctx = buildNodeExportContext(N1, graphWith({}), OPTS)!;
    expect(ctx.node.configuration).toBeUndefined();
    expect(ctx.node.configurationSource).toBeUndefined();
    expect(formatNodeExportAsPrompt(ctx)).not.toContain('### Configuration');
  });
});
