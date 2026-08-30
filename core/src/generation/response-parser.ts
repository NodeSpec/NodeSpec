import { generateUUID, now, computeContentHash } from '../utils.js';
import type { Node, Edge, Contract, Artifact, Port } from '../types.js';
import type { ProgrammingLanguage } from '../node-metadata.js';
import { getNodeTypeById } from './system-context.js';
import type { ArchitectureGenerationResponse, ParsedArchitecture } from './types.js';
import { ArchitectureGenerationResponseSchema } from './types.js';
import { ContractKindSchema } from '../schemas.js';
import { inferContractFieldsFromKind } from '../migration.js';
import { resolveContractFields } from '../interaction-resolution.js';

export interface ParseError {
  code: string;
  message: string;
  context?: unknown;
}

export interface ParseResult {
  success: boolean;
  data?: ParsedArchitecture;
  errors: ParseError[];
}

function inferLanguageFromNodeType(nodeType: string): ProgrammingLanguage | undefined {
  if (nodeType.startsWith('frontend.')) {
    if (nodeType.includes('blazor')) return 'csharp';
    if (nodeType.includes('yew') || nodeType.includes('dioxus')) return 'rust';
    return 'typescript';
  }
  if (nodeType.startsWith('web.')) return 'typescript';
  if (nodeType.startsWith('database.')) return 'other';
  if (nodeType.startsWith('mobile.ios')) return 'other';
  if (nodeType.startsWith('mobile.android')) return 'java';
  if (nodeType.startsWith('robotics.')) return 'other';
  return undefined;
}

// Deprecated node types that should be rejected
const DEPRECATED_NODE_TYPES = new Set([
  'cloud.kubernetes',  // Use orchestration.kubernetes-cluster instead
  'cloud.vpc',         // Use infrastructure.vpc instead
  'cloud.container',   // Use runtime.docker-container instead
]);

function inferFrameworkFromNodeType(nodeType: string): string | undefined {
  const frameworkMap: Record<string, string> = {
    'frontend.react': 'react',
    'frontend.vue': 'vue',
    'frontend.angular': 'angular',
    'frontend.svelte': 'svelte',
    'frontend.solid': 'solid',
    'frontend.next': 'next',
    'frontend.nuxt': 'nuxt',
    'frontend.astro': 'astro',
    'frontend.blazor': 'blazor',
    'frontend.yew': 'yew',
    'frontend.dioxus': 'dioxus',
    'web.rest-api': 'express',
    'web.graphql-api': 'apollo',
    'web.grpc-service': 'grpc',
    'auth.keycloak': 'keycloak',
    'auth.auth0': 'auth0',
    'auth.supabase-auth': 'supabase',
    'auth.firebase-auth': 'firebase',
    'cache.redis': 'redis',
    'cache.memcached': 'memcached',
    'database.postgresql': 'postgresql',
    'database.mysql': 'mysql',
    'database.mongodb': 'mongodb',
  };
  return frameworkMap[nodeType];
}

/**
 * Extracts JSON from AI response using multiple strategies
 */
function extractJSONFromResponse(aiResponse: string): unknown {
  // Strategy 1: Extract from ```json blocks
  const jsonBlockMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1].trim());
  }

  // Strategy 2: Extract from ``` blocks without language tag
  const codeBlockMatch = aiResponse.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Find first { to last } (handles text before/after JSON)
  const firstBrace = aiResponse.indexOf('{');
  const lastBrace = aiResponse.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const extracted = aiResponse.slice(firstBrace, lastBrace + 1);
      return JSON.parse(extracted);
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 4: Try parsing entire response (trimmed)
  return JSON.parse(aiResponse.trim());
}

