import type { Port, ContractKind, InteractionKind, TransportKind, SpecFormat, EntityStatus, Node } from './types.js';
import { getNodeTypeDomains, type DomainNodeType } from './node-types.js';
import type { ProgrammingLanguage, NodeDomainMetadata, WebServiceMetadata, FrontendMetadata, AuthServiceMetadata, CacheMetadata, DatabaseMetadata, ManagedServiceMetadata } from './node-metadata.js';
import { getNodeTypeById } from './node-types.js';
import { generateLanguageSpecificArtifacts, mergeArtifactPlaceholders, type LanguageTemplateContext } from './language-templates.js';
import { generateContainerArtifacts, type ContainerArtifactContext } from './container-artifact-templates.js';
import { getContainerTypeById } from './container-types.js';
import { resolveContractFields } from './interaction-resolution.js';

export interface NodeTemplate {
  id: string;
  name: string;
  description: string;
  nodeType: string;
  defaultPorts: PortTemplate[];
  defaultContracts: ContractTemplate[];
  artifactPlaceholders: ArtifactPlaceholder[];
  defaultData?: Record<string, unknown>;
  accentColor: string;
}

export interface PortTemplate {
  name: string;
  direction: 'in' | 'out';
  required?: boolean;
  schemaRef?: string;
}

export interface ContractTemplate {
  kind: ContractKind;
  name: string;
  portDirection: 'in' | 'out';
  interactionKind?: InteractionKind;
  transport?: TransportKind;
  specFormat?: SpecFormat;
}

export interface ArtifactPlaceholder {
  kind: 'source' | 'schema' | 'doc' | 'config';
  suggestedPath: string;
  description: string;
  language?: string;
}

function inferLanguageFromNodeType(nodeTypeId: string): { language: string; entryFile: string } {
  if (nodeTypeId.includes('.go') || nodeTypeId.includes('golang')) {
    return { language: 'go', entryFile: 'main.go' };
  }
  if (nodeTypeId.includes('.rust') || nodeTypeId.includes('.yew') || nodeTypeId.includes('.dioxus')) {
    return { language: 'rust', entryFile: 'main.rs' };
  }
  if (nodeTypeId.includes('.python') || nodeTypeId.includes('.django') || nodeTypeId.includes('.flask')) {
    return { language: 'python', entryFile: 'main.py' };
  }
  if (nodeTypeId.includes('.ruby') || nodeTypeId.includes('.rails')) {
    return { language: 'ruby', entryFile: 'main.rb' };
  }
  if (nodeTypeId.includes('.java') || nodeTypeId.includes('.spring')) {
    return { language: 'java', entryFile: 'Main.java' };
  }
  if (nodeTypeId.includes('.csharp') || nodeTypeId.includes('.dotnet') || nodeTypeId.includes('.blazor')) {
    return { language: 'csharp', entryFile: 'Program.cs' };
  }
  return { language: 'typescript', entryFile: 'main.ts' };
}

