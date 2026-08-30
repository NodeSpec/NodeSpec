import type { ProgrammingLanguage } from './node-metadata.js';
import { EXTENDED_INTERFACE_ENRICHMENTS } from './interface-enrichment-extended.js';

/**
 * Interface Enrichment System
 *
 * Provides comprehensive metadata for all interface node types including:
 * - File types and examples
 * - Language-specific client libraries and SDKs
 * - Authentication strategies
 * - Configuration patterns
 * - Deployment contexts
 * - Security features
 * - Monitoring tools
 */

export interface InterfaceFileType {
  extension: string;
  description: string;
  purpose: 'schema' | 'config' | 'handler' | 'middleware' | 'route' | 'controller' | 'client' | 'test';
  example?: string;
}

export interface InterfaceClientLibrary {
  language: ProgrammingLanguage;
  name: string;
  package: string;
  description: string;
  popularity: 'primary' | 'popular' | 'alternative';
  features?: string[];
}

export interface AuthenticationStrategy {
  name: string;
  description: string;
  complexity: 'simple' | 'moderate' | 'complex';
  useCases: string[];
  implementation?: string;
}

export interface InterfaceConfigPattern {
  name: string;
  description: string;
  example: string;
  purpose: string;
}

export interface InterfaceDeploymentOption {
  provider: string;
  service: string;
  description: string;
  advantages: string[];
  considerations: string[];
}

export interface SecurityFeature {
  name: string;
  description: string;
  importance: 'critical' | 'recommended' | 'optional';
  implementation?: string;
}

export interface InterfaceEnrichment {
  interfaceId: string;
  displayName: string;
  category: 'api' | 'gateway' | 'realtime' | 'mesh';
  fileTypes: InterfaceFileType[];
  clientLibraries: InterfaceClientLibrary[];
  authStrategies: AuthenticationStrategy[];
  configPatterns: InterfaceConfigPattern[];
  deploymentOptions: InterfaceDeploymentOption[];
  securityFeatures: SecurityFeature[];
  monitoringTools: string[];
  testingTools: string[];
  performanceTips: string[];
}

