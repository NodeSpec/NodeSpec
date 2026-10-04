// N9b-3: hydrates the retired static registry (test-only fixture).
import '../../../../src/tests/fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { VALIDATION_RULES } from '../rules';
import type { ValidationContext } from '../types';
import type { Graph } from '../../types';
import { ValidationEngine } from '../engine';

function makeGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    schemaVersion: 1,
    version: 1,
    hash: 'test',
    nodes: {},
    edges: {},
    contracts: {},
    artifacts: {},
    ...overrides,
  };
}

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function getRuleById(id: string) {
  const rule = VALIDATION_RULES.find(r => r.id === id);
  if (!rule) throw new Error(`Rule "${id}" not found`);
  return rule;
}

describe('configArtifactStaleness', () => {
  const rule = getRuleById('config-artifact-staleness');

  it('emits warning when config is ahead of artifacts', () => {
    const nodeId = uuid(1);
    const artifactId = uuid(2);
    const graph = makeGraph({
      nodes: {
        [nodeId]: {
          id: nodeId,
          type: 'web.rest-api',
          label: 'API',
          ports: [],
          artifacts: [artifactId],
          status: 'draft',
          metadata: {
            domainMetadata: {
              type: 'web-service',
              data: {
                language: 'typescript',
                framework: 'express',
                port: 4000,
                dependencies: [],
                envVars: [],
                apiRoutes: [],
              },
            },
          },
        } as any,
      },
      artifacts: {
        [artifactId]: {
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'src/index.ts',
          content: 'console.log("hello")',
          contentHash: 'abc123',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'complete',
          metadata: {
            lastConfigFingerprint: {
              fingerprint: 'stale-hash-value',
              timestamp: new Date(Date.now() - 100000).toISOString(),
              fields: { language: 'python', port: 8080 },
            },
          },
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[nodeId],
      allArtifacts: new Map(Object.entries(graph.artifacts)),
      allEdges: [],
    };

    const issues = rule.check(context);

    const warnings = issues.filter(i => i.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].message).toContain('Configuration has changed');
    expect(warnings[0].quickFixes[0].action.type).toBe('mark_artifacts_stale');
  });

  it('emits info when node has config but no artifacts', () => {
    const nodeId = uuid(1);
    const graph = makeGraph({
      nodes: {
        [nodeId]: {
          id: nodeId,
          type: 'web.rest-api',
          label: 'API',
          ports: [],
          artifacts: [],
          status: 'draft',
          metadata: {
            domainMetadata: {
              type: 'web-service',
              data: {
                language: 'typescript',
                framework: 'express',
                port: 3000,
                dependencies: [],
                envVars: [],
                apiRoutes: [],
              },
            },
          },
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[nodeId],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);

    const infos = issues.filter(i => i.severity === 'info');
    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(infos[0].message).toContain('no code artifacts yet');
  });

  it('returns no issues when config is in sync with artifacts', () => {
    const nodeId = uuid(1);
    const graph = makeGraph({
      nodes: {
        [nodeId]: {
          id: nodeId,
          type: 'web.rest-api',
          label: 'API',
          ports: [],
          artifacts: [],
          status: 'draft',
          metadata: {},
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[nodeId],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues when node has no metadata', () => {
    const nodeId = uuid(1);
    const graph = makeGraph({
      nodes: {
        [nodeId]: {
          id: nodeId,
          type: 'web.rest-api',
          label: 'API',
          ports: [],
          status: 'draft',
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[nodeId],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });
});

describe('ValidationEngine integration', () => {
  const engine = new ValidationEngine();

  it('runs configuration_consistency rules during node validation', async () => {
    const nodeId = uuid(1);
    const graph = makeGraph({
      nodes: {
        [nodeId]: {
          id: nodeId,
          type: 'web.rest-api',
          label: 'API',
          ports: [],
          artifacts: [],
          status: 'draft',
          metadata: {
            domainMetadata: {
              type: 'web-service',
              data: {
                language: 'typescript',
                framework: 'express',
                port: 3000,
                dependencies: [],
                envVars: [],
                apiRoutes: [],
              },
            },
          },
        } as any,
      },
    });

    const result = await engine.validateGraph(graph);

    const configIssues = result.issues.filter(i => i.category === 'configuration_consistency');
    expect(configIssues.length).toBeGreaterThanOrEqual(1);
  });

  // AG.13 (owner 2026-09-28): ports came out of the model; the three rules
  // that only policed them are retired. A legacy graph whose edge names a port
  // of the wrong direction, or one that does not exist, raises nothing.
  it('raises no port issue on a legacy graph with mismatched and missing ports', async () => {
    const sourceId = uuid(1);
    const targetId = uuid(2);
    const edgeId = uuid(3);
    const contractId = uuid(4);
    const graph = makeGraph({
      nodes: {
        [sourceId]: { id: sourceId, type: 'web.rest-api', label: 'Source', ports: [{ id: uuid(5), name: 'Wrong', direction: 'in' }], status: 'draft', artifacts: [], metadata: {} } as any,
        [targetId]: { id: targetId, type: 'web.rest-api', label: 'Target', ports: [], status: 'draft', artifacts: [], metadata: {} } as any,
      },
      edges: { [edgeId]: { id: edgeId, source: sourceId, target: targetId, sourcePortId: uuid(5), targetPortId: uuid(6), contractId } as any },
      contracts: { [contractId]: { id: contractId, kind: 'rest', name: 'Call', schema: { openapi: '3.0.0' } } as any },
    });

    const result = await engine.validateGraph(graph);

    expect(VALIDATION_RULES.map(r => r.id)).not.toContain('node-has-required-ports');
    expect(VALIDATION_RULES.map(r => r.id)).not.toContain('port-matches-node-type-template');
    expect(VALIDATION_RULES.map(r => r.id)).not.toContain('edge-port-direction-valid');
    expect(result.issues.filter(i => /port/i.test(i.message) || /port/i.test(i.description ?? ''))).toEqual([]);
  });
});