function generateArtifactPlaceholders(nodeType: DomainNodeType): ArtifactPlaceholder[] {
  switch (nodeType.id) {
    case 'frontend.app':
    case 'frontend.react':
    case 'frontend.solid':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/App.tsx',
          description: 'Main application component',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main.tsx',
          description: 'Application entry point',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'vite.config.ts',
          description: 'Vite build configuration',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/index.css',
          description: 'Global styles',
          language: 'css',
        },
      ];

    case 'frontend.vue':
    case 'frontend.nuxt':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/App.vue',
          description: 'Root Vue component',
          language: 'vue',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main.ts',
          description: 'Application entry point',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'vite.config.ts',
          description: 'Vite build configuration',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/style.css',
          description: 'Global styles',
          language: 'css',
        },
      ];

    case 'frontend.angular':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/app/app.component.ts',
          description: 'Root Angular component',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main.ts',
          description: 'Application bootstrap',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'angular.json',
          description: 'Angular workspace configuration',
          language: 'json',
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/styles.scss',
          description: 'Global styles',
          language: 'scss',
        },
      ];

    case 'frontend.svelte':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/App.svelte',
          description: 'Root Svelte component',
          language: 'svelte',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main.ts',
          description: 'Application entry point',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'svelte.config.js',
          description: 'Svelte configuration',
          language: 'javascript',
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/app.css',
          description: 'Global styles',
          language: 'css',
        },
      ];

    case 'frontend.next':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'app/page.tsx',
          description: 'Root page component',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'app/layout.tsx',
          description: 'Root layout component',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'next.config.js',
          description: 'Next.js configuration',
          language: 'javascript',
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'app/globals.css',
          description: 'Global styles',
          language: 'css',
        },
      ];

    case 'frontend.astro':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/pages/index.astro',
          description: 'Home page',
          language: 'astro',
        },
        {
          kind: 'source',
          suggestedPath: 'src/layouts/Layout.astro',
          description: 'Base layout component',
          language: 'astro',
        },
        {
          kind: 'config',
          suggestedPath: 'astro.config.mjs',
          description: 'Astro configuration',
          language: 'javascript',
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/styles/global.css',
          description: 'Global styles',
          language: 'css',
        },
      ];

    case 'frontend.blazor':
      return [
        {
          kind: 'config',
          suggestedPath: 'Program.cs',
          description: 'Application entry point',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Pages/Index.razor',
          description: 'Home page component',
          language: 'razor',
        },
        {
          kind: 'source',
          suggestedPath: 'Shared/MainLayout.razor',
          description: 'Main layout component',
          language: 'razor',
        },
        {
          kind: 'config',
          suggestedPath: 'App.razor',
          description: 'Root application component',
          language: 'razor',
        },
        {
          kind: 'config',
          suggestedPath: 'wwwroot/css/app.css',
          description: 'Application styles',
          language: 'css',
        },
        {
          kind: 'config',
          suggestedPath: 'BlazorApp.csproj',
          description: 'Project file',
          language: 'xml',
        },
      ];

    case 'frontend.yew':
    case 'frontend.dioxus':
      return [
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: 'Rust project manifest',
          language: 'toml',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main.rs',
          description: 'Application entry point',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/app.rs',
          description: 'Root application component',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/components/mod.rs',
          description: 'Component module',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'index.html',
          description: 'HTML template for WASM',
          language: 'html',
        },
        {
          kind: 'source',
          suggestedPath: 'src/styles.css',
          description: 'Application styles',
          language: 'css',
        },
      ];

    case 'frontend.html-css':
      return [
        {
          kind: 'source',
          suggestedPath: 'index.html',
          description: 'Main HTML page',
          language: 'html',
        },
        {
          kind: 'source',
          suggestedPath: 'styles/main.css',
          description: 'Main stylesheet',
          language: 'css',
        },
        {
          kind: 'source',
          suggestedPath: 'scripts/main.js',
          description: 'JavaScript entry point',
          language: 'javascript',
        },
        {
          kind: 'source',
          suggestedPath: 'styles/variables.css',
          description: 'CSS custom properties',
          language: 'css',
        },
        {
          kind: 'source',
          suggestedPath: 'scripts/utils.js',
          description: 'Utility functions',
          language: 'javascript',
        },
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'Optional build tools configuration',
          language: 'json',
        },
      ];

    case 'database.postgresql':
      return [
        {
          kind: 'schema',
          suggestedPath: 'db/schema.sql',
          description: 'Database schema definition',
          language: 'sql',
        },
        {
          kind: 'schema',
          suggestedPath: 'db/migrations/001_initial.sql',
          description: 'Initial migration script',
          language: 'sql',
        },
        {
          kind: 'config',
          suggestedPath: 'db/config.yaml',
          description: 'Database connection configuration',
          language: 'yaml',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/database.md',
          description: 'Database documentation and ER diagram',
        },
      ];

    case 'database.mongodb':
      return [
        {
          kind: 'config',
          suggestedPath: 'db/config.json',
          description: 'Connection and replica set config',
          language: 'json',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/collections.md',
          description: 'Collection schemas, indexes, and data model',
        },
      ];

    case 'database.redis':
      return [
        {
          kind: 'config',
          suggestedPath: 'cache/config.yaml',
          description: 'Redis connection settings',
          language: 'yaml',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/caching-strategy.md',
          description: 'Cache key patterns, TTLs, invalidation, and eviction policies',
        },
      ];

    case 'database.mysql':
      return [
        {
          kind: 'schema',
          suggestedPath: 'db/schema.sql',
          description: 'MySQL table definitions',
          language: 'sql',
        },
        {
          kind: 'schema',
          suggestedPath: 'db/migrations/V1__initial.sql',
          description: 'Flyway migration script',
          language: 'sql',
        },
        {
          kind: 'config',
          suggestedPath: 'db/config.yaml',
          description: 'MySQL connection pool config',
          language: 'yaml',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/schema-design.md',
          description: 'Schema documentation and indexes',
        },
      ];

    case 'database.dynamodb':
      return [
        {
          kind: 'schema',
          suggestedPath: 'db/tables.yaml',
          description: 'DynamoDB table definitions',
          language: 'yaml',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/access-patterns.md',
          description: 'Table design, partition keys, GSI strategies, and access patterns',
        },
      ];

    case 'database.cosmosdb':
      return [
        {
          kind: 'schema',
          suggestedPath: 'db/containers.json',
          description: 'Container and partition key definitions',
          language: 'json',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/consistency-model.md',
          description: 'Consistency levels, query patterns, and data model',
        },
      ];

    case 'database.firestore':
      return [
        {
          kind: 'config',
          suggestedPath: 'firestore.rules',
          description: 'Security rules',
        },
        {
          kind: 'config',
          suggestedPath: 'firestore.indexes.json',
          description: 'Composite index definitions',
          language: 'json',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/data-model.md',
          description: 'Collection structure, document schema, and subcollections',
        },
      ];

    case 'database.neo4j':
      return [
        {
          kind: 'schema',
          suggestedPath: 'db/schema.cypher',
          description: 'Node and relationship definitions',
          language: 'cypher',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/graph-model.md',
          description: 'Graph schema, constraints, indexes, and query patterns',
        },
      ];

    case 'database.elasticsearch':
      return [
        {
          kind: 'schema',
          suggestedPath: 'search/mappings.json',
          description: 'Index mappings and analyzers',
          language: 'json',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/search-strategy.md',
          description: 'Index lifecycle, query optimization, and reindexing strategies',
        },
      ];

    case 'database.influxdb':
      return [
        {
          kind: 'schema',
          suggestedPath: 'timeseries/buckets.yaml',
          description: 'Bucket and retention policies',
          language: 'yaml',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/measurement-design.md',
          description: 'Tag and field schema design, cardinality management, and downsampling',
        },
      ];

    case 'database.cassandra':
      return [
        {
          kind: 'schema',
          suggestedPath: 'db/schema.cql',
          description: 'Keyspace and table definitions',
          language: 'cql',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/data-modeling.md',
          description: 'Partition key design, clustering columns, and denormalization strategies',
        },
      ];

    case 'web.rest-api':
      return [
        {
          kind: 'schema',
          suggestedPath: 'api/openapi.yaml',
          description: 'OpenAPI 3.0 specification with endpoints, schemas, and auth',
          language: 'yaml',
        },
        {
          kind: 'source',
          suggestedPath: 'api/server.ts',
          description: 'Express/Fastify server setup with middleware',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'api/routes/index.ts',
          description: 'Route definitions and controllers',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'api/middleware/auth.ts',
          description: 'JWT authentication middleware',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'api/middleware/validation.ts',
          description: 'Request validation with Zod or Joi',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'api/middleware/error-handler.ts',
          description: 'Global error handling middleware',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'api/controllers/users.ts',
          description: 'User CRUD operations',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'api/types/dto.ts',
          description: 'Data transfer object types',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'api/config.ts',
          description: 'API configuration (CORS, rate limiting, timeouts)',
          language: 'typescript',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/api-guide.md',
          description: 'API usage guide with examples',
        },
      ];

    case 'web.graphql-api':
      return [
        {
          kind: 'schema',
          suggestedPath: 'graphql/schema.graphql',
          description: 'GraphQL type definitions and schema',
          language: 'graphql',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/server.ts',
          description: 'Apollo Server or GraphQL Yoga setup',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/resolvers/index.ts',
          description: 'Root resolver map',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/resolvers/queries.ts',
          description: 'Query resolvers with DataLoader batching',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/resolvers/mutations.ts',
          description: 'Mutation resolvers for data modifications',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/resolvers/subscriptions.ts',
          description: 'Real-time subscription resolvers',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/context.ts',
          description: 'Context builder with auth and dataloaders',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/directives/auth.ts',
          description: 'Custom auth directive for field-level security',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/dataloaders.ts',
          description: 'DataLoader instances to prevent N+1 queries',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'graphql/config.ts',
          description: 'Query complexity limits and validation rules',
          language: 'typescript',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/graphql-guide.md',
          description: 'GraphQL query examples and patterns',
        },
      ];

    case 'web.grpc-service':
      return [
        {
          kind: 'schema',
          suggestedPath: 'proto/service.proto',
          description: 'Protocol Buffer definitions for services and messages',
          language: 'protobuf',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc/server.ts',
          description: 'gRPC server setup with services',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc/services/index.ts',
          description: 'Service implementation with methods',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc/interceptors/auth.ts',
          description: 'Authentication interceptor',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc/interceptors/logging.ts',
          description: 'Request/response logging interceptor',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc/interceptors/error-handler.ts',
          description: 'Error handling and status code mapping',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc/client.ts',
          description: 'gRPC client with connection pooling',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'grpc/config.ts',
          description: 'gRPC server configuration (port, credentials, options)',
          language: 'typescript',
        },
        {
          kind: 'config',
          suggestedPath: 'buf.yaml',
          description: 'Buf configuration for proto management',
          language: 'yaml',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/grpc-guide.md',
          description: 'gRPC service documentation and client examples',
        },
      ];

    case 'web.supabase-auth':
      return [
        {
          kind: 'config',
          suggestedPath: 'supabase/config.toml',
          description: 'Supabase auth configuration with providers and settings',
          language: 'toml',
        },
        {
          kind: 'schema',
          suggestedPath: 'supabase/migrations/auth_schema.sql',
          description: 'RLS policies and auth triggers',
          language: 'sql',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/auth-setup.md',
          description: 'OAuth provider setup, RLS patterns, and magic link configuration',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/rls-policies.md',
          description: 'Row Level Security policy examples and patterns',
        },
      ];

    case 'web.auth0':
      return [
        {
          kind: 'config',
          suggestedPath: 'auth0/tenant.yaml',
          description: 'Auth0 tenant configuration export',
          language: 'yaml',
        },
        {
          kind: 'config',
          suggestedPath: 'auth0/rules/add-roles.js',
          description: 'Auth0 Rule for adding roles to tokens',
          language: 'javascript',
        },
        {
          kind: 'config',
          suggestedPath: 'auth0/actions/enrich-token.js',
          description: 'Auth0 Action for token enrichment',
          language: 'javascript',
        },
        {
          kind: 'config',
          suggestedPath: 'auth0/clients.json',
          description: 'Client application configurations',
          language: 'json',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/auth0-setup.md',
          description: 'Universal Login customization, Rules/Actions, and RBAC setup',
        },
      ];

    case 'web.aws-cognito':
      return [
        {
          kind: 'config',
          suggestedPath: 'cognito/user-pool.yaml',
          description: 'CloudFormation/Terraform user pool definition',
          language: 'yaml',
        },
        {
          kind: 'config',
          suggestedPath: 'cognito/identity-pool.yaml',
          description: 'Identity pool and IAM role configuration',
          language: 'yaml',
        },
        {
          kind: 'source',
          suggestedPath: 'cognito/triggers/pre-signup.js',
          description: 'Lambda trigger for pre-signup validation',
          language: 'javascript',
        },
        {
          kind: 'source',
          suggestedPath: 'cognito/triggers/post-confirmation.js',
          description: 'Lambda trigger for post-confirmation actions',
          language: 'javascript',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/cognito-setup.md',
          description: 'User pool configuration, Lambda triggers, and hosted UI customization',
        },
      ];

    case 'web.keycloak':
      return [
        {
          kind: 'config',
          suggestedPath: 'keycloak/realm-export.json',
          description: 'Realm configuration with clients and roles',
          language: 'json',
        },
        {
          kind: 'config',
          suggestedPath: 'keycloak/docker-compose.yml',
          description: 'Docker Compose setup with PostgreSQL',
          language: 'yaml',
        },
        {
          kind: 'config',
          suggestedPath: 'keycloak/themes/custom/login/theme.properties',
          description: 'Custom theme configuration',
        },
        {
          kind: 'source',
          suggestedPath: 'keycloak/extensions/custom-authenticator.jar',
          description: 'Custom authenticator SPI implementation',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/keycloak-setup.md',
          description: 'Realm setup, client configuration, user federation, and theme customization',
        },
      ];

    case 'web.firebase-auth':
      return [
        {
          kind: 'config',
          suggestedPath: 'firebase.json',
          description: 'Firebase project configuration',
          language: 'json',
        },
        {
          kind: 'config',
          suggestedPath: '.firebaserc',
          description: 'Firebase project aliases',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'functions/src/auth-triggers.ts',
          description: 'Cloud Functions for auth lifecycle events',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'functions/src/custom-claims.ts',
          description: 'Functions to set custom claims',
          language: 'typescript',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/firebase-auth-setup.md',
          description: 'Provider configuration, custom claims, and Security Rules integration',
        },
      ];

    case 'web.azure-ad-b2c':
      return [
        {
          kind: 'config',
          suggestedPath: 'azure-ad-b2c/TrustFrameworkBase.xml',
          description: 'Custom policy base configuration',
          language: 'xml',
        },
        {
          kind: 'config',
          suggestedPath: 'azure-ad-b2c/TrustFrameworkExtensions.xml',
          description: 'Custom policy extensions',
          language: 'xml',
        },
        {
          kind: 'config',
          suggestedPath: 'azure-ad-b2c/SignUpOrSignIn.xml',
          description: 'Sign-up and sign-in user journey',
          language: 'xml',
        },
        {
          kind: 'config',
          suggestedPath: 'azure-ad-b2c/user-flows.json',
          description: 'User flow configurations',
          language: 'json',
        },
        {
          kind: 'doc',
          suggestedPath: 'docs/azure-ad-b2c-setup.md',
          description: 'Custom policies, user flows, API connectors, and identity providers',
        },
      ];

    default: {
      if (nodeType.suggestedFiles && nodeType.suggestedFiles.length > 0) {
        return nodeType.suggestedFiles.map(f => ({
          kind: f.kind as ArtifactPlaceholder['kind'],
          suggestedPath: f.path,
          description: f.description,
          language: f.language,
        }));
      }

      const typeName = nodeType.label.toLowerCase().replace(/\s+/g, '-');
      const langInfo = inferLanguageFromNodeType(nodeType.id);
      const placeholders: ArtifactPlaceholder[] = [];

      placeholders.push({
        kind: 'source',
        suggestedPath: `src/${typeName}/${langInfo.entryFile}`,
        description: `${nodeType.label} implementation`,
        language: langInfo.language,
      });

      if (nodeType.suggestedContracts?.some(c => c === 'rest' || c === 'graphql' || c === 'request_response')) {
        placeholders.push({
          kind: 'schema',
          suggestedPath: `schemas/${typeName}-schema.yaml`,
          description: 'API schema definition',
          language: 'yaml',
        });
      }

      placeholders.push({
        kind: 'doc',
        suggestedPath: `docs/${typeName}.md`,
        description: `${nodeType.label} documentation`,
      });

      return placeholders;
    }
  }
}

