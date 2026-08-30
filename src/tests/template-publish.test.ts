import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  foldSpecificationForTemplate,
  parseTagsInput,
  sanitizeGraphForPublish,
} from '../ui/utils/build-template-publish.js';
import type { Graph } from '@nodespec/core/types.js';

// Publish to NodeSpec Marketplace (hosted edition). The client sanitize/fold
// helpers mirror supabase/functions/_shared/publish-template-core.ts — the
// server copy is authoritative; these pins keep the client honest about what
// it sends, and the source contracts keep the UI wiring intact.

function sampleGraph(): Graph {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 8,
    version: 2,
    hash: 'h',
    nodes: {
      '22222222-2222-4222-8222-222222222222': {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'role.api-service',
        label: 'API',
        technology: 'fastapi',
      },
    },
    edges: {},
    contracts: {},
    artifacts: {
      '77777777-7777-4777-8777-777777777777': {
        id: '77777777-7777-4777-8777-777777777777',
        nodeId: '22222222-2222-4222-8222-222222222222',
        kind: 'source',
        path: 'api/main.py',
        language: 'python',
        content: "SECRET = 'private'",
        contentHash: 'deadbeef',
        sourceProvenance: 'repo-import',
        metadata: { internal: true },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    sourceContext: { repoUrl: 'https://github.com/owner/private' },
  } as Graph;
}

describe('sanitizeGraphForPublish (client mirror)', () => {
  it('strips artifact content, hashes, provenance, metadata, and sourceContext', () => {
    const graph = sampleGraph();
    const clean = sanitizeGraphForPublish(graph);
    const artifact = clean.artifacts['77777777-7777-4777-8777-777777777777'];
    expect(artifact.content).toBeUndefined();
    expect(artifact.contentHash).toBeUndefined();
    expect(artifact.sourceProvenance).toBeUndefined();
    expect(artifact.metadata).toBeUndefined();
    expect(artifact.path).toBe('api/main.py');
    expect(artifact.kind).toBe('source');
    expect((clean as Record<string, unknown>).sourceContext).toBeUndefined();
    // Input untouched.
    expect(graph.artifacts['77777777-7777-4777-8777-777777777777'].content).toBeDefined();
  });
});

describe('foldSpecificationForTemplate', () => {
  const requirements = [
    {
      id: 'db-uuid-1',
      requirementId: 'REQ-001',
      name: 'Login',
      description: 'Users can log in',
      category: 'functional',
      acceptanceCriteria: [{ text: 'Form renders' }, { text: '  ' }],
    },
  ];
  const mappings = new Map([
    ['db-uuid-1', [
      { nodeId: '22222222-2222-4222-8222-222222222222', mappingType: 'implements', confidence: 0.8, notes: ' note ' },
    ]],
  ]);

  it('returns null without a vision (spec-less publish is valid)', () => {
    expect(foldSpecificationForTemplate(null, requirements, mappings)).toBeNull();
    expect(foldSpecificationForTemplate({ vision: '  ' }, requirements, mappings)).toBeNull();
  });

  it('folds requirements on the human key and remaps mappings onto it', () => {
    const spec = foldSpecificationForTemplate(
      { vision: 'Ship it', preferences: { languages: ['ts'], secret: 'drop-me' } },
      requirements,
      mappings
    );
    expect(spec).not.toBeNull();
    expect(spec!.requirements).toHaveLength(1);
    expect(spec!.requirements[0].requirementId).toBe('REQ-001');
    expect(spec!.requirements[0].metadata).toEqual({});
    expect(spec!.requirements[0].acceptanceCriteria).toEqual([{ text: 'Form renders' }]);
    // Mappings key on the HUMAN id (applyTemplateSpecification rebuilds the
    // db linkage from it at instantiation time).
    expect(spec!.mappings).toEqual([
      {
        requirementId: 'REQ-001',
        nodeId: '22222222-2222-4222-8222-222222222222',
        mappingType: 'implements',
        confidence: 0.8,
        notes: 'note',
      },
    ]);
    expect(spec!.preferences).toEqual({ languages: ['ts'] });
  });
});

describe('parseTagsInput', () => {
  it('splits, trims, dedupes, and caps', () => {
    expect(parseTagsInput(' react, stripe ,react\nauth,, ')).toEqual(['react', 'stripe', 'auth']);
    expect(parseTagsInput('x'.repeat(41))).toEqual([]);
    expect(parseTagsInput(Array.from({ length: 15 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
  });
});

describe('publish UI wiring contracts', () => {
  const exportModal = readFileSync(
    resolve(__dirname, '../ui/components/common/ProjectExportModal.tsx'),
    'utf-8'
  );
  const graphEditor = readFileSync(
    resolve(__dirname, '../ui/components/GraphEditor.tsx'),
    'utf-8'
  );
  const publishModal = readFileSync(
    resolve(__dirname, '../ui/components/templates/PublishTemplateModal.tsx'),
    'utf-8'
  );

  it('export modal gates the marketplace card on hosted edition + callback', () => {
    expect(exportModal).toContain("import { isHostedEdition } from '../../config/edition.js'");
    expect(exportModal).toContain('isHostedEdition && onPublishToMarketplace');
    expect(exportModal).toContain("id: 'publish-marketplace'");
  });

  it('GraphEditor owns the publish modal and passes the live derived graph', () => {
    expect(graphEditor).toContain('PublishTemplateModal');
    expect(graphEditor).toContain('graph={derivedGraph}');
    expect(graphEditor).toContain('isHostedEdition && showPublishModal && projectId');
    // Opening publish closes the export modal (sibling modals, GitModal pattern).
    expect(graphEditor).toContain('setProjectExportData(null); setShowPublishModal(true);');
  });

  it('publish modal invokes the edge function and strips before sending', () => {
    expect(publishModal).toContain("supabase.functions.invoke(");
    expect(publishModal).toContain("'publish-template'");
    expect(publishModal).toContain('sanitizeGraphForPublish(graph)');
    expect(publishModal).toContain('publishedTemplateId');
  });

  it('tells the author source code never publishes', () => {
    expect(publishModal).toContain('Artifact source code is never published');
  });
});
