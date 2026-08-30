import { getNodeTypeDomains, type DomainNodeType } from '../node-types.js';
import type { ContractKind } from '../types.js';
import type { GenerationContext } from './types.js';

export function buildSystemContext(): GenerationContext {
  const availableNodeTypes: string[] = [];
  const nodeTypeDescriptions: Record<string, string> = {};

  for (const domain of getNodeTypeDomains()) {
    for (const nodeType of domain.nodeTypes) {
      availableNodeTypes.push(nodeType.id);
      nodeTypeDescriptions[nodeType.id] = `${nodeType.label} - ${nodeType.description}`;
    }
  }

  const availableContractKinds: ContractKind[] = [
    'rest',
    'graphql',
    'grpc',
    'websocket',
    'sse',
    'kafka',
    'amqp',
    'sql',
    'nosql',
    'ipc',
    'dependency',
    'custom',
  ];

  const commonPatterns = [
    'Frontend → REST API → Database (classic 3-tier)',
    'Frontend → GraphQL API → Multiple Microservices',
    'Frontend → REST API → Messaging (RabbitMQ/Kafka) → Workers',
    'Frontend → WebSocket → Real-time Service',
    'Mobile App → REST API → Database → Cache',
    'API Gateway → Multiple Microservices → Shared Database',
    'Event-Driven: Services communicate via Messaging (RabbitMQ/Kafka/NATS)',
    'CQRS: Separate read and write paths',
    'Embedded System: Processor → Memory + FPGA → Physical Interfaces',
    'IoT Device: Sensor → Processor → Physical Interface (CAN/Ethernet)',
    'Control System: Sensor → FPGA/ASIC → Actuator',
    'Real-Time System: Physical Interface (1553/ARINC) → Processor → Actuator',
  ];

  const bestPractices = [
    'Each node should have a clear, single responsibility',
    'Use REST for request-response patterns',
    'Use events/message queues for async, fire-and-forget operations',
    'Add caching layer for frequently accessed data',
    'Separate authentication service for security',
    'Use API Gateway as single entry point for microservices',
    'Database should never be directly accessed by frontend',
    'Include health check endpoints for all services',
    'For embedded systems: Select processor based on real-time requirements',
    'For embedded systems: Design for power constraints and thermal limits',
    'For embedded systems: Implement proper signal integrity and EMC design',
    'For embedded systems: Add hardware watchdog and fault detection',
    'For embedded systems: Use appropriate physical interfaces for bandwidth/latency needs',
    'When an artifact kind does not match its parent node suggested file types, review placement — move the artifact to a node whose role aligns with the file kind',
  ];

  return {
    availableNodeTypes,
    availableContractKinds,
    nodeTypeDescriptions,
    commonPatterns,
    bestPractices,
  };
}

