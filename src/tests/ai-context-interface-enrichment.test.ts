import { describe, it, expect } from 'vitest';
import { buildArtifactContext, formatArtifactContextForAI } from '@nodespec/core/ai-context.js';
import type { Graph } from '@nodespec/core/types.js';

describe('AI Context - Interface Enrichment Integration', () => {
  it('should include REST API enrichment in artifact context', async () => {
    const graph: Graph = {
      id: 'test-graph',
      schemaVersion: 2,
      version: 0,
      hash: 'test-hash',
      nodes: {
        'api-1': {
          id: 'api-1',
          type: 'web.rest-api',
          label: 'My REST API',
          status: 'draft',
          ports: [],
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
        },
      },
      edges: {},
      artifacts: {
        'artifact-1': {
          id: 'artifact-1',
          nodeId: 'api-1',
          path: 'src/routes/users.ts',
          kind: 'source',
          status: 'draft',
          content: '// Route handler',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      contracts: {},
    };

    const context = await buildArtifactContext(graph, 'artifact-1');
    expect(context).toBeTruthy();

    if (context) {
      const formatted = formatArtifactContextForAI(context);

      // Should include interface technology context
      expect(formatted).toContain('Interface Technology Context');

      // Should include file types
      expect(formatted).toContain('Expected File Types');
      expect(formatted).toContain('.yaml');
      expect(formatted).toContain('OpenAPI/Swagger');

      // Should include TypeScript client libraries
      expect(formatted).toContain('TypeScript Client Libraries');
      expect(formatted).toContain('Axios');

      // Should include authentication strategies
      expect(formatted).toContain('Authentication Strategies');
      expect(formatted).toContain('JWT');

      // Should include configuration best practices
      expect(formatted).toContain('Configuration Best Practices');
      expect(formatted).toContain('Rate Limiting');

      // Should include critical security features
      expect(formatted).toContain('Critical Security Features');
      expect(formatted).toContain('Input Validation');

      // Should include performance tips
      expect(formatted).toContain('Performance Tips');
      expect(formatted).toContain('caching');

      // Should include deployment options
      expect(formatted).toContain('Deployment Options');
    }
  });

  it('should include GraphQL enrichment with language-specific libraries', async () => {
    const graph: Graph = {
      id: 'test-graph',
      schemaVersion: 2,
      version: 0,
      hash: 'test-hash',
      nodes: {
        'gql-1': {
          id: 'gql-1',
          type: 'web.graphql-api',
          label: 'GraphQL API',
          status: 'draft',
          ports: [],
          metadata: {
            domainMetadata: {
              type: 'web-service',
              data: {
                language: 'python',
                framework: 'graphene',
                port: 4000,
                dependencies: [],
                envVars: [],
                apiRoutes: [],
              },
            },
          },
        },
      },
      edges: {},
      artifacts: {
        'artifact-1': {
          id: 'artifact-1',
          nodeId: 'gql-1',
          path: 'schema.graphql',
          kind: 'schema',
          status: 'draft',
          content: 'type Query { hello: String }',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      contracts: {},
    };

    const context = await buildArtifactContext(graph, 'artifact-1');
    if (context) {
      const formatted = formatArtifactContextForAI(context);

      // Should include Python client libraries for GraphQL
      expect(formatted).toContain('Python Client Libraries');
      expect(formatted).toContain('gql');

      // Should include GraphQL-specific features
      expect(formatted).toContain('.graphql/.gql');
      expect(formatted).toContain('Query Complexity');
    }
  });

  it('should include WebSocket enrichment with realtime features', async () => {
    const graph: Graph = {
      id: 'test-graph',
      schemaVersion: 2,
      version: 0,
      hash: 'test-hash',
      nodes: {
        'ws-1': {
          id: 'ws-1',
          type: 'web.websocket-server',
          label: 'WebSocket Server',
          status: 'draft',
          ports: [],
        },
      },
      edges: {},
      artifacts: {
        'artifact-1': {
          id: 'artifact-1',
          nodeId: 'ws-1',
          path: 'src/websocket/server.ts',
          kind: 'source',
          status: 'draft',
          content: '// WebSocket server',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      contracts: {},
    };

    const context = await buildArtifactContext(graph, 'artifact-1');
    if (context) {
      const formatted = formatArtifactContextForAI(context);

      // Should include WebSocket-specific patterns
      expect(formatted).toContain('Heartbeat/Ping-Pong');
      expect(formatted).toContain('Interface Technology Context');
    }
  });

  it('should include API Gateway enrichment with cloud-specific features', async () => {
    const graph: Graph = {
      id: 'test-graph',
      schemaVersion: 2,
      version: 0,
      hash: 'test-hash',
      nodes: {
        'gateway-1': {
          id: 'gateway-1',
          type: 'gateway.aws-api-gateway',
          label: 'AWS API Gateway',
          status: 'draft',
          ports: [],
        },
      },
      edges: {},
      artifacts: {
        'artifact-1': {
          id: 'artifact-1',
          nodeId: 'gateway-1',
          path: 'api-definition.yaml',
          kind: 'schema',
          status: 'draft',
          content: 'openapi: 3.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      contracts: {},
    };

    const context = await buildArtifactContext(graph, 'artifact-1');
    if (context) {
      const formatted = formatArtifactContextForAI(context);

      // Should include AWS-specific features
      expect(formatted).toContain('Usage Plans');
      expect(formatted).toContain('Lambda Authorizers');
      expect(formatted).toContain('Interface Technology Context');
    }
  });

  it('should include Service Mesh enrichment with K8s features', async () => {
    const graph: Graph = {
      id: 'test-graph',
      schemaVersion: 2,
      version: 0,
      hash: 'test-hash',
      nodes: {
        'mesh-1': {
          id: 'mesh-1',
          type: 'mesh.istio',
          label: 'Istio Service Mesh',
          status: 'draft',
          ports: [],
        },
      },
      edges: {},
      artifacts: {
        'artifact-1': {
          id: 'artifact-1',
          nodeId: 'mesh-1',
          path: 'virtualservice.yaml',
          kind: 'config',
          status: 'draft',
          content: 'apiVersion: networking.istio.io/v1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      contracts: {},
    };

    const context = await buildArtifactContext(graph, 'artifact-1');
    if (context) {
      const formatted = formatArtifactContextForAI(context);

      // Should include Istio-specific features
      expect(formatted).toContain('VirtualService');
      expect(formatted).toContain('mTLS');
      expect(formatted).toContain('Interface Technology Context');
    }
  });
});
