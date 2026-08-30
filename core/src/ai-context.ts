import type { Graph, Artifact, Node, Contract, Port, Edge } from './types.js';
import { getNodeTypeById, type DomainNodeType } from './node-types.js';
import { validationEngine } from './validation/engine.js';
import type { NodeValidationResult } from './validation/types.js';
import type {
  NodeDomainMetadata,
  FrontendMetadata,
  WebServiceMetadata,
  DatabaseMetadata,
  AuthServiceMetadata,
  CacheMetadata,
  MessageQueueMetadata,
  ManagedServiceMetadata,
  MobileMetadata,
  ProgrammingLanguage,
} from './node-metadata.js';
import { getLanguageDisplayName, getTypicalDirectoryStructure } from './language-support.js';
import { getDatabaseEnrichment, getClientLibraries, getConnectionPatterns } from './database-enrichment.js';
import { getInterfaceEnrichment } from './interface-enrichment.js';

export interface ContractRequirement {
  contract: Contract;
  direction: 'incoming' | 'outgoing';
  schema?: Artifact;
  port?: Port;
  connectedNodeLabel: string;
}

export interface ArtifactContext {
  artifact: Artifact;
  node: Node;
  nodeTypeInfo?: DomainNodeType;
  relatedPorts: Port[];
  relatedContracts: Contract[];
  schemaArtifacts: Artifact[];
  incomingEdges: Edge[];
  outgoingEdges: Edge[];
  otherNodeArtifacts: Artifact[];
  validationResult?: NodeValidationResult;
  contractRequirements: ContractRequirement[];
}

export interface NodeContext {
  node: Node;
  nodeTypeInfo?: DomainNodeType;
  artifacts: Artifact[];
  suggestedArtifacts?: Artifact[];
  ports: Port[];
  contracts: Contract[];
  incomingEdges: Edge[];
  outgoingEdges: Edge[];
  connectedNodes: {
    incoming: Node[];
    outgoing: Node[];
  };
}

export async function buildArtifactContext(graph: Graph, artifactId: string): Promise<ArtifactContext | null> {
  const artifact = graph.artifacts[artifactId];
  if (!artifact) {
    return null;
  }

  const node = graph.nodes[artifact.nodeId];
  if (!node) {
    return null;
  }

  const relatedPorts = node.ports || [];

  const contractIds = new Set<string>();
  const incomingEdges: Edge[] = [];
  const outgoingEdges: Edge[] = [];

  for (const edge of Object.values(graph.edges)) {
    if (edge.source === node.id) {
      outgoingEdges.push(edge);
      contractIds.add(edge.contractId);
    }
    if (edge.target === node.id) {
      incomingEdges.push(edge);
      contractIds.add(edge.contractId);
    }
  }

  const relatedContracts = Array.from(contractIds)
    .map(id => graph.contracts[id])
    .filter(Boolean);

  const schemaArtifactIds = new Set<string>();
  for (const contract of relatedContracts) {
    if (contract.schemaRef) {
      schemaArtifactIds.add(contract.schemaRef);
    }
  }

  const schemaArtifacts = Array.from(schemaArtifactIds)
    .map(id => graph.artifacts[id])
    .filter(Boolean);

  const otherNodeArtifacts = Object.values(graph.artifacts).filter(
    a => a.nodeId === node.id && a.id !== artifactId && a.status !== 'suggested'
  );

  const nodeTypeInfo = getNodeTypeById(node.type);

  const validationResult = await validationEngine.validateGraph(graph);
  const nodeValidation = validationResult.nodeResults.get(node.id);

  const contractRequirements: ContractRequirement[] = [];

  for (const edge of outgoingEdges) {
    const contract = graph.contracts[edge.contractId];
    if (contract) {
      const targetNode = graph.nodes[edge.target];
      const schema = contract.schemaRef ? graph.artifacts[contract.schemaRef] : undefined;
      const port = relatedPorts.find(p => p.direction === 'out' && p.contractId === edge.contractId);
      contractRequirements.push({
        contract,
        direction: 'outgoing',
        schema,
        port,
        connectedNodeLabel: targetNode?.label || edge.target,
      });
    }
  }

  for (const edge of incomingEdges) {
    const contract = graph.contracts[edge.contractId];
    if (contract) {
      const sourceNode = graph.nodes[edge.source];
      const schema = contract.schemaRef ? graph.artifacts[contract.schemaRef] : undefined;
      const port = relatedPorts.find(p => p.direction === 'in' && p.contractId === edge.contractId);
      contractRequirements.push({
        contract,
        direction: 'incoming',
        schema,
        port,
        connectedNodeLabel: sourceNode?.label || edge.source,
      });
    }
  }

  return {
    artifact,
    node,
    nodeTypeInfo,
    relatedPorts,
    relatedContracts,
    schemaArtifacts,
    incomingEdges,
    outgoingEdges,
    otherNodeArtifacts,
    validationResult: nodeValidation,
    contractRequirements,
  };
}

