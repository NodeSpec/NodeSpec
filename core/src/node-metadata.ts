import type { DetectedDependency, DetectedEnvVar, DetectedAPIRoute } from './dependency-detection.js';
import { getNodeTypeById } from './node-types.js';

export type ProgrammingLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'go'
  | 'csharp'
  | 'rust'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'dart'
  | 'other';

export interface WebServiceMetadata {
  language?: ProgrammingLanguage;
  runtime?: string;
  framework?: string;
  version?: string;
  port?: number;
  baseUrl?: string;
  dependencies: DetectedDependency[];
  envVars: DetectedEnvVar[];
  apiRoutes: DetectedAPIRoute[];
  healthCheckPath?: string;
  authStrategy?: string;

  cors?: boolean;
  rateLimit?: number;
  documentation?: string;

  path?: string;
  playground?: boolean;
  depthLimit?: number;
  complexityLimit?: number;
  subscriptions?: boolean;

  reflection?: boolean;
  deadlineMs?: number;
  streaming?: boolean;
  loadBalancing?: string;

  pingInterval?: number;
  maxConnections?: number;
  perMessageDeflate?: boolean;
}

export interface FrontendMetadata {
  framework?: 'react' | 'vue' | 'angular' | 'svelte' | 'solid' | 'preact' | 'qwik' | 'alpine' | 'htmx' | 'blazor' | 'yew' | 'dioxus' | 'other';
  frameworkVersion?: string;
  language?: ProgrammingLanguage;
  buildTool?: 'vite' | 'webpack' | 'rollup' | 'parcel' | 'esbuild' | 'turbopack' | 'other';
  deploymentType?: 'spa' | 'ssr' | 'ssg' | 'pwa' | 'hybrid';
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  devServerPort?: number;
  stateManagement?: 'redux' | 'zustand' | 'jotai' | 'recoil' | 'mobx' | 'pinia' | 'vuex' | 'context' | 'none' | 'other';
  styling?: 'css' | 'sass' | 'tailwind' | 'styled-components' | 'emotion' | 'css-modules' | 'vanilla-extract' | 'other';
  router?: 'react-router' | 'vue-router' | 'tanstack-router' | 'next' | 'nuxt' | 'sveltekit' | 'other';
  testing?: string[];
  dependencies: DetectedDependency[];
  envVars: DetectedEnvVar[];
  pages: FrontendPage[];
  components: FrontendComponent[];
  apiEndpoints: string[];
  figmaIntegration?: FigmaIntegration;
  designTokens?: DesignTokens;
  bundleSize?: {
    target: string;
    current?: string;
  };
  lighthouse?: {
    performance?: number;
    accessibility?: number;
    bestPractices?: number;
    seo?: number;
  };
}

export interface FrontendPage {
  path: string;
  name: string;
  description?: string;
  figmaNodeId?: string;
}

export interface FrontendComponent {
  name: string;
  path: string;
  type: 'layout' | 'ui' | 'feature' | 'page';
  figmaNodeId?: string;
}

export interface FigmaIntegration {
  fileKey?: string;
  fileUrl?: string;
  accessToken?: string;
  lastSyncedAt?: string;
  syncedNodes: FigmaSyncedNode[];
}

export interface FigmaSyncedNode {
  figmaNodeId: string;
  nodeName: string;
  nodeType: 'FRAME' | 'COMPONENT' | 'INSTANCE' | 'GROUP' | 'PAGE';
  imageUrl?: string;
  thumbnailUrl?: string;
  exportFormat?: 'png' | 'svg' | 'jpg';
  width?: number;
  height?: number;
  syncedAt: string;
}

export interface DesignTokens {
  colors?: Record<string, string>;
  typography?: Record<string, string>;
  spacing?: Record<string, string>;
  borderRadius?: Record<string, string>;
}

export interface DatabaseMetadata {
  dbType: 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'dynamodb' | 'other';
  version?: string;
  host?: string;
  port?: number;
  database?: string;
  tables: DatabaseTable[];
  migrations: DatabaseMigration[];
  indexes: DatabaseIndex[];
  connectionPoolSize?: number;
  backupStrategy?: string;
}

export interface DatabaseTable {
  name: string;
  schema?: string;
  columns: DatabaseColumn[];
  primaryKey?: string[];
  foreignKeys?: DatabaseForeignKey[];
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  description?: string;
}

