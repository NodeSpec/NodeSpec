import type {
  ValidationRule,
  GraphValidationIssue,
  ValidationContext,
  ValidationSeverity,
  ValidationCategory,
} from './types';
import type { ContractKind } from '../types';
import { getNodeTypeById } from '../node-types.js';
import { assessConfigStaleness } from '../configuration-fingerprint.js';
import { assessTaskStaleness } from '../task-context-fingerprint.js';
import { extractNodeDomainMetadata } from '../node-metadata.js';
import { canContainerHoldNode } from '../container-types.js';
import { providerFamilyForId, normalizeProviderFamily } from '../provider-inference.js';

function createIssue(
  severity: ValidationSeverity,
  category: ValidationCategory,
  message: string,
  description: string,
  context: Partial<GraphValidationIssue>,
  quickFixes: GraphValidationIssue['quickFixes'] = []
): GraphValidationIssue {
  return {
    id: `${category}-${Date.now()}-${Math.random()}`,
    severity,
    category,
    message,
    description,
    quickFixes,
    ...context,
  };
}

const edgeHasContract: ValidationRule = {
  id: 'edge-has-contract',
  name: 'Edge must have contract',
  category: 'graph_structure',
  severity: 'error',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.edge) return [];

    const edge = context.edge;
    const contract = context.graph.contracts[edge.contractId];
    if (!contract || !contract.kind) {
      return [
        createIssue(
          'error',
          'graph_structure',
          'Edge missing contract',
          'This connection needs a contract type to define how these components communicate.',
          { edgeId: edge.id },
          [
            {
              id: 'add-rest-contract',
              label: 'Add REST Contract',
              description: 'Add HTTP/REST API contract',
              action: {
                type: 'update_contract',
                edgeId: edge.id,
                updates: { kind: 'rest' as ContractKind },
              },
            },
            {
              id: 'add-dataflow-contract',
              label: 'Add Data Flow Contract',
              description: 'Add direct data flow contract',
              action: {
                type: 'update_contract',
                edgeId: edge.id,
                updates: { kind: 'sql' as ContractKind },
              },
            },
          ]
        ),
      ];
    }
    return [];
  },
};

const contractHasSchema: ValidationRule = {
  id: 'contract-has-schema',
  name: 'Complete contracts must have schemas',
  category: 'contract_schema',
  severity: 'warning',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.edge) return [];

    const edge = context.edge;
    const contract = context.graph.contracts[edge.contractId];

    if (!contract) return [];

    const needsSchema = ['rest', 'graphql', 'grpc'].includes(contract.kind);
    const hasSchema = !!(contract.schemaRef || contract.schema);

    if (needsSchema && !hasSchema) {
      return [
        createIssue(
          'warning',
          'contract_schema',
          `${contract.kind.toUpperCase()} contract missing schema`,
          `This ${contract.kind} contract should reference a schema artifact (e.g., OpenAPI spec) to define the API interface.`,
          { edgeId: edge.id, nodeId: edge.source },
          [
            {
              id: 'create-schema-artifact',
              label: 'Generate Schema',
              description: 'Create schema artifact from existing code',
              action: {
                type: 'create_artifact',
                artifactKind: 'schema',
                nodeId: edge.source,
              },
            },
            {
              id: 'ai-generate-schema',
              label: 'AI: Generate Schema',
              description: 'Use AI to analyze code and generate schema',
              action: {
                type: 'run_ai_validation',
                nodeId: edge.source,
                validationType: 'schema_match',
              },
            },
          ]
        ),
      ];
    }

    return [];
  },
};

const schemaRefValid: ValidationRule = {
  id: 'schema-ref-valid',
  name: 'Schema references must point to valid artifacts',
  category: 'contract_schema',
  severity: 'error',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.edge) return [];

    const edge = context.edge;
    const contract = context.graph.contracts[edge.contractId];

    if (!contract?.schemaRef) return [];

    const artifact = context.allArtifacts.get(contract.schemaRef);

    if (!artifact) {
      return [
        createIssue(
          'error',
          'contract_schema',
          'Schema reference points to missing artifact',
          `Contract references artifact ID "${contract.schemaRef}" but it doesn't exist.`,
          { edgeId: edge.id },
          []
        ),
      ];
    }

    // N8.6(B): getSchemaKindForContract was a no-op oracle — it returned 'schema'
    // for every input (its mapping only ever mapped to 'schema', fallback 'schema',
    // and still spoke the retired data_flow token). A contract's schemaRef must point
    // at a schema artifact, full stop.
    if (artifact.kind !== 'schema') {
      return [
        createIssue(
          'error',
          'contract_schema',
          'Schema artifact kind mismatch',
          `${contract.kind} contracts should reference schema artifacts, but this references a ${artifact.kind} artifact.`,
          { edgeId: edge.id, artifactId: artifact.id },
          []
        ),
      ];
    }

    return [];
  },
};

