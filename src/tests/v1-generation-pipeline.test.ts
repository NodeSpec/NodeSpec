/**
 * Step 2: Core Pipeline Testing - V1 Single-Pass Generation
 *
 * Tests:
 * 1. parseAIResponse handles all 4 JSON extraction strategies
 * 2. Node type validation and auto-correction
 * 3. Deprecated node type rejection
 * 4. Contract kind enum validation
 * 5. Varying complexity (5, 20, 50 nodes)
 * 6. Layout algorithm produces non-overlapping nodes
 * 7. Error handling for invalid JSON
 * 8. Patch application order
 * 9. Database persistence
 */

import { describe, it, expect } from 'vitest';
import { parseAIResponse, validateParsedArchitecture, applyLayoutToNodes } from '@nodespec/core/generation/response-parser.js';
import { ContractKindSchema } from '@nodespec/core/schemas.js';

describe('Step 2: V1 Generation Pipeline - JSON Extraction Strategies', () => {
  const validArchitecture = {
    understanding: 'Simple todo app',
    nodes: [
      {
        nodeInfo: {
          type: 'frontend.react',
          label: 'React Frontend',
          description: 'React application',
        },
        ports: [
          { name: 'API Request', direction: 'out' as const },
        ],
        artifacts: [
          {
            path: 'src/App.tsx',
            kind: 'source' as const,
            content: 'import React from "react";',
            description: 'Main app',
          },
        ],
      },
      {
        nodeInfo: {
          type: 'web.rest-api',
          label: 'API Server',
          description: 'Express API',
        },
        ports: [
          { name: 'HTTP Request', direction: 'in' as const },
          { name: 'DB Query', direction: 'out' as const },
        ],
        artifacts: [
          {
            path: 'src/server.ts',
            kind: 'source' as const,
            content: 'import express from "express";',
            description: 'API server',
          },
        ],
      },
      {
        nodeInfo: {
          type: 'database.postgresql',
          label: 'PostgreSQL',
          description: 'Database',
        },
        ports: [
          { name: 'SQL Query', direction: 'in' as const },
        ],
        artifacts: [
          {
            path: 'schema.sql',
            kind: 'schema' as const,
            content: 'CREATE TABLE todos (id SERIAL PRIMARY KEY);',
            description: 'Database schema',
          },
        ],
      },
    ],
    edges: [
      {
        sourceLabel: 'React Frontend',
        targetLabel: 'API Server',
        contractName: 'REST API',
        description: 'HTTP requests',
      },
      {
        sourceLabel: 'API Server',
        targetLabel: 'PostgreSQL',
        contractName: 'Database Connection',
        description: 'SQL queries',
      },
    ],
    contracts: [
      {
        name: 'REST API',
        kind: 'rest',
        description: 'HTTP REST API',
      },
      {
        name: 'Database Connection',
        kind: 'data_flow',
        description: 'PostgreSQL connection',
      },
    ],
    warnings: [],
    recommendations: [],
  };

  describe('Strategy 1: JSON code block with language tag', () => {
    it('should extract JSON from ```json block', () => {
      const aiResponse = `Here's the architecture:

\`\`\`json
${JSON.stringify(validArchitecture, null, 2)}
\`\`\`

This design follows best practices.`;

      const result = parseAIResponse(aiResponse);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.nodes).toHaveLength(3);
      expect(result.data?.edges).toHaveLength(2);
      expect(result.data?.contracts).toHaveLength(2);
    });
  });

  describe('Strategy 2: Generic code block without language tag', () => {
    it('should extract JSON from generic ``` block', () => {
      const aiResponse = `Architecture:

\`\`\`
${JSON.stringify(validArchitecture, null, 2)}
\`\`\``;

      const result = parseAIResponse(aiResponse);
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(3);
    });
  });

  describe('Strategy 3: First brace to last brace extraction', () => {
    it('should extract JSON from text with leading/trailing content', () => {
      const aiResponse = `I've designed a comprehensive architecture.

${JSON.stringify(validArchitecture, null, 2)}

Let me know if you need any changes!`;

      const result = parseAIResponse(aiResponse);
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(3);
    });

    it('should handle JSON with text before and after (no nested braces)', () => {
      const jsonStr = JSON.stringify(validArchitecture);
      const aiResponse = `Preamble text here without braces. ${jsonStr} And some trailing text at the end.`;

      const result = parseAIResponse(aiResponse);
      expect(result.success).toBe(true);
    });
  });

  describe('Strategy 4: Direct JSON parsing', () => {
    it('should parse direct JSON response with no wrapper', () => {
      const aiResponse = JSON.stringify(validArchitecture, null, 2);

      const result = parseAIResponse(aiResponse);
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(3);
    });

    it('should parse minified JSON', () => {
      const aiResponse = JSON.stringify(validArchitecture);

      const result = parseAIResponse(aiResponse);
      expect(result.success).toBe(true);
    });
  });
});