// REST API Enrichment
const REST_API_ENRICHMENT: InterfaceEnrichment = {
  interfaceId: 'web.rest-api',
  displayName: 'REST API',
  category: 'api',
  fileTypes: [
    {
      extension: '.yaml',
      description: 'OpenAPI/Swagger specification',
      purpose: 'schema',
      example: 'openapi.yaml, swagger.yml',
    },
    {
      extension: '.json',
      description: 'API schema or request/response examples',
      purpose: 'schema',
      example: 'api-schema.json, examples.json',
    },
    {
      extension: '.ts/.js',
      description: 'Route handlers and controllers',
      purpose: 'handler',
      example: 'routes/users.ts, controllers/auth.ts',
    },
    {
      extension: '.ts/.js',
      description: 'Middleware (auth, validation, logging)',
      purpose: 'middleware',
      example: 'middleware/auth.ts, middleware/validation.ts',
    },
    {
      extension: '.env',
      description: 'Environment configuration',
      purpose: 'config',
      example: '.env, .env.example',
    },
  ],
  clientLibraries: [
    {
      language: 'typescript',
      name: 'Axios',
      package: 'axios',
      description: 'Promise-based HTTP client with interceptors',
      popularity: 'primary',
      features: ['Interceptors', 'TypeScript support', 'Request cancellation', 'Automatic transforms'],
    },
    {
      language: 'typescript',
      name: 'Fetch API',
      package: 'native',
      description: 'Native browser and Node.js HTTP client',
      popularity: 'primary',
      features: ['Native', 'Streaming', 'AbortController', 'Modern'],
    },
    {
      language: 'typescript',
      name: 'OpenAPI Generator',
      package: '@openapitools/openapi-generator-cli',
      description: 'Generate TypeScript clients from OpenAPI specs',
      popularity: 'popular',
      features: ['Type-safe', 'Generated from spec', 'Multiple templates'],
    },
    {
      language: 'python',
      name: 'Requests',
      package: 'requests',
      description: 'Simple, elegant HTTP library',
      popularity: 'primary',
      features: ['Simple API', 'Session support', 'SSL verification', 'Cookies'],
    },
    {
      language: 'python',
      name: 'httpx',
      package: 'httpx',
      description: 'Modern async-capable HTTP client',
      popularity: 'popular',
      features: ['Async support', 'HTTP/2', 'Connection pooling'],
    },
    {
      language: 'python',
      name: 'aiohttp',
      package: 'aiohttp',
      description: 'Async HTTP client/server framework',
      popularity: 'popular',
      features: ['Async/await', 'WebSocket support', 'Client and server'],
    },
    {
      language: 'java',
      name: 'OkHttp',
      package: 'com.squareup.okhttp3:okhttp',
      description: 'Efficient HTTP client with connection pooling',
      popularity: 'primary',
      features: ['Connection pooling', 'GZIP compression', 'Response caching'],
    },
    {
      language: 'java',
      name: 'Retrofit',
      package: 'com.squareup.retrofit2:retrofit',
      description: 'Type-safe HTTP client using interfaces',
      popularity: 'primary',
      features: ['Type-safe', 'Annotation-based', 'Converter support'],
    },
    {
      language: 'java',
      name: 'Spring RestTemplate',
      package: 'org.springframework:spring-web',
      description: 'Spring framework REST client',
      popularity: 'popular',
      features: ['Spring integration', 'Message converters', 'Error handling'],
    },
    {
      language: 'go',
      name: 'net/http',
      package: 'net/http (stdlib)',
      description: 'Go standard library HTTP client',
      popularity: 'primary',
      features: ['Standard library', 'Efficient', 'Full-featured'],
    },
    {
      language: 'go',
      name: 'Resty',
      package: 'github.com/go-resty/resty',
      description: 'Simple HTTP and REST client with middleware',
      popularity: 'popular',
      features: ['Middleware', 'Retry logic', 'Rate limiting'],
    },
    {
      language: 'csharp',
      name: 'HttpClient',
      package: 'System.Net.Http',
      description: '.NET HTTP client with async support',
      popularity: 'primary',
      features: ['Async', 'Connection pooling', 'Custom handlers'],
    },
    {
      language: 'csharp',
      name: 'RestSharp',
      package: 'RestSharp',
      description: 'Simple REST and HTTP client for .NET',
      popularity: 'popular',
      features: ['Simple API', 'Serialization', 'Authentication helpers'],
    },
    {
      language: 'rust',
      name: 'reqwest',
      package: 'reqwest',
      description: 'High-level HTTP client',
      popularity: 'primary',
      features: ['Async', 'JSON support', 'Connection pooling'],
    },
    {
      language: 'rust',
      name: 'hyper',
      package: 'hyper',
      description: 'Fast HTTP implementation',
      popularity: 'popular',
      features: ['Low-level', 'HTTP/2', 'Fast'],
    },
    {
      language: 'php',
      name: 'Guzzle',
      package: 'guzzlehttp/guzzle',
      description: 'PHP HTTP client with PSR-7 support',
      popularity: 'primary',
      features: ['Middleware', 'Streaming', 'Async'],
    },
    {
      language: 'ruby',
      name: 'Faraday',
      package: 'faraday',
      description: 'HTTP client library with middleware',
      popularity: 'primary',
      features: ['Middleware', 'Adapters', 'Test helpers'],
    },
  ],
  authStrategies: [
    {
      name: 'JWT (JSON Web Tokens)',
      description: 'Stateless token-based authentication',
      complexity: 'moderate',
      useCases: ['Microservices', 'Mobile apps', 'SPAs', 'API-to-API'],
      implementation: 'Use libraries like jsonwebtoken, jose, or jwt-go',
    },
    {
      name: 'OAuth 2.0',
      description: 'Delegated authorization framework',
      complexity: 'complex',
      useCases: ['Third-party integrations', 'Social login', 'API access delegation'],
      implementation: 'Use Passport.js, Authlib, or Spring Security OAuth',
    },
    {
      name: 'API Keys',
      description: 'Simple token-based authentication',
      complexity: 'simple',
      useCases: ['Service-to-service', 'Server-side apps', 'Internal APIs'],
      implementation: 'Custom middleware or API key rotation service',
    },
    {
      name: 'Basic Auth',
      description: 'Username and password encoded in headers',
      complexity: 'simple',
      useCases: ['Internal tools', 'Simple APIs', 'Dev environments'],
      implementation: 'Native HTTP Basic Authentication',
    },
    {
      name: 'Bearer Tokens',
      description: 'Opaque tokens for API access',
      complexity: 'simple',
      useCases: ['API access', 'Mobile apps', 'Server-to-server'],
      implementation: 'Custom token generation and validation',
    },
    {
      name: 'mTLS (Mutual TLS)',
      description: 'Certificate-based mutual authentication',
      complexity: 'complex',
      useCases: ['Service mesh', 'High security', 'Microservices'],
      implementation: 'TLS certificates and validation',
    },
  ],
  configPatterns: [
    {
      name: 'Rate Limiting',
      description: 'Limit requests per time window',
      example: '{ "windowMs": 900000, "max": 100 }',
      purpose: 'Prevent abuse and ensure fair usage',
    },
    {
      name: 'CORS Configuration',
      description: 'Cross-Origin Resource Sharing settings',
      example: '{ "origin": ["https://app.example.com"], "credentials": true }',
      purpose: 'Allow browser clients to access API',
    },
    {
      name: 'Request Timeout',
      description: 'Maximum request duration',
      example: '{ "timeout": 30000 }',
      purpose: 'Prevent hanging connections',
    },
    {
      name: 'Body Size Limits',
      description: 'Maximum request body size',
      example: '{ "limit": "10mb" }',
      purpose: 'Prevent large payload attacks',
    },
    {
      name: 'Compression',
      description: 'Response compression settings',
      example: '{ "threshold": 1024, "level": 6 }',
      purpose: 'Reduce bandwidth usage',
    },
  ],
  deploymentOptions: [
    {
      provider: 'AWS',
      service: 'Elastic Beanstalk',
      description: 'Managed application platform',
      advantages: ['Auto-scaling', 'Load balancing', 'Monitoring'],
      considerations: ['Platform constraints', 'Deployment time'],
    },
    {
      provider: 'AWS',
      service: 'ECS/Fargate',
      description: 'Containerized deployment',
      advantages: ['Docker support', 'Serverless containers', 'Fine-grained control'],
      considerations: ['Container complexity', 'Cold starts'],
    },
    {
      provider: 'Vercel',
      service: 'Serverless Functions',
      description: 'Edge-deployed serverless APIs',
      advantages: ['Global edge network', 'Zero config', 'Fast deployments'],
      considerations: ['Execution limits', 'Stateless'],
    },
    {
      provider: 'Railway',
      service: 'Railway App',
      description: 'Simple deployment platform',
      advantages: ['Simple', 'Git-based', 'Environment management'],
      considerations: ['Pricing', 'Limited customization'],
    },
    {
      provider: 'Kubernetes',
      service: 'Deployment',
      description: 'Container orchestration',
      advantages: ['Highly scalable', 'Self-healing', 'Rolling updates'],
      considerations: ['Complexity', 'Management overhead'],
    },
  ],
  securityFeatures: [
    {
      name: 'Input Validation',
      description: 'Validate and sanitize all inputs',
      importance: 'critical',
      implementation: 'Use libraries like Joi, Yup, or class-validator',
    },
    {
      name: 'Rate Limiting',
      description: 'Throttle requests to prevent abuse',
      importance: 'critical',
      implementation: 'express-rate-limit, fastapi-limiter, or API gateway features',
    },
    {
      name: 'HTTPS/TLS',
      description: 'Encrypt traffic in transit',
      importance: 'critical',
      implementation: 'Use SSL certificates (Let\'s Encrypt, AWS ACM)',
    },
    {
      name: 'Authentication & Authorization',
      description: 'Verify identity and permissions',
      importance: 'critical',
      implementation: 'JWT, OAuth2, or session-based auth',
    },
    {
      name: 'SQL Injection Prevention',
      description: 'Use parameterized queries',
      importance: 'critical',
      implementation: 'ORMs or prepared statements',
    },
    {
      name: 'CORS Configuration',
      description: 'Control cross-origin access',
      importance: 'critical',
      implementation: 'CORS middleware with whitelist',
    },
    {
      name: 'Security Headers',
      description: 'Set protective HTTP headers',
      importance: 'recommended',
      implementation: 'Helmet.js, SecureHeaders, or custom middleware',
    },
    {
      name: 'API Versioning',
      description: 'Version APIs for backward compatibility',
      importance: 'recommended',
      implementation: 'URL path (/v1/) or headers',
    },
    {
      name: 'Request Logging',
      description: 'Log all requests for auditing',
      importance: 'recommended',
      implementation: 'Morgan, Winston, or structured logging',
    },
  ],
  monitoringTools: [
    'Prometheus + Grafana',
    'Datadog',
    'New Relic',
    'AWS CloudWatch',
    'Elastic APM',
    'Sentry (error tracking)',
    'Jaeger (distributed tracing)',
    'OpenTelemetry',
    'Instana',
    'Dynatrace',
  ],
  testingTools: [
    'Postman',
    'Insomnia',
    'curl',
    'HTTPie',
    'Jest + Supertest',
    'Pytest + requests',
    'RestAssured (Java)',
    'Pact (contract testing)',
    'k6 (load testing)',
    'Artillery (load testing)',
  ],
  performanceTips: [
    'Implement response caching (Redis, CDN)',
    'Use connection pooling for databases',
    'Enable HTTP/2 or HTTP/3',
    'Implement pagination for large datasets',
    'Use ETags for conditional requests',
    'Compress responses (gzip, brotli)',
    'Optimize database queries with indexes',
    'Use async/await for I/O operations',
    'Implement request batching where applicable',
    'Monitor and optimize slow endpoints',
  ],
};