const nodeHasRequiredPorts: ValidationRule = {
  id: 'node-has-required-ports',
  name: 'Nodes must have ports matching their connections',
  category: 'port_configuration',
  severity: 'info',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    const edges = context.allEdges.filter(
      (e: any) => e.source === node.id || e.target === node.id
    );

    const issues: GraphValidationIssue[] = [];
    const ports = node.ports || [];

    for (const edge of edges) {
      const portId = edge.source === node.id ? edge.sourcePortId : edge.targetPortId;

      if (!portId) continue;

      const portExists = ports.some((p: any) => p.id === portId);

      if (!portExists) {
        const isSource = edge.source === node.id;
        const direction = isSource ? 'out' : 'in';
        const contract = context.graph.contracts[edge.contractId];
        const contractKind = contract?.kind || 'unknown';

        issues.push(
          createIssue(
            'warning',
            'port_configuration',
            `Edge references missing connection point`,
            `Connection to ${isSource ? 'target' : 'source'} node references port ID "${portId}" which doesn't exist.`,
            { nodeId: node.id, edgeId: edge.id, portId },
            [
              {
                id: 'add-port',
                label: 'Add Connection Point',
                description: `Add ${direction}put connection point`,
                action: {
                  type: 'add_port',
                  nodeId: node.id,
                  direction,
                  contractKind,
                },
              },
            ]
          )
        );
      }
    }

    return issues;
  },
};

const artifactImplementsContract: ValidationRule = {
  id: 'artifact-implements-contract',
  name: 'Verify artifacts implement their contracts',
  category: 'artifact_consistency',
  severity: 'info',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    const nodeArtifacts = Array.from(context.allArtifacts.values()).filter(
      (a: any) => a.nodeId === node.id
    );

    if (nodeArtifacts.length === 0) return [];

    const nodeEdges = context.allEdges.filter(
      (e: any) => e.source === node.id || e.target === node.id
    );

    const hasContracts = nodeEdges.some((e: any) => context.graph.contracts[e.contractId]);
    const hasSourceCode = nodeArtifacts.some((a: any) => a.kind === 'source');

    if (hasContracts && hasSourceCode) {
      return [
        createIssue(
          'info',
          'artifact_consistency',
          'Verify code matches contracts',
          'Run AI validation to ensure implementation matches interface definitions.',
          { nodeId: node.id },
          [
            {
              id: 'run-ai-validation',
              label: 'Run AI Validation',
              description: 'Check if code implements contracts correctly',
              action: {
                type: 'run_ai_validation',
                nodeId: node.id,
                validationType: 'schema_match',
              },
            },
          ]
        ),
      ];
    }

    return [];
  },
};

const portMatchesNodeTypeTemplate: ValidationRule = {
  id: 'port-matches-node-type-template',
  name: 'Ports should match node type template',
  category: 'port_configuration',
  severity: 'warning',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    const typeDef = getNodeTypeById(node.type);
    if (!typeDef?.defaultPorts || typeDef.defaultPorts.length === 0) return [];

    const issues: GraphValidationIssue[] = [];
    const ports = node.ports || [];

    const requiredTemplatePorts = typeDef.defaultPorts.filter(tp => tp.required === true);

    for (const templatePort of requiredTemplatePorts) {
      const portsOfDirection = ports.filter((p: any) => p.direction === templatePort.direction);

      if (portsOfDirection.length === 0) {
        issues.push(
          createIssue(
            'warning',
            'port_configuration',
            `Missing required ${templatePort.direction}put port`,
            `Node type "${typeDef.label}" expects a ${templatePort.direction}put port "${templatePort.name}" but none exists.`,
            { nodeId: node.id },
            [
              {
                id: `reconcile-ports-${node.id}-${templatePort.direction}`,
                label: 'Reconcile Ports',
                description: `Add missing ${templatePort.direction}put port from template`,
                action: {
                  type: 'reconcile_ports',
                  nodeId: node.id,
                  suggestedPorts: [{ name: templatePort.name, direction: templatePort.direction, required: templatePort.required }],
                },
              },
            ]
          )
        );
      } else {
        const nameMatches = portsOfDirection.some((p: any) => p.name === templatePort.name);
        if (!nameMatches) {
          issues.push(
            createIssue(
              'info',
              'port_configuration',
              `Port name differs from template`,
              `Template expects "${templatePort.name}" but node has "${portsOfDirection.map((p: any) => p.name).join(', ')}". The port may be stale.`,
              { nodeId: node.id },
              [
                {
                  id: `reconcile-port-name-${node.id}-${templatePort.direction}`,
                  label: 'Reconcile Port Names',
                  description: `Rename port to match template "${templatePort.name}"`,
                  action: {
                    type: 'reconcile_ports',
                    nodeId: node.id,
                    suggestedPorts: [{ name: templatePort.name, direction: templatePort.direction, required: templatePort.required }],
                  },
                },
              ]
            )
          );
        }
      }
    }

    return issues;
  },
};