function generateContractTemplates(nodeType: DomainNodeType): ContractTemplate[] {
  if (!nodeType.suggestedContracts || nodeType.suggestedContracts.length === 0) {
    return [];
  }

  const contracts: ContractTemplate[] = [];
  const hasInPort = nodeType.defaultPorts?.some(p => p.direction === 'in');
  const hasOutPort = nodeType.defaultPorts?.some(p => p.direction === 'out');

  for (const rawKind of nodeType.suggestedContracts) {
    const resolved = resolveContractFields(rawKind);

    if (hasInPort) {
      contracts.push({
        kind: resolved.kind,
        name: `${resolved.kind.toUpperCase()} In`,
        portDirection: 'in',
        interactionKind: resolved.interactionKind,
        transport: resolved.transport,
        specFormat: resolved.specFormat,
      });
    }
    if (hasOutPort && contracts.length === 0) {
      contracts.push({
        kind: resolved.kind,
        name: `${resolved.kind.toUpperCase()} Out`,
        portDirection: 'out',
        interactionKind: resolved.interactionKind,
        transport: resolved.transport,
        specFormat: resolved.specFormat,
      });
    }
  }

  return contracts;
}

function generateTemplatesFromNodeTypes(): NodeTemplate[] {
  const templates: NodeTemplate[] = [];

  for (const domain of getNodeTypeDomains()) {
    for (const nodeType of domain.nodeTypes) {
      templates.push({
        id: nodeType.id,
        name: nodeType.label,
        description: nodeType.description,
        nodeType: nodeType.id,
        accentColor: nodeType.color,
        defaultPorts: nodeType.defaultPorts || [],
        defaultContracts: generateContractTemplates(nodeType),
        artifactPlaceholders: generateArtifactPlaceholders(nodeType),
        defaultData: {
          domain: nodeType.domain,
          aiContext: nodeType.aiContext,
        },
      });
    }
  }

  return templates;
}