export interface DatabaseForeignKey {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface DatabaseMigration {
  version: string;
  name: string;
  appliedAt?: string;
  status: 'pending' | 'applied' | 'failed';
}

export interface DatabaseIndex {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  type?: 'btree' | 'hash' | 'gin' | 'gist';
}

export interface AuthServiceMetadata {
  provider: string;
  language?: ProgrammingLanguage;
  framework?: string;
  strategies: AuthStrategy[];
  jwtConfig?: JWTConfig;
  sessionConfig?: SessionConfig;
  mfaEnabled: boolean;
  socialProviders: string[];
  providerConfig?: Record<string, unknown>;
}

export interface AuthStrategy {
  name: string;
  type: 'local' | 'oauth' | 'saml' | 'ldap' | 'jwt';
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface JWTConfig {
  algorithm: string;
  expiresIn: string;
  refreshTokenExpiresIn?: string;
  issuer?: string;
  audience?: string;
}

export interface SessionConfig {
  store: 'memory' | 'redis' | 'database';
  maxAge: number;
  secure: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

export interface CacheMetadata {
  cacheType: 'redis' | 'memcached' | 'valkey' | 'elasticache' | 'cloudflare-kv' | 'in-memory';
  language?: ProgrammingLanguage;
  host?: string;
  port?: number;
  ttl?: number;
  maxSize?: number;
  evictionPolicy?: 'lru' | 'lfu' | 'fifo';
  keyPatterns: string[];
  clusterMode?: boolean;
  persistenceEnabled?: boolean;
  providerConfig?: Record<string, unknown>;
}

export interface MessageQueueMetadata {
  queueType: 'rabbitmq' | 'kafka' | 'sqs' | 'redis' | 'other';
  host?: string;
  port?: number;
  queues: QueueDefinition[];
  exchanges?: ExchangeDefinition[];
  consumerGroups?: string[];
}

export type MobilePlatform = 'ios' | 'android' | 'cross-platform';
export type MobileFramework = 'swiftui' | 'uikit' | 'jetpack-compose' | 'flutter' | 'react-native' | 'dioxus' | 'other';
export type MobileArchitecture = 'mvvm' | 'mvc' | 'mvi' | 'clean' | 'viper' | 'bloc' | 'redux' | 'other';

export interface MobileMetadata {
  platform: MobilePlatform;
  language: ProgrammingLanguage;
  framework: MobileFramework;
  uiFramework?: string;
  minDeploymentTarget?: string;
  minSdk?: number;
  architecture: MobileArchitecture;
  stateManagement?: string;
  navigation?: string;
  dependencies: DetectedDependency[];
  envVars: DetectedEnvVar[];
  screens: MobileScreen[];
  bundleId?: string;
  packageName?: string;
  features?: string[];
}

export interface MobileScreen {
  name: string;
  path: string;
  description?: string;
}

export interface AIServiceMetadata {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  streaming?: boolean;
  functionCalling?: boolean;
  contextWindow?: number;
  apiKeyEnvVar?: string;
  [key: string]: unknown;
}

export interface ObjectStorageMetadata {
  provider: 'aws-s3' | 'azure-blob-storage' | 'gcs' | 'minio' | 'other';
  region?: string;
  bucketName?: string;
  accessControl?: 'private' | 'public-read' | 'acl-based';
  versioning?: boolean;
  encryption?: string;
  storageClass?: string;
  lifecyclePolicies?: boolean;
}

export interface ManagedServiceMetadata {
  provider: string;
  region?: string;
  tier?: string;
  version?: string;
  port?: number;
  configEntries: ManagedServiceConfigEntry[];
  envVars: DetectedEnvVar[];
}

export interface ManagedServiceConfigEntry {
  key: string;
  value: string;
  sensitive?: boolean;
}

export interface QueueDefinition {
  name: string;
  durable: boolean;
  deadLetterQueue?: string;
  maxRetries?: number;
  messageCount?: number;
}

export interface ExchangeDefinition {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers';
  durable: boolean;
}

export type NodeDomainMetadata =
  | { type: 'web-service'; data: WebServiceMetadata }
  | { type: 'frontend'; data: FrontendMetadata }
  | { type: 'database'; data: DatabaseMetadata }
  | { type: 'auth-service'; data: AuthServiceMetadata }
  | { type: 'cache'; data: CacheMetadata }
  | { type: 'message-queue'; data: MessageQueueMetadata }
  | { type: 'object-storage'; data: ObjectStorageMetadata }
  | { type: 'managed-service'; data: ManagedServiceMetadata }
  | { type: 'mobile'; data: MobileMetadata }
  | { type: 'inference-service'; data: AIServiceMetadata }
  | { type: 'ai-service'; data: AIServiceMetadata };

export function getMetadataTypeForNodeType(nodeType: string): string | null {
  const mapping: Record<string, string> = {
    'web.rest-api': 'web-service',
    'web.graphql-api': 'web-service',
    'web.grpc-service': 'web-service',
    'gateway.aws-api-gateway': 'managed-service',
    'gateway.azure-api-management': 'managed-service',
    'gateway.gcp-api-gateway': 'managed-service',
    'gateway.kong': 'managed-service',
    'lb.aws-alb': 'managed-service',
    'lb.aws-nlb': 'managed-service',
    'lb.azure-load-balancer': 'managed-service',
    'lb.azure-app-gateway': 'managed-service',
    'lb.gcp-load-balancer': 'managed-service',
    'lb.nginx': 'managed-service',
    'lb.haproxy': 'managed-service',
    'mesh.istio': 'managed-service',
    'mesh.linkerd': 'managed-service',
    'mesh.consul': 'managed-service',
    'web.websocket-server': 'web-service',
    'frontend.react': 'frontend',
    'frontend.vue': 'frontend',
    'frontend.angular': 'frontend',
    'frontend.svelte': 'frontend',
    'frontend.solid': 'frontend',
    'frontend.next': 'frontend',
    'frontend.nuxt': 'frontend',
    'frontend.astro': 'frontend',
    'frontend.blazor': 'frontend',
    'frontend.yew': 'frontend',
    'web.frontend-spa': 'frontend',
    'web.frontend-ssr': 'frontend',
    'web.frontend-ssg': 'frontend',
    'web.frontend-pwa': 'frontend',
    'database.postgresql': 'database',
    'database.mysql': 'database',
    'database.mongodb': 'database',
    'database.redis': 'database',
    'database.dynamodb': 'database',
    'database.cosmosdb': 'database',
    'database.firestore': 'database',
    'database.neo4j': 'database',
    'database.elasticsearch': 'database',
    'database.influxdb': 'database',
    'database.cassandra': 'database',
    'database.supabase': 'database',
    'web.database': 'database',
    'web.cache': 'cache',
    'messaging.rabbitmq': 'message-queue',
    'messaging.nats': 'message-queue',
    'data.apache-kafka': 'message-queue',
    'web.auth-service': 'auth-service',
    'auth.supabase-auth': 'auth-service',
    'auth.auth0': 'auth-service',
    'auth.aws-cognito': 'auth-service',
    'auth.keycloak': 'auth-service',
    'auth.firebase-auth': 'auth-service',
    'auth.azure-ad-b2c': 'auth-service',
    'cache.redis': 'cache',
    'cache.memcached': 'cache',
    'cache.valkey': 'cache',
    'cache.elasticache': 'cache',
    'cache.cloudflare-kv': 'cache',
    'mobile.swift': 'mobile',
    'mobile.kotlin': 'mobile',
    'mobile.flutter': 'mobile',
    'mobile.react-native': 'mobile',
    'mobile.dioxus': 'mobile',
    'frontend.dioxus': 'mobile',
    'backend.nodejs': 'web-service',
    'backend.rust': 'web-service',
    'backend.python': 'web-service',
    'backend.go': 'web-service',
    'external.service': 'managed-service',
    'external.webhook': 'managed-service',
    'web.cdn': 'cdn',
    'cloud.cdn.cloudfront': 'cdn',
    'ai.openai-api': 'inference-service',
    'ai.anthropic-claude': 'inference-service',
    'ai.langchain': 'inference-service',
    'ai.agent': 'inference-service',
    'ai.rag-pipeline': 'inference-service',
    'ai.aws-sagemaker': 'inference-service',
    'vectordb.pinecone': 'vector-database',
    'vectordb.weaviate': 'database',
    'mlops.pipeline': 'inference-service',
    'mlops.model-registry': 'inference-service',
    'mlops.feature-store': 'inference-service',
    'mlops.model-serving': 'inference-service',
    'messaging.kafka': 'message-queue',
    'messaging.sqs': 'message-queue',
    'cloud.storage.s3': 'object-storage',
    'cloud.storage.azure-blob': 'object-storage',
    'cloud.storage.gcs': 'object-storage',
    'cloud.storage.minio': 'object-storage',

    // Current role IDs (v8 ontology)
    'backend-service': 'web-service',
    'frontend-app': 'frontend',
    'static-site': 'frontend',
    'mobile-app': 'mobile',
    'desktop-app': 'frontend',
    'game-client': 'frontend',
    'game-server': 'web-service',
    'worker': 'web-service',
    'realtime-service': 'web-service',
    'webhook-handler': 'web-service',
    'scheduler-service': 'web-service',
    'cli-tool': 'web-service',
    'serverless-function': 'web-service',
    'shared-library': 'web-service',
    'firmware-service': 'web-service',
    'ros2-node': 'web-service',

    'database': 'database',
    'graph-db': 'database',
    'data-warehouse': 'database',
    'time-series-db': 'database',
    'search-engine': 'database',
    'vector-database': 'database',
    'feature-store': 'database',
    'model-registry': 'database',
    'event-store': 'database',
    'cache': 'cache',
    'object-storage': 'object-storage',

    'auth-provider': 'auth-service',

    'message-broker': 'message-queue',
    'queue': 'message-queue',
    'topic': 'message-queue',
    'event-stream': 'message-queue',

    'inference-service': 'inference-service',
    'ai-agent-service': 'ai-service',
    'llm-gateway': 'ai-service',
    'llm-runtime': 'ai-service',
    'data-prep-pipeline': 'managed-service',
    'evaluation-pipeline': 'managed-service',
    'ml-pipeline': 'managed-service',

    'api-gateway': 'managed-service',
    'load-balancer': 'managed-service',
    'cdn': 'managed-service',
    'dns': 'managed-service',
    'waf': 'managed-service',
    'certificate-manager': 'managed-service',
    'secret-manager': 'managed-service',
    'service-mesh': 'managed-service',
    'monitoring': 'managed-service',
    'logging': 'managed-service',

    'external-service': 'managed-service',
    'external-data': 'managed-service',

    'build-pipeline': 'managed-service',
    'ci-pipeline': 'managed-service',
    'cd-pipeline': 'managed-service',
    'iac-workflow': 'managed-service',
    'migration-workflow': 'managed-service',
    'scheduled-trigger': 'managed-service',

    'sensor': 'managed-service',
    'microcontroller': 'managed-service',
    'embedded-device': 'managed-service',
    'gateway-device': 'managed-service',
    'actuator': 'managed-service',
    'robot': 'managed-service',
    'mobile-device': 'managed-service',

    // Platform capabilities
    'aws-lambda': 'managed-service',
    'aws-rds': 'database',
    'aws-s3': 'object-storage',
    'aws-sqs': 'message-queue',
    'aws-eventbridge': 'message-queue',
    'azure-functions': 'managed-service',
    'azure-cosmos-db': 'database',
    'azure-blob-storage': 'object-storage',
    'azure-service-bus': 'message-queue',
    'azure-event-grid': 'message-queue',
    'gcp-cloud-functions': 'managed-service',
    'gcp-cloud-run': 'managed-service',
    'gcp-cloud-sql': 'database',
    'gcp-cloud-storage': 'object-storage',
    'gcp-cloud-pub-sub': 'message-queue',
    'cloudflare-workers': 'managed-service',
    'cloudflare-r2': 'object-storage',
    'firebase-auth': 'managed-service',
    'firebase-firestore': 'database',
    'supabase-auth': 'managed-service',
    'supabase-database': 'database',
    'supabase-edge-functions': 'managed-service',
    'supabase-storage': 'object-storage',
  };

  return mapping[nodeType] || null;
}

export function createDefaultMetadataForNodeType(nodeType: string): NodeDomainMetadata | null {
  const metadataType = getMetadataTypeForNodeType(nodeType);

  switch (metadataType) {
    case 'web-service':
      return {
        type: 'web-service',
        data: {
          dependencies: [],
          envVars: [],
          apiRoutes: [],
        },
      };
    case 'frontend':
      return {
        type: 'frontend',
        data: {
          dependencies: [],
          envVars: [],
          pages: [],
          components: [],
          apiEndpoints: [],
        },
      };
    case 'database':
      return {
        type: 'database',
        data: {
          dbType: 'postgres',
          tables: [],
          migrations: [],
          indexes: [],
        },
      };
    case 'auth-service':
      return {
        type: 'auth-service',
        data: {
          provider: '',
          strategies: [],
          mfaEnabled: false,
          socialProviders: [],
        },
      };
    case 'cache':
      return {
        type: 'cache',
        data: {
          cacheType: 'redis',
          keyPatterns: [],
        },
      };
    case 'message-queue':
      return {
        type: 'message-queue',
        data: {
          queueType: 'rabbitmq',
          queues: [],
        },
      };
    case 'object-storage':
      return {
        type: 'object-storage',
        data: {
          provider: 'aws-s3',
          accessControl: 'private',
          versioning: false,
        },
      };
    case 'managed-service':
      return {
        type: 'managed-service',
        data: {
          provider: '',
          configEntries: [],
          envVars: [],
        },
      };
    case 'mobile':
      return {
        type: 'mobile',
        data: {
          platform: 'cross-platform',
          language: 'typescript',
          framework: 'react-native',
          architecture: 'mvvm',
          dependencies: [],
          envVars: [],
          screens: [],
        },
      };
    case 'inference-service':
    case 'ai-service':
      return {
        type: 'inference-service',
        data: {
          model: '',
          streaming: true,
          functionCalling: false,
        },
      };
    default:
      return null;
  }
}

export function extractNodeDomainMetadata(nodeMetadata: Record<string, unknown> | undefined): NodeDomainMetadata | null {
  if (!nodeMetadata || !nodeMetadata.domainMetadata) {
    return null;
  }

  const domainMeta = nodeMetadata.domainMetadata;

  if (typeof domainMeta !== 'object' || domainMeta === null) {
    return null;
  }

  const meta = domainMeta as Record<string, unknown>;
  if (!meta.type || typeof meta.type !== 'string') {
    return null;
  }

  const validTypes = ['web-service', 'frontend', 'database', 'auth-service', 'cache', 'message-queue', 'managed-service', 'mobile', 'inference-service', 'ai-service'];
  if (!validTypes.includes(meta.type)) {
    return null;
  }

  return meta as NodeDomainMetadata;
}

export function getMetadataDefaultsForNodeType(nodeTypeId: string): Record<string, unknown> {
  const nodeTypeDef = getNodeTypeById(nodeTypeId);
  if (nodeTypeDef?.defaultMetadata) {
    return { ...nodeTypeDef.defaultMetadata };
  }
  const metadataType = getMetadataTypeForNodeType(nodeTypeId);
  return metadataType ? getMetadataDefaults(metadataType) : {};
}

export function getMetadataDefaults(metadataType: string): Record<string, unknown> {
  switch (metadataType) {
    case 'frontend':
      return {
        framework: 'react',
        language: 'typescript',
        buildTool: 'vite',
        deploymentType: 'spa',
        packageManager: 'npm',
        stateManagement: 'none',
        styling: 'css',
      };
    case 'web-service':
      return {
        language: 'typescript',
        runtime: 'node',
        framework: 'express',
        port: 3000,
      };
    case 'database':
      return {
        dbType: 'postgres',
        port: 5432,
      };
    case 'auth-service':
      return {
        provider: 'supabase',
        language: 'typescript',
        mfaEnabled: false,
      };
    case 'cache':
      return {
        cacheType: 'redis',
        language: 'typescript',
        port: 6379,
        ttl: 3600,
        evictionPolicy: 'lru',
      };
    case 'message-queue':
      return {
        queueType: 'rabbitmq',
        port: 5672,
      };
    case 'managed-service':
      return {
        provider: '',
      };
    case 'mobile':
      return {
        platform: 'cross-platform',
        language: 'typescript',
        framework: 'react-native',
        architecture: 'mvvm',
      };
    case 'inference-service':
    case 'ai-service':
      return {
        model: '',
        streaming: true,
      };
    default:
      return {};
  }
}