// GraphQL API Enrichment
const GRAPHQL_API_ENRICHMENT: InterfaceEnrichment = {
  interfaceId: 'web.graphql-api',
  displayName: 'GraphQL API',
  category: 'api',
  fileTypes: [
    {
      extension: '.graphql/.gql',
      description: 'GraphQL schema definition',
      purpose: 'schema',
      example: 'schema.graphql, types.gql',
    },
    {
      extension: '.ts/.js',
      description: 'Resolvers and data fetching logic',
      purpose: 'handler',
      example: 'resolvers/user.ts, resolvers/query.ts',
    },
    {
      extension: '.ts/.js',
      description: 'GraphQL server configuration',
      purpose: 'config',
      example: 'server.ts, apollo-config.ts',
    },
    {
      extension: '.ts/.js',
      description: 'DataLoaders for batching',
      purpose: 'middleware',
      example: 'dataloaders/user.ts',
    },
    {
      extension: '.graphql',
      description: 'GraphQL queries and mutations (client)',
      purpose: 'client',
      example: 'queries/getUser.graphql',
    },
  ],
  clientLibraries: [
    {
      language: 'typescript',
      name: 'Apollo Client',
      package: '@apollo/client',
      description: 'Comprehensive GraphQL client with caching',
      popularity: 'primary',
      features: ['Caching', 'React integration', 'Subscriptions', 'Dev tools'],
    },
    {
      language: 'typescript',
      name: 'urql',
      package: 'urql',
      description: 'Lightweight, extensible GraphQL client',
      popularity: 'popular',
      features: ['Small bundle', 'Framework agnostic', 'Normalized cache', 'SSR support'],
    },
    {
      language: 'typescript',
      name: 'GraphQL Request',
      package: 'graphql-request',
      description: 'Minimal GraphQL client',
      popularity: 'popular',
      features: ['Lightweight', 'Simple', 'Promise-based'],
    },
    {
      language: 'python',
      name: 'gql',
      package: 'gql',
      description: 'GraphQL client for Python',
      popularity: 'primary',
      features: ['Async support', 'Subscriptions', 'Schema validation'],
    },
    {
      language: 'python',
      name: 'sgqlc',
      package: 'sgqlc',
      description: 'Simple GraphQL Client for Python',
      popularity: 'popular',
      features: ['Code generation', 'Type hints', 'Schema introspection'],
    },
    {
      language: 'java',
      name: 'Apollo Android',
      package: 'com.apollographql.apollo3:apollo-runtime',
      description: 'Type-safe GraphQL client for JVM',
      popularity: 'primary',
      features: ['Code generation', 'Caching', 'Kotlin support'],
    },
    {
      language: 'go',
      name: 'graphql-go',
      package: 'github.com/graphql-go/graphql',
      description: 'GraphQL implementation for Go',
      popularity: 'primary',
      features: ['Schema-first', 'Resolvers', 'Subscriptions'],
    },
    {
      language: 'go',
      name: 'gqlgen',
      package: 'github.com/99designs/gqlgen',
      description: 'Schema-first GraphQL server generator',
      popularity: 'popular',
      features: ['Code generation', 'Type-safe', 'Pluggable'],
    },
    {
      language: 'csharp',
      name: 'GraphQL.NET',
      package: 'GraphQL',
      description: 'GraphQL for .NET',
      popularity: 'primary',
      features: ['Schema-first', 'Code-first', 'Subscriptions'],
    },
    {
      language: 'rust',
      name: 'async-graphql',
      package: 'async-graphql',
      description: 'High-performance GraphQL server library',
      popularity: 'primary',
      features: ['Async', 'Type-safe', 'Federation support'],
    },
  ],
  authStrategies: [
    {
      name: 'Context-Based Auth',
      description: 'Authentication in GraphQL context',
      complexity: 'moderate',
      useCases: ['SPAs', 'Mobile apps', 'Standard GraphQL APIs'],
      implementation: 'Validate tokens in context initialization',
    },
    {
      name: 'Directive-Based Auth',
      description: 'Schema directives for authorization',
      complexity: 'moderate',
      useCases: ['Fine-grained permissions', 'Role-based access', 'Field-level security'],
      implementation: '@auth, @hasRole directives in schema',
    },
    {
      name: 'JWT in HTTP Headers',
      description: 'Bearer token authentication',
      complexity: 'simple',
      useCases: ['Server-to-server', 'Mobile clients', 'Web clients'],
      implementation: 'Parse Authorization header in context',
    },
  ],
  configPatterns: [
    {
      name: 'Query Complexity Limit',
      description: 'Prevent expensive nested queries',
      example: '{ "maxComplexity": 1000 }',
      purpose: 'Prevent DoS via complex queries',
    },
    {
      name: 'Query Depth Limit',
      description: 'Maximum nesting level',
      example: '{ "maxDepth": 10 }',
      purpose: 'Prevent deeply nested queries',
    },
    {
      name: 'Batching Configuration',
      description: 'DataLoader settings',
      example: '{ "cache": true, "maxBatchSize": 100 }',
      purpose: 'Optimize database queries',
    },
    {
      name: 'Introspection',
      description: 'Schema introspection in production',
      example: '{ "introspection": false }',
      purpose: 'Disable in production for security',
    },
  ],
  deploymentOptions: [
    {
      provider: 'AWS',
      service: 'AppSync',
      description: 'Managed GraphQL service',
      advantages: ['Fully managed', 'Real-time subscriptions', 'Offline support'],
      considerations: ['AWS lock-in', 'Resolver limitations'],
    },
    {
      provider: 'Hasura',
      service: 'Hasura Cloud',
      description: 'Instant GraphQL on Postgres',
      advantages: ['Auto-generated API', 'Real-time', 'Authorization'],
      considerations: ['Database coupling', 'Custom logic complexity'],
    },
    {
      provider: 'Apollo',
      service: 'Apollo Studio',
      description: 'GraphQL platform with monitoring',
      advantages: ['Schema registry', 'Operation tracking', 'Federation'],
      considerations: ['Pricing', 'Learning curve'],
    },
  ],
  securityFeatures: [
    {
      name: 'Query Complexity Analysis',
      description: 'Analyze and limit query cost',
      importance: 'critical',
      implementation: 'graphql-query-complexity or graphql-cost-analysis',
    },
    {
      name: 'Query Depth Limiting',
      description: 'Prevent deeply nested queries',
      importance: 'critical',
      implementation: 'graphql-depth-limit',
    },
    {
      name: 'Persistent Queries',
      description: 'Whitelist allowed queries',
      importance: 'recommended',
      implementation: 'Apollo automatic persisted queries',
    },
    {
      name: 'Field-Level Authorization',
      description: 'Control access to specific fields',
      importance: 'critical',
      implementation: 'Custom directives or shield library',
    },
    {
      name: 'Disable Introspection',
      description: 'Hide schema in production',
      importance: 'recommended',
      implementation: 'Apollo Server: introspection: false',
    },
  ],
  monitoringTools: [
    'Apollo Studio',
    'GraphQL Playground',
    'GraphiQL',
    'Hasura Console',
    'Prometheus + Grafana',
    'Datadog GraphQL monitoring',
    'New Relic',
    'Sentry',
  ],
  testingTools: [
    'Apollo Client DevTools',
    'GraphQL Playground',
    'Insomnia',
    'Postman',
    'Jest + graphql-tools',
    'EasyGraphQL Tester',
  ],
  performanceTips: [
    'Use DataLoader to batch and cache requests',
    'Implement field-level caching',
    'Optimize resolvers to avoid N+1 queries',
    'Use pagination (cursor or offset)',
    'Implement query complexity limits',
    'Cache results at CDN or application level',
    'Use database indexes for common queries',
    'Consider Apollo Federation for microservices',
  ],
};