const configArtifactStaleness: ValidationRule = {
  id: 'config-artifact-staleness',
  name: 'Configuration should be in sync with artifacts',
  category: 'configuration_consistency',
  severity: 'warning',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    const staleness = assessConfigStaleness(node, context.graph);

    const issues: GraphValidationIssue[] = [];

    if (staleness.status === 'config_ahead') {
      const changedList = staleness.changedFields.length > 0
        ? staleness.changedFields.join(', ')
        : 'unknown fields';
      issues.push(
        createIssue(
          'warning',
          'configuration_consistency',
          'Configuration has changed since artifacts were last generated',
          `Changed fields: ${changedList}.`,
          { nodeId: node.id },
          [
            {
              id: `mark-stale-${node.id}`,
              label: 'Mark Artifacts Stale',
              description: 'Flag artifacts as needing regeneration',
              action: {
                type: 'mark_artifacts_stale',
                nodeId: node.id,
                reason: `Configuration changed: ${changedList}`,
              },
            },
          ]
        )
      );
    } else if (staleness.status === 'no_artifacts') {
      const domainMeta = extractNodeDomainMetadata(node.metadata);
      if (domainMeta && domainMeta.data) {
        const dataKeys = Object.keys(domainMeta.data).filter(k => {
          const val = (domainMeta.data as unknown as Record<string, unknown>)[k];
          return val !== undefined && val !== null && val !== '' &&
            !(Array.isArray(val) && val.length === 0);
        });
        if (dataKeys.length > 0) {
          issues.push(
            createIssue(
              'info',
              'configuration_consistency',
              'Node has configuration but no code artifacts yet',
              'Consider generating artifacts from the current configuration.',
              { nodeId: node.id },
              []
            )
          );
        }
      }
    }

    return issues;
  },
};

const edgePortDirectionValid: ValidationRule = {
  id: 'edge-port-direction-valid',
  name: 'Edge port references must have correct direction',
  category: 'graph_structure',
  severity: 'error',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.edge) return [];

    const edge = context.edge;
    const issues: GraphValidationIssue[] = [];

    const sourceNode = context.graph.nodes[edge.source];
    const targetNode = context.graph.nodes[edge.target];

    if (edge.sourcePortId && sourceNode) {
      const sourcePorts = sourceNode.ports || [];
      const sourcePort = sourcePorts.find((p: any) => p.id === edge.sourcePortId);
      if (sourcePort && sourcePort.direction !== 'out' && sourcePort.direction !== 'bidirectional') {
        issues.push(
          createIssue(
            'error',
            'graph_structure',
            'Source port has wrong direction',
            `Edge source references port "${sourcePort.name}" which has direction "${sourcePort.direction}" instead of "out" or "bidirectional".`,
            { edgeId: edge.id, nodeId: edge.source, portId: edge.sourcePortId },
            [
              {
                id: `swap-ports-${edge.id}`,
                label: 'Swap Port References',
                description: 'Swap source and target port IDs',
                action: {
                  type: 'update_contract',
                  edgeId: edge.id,
                  updates: { sourcePortId: edge.targetPortId, targetPortId: edge.sourcePortId },
                },
              },
            ]
          )
        );
      }
    }

    if (edge.targetPortId && targetNode) {
      const targetPorts = targetNode.ports || [];
      const targetPort = targetPorts.find((p: any) => p.id === edge.targetPortId);
      if (targetPort && targetPort.direction !== 'in' && targetPort.direction !== 'bidirectional') {
        issues.push(
          createIssue(
            'error',
            'graph_structure',
            'Target port has wrong direction',
            `Edge target references port "${targetPort.name}" which has direction "${targetPort.direction}" instead of "in" or "bidirectional".`,
            { edgeId: edge.id, nodeId: edge.target, portId: edge.targetPortId },
            [
              {
                id: `swap-ports-${edge.id}`,
                label: 'Swap Port References',
                description: 'Swap source and target port IDs',
                action: {
                  type: 'update_contract',
                  edgeId: edge.id,
                  updates: { sourcePortId: edge.targetPortId, targetPortId: edge.sourcePortId },
                },
              },
            ]
          )
        );
      }
    }

    return issues;
  },
};

