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

describe('portMatchesNodeTypeTemplate', () => {
  const rule = getRuleById('port-matches-node-type-template');

  it('emits warning when required template port is missing', () => {
    const graph = makeGraph({
      nodes: {
        [uuid(1)]: {
          id: uuid(1),
          type: 'frontend.react',
          label: 'React App',
          ports: [],
          status: 'draft',
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[uuid(1)],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);

    const warnings = issues.filter(i => i.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].message).toContain('Missing required');
    expect(warnings[0].quickFixes.length).toBeGreaterThan(0);
    expect(warnings[0].quickFixes[0].action.type).toBe('reconcile_ports');
  });

  it('emits info when port direction matches but name differs', () => {
    const graph = makeGraph({
      nodes: {
        [uuid(1)]: {
          id: uuid(1),
          type: 'frontend.react',
          label: 'React App',
          ports: [
            { id: uuid(10), name: 'Custom Out Port', direction: 'out' },
          ],
          status: 'draft',
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[uuid(1)],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);

    const infos = issues.filter(i => i.severity === 'info');
    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(infos[0].message).toContain('Port name differs');
    expect(infos[0].quickFixes[0].action.type).toBe('reconcile_ports');
  });

  it('returns no issues when ports match template', () => {
    const graph = makeGraph({
      nodes: {
        [uuid(1)]: {
          id: uuid(1),
          type: 'frontend.react',
          label: 'React App',
          ports: [
            { id: uuid(10), name: 'API Request', direction: 'out' },
          ],
          status: 'draft',
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[uuid(1)],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues for node types without defaultPorts', () => {
    const graph = makeGraph({
      nodes: {
        [uuid(1)]: {
          id: uuid(1),
          type: 'nonexistent.type',
          label: 'Unknown',
          ports: [],
          status: 'draft',
        } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      node: graph.nodes[uuid(1)],
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues when node context is missing', () => {
    const graph = makeGraph();
    const context: ValidationContext = {
      graph,
      allArtifacts: new Map(),
      allEdges: [],
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });
});

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

describe('edgePortDirectionValid', () => {
  const rule = getRuleById('edge-port-direction-valid');

  it('emits error when source port has wrong direction', () => {
    const sourceId = uuid(1);
    const targetId = uuid(2);
    const edgeId = uuid(3);
    const contractId = uuid(4);
    const sourcePortId = uuid(5);

    const graph = makeGraph({
      nodes: {
        [sourceId]: {
          id: sourceId,
          type: 'web.rest-api',
          label: 'Source',
          ports: [{ id: sourcePortId, name: 'In Port', direction: 'in' }],
          status: 'draft',
        } as any,
        [targetId]: {
          id: targetId,
          type: 'web.rest-api',
          label: 'Target',
          ports: [],
          status: 'draft',
        } as any,
      },
      edges: {
        [edgeId]: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourcePortId,
          contractId,
        } as any,
      },
      contracts: {
        [contractId]: { id: contractId, kind: 'rest' } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      edge: graph.edges[edgeId],
      allArtifacts: new Map(),
      allEdges: Object.values(graph.edges),
    };

    const issues = rule.check(context);

    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('Source port has wrong direction');
    expect(issues[0].quickFixes[0].action.type).toBe('update_contract');
  });

  it('emits error when target port has wrong direction', () => {
    const sourceId = uuid(1);
    const targetId = uuid(2);
    const edgeId = uuid(3);
    const contractId = uuid(4);
    const targetPortId = uuid(6);

    const graph = makeGraph({
      nodes: {
        [sourceId]: {
          id: sourceId,
          type: 'web.rest-api',
          label: 'Source',
          ports: [],
          status: 'draft',
        } as any,
        [targetId]: {
          id: targetId,
          type: 'web.rest-api',
          label: 'Target',
          ports: [{ id: targetPortId, name: 'Out Port', direction: 'out' }],
          status: 'draft',
        } as any,
      },
      edges: {
        [edgeId]: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          targetPortId,
          contractId,
        } as any,
      },
      contracts: {
        [contractId]: { id: contractId, kind: 'rest' } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      edge: graph.edges[edgeId],
      allArtifacts: new Map(),
      allEdges: Object.values(graph.edges),
    };

    const issues = rule.check(context);

    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('Target port has wrong direction');
  });

  it('returns no issues when port directions are correct', () => {
    const sourceId = uuid(1);
    const targetId = uuid(2);
    const edgeId = uuid(3);
    const contractId = uuid(4);
    const sourcePortId = uuid(5);
    const targetPortId = uuid(6);

    const graph = makeGraph({
      nodes: {
        [sourceId]: {
          id: sourceId,
          type: 'web.rest-api',
          label: 'Source',
          ports: [{ id: sourcePortId, name: 'Out', direction: 'out' }],
          status: 'draft',
        } as any,
        [targetId]: {
          id: targetId,
          type: 'web.rest-api',
          label: 'Target',
          ports: [{ id: targetPortId, name: 'In', direction: 'in' }],
          status: 'draft',
        } as any,
      },
      edges: {
        [edgeId]: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourcePortId,
          targetPortId,
          contractId,
        } as any,
      },
      contracts: {
        [contractId]: { id: contractId, kind: 'rest' } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      edge: graph.edges[edgeId],
      allArtifacts: new Map(),
      allEdges: Object.values(graph.edges),
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues when edge has no port references', () => {
    const sourceId = uuid(1);
    const targetId = uuid(2);
    const edgeId = uuid(3);
    const contractId = uuid(4);

    const graph = makeGraph({
      nodes: {
        [sourceId]: {
          id: sourceId,
          type: 'web.rest-api',
          label: 'Source',
          ports: [],
          status: 'draft',
        } as any,
        [targetId]: {
          id: targetId,
          type: 'web.rest-api',
          label: 'Target',
          ports: [],
          status: 'draft',
        } as any,
      },
      edges: {
        [edgeId]: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          contractId,
        } as any,
      },
      contracts: {
        [contractId]: { id: contractId, kind: 'rest' } as any,
      },
    });

    const context: ValidationContext = {
      graph,
      edge: graph.edges[edgeId],
      allArtifacts: new Map(),
      allEdges: Object.values(graph.edges),
    };

    const issues = rule.check(context);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues when edge context is missing', () => {
    const graph = makeGraph();
    const context: ValidationContext = {
      graph,
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

  it('runs edgePortDirectionValid during edge validation', async () => {
    const sourceId = uuid(1);
    const targetId = uuid(2);
    const edgeId = uuid(3);
    const contractId = uuid(4);
    const sourcePortId = uuid(5);

    const graph = makeGraph({
      nodes: {
        [sourceId]: {
          id: sourceId,
          type: 'web.rest-api',
          label: 'Source',
          ports: [{ id: sourcePortId, name: 'Wrong', direction: 'in' }],
          status: 'draft',
          artifacts: [],
          metadata: {},
        } as any,
        [targetId]: {
          id: targetId,
          type: 'web.rest-api',
          label: 'Target',
          ports: [],
          status: 'draft',
          artifacts: [],
          metadata: {},
        } as any,
      },
      edges: {
        [edgeId]: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourcePortId,
          contractId,
        } as any,
      },
      contracts: {
        [contractId]: { id: contractId, kind: 'rest' } as any,
      },
    });

    const result = await engine.validateGraph(graph);

    const directionIssues = result.issues.filter(
      i => i.message.includes('Source port has wrong direction')
    );
    expect(directionIssues.length).toBeGreaterThanOrEqual(1);
    expect(directionIssues[0].severity).toBe('error');
  });
});
