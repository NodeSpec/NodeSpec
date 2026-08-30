import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
import { validateNodeArtifactsAgainstObligations, validateAllArtifacts } from '@nodespec/core/artifact-validation.js';
import type { Port, Artifact } from '@nodespec/core/types.js';

describe('Artifact Validation', () => {
  describe('validateNodeArtifactsAgainstObligations', () => {
    it('should return error for non-existent node', () => {
      const graph = createEmptyGraph();
      const result = validateNodeArtifactsAgainstObligations(graph, 'non-existent-id');

      expect(result.ok).toBe(false);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].severity).toBe('error');
      expect(result.issues[0].message).toContain('not found');
    });

    it('should return ok for node with no obligations', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Simple Service',
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      expect(result.ok).toBe(true);
      expect(result.issues.length).toBe(0);
    });

    it('should flag missing schema artifact for REST contract', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
      };

      const port: Port = {
        id: portId,
        direction: 'in',
        name: 'HTTP In',
        contractId,
      };

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'API Service',
        ports: [port],
        artifacts: [],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      expect(result.ok).toBe(true); // warnings don't set ok=false
      expect(result.issues.length).toBeGreaterThan(0);

      const schemaIssue = result.issues.find(i => i.message.includes('schema artifact containing OpenAPI'));
      expect(schemaIssue).toBeDefined();
      expect(schemaIssue?.severity).toBe('warning');
      expect(schemaIssue?.contractId).toBe(contractId);
    });

    it('should pass validation when REST contract has OpenAPI schema artifact', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();
      const artifactId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
      };

      const port: Port = {
        id: portId,
        direction: 'in',
        name: 'HTTP In',
        contractId,
      };

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'schema',
        path: 'api.yaml',
        content: 'openapi: 3.0.0\ninfo:\n  title: User API',
        contentHash: computeContentHash('openapi: 3.0.0\ninfo:\n  title: User API'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'API Service',
        ports: [port],
        artifacts: [artifactId],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const schemaIssue = result.issues.find(i => i.message.includes('schema artifact containing OpenAPI'));
      expect(schemaIssue).toBeUndefined();
    });

    it('should pass validation when REST contract has Swagger schema artifact', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();
      const artifactId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
      };

      const port: Port = {
        id: portId,
        direction: 'in',
        name: 'HTTP In',
        contractId,
      };

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'schema',
        path: 'api.json',
        content: '{"swagger": "2.0", "info": {"title": "User API"}}',
        contentHash: computeContentHash('{"swagger": "2.0", "info": {"title": "User API"}}'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'API Service',
        ports: [port],
        artifacts: [artifactId],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const schemaIssue = result.issues.find(i => i.message.includes('schema artifact containing OpenAPI'));
      expect(schemaIssue).toBeUndefined();
    });

    it('should flag missing schema for event contract', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'kafka',
        name: 'User Created Event',
      };

      const port: Port = {
        id: portId,
        direction: 'out',
        name: 'Event Out',
        contractId,
      };

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Event Producer',
        ports: [port],
        artifacts: [],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const eventIssue = result.issues.find(i => i.message.includes('event/message schema'));
      expect(eventIssue).toBeDefined();
      expect(eventIssue?.severity).toBe('warning');
    });

    it('should pass validation when event contract has schema artifact with schema keyword', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();
      const artifactId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'kafka',
        name: 'User Created Event',
      };

      const port: Port = {
        id: portId,
        direction: 'out',
        name: 'Event Out',
        contractId,
      };

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'schema',
        path: 'events.json',
        content: '{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}',
        contentHash: computeContentHash('{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Event Producer',
        ports: [port],
        artifacts: [artifactId],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const eventIssue = result.issues.find(i => i.message.includes('event/message schema'));
      expect(eventIssue).toBeUndefined();
    });

    it('should flag complete artifact with empty content as error', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'index.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
        status: 'complete',
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Service',
        artifacts: [artifactId],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      expect(result.ok).toBe(false); // error sets ok=false
      expect(result.issues.length).toBeGreaterThan(0);

      const emptyIssue = result.issues.find(i => i.severity === 'error' && i.message.includes('empty content'));
      expect(emptyIssue).toBeDefined();
      expect(emptyIssue?.artifactId).toBe(artifactId);
      expect(emptyIssue?.pathHint).toBe('index.ts');
    });

    it('should allow draft artifact with empty content', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'index.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
        status: 'draft',
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Service',
        artifacts: [artifactId],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const emptyIssue = result.issues.find(i => i.message.includes('empty content'));
      expect(emptyIssue).toBeUndefined();
    });

    it('should set ok=false when any error severity issue exists', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Complete Service',
        status: 'complete',
        artifacts: [],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const errorIssue = result.issues.find(i => i.severity === 'error');
      expect(errorIssue).toBeDefined();
      expect(result.ok).toBe(false);
    });

    it('should set ok=true when only warnings exist', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'API',
      };

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Service',
        ports: [{
          id: portId,
          direction: 'in',
          name: 'HTTP In',
          contractId,
        }],
        artifacts: [],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const hasError = result.issues.some(i => i.severity === 'error');
      expect(hasError).toBe(false);
      expect(result.ok).toBe(true);
    });

    it('should flag complete node with no artifacts when required', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Complete Service',
        status: 'complete',
        artifacts: [],
      };

      const result = validateNodeArtifactsAgainstObligations(graph, nodeId);

      const artifactIssue = result.issues.find(
        i => i.severity === 'error' && i.message.includes('no artifacts')
      );
      expect(artifactIssue).toBeDefined();
      expect(result.ok).toBe(false);
    });
  });

  describe('validateAllArtifacts', () => {
    it('should validate all nodes and return results for those with issues', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const nodeId3 = generateUUID();

      graph.nodes[nodeId1] = {
        id: nodeId1,
        type: 'service',
        label: 'Service 1',
        status: 'complete',
        artifacts: [],
      };

      graph.nodes[nodeId2] = {
        id: nodeId2,
        type: 'service',
        label: 'Service 2',
      };

      const artifactId = generateUUID();
      graph.artifacts[artifactId] = {
        id: artifactId,
        nodeId: nodeId3,
        kind: 'source',
        path: 'index.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
        status: 'complete',
      };

      graph.nodes[nodeId3] = {
        id: nodeId3,
        type: 'service',
        label: 'Service 3',
        artifacts: [artifactId],
      };

      const results = validateAllArtifacts(graph);

      expect(results.has(nodeId1)).toBe(true); // has error
      expect(results.has(nodeId2)).toBe(false); // no issues
      expect(results.has(nodeId3)).toBe(true); // has error
    });

    it('should return empty map when no nodes have issues', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'index.ts',
        content: 'export default {}',
        contentHash: computeContentHash('export default {}'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Service',
        artifacts: [artifactId],
      };

      const results = validateAllArtifacts(graph);

      expect(results.size).toBe(0);
    });
  });
});
