// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { getArtifactPlaceholdersForNode } from '@nodespec/core/templates.js';
import type { Node } from '@nodespec/core/types.js';
import type { NodeDomainMetadata, ProgrammingLanguage } from '@nodespec/core/node-metadata.js';

describe('REST API Artifacts - Diagnostic', () => {
  const createRestApiNode = (language: ProgrammingLanguage): Partial<Node> => {
    const metadata: NodeDomainMetadata = {
      type: 'web-service',
      data: {
        language,
        framework: undefined,
        runtime: undefined,
        dependencies: [],
        envVars: [],
        apiRoutes: [],
      },
    };

    return {
      id: 'test-rest-api',
      type: 'web.rest-api',
      metadata: {
        domainMetadata: metadata,
      },
    };
  };

  describe('What Actually Gets Generated', () => {
    it('should show Python artifacts', () => {
      const node = createRestApiNode('python');
      const artifacts = getArtifactPlaceholdersForNode(node);

      console.log('\n=== PYTHON REST API ARTIFACTS ===');
      artifacts.forEach((a, i) => {
        console.log(`${i + 1}. [${a.kind}] ${a.suggestedPath} (${a.language || 'no-lang'})`);
        console.log(`   ${a.description}`);
      });

      expect(artifacts.length).toBeGreaterThan(0);

      const wrongLanguageArtifacts = artifacts.filter(
        a => a.kind === 'source' && a.language && a.language !== 'python'
      );

      if (wrongLanguageArtifacts.length > 0) {
        console.log('\n❌ WRONG LANGUAGE ARTIFACTS:');
        wrongLanguageArtifacts.forEach(a => {
          console.log(`   ${a.suggestedPath} - expected python, got ${a.language}`);
        });
      }

      expect(wrongLanguageArtifacts).toHaveLength(0);
    });

    it('should show TypeScript artifacts', () => {
      const node = createRestApiNode('typescript');
      const artifacts = getArtifactPlaceholdersForNode(node);

      console.log('\n=== TYPESCRIPT REST API ARTIFACTS ===');
      artifacts.forEach((a, i) => {
        console.log(`${i + 1}. [${a.kind}] ${a.suggestedPath} (${a.language || 'no-lang'})`);
        console.log(`   ${a.description}`);
      });

      expect(artifacts.length).toBeGreaterThan(0);

      const wrongLanguageArtifacts = artifacts.filter(
        a => a.kind === 'source' && a.language && a.language !== 'typescript'
      );

      if (wrongLanguageArtifacts.length > 0) {
        console.log('\n❌ WRONG LANGUAGE ARTIFACTS:');
        wrongLanguageArtifacts.forEach(a => {
          console.log(`   ${a.suggestedPath} - expected typescript, got ${a.language}`);
        });
      }

      expect(wrongLanguageArtifacts).toHaveLength(0);
    });

    it('should show Java artifacts', () => {
      const node = createRestApiNode('java');
      const artifacts = getArtifactPlaceholdersForNode(node);

      console.log('\n=== JAVA REST API ARTIFACTS ===');
      artifacts.forEach((a, i) => {
        console.log(`${i + 1}. [${a.kind}] ${a.suggestedPath} (${a.language || 'no-lang'})`);
        console.log(`   ${a.description}`);
      });

      expect(artifacts.length).toBeGreaterThan(0);

      const wrongLanguageArtifacts = artifacts.filter(
        a => a.kind === 'source' && a.language && a.language !== 'java'
      );

      if (wrongLanguageArtifacts.length > 0) {
        console.log('\n❌ WRONG LANGUAGE ARTIFACTS:');
        wrongLanguageArtifacts.forEach(a => {
          console.log(`   ${a.suggestedPath} - expected java, got ${a.language}`);
        });
      }

      expect(wrongLanguageArtifacts).toHaveLength(0);
    });

    it('should show Go artifacts', () => {
      const node = createRestApiNode('go');
      const artifacts = getArtifactPlaceholdersForNode(node);

      console.log('\n=== GO REST API ARTIFACTS ===');
      artifacts.forEach((a, i) => {
        console.log(`${i + 1}. [${a.kind}] ${a.suggestedPath} (${a.language || 'no-lang'})`);
        console.log(`   ${a.description}`);
      });

      expect(artifacts.length).toBeGreaterThan(0);

      const wrongLanguageArtifacts = artifacts.filter(
        a => a.kind === 'source' && a.language && a.language !== 'go'
      );

      if (wrongLanguageArtifacts.length > 0) {
        console.log('\n❌ WRONG LANGUAGE ARTIFACTS:');
        wrongLanguageArtifacts.forEach(a => {
          console.log(`   ${a.suggestedPath} - expected go, got ${a.language}`);
        });
      }

      expect(wrongLanguageArtifacts).toHaveLength(0);
    });

    it('should show Ruby artifacts', () => {
      const node = createRestApiNode('ruby');
      const artifacts = getArtifactPlaceholdersForNode(node);

      console.log('\n=== RUBY REST API ARTIFACTS ===');
      artifacts.forEach((a, i) => {
        console.log(`${i + 1}. [${a.kind}] ${a.suggestedPath} (${a.language || 'no-lang'})`);
        console.log(`   ${a.description}`);
      });

      expect(artifacts.length).toBeGreaterThan(0);

      const wrongLanguageArtifacts = artifacts.filter(
        a => a.kind === 'source' && a.language && a.language !== 'ruby'
      );

      if (wrongLanguageArtifacts.length > 0) {
        console.log('\n❌ WRONG LANGUAGE ARTIFACTS:');
        wrongLanguageArtifacts.forEach(a => {
          console.log(`   ${a.suggestedPath} - expected ruby, got ${a.language}`);
        });
      }

      expect(wrongLanguageArtifacts).toHaveLength(0);
    });
  });

  describe('Quality Checks', () => {
    const allLanguages: ProgrammingLanguage[] = [
      'typescript', 'javascript', 'python', 'java', 'go',
      'csharp', 'php', 'ruby', 'rust'
    ];

    allLanguages.forEach(language => {
      it(`${language} should have OpenAPI schema`, () => {
        const node = createRestApiNode(language);
        const artifacts = getArtifactPlaceholdersForNode(node);

        const hasOpenAPI = artifacts.some(
          a => a.kind === 'schema' && a.suggestedPath.includes('openapi')
        );

        expect(hasOpenAPI, `${language} REST API should have OpenAPI schema`).toBe(true);
      });

      it(`${language} should have documentation`, () => {
        const node = createRestApiNode(language);
        const artifacts = getArtifactPlaceholdersForNode(node);

        const hasDocs = artifacts.some(a => a.kind === 'doc');

        expect(hasDocs, `${language} REST API should have documentation`).toBe(true);
      });

      it(`${language} should have server/entry point`, () => {
        const node = createRestApiNode(language);
        const artifacts = getArtifactPlaceholdersForNode(node);

        const hasServer = artifacts.some(
          a => (a.kind === 'source' || a.kind === 'config') &&
          (a.suggestedPath.includes('server') ||
           a.suggestedPath.includes('main') ||
           a.suggestedPath.includes('Application') ||
           a.suggestedPath.includes('Program.cs') ||
           a.suggestedPath.includes('index.php') ||
           a.suggestedPath.includes('config.ru'))
        );

        expect(hasServer, `${language} REST API should have server/entry point`).toBe(true);
      });

      it(`${language} should have routes/controllers`, () => {
        const node = createRestApiNode(language);
        const artifacts = getArtifactPlaceholdersForNode(node);

        const hasRoutes = artifacts.some(
          a => a.kind === 'source' &&
          (a.suggestedPath.includes('route') ||
           a.suggestedPath.includes('controller') ||
           a.suggestedPath.includes('Controller'))
        );

        expect(hasRoutes, `${language} REST API should have routes/controllers`).toBe(true);
      });

      it(`${language} should have config/dependencies file`, () => {
        const node = createRestApiNode(language);
        const artifacts = getArtifactPlaceholdersForNode(node);

        const hasConfig = artifacts.some(a => a.kind === 'config');

        expect(hasConfig, `${language} REST API should have config/dependencies file`).toBe(true);
      });
    });
  });
});