export function formatNodeMetadataForAI(node: Node): string {
  if (!node.metadata?.domainMetadata) {
    return '';
  }

  const domainMeta = node.metadata.domainMetadata as NodeDomainMetadata;
  let metadataText = '\n## Technology Stack\n';

  switch (domainMeta.type) {
    case 'frontend': {
      const fm = domainMeta.data as FrontendMetadata;
      if (fm.framework) metadataText += `- Framework: ${fm.framework}${fm.frameworkVersion ? ` ${fm.frameworkVersion}` : ''}\n`;
      if (fm.language) metadataText += `- Language: ${fm.language}\n`;
      if (fm.deploymentType) metadataText += `- Deployment: ${fm.deploymentType.toUpperCase()}\n`;
      if (fm.buildTool) metadataText += `- Build Tool: ${fm.buildTool}\n`;
      if (fm.packageManager) metadataText += `- Package Manager: ${fm.packageManager}\n`;
      if (fm.stateManagement) metadataText += `- State Management: ${fm.stateManagement}\n`;
      if (fm.styling) metadataText += `- Styling: ${fm.styling}\n`;
      if (fm.router) metadataText += `- Router: ${fm.router}\n`;
      if (fm.testing && fm.testing.length > 0) metadataText += `- Testing: ${fm.testing.join(', ')}\n`;
      if (fm.devServerPort) metadataText += `- Dev Server Port: ${fm.devServerPort}\n`;
      break;
    }

    case 'web-service': {
      const ws = domainMeta.data as WebServiceMetadata;
      if (ws.language) metadataText += `- Language: ${ws.language}\n`;
      if (ws.runtime) metadataText += `- Runtime: ${ws.runtime}\n`;
      if (ws.framework) metadataText += `- Framework: ${ws.framework}${ws.version ? ` ${ws.version}` : ''}\n`;
      if (ws.port) metadataText += `- Port: ${ws.port}\n`;
      if (ws.baseUrl) metadataText += `- Base URL: ${ws.baseUrl}\n`;
      if (ws.path) metadataText += `- Path: ${ws.path}\n`;
      if (ws.authStrategy) metadataText += `- Auth Strategy: ${ws.authStrategy}\n`;
      if (ws.healthCheckPath) metadataText += `- Health Check: ${ws.healthCheckPath}\n`;
      if (ws.cors !== undefined) metadataText += `- CORS: ${ws.cors ? 'enabled' : 'disabled'}\n`;
      if (ws.rateLimit) metadataText += `- Rate Limit: ${ws.rateLimit} req/s\n`;
      if (ws.documentation) metadataText += `- Documentation: ${ws.documentation}\n`;
      if (ws.playground !== undefined) metadataText += `- Playground: ${ws.playground ? 'enabled' : 'disabled'}\n`;
      if (ws.depthLimit) metadataText += `- Depth Limit: ${ws.depthLimit}\n`;
      if (ws.complexityLimit) metadataText += `- Complexity Limit: ${ws.complexityLimit}\n`;
      if (ws.subscriptions !== undefined) metadataText += `- Subscriptions: ${ws.subscriptions ? 'enabled' : 'disabled'}\n`;
      if (ws.reflection !== undefined) metadataText += `- Reflection: ${ws.reflection ? 'enabled' : 'disabled'}\n`;
      if (ws.deadlineMs) metadataText += `- Deadline: ${ws.deadlineMs}ms\n`;
      if (ws.streaming !== undefined) metadataText += `- Streaming: ${ws.streaming ? 'enabled' : 'disabled'}\n`;
      if (ws.loadBalancing) metadataText += `- Load Balancing: ${ws.loadBalancing}\n`;
      if (ws.pingInterval) metadataText += `- Ping Interval: ${ws.pingInterval}ms\n`;
      if (ws.maxConnections) metadataText += `- Max Connections: ${ws.maxConnections}\n`;
      if (ws.perMessageDeflate !== undefined) metadataText += `- Per-Message Deflate: ${ws.perMessageDeflate ? 'enabled' : 'disabled'}\n`;
      if (ws.apiRoutes.length > 0) {
        metadataText += `- API Routes: ${ws.apiRoutes.length} endpoints detected\n`;
      }
      const knownWsKeys = new Set([
        'language', 'runtime', 'framework', 'version', 'port', 'baseUrl', 'authStrategy',
        'healthCheckPath', 'apiRoutes', 'dependencies', 'envVars',
        'cors', 'rateLimit', 'documentation', 'path', 'playground', 'depthLimit',
        'complexityLimit', 'subscriptions', 'reflection', 'deadlineMs', 'streaming',
        'loadBalancing', 'pingInterval', 'maxConnections', 'perMessageDeflate',
      ]);
      const rawWsData = ws as unknown as Record<string, unknown>;
      for (const [key, val] of Object.entries(rawWsData)) {
        if (knownWsKeys.has(key) || val === undefined || val === null || val === '') continue;
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        metadataText += `- ${label}: ${val}\n`;
      }
      break;
    }

    case 'database': {
      const db = domainMeta.data as DatabaseMetadata;
      metadataText += `- Database Type: ${db.dbType}\n`;
      if (db.version) metadataText += `- Version: ${db.version}\n`;
      if (db.host) metadataText += `- Host: ${db.host}\n`;
      if (db.port) metadataText += `- Port: ${db.port}\n`;
      if (db.database) metadataText += `- Database Name: ${db.database}\n`;
      if (db.tables.length > 0) {
        metadataText += `- Tables: ${db.tables.map(t => t.name).join(', ')}\n`;
      }
      if (db.connectionPoolSize) metadataText += `- Connection Pool Size: ${db.connectionPoolSize}\n`;

      // Add enriched database metadata
      const enrichment = getDatabaseEnrichment(`database.${db.dbType}`);
      if (enrichment) {
        metadataText += `\n### Database-Specific Context\n`;

        // File types
        if (enrichment.fileTypes.length > 0) {
          metadataText += `\n**Expected File Types:**\n`;
          for (const fileType of enrichment.fileTypes) {
            metadataText += `- ${fileType.extension}: ${fileType.description} (${fileType.purpose})\n`;
          }
        }

        // Migration tooling
        if (enrichment.migrationStrategy.tooling.length > 0) {
          metadataText += `\n**Migration Tools:**\n`;
          metadataText += `${enrichment.migrationStrategy.tooling.slice(0, 5).join(', ')}\n`;
        }

        // Monitoring
        if (enrichment.monitoringTools.length > 0) {
          metadataText += `\n**Monitoring Options:**\n`;
          metadataText += `${enrichment.monitoringTools.slice(0, 5).join(', ')}\n`;
        }
      }
      break;
    }

    case 'auth-service': {
      const auth = domainMeta.data as AuthServiceMetadata;
      metadataText += `- Provider: ${auth.provider}\n`;
      metadataText += `- MFA Enabled: ${auth.mfaEnabled ? 'Yes' : 'No'}\n`;
      if (auth.strategies.length > 0) {
        metadataText += `- Auth Strategies: ${auth.strategies.map(s => s.name).join(', ')}\n`;
      }
      if (auth.socialProviders.length > 0) {
        metadataText += `- Social Providers: ${auth.socialProviders.join(', ')}\n`;
      }
      if (auth.jwtConfig) {
        metadataText += `- JWT Algorithm: ${auth.jwtConfig.algorithm}\n`;
        metadataText += `- JWT Expires In: ${auth.jwtConfig.expiresIn}\n`;
      }
      break;
    }

    case 'cache': {
      const cache = domainMeta.data as CacheMetadata;
      metadataText += `- Cache Type: ${cache.cacheType}\n`;
      if (cache.host) metadataText += `- Host: ${cache.host}\n`;
      if (cache.port) metadataText += `- Port: ${cache.port}\n`;
      if (cache.ttl) metadataText += `- Default TTL: ${cache.ttl}s\n`;
      if (cache.evictionPolicy) metadataText += `- Eviction Policy: ${cache.evictionPolicy.toUpperCase()}\n`;
      if (cache.maxSize) metadataText += `- Max Size: ${cache.maxSize}\n`;
      break;
    }

    case 'message-queue': {
      const mq = domainMeta.data as MessageQueueMetadata;
      metadataText += `- Queue Type: ${mq.queueType}\n`;
      if (mq.host) metadataText += `- Host: ${mq.host}\n`;
      if (mq.port) metadataText += `- Port: ${mq.port}\n`;
      if (mq.queues.length > 0) {
        metadataText += `- Queues: ${mq.queues.map(q => q.name).join(', ')}\n`;
      }
      if (mq.exchanges && mq.exchanges.length > 0) {
        metadataText += `- Exchanges: ${mq.exchanges.map(e => e.name).join(', ')}\n`;
      }
      break;
    }

    case 'managed-service': {
      const ms = domainMeta.data as ManagedServiceMetadata;
      if (ms.provider) metadataText += `- Provider: ${ms.provider}\n`;
      if (ms.region) metadataText += `- Region: ${ms.region}\n`;
      if (ms.tier) metadataText += `- Tier: ${ms.tier}\n`;
      if (ms.version) metadataText += `- Version: ${ms.version}\n`;
      if (ms.port) metadataText += `- Port: ${ms.port}\n`;
      metadataText += `- Type: Managed Infrastructure Service (no application code)\n`;
      if (ms.configEntries.length > 0) {
        metadataText += `- Configuration: ${ms.configEntries.filter(e => !e.sensitive).map(e => `${e.key}=${e.value}`).join(', ')}\n`;
      }
      break;
    }

    case 'mobile': {
      const mob = domainMeta.data as MobileMetadata;
      metadataText += `- Platform: ${mob.platform}\n`;
      if (mob.language) metadataText += `- Language: ${mob.language}\n`;
      if (mob.framework) metadataText += `- UI Framework: ${mob.framework}\n`;
      if (mob.uiFramework) metadataText += `- UI Kit: ${mob.uiFramework}\n`;
      if (mob.architecture) metadataText += `- Architecture: ${mob.architecture.toUpperCase()}\n`;
      if (mob.stateManagement) metadataText += `- State Management: ${mob.stateManagement}\n`;
      if (mob.navigation) metadataText += `- Navigation: ${mob.navigation}\n`;
      if (mob.minDeploymentTarget) metadataText += `- Min Deployment Target: iOS ${mob.minDeploymentTarget}\n`;
      if (mob.minSdk) metadataText += `- Min SDK: Android ${mob.minSdk}\n`;
      if (mob.bundleId) metadataText += `- Bundle ID: ${mob.bundleId}\n`;
      if (mob.packageName) metadataText += `- Package Name: ${mob.packageName}\n`;
      if (mob.screens.length > 0) {
        metadataText += `- Screens: ${mob.screens.map(s => s.name).join(', ')}\n`;
      }
      if (mob.features && mob.features.length > 0) {
        metadataText += `- Features: ${mob.features.join(', ')}\n`;
      }
      break;
    }
  }

  return metadataText;
}