let _templateCache: NodeTemplate[] | null = null;

export const NODE_TEMPLATES: NodeTemplate[] = new Proxy([] as NodeTemplate[], {
  get(_target, prop, receiver) {
    if (!_templateCache) {
      _templateCache = generateTemplatesFromNodeTypes();
    }
    return Reflect.get(_templateCache, prop, receiver);
  },
  has(_target, prop) {
    if (!_templateCache) {
      _templateCache = generateTemplatesFromNodeTypes();
    }
    return Reflect.has(_templateCache, prop);
  },
  ownKeys() {
    if (!_templateCache) {
      _templateCache = generateTemplatesFromNodeTypes();
    }
    return Reflect.ownKeys(_templateCache);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (!_templateCache) {
      _templateCache = generateTemplatesFromNodeTypes();
    }
    return Reflect.getOwnPropertyDescriptor(_templateCache, prop);
  },
});

export function invalidateTemplateCache(): void {
  _templateCache = null;
}

const LEGACY_TEMPLATE_ID_MAPPING: Record<string, string> = {
  'rest-service': 'web.rest-api',
  'event-producer': 'messaging.rabbitmq',
  'event-consumer': 'data.stream-processor',
  'frontend-module': 'frontend.react',
  'frontend.app': 'frontend.react',
  'web.frontend-spa': 'frontend.react',
  'web.frontend-ssr': 'frontend.next',
  'web.frontend-ssg': 'frontend.astro',
  'web.frontend-pwa': 'frontend.react',
};