// gRPC Service Enrichment
const GRPC_SERVICE_ENRICHMENT: InterfaceEnrichment = {
  interfaceId: 'web.grpc-service',
  displayName: 'gRPC Service',
  category: 'api',
  fileTypes: [
    {
      extension: '.proto',
      description: 'Protocol Buffer definitions',
      purpose: 'schema',
      example: 'service.proto, messages.proto',
    },
    {
      extension: '.ts/.js',
      description: 'gRPC service implementation',
      purpose: 'handler',
      example: 'services/user-service.ts',
    },
    {
      extension: '.ts/.js',
      description: 'gRPC server configuration',
      purpose: 'config',
      example: 'server.ts, grpc-config.ts',
    },
    {
      extension: '.go',
      description: 'Generated gRPC stubs (Go)',
      purpose: 'client',
      example: 'pb/service_grpc.pb.go',
    },
    {
      extension: '.py',
      description: 'Generated gRPC stubs (Python)',
      purpose: 'client',
      example: 'service_pb2_grpc.py',
    },
  ],
  clientLibraries: [
    {
      language: 'typescript',
      name: '@grpc/grpc-js',
      package: '@grpc/grpc-js',
      description: 'Pure JavaScript gRPC client',
      popularity: 'primary',
      features: ['Native implementation', 'Streaming', 'Metadata'],
    },
    {
      language: 'typescript',
      name: 'grpc-web',
      package: 'grpc-web',
      description: 'gRPC for browser clients',
      popularity: 'popular',
      features: ['Browser support', 'Unary and server streaming'],
    },
    {
      language: 'python',
      name: 'grpcio',
      package: 'grpcio',
      description: 'Official Python gRPC library',
      popularity: 'primary',
      features: ['Full gRPC support', 'Async support', 'Interceptors'],
    },
    {
      language: 'java',
      name: 'gRPC Java',
      package: 'io.grpc:grpc-netty',
      description: 'Java implementation of gRPC',
      popularity: 'primary',
      features: ['High performance', 'Interceptors', 'Context propagation'],
    },
    {
      language: 'go',
      name: 'google.golang.org/grpc',
      package: 'google.golang.org/grpc',
      description: 'Official Go gRPC library',
      popularity: 'primary',
      features: ['Native Go', 'Efficient', 'Context support'],
    },
    {
      language: 'csharp',
      name: 'Grpc.Net.Client',
      package: 'Grpc.Net.Client',
      description: '.NET gRPC client',
      popularity: 'primary',
      features: ['.NET Core integration', 'Async', 'HTTP/2'],
    },
    {
      language: 'rust',
      name: 'tonic',
      package: 'tonic',
      description: 'Native Rust gRPC implementation',
      popularity: 'primary',
      features: ['Async', 'Type-safe', 'Fast'],
    },
  ],
  authStrategies: [
    {
      name: 'Metadata-Based Auth',
      description: 'Authentication via gRPC metadata',
      complexity: 'simple',
      useCases: ['Service-to-service', 'API keys', 'JWT tokens'],
      implementation: 'Send tokens in metadata, validate in interceptors',
    },
    {
      name: 'mTLS',
      description: 'Mutual TLS authentication',
      complexity: 'complex',
      useCases: ['High security', 'Service mesh', 'Enterprise'],
      implementation: 'TLS certificates on both client and server',
    },
    {
      name: 'Interceptor-Based Auth',
      description: 'Authentication interceptors',
      complexity: 'moderate',
      useCases: ['Centralized auth', 'Token validation', 'Custom logic'],
      implementation: 'Server and client interceptors',
    },
  ],
  configPatterns: [
    {
      name: 'Keepalive Settings',
      description: 'Connection keepalive configuration',
      example: '{ "keepaliveTimeMs": 10000, "keepaliveTimeoutMs": 5000 }',
      purpose: 'Maintain long-lived connections',
    },
    {
      name: 'Max Message Size',
      description: 'Maximum message size limits',
      example: '{ "maxSendMessageLength": 4194304, "maxReceiveMessageLength": 4194304 }',
      purpose: 'Prevent memory issues',
    },
    {
      name: 'Connection Pool',
      description: 'Client connection pooling',
      example: '{ "maxConnections": 100 }',
      purpose: 'Optimize resource usage',
    },
    {
      name: 'Deadline/Timeout',
      description: 'Request timeout configuration',
      example: '{ "deadlineMs": 30000 }',
      purpose: 'Prevent hanging requests',
    },
  ],
  deploymentOptions: [
    {
      provider: 'Kubernetes',
      service: 'Service + Ingress',
      description: 'Native Kubernetes deployment',
      advantages: ['Service discovery', 'Load balancing', 'Health checks'],
      considerations: ['Requires HTTP/2 support', 'Ingress configuration'],
    },
    {
      provider: 'Envoy',
      service: 'Envoy Proxy',
      description: 'Layer 7 proxy for gRPC',
      advantages: ['Load balancing', 'Observability', 'Traffic management'],
      considerations: ['Additional component', 'Configuration complexity'],
    },
    {
      provider: 'AWS',
      service: 'App Mesh',
      description: 'Service mesh with gRPC support',
      advantages: ['Managed service', 'Observability', 'Traffic control'],
      considerations: ['AWS specific', 'Cost'],
    },
  ],
  securityFeatures: [
    {
      name: 'TLS Encryption',
      description: 'Encrypt gRPC traffic',
      importance: 'critical',
      implementation: 'SSL certificates, grpc.ssl_channel_credentials',
    },
    {
      name: 'Authentication Interceptors',
      description: 'Validate credentials on every call',
      importance: 'critical',
      implementation: 'Server interceptors with token validation',
    },
    {
      name: 'Authorization',
      description: 'Method-level access control',
      importance: 'critical',
      implementation: 'Custom interceptors with RBAC',
    },
    {
      name: 'Input Validation',
      description: 'Validate protobuf messages',
      importance: 'critical',
      implementation: 'Validate in service handlers',
    },
    {
      name: 'Rate Limiting',
      description: 'Throttle requests per client',
      importance: 'recommended',
      implementation: 'Interceptors with rate limiter',
    },
  ],
  monitoringTools: [
    'Prometheus + Grafana',
    'Jaeger (distributed tracing)',
    'OpenTelemetry',
    'Zipkin',
    'Datadog',
    'New Relic',
    'gRPC health checking protocol',
  ],
  testingTools: [
    'grpcurl',
    'BloomRPC',
    'Postman (gRPC support)',
    'Evans (gRPC CLI client)',
    'ghz (gRPC benchmarking)',
  ],
  performanceTips: [
    'Use streaming for large data transfers',
    'Implement connection pooling',
    'Enable HTTP/2 multiplexing',
    'Use binary protobuf serialization',
    'Implement client-side load balancing',
    'Cache compiled protobuf schemas',
    'Use deadline propagation',
    'Monitor and optimize slow RPCs',
  ],
};

