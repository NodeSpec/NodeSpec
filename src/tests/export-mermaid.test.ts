import { describe, it, expect } from 'vitest';
import { formatAsMermaid } from '../ui/utils/export-mermaid.js';
import type { ProjectExportData } from '../ui/utils/export-context.js';

function makeData(overrides: Partial<ProjectExportData> = {}): ProjectExportData {
  return {
    meta: {
      projectName: 'Test',
      exportedAt: '',
      schemaVersion: 8,
      graphHash: '',
      nodeCount: 0,
      edgeCount: 0,
      contractCount: 0,
      artifactCount: 0,
      testCount: 0,
    },
    nodes: [],
    edges: [],
    contracts: [],
    artifacts: [],
    ...overrides,
  } as ProjectExportData;
}

function node(id: string, label: string, type: string, extra: Record<string, unknown> = {}) {
  return { id, label, type, artifactPaths: [], ...extra };
}

describe('formatAsMermaid', () => {
  it('returns null for an empty graph', () => {
    expect(formatAsMermaid(makeData())).toBeNull();
  });

  it('emits partition-ordered flowchart with shapes and classes', () => {
    const data = makeData({
      nodes: [
        node('db', 'Postgres', 'database.postgres'),
        node('api', 'API', 'backend-service'),
        node('web', 'Web App', 'frontend.react-app'),
        node('bus', 'Events', 'event-bus'),
      ],
      edges: [
        { id: 'e1', sourceId: 'web', targetId: 'api', sourceNode: 'Web App', targetNode: 'API', contractId: 'c1', contractName: 'Public API', contractKind: 'rest' },
      ],
    } as Partial<ProjectExportData>);

    const out = formatAsMermaid(data)!;
    expect(out).toContain('flowchart LR');
    // Partition order: web (client) before api (service) before bus (messaging) before db (data)
    const webIdx = out.indexOf('"Web App"');
    const apiIdx = out.indexOf('"API"');
    const busIdx = out.indexOf('"Events"');
    const dbIdx = out.indexOf('"Postgres"');
    expect(webIdx).toBeLessThan(apiIdx);
    expect(apiIdx).toBeLessThan(busIdx);
    expect(busIdx).toBeLessThan(dbIdx);
    // Shapes: cylinder for db, parallelogram for bus
    expect(out).toMatch(/\[\("Postgres"\)\]/);
    expect(out).toMatch(/\[\/"Events"\\\]/);
    // Edge label with contract
    expect(out).toContain('-->|"rest: Public API"|');
    // Class styling present
    expect(out).toContain('classDef client');
    expect(out).toMatch(/class n\d+ data/);
  });

  it('renders containers as subgraphs and collapses large ones in compact mode', () => {
    const children = Array.from({ length: 60 }, (_, i) =>
      node(`svc${i}`, `Service ${i}`, 'backend-service', { parentId: 'box' }),
    );
    const data = makeData({
      nodes: [node('box', 'Cluster', 'orchestration.k8s'), ...children],
      edges: [],
    } as Partial<ProjectExportData>);

    const out = formatAsMermaid(data)!;
    expect(out).toContain('subgraph');
    expect(out).toContain('Cluster');
    expect(out).toMatch(/\.\.\. \+\d+ more/);
  });

  it('re-routes edges from collapsed children to their container', () => {
    const children = Array.from({ length: 60 }, (_, i) =>
      node(`svc${i}`, `Service ${i}`, 'backend-service', { parentId: 'box' }),
    );
    const data = makeData({
      nodes: [node('box', 'Cluster', 'orchestration.k8s'), node('web', 'Web', 'frontend.react-app'), ...children],
      edges: [
        // svc59 is beyond the 3 representatives, so it is not rendered:
        { id: 'e1', sourceId: 'web', targetId: 'svc59', sourceNode: 'Web', targetNode: 'Service 59', contractId: 'c1', contractName: '', contractKind: 'rest' },
      ],
    } as Partial<ProjectExportData>);

    const out = formatAsMermaid(data)!;
    // Edge must exist, targeting the container's short id rather than the hidden child.
    const lines = out.split('\n').filter((l) => l.includes('-->'));
    expect(lines.length).toBe(1);
    expect(out).not.toContain('"Service 59"');
  });
});
