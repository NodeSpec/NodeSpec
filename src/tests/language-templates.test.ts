// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import { generateLanguageSpecificArtifacts, type LanguageTemplateContext } from '@nodespec/core/language-templates.js';
import { getArtifactPlaceholdersForNode } from '@nodespec/core/templates.js';
import type { Node } from '@nodespec/core/types.js';
import type { ProgrammingLanguage, NodeDomainMetadata } from '@nodespec/core/node-metadata.js';

describe('Language Templates', () => {
  const INTERFACE_NODE_TYPES = ['web.rest-api', 'web.graphql-api', 'web.grpc-service'] as const;

  const SUPPORTED_LANGUAGES: ProgrammingLanguage[] = [
    'typescript',
    'javascript',
    'python',
    'java',
    'go',
    'csharp',
    'php',
    'ruby',
    'rust',
  ];

  describe('generateLanguageSpecificArtifacts', () => {
    describe('REST API', () => {
      SUPPORTED_LANGUAGES.forEach(language => {
        it(`should generate artifacts for ${language}`, () => {
          const context: LanguageTemplateContext = {
            nodeTypeId: 'web.rest-api',
            language,
            framework: undefined,
            runtime: undefined,
          };

          const artifacts = generateLanguageSpecificArtifacts(context);

          expect(artifacts.length).toBeGreaterThan(0);
          expect(artifacts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'schema',
                suggestedPath: 'api/openapi.yaml',
                language: 'yaml',
              }),
            ])
          );

          const sourceArtifacts = artifacts.filter(a => a.kind === 'source');
          expect(sourceArtifacts.length).toBeGreaterThan(0);

          sourceArtifacts.forEach(artifact => {
            expect(artifact.suggestedPath).toBeTruthy();
            expect(artifact.description).toBeTruthy();
            expect(artifact.language).toBe(language);
          });
        });
      });
    });

    describe('GraphQL API', () => {
      SUPPORTED_LANGUAGES.forEach(language => {
        it(`should generate artifacts for ${language}`, () => {
          const context: LanguageTemplateContext = {
            nodeTypeId: 'web.graphql-api',
            language,
            framework: undefined,
            runtime: undefined,
          };

          const artifacts = generateLanguageSpecificArtifacts(context);

          expect(artifacts.length).toBeGreaterThan(0);
          expect(artifacts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'schema',
                suggestedPath: 'graphql/schema.graphql',
                language: 'graphql',
              }),
            ])
          );

          const sourceArtifacts = artifacts.filter(a => a.kind === 'source');
          expect(sourceArtifacts.length).toBeGreaterThan(0);

          sourceArtifacts.forEach(artifact => {
            expect(artifact.suggestedPath).toBeTruthy();
            expect(artifact.description).toBeTruthy();
            expect(artifact.language).toBe(language);
          });
        });
      });
    });

    describe('gRPC Service', () => {
      SUPPORTED_LANGUAGES.forEach(language => {
        it(`should generate artifacts for ${language}`, () => {
          const context: LanguageTemplateContext = {
            nodeTypeId: 'web.grpc-service',
            language,
            framework: undefined,
            runtime: undefined,
          };

          const artifacts = generateLanguageSpecificArtifacts(context);

          expect(artifacts.length).toBeGreaterThan(0);
          expect(artifacts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'schema',
                suggestedPath: 'proto/service.proto',
                language: 'protobuf',
              }),
            ])
          );

          const sourceArtifacts = artifacts.filter(a => a.kind === 'source');
          expect(sourceArtifacts.length).toBeGreaterThan(0);

          sourceArtifacts.forEach(artifact => {
            expect(artifact.suggestedPath).toBeTruthy();
            expect(artifact.description).toBeTruthy();
            expect(artifact.language).toBe(language);
          });
        });
      });
    });

    describe('Backend Runtimes', () => {
      const BACKEND_RUNTIME_EXPECTATIONS: Array<{ nodeType: string; expectedLang: string }> = [
        { nodeType: 'backend.nodejs', expectedLang: 'typescript' },
        { nodeType: 'backend.rust', expectedLang: 'rust' },
        { nodeType: 'backend.python', expectedLang: 'python' },
        { nodeType: 'backend.go', expectedLang: 'go' },
        { nodeType: 'backend.ruby', expectedLang: 'ruby' },
      ];

      BACKEND_RUNTIME_EXPECTATIONS.forEach(({ nodeType, expectedLang }) => {
        it(`should generate ${expectedLang} artifacts for ${nodeType}`, () => {
          const context: LanguageTemplateContext = {
            nodeTypeId: nodeType,
            language: expectedLang as ProgrammingLanguage,
            framework: undefined,
            runtime: undefined,
          };

          const artifacts = generateLanguageSpecificArtifacts(context);

          expect(artifacts.length).toBeGreaterThan(0);

          const sourceArtifacts = artifacts.filter(a => a.kind === 'source');
          expect(sourceArtifacts.length).toBeGreaterThan(0);

          sourceArtifacts.forEach(artifact => {
            expect(artifact.suggestedPath).toBeTruthy();
            expect(artifact.description).toBeTruthy();
            expect(artifact.language).toBe(expectedLang);
          });
        });
      });
    });
  });

  describe('getArtifactPlaceholdersForNode - Integration', () => {
    INTERFACE_NODE_TYPES.forEach(nodeType => {
      describe(nodeType, () => {
        SUPPORTED_LANGUAGES.forEach(language => {
          it(`should return language-specific artifacts for ${language}`, () => {
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

            const node: Partial<Node> = {
              id: 'test-node',
              type: nodeType,
              metadata: {
                domainMetadata: metadata,
              },
            };

            const placeholders = getArtifactPlaceholdersForNode(node);

            expect(placeholders.length).toBeGreaterThan(0);

            const sourceArtifacts = placeholders.filter(a => a.kind === 'source');
            expect(sourceArtifacts.length).toBeGreaterThan(0);

            sourceArtifacts.forEach(artifact => {
              expect(artifact.language).toBe(language);
              expect(artifact.suggestedPath).toBeTruthy();
            });
          });
        });
      });
    });
  });

  describe('File Extension Consistency', () => {
    const extensionMap: Record<ProgrammingLanguage, RegExp> = {
      typescript: /\.(ts|tsx)$/,
      javascript: /\.(js|jsx)$/,
      python: /\.py$/,
      java: /\.java$/,
      go: /\.go$/,
      csharp: /\.cs$/,
      php: /\.php$/,
      ruby: /\.rb$/,
      rust: /\.rs$/,
      swift: /\.swift$/,
      kotlin: /\.kt$/,
      dart: /\.dart$/,
      other: /\..+$/,
    };

    SUPPORTED_LANGUAGES.forEach(language => {
      it(`should use correct file extensions for ${language} source files`, () => {
        const context: LanguageTemplateContext = {
          nodeTypeId: 'web.rest-api',
          language,
          framework: undefined,
          runtime: undefined,
        };

        const artifacts = generateLanguageSpecificArtifacts(context);
        const sourceArtifacts = artifacts.filter(a => a.kind === 'source' && a.language === language);

        const expectedPattern = extensionMap[language];
        sourceArtifacts.forEach(artifact => {
          expect(artifact.suggestedPath).toMatch(expectedPattern);
        });
      });
    });
  });

  describe('Template Completeness', () => {
    INTERFACE_NODE_TYPES.forEach(nodeType => {
      it(`should have complete templates for ${nodeType}`, () => {
        SUPPORTED_LANGUAGES.forEach(language => {
          const context: LanguageTemplateContext = {
            nodeTypeId: nodeType,
            language,
            framework: undefined,
            runtime: undefined,
          };

          const artifacts = generateLanguageSpecificArtifacts(context);

          expect(artifacts.length, `${nodeType} with ${language} should have artifacts`).toBeGreaterThan(0);

          const hasSchema = artifacts.some(a => a.kind === 'schema');
          const hasSource = artifacts.some(a => a.kind === 'source');
          const hasDoc = artifacts.some(a => a.kind === 'doc');

          expect(hasSchema, `${nodeType} with ${language} should have schema`).toBe(true);
          expect(hasSource, `${nodeType} with ${language} should have source`).toBe(true);
          expect(hasDoc, `${nodeType} with ${language} should have docs`).toBe(true);
        });
      });
    });
  });
});
