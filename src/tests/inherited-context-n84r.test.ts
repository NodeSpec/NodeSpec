// N8.4r — client mirror of the container-scope inheritance walk, plus the surface that
// actually matters to the user: the per-node context export. The AWS/Azure/GCP platform
// containers carry a configurable account/subscription/project scope; before this it
// reached nothing that an implementing AI reads.
import { describe, it, expect } from 'vitest';
import { collectInheritedScopes, effectiveInheritedValues } from '@nodespec/core/inherited-context.js';
import { buildNodeExportContext, formatNodeExportAsPrompt } from '../ui/utils/export-context.js';

const graph = {
  nodes: {
    gcp: {
      id: 'gcp', label: 'Acme Prod (Google Cloud)', type: 'gcp',
      metadata: { config: { projectId: 'acme-prod-1234', primaryRegion: 'us-central1', environment: 'production' } },
    },
    vpc: {
      id: 'vpc', label: 'Core VPC', type: 'vpc', parentId: 'gcp',
      metadata: { config: { primaryRegion: 'europe-west1' } },
    },
    svc: {
      id: 'svc', label: 'Orders API', type: 'backend-service', parentId: 'vpc',
      technology: 'gcp-cloud-run', metadata: {},
    },
  },
  edges: {},
  contracts: {},
} as never;

describe('collectInheritedScopes (client mirror)', () => {
  it('matches the server walk: outermost first, innermost wins', () => {
    const scopes = collectInheritedScopes(graph, 'svc');
    expect(scopes.map(s => s.containerId)).toEqual(['gcp', 'vpc']);
    expect(effectiveInheritedValues(scopes).primaryRegion).toBe('europe-west1');
    expect(effectiveInheritedValues(scopes).projectId).toBe('acme-prod-1234');
  });
});

describe('node context export carries the container scope', () => {
  it('includes each configured ancestor in the payload', () => {
    const ctx = buildNodeExportContext('svc', graph, { includeArtifactContent: false })!;
    expect(ctx.inheritedContext).toBeDefined();
    expect(ctx.inheritedContext!.map(s => s.containerLabel)).toEqual(['Acme Prod (Google Cloud)', 'Core VPC']);
  });

  it('renders the values in the markdown an AI actually reads', () => {
    const ctx = buildNodeExportContext('svc', graph, { includeArtifactContent: false })!;
    const md = formatNodeExportAsPrompt(ctx);
    expect(md).toContain('Inherited configuration');
    expect(md).toContain('projectId: acme-prod-1234');
    expect(md).toContain('primaryRegion: europe-west1');
  });

  it('omits the block entirely when no container is configured', () => {
    const bare = {
      nodes: { a: { id: 'a', label: 'A', type: 'aws' }, b: { id: 'b', label: 'B', type: 'backend-service', parentId: 'a' } },
      edges: {}, contracts: {},
    } as never;
    const ctx = buildNodeExportContext('b', bare, { includeArtifactContent: false })!;
    expect(ctx.inheritedContext).toBeUndefined();
    expect(formatNodeExportAsPrompt(ctx)).not.toContain('Inherited configuration');
  });
});
