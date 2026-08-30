// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { getArtifactPlaceholdersForNode } from '@nodespec/core/templates.js';
import type { Node } from '@nodespec/core/types.js';
import type { NodeDomainMetadata } from '@nodespec/core/node-metadata.js';

describe('Comprehensive Language Support', () => {
  describe('Auth Nodes', () => {
    const authLanguages = ['typescript', 'javascript', 'python', 'go', 'java', 'csharp', 'php', 'ruby', 'rust'] as const;

    authLanguages.forEach(language => {
      it(`should generate proper artifacts for auth node with ${language}`, () => {
        const authNode: Partial<Node> = {
          id: 'auth-1',
          type: 'auth.supabase-auth',
          metadata: {
            domainMetadata: {
              type: 'auth-service',
              data: {
                provider: 'supabase-auth',
                language,
                strategies: [],
                mfaEnabled: false,
                socialProviders: [],
              },
            } as NodeDomainMetadata,
          },
        };

        const artifacts = getArtifactPlaceholdersForNode(authNode);

        expect(artifacts.length).toBeGreaterThan(5);

        const sourceArtifacts = artifacts.filter(a => a.kind === 'source');
        expect(sourceArtifacts.length).toBeGreaterThan(0);

        const configArtifacts = artifacts.filter(a => a.kind === 'config');
        expect(configArtifacts.length).toBeGreaterThan(0);

        const docArtifacts = artifacts.filter(a => a.kind === 'doc');
        expect(docArtifacts.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Cache Nodes', () => {
    const cacheLanguages = ['typescript', 'javascript', 'python', 'go', 'java', 'csharp', 'php', 'ruby', 'rust'] as const;

    cacheLanguages.forEach(language => {
      it(`should generate proper artifacts for cache node with ${language}`, () => {
        const cacheNode: Partial<Node> = {
          id: 'cache-1',
          type: 'cache.redis',
          metadata: {
            domainMetadata: {
              type: 'cache',
              data: {
                cacheType: 'redis',
                language,
                keyPatterns: [],
              },
            } as NodeDomainMetadata,
          },
        };

        const artifacts = getArtifactPlaceholdersForNode(cacheNode);

        expect(artifacts.length).toBeGreaterThan(5);

        const sourceArtifacts = artifacts.filter(a => a.kind === 'source');
        expect(sourceArtifacts.length).toBeGreaterThan(0);

        const configArtifacts = artifacts.filter(a => a.kind === 'config');
        expect(configArtifacts.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Frontend Nodes', () => {
    it('should generate TypeScript/React artifacts', () => {
      const frontendNode: Partial<Node> = {
        id: 'frontend-1',
        type: 'frontend.app',
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
      };

      const artifacts = getArtifactPlaceholdersForNode(frontendNode);

      expect(artifacts.length).toBeGreaterThan(5);
      expect(artifacts.some(a => a.suggestedPath.includes('.tsx'))).toBe(true);
      expect(artifacts.some(a => a.suggestedPath === 'package.json')).toBe(true);
      expect(artifacts.some(a => a.suggestedPath === 'tsconfig.json')).toBe(true);
    });

    it('should generate C# Blazor artifacts', () => {
      const frontendNode: Partial<Node> = {
        id: 'frontend-1',
        type: 'frontend.app',
        metadata: {
          domainMetadata: {
            type: 'frontend',
            data: {
              language: 'csharp',
              dependencies: [],
              envVars: [],
              pages: [],
              components: [],
              apiEndpoints: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const artifacts = getArtifactPlaceholdersForNode(frontendNode);

      expect(artifacts.length).toBeGreaterThan(5);
      expect(artifacts.some(a => a.suggestedPath.endsWith('.razor'))).toBe(true);
      expect(artifacts.some(a => a.suggestedPath === 'Program.cs')).toBe(true);
      expect(artifacts.some(a => a.suggestedPath.endsWith('.csproj'))).toBe(true);
    });

    it('should generate Rust web framework artifacts', () => {
      const frontendNode: Partial<Node> = {
        id: 'frontend-1',
        type: 'frontend.app',
        metadata: {
          domainMetadata: {
            type: 'frontend',
            data: {
              language: 'rust',
              framework: 'other',
              dependencies: [],
              envVars: [],
              pages: [],
              components: [],
              apiEndpoints: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const artifacts = getArtifactPlaceholdersForNode(frontendNode);

      expect(artifacts.length).toBeGreaterThan(5);
      expect(artifacts.some(a => a.suggestedPath.endsWith('.rs'))).toBe(true);
      expect(artifacts.some(a => a.suggestedPath === 'Cargo.toml')).toBe(true);
      expect(artifacts.some(a => a.suggestedPath === 'index.html')).toBe(true);
    });
  });

  describe('Language Consistency', () => {
    it('should use consistent file extensions for TypeScript across node types', () => {
      const authNode: Partial<Node> = {
        id: 'auth-1',
        type: 'auth.supabase-auth',
        metadata: {
          domainMetadata: {
            type: 'auth-service',
            data: {
              provider: 'supabase-auth',
              language: 'typescript',
              strategies: [],
              mfaEnabled: false,
              socialProviders: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const cacheNode: Partial<Node> = {
        id: 'cache-1',
        type: 'cache.redis',
        metadata: {
          domainMetadata: {
            type: 'cache',
            data: {
              cacheType: 'redis',
              language: 'typescript',
              keyPatterns: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const authArtifacts = getArtifactPlaceholdersForNode(authNode);
      const cacheArtifacts = getArtifactPlaceholdersForNode(cacheNode);

      const authTsFiles = authArtifacts.filter(a =>
        a.kind === 'source' &&
        a.language === 'typescript' &&
        !a.suggestedPath.endsWith('.sql')
      );
      const cacheTsFiles = cacheArtifacts.filter(a =>
        a.kind === 'source' &&
        a.language === 'typescript'
      );

      authTsFiles.forEach(file => {
        expect(file.suggestedPath).toMatch(/\.ts$/);
      });

      cacheTsFiles.forEach(file => {
        expect(file.suggestedPath).toMatch(/\.ts$/);
      });
    });

    it('should use consistent file extensions for Python across node types', () => {
      const authNode: Partial<Node> = {
        id: 'auth-1',
        type: 'auth.supabase-auth',
        metadata: {
          domainMetadata: {
            type: 'auth-service',
            data: {
              provider: 'supabase-auth',
              language: 'python',
              strategies: [],
              mfaEnabled: false,
              socialProviders: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const cacheNode: Partial<Node> = {
        id: 'cache-1',
        type: 'cache.redis',
        metadata: {
          domainMetadata: {
            type: 'cache',
            data: {
              cacheType: 'redis',
              language: 'python',
              keyPatterns: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const authArtifacts = getArtifactPlaceholdersForNode(authNode);
      const cacheArtifacts = getArtifactPlaceholdersForNode(cacheNode);

      const authPyFiles = authArtifacts.filter(a => a.kind === 'source' && a.language === 'python');
      const cachePyFiles = cacheArtifacts.filter(a => a.kind === 'source' && a.language === 'python');

      authPyFiles.forEach(file => {
        expect(file.suggestedPath).toMatch(/\.py$/);
      });

      cachePyFiles.forEach(file => {
        expect(file.suggestedPath).toMatch(/\.py$/);
      });
    });
  });

  describe('Default Language Behavior', () => {
    it('should default to TypeScript for auth nodes without language specified', () => {
      const authNode: Partial<Node> = {
        id: 'auth-1',
        type: 'auth.supabase-auth',
        metadata: {
          domainMetadata: {
            type: 'auth-service',
            data: {
              provider: 'supabase-auth',
              strategies: [],
              mfaEnabled: false,
              socialProviders: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const artifacts = getArtifactPlaceholdersForNode(authNode);
      const sourceFiles = artifacts.filter(a => a.kind === 'source' && a.language);

      expect(sourceFiles.length).toBeGreaterThan(0);
      sourceFiles.forEach(file => {
        if (file.language !== 'sql') {
          expect(file.language).toBe('typescript');
        }
      });
    });

    it('should default to TypeScript for cache nodes without language specified', () => {
      const cacheNode: Partial<Node> = {
        id: 'cache-1',
        type: 'cache.redis',
        metadata: {
          domainMetadata: {
            type: 'cache',
            data: {
              cacheType: 'redis',
              keyPatterns: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const artifacts = getArtifactPlaceholdersForNode(cacheNode);
      const sourceFiles = artifacts.filter(a => a.kind === 'source' && a.language);

      expect(sourceFiles.length).toBeGreaterThan(0);
      sourceFiles.forEach(file => {
        expect(file.language).toBe('typescript');
      });
    });

    it('should default to TypeScript for frontend nodes without language specified', () => {
      const frontendNode: Partial<Node> = {
        id: 'frontend-1',
        type: 'frontend.app',
        metadata: {
          domainMetadata: {
            type: 'frontend',
            data: {
              dependencies: [],
              envVars: [],
              pages: [],
              components: [],
              apiEndpoints: [],
            },
          } as NodeDomainMetadata,
        },
      };

      const artifacts = getArtifactPlaceholdersForNode(frontendNode);
      const tsFiles = artifacts.filter(a => a.suggestedPath.endsWith('.tsx') || a.suggestedPath.endsWith('.ts'));

      expect(tsFiles.length).toBeGreaterThan(0);
    });
  });
});