export function formatSystemContextForAI(context: GenerationContext): string {
  let prompt = '## Available Component Types\n\n';
  prompt += 'You can create nodes of the following types:\n\n';

  const nodesByDomain = new Map<string, DomainNodeType[]>();
  for (const domain of getNodeTypeDomains()) {
    nodesByDomain.set(domain.label, domain.nodeTypes);
  }

  for (const [domainLabel, nodeTypes] of nodesByDomain.entries()) {
    prompt += `### ${domainLabel}\n\n`;
    for (const nodeType of nodeTypes) {
      prompt += `- **${nodeType.id}** (${nodeType.label})\n`;
      prompt += `  ${nodeType.description}\n`;
      prompt += `  Icon: ${nodeType.icon}\n`;
      prompt += `  Purpose: ${nodeType.aiContext.purpose}\n`;
      prompt += `  Typical Tech: ${nodeType.aiContext.typicalTech.join(', ')}\n`;

      if (nodeType.defaultMetadata && Object.keys(nodeType.defaultMetadata).length > 0) {
        const dm = nodeType.defaultMetadata;
        const metaEntries = Object.entries(dm)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        prompt += `  Default Metadata: ${metaEntries}\n`;
      }

      if (nodeType.commonConnections && nodeType.commonConnections.length > 0) {
        prompt += `  Commonly connects to: ${nodeType.commonConnections.join(', ')}\n`;
      }

      prompt += '\n';
    }
  }

  prompt += '\n## Connection Types (Contracts)\n\n';
  prompt += 'When connecting nodes, use these contract types:\n\n';

  const contractDescriptions: Record<ContractKind, string> = {
    rest: 'HTTP REST API - Request/response pattern with JSON payloads',
    graphql: 'GraphQL API - Flexible query language for APIs',
    grpc: 'gRPC - High-performance RPC framework with Protocol Buffers',
    websocket: 'WebSocket - Full-duplex bidirectional communication',
    sse: 'SSE - Server-Sent Events for unidirectional server push',
    kafka: 'Kafka - Ordered, replayable event stream (Kafka, Kinesis)',
    amqp: 'AMQP - Message queue with routing and reliable delivery',
    sql: 'SQL - Relational database queries and transactions',
    nosql: 'NoSQL - Document, key-value, or wide-column store operations',
    ipc: 'IPC - Inter-process communication (pipes, shared memory)',
    dependency: 'Dependency - Build-time code import from a shared library or package',
    custom: 'Custom - Specialized or domain-specific integration pattern',
  };

  for (const kind of context.availableContractKinds) {
    prompt += `- **${kind}**: ${contractDescriptions[kind]}\n`;
  }

  prompt += '\n## Common Architecture Patterns\n\n';
  for (const pattern of context.commonPatterns) {
    prompt += `- ${pattern}\n`;
  }

  prompt += '\n## Best Practices\n\n';
  for (const practice of context.bestPractices) {
    prompt += `- ${practice}\n`;
  }

  prompt += '\n## Platform Modeling Styles\n\n';
  prompt += 'Two valid approaches exist for modeling cloud/platform infrastructure:\n\n';
  prompt += '**Style A -- Platform-Committed**: A single platform container node (e.g. "aws", "azure", "gcp") acts as the root container. ';
  prompt += 'Platform-specific capabilities (RDS, Lambda, S3) are children of that platform node with kind=platform_capability. ';
  prompt += 'Use this when the project is built entirely on one cloud provider. Note: Supabase and Firebase are standalone managed nodes, NOT containers -- use Style B for them.\n\n';
  prompt += '**Style B -- Component-Composed**: No platform parent. Each service is modeled independently with its own role ';
  prompt += '(database, serverless-function, object-storage) and a technology reference to the specific provider product. ';
  prompt += 'Use this for multi-cloud or provider-agnostic designs.\n\n';
  prompt += '**Rule**: platform_capability nodes MUST have a parent platform node. ';
  prompt += 'An orphaned platform_capability (no parentId pointing to a platform-kind node) is invalid.\n\n';
  prompt += '**Equivalence Rule**: A generic-role node (e.g. role=database) with a provider-prefixed technology (e.g. aws-rds) ';
  prompt += 'inside a platform container is semantically identical to a platform_capability node with the same technology. ';
  prompt += 'Both representations produce the same architectural semantics for spec generation and code scaffolding.\n';

  return prompt;
}

export function formatNodeTypeDetailsForAI(nodeTypeId: string): string {
  for (const domain of getNodeTypeDomains()) {
    const nodeType = domain.nodeTypes.find(nt => nt.id === nodeTypeId);
    if (nodeType) {
      let details = `# ${nodeType.label} (${nodeType.id})\n\n`;
      details += `${nodeType.description}\n\n`;
      details += `## AI Context\n`;
      details += `**Purpose**: ${nodeType.aiContext.purpose}\n\n`;
      details += `**Typical Technologies**:\n`;
      for (const tech of nodeType.aiContext.typicalTech) {
        details += `- ${tech}\n`;
      }
      details += `\n**Best Practices**:\n`;
      for (const practice of nodeType.aiContext.bestPractices) {
        details += `- ${practice}\n`;
      }
      details += `\n**Anti-Patterns to Avoid**:\n`;
      for (const antiPattern of nodeType.aiContext.antiPatterns) {
        details += `- ${antiPattern}\n`;
      }

      if (nodeType.defaultPorts && nodeType.defaultPorts.length > 0) {
        details += `\n**Default Ports**:\n`;
        for (const port of nodeType.defaultPorts) {
          details += `- ${port.name} (${port.direction})${port.required ? ' [required]' : ''}\n`;
        }
      }

      if (nodeType.suggestedContracts && nodeType.suggestedContracts.length > 0) {
        details += `\n**Suggested Contract Types**: ${nodeType.suggestedContracts.join(', ')}\n`;
      }

      if (nodeType.commonConnections && nodeType.commonConnections.length > 0) {
        details += `\n**Commonly Connects To**: ${nodeType.commonConnections.join(', ')}\n`;
      }

      if (nodeType.defaultMetadata && Object.keys(nodeType.defaultMetadata).length > 0) {
        details += `\n**Default Metadata**:\n`;
        for (const [key, value] of Object.entries(nodeType.defaultMetadata)) {
          details += `- ${key}: ${value}\n`;
        }
      }

      return details;
    }
  }

  return `Node type ${nodeTypeId} not found in system.`;
}

export function getNodeTypeById(nodeTypeId: string): DomainNodeType | undefined {
  for (const domain of getNodeTypeDomains()) {
    const nodeType = domain.nodeTypes.find(nt => nt.id === nodeTypeId);
    if (nodeType) {
      return nodeType;
    }
  }
  return undefined;
}