export const INTERFACE_ENRICHMENTS: Record<string, InterfaceEnrichment> = {
  'web.rest-api': REST_API_ENRICHMENT,
  'web.graphql-api': GRAPHQL_API_ENRICHMENT,
  'web.grpc-service': GRPC_SERVICE_ENRICHMENT,
  ...EXTENDED_INTERFACE_ENRICHMENTS,
  'contract:rest': REST_API_ENRICHMENT,
  'contract:graphql': GRAPHQL_API_ENRICHMENT,
  'contract:grpc': GRPC_SERVICE_ENRICHMENT,
  'contract:websocket': EXTENDED_INTERFACE_ENRICHMENTS['web.websocket-server'],
};

export function getInterfaceEnrichment(interfaceId: string): InterfaceEnrichment | null {
  return INTERFACE_ENRICHMENTS[interfaceId] || null;
}

export function getInterfaceClientLibraries(
  interfaceId: string,
  language: ProgrammingLanguage
): InterfaceClientLibrary[] {
  const enrichment = getInterfaceEnrichment(interfaceId);
  if (!enrichment) return [];

  return enrichment.clientLibraries.filter(lib => lib.language === language);
}

export function getSupportedInterfaceLanguages(interfaceId: string): ProgrammingLanguage[] {
  const enrichment = getInterfaceEnrichment(interfaceId);
  if (!enrichment) return [];

  const languages = new Set<ProgrammingLanguage>();
  for (const lib of enrichment.clientLibraries) {
    languages.add(lib.language);
  }

  return Array.from(languages);
}

export function getAuthStrategies(interfaceId: string): AuthenticationStrategy[] {
  const enrichment = getInterfaceEnrichment(interfaceId);
  return enrichment?.authStrategies || [];
}

export function getConfigPatterns(interfaceId: string): InterfaceConfigPattern[] {
  const enrichment = getInterfaceEnrichment(interfaceId);
  return enrichment?.configPatterns || [];
}
