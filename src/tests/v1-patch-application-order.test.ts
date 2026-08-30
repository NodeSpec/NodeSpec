/**
 * Step 2: Patch Application Order Testing
 *
 * Verifies that patches are applied in correct order:
 * 1. Schema artifacts (contract schemas)
 * 2. Contracts
 * 3. Nodes
 * 4. Node artifacts
 * 5. Edges
 */

import { describe, it, expect } from 'vitest';
import { Graph } from '@nodespec/core/types.js';
import { generateUUID, now } from '@nodespec/core/utils.js';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import { parseAIResponse } from '@nodespec/core/generation/response-parser.js';
import type { PatchOperation } from '@nodespec/core/types.js';

describe('Step 2: Patch Application Order', () => {
  function createEmptyGraph(): Graph {
    return {
      id: generateUUID(),
      schemaVersion: 2,
      version: 0,
      hash: '',
      nodes: {},
      edges: {},
      contracts: {},
      artifacts: {},
      metadata: {},
    };
  }

  function createPatchMetadata(summary: string) {
    return {
      id: generateUUID(),
      actorType: 'ai' as const,
      summary,
      timestamp: now(),
    };
  }

  it('should apply schema artifacts before contracts', () => {
    const graph = createEmptyGraph();
    const schemaId = generateUUID();
    const contractId = generateUUID();

    // Create schema artifact patch
    const schemaPatch: PatchOperation = {
      type: 'add_artifact',
      metadata: createPatchMetadata('Add contract schema'),
      payload: {
        id: schemaId,
        nodeId: '', // Global schema artifact
        kind: 'schema',
        path: 'schemas/api-contract.schema.json',
        content: JSON.stringify({ openapi: '3.0.0' }),
        contentHash: 'hash123',
        createdAt: now(),
        updatedAt: now(),
        metadata: { contractId },
        status: 'draft',
      },
    };

    // Create contract patch that references the schema
    const contractPatch: PatchOperation = {
      type: 'add_contract',
      metadata: createPatchMetadata('Add contract'),
      payload: {
        id: contractId,
        name: 'API Contract',
        kind: 'rest',
        schemaRef: schemaId, // References schema artifact
        metadata: {},
      },
    };

    // Apply in correct order: schema first, then contract
    let result = applyPatch(graph, schemaPatch);
    expect(result.success).toBe(true);
    if (!result.graph) throw new Error('Graph should be defined');
    expect(result.graph.artifacts[schemaId]).toBeDefined();

    result = applyPatch(result.graph, contractPatch);
    expect(result.success).toBe(true);
    if (!result.graph) throw new Error('Graph should be defined');
    expect(result.graph.contracts[contractId]).toBeDefined();
    expect(result.graph.contracts[contractId].schemaRef).toBe(schemaId);
  });

  it('should apply contracts before nodes', () => {
    const graph = createEmptyGraph();
    const contractId = generateUUID();
    const nodeId = generateUUID();

    // Create contract first
    const contractPatch: PatchOperation = {
      type: 'add_contract',
      metadata: createPatchMetadata('Add contract'),
      payload: {
        id: contractId,
        name: 'Database Contract',
        kind: 'sql',
        metadata: {},
      },
    };

    let result = applyPatch(graph, contractPatch);
    expect(result.success).toBe(true);
    if (!result.graph) throw new Error('Graph should be defined');

    // Then create node that might use this contract in ports
    const nodePatch: PatchOperation = {
      type: 'add_node',
      metadata: createPatchMetadata('Add node'),
      payload: {
        id: nodeId,
        type: 'database.postgresql',
        label: 'Database',
        ports: [
          {
            id: generateUUID(),
            name: 'SQL Query',
            direction: 'in',
            contractId, // References contract
          },
        ],
        metadata: {},
      },
    };

    result = applyPatch(result.graph, nodePatch);
    expect(result.success).toBe(true);
    if (!result.graph) throw new Error('Graph should be defined');
    expect(result.graph.nodes[nodeId]).toBeDefined();
  });

  it('should apply nodes before node artifacts', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const artifactId = generateUUID();

    // Create node first (without artifact reference)
    const nodePatch: PatchOperation = {
      type: 'add_node',
      metadata: createPatchMetadata('Add node'),
      payload: {
        id: nodeId,
        type: 'web.rest-api',
        label: 'API Server',
        ports: [],
        artifacts: [], // Empty initially - we'll add artifacts separately
        metadata: {},
      },
    };

    let result = applyPatch(graph, nodePatch);
    expect(result.success).toBe(true);

    // Then add artifact that belongs to this node
    const artifactPatch: PatchOperation = {
      type: 'add_artifact',
      metadata: createPatchMetadata('Add artifact'),
      payload: {
        id: artifactId,
        nodeId, // References node
        kind: 'source',
        path: 'src/server.ts',
        content: 'import express from "express";',
        contentHash: 'hash456',
        createdAt: now(),
        updatedAt: now(),
        metadata: {},
        status: 'draft',
      },
    };

    result = applyPatch(result.graph!, artifactPatch);
    expect(result.success).toBe(true);
    expect(result.graph!.artifacts[artifactId]).toBeDefined();
    expect(result.graph!.artifacts[artifactId].nodeId).toBe(nodeId);

    // Now link artifact to node
    const updatePatch: PatchOperation = {
      type: 'update_node',
      metadata: createPatchMetadata('Link artifact'),
      payload: {
        id: nodeId,
        changes: {
          artifacts: [artifactId],
        },
      },
    };
    result = applyPatch(result.graph!, updatePatch);
    expect(result.success).toBe(true);
    expect(result.graph!.nodes[nodeId].artifacts).toContain(artifactId);
  });

  it('should apply nodes before edges', () => {
    const graph = createEmptyGraph();
    const node1Id = generateUUID();
    const node2Id = generateUUID();
    const contractId = generateUUID();
    const edgeId = generateUUID();

    // Create contract
    let result = applyPatch(graph, {
      type: 'add_contract',
      metadata: createPatchMetadata('Add contract'),
      payload: {
        id: contractId,
        name: 'Connection',
        kind: 'rest',
        metadata: {},
      },
    });

    // Create source node
    if (!result.graph) throw new Error('Graph should be defined');
    result = applyPatch(result.graph, {
      type: 'add_node',
      metadata: createPatchMetadata('Add source node'),
      payload: {
        id: node1Id,
        type: 'frontend.react',
        label: 'Frontend',
        ports: [
          {
            id: generateUUID(),
            name: 'API Request',
            direction: 'out',
          },
        ],
        metadata: {},
      },
    });

    // Create target node
    if (!result.graph) throw new Error('Graph should be defined');
    result = applyPatch(result.graph, {
      type: 'add_node',
      metadata: createPatchMetadata('Add target node'),
      payload: {
        id: node2Id,
        type: 'web.rest-api',
        label: 'Backend',
        ports: [
          {
            id: generateUUID(),
            name: 'HTTP Request',
            direction: 'in',
          },
        ],
        metadata: {},
      },
    });

    // Finally create edge connecting the nodes
    const edgePatch: PatchOperation = {
      type: 'add_edge',
      metadata: createPatchMetadata('Add edge'),
      payload: {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        contractId,
        metadata: {},
      },
    };

    if (!result.graph) throw new Error('Graph should be defined');
    result = applyPatch(result.graph, edgePatch);
    expect(result.success).toBe(true);
    if (!result.graph) throw new Error('Graph should be defined');
    expect(result.graph.edges[edgeId]).toBeDefined();
    expect(result.graph.edges[edgeId].source).toBe(node1Id);
    expect(result.graph.edges[edgeId].target).toBe(node2Id);
  });

  it('should handle full AI generation patch sequence', () => {
    // Generate a simple architecture via AI response parsing
    const aiResponse = {
      understanding: 'Simple API',
      nodes: [
        {
          nodeInfo: {
            type: 'web.rest-api',
            label: 'API Server',
            description: 'REST API',
          },
          ports: [
            { name: 'HTTP Request', direction: 'in' as const },
            { name: 'DB Query', direction: 'out' as const },
          ],
          artifacts: [
            {
              path: 'src/server.ts',
              kind: 'source' as const,
              content: 'import express from "express";\nconst app = express();',
              description: 'API server',
            },
            {
              path: 'package.json',
              kind: 'config' as const,
              content: '{"dependencies": {"express": "^4.18.0"}}',
              description: 'Dependencies',
            },
          ],
        },
        {
          nodeInfo: {
            type: 'database.postgresql',
            label: 'Database',
            description: 'PostgreSQL',
          },
          ports: [
            { name: 'SQL Query', direction: 'in' as const },
          ],
          artifacts: [
            {
              path: 'schema.sql',
              kind: 'schema' as const,
              content: 'CREATE TABLE users (id SERIAL PRIMARY KEY);',
              description: 'DB schema',
            },
          ],
        },
      ],
      edges: [
        {
          sourceLabel: 'API Server',
          targetLabel: 'Database',
          contractName: 'Database Connection',
          description: 'SQL queries',
        },
      ],
      contracts: [
        {
          name: 'Database Connection',
          kind: 'sql',
          description: 'PostgreSQL connection',
          schemaContent: JSON.stringify({
            type: 'database',
            protocol: 'postgresql',
          }),
        },
      ],
    };

    const parseResult = parseAIResponse(JSON.stringify(aiResponse));
    expect(parseResult.success).toBe(true);

    const parsed = parseResult.data!;

    // Verify structure
    expect(parsed.schemaArtifacts.length).toBeGreaterThan(0);
    expect(parsed.contracts.length).toBe(1);
    expect(parsed.nodes.length).toBe(2);
    expect(parsed.edges.length).toBe(1);

    // Now simulate applying patches in correct order
    let graph = createEmptyGraph();

    // Step 1: Apply schema artifacts
    for (const schemaArtifact of parsed.schemaArtifacts) {
      const patch: PatchOperation = {
        type: 'add_artifact',
        metadata: createPatchMetadata('Add schema artifact'),
        payload: schemaArtifact,
      };
      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      if (!result.graph) throw new Error('Graph should be defined');
      graph = result.graph;
    }

    // Step 2: Apply contracts
    for (const contract of parsed.contracts) {
      const patch: PatchOperation = {
        type: 'add_contract',
        metadata: createPatchMetadata('Add contract'),
        payload: contract,
      };
      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      if (!result.graph) throw new Error('Graph should be defined');
      graph = result.graph;
    }

    // Step 3: Apply nodes (without artifacts initially)
    for (const { node } of parsed.nodes) {
      const patch: PatchOperation = {
        type: 'add_node',
        metadata: createPatchMetadata(`Add node: ${node.label}`),
        payload: {
          ...node,
          artifacts: [], // Don't reference artifacts yet - we'll add them in Step 4
        },
      };
      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      if (!result.graph) throw new Error('Graph should be defined');
      graph = result.graph;
    }

    // Step 4: Apply node artifacts
    for (const { node, artifacts } of parsed.nodes) {
      for (const artifact of artifacts) {
        const patch: PatchOperation = {
          type: 'add_artifact',
          metadata: createPatchMetadata('Add node artifact'),
          payload: artifact,
        };
        const result = applyPatch(graph, patch);
        expect(result.success).toBe(true);
        if (!result.graph) throw new Error('Graph should be defined');
        graph = result.graph;

        // Also update node to reference this artifact
        const updatePatch: PatchOperation = {
          type: 'update_node',
          metadata: createPatchMetadata('Link artifact to node'),
          payload: {
            id: node.id,
            changes: {
              artifacts: [...(graph.nodes[node.id].artifacts || []), artifact.id],
            },
          },
        };
        const updateResult = applyPatch(graph, updatePatch);
        expect(updateResult.success).toBe(true);
        if (!updateResult.graph) throw new Error('Graph should be defined');
        graph = updateResult.graph;
      }
    }

    // Step 5: Apply edges
    for (const edge of parsed.edges) {
      const patch: PatchOperation = {
        type: 'add_edge',
        metadata: createPatchMetadata('Add edge'),
        payload: edge,
      };
      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      if (!result.graph) throw new Error('Graph should be defined');
      graph = result.graph;
    }

    // Verify final graph state
    expect(Object.keys(graph.nodes).length).toBe(2);
    expect(Object.keys(graph.edges).length).toBe(1);
    expect(Object.keys(graph.contracts).length).toBe(1);
    expect(Object.keys(graph.artifacts).length).toBeGreaterThan(2); // schema + node artifacts
  });

  it('should fail if trying to add edge before nodes exist', () => {
    const graph = createEmptyGraph();
    const contractId = generateUUID();

    // Add contract first
    let result = applyPatch(graph, {
      type: 'add_contract',
      metadata: createPatchMetadata('Add contract'),
      payload: {
        id: contractId,
        name: 'Connection',
        kind: 'rest',
        metadata: {},
      },
    });
    expect(result.success).toBe(true);
    if (!result.graph) throw new Error('Graph should be defined');

    // Try to add edge without creating nodes first
    const edgePatch: PatchOperation = {
      type: 'add_edge',
      metadata: createPatchMetadata('Add edge'),
      payload: {
        id: generateUUID(),
        source: generateUUID(), // Non-existent node
        target: generateUUID(), // Non-existent node
        contractId,
        metadata: {},
      },
    };

    result = applyPatch(result.graph, edgePatch);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Source node');
  });

  it('should fail if trying to add artifact before node exists', () => {
    const graph = createEmptyGraph();
    const nonExistentNodeId = generateUUID();

    const artifactPatch: PatchOperation = {
      type: 'add_artifact',
      metadata: createPatchMetadata('Add artifact'),
      payload: {
        id: generateUUID(),
        nodeId: nonExistentNodeId, // Node doesn't exist
        kind: 'source',
        path: 'file.ts',
        content: '// code',
        contentHash: 'hash',
        createdAt: now(),
        updatedAt: now(),
        metadata: {},
        status: 'draft',
      },
    };

    const result = applyPatch(graph, artifactPatch);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Node');
  });
});