function getLanguageSpecificGuidance(language: ProgrammingLanguage): string {
  const guidance: Record<ProgrammingLanguage, string[]> = {
    typescript: [
      'Use strong typing with interfaces and type definitions',
      'Leverage TypeScript generics for reusable components',
      'Enable strict mode in tsconfig.json',
      'Use readonly for immutable data',
      'Prefer const assertions for literal types',
      'Use type guards for runtime type safety',
    ],
    javascript: [
      'Use ES6+ features (const/let, arrow functions, destructuring)',
      'Implement proper error handling with try-catch',
      'Use async/await for asynchronous operations',
      'Follow consistent naming conventions',
      'Add JSDoc comments for better IDE support',
    ],
    python: [
      'Follow PEP 8 style guide',
      'Use type hints (PEP 484) for better code clarity',
      'Implement proper error handling with specific exceptions',
      'Use context managers (with statement) for resource management',
      'Leverage dataclasses or Pydantic for data validation',
      'Use async/await for I/O-bound operations',
      'Organize imports following PEP 8 (standard library, third-party, local)',
    ],
    java: [
      'Follow Java naming conventions (PascalCase for classes, camelCase for methods)',
      'Use proper access modifiers (private, protected, public)',
      'Implement interfaces for abstraction',
      'Use Optional<T> instead of null where appropriate',
      'Leverage Java Streams API for collections',
      'Use try-with-resources for resource management',
      'Add proper JavaDoc comments for public APIs',
    ],
    go: [
      'Follow Go naming conventions (exported names start with capital letter)',
      'Handle errors explicitly (never ignore error returns)',
      'Use defer for resource cleanup',
      'Keep interfaces small and focused',
      'Use context.Context for cancellation and timeouts',
      'Format code with gofmt',
      'Write table-driven tests',
    ],
    csharp: [
      'Follow C# naming conventions (PascalCase for public, camelCase for private)',
      'Use async/await for asynchronous operations',
      'Implement IDisposable for resource cleanup',
      'Use LINQ for collection operations',
      'Leverage nullable reference types (C# 8+)',
      'Use pattern matching for cleaner code',
      'Add XML documentation comments',
    ],
    rust: [
      'Embrace ownership and borrowing principles',
      'Use Result<T, E> for error handling',
      'Prefer Option<T> over null-like patterns',
      'Use pattern matching extensively',
      'Leverage iterators instead of loops',
      'Use cargo fmt for consistent formatting',
      'Add documentation comments (///) for public APIs',
    ],
    php: [
      'Follow PSR-12 coding standard',
      'Use type declarations for parameters and return types',
      'Leverage namespaces for code organization',
      'Use composer for dependency management',
      'Implement proper error handling with exceptions',
      'Use prepared statements for database queries',
    ],
    ruby: [
      'Follow Ruby style guide conventions',
      'Use meaningful method names (question marks for predicates, exclamation for mutators)',
      'Leverage blocks and iterators',
      'Use symbols for identifiers and keys',
      'Implement proper exception handling with rescue',
      'Use bundler for dependency management',
    ],
    swift: [
      'Follow Swift API Design Guidelines (clarity at point of use)',
      'Use value types (structs) where possible, reference types (classes) when needed',
      'Leverage optionals and guard statements for safety',
      'Use protocols and protocol extensions for abstraction',
      'Implement Codable for JSON serialization',
      'Use async/await and structured concurrency (Swift 5.5+)',
      'Prefer SwiftUI declarative patterns for UI',
      'Use @Published and ObservableObject for reactive state',
    ],
    kotlin: [
      'Follow Kotlin coding conventions (official style guide)',
      'Use data classes for value objects',
      'Leverage sealed classes for exhaustive state handling',
      'Use coroutines with Flow for async operations',
      'Prefer null-safe operators (?., ?:, let, also)',
      'Use Jetpack Compose for declarative UI',
      'Implement dependency injection with Hilt or Koin',
      'Use extension functions to add functionality to existing classes',
    ],
    dart: [
      'Follow Effective Dart style guide',
      'Use null safety (Dart 3.0+) with proper nullable annotations',
      'Leverage Dart 3 patterns, records, and sealed classes',
      'Use async/await and Stream for asynchronous operations',
      'Implement proper state management (Riverpod, Bloc, or Provider)',
      'Use freezed or json_serializable for immutable data models',
      'Follow widget composition patterns (prefer composition over inheritance)',
      'Use const constructors for performance optimization',
    ],
    other: [],
  };

  const practices = guidance[language] || [];
  if (practices.length === 0) return '';

  let text = '\n## Language-Specific Best Practices\n';
  text += `For ${getLanguageDisplayName(language)}, follow these practices:\n`;
  for (const practice of practices) {
    text += `- ${practice}\n`;
  }

  const dirStructure = getTypicalDirectoryStructure(language);
  if (dirStructure.length > 0) {
    text += `\n### Typical Directory Structure\n`;
    for (const dir of dirStructure) {
      text += `- ${dir}\n`;
    }
  }

  return text;
}