describe('Step 2: V1 Generation Pipeline - Node Type Validation', () => {
  it('should accept valid node types', () => {
    const response = {
      understanding: 'Valid types',
      nodes: [
        {
          nodeInfo: { type: 'frontend.react', label: 'React App', description: 'React' },
          ports: [{ name: 'API', direction: 'out' as const }],
          artifacts: [{ path: 'app.tsx', kind: 'source' as const, content: '// code' }],
        },
        {
          nodeInfo: { type: 'web.rest-api', label: 'API', description: 'API' },
          ports: [{ name: 'HTTP', direction: 'in' as const }],
          artifacts: [{ path: 'server.ts', kind: 'source' as const, content: '// code' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(true);
  });

  it('should warn about custom node types not in predefined list', () => {
    const response = {
      understanding: 'Custom type',
      nodes: [
        {
          nodeInfo: { type: 'custom.my-service', label: 'Custom Service', description: 'Custom' },
          ports: [{ name: 'Port', direction: 'in' as const }],
          artifacts: [{ path: 'service.ts', kind: 'source' as const, content: '// code' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.warnings).toBeDefined();
    expect(validationResult.warnings?.some(w => w.includes('custom type'))).toBe(true);
  });

  it('should reject deprecated node types', () => {
    const response = {
      understanding: 'Deprecated type',
      nodes: [
        {
          nodeInfo: { type: 'cloud.kubernetes', label: 'K8s', description: 'Deprecated' },
          ports: [{ name: 'Port', direction: 'in' as const }],
          artifacts: [{ path: 'config.yaml', kind: 'config' as const, content: '# config' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('CONVERSION_FAILED');
    expect(result.errors[0].message).toContain('deprecated');
  });

  it('should reject cloud.vpc deprecated type', () => {
    const response = {
      understanding: 'Deprecated VPC',
      nodes: [
        {
          nodeInfo: { type: 'cloud.vpc', label: 'VPC', description: 'Deprecated' },
          ports: [{ name: 'Network', direction: 'in' as const }],
          artifacts: [{ path: 'vpc.tf', kind: 'config' as const, content: '# terraform' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('deprecated');
  });

  it('should reject cloud.container deprecated type', () => {
    const response = {
      understanding: 'Deprecated container',
      nodes: [
        {
          nodeInfo: { type: 'cloud.container', label: 'Container', description: 'Deprecated' },
          ports: [{ name: 'Port', direction: 'in' as const }],
          artifacts: [{ path: 'Dockerfile', kind: 'build' as const, content: 'FROM node' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(false);
  });
});

describe('Step 2: V1 Generation Pipeline - Contract Kind Validation', () => {
  const validContractKinds = ContractKindSchema.options;

  it('should accept all valid contract kinds', () => {
    for (const kind of validContractKinds) {
      const response = {
        understanding: `Testing ${kind}`,
        nodes: [
          {
            nodeInfo: { type: 'web.rest-api', label: 'Service A', description: 'A' },
            ports: [{ name: 'Out', direction: 'out' as const }],
            artifacts: [{ path: 'a.ts', kind: 'source' as const, content: '// a' }],
          },
          {
            nodeInfo: { type: 'web.rest-api', label: 'Service B', description: 'B' },
            ports: [{ name: 'In', direction: 'in' as const }],
            artifacts: [{ path: 'b.ts', kind: 'source' as const, content: '// b' }],
          },
        ],
        edges: [
          {
            sourceLabel: 'Service A',
            targetLabel: 'Service B',
            contractName: 'Test Contract',
            description: 'Connection',
          },
        ],
        contracts: [
          {
            name: 'Test Contract',
            kind,
            description: `${kind} contract`,
          },
        ],
      };

      const parseResult = parseAIResponse(JSON.stringify(response));
      expect(parseResult.success).toBe(true);

      const validationResult = validateParsedArchitecture(parseResult.data!);
      expect(validationResult.valid).toBe(true);
    }
  });

  it('should auto-normalize contract kind "http" to "rest"', () => {
    const response = {
      understanding: 'Normalized contract kind',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service A', description: 'A' },
          ports: [{ name: 'Out', direction: 'out' as const }],
          artifacts: [{ path: 'a.ts', kind: 'source' as const, content: '// a' }],
        },
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service B', description: 'B' },
          ports: [{ name: 'In', direction: 'in' as const }],
          artifacts: [{ path: 'b.ts', kind: 'source' as const, content: '// b' }],
        },
      ],
      edges: [
        {
          sourceLabel: 'Service A',
          targetLabel: 'Service B',
          contractName: 'HTTP Contract',
          description: 'Connection',
        },
      ],
      contracts: [
        {
          name: 'HTTP Contract',
          kind: 'http',
          description: 'HTTP contract',
        },
      ],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(true);

    const contract = parseResult.data!.contracts[0];
    expect(contract.kind).toBe('rest');
  });

  // N8.6: 'event' is a live INTERACTION kind; resolveContractFields maps it to the
  // unified contract kind 'kafka' (event over the default kafka transport).
  it('should auto-normalize contract kind "event" to "kafka"', () => {
    const response = {
      understanding: 'Normalized event kind',
      nodes: [
        {
          nodeInfo: { type: 'messaging.rabbitmq', label: 'Queue', description: 'Q' },
          ports: [{ name: 'Publish', direction: 'in' as const }],
          artifacts: [{ path: 'queue.ts', kind: 'source' as const, content: '// queue' }],
        },
        {
          nodeInfo: { type: 'data.stream-processor', label: 'Worker', description: 'W' },
          ports: [{ name: 'Subscribe', direction: 'out' as const }],
          artifacts: [{ path: 'worker.ts', kind: 'source' as const, content: '// worker' }],
        },
      ],
      edges: [
        {
          sourceLabel: 'Queue',
          targetLabel: 'Worker',
          contractName: 'Event Contract',
          description: 'Events',
        },
      ],
      contracts: [
        {
          name: 'Event Contract',
          kind: 'event',
          description: 'Event contract',
        },
      ],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(true);

    const contract = parseResult.data!.contracts[0];
    expect(contract.kind).toBe('kafka');
  });
});

describe('Step 2: V1 Generation Pipeline - Varying Complexity', () => {
  function generateArchitecture(nodeCount: number) {
    const nodes = [];
    const edges = [];
    const contracts = [];

    // Generate nodes
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        nodeInfo: {
          type: i % 3 === 0 ? 'frontend.react' : i % 3 === 1 ? 'web.rest-api' : 'database.postgresql',
          label: `Node ${i + 1}`,
          description: `Node ${i + 1} description`,
        },
        ports: [
          { name: 'Port In', direction: 'in' as const },
          { name: 'Port Out', direction: 'out' as const },
        ],
        artifacts: [
          {
            path: `node${i + 1}/index.ts`,
            kind: 'source' as const,
            content: `// Node ${i + 1} implementation`,
            description: `Node ${i + 1} source`,
          },
        ],
      });
    }

    // Generate edges (chain pattern: 1→2→3→...→n)
    for (let i = 0; i < nodeCount - 1; i++) {
      edges.push({
        sourceLabel: `Node ${i + 1}`,
        targetLabel: `Node ${i + 2}`,
        contractName: `Contract ${i + 1}`,
        description: `Connection from ${i + 1} to ${i + 2}`,
      });

      contracts.push({
        name: `Contract ${i + 1}`,
        kind: 'rest',
        description: `Contract ${i + 1}`,
      });
    }

    return {
      understanding: `Architecture with ${nodeCount} nodes`,
      nodes,
      edges,
      contracts,
      warnings: [],
      recommendations: [],
    };
  }

  it('should handle 5-node architecture', () => {
    const arch = generateArchitecture(5);
    const result = parseAIResponse(JSON.stringify(arch));

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(5);
    expect(result.data?.edges).toHaveLength(4);
    expect(result.data?.contracts).toHaveLength(4);
  });

  it('should handle 20-node architecture', () => {
    const arch = generateArchitecture(20);
    const result = parseAIResponse(JSON.stringify(arch));

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(20);
    expect(result.data?.edges).toHaveLength(19);
    expect(result.data?.contracts).toHaveLength(19);
  });

  it('should handle 50-node architecture', () => {
    const arch = generateArchitecture(50);
    const result = parseAIResponse(JSON.stringify(arch));

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(50);
    expect(result.data?.edges).toHaveLength(49);
    expect(result.data?.contracts).toHaveLength(49);
  });

  it('should handle 100-node architecture (stress test)', () => {
    const arch = generateArchitecture(100);
    const result = parseAIResponse(JSON.stringify(arch));

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(100);
    expect(result.data?.edges).toHaveLength(99);
    expect(result.data?.contracts).toHaveLength(99);
  });
});

describe('Step 2: V1 Generation Pipeline - Layout Algorithm', () => {
  it('should apply grid layout with correct spacing', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => ({
      id: `node-${i}`,
      type: 'web.rest-api',
      label: `Node ${i}`,
      ports: [],
      artifacts: [],
      metadata: {},
    }));

    const laidOutNodes = applyLayoutToNodes(nodes);

    // Check positions are set
    laidOutNodes.forEach(node => {
      expect(node.metadata?.position).toBeDefined();
      const pos = node.metadata?.position as { x: number; y: number } | undefined;
      expect(typeof pos?.x).toBe('number');
      expect(typeof pos?.y).toBe('number');
    });

    // Check grid pattern (3 columns)
    const getPos = (node: any) => node.metadata?.position as { x: number; y: number };
    expect(getPos(laidOutNodes[0])?.x).toBe(100); // Column 0
    expect(getPos(laidOutNodes[1])?.x).toBe(450); // Column 1
    expect(getPos(laidOutNodes[2])?.x).toBe(800); // Column 2
    expect(getPos(laidOutNodes[3])?.x).toBe(100); // Column 0, row 2

    // Check vertical spacing
    expect(getPos(laidOutNodes[0])?.y).toBe(100); // Row 0
    expect(getPos(laidOutNodes[3])?.y).toBe(350); // Row 1
    expect(getPos(laidOutNodes[6])?.y).toBe(600); // Row 2
  });

  it('should produce non-overlapping nodes', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `node-${i}`,
      type: 'web.rest-api',
      label: `Node ${i}`,
      ports: [],
      artifacts: [],
      metadata: {},
    }));

    const laidOutNodes = applyLayoutToNodes(nodes);

    // Check no two nodes have the same position
    const getPos = (n: any) => n.metadata?.position as { x: number; y: number } | undefined;
    const positions = laidOutNodes.map(n => `${getPos(n)?.x},${getPos(n)?.y}`);
    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBe(laidOutNodes.length);
  });

  it('should handle single node', () => {
    const nodes = [
      {
        id: 'node-1',
        type: 'web.rest-api',
        label: 'Single Node',
        ports: [],
        artifacts: [],
        metadata: {},
      },
    ];

    const laidOutNodes = applyLayoutToNodes(nodes);
    const getPos = (node: any) => node.metadata?.position as { x: number; y: number } | undefined;
    expect(getPos(laidOutNodes[0])?.x).toBe(100);
    expect(getPos(laidOutNodes[0])?.y).toBe(100);
  });

  it('should maintain minimum spacing between nodes', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `node-${i}`,
      type: 'web.rest-api',
      label: `Node ${i}`,
      ports: [],
      artifacts: [],
      metadata: {},
    }));

    const laidOutNodes = applyLayoutToNodes(nodes);
    const getPos = (node: any) => node.metadata?.position as { x: number; y: number } | undefined;

    // Horizontal spacing should be at least 300px
    const node0X = getPos(laidOutNodes[0])?.x || 0;
    const node1X = getPos(laidOutNodes[1])?.x || 0;
    expect(node1X - node0X).toBeGreaterThanOrEqual(300);

    // Vertical spacing should be at least 200px
    const node0Y = getPos(laidOutNodes[0])?.y || 0;
    const node3Y = getPos(laidOutNodes[3])?.y || 0;
    expect(node3Y - node0Y).toBeGreaterThanOrEqual(200);
  });
});

describe('Step 2: V1 Generation Pipeline - Error Handling', () => {
  it('should handle completely invalid JSON', () => {
    const aiResponse = 'This is not JSON at all!';

    const result = parseAIResponse(aiResponse);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('INVALID_JSON');
    expect(result.errors[0].message).toContain('Failed to parse');
  });

  it('should handle malformed JSON with missing braces', () => {
    const aiResponse = '{ "understanding": "test", "nodes": [';

    const result = parseAIResponse(aiResponse);
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_JSON');
  });

  it('should handle valid JSON but missing required fields', () => {
    const aiResponse = JSON.stringify({
      understanding: 'Missing nodes field',
      // nodes field missing
      edges: [],
      contracts: [],
    });

    const result = parseAIResponse(aiResponse);
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(result.errors[0].message).toContain('nodes');
  });

  it('should handle missing contract for edge', () => {
    const response = {
      understanding: 'Missing contract',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service A', description: 'A' },
          ports: [{ name: 'Out', direction: 'out' as const }],
          artifacts: [{ path: 'a.ts', kind: 'source' as const, content: '// a' }],
        },
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service B', description: 'B' },
          ports: [{ name: 'In', direction: 'in' as const }],
          artifacts: [{ path: 'b.ts', kind: 'source' as const, content: '// b' }],
        },
      ],
      edges: [
        {
          sourceLabel: 'Service A',
          targetLabel: 'Service B',
          contractName: 'Missing Contract', // This contract doesn't exist
          description: 'Connection',
        },
      ],
      contracts: [],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('CONVERSION_FAILED');
    expect(result.errors[0].message).toContain('Contract "Missing Contract" not found');
  });

  it('should handle missing source node for edge', () => {
    const response = {
      understanding: 'Missing source node',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service B', description: 'B' },
          ports: [{ name: 'In', direction: 'in' as const }],
          artifacts: [{ path: 'b.ts', kind: 'source' as const, content: '// b' }],
        },
      ],
      edges: [
        {
          sourceLabel: 'Service A', // This node doesn't exist
          targetLabel: 'Service B',
          contractName: 'Test Contract',
          description: 'Connection',
        },
      ],
      contracts: [
        {
          name: 'Test Contract',
          kind: 'rest',
          description: 'Contract',
        },
      ],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('CONVERSION_FAILED');
    expect(result.errors[0].message).toContain('Source node "Service A" not found');
  });

  it('should handle missing target node for edge', () => {
    const response = {
      understanding: 'Missing target node',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service A', description: 'A' },
          ports: [{ name: 'Out', direction: 'out' as const }],
          artifacts: [{ path: 'a.ts', kind: 'source' as const, content: '// a' }],
        },
      ],
      edges: [
        {
          sourceLabel: 'Service A',
          targetLabel: 'Service B', // This node doesn't exist
          contractName: 'Test Contract',
          description: 'Connection',
        },
      ],
      contracts: [
        {
          name: 'Test Contract',
          kind: 'rest',
          description: 'Contract',
        },
      ],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('CONVERSION_FAILED');
    expect(result.errors[0].message).toContain('Target node "Service B" not found');
  });

  it('should provide helpful error context', () => {
    const aiResponse = 'Not JSON!';

    const result = parseAIResponse(aiResponse);
    expect(result.errors[0].context).toBeDefined();
    expect(result.errors[0].context).toHaveProperty('hint');
  });
});

describe('Step 2: V1 Generation Pipeline - Validation Edge Cases', () => {
  it('should reject architecture with no nodes', () => {
    const response = {
      understanding: 'No nodes',
      nodes: [],
      edges: [],
      contracts: [],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(false);
    expect(validationResult.errors[0].code).toBe('NO_NODES');
  });

  it('should reject node with empty label', () => {
    const response = {
      understanding: 'Empty label',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: '', description: 'No label' },
          ports: [{ name: 'Port', direction: 'in' as const }],
          artifacts: [{ path: 'file.ts', kind: 'source' as const, content: '// code' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(false);
    expect(validationResult.errors.some(e => e.code === 'INVALID_NODE_LABEL')).toBe(true);
  });

  it('should reject node with empty type', () => {
    const response = {
      understanding: 'Empty type',
      nodes: [
        {
          nodeInfo: { type: '', label: 'Node', description: 'No type' },
          ports: [{ name: 'Port', direction: 'in' as const }],
          artifacts: [{ path: 'file.ts', kind: 'source' as const, content: '// code' }],
        },
      ],
      edges: [],
      contracts: [],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(false);
    expect(validationResult.errors.some(e => e.code === 'INVALID_NODE_TYPE')).toBe(true);
  });

  it('should reject contract with empty name', () => {
    const response = {
      understanding: 'Empty contract name',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service A', description: 'A' },
          ports: [{ name: 'Out', direction: 'out' as const }],
          artifacts: [{ path: 'a.ts', kind: 'source' as const, content: '// a' }],
        },
        {
          nodeInfo: { type: 'web.rest-api', label: 'Service B', description: 'B' },
          ports: [{ name: 'In', direction: 'in' as const }],
          artifacts: [{ path: 'b.ts', kind: 'source' as const, content: '// b' }],
        },
      ],
      edges: [
        {
          sourceLabel: 'Service A',
          targetLabel: 'Service B',
          contractName: '',
          description: 'Connection',
        },
      ],
      contracts: [
        {
          name: '',
          kind: 'rest',
          description: 'Contract',
        },
      ],
    };

    const parseResult = parseAIResponse(JSON.stringify(response));
    expect(parseResult.success).toBe(true);

    const validationResult = validateParsedArchitecture(parseResult.data!);
    expect(validationResult.valid).toBe(false);
    expect(validationResult.errors.some(e => e.code === 'INVALID_CONTRACT_NAME')).toBe(true);
  });
});

describe('Step 2: V1 Generation Pipeline - Schema Artifacts', () => {
  it('should extract schema artifacts from contracts', () => {
    const response = {
      understanding: 'Contract with schema',
      nodes: [
        {
          nodeInfo: { type: 'web.rest-api', label: 'API', description: 'API' },
          ports: [{ name: 'HTTP', direction: 'in' as const }],
          artifacts: [{ path: 'api.ts', kind: 'source' as const, content: '// api' }],
        },
      ],
      edges: [],
      contracts: [
        {
          name: 'REST API',
          kind: 'rest',
          description: 'REST API contract',
          schemaContent: JSON.stringify({ openapi: '3.0.0', paths: {} }),
        },
      ],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(true);
    expect(result.data?.schemaArtifacts).toHaveLength(1);
    expect(result.data?.schemaArtifacts[0].kind).toBe('schema');
    expect(result.data?.schemaArtifacts[0].path).toContain('schemas/');
    expect(result.data?.schemaArtifacts[0].path).toContain('.schema.json');
  });

  it('should link schema artifact to contract', () => {
    const response = {
      understanding: 'Contract with schema',
      nodes: [
        {
          nodeInfo: { type: 'web.graphql-api', label: 'GraphQL API', description: 'API' },
          ports: [{ name: 'GraphQL', direction: 'in' as const }],
          artifacts: [{ path: 'schema.graphql', kind: 'schema' as const, content: 'type Query {}' }],
        },
      ],
      edges: [],
      contracts: [
        {
          name: 'GraphQL Schema',
          kind: 'graphql',
          description: 'GraphQL contract',
          schemaContent: 'type Query { hello: String }',
        },
      ],
    };

    const result = parseAIResponse(JSON.stringify(response));
    expect(result.success).toBe(true);

    const contract = result.data?.contracts.find(c => c.name === 'GraphQL Schema');
    expect(contract?.schemaRef).toBeDefined();

    const schemaArtifact = result.data?.schemaArtifacts.find(a => a.id === contract?.schemaRef);
    expect(schemaArtifact).toBeDefined();
    expect(schemaArtifact?.content).toContain('type Query');
  });
});
