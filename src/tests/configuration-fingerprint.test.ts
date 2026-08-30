// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID, now } from '@nodespec/core/utils.js';
import {
  computeConfigFingerprint,
  assessConfigStaleness,
  getConfigRelevantFields,
} from '@nodespec/core/configuration-fingerprint.js';
import type { NodeDomainMetadata } from '@nodespec/core/node-metadata.js';
import type { Node, Artifact } from '@nodespec/core/types.js';

function makeNode(overrides: Partial<Node> & { id: string; type: string; label: string }): Node {
  return { ...overrides };
}

function makeArtifact(overrides: Partial<Artifact> & { id: string; nodeId: string }): Artifact {
  return {
    kind: 'source',
    path: 'src/index.ts',
    createdAt: now(),
    updatedAt: now(),
    status: 'draft',
    ...overrides,
  };
}

describe('Configuration Fingerprint', () => {
  describe('N5.5: metadata.config moves the fingerprint (the live config representation)', () => {
    it('a config edit changes the fingerprint; identical config is stable', () => {
      const a = computeConfigFingerprint('backend-service', { config: { region: 'us-east-1' } });
      const b = computeConfigFingerprint('backend-service', { config: { region: 'eu-west-1' } });
      const a2 = computeConfigFingerprint('backend-service', { config: { region: 'us-east-1' } });
      expect(a.fingerprint).not.toBe(b.fingerprint);
      expect(a.fingerprint).toBe(a2.fingerprint);
      expect(a.fields['config.region']).toBe('us-east-1');
    });

    it('config composes with legacy domainMetadata fields (read-compat)', () => {
      const legacyOnly = computeConfigFingerprint('web.rest-api', {
        domainMetadata: { type: 'web-service', data: { language: 'go' } } as NodeDomainMetadata,
      });
      const both = computeConfigFingerprint('web.rest-api', {
        domainMetadata: { type: 'web-service', data: { language: 'go' } } as NodeDomainMetadata,
        config: { rateLimit: 100 },
      });
      expect(both.fingerprint).not.toBe(legacyOnly.fingerprint);
      expect(both.fields['config.rateLimit']).toBe(100);
    });
  });

  describe('getConfigRelevantFields', () => {
    it('extracts web-service fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          language: 'typescript',
          framework: 'express',
          port: 3000,
          baseUrl: '/api/v1',
          cors: true,
          rateLimit: 100,
          authStrategy: 'jwt',
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const fields = getConfigRelevantFields('web.rest-api', domainMetadata);

      expect(fields.language).toBe('typescript');
      expect(fields.framework).toBe('express');
      expect(fields.port).toBe(3000);
      expect(fields.baseUrl).toBe('/api/v1');
      expect(fields.cors).toBe(true);
      expect(fields.rateLimit).toBe(100);
      expect(fields.authStrategy).toBe('jwt');
      expect(fields).not.toHaveProperty('dependencies');
      expect(fields).not.toHaveProperty('envVars');
      expect(fields).not.toHaveProperty('apiRoutes');
    });

    it('extracts managed-service fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: 'aws',
          region: 'us-east-1',
          tier: 'production',
          version: '3.0',
          port: 443,
          configEntries: [{ key: 'apiType', value: 'REST' }],
          envVars: [],
        },
      };

      const fields = getConfigRelevantFields('gateway.aws-api-gateway', domainMetadata);

      expect(fields.provider).toBe('aws');
      expect(fields.region).toBe('us-east-1');
      expect(fields.tier).toBe('production');
      expect(fields.version).toBe('3.0');
      expect(fields.port).toBe(443);
      expect(fields).not.toHaveProperty('configEntries');
      expect(fields).not.toHaveProperty('envVars');
    });

    it('extracts frontend fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'frontend',
        data: {
          framework: 'react',
          language: 'typescript',
          buildTool: 'vite',
          deploymentType: 'spa',
          packageManager: 'npm',
          stateManagement: 'zustand',
          styling: 'tailwind',
          dependencies: [],
          envVars: [],
          pages: [],
          components: [],
          apiEndpoints: [],
        },
      };

      const fields = getConfigRelevantFields('frontend.react', domainMetadata);

      expect(fields.framework).toBe('react');
      expect(fields.language).toBe('typescript');
      expect(fields.buildTool).toBe('vite');
      expect(fields.deploymentType).toBe('spa');
      expect(fields.stateManagement).toBe('zustand');
      expect(fields.styling).toBe('tailwind');
      expect(fields).not.toHaveProperty('dependencies');
      expect(fields).not.toHaveProperty('pages');
    });

    it('extracts cache fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'cache',
        data: {
          cacheType: 'redis',
          host: 'localhost',
          port: 6379,
          ttl: 3600,
          evictionPolicy: 'lru',
          clusterMode: false,
          persistenceEnabled: true,
          keyPatterns: ['session:*'],
        },
      };

      const fields = getConfigRelevantFields('cache.redis', domainMetadata);

      expect(fields.cacheType).toBe('redis');
      expect(fields.host).toBe('localhost');
      expect(fields.port).toBe(6379);
      expect(fields.ttl).toBe(3600);
      expect(fields.evictionPolicy).toBe('lru');
      expect(fields.clusterMode).toBe(false);
      expect(fields.persistenceEnabled).toBe(true);
      expect(fields).not.toHaveProperty('keyPatterns');
    });

    it('extracts database fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'database',
        data: {
          dbType: 'postgres',
          host: 'localhost',
          port: 5432,
          database: 'myapp',
          version: '15',
          connectionPoolSize: 20,
          tables: [],
          migrations: [],
          indexes: [],
        },
      };

      const fields = getConfigRelevantFields('database.postgresql', domainMetadata);

      expect(fields.dbType).toBe('postgres');
      expect(fields.host).toBe('localhost');
      expect(fields.port).toBe(5432);
      expect(fields.database).toBe('myapp');
      expect(fields.connectionPoolSize).toBe(20);
      expect(fields).not.toHaveProperty('tables');
      expect(fields).not.toHaveProperty('migrations');
    });

    it('extracts message-queue fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'message-queue',
        data: {
          queueType: 'rabbitmq',
          host: 'localhost',
          port: 5672,
          queues: [{ name: 'tasks', durable: true }],
        },
      };

      const fields = getConfigRelevantFields('messaging.rabbitmq', domainMetadata);

      expect(fields.queueType).toBe('rabbitmq');
      expect(fields.host).toBe('localhost');
      expect(fields.port).toBe(5672);
      expect(fields).not.toHaveProperty('queues');
    });

    it('includes metadataSchema-defined fields from node type definition', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'message-queue',
        data: {
          queueType: 'rabbitmq',
          host: 'localhost',
          port: 5672,
          exchangeType: 'topic',
          queues: [],
        } as Record<string, unknown> as any,
      };

      const fields = getConfigRelevantFields('messaging.rabbitmq', domainMetadata);

      expect(fields.host).toBe('localhost');
      expect(fields.port).toBe(5672);
      expect(fields.exchangeType).toBe('topic');
    });

    it('includes defaultMetadata-defined fields from node type definition', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          language: 'typescript',
          port: 3000,
          baseUrl: '/api/v1',
          cors: true,
          rateLimit: 100,
          authStrategy: 'jwt',
          documentation: 'openapi',
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const fields = getConfigRelevantFields('web.rest-api', domainMetadata);

      expect(fields.documentation).toBe('openapi');
    });

    it('skips undefined fields', () => {
      const domainMetadata: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          language: 'typescript',
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const fields = getConfigRelevantFields('web.rest-api', domainMetadata);

      expect(fields.language).toBe('typescript');
      expect(fields).not.toHaveProperty('port');
      expect(fields).not.toHaveProperty('baseUrl');
    });
  });

  describe('computeConfigFingerprint', () => {
    it('produces a deterministic fingerprint for identical configs', () => {
      const metadata = {
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
      };

      const fp1 = computeConfigFingerprint('web.rest-api', metadata);
      const fp2 = computeConfigFingerprint('web.rest-api', metadata);

      expect(fp1.fingerprint).toBe(fp2.fingerprint);
      expect(fp1.fields).toEqual(fp2.fields);
    });

    it('produces different fingerprints for different configs', () => {
      const meta1 = {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            port: 3000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      };

      const meta2 = {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            port: 4000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      };

      const fp1 = computeConfigFingerprint('web.rest-api', meta1);
      const fp2 = computeConfigFingerprint('web.rest-api', meta2);

      expect(fp1.fingerprint).not.toBe(fp2.fingerprint);
    });

    it('returns empty fields fingerprint when no domainMetadata', () => {
      const fp = computeConfigFingerprint('web.rest-api', {});

      expect(fp.fields).toEqual({});
      expect(fp.fingerprint).toBeTruthy();
    });

    it('includes timestamp', () => {
      const metadata = {
        domainMetadata: {
          type: 'database',
          data: {
            dbType: 'postgres',
            port: 5432,
            tables: [],
            migrations: [],
            indexes: [],
          },
        },
      };

      const fp = computeConfigFingerprint('database.postgresql', metadata);

      expect(fp.timestamp).toBeTruthy();
      expect(new Date(fp.timestamp).getTime()).not.toBeNaN();
    });

    it('handles frontend node types', () => {
      const metadata = {
        domainMetadata: {
          type: 'frontend',
          data: {
            framework: 'vue',
            language: 'typescript',
            buildTool: 'vite',
            styling: 'tailwind',
            dependencies: [],
            envVars: [],
            pages: [],
            components: [],
            apiEndpoints: [],
          },
        },
      };

      const fp = computeConfigFingerprint('frontend.vue', metadata);

      expect(fp.fields.framework).toBe('vue');
      expect(fp.fields.styling).toBe('tailwind');
      expect(fp.fingerprint).toBeTruthy();
    });

    it('handles cache node types', () => {
      const metadata = {
        domainMetadata: {
          type: 'cache',
          data: {
            cacheType: 'redis',
            host: 'redis.local',
            port: 6379,
            ttl: 7200,
            evictionPolicy: 'lfu',
            keyPatterns: [],
          },
        },
      };

      const fp = computeConfigFingerprint('cache.redis', metadata);

      expect(fp.fields.cacheType).toBe('redis');
      expect(fp.fields.ttl).toBe(7200);
      expect(fp.fields.evictionPolicy).toBe('lfu');
    });

    it('handles managed-service node types', () => {
      const metadata = {
        domainMetadata: {
          type: 'managed-service',
          data: {
            provider: 'aws',
            region: 'eu-west-1',
            tier: 'standard',
            configEntries: [],
            envVars: [],
          },
        },
      };

      const fp = computeConfigFingerprint('gateway.aws-api-gateway', metadata);

      expect(fp.fields.provider).toBe('aws');
      expect(fp.fields.region).toBe('eu-west-1');
      expect(fp.fields.tier).toBe('standard');
    });
  });

  describe('assessConfigStaleness', () => {
    it('returns no_config when node has no domainMetadata', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        metadata: {},
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('no_config');
      expect(result.currentFingerprint).toBeNull();
      expect(result.lastArtifactFingerprint).toBeNull();
      expect(result.changedFields).toEqual([]);
    });

    it('returns no_config when metadata is undefined', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('no_config');
    });

    it('returns no_artifacts when node has config but no real artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              language: 'typescript',
              port: 3000,
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('no_artifacts');
      expect(result.currentFingerprint).not.toBeNull();
      expect(result.lastArtifactFingerprint).toBeNull();
    });

    it('returns no_artifacts when all artifacts are suggested', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      graph.artifacts[artifactId] = makeArtifact({
        id: artifactId,
        nodeId,
        status: 'suggested',
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [artifactId],
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              language: 'typescript',
              port: 3000,
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('no_artifacts');
    });

    it('returns config_ahead when artifacts exist but have no fingerprint', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      graph.artifacts[artifactId] = makeArtifact({
        id: artifactId,
        nodeId,
        status: 'draft',
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [artifactId],
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              language: 'typescript',
              port: 3000,
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('config_ahead');
      expect(result.changedFields.length).toBeGreaterThan(0);
      expect(result.message).toContain('before configuration tracking');
    });

    it('returns in_sync when current fingerprint matches artifact fingerprint', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const metadata = {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            port: 3000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      };

      const currentFp = computeConfigFingerprint('web.rest-api', metadata);

      graph.artifacts[artifactId] = makeArtifact({
        id: artifactId,
        nodeId,
        status: 'draft',
        metadata: {
          lastConfigFingerprint: currentFp,
        },
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [artifactId],
        metadata,
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('in_sync');
      expect(result.changedFields).toEqual([]);
      expect(result.message).toContain('matches');
    });

    it('returns config_ahead with changed fields when config differs from artifact', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const oldFp = computeConfigFingerprint('web.rest-api', {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            port: 3000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      });

      graph.artifacts[artifactId] = makeArtifact({
        id: artifactId,
        nodeId,
        status: 'draft',
        metadata: {
          lastConfigFingerprint: oldFp,
        },
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [artifactId],
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              language: 'typescript',
              port: 4000,
              baseUrl: '/api/v2',
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('config_ahead');
      expect(result.changedFields).toContain('port');
      expect(result.changedFields).toContain('baseUrl');
      expect(result.message).toContain('port');
      expect(result.message).toContain('baseUrl');
    });

    it('detects field removal as a change', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const oldFp = computeConfigFingerprint('web.rest-api', {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            port: 3000,
            cors: true,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      });

      graph.artifacts[artifactId] = makeArtifact({
        id: artifactId,
        nodeId,
        status: 'draft',
        metadata: { lastConfigFingerprint: oldFp },
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [artifactId],
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              language: 'typescript',
              port: 3000,
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('config_ahead');
      expect(result.changedFields).toContain('cors');
    });

    it('picks the most recent artifact fingerprint when multiple exist', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const art1Id = generateUUID();
      const art2Id = generateUUID();

      const oldFp = computeConfigFingerprint('web.rest-api', {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'python',
            port: 8000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      });
      oldFp.timestamp = '2024-01-01T00:00:00.000Z';

      const currentMeta = {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            port: 3000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      };

      const newerFp = computeConfigFingerprint('web.rest-api', currentMeta);
      newerFp.timestamp = '2025-06-01T00:00:00.000Z';

      graph.artifacts[art1Id] = makeArtifact({
        id: art1Id,
        nodeId,
        status: 'draft',
        metadata: { lastConfigFingerprint: oldFp },
      });

      graph.artifacts[art2Id] = makeArtifact({
        id: art2Id,
        nodeId,
        status: 'complete',
        metadata: { lastConfigFingerprint: newerFp },
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [art1Id, art2Id],
        metadata: currentMeta,
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('in_sync');
      expect(result.lastArtifactFingerprint?.timestamp).toBe('2025-06-01T00:00:00.000Z');
    });

    it('handles database node staleness assessment', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'database.postgresql',
        label: 'Main DB',
        metadata: {
          domainMetadata: {
            type: 'database',
            data: {
              dbType: 'postgres',
              host: 'db.example.com',
              port: 5432,
              database: 'production',
              tables: [],
              migrations: [],
              indexes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('no_artifacts');
      expect(result.currentFingerprint!.fields.dbType).toBe('postgres');
      expect(result.currentFingerprint!.fields.host).toBe('db.example.com');
    });

    it('handles managed-service node staleness assessment', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const metadata = {
        domainMetadata: {
          type: 'managed-service',
          data: {
            provider: 'aws',
            region: 'us-west-2',
            tier: 'premium',
            configEntries: [],
            envVars: [],
          },
        },
      };

      const fp = computeConfigFingerprint('gateway.aws-api-gateway', metadata);

      graph.artifacts[artifactId] = makeArtifact({
        id: artifactId,
        nodeId,
        status: 'draft',
        metadata: {
          lastConfigFingerprint: {
            ...fp,
            fields: { ...fp.fields, region: 'us-east-1' },
            fingerprint: 'different-hash',
          },
        },
      });

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'gateway.aws-api-gateway',
        label: 'API GW',
        artifacts: [artifactId],
        metadata,
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('config_ahead');
      expect(result.changedFields).toContain('region');
    });

    it('ignores artifacts not in the graph', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const missingArtifactId = generateUUID();

      graph.nodes[nodeId] = makeNode({
        id: nodeId,
        type: 'web.rest-api',
        label: 'API',
        artifacts: [missingArtifactId],
        metadata: {
          domainMetadata: {
            type: 'web-service',
            data: {
              language: 'typescript',
              port: 3000,
              dependencies: [],
              envVars: [],
              apiRoutes: [],
            },
          },
        },
      });

      const result = assessConfigStaleness(graph.nodes[nodeId], graph);

      expect(result.status).toBe('no_artifacts');
    });
  });
});