function getEnrichedInterfaceContext(node: Node, language?: ProgrammingLanguage, contracts?: Contract[]): string {
  const nodeTypeId = node.type;

  const interfaceTypes = [
    'rest-api',
    'graphql-api',
    'grpc-service',
    'api-gateway',
    'websocket-server',
    'load-balancer',
    'realtime-service',
    'web.rest-api',
    'web.graphql-api',
    'web.grpc-service',
    'gateway.aws-api-gateway',
    'gateway.azure-api-management',
    'gateway.gcp-api-gateway',
    'gateway.kong',
    'web.websocket-server',
    'mesh.istio',
    'mesh.linkerd',
    'mesh.consul',
  ];

  let enrichment = interfaceTypes.includes(nodeTypeId)
    ? getInterfaceEnrichment(nodeTypeId) || getInterfaceEnrichment(`web.${nodeTypeId}`)
    : null;

  if (!enrichment && contracts && contracts.length > 0) {
    for (const contract of contracts) {
      enrichment = getInterfaceEnrichment(`contract:${contract.kind}`);
      if (enrichment) break;
    }
  }

  if (!enrichment) {
    return '';
  }

  let context = '\n## Interface Technology Context\n';

  // File types
  if (enrichment.fileTypes.length > 0) {
    context += `\n### Expected File Types\n`;
    for (const fileType of enrichment.fileTypes) {
      context += `- ${fileType.extension}: ${fileType.description} (${fileType.purpose})\n`;
      if (fileType.example) {
        context += `  Example: ${fileType.example}\n`;
      }
    }
  }

  // Language-specific client libraries
  if (language && enrichment.clientLibraries.length > 0) {
    const clientLibs = enrichment.clientLibraries.filter(lib => lib.language === language);
    if (clientLibs.length > 0) {
      context += `\n### ${getLanguageDisplayName(language)} Client Libraries\n`;
      const primaryLibs = clientLibs.filter(lib => lib.popularity === 'primary');
      const popularLibs = clientLibs.filter(lib => lib.popularity === 'popular');

      if (primaryLibs.length > 0) {
        context += '**Primary (Most Recommended):**\n';
        for (const lib of primaryLibs) {
          context += `- ${lib.name} (\`${lib.package}\`): ${lib.description}\n`;
        }
      }

      if (popularLibs.length > 0) {
        context += '\n**Popular Alternatives:**\n';
        for (const lib of popularLibs) {
          context += `- ${lib.name} (\`${lib.package}\`): ${lib.description}\n`;
        }
      }
    }
  }

  // Authentication strategies
  if (enrichment.authStrategies.length > 0) {
    context += `\n### Authentication Strategies\n`;
    for (const auth of enrichment.authStrategies.slice(0, 4)) {
      context += `- **${auth.name}** (${auth.complexity}): ${auth.description}\n`;
      if (auth.useCases.length > 0) {
        context += `  Use cases: ${auth.useCases.slice(0, 3).join(', ')}\n`;
      }
    }
  }

  // Configuration patterns
  if (enrichment.configPatterns.length > 0) {
    context += `\n### Configuration Best Practices\n`;
    for (const pattern of enrichment.configPatterns.slice(0, 5)) {
      context += `- **${pattern.name}**: ${pattern.description}\n`;
    }
  }

  // Security features (critical only)
  const criticalSecurity = enrichment.securityFeatures.filter(sf => sf.importance === 'critical');
  if (criticalSecurity.length > 0) {
    context += `\n### Critical Security Features\n`;
    for (const security of criticalSecurity) {
      context += `- ${security.name}: ${security.description}\n`;
    }
  }

  // Performance tips (top 5)
  if (enrichment.performanceTips.length > 0) {
    context += `\n### Performance Tips\n`;
    for (const tip of enrichment.performanceTips.slice(0, 5)) {
      context += `- ${tip}\n`;
    }
  }

  // Deployment options (top 3)
  if (enrichment.deploymentOptions.length > 0) {
    context += `\n### Deployment Options\n`;
    for (const option of enrichment.deploymentOptions.slice(0, 3)) {
      context += `- **${option.provider} ${option.service}**: ${option.description}\n`;
    }
  }

  return context;
}