export function getTemplateById(id: string): NodeTemplate | undefined {
  const mappedId = LEGACY_TEMPLATE_ID_MAPPING[id] || id;
  return NODE_TEMPLATES.find((t) => t.id === mappedId);
}

export function getTemplateByNodeType(nodeType: string): NodeTemplate | undefined {
  const mappedType = LEGACY_TEMPLATE_ID_MAPPING[nodeType] || nodeType;
  return NODE_TEMPLATES.find((t) => t.nodeType === mappedType);
}

export interface CompletenessRequirement {
  field: string;
  description: string;
  isMet: boolean;
}

export function getNodeCompletenessRequirements(
  node: { type: string; label: string; ports?: Port[]; artifacts?: string[]; data?: Record<string, unknown>; status?: EntityStatus },
  artifactCount: number
): CompletenessRequirement[] {
  const requirements: CompletenessRequirement[] = [];

  requirements.push({
    field: 'label',
    description: 'Node must have a meaningful label',
    isMet: node.label.length > 0 && node.label !== 'New Node' && !node.label.startsWith('Untitled'),
  });

  const template = getTemplateByNodeType(node.type);

  if (template) {
    const requiredInPorts = template.defaultPorts.filter(p => p.direction === 'in' && p.required);
    const requiredOutPorts = template.defaultPorts.filter(p => p.direction === 'out' && p.required);

    const nodePorts = node.ports ?? [];
    const hasRequiredInPorts = requiredInPorts.length === 0 ||
      nodePorts.some(p => p.direction === 'in');
    const hasRequiredOutPorts = requiredOutPorts.length === 0 ||
      nodePorts.some(p => p.direction === 'out');

    if (requiredInPorts.length > 0) {
      requirements.push({
        field: 'ports.in',
        description: 'Required input port must be configured',
        isMet: hasRequiredInPorts,
      });
    }

    if (requiredOutPorts.length > 0) {
      requirements.push({
        field: 'ports.out',
        description: 'Required output port must be configured',
        isMet: hasRequiredOutPorts,
      });
    }

    const minArtifacts = Math.min(1, template.artifactPlaceholders.length);
    requirements.push({
      field: 'artifacts',
      description: `At least ${minArtifacts} artifact should be attached`,
      isMet: artifactCount >= minArtifacts,
    });
  }

  return requirements;
}

