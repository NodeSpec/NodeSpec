// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { generateConfigArtifactPlaceholders } from '@nodespec/core/templates.js';
import { getArtifactPlaceholdersForNode } from '@nodespec/core/templates.js';
import type { NodeDomainMetadata } from '@nodespec/core/node-metadata.js';
import type { Node } from '@nodespec/core/types.js';

describe('generateConfigArtifactPlaceholders', () => {
  describe('web-service', () => {
    it('generates server config when baseUrl is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          language: 'typescript',
          baseUrl: '/api',
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('web.rest-api', meta);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('config');
      expect(result[0].suggestedPath).toBe('config/server.config.ts');
      expect(result[0].description).toContain('Server configuration');
    });

    it('generates server config when port is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          language: 'python',
          port: 8000,
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('web.rest-api', meta);

      expect(result).toHaveLength(1);
      expect(result[0].suggestedPath).toBe('config/server.config.py');
      expect(result[0].language).toBe('python');
    });

    it('uses correct extension for each language', () => {
      const languages = [
        { lang: 'go', ext: '.go' },
        { lang: 'rust', ext: '.rs' },
        { lang: 'java', ext: '.java' },
        { lang: 'csharp', ext: '.cs' },
        { lang: 'ruby', ext: '.rb' },
        { lang: 'php', ext: '.php' },
      ] as const;

      for (const { lang, ext } of languages) {
        const meta: NodeDomainMetadata = {
          type: 'web-service',
          data: {
            language: lang,
            port: 3000,
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          } as any,
        };

        const result = generateConfigArtifactPlaceholders('web.rest-api', meta);
        expect(result[0].suggestedPath).toBe(`config/server.config${ext}`);
      }
    });

    it('generates config when cors is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          cors: true,
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('web.rest-api', meta);
      expect(result).toHaveLength(1);
    });

    it('generates config when rateLimit is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          rateLimit: 100,
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('web.rest-api', meta);
      expect(result).toHaveLength(1);
    });

    it('generates config when authStrategy is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          authStrategy: 'jwt',
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('web.rest-api', meta);
      expect(result).toHaveLength(1);
    });

    it('returns empty when no config fields are set', () => {
      const meta: NodeDomainMetadata = {
        type: 'web-service',
        data: {
          language: 'typescript',
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('web.rest-api', meta);
      expect(result).toHaveLength(0);
    });
  });

  describe('managed-service', () => {
    it('generates infrastructure config when provider is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: 'aws',
          region: 'us-east-1',
          configEntries: [],
          envVars: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('gateway.aws-api-gateway', meta);

      expect(result.length).toBeGreaterThanOrEqual(1);
      const configArtifact = result.find(p => p.kind === 'config');
      expect(configArtifact).toBeDefined();
      expect(configArtifact!.suggestedPath).toContain('infrastructure/');
      expect(configArtifact!.description).toContain('aws');
    });

    it('generates schema artifact for AWS provider', () => {
      const meta: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: 'aws',
          configEntries: [],
          envVars: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('gateway.aws-api-gateway', meta);

      const schemaArtifact = result.find(p => p.kind === 'schema');
      expect(schemaArtifact).toBeDefined();
      expect(schemaArtifact!.suggestedPath).toContain('.schema.json');
    });

    it('generates schema artifact for Azure provider', () => {
      const meta: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: 'azure',
          configEntries: [],
          envVars: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('gateway.azure-api-management', meta);

      const schemaArtifact = result.find(p => p.kind === 'schema');
      expect(schemaArtifact).toBeDefined();
    });

    it('generates schema artifact for GCP provider', () => {
      const meta: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: 'gcp',
          configEntries: [],
          envVars: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('gateway.aws-api-gateway', meta);

      const schemaArtifact = result.find(p => p.kind === 'schema');
      expect(schemaArtifact).toBeDefined();
    });

    it('does not generate schema artifact for non-cloud providers', () => {
      const meta: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: 'custom',
          configEntries: [],
          envVars: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('gateway.aws-api-gateway', meta);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('config');
    });

    it('returns empty when no provider is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'managed-service',
        data: {
          provider: '',
          configEntries: [],
          envVars: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('gateway.aws-api-gateway', meta);
      expect(result).toHaveLength(0);
    });
  });

  describe('database', () => {
    it('generates database config when host is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'database',
        data: {
          dbType: 'postgres',
          host: 'localhost',
          tables: [],
          migrations: [],
          indexes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('database.postgresql', meta);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('config');
      expect(result[0].suggestedPath).toBe('config/database.config.ts');
    });

    it('generates database config when port is set', () => {
      const meta: NodeDomainMetadata = {
        type: 'database',
        data: {
          dbType: 'postgres',
          port: 5432,
          tables: [],
          migrations: [],
          indexes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('database.postgresql', meta);
      expect(result).toHaveLength(1);
    });

    it('returns empty when neither host nor port set', () => {
      const meta: NodeDomainMetadata = {
        type: 'database',
        data: {
          dbType: 'postgres',
          tables: [],
          migrations: [],
          indexes: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('database.postgresql', meta);
      expect(result).toHaveLength(0);
    });
  });

  describe('cache', () => {
    it('generates cache config', () => {
      const meta: NodeDomainMetadata = {
        type: 'cache',
        data: {
          cacheType: 'redis',
          host: 'localhost',
          port: 6379,
          keyPatterns: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('cache.redis', meta);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('config');
      expect(result[0].suggestedPath).toBe('config/cache.config.ts');
    });

    it('uses language-specific extension for cache config', () => {
      const meta: NodeDomainMetadata = {
        type: 'cache',
        data: {
          cacheType: 'redis',
          language: 'python',
          keyPatterns: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('cache.redis', meta);

      expect(result[0].suggestedPath).toBe('config/cache.config.py');
      expect(result[0].language).toBe('python');
    });
  });

  describe('message-queue', () => {
    it('generates queue config', () => {
      const meta: NodeDomainMetadata = {
        type: 'message-queue',
        data: {
          queueType: 'rabbitmq',
          host: 'localhost',
          port: 5672,
          queues: [],
        },
      };

      const result = generateConfigArtifactPlaceholders('messaging.rabbitmq', meta);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('config');
      expect(result[0].suggestedPath).toBe('config/queue.config.ts');
    });
  });

  describe('frontend', () => {
    it('returns empty for frontend metadata (no config artifacts)', () => {
      const meta: NodeDomainMetadata = {
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

      const result = generateConfigArtifactPlaceholders('frontend.react', meta);
      expect(result).toHaveLength(0);
    });
  });
});

describe('getArtifactPlaceholdersForNode config integration', () => {
  it('includes config artifacts for web-service nodes', () => {
    const node: Partial<Node> = {
      id: '00000000-0000-0000-0000-000000000001',
      type: 'web.rest-api',
      label: 'API',
      metadata: {
        domainMetadata: {
          type: 'web-service',
          data: {
            language: 'typescript',
            framework: 'express',
            port: 3000,
            baseUrl: '/api',
            dependencies: [],
            envVars: [],
            apiRoutes: [],
          },
        },
      },
    };

    const result = getArtifactPlaceholdersForNode(node);

    const configArtifacts = result.filter(p => p.kind === 'config');
    expect(configArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(configArtifacts.some(a => a.suggestedPath.includes('server.config'))).toBe(true);
  });

  it('includes config artifacts for managed-service nodes', () => {
    const node: Partial<Node> = {
      id: '00000000-0000-0000-0000-000000000002',
      type: 'gateway.aws-api-gateway',
      label: 'API GW',
      metadata: {
        domainMetadata: {
          type: 'managed-service',
          data: {
            provider: 'aws',
            region: 'us-east-1',
            configEntries: [],
            envVars: [],
          },
        },
      },
    };

    const result = getArtifactPlaceholdersForNode(node);

    const configArtifacts = result.filter(p => p.kind === 'config');
    expect(configArtifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('includes config artifacts for database nodes with host', () => {
    const node: Partial<Node> = {
      id: '00000000-0000-0000-0000-000000000003',
      type: 'database.postgresql',
      label: 'DB',
      metadata: {
        domainMetadata: {
          type: 'database',
          data: {
            dbType: 'postgres',
            host: 'localhost',
            port: 5432,
            tables: [],
            migrations: [],
            indexes: [],
          },
        },
      },
    };

    const result = getArtifactPlaceholdersForNode(node);

    const configArtifacts = result.filter(p => p.kind === 'config');
    expect(configArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(configArtifacts.some(a => a.suggestedPath.includes('database.config'))).toBe(true);
  });

  it('includes config artifacts for cache nodes', () => {
    const node: Partial<Node> = {
      id: '00000000-0000-0000-0000-000000000004',
      type: 'cache.redis',
      label: 'Redis',
      metadata: {
        domainMetadata: {
          type: 'cache',
          data: {
            cacheType: 'redis',
            language: 'typescript',
            host: 'localhost',
            port: 6379,
            keyPatterns: [],
          },
        },
      },
    };

    const result = getArtifactPlaceholdersForNode(node);

    const configArtifacts = result.filter(p => p.kind === 'config');
    expect(configArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(configArtifacts.some(a => a.suggestedPath.includes('cache.config'))).toBe(true);
  });

  it('does not duplicate config artifacts that already exist in language-specific placeholders', () => {
    const node: Partial<Node> = {
      id: '00000000-0000-0000-0000-000000000005',
      type: 'web.rest-api',
      label: 'API',
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
    };

    const result = getArtifactPlaceholdersForNode(node);
    const paths = result.map(p => p.suggestedPath);
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });
});