function getEnrichedDatabaseContext(node: Node, language?: ProgrammingLanguage, connectedNodes?: Node[]): string {
  const domainMeta = node.metadata?.domainMetadata as NodeDomainMetadata | undefined;
  if (!domainMeta || domainMeta.type !== 'database') {
    return '';
  }

  const db = domainMeta.data as DatabaseMetadata;
  const enrichment = getDatabaseEnrichment(`database.${db.dbType}`);

  if (!enrichment) {
    return '';
  }

  // If no language provided, try to detect from connected nodes
  if (!language && connectedNodes) {
    for (const connectedNode of connectedNodes) {
      const connectedMeta = connectedNode.metadata?.domainMetadata as NodeDomainMetadata | undefined;
      if (connectedMeta) {
        if (connectedMeta.type === 'web-service') {
          language = (connectedMeta.data as WebServiceMetadata).language;
          if (language) break;
        } else if (connectedMeta.type === 'frontend') {
          language = (connectedMeta.data as FrontendMetadata).language;
          if (language) break;
        }
      }
    }
  }

  let context = '\n## Database Technology Context\n';

  // Language-specific client libraries
  if (language) {
    const clientLibs = getClientLibraries(`database.${db.dbType}`, language);
    if (clientLibs.length > 0) {
      context += `\n### ${getLanguageDisplayName(language)} Client Libraries\n`;
      const primaryLibs = clientLibs.filter(lib => lib.popularity === 'primary');
      const popularLibs = clientLibs.filter(lib => lib.popularity === 'popular');

      if (primaryLibs.length > 0) {
        context += '**Primary (Most Recommended):**\n';
        for (const lib of primaryLibs) {
          context += `- ${lib.name} (\`${lib.package}\`): ${lib.description}\n`;
        }
      }

      if (popularLibs.length > 0) {
        context += '\n**Popular Alternatives:**\n';
        for (const lib of popularLibs) {
          context += `- ${lib.name} (\`${lib.package}\`): ${lib.description}\n`;
        }
      }
    }

    // Language-specific use cases
    const langSupport = enrichment.languageSupport.find(ls => ls.language === language);
    if (langSupport && langSupport.typicalUseCases.length > 0) {
      context += `\n### Typical Use Cases with ${getLanguageDisplayName(language)}\n`;
      for (const useCase of langSupport.typicalUseCases) {
        context += `- ${useCase}\n`;
      }
    }
  }

  // Connection patterns (based on connected nodes if available)
  const patterns = getConnectionPatterns(`database.${db.dbType}`);
  if (patterns.length > 0) {
    context += `\n### Connection Best Practices\n`;
    const pattern = patterns[0]; // Show first pattern as example
    context += `**Common Scenarios:**\n`;
    for (const scenario of pattern.commonScenarios.slice(0, 4)) {
      context += `- ${scenario}\n`;
    }
    context += `\n**Security Considerations:**\n`;
    for (const security of pattern.securityConsiderations.slice(0, 4)) {
      context += `- ${security}\n`;
    }
  }

  // Migration best practices
  if (enrichment.migrationStrategy.bestPractices.length > 0) {
    context += `\n### Migration Best Practices\n`;
    for (const practice of enrichment.migrationStrategy.bestPractices.slice(0, 5)) {
      context += `- ${practice}\n`;
    }
  }

  // Deployment options (brief)
  if (enrichment.deploymentContext.managedServices.length > 0) {
    context += `\n### Deployment Options\n`;
    context += 'Managed services available:\n';
    for (const service of enrichment.deploymentContext.managedServices.slice(0, 3)) {
      context += `- ${service.provider} ${service.service}\n`;
    }
  }

  return context;
}