export function isNodeComplete(
  node: { type: string; label: string; ports?: Port[]; artifacts?: string[]; data?: Record<string, unknown>; status?: EntityStatus },
  artifactCount: number
): boolean {
  const requirements = getNodeCompletenessRequirements(node, artifactCount);
  return requirements.every(r => r.isMet);
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: '.ts',
  javascript: '.js',
  python: '.py',
  go: '.go',
  rust: '.rs',
  java: '.java',
  csharp: '.cs',
  ruby: '.rb',
  php: '.php',
};

function getConfigExtension(language?: string): string {
  if (!language) return '.ts';
  return LANGUAGE_EXTENSIONS[language] || '.ts';
}

export function generateConfigArtifactPlaceholders(
  nodeType: string,
  domainMetadata: NodeDomainMetadata,
): ArtifactPlaceholder[] {
  const placeholders: ArtifactPlaceholder[] = [];

  if (domainMetadata.type === 'web-service') {
    const ws = domainMetadata.data as WebServiceMetadata;
    const hasConfigFields = ws.baseUrl || ws.port || ws.cors !== undefined || ws.rateLimit || ws.authStrategy;
    if (hasConfigFields) {
      const ext = getConfigExtension(ws.language);
      placeholders.push({
        kind: 'config',
        suggestedPath: `config/server.config${ext}`,
        description: 'Server configuration derived from architecture settings',
        language: ws.language || 'typescript',
      });
    }
  } else if (domainMetadata.type === 'managed-service') {
    const ms = domainMetadata.data as ManagedServiceMetadata;
    if (ms.provider) {
      const typeDef = getNodeTypeById(nodeType);
      const label = (typeDef?.label || nodeType).toLowerCase().replace(/\s+/g, '-');
      placeholders.push({
        kind: 'config',
        suggestedPath: `infrastructure/${label}.config.ts`,
        description: `Infrastructure configuration for ${ms.provider} ${typeDef?.label || nodeType}`,
        language: 'typescript',
      });
      const cloudProviders = ['aws', 'azure', 'gcp'];
      if (cloudProviders.includes(ms.provider.toLowerCase())) {
        placeholders.push({
          kind: 'schema',
          suggestedPath: `infrastructure/${label}.schema.json`,
          description: 'Service schema definition',
          language: 'json',
        });
      }
    }
  } else if (domainMetadata.type === 'database') {
    const db = domainMetadata.data as DatabaseMetadata;
    if (db.host || db.port) {
      const ext = getConfigExtension(undefined);
      placeholders.push({
        kind: 'config',
        suggestedPath: `config/database.config${ext}`,
        description: 'Database connection configuration',
        language: 'typescript',
      });
    }
  } else if (domainMetadata.type === 'cache') {
    const cache = domainMetadata.data as CacheMetadata;
    const ext = getConfigExtension(cache.language);
    placeholders.push({
      kind: 'config',
      suggestedPath: `config/cache.config${ext}`,
      description: 'Cache configuration',
      language: cache.language || 'typescript',
    });
  } else if (domainMetadata.type === 'message-queue') {
    placeholders.push({
      kind: 'config',
      suggestedPath: `config/queue.config.ts`,
      description: 'Message queue configuration',
      language: 'typescript',
    });
  }

  return placeholders;
}