describe('Step 2: Correct Patch Order from ParsedArchitecture', () => {
  it('should provide patches in correct order', () => {
    const aiResponse = {
      understanding: 'Full stack app',
      nodes: [
        {
          nodeInfo: { type: 'frontend.react', label: 'Frontend', description: 'React app' },
          ports: [{ name: 'API', direction: 'out' as const }],
          artifacts: [
            { path: 'App.tsx', kind: 'source' as const, content: '// react' },
          ],
        },
        {
          nodeInfo: { type: 'web.rest-api', label: 'API', description: 'Backend' },
          ports: [
            { name: 'HTTP', direction: 'in' as const },
            { name: 'DB', direction: 'out' as const },
          ],
          artifacts: [
            { path: 'server.ts', kind: 'source' as const, content: '// api' },
          ],
        },
        {
          nodeInfo: { type: 'database.postgresql', label: 'DB', description: 'Database' },
          ports: [{ name: 'SQL', direction: 'in' as const }],
          artifacts: [
            { path: 'schema.sql', kind: 'schema' as const, content: 'CREATE TABLE...' },
          ],
        },
      ],
      edges: [
        {
          sourceLabel: 'Frontend',
          targetLabel: 'API',
          contractName: 'REST',
          description: 'HTTP',
        },
        {
          sourceLabel: 'API',
          targetLabel: 'DB',
          contractName: 'SQL',
          description: 'SQL',
        },
      ],
      contracts: [
        {
          name: 'REST',
          kind: 'rest',
          description: 'REST API',
          schemaContent: '{"openapi": "3.0.0"}',
        },
        {
          name: 'SQL',
          kind: 'sql',
          description: 'Database',
        },
      ],
    };

    const parseResult = parseAIResponse(JSON.stringify(aiResponse));
    expect(parseResult.success).toBe(true);

    const { schemaArtifacts, contracts, nodes, edges } = parseResult.data!;

    // Verify order markers
    expect(schemaArtifacts).toBeDefined();
    expect(contracts).toBeDefined();
    expect(nodes).toBeDefined();
    expect(edges).toBeDefined();

    // Count total artifacts
    const totalNodeArtifacts = nodes.reduce((sum, { artifacts }) => sum + artifacts.length, 0);
    expect(totalNodeArtifacts).toBe(3); // One per node

    // Verify schema artifacts are separate
    expect(schemaArtifacts.length).toBe(1); // One contract has schemaContent
    expect(schemaArtifacts[0].kind).toBe('schema');
    expect(schemaArtifacts[0].nodeId).toBe(''); // Global schema artifact
  });
});
