// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { getArtifactPlaceholdersForNode } from '@nodespec/core/templates.js';
import type { Node } from '@nodespec/core/types.js';
import type { NodeDomainMetadata } from '@nodespec/core/node-metadata.js';

describe('Auth and Cache Language Switching Fix', () => {
  it('should show consistent artifacts for auth nodes regardless of language state', () => {
    const authNodeNoLang: Partial<Node> = {
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

    const authNodeWithTS: Partial<Node> = {
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

    const artifactsNoLang = getArtifactPlaceholdersForNode(authNodeNoLang);
    const artifactsWithTS = getArtifactPlaceholdersForNode(authNodeWithTS);

    console.log('\n=== AUTH NODE TEST ===');
    console.log(`No language set: ${artifactsNoLang.length} artifacts`);
    console.log(`TypeScript set:  ${artifactsWithTS.length} artifacts`);

    const noLangPaths = artifactsNoLang.map(a => a.suggestedPath).sort();
    const withTSPaths = artifactsWithTS.map(a => a.suggestedPath).sort();

    console.log('\nNo language artifacts:');
    noLangPaths.forEach(p => console.log(`  - ${p}`));

    console.log('\nWith TypeScript artifacts:');
    withTSPaths.forEach(p => console.log(`  - ${p}`));

    expect(artifactsNoLang.length).toBeGreaterThan(5);
    expect(artifactsWithTS.length).toBeGreaterThan(5);
    expect(artifactsNoLang.length).toBe(artifactsWithTS.length);
  });

  it('should show consistent artifacts for cache nodes regardless of language state', () => {
    const cacheNodeNoLang: Partial<Node> = {
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

    const cacheNodeWithTS: Partial<Node> = {
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

    const artifactsNoLang = getArtifactPlaceholdersForNode(cacheNodeNoLang);
    const artifactsWithTS = getArtifactPlaceholdersForNode(cacheNodeWithTS);

    console.log('\n=== CACHE NODE TEST ===');
    console.log(`No language set: ${artifactsNoLang.length} artifacts`);
    console.log(`TypeScript set:  ${artifactsWithTS.length} artifacts`);

    const noLangPaths = artifactsNoLang.map(a => a.suggestedPath).sort();
    const withTSPaths = artifactsWithTS.map(a => a.suggestedPath).sort();

    console.log('\nNo language artifacts:');
    noLangPaths.forEach(p => console.log(`  - ${p}`));

    console.log('\nWith TypeScript artifacts:');
    withTSPaths.forEach(p => console.log(`  - ${p}`));

    expect(artifactsNoLang.length).toBeGreaterThan(5);
    expect(artifactsWithTS.length).toBeGreaterThan(5);
    expect(artifactsNoLang.length).toBe(artifactsWithTS.length);
  });

  it('should handle language switching properly for auth nodes', () => {
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

    const initialArtifacts = getArtifactPlaceholdersForNode(authNode);

    const authNodePython: Partial<Node> = {
      ...authNode,
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

    const pythonArtifacts = getArtifactPlaceholdersForNode(authNodePython);

    const authNodeBackToTS: Partial<Node> = {
      ...authNode,
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

    const backToTSArtifacts = getArtifactPlaceholdersForNode(authNodeBackToTS);

    console.log('\n=== LANGUAGE SWITCHING TEST ===');
    console.log(`Initial (no lang): ${initialArtifacts.length} artifacts`);
    console.log(`Python:            ${pythonArtifacts.length} artifacts`);
    console.log(`Back to TS:        ${backToTSArtifacts.length} artifacts`);

    expect(initialArtifacts.length).toBe(backToTSArtifacts.length);

    const initialPaths = new Set(initialArtifacts.map(a => a.suggestedPath));
    const backToTSPaths = new Set(backToTSArtifacts.map(a => a.suggestedPath));

    expect(initialPaths).toEqual(backToTSPaths);
  });

  it('should use language-specific file extensions when language is set', () => {
    const authNodePython: Partial<Node> = {
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

    const pythonArtifacts = getArtifactPlaceholdersForNode(authNodePython);
    const pythonSourceFiles = pythonArtifacts.filter(a => a.kind === 'source' && a.language === 'python');

    console.log('\n=== PYTHON EXTENSIONS TEST ===');
    pythonSourceFiles.forEach(a => {
      console.log(`  ${a.suggestedPath} (${a.language})`);
    });

    expect(pythonSourceFiles.length).toBeGreaterThan(0);
    pythonSourceFiles.forEach(file => {
      expect(file.suggestedPath).toMatch(/\.py$/);
    });
  });
});