const containmentMismatch: ValidationRule = {
  id: 'containment-mismatch',
  name: 'Node must be allowed inside its parent container',
  category: 'containment',
  severity: 'error',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    if (!node.parentId) return [];

    const parent = context.graph.nodes?.[node.parentId];
    if (!parent) return [];

    if (!canContainerHoldNode(parent.type, node.type, undefined, node.technology, parent.technology)) {
      return [
        createIssue(
          'error',
          'containment',
          'Invalid container placement',
          `"${node.label}" (${node.type}) cannot be placed inside "${parent.label}" (${parent.type}). Move it to a valid container or remove the parent relationship.`,
          { nodeId: node.id },
          [
            {
              id: 'unparent-node',
              label: 'Remove from container',
              description: `Remove "${node.label}" from "${parent.label}"`,
              action: { type: 'unparent_node', nodeId: node.id },
            },
          ]
        ),
      ];
    }

    return [];
  },
};

// M7: FALLBACK_PLATFORM_CAPABILITY_ROLES is DELETED. It listed nine role ids that no longer
// exist (the capability roles M1b/M7 retired) plus four — dns, waf, secret-manager,
// certificate-manager — that DO exist but are ordinary `build` Networking roles, so the
// fallback path fired FALSE ERRORS on them whenever the catalog had not loaded.
//
// More fundamentally: the rule keyed on the ROLE being a managed capability, and after the
// capability-role retirement no role is. `aws-lambda` is a TECHNOLOGY bound to a generic
// role. "Is this a managed provider capability?" is now a question about the technology, so
// that is what this rule asks — via the one provider table (core/src/provider-inference.ts).
// 'firebase' stays although M3 deleted the ROLE: old graphs still carry firebase platform
// NODES, and this set only fires when the catalog resolver is absent.
const FALLBACK_PLATFORM_ROLES = new Set([
  'aws', 'azure', 'gcp', 'firebase', 'cloudflare', 'supabase',
  'vercel', 'netlify', 'railway', 'render', 'fly-io',
]);

const orphanedPlatformCapability: ValidationRule = {
  id: 'orphaned-platform-capability',
  name: 'Platform capability must have a platform parent',
  category: 'containment',
  severity: 'error',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    const resolver = context.roleResolver;

    const nodeRole = resolver?.(node.type);
    // The provider family the node belongs to, from its TECHNOLOGY (aws-lambda, gcp-cloud-run,
    // firebase-firestore -> gcp). A role may still declare a provider; the technology wins
    // because it is the axis that survived the capability-role retirement.
    const nodeProvider = providerFamilyForId(node.technology ?? '')
      ?? normalizeProviderFamily(nodeRole?.provider ?? null);
    if (!nodeProvider) return [];

    if (!node.parentId) {
      return [
        createIssue(
          'error',
          'containment',
          'Orphaned managed service',
          `"${node.label}" (${node.type}) is a managed ${nodeProvider.toUpperCase()} service but has no parent platform node. Place it inside its provider platform container, or bind a self-hosted technology instead.`,
          { nodeId: node.id },
          [
            {
              id: `unparent-cap-${node.id}`,
              label: 'Remove from graph',
              description: 'Convert to a standalone role instead',
              action: { type: 'unparent_node', nodeId: node.id },
            },
          ]
        ),
      ];
    }

    const parent = context.graph.nodes?.[node.parentId];
    if (!parent) return [];

    const parentRole = resolver?.(parent.type);
    const parentIsPlatform = parentRole
      ? parentRole.nature === 'host'
      : FALLBACK_PLATFORM_ROLES.has(parent.type);

    if (!parentIsPlatform) {
      return [
        createIssue(
          'error',
          'containment',
          'Managed service under non-platform parent',
          `"${node.label}" (${node.type}) is a managed ${nodeProvider.toUpperCase()} service but its parent "${parent.label}" (${parent.type}) is not a platform node. Move it under a platform container, or bind a self-hosted technology instead.`,
          { nodeId: node.id },
          [
            {
              id: `unparent-cap-${node.id}`,
              label: 'Remove from container',
              description: `Remove "${node.label}" from "${parent.label}"`,
              action: { type: 'unparent_node', nodeId: node.id },
            },
          ]
        ),
      ];
    }

    if (normalizeProviderFamily(parentRole?.provider ?? parent.type) !== nodeProvider) {
      return [
        createIssue(
          'warning',
          'containment',
          'Managed service under the wrong provider',
          `"${node.label}" (${node.type}) belongs to provider "${nodeProvider}" but is placed under "${parent.label}" (${parent.type}). Move it under the correct provider platform.`,
          { nodeId: node.id },
          [
            {
              id: `unparent-cap-${node.id}`,
              label: 'Remove from container',
              description: `Remove "${node.label}" from "${parent.label}"`,
              action: { type: 'unparent_node', nodeId: node.id },
            },
          ]
        ),
      ];
    }

    return [];
  },
};