export function formatArtifactContextForAI(context: ArtifactContext): string {
  let prompt = `# Context for ${context.artifact.path}\n\n`;

  prompt += `## Node Information\n`;
  prompt += `- Node: ${context.node.label} (${context.node.type})\n`;
  if (context.nodeTypeInfo) {
    prompt += `- Purpose: ${context.nodeTypeInfo.aiContext.purpose}\n`;
    prompt += `- Typical Technologies: ${context.nodeTypeInfo.aiContext.typicalTech.join(', ')}\n`;
    if (context.nodeTypeInfo.suggestedFiles?.length) {
      prompt += `- Suggested File Types:\n`;
      for (const sf of context.nodeTypeInfo.suggestedFiles) {
        prompt += `  - ${sf.path} (kind: ${sf.kind})${sf.description ? ': ' + sf.description : ''}${sf.required ? ' [required]' : ''}\n`;
      }
    }
  }

  const metadataSection = formatNodeMetadataForAI(context.node);
  if (metadataSection) {
    prompt += metadataSection;
  }

  // Extract language from metadata
  const domainMeta = context.node.metadata?.domainMetadata as NodeDomainMetadata | undefined;
  let language: ProgrammingLanguage | undefined;

  if (domainMeta) {
    if (domainMeta.type === 'frontend') {
      language = (domainMeta.data as FrontendMetadata).language;
    } else if (domainMeta.type === 'web-service') {
      language = (domainMeta.data as WebServiceMetadata).language;
    } else if (domainMeta.type === 'mobile') {
      language = (domainMeta.data as MobileMetadata).language;
    }

    // Add enriched database context for database nodes
    if (domainMeta.type === 'database') {
      // Collect connected nodes to detect language
      const connectedNodeIds = new Set<string>();
      for (const edge of context.incomingEdges) {
        connectedNodeIds.add(edge.source);
      }
      for (const edge of context.outgoingEdges) {
        connectedNodeIds.add(edge.target);
      }

      // We need access to the graph to get connected nodes - pass what we have
      const dbContext = getEnrichedDatabaseContext(context.node, language);
      if (dbContext) {
        prompt += dbContext;
      }
    }

    if (language) {
      const languageGuidance = getLanguageSpecificGuidance(language);
      if (languageGuidance) {
        prompt += languageGuidance;
      }
    }
  }

  // Add enriched interface context for interface nodes or nodes with API contracts
  const interfaceContext = getEnrichedInterfaceContext(context.node, language, context.relatedContracts);
  if (interfaceContext) {
    prompt += interfaceContext;
  }

  if (context.nodeTypeInfo) {
    prompt += `\n## Best Practices\n`;
    for (const practice of context.nodeTypeInfo.aiContext.bestPractices) {
      prompt += `- ${practice}\n`;
    }

    prompt += `\n## Anti-Patterns to Avoid\n`;
    for (const antiPattern of context.nodeTypeInfo.aiContext.antiPatterns) {
      prompt += `- ${antiPattern}\n`;
    }
    prompt += `\n`;
  }

  if (context.contractRequirements.length > 0) {
    prompt += `\n## Contract Requirements\n`;
    prompt += `This code must implement the following contracts:\n\n`;

    for (const req of context.contractRequirements) {
      prompt += `### ${req.direction === 'incoming' ? 'Receives from' : 'Sends to'}: ${req.connectedNodeLabel}\n`;
      prompt += `- Contract Type: ${req.contract.kind}\n`;
      prompt += `- Contract Name: ${req.contract.name}\n`;

      if (req.schema) {
        prompt += `- Schema Defined: YES\n`;
        prompt += `\`\`\`${getFileExtension(req.schema.path)}\n${req.schema.content}\n\`\`\`\n`;
      } else {
        prompt += `- Schema Defined: NO (should be created or code should match expected ${req.contract.kind} patterns)\n`;
      }

      if (req.port) {
        prompt += `- Port: ${req.port.name || `${req.direction}put port`}\n`;
      }
      prompt += `\n`;
    }
  } else if (context.nodeTypeInfo?.commonConnections && context.nodeTypeInfo.commonConnections.length > 0) {
    prompt += `\n## Typical Architecture Patterns\n`;
    prompt += `This ${context.nodeTypeInfo.label} typically connects to:\n`;
    for (const conn of context.nodeTypeInfo.commonConnections) {
      prompt += `- ${conn}\n`;
    }
    prompt += `\nSince no connections are defined yet, generate self-contained code with:\n`;
    prompt += `- Mock/stub implementations for external dependencies\n`;
    prompt += `- Clear interfaces that can be implemented later\n`;
    prompt += `- Example data structures based on common patterns\n`;
    prompt += `- TODO comments marking integration points\n\n`;
  }

  if (context.validationResult && context.validationResult.issues.length > 0) {
    prompt += `## Validation Issues\n`;
    prompt += `The following issues were detected:\n\n`;
    for (const issue of context.validationResult.issues) {
      prompt += `- [${issue.severity.toUpperCase()}] ${issue.message}\n`;
      if (issue.description) {
        prompt += `  ${issue.description}\n`;
      }
    }
    prompt += `\n`;
  }

  if (context.otherNodeArtifacts.length > 0) {
    prompt += `## Other Artifacts in Same Node\n`;
    const realArtifacts = context.otherNodeArtifacts.filter(a => a.status !== 'suggested');
    const suggested = context.otherNodeArtifacts.filter(a => a.status === 'suggested');

    if (realArtifacts.length > 0) {
      for (const art of realArtifacts) {
        prompt += `- ${art.path} (${art.kind})\n`;
      }
    }

    if (suggested.length > 0) {
      prompt += `\n### Suggested File Structure\n`;
      prompt += `The following files are recommended for this ${context.nodeTypeInfo?.label || 'node'}:\n`;
      for (const art of suggested) {
        prompt += `- ${art.path} (${art.kind}): ${art.description || 'No description'}\n`;
      }
    }
    prompt += `\n`;
  }

  return prompt;
}

