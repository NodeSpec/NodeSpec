import { describe, it, expect } from 'vitest';
import {
  extractNodeDomainMetadata,
  getMetadataDefaults,
  getMetadataTypeForNodeType,
  createDefaultMetadataForNodeType,
  type NodeDomainMetadata,
  type FrontendMetadata,
  type WebServiceMetadata,
  type DatabaseMetadata,
  type ManagedServiceMetadata,
} from '@nodespec/core/node-metadata.js';
import { formatNodeMetadataForAI, formatArtifactContextForAI, buildArtifactContext } from '@nodespec/core/ai-context.js';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import type { Graph, Node } from '@nodespec/core/types.js';
import { createAddNodePatch, createUpdateNodePatch } from '@nodespec/core/patch-factory.js';

describe('Metadata Integration', () => {
  describe('Metadata Helpers', () => {
    it('should extract frontend metadata from node', () => {
      const nodeMetadata = {
        domainMetadata: {
          type: 'frontend',
          data: {
            framework: 'react',
            language: 'typescript',
            deploymentType: 'spa',
            dependencies: [],
            envVars: [],
            pages: [],
            components: [],
            apiEndpoints: [],
          },
        },
      };

      const extracted = extractNodeDomainMetadata(nodeMetadata);
      expect(extracted).not.toBeNull();
      expect(extracted?.type).toBe('frontend');
      if (extracted?.type === 'frontend') {
        expect(extracted.data.framework).toBe('react');
        expect(extracted.data.language).toBe('typescript');
      }
    });

    it('should extract managed-service metadata from node', () => {
      const nodeMetadata = {
        domainMetadata: {
          type: 'managed-service',
          data: {
            provider: 'AWS',
            region: 'us-east-1',
            configEntries: [],
            envVars: [],
          },
        },
      };

      const extracted = extractNodeDomainMetadata(nodeMetadata);
      expect(extracted).not.toBeNull();
      expect(extracted?.type).toBe('managed-service');
    });

    it('should return null for invalid metadata', () => {
      expect(extractNodeDomainMetadata(undefined)).toBeNull();
      expect(extractNodeDomainMetadata({})).toBeNull();
      expect(extractNodeDomainMetadata({ domainMetadata: null })).toBeNull();
      expect(extractNodeDomainMetadata({ domainMetadata: { type: 'invalid' } })).toBeNull();
    });

    it('should get correct metadata type for node type', () => {
      expect(getMetadataTypeForNodeType('web.frontend-spa')).toBe('frontend');
      expect(getMetadataTypeForNodeType('web.rest-api')).toBe('web-service');
      expect(getMetadataTypeForNodeType('web.database')).toBe('database');
      expect(getMetadataTypeForNodeType('web.cache')).toBe('cache');
      expect(getMetadataTypeForNodeType('web.auth-service')).toBe('auth-service');
      expect(getMetadataTypeForNodeType('messaging.rabbitmq')).toBe('message-queue');
      expect(getMetadataTypeForNodeType('gateway.aws-api-gateway')).toBe('managed-service');
      expect(getMetadataTypeForNodeType('lb.aws-alb')).toBe('managed-service');
      expect(getMetadataTypeForNodeType('mesh.istio')).toBe('managed-service');
      expect(getMetadataTypeForNodeType('unknown')).toBeNull();
    });

    it('should provide defaults for all metadata types', () => {
      const frontendDefaults = getMetadataDefaults('frontend');
      expect(frontendDefaults).toHaveProperty('framework');
      expect(frontendDefaults).toHaveProperty('language');
      expect(frontendDefaults).toHaveProperty('buildTool');

      const webServiceDefaults = getMetadataDefaults('web-service');
      expect(webServiceDefaults).toHaveProperty('runtime');
      expect(webServiceDefaults).toHaveProperty('framework');

      const databaseDefaults = getMetadataDefaults('database');
      expect(databaseDefaults).toHaveProperty('dbType');

      const authDefaults = getMetadataDefaults('auth-service');
      expect(authDefaults).toHaveProperty('provider');

      const cacheDefaults = getMetadataDefaults('cache');
      expect(cacheDefaults).toHaveProperty('cacheType');

      const mqDefaults = getMetadataDefaults('message-queue');
      expect(mqDefaults).toHaveProperty('queueType');

      const managedDefaults = getMetadataDefaults('managed-service');
      expect(managedDefaults).toHaveProperty('provider');
    });

    it('should create default metadata for node types', () => {
      const frontendMeta = createDefaultMetadataForNodeType('web.frontend-spa');
      expect(frontendMeta).not.toBeNull();
      expect(frontendMeta?.type).toBe('frontend');

      const webServiceMeta = createDefaultMetadataForNodeType('web.rest-api');
      expect(webServiceMeta).not.toBeNull();
      expect(webServiceMeta?.type).toBe('web-service');

      const gatewayMeta = createDefaultMetadataForNodeType('gateway.aws-api-gateway');
      expect(gatewayMeta).not.toBeNull();
      expect(gatewayMeta?.type).toBe('managed-service');

      const unknownMeta = createDefaultMetadataForNodeType('unknown');
      expect(unknownMeta).toBeNull();
    });
  });

  describe('AI Context Formatting', () => {
    it('should format frontend metadata for AI', () => {
      const node: Node = {
        id: 'node-1',
        type: 'web.frontend-spa',
        label: 'My App',
        metadata: {
          domainMetadata: {
            type: 'frontend',
            data: {
              framework: 'react',
              language: 'typescript',
              buildTool: 'vite',
              deploymentType: 'spa',
              stateManagement: 'zustand',
              styling: 'tailwind',
              dependencies: [],
              envVars: [],
              pages: [],
              components: [],
              apiEndpoints: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const formatted = formatNodeMetadataForAI(node);
      expect(formatted).toContain('Technology Stack');
      expect(formatted).toContain('Framework: react');
      expect(formatted).toContain('Language: typescript');
      expect(formatted).toContain('Build Tool: vite');
      expect(formatted).toContain('Deployment: SPA');
      expect(formatted).toContain('State Management: zustand');
      expect(formatted).toContain('Styling: tailwind');
    });

    it('should format web-service metadata for AI', () => {
      const node: Node = {
        id: 'node-1',
        type: 'web.rest-api',
        label: 'API Server',
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              runtime: 'node',
              framework: 'express',
              version: '4.18.0',
              port: 3000,
              authStrategy: 'jwt',
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const formatted = formatNodeMetadataForAI(node);
      expect(formatted).toContain('Technology Stack');
      expect(formatted).toContain('Runtime: node');
      expect(formatted).toContain('Framework: express 4.18.0');
      expect(formatted).toContain('Port: 3000');
      expect(formatted).toContain('Auth Strategy: jwt');
    });

    it('should format database metadata for AI', () => {
      const node: Node = {
        id: 'node-1',
        type: 'web.database',
        label: 'Database',
        metadata: {
          domainMetadata: {
            type: 'database',
            data: {
              dbType: 'postgres',
              version: '15.2',
              port: 5432,
              tables: [{ name: 'users', columns: [], primaryKey: [] }],
              migrations: [],
              indexes: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const formatted = formatNodeMetadataForAI(node);
      expect(formatted).toContain('Technology Stack');
      expect(formatted).toContain('Database Type: postgres');
      expect(formatted).toContain('Version: 15.2');
      expect(formatted).toContain('Port: 5432');
      expect(formatted).toContain('Tables: users');
    });

    it('should format managed-service metadata for AI', () => {
      const node: Node = {
        id: 'node-1',
        type: 'gateway.aws-api-gateway',
        label: 'AWS API Gateway',
        metadata: {
          domainMetadata: {
            type: 'managed-service',
            data: {
              provider: 'AWS',
              region: 'us-east-1',
              tier: 'production',
              version: 'v2',
              configEntries: [
                { key: 'stage', value: 'prod', sensitive: false },
              ],
              envVars: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const formatted = formatNodeMetadataForAI(node);
      expect(formatted).toContain('Technology Stack');
      expect(formatted).toContain('Provider: AWS');
      expect(formatted).toContain('Region: us-east-1');
      expect(formatted).toContain('Tier: production');
      expect(formatted).toContain('Managed Infrastructure Service');
      expect(formatted).toContain('stage=prod');
    });

    it('should return empty string for node without metadata', () => {
      const node: Node = {
        id: 'node-1',
        type: 'web.frontend-spa',
        label: 'My App',
      };

      const formatted = formatNodeMetadataForAI(node);
      expect(formatted).toBe('');
    });

    it('should include metadata in artifact context', async () => {
      const graph: Graph = {
        id: 'graph-1',
        schemaVersion: 2,
        version: 1,
        hash: 'hash1',
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'web.frontend-spa',
            label: 'Frontend',
            metadata: {
              domainMetadata: {
                type: 'frontend',
                data: {
                  framework: 'react',
                  language: 'typescript',
                  dependencies: [],
                  envVars: [],
                  pages: [],
                  components: [],
                  apiEndpoints: [],
                },
              } as NodeDomainMetadata,
            },
          },
        },
        edges: {},
        contracts: {},
        artifacts: {
          'artifact-1': {
            id: 'artifact-1',
            nodeId: 'node-1',
            kind: 'source',
            path: 'src/App.tsx',
            content: 'export default function App() {}',
            contentHash: 'hash1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      };

      const context = await buildArtifactContext(graph, 'artifact-1');
      expect(context).not.toBeNull();

      if (context) {
        const formatted = formatArtifactContextForAI(context);
        expect(formatted).toContain('Context for src/App.tsx');
        expect(formatted).toContain('Technology Stack');
        expect(formatted).toContain('Framework: react');
        expect(formatted).toContain('Language: typescript');
      }
    });
  });

  describe('Metadata Persistence', () => {
    it.skip('should persist metadata when adding node', () => {
      const graph: Graph = {
        id: 'graph-1',
        schemaVersion: 2,
        version: 0,
        hash: 'initial',
        nodes: {},
        edges: {},
        contracts: {},
        artifacts: {},
      };

      const nodeMetadata: NodeDomainMetadata = {
        type: 'frontend',
        data: {
          framework: 'react',
          language: 'typescript',
          dependencies: [],
          envVars: [],
          pages: [],
          components: [],
          apiEndpoints: [],
        },
      };

      const node: Node = {
        id: 'node-1',
        type: 'web.frontend-spa',
        label: 'Frontend',
        metadata: { domainMetadata: nodeMetadata },
      };

      const patch = createAddNodePatch(node, {
        actorType: 'human',
        summary: 'Add frontend node with metadata',
      });

      const result = applyPatch(graph, patch);
      if (!result.success) {
        console.error('Add node patch failed:', result.error);
      }
      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();

      const addedNode = result.graph!.nodes['node-1'];
      expect(addedNode).toBeDefined();
      expect(addedNode.metadata).toBeDefined();
      expect(addedNode.metadata?.domainMetadata).toBeDefined();

      const extracted = extractNodeDomainMetadata(addedNode.metadata);
      expect(extracted).not.toBeNull();
      expect(extracted?.type).toBe('frontend');
    });

    it.skip('should update metadata through patch', () => {
      const graph: Graph = {
        id: 'graph-1',
        schemaVersion: 2,
        version: 0,
        hash: 'initial',
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'web.frontend-spa',
            label: 'Frontend',
            metadata: {
              domainMetadata: {
                type: 'frontend',
                data: {
                  framework: 'react',
                  language: 'typescript',
                  dependencies: [],
                  envVars: [],
                  pages: [],
                  components: [],
                  apiEndpoints: [],
                },
              } as NodeDomainMetadata,
            },
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
      };

      const updatedMetadata: NodeDomainMetadata = {
        type: 'frontend',
        data: {
          framework: 'vue',
          language: 'typescript',
          buildTool: 'vite',
          dependencies: [],
          envVars: [],
          pages: [],
          components: [],
          apiEndpoints: [],
        },
      };

      const patch = createUpdateNodePatch('node-1', {
        metadata: {
          domainMetadata: updatedMetadata,
        },
      }, {
        actorType: 'human',
        summary: 'Update node metadata',
      });

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();

      const updatedNode = result.graph!.nodes['node-1'];
      const extracted = extractNodeDomainMetadata(updatedNode.metadata);
      expect(extracted).not.toBeNull();
      expect(extracted?.type).toBe('frontend');
      if (extracted?.type === 'frontend') {
        expect(extracted.data.framework).toBe('vue');
        expect(extracted.data.buildTool).toBe('vite');
      }
    });

    it.skip('should handle metadata for all domain types', () => {
      const graph: Graph = {
        id: 'graph-1',
        schemaVersion: 2,
        version: 0,
        hash: 'initial',
        nodes: {},
        edges: {},
        contracts: {},
        artifacts: {},
      };

      const domainTypes: Array<{ nodeType: string; metadataType: string }> = [
        { nodeType: 'web.frontend-spa', metadataType: 'frontend' },
        { nodeType: 'web.rest-api', metadataType: 'web-service' },
        { nodeType: 'web.database', metadataType: 'database' },
        { nodeType: 'web.auth-service', metadataType: 'auth-service' },
        { nodeType: 'web.cache', metadataType: 'cache' },
        { nodeType: 'messaging.rabbitmq', metadataType: 'message-queue' },
        { nodeType: 'gateway.aws-api-gateway', metadataType: 'managed-service' },
      ];

      for (const { nodeType, metadataType } of domainTypes) {
        const defaultMeta = createDefaultMetadataForNodeType(nodeType);
        expect(defaultMeta).not.toBeNull();
        expect(defaultMeta?.type).toBe(metadataType);

        const nodeId = `node-${metadataType}`;
        const node: Node = {
          id: nodeId,
          type: nodeType,
          label: `Test ${metadataType}`,
          metadata: { domainMetadata: defaultMeta },
        };

        const patch = createAddNodePatch(node, {
          actorType: 'human',
          summary: `Add ${metadataType} node`,
        });

        const result = applyPatch(graph, patch);
        expect(result.success).toBe(true);

        const addedNode = result.graph!.nodes[nodeId];
        const extracted = extractNodeDomainMetadata(addedNode.metadata);
        expect(extracted).not.toBeNull();
        expect(extracted?.type).toBe(metadataType);

        graph.nodes = result.graph!.nodes;
      }
    });
  });

  describe('Metadata Type Safety', () => {
    it('should validate metadata structure through TypeScript types', () => {
      const frontendMeta: FrontendMetadata = {
        framework: 'react',
        language: 'typescript',
        dependencies: [],
        envVars: [],
        pages: [],
        components: [],
        apiEndpoints: [],
      };

      expect(frontendMeta.framework).toBe('react');

      const webServiceMeta: WebServiceMetadata = {
        dependencies: [],
        envVars: [],
        apiRoutes: [],
      };

      expect(webServiceMeta.dependencies).toEqual([]);

      const databaseMeta: DatabaseMetadata = {
        dbType: 'postgres',
        tables: [],
        migrations: [],
        indexes: [],
      };

      expect(databaseMeta.dbType).toBe('postgres');

      const managedServiceMeta: ManagedServiceMetadata = {
        provider: 'AWS',
        configEntries: [],
        envVars: [],
      };

      expect(managedServiceMeta.provider).toBe('AWS');
    });
  });
});