const taskDocumentStaleness: ValidationRule = {
  id: 'task-document-staleness',
  name: 'Task document should reflect current architecture context',
  category: 'dependency_alignment',
  severity: 'warning',
  check: (context: ValidationContext): GraphValidationIssue[] => {
    if (!context.node) return [];

    const node = context.node;
    const graph = context.graph;

    const hasTaskArtifact = (node.artifacts || []).some((aid: string) => {
      const a = graph.artifacts[aid];
      return a && a.kind === 'task';
    }) || Object.values(graph.artifacts).some(
      (a: any) => a.nodeId === node.id && a.kind === 'task'
    );

    if (!hasTaskArtifact) return [];

    const staleness = assessTaskStaleness(node.id, graph);

    if (staleness.status !== 'stale') return [];

    const changedList = staleness.changedAreas.length > 0
      ? staleness.changedAreas.join(', ')
      : 'context';

    const issues: GraphValidationIssue[] = [];

    issues.push(
      createIssue(
        'warning',
        'dependency_alignment',
        `Task document is stale -- ${changedList} changed since it was generated`,
        staleness.message,
        { nodeId: node.id },
        [
          {
            id: `regenerate-task-${node.id}`,
            label: 'Regenerate Task Document',
            description: 'Regenerate the task document from current architecture data',
            action: {
              type: 'regenerate_task',
              nodeId: node.id,
            },
          },
          {
            id: `mark-code-stale-${node.id}`,
            label: 'Mark Code as Stale',
            description: 'Flag source artifacts as needing updates due to changed context',
            action: {
              type: 'mark_artifacts_stale',
              nodeId: node.id,
              reason: `Task document stale: ${changedList} changed`,
            },
          },
        ]
      )
    );

    const sourceArtifactIds = (node.artifacts || []).filter((aid: string) => {
      const a = graph.artifacts[aid];
      return a && a.kind !== 'task' && a.status !== 'suggested';
    });

    if (sourceArtifactIds.length > 0) {
      issues.push(
        createIssue(
          'info',
          'dependency_alignment',
          `${sourceArtifactIds.length} source artifact(s) may be outdated on "${node.label}"`,
          'The task document context has changed, which means source code generated from it may no longer match the current architecture.',
          { nodeId: node.id },
          [
            {
              id: `regenerate-code-${node.id}`,
              label: 'Regenerate Code',
              description: 'Trigger scaffold iteration to update source code',
              action: {
                type: 'regenerate_code',
                nodeId: node.id,
              },
            },
          ]
        )
      );
    }

    return issues;
  },
};

export const VALIDATION_RULES: ValidationRule[] = [
  edgeHasContract,
  contractHasSchema,
  schemaRefValid,
  nodeHasRequiredPorts,
  portMatchesNodeTypeTemplate,
  artifactImplementsContract,
  configArtifactStaleness,
  edgePortDirectionValid,
  containmentMismatch,
  orphanedPlatformCapability,
  taskDocumentStaleness,
];