export function getArtifactPlaceholdersForNode(node: Partial<Node>): ArtifactPlaceholder[] {
  const nodeType = node.type || '';

  // Check if this is a container type and generate container-specific artifacts
  const containerDef = getContainerTypeById(nodeType);
  if (containerDef) {
    const containerContext: ContainerArtifactContext = {
      containerId: node.id || '',
      containerType: nodeType,
      metadata: node.metadata,
      childNodeTypes: [], // Could be populated from graph if needed
    };
    return generateContainerArtifacts(containerContext);
  }

  // For non-container nodes, use the standard template system
  const template = getTemplateByNodeType(nodeType);
  if (!template) {
    return [];
  }

  const defaultPlaceholders = template.artifactPlaceholders;

  const domainMeta = node.metadata?.domainMetadata as NodeDomainMetadata | undefined;
  if (!domainMeta) {
    return defaultPlaceholders;
  }

  let language: ProgrammingLanguage | undefined;
  let framework: string | undefined;
  let runtime: string | undefined;

  if (domainMeta.type === 'web-service') {
    const ws = domainMeta.data as WebServiceMetadata;
    language = ws.language;
    framework = ws.framework;
    runtime = ws.runtime;
  } else if (domainMeta.type === 'frontend') {
    const fe = domainMeta.data as FrontendMetadata;
    language = fe.language || 'typescript';
    framework = fe.framework;
  } else if (domainMeta.type === 'auth-service') {
    const auth = domainMeta.data as AuthServiceMetadata;
    language = auth.language || 'typescript';
    framework = auth.framework;
  } else if (domainMeta.type === 'cache') {
    const cache = domainMeta.data as CacheMetadata;
    language = cache.language || 'typescript';
  }

  const configPlaceholders = generateConfigArtifactPlaceholders(nodeType, domainMeta);

  if (!language) {
    const existingPaths = new Set(defaultPlaceholders.map(p => p.suggestedPath));
    const uniqueConfig = configPlaceholders.filter(p => !existingPaths.has(p.suggestedPath));
    return [...defaultPlaceholders, ...uniqueConfig];
  }

  const context: LanguageTemplateContext = {
    nodeTypeId: nodeType,
    language,
    framework,
    runtime,
  };

  const languageSpecific = generateLanguageSpecificArtifacts(context);
  const merged = mergeArtifactPlaceholders(defaultPlaceholders, languageSpecific);
  const mergedPaths = new Set(merged.map(p => p.suggestedPath));
  const uniqueConfig = configPlaceholders.filter(p => !mergedPaths.has(p.suggestedPath));
  return [...merged, ...uniqueConfig];
}