export function parseAIResponse(aiResponse: string): ParseResult {
  const errors: ParseError[] = [];

  let jsonData: unknown;
  try {
    jsonData = extractJSONFromResponse(aiResponse);
  } catch (error) {
    errors.push({
      code: 'INVALID_JSON',
      message: `Failed to parse AI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      context: {
        aiResponse: aiResponse.slice(0, 1000),
        hint: 'The AI may have returned text instead of pure JSON, or the JSON is malformed'
      },
    });
    return { success: false, errors };
  }

  const validationResult = ArchitectureGenerationResponseSchema.safeParse(jsonData);
  if (!validationResult.success) {
    const errorDetails = validationResult.error.issues
      .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    errors.push({
      code: 'SCHEMA_VALIDATION_FAILED',
      message: `AI response does not match expected schema:\n${errorDetails}`,
      context: {
        zodError: validationResult.error.format(),
        actualResponse: JSON.stringify(jsonData, null, 2).slice(0, 1500),
        hint: 'The AI returned JSON but it is missing required fields or has wrong structure. Check the actualResponse to see what was returned.'
      },
    });
    return { success: false, errors };
  }

  const response = validationResult.data;

  try {
    const parsed = convertResponseToGraphEntities(response);
    return {
      success: true,
      data: parsed,
      errors: [],
    };
  } catch (error) {
    errors.push({
      code: 'CONVERSION_FAILED',
      message: `Failed to convert response to graph entities: ${error instanceof Error ? error.message : 'Unknown error'}`,
      context: { error },
    });
    return { success: false, errors };
  }
}

function convertResponseToGraphEntities(response: ArchitectureGenerationResponse): ParsedArchitecture {
  const nodeMap = new Map<string, Node>();
  const labelToIdMap = new Map<string, string>();
  const artifacts: Artifact[] = [];
  const contracts: Contract[] = [];
  const edges: Edge[] = [];

  for (const generatedContract of response.contracts) {
    const contractId = generateUUID();

    let contractKind = generatedContract.kind;
    let interactionKind: string | undefined;
    let transport: string | undefined;
    let specFormat: string | undefined;

    const resolved = resolveContractFields(contractKind);
    contractKind = resolved.kind;
    interactionKind = resolved.interactionKind;
    transport = resolved.transport;
    specFormat = resolved.specFormat;

    // Validate against schema
    const kindValidation = ContractKindSchema.safeParse(contractKind);
    if (!kindValidation.success) {
      console.warn(`[response-parser] Invalid contract kind "${contractKind}" for contract "${generatedContract.name}", defaulting to "rest"`);
      contractKind = 'rest';
    }

    // Enrich with interaction fields if not already set
    if (!interactionKind) {
      const fields = inferContractFieldsFromKind(contractKind);
      interactionKind = fields.interactionKind;
      transport = fields.transport;
      specFormat = fields.specFormat;
    }

    const contract: Contract = {
      id: contractId,
      name: generatedContract.name,
      kind: contractKind as Contract['kind'],
      interactionKind: interactionKind as Contract['interactionKind'],
      transport: transport as Contract['transport'],
      specFormat: specFormat as Contract['specFormat'],
      schema: generatedContract.schema,
      schemaRef: undefined,
      metadata: generatedContract.description ? { description: generatedContract.description } : {},
    };

    if (generatedContract.schemaContent) {
      const schemaArtifactId = generateUUID();
      const schemaPath = `schemas/${generatedContract.name.toLowerCase().replace(/\s+/g, '-')}.schema.json`;
      const schemaArtifact: Artifact = {
        id: schemaArtifactId,
        nodeId: '',
        kind: 'schema',
        path: schemaPath,
        content: generatedContract.schemaContent,
        contentHash: computeContentHash(generatedContract.schemaContent),
        createdAt: now(),
        updatedAt: now(),
        metadata: { contractId },
        status: 'draft',
      };
      artifacts.push(schemaArtifact);
      contract.schemaRef = schemaArtifactId;
    }

    contracts.push(contract);
  }

  for (const generatedNode of response.nodes) {
    // Check for deprecated node types
    if (DEPRECATED_NODE_TYPES.has(generatedNode.nodeInfo.type)) {
      throw new Error(
        `Node type '${generatedNode.nodeInfo.type}' is deprecated and cannot be used. ` +
        `Please use the recommended replacement for node '${generatedNode.nodeInfo.label}'.`
      );
    }

    const nodeId = generateUUID();
    const nodeTypeInfo = getNodeTypeById(generatedNode.nodeInfo.type);

    const ports: Port[] = generatedNode.ports.map(portData => ({
      id: generateUUID(),
      name: portData.name,
      direction: portData.direction,
      required: portData.required ?? false,
      contractId: undefined,
    }));

    const nodeArtifactIds: string[] = [];
    for (const artifactData of generatedNode.artifacts) {
      const artifactId = generateUUID();
      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: artifactData.kind,
        path: artifactData.path,
        content: artifactData.content,
        contentHash: computeContentHash(artifactData.content),
        description: artifactData.description,
        createdAt: now(),
        updatedAt: now(),
        metadata: {},
        status: 'draft',
      };
      artifacts.push(artifact);
      nodeArtifactIds.push(artifactId);
    }

    const node: Node = {
      id: nodeId,
      type: generatedNode.nodeInfo.type,
      label: generatedNode.nodeInfo.label,
      ports,
      artifacts: nodeArtifactIds,
      metadata: {
        ...generatedNode.nodeInfo.metadata,
        description: generatedNode.nodeInfo.description,
        position: { x: 0, y: 0 },
        aiGenerated: true,
        language: inferLanguageFromNodeType(generatedNode.nodeInfo.type),
        framework: inferFrameworkFromNodeType(generatedNode.nodeInfo.type),
        nodeTypeInfo: nodeTypeInfo ? {
          domain: nodeTypeInfo.domain,
          color: nodeTypeInfo.color,
          icon: nodeTypeInfo.icon,
        } : undefined,
      },
    };

    labelToIdMap.set(generatedNode.nodeInfo.label, nodeId);
    nodeMap.set(generatedNode.nodeInfo.label, node);
  }

  for (const generatedNode of response.nodes) {
    if (generatedNode.nodeInfo.parentLabel) {
      const node = nodeMap.get(generatedNode.nodeInfo.label);
      const parentId = labelToIdMap.get(generatedNode.nodeInfo.parentLabel);

      if (node && parentId) {
        node.parentId = parentId;
      } else if (node && !parentId) {
        console.warn(`Parent node "${generatedNode.nodeInfo.parentLabel}" not found for node "${generatedNode.nodeInfo.label}"`);
      }
    }
  }

  for (const edgeData of response.edges) {
    const sourceNode = nodeMap.get(edgeData.sourceLabel);
    const targetNode = nodeMap.get(edgeData.targetLabel);
    const contract = contracts.find(c => c.name === edgeData.contractName);

    if (!sourceNode) {
      console.error('[response-parser] Source node not found:', {
        sourceLabel: edgeData.sourceLabel,
        availableLabels: Array.from(nodeMap.keys()),
      });
      throw new Error(
        `Source node "${edgeData.sourceLabel}" not found for edge. ` +
        `Available nodes: ${Array.from(nodeMap.keys()).join(', ')}`
      );
    }
    if (!targetNode) {
      console.error('[response-parser] Target node not found:', {
        targetLabel: edgeData.targetLabel,
        availableLabels: Array.from(nodeMap.keys()),
      });
      throw new Error(
        `Target node "${edgeData.targetLabel}" not found for edge. ` +
        `Available nodes: ${Array.from(nodeMap.keys()).join(', ')}`
      );
    }
    if (!contract) {
      console.error('[response-parser] Contract not found:', {
        contractName: edgeData.contractName,
        availableContracts: contracts.map(c => c.name),
        edge: edgeData,
      });
      throw new Error(
        `Contract "${edgeData.contractName}" not found for edge ${edgeData.sourceLabel} → ${edgeData.targetLabel}. ` +
        `This indicates the AI did not create a matching contract. ` +
        `Available contracts: ${contracts.map(c => c.name).join(', ')}`
      );
    }

    const sourcePorts = (sourceNode.ports || []).filter(p => p.direction === 'out');
    const targetPorts = (targetNode.ports || []).filter(p => p.direction === 'in');

    if (sourcePorts.length > 0) {
      sourcePorts[0].contractId = contract.id;
    }
    if (targetPorts.length > 0) {
      targetPorts[0].contractId = contract.id;
    }

    const edge: Edge = {
      id: generateUUID(),
      source: sourceNode.id,
      target: targetNode.id,
      contractId: contract.id,
      sourcePortId: sourcePorts[0]?.id,
      targetPortId: targetPorts[0]?.id,
      metadata: {
        description: edgeData.description,
        aiGenerated: true,
      },
    };

    // Final validation before adding
    if (!edge.contractId) {
      throw new Error(
        `Internal error: Edge ${edge.source} → ${edge.target} has no contractId after processing. ` +
        `This should never happen.`
      );
    }

    edges.push(edge);
  }

  const nodesArray = Array.from(nodeMap.values());
  const schemaArtifacts = artifacts.filter(a => a.kind === 'schema' && a.nodeId === '');

  return {
    understanding: response.understanding,
    nodes: nodesArray.map(node => ({
      node,
      artifacts: artifacts.filter(a => a.nodeId === node.id),
    })),
    edges,
    contracts,
    schemaArtifacts,
    warnings: response.warnings || [],
    recommendations: response.recommendations || [],
  };
}

export function validateParsedArchitecture(parsed: ParsedArchitecture): { valid: boolean; errors: ParseError[]; warnings?: string[] } {
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  if (parsed.nodes.length === 0) {
    errors.push({
      code: 'NO_NODES',
      message: 'Generated architecture has no nodes',
    });
  }

  for (const { node } of parsed.nodes) {
    if (!node.label || node.label.trim() === '') {
      errors.push({
        code: 'INVALID_NODE_LABEL',
        message: `Node ${node.id} has empty label`,
        context: { nodeId: node.id },
      });
    }

    if (!node.type || node.type.trim() === '') {
      errors.push({
        code: 'INVALID_NODE_TYPE',
        message: `Node ${node.label} has empty type`,
        context: { nodeId: node.id },
      });
    } else {
      // Check if node type exists in our predefined types, but only warn if not found
      const nodeTypeInfo = getNodeTypeById(node.type);
      if (!nodeTypeInfo) {
        warnings.push(`Node ${node.label} uses custom type: ${node.type} (not in predefined list)`);
      }
    }
  }

  for (const edge of parsed.edges) {
    const sourceExists = parsed.nodes.some(({ node }) => node.id === edge.source);
    const targetExists = parsed.nodes.some(({ node }) => node.id === edge.target);

    if (!sourceExists) {
      errors.push({
        code: 'INVALID_EDGE_SOURCE',
        message: `Edge ${edge.id} references non-existent source node`,
        context: { edgeId: edge.id, sourceId: edge.source },
      });
    }

    if (!targetExists) {
      errors.push({
        code: 'INVALID_EDGE_TARGET',
        message: `Edge ${edge.id} references non-existent target node`,
        context: { edgeId: edge.id, targetId: edge.target },
      });
    }

    const contractExists = parsed.contracts.some(c => c.id === edge.contractId);
    if (!contractExists) {
      errors.push({
        code: 'INVALID_EDGE_CONTRACT',
        message: `Edge ${edge.id} references non-existent contract`,
        context: { edgeId: edge.id, contractId: edge.contractId },
      });
    }
  }

  // Use the actual schema enum for validation
  const validContractKinds = ContractKindSchema.options;

  for (const contract of parsed.contracts) {
    if (!contract.name || contract.name.trim() === '') {
      errors.push({
        code: 'INVALID_CONTRACT_NAME',
        message: `Contract ${contract.id} has empty name`,
        context: { contractId: contract.id },
      });
    }

    if (!validContractKinds.includes(contract.kind)) {
      errors.push({
        code: 'INVALID_CONTRACT_KIND',
        message: `Contract ${contract.name} has invalid kind: "${contract.kind}". Must be one of: ${validContractKinds.join(', ')}`,
        context: {
          contractId: contract.id,
          kind: contract.kind,
          validKinds: validContractKinds
        },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function applyLayoutToNodes(nodes: Node[]): Node[] {
  const HORIZONTAL_SPACING = 350;
  const VERTICAL_SPACING = 250;
  const COLUMNS = 3;

  return nodes.map((node, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);

    return {
      ...node,
      metadata: {
        ...node.metadata,
        position: {
          x: column * HORIZONTAL_SPACING + 100,
          y: row * VERTICAL_SPACING + 100,
        },
      },
    };
  });
}