function getFileExtension(path: string): string {
  const ext = path.split('.').pop();
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx') return 'javascript';
  if (ext === 'py') return 'python';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'json') return 'json';
  return ext || 'text';
}

export function buildNodeContext(graph: Graph, nodeId: string): NodeContext | null {
  const node = graph.nodes[nodeId];
  if (!node) {
    return null;
  }

  const allArtifacts = Object.values(graph.artifacts).filter(
    a => a.nodeId === nodeId
  );

  const artifacts = allArtifacts.filter(a => a.status !== 'suggested');
  const suggestedArtifacts = allArtifacts.filter(a => a.status === 'suggested');

  const ports = node.ports || [];

  const contractIds = new Set<string>();
  const incomingEdges: Edge[] = [];
  const outgoingEdges: Edge[] = [];
  const incomingNodeIds = new Set<string>();
  const outgoingNodeIds = new Set<string>();

  for (const edge of Object.values(graph.edges)) {
    if (edge.source === nodeId) {
      outgoingEdges.push(edge);
      contractIds.add(edge.contractId);
      outgoingNodeIds.add(edge.target);
    }
    if (edge.target === nodeId) {
      incomingEdges.push(edge);
      contractIds.add(edge.contractId);
      incomingNodeIds.add(edge.source);
    }
  }

  const contracts = Array.from(contractIds)
    .map(id => graph.contracts[id])
    .filter(Boolean);

  const connectedNodes = {
    incoming: Array.from(incomingNodeIds)
      .map(id => graph.nodes[id])
      .filter(Boolean),
    outgoing: Array.from(outgoingNodeIds)
      .map(id => graph.nodes[id])
      .filter(Boolean),
  };

  const nodeTypeInfo = getNodeTypeById(node.type);

  return {
    node,
    nodeTypeInfo,
    artifacts,
    suggestedArtifacts: suggestedArtifacts.length > 0 ? suggestedArtifacts : undefined,
    ports,
    contracts,
    incomingEdges,
    outgoingEdges,
    connectedNodes,
  };
}
