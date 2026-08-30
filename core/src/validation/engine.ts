import type {
  GraphValidationResult,
  GraphValidationIssue,
  NodeValidationResult,
  EdgeValidationResult,
  ValidationContext,
  AIValidationRequest,
  AIValidationResponse,
} from './types';
import type { Graph } from '../types';
import { VALIDATION_RULES } from './rules';

// S1-1: runAIValidation previously dynamic-imported the Supabase client — an impurity
// invisible to static import grep, on a method with ZERO callers (dormant; see the
// Discovered list). The transport is injected so core stays pure; a future caller wires
// it from the app side before use.
type AIValidationTransport = (
  functionName: string,
  body: Record<string, unknown>,
) => Promise<AIValidationResponse>;

let aiValidationTransport: AIValidationTransport | null = null;

export function setAIValidationTransport(transport: AIValidationTransport): void {
  aiValidationTransport = transport;
}

export class ValidationEngine {
  async validateGraph(graph: Graph): Promise<GraphValidationResult> {
    const allArtifacts = this.buildArtifactMap(graph);
    const allEdges = Object.values(graph.edges || {});
    const issues: GraphValidationIssue[] = [];
    const nodeResults = new Map<string, NodeValidationResult>();
    const edgeResults = new Map<string, EdgeValidationResult>();

    for (const node of Object.values(graph.nodes)) {
      const nodeIssues = this.validateNode(node, graph, allArtifacts, allEdges);
      const result: NodeValidationResult = {
        nodeId: node.id,
        valid: nodeIssues.length === 0,
        issues: nodeIssues,
        completeness: this.assessNodeCompleteness(node, graph, allArtifacts, allEdges),
      };
      nodeResults.set(node.id, result);
      issues.push(...nodeIssues);
    }

    for (const edge of allEdges) {
      const edgeIssues = this.validateEdge(edge, graph, allArtifacts, allEdges);
      const contract = graph.contracts[edge.contractId];
      const result: EdgeValidationResult = {
        edgeId: edge.id,
        valid: edgeIssues.length === 0,
        issues: edgeIssues,
        contractValid: !!contract?.kind,
        schemaPresent: !!(contract?.schema || contract?.schemaRef),
      };
      edgeResults.set(edge.id, result);
      issues.push(...edgeIssues);
    }

    return {
      valid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      timestamp: new Date(),
      nodeResults,
      edgeResults,
    };
  }

  validateNode(
    node: any,
    graph: Graph,
    allArtifacts: Map<string, any>,
    allEdges: any[]
  ): GraphValidationIssue[] {
    const context: ValidationContext = {
      graph,
      node,
      allArtifacts,
      allEdges,
    };

    const issues: GraphValidationIssue[] = [];

    for (const rule of VALIDATION_RULES) {
      if (rule.category === 'port_configuration' || rule.category === 'artifact_consistency' || rule.category === 'configuration_consistency' || rule.category === 'containment' || rule.category === 'dependency_alignment') {
        const ruleIssues = rule.check(context);
        issues.push(...ruleIssues);
      }
    }

    return issues;
  }

  validateEdge(
    edge: any,
    graph: Graph,
    allArtifacts: Map<string, any>,
    allEdges: any[]
  ): GraphValidationIssue[] {
    const context: ValidationContext = {
      graph,
      edge,
      allArtifacts,
      allEdges,
    };

    const issues: GraphValidationIssue[] = [];

    for (const rule of VALIDATION_RULES) {
      if (
        rule.category === 'graph_structure' ||
        rule.category === 'contract_schema'
      ) {
        const ruleIssues = rule.check(context);
        issues.push(...ruleIssues);
      }
    }

    return issues;
  }

  private assessNodeCompleteness(
    node: any,
    graph: Graph,
    allArtifacts: Map<string, any>,
    allEdges: any[]
  ) {
    const nodeArtifacts = Array.from(allArtifacts.values()).filter(
      (a: any) => a.nodeId === node.id
    );
    const nodeEdges = allEdges.filter((e: any) => e.source === node.id || e.target === node.id);
    const ports = node.ports || [];

    const hasRequiredArtifacts = nodeArtifacts.length > 0;

    const allPortsConnected = ports.every((port: any) => {
      const direction = port.direction;
      return nodeEdges.some((e: any) => {
        if (direction === 'in') {
          return e.target === node.id && e.targetPortId === port.id;
        }
        if (direction === 'out') {
          return e.source === node.id && e.sourcePortId === port.id;
        }
        return false;
      });
    });

    const relevantEdges = nodeEdges.filter((e: any) => e.source === node.id);
    const allContractsHaveSchemas = relevantEdges.every((e: any) => {
      const contract = graph.contracts[e.contractId];
      if (!contract) return false;
      const needsSchema = ['rest', 'graphql', 'grpc'].includes(contract.kind);
      if (!needsSchema) return true;
      return !!(contract.schema || contract.schemaRef);
    });

    return {
      hasRequiredArtifacts,
      allPortsConnected,
      allContractsHaveSchemas,
    };
  }

  private buildArtifactMap(graph: Graph): Map<string, any> {
    const map = new Map<string, any>();
    for (const artifactId in graph.artifacts) {
      const artifact = graph.artifacts[artifactId];
      map.set(artifact.id, artifact);
    }
    return map;
  }

  async runAIValidation(
    request: AIValidationRequest
  ): Promise<AIValidationResponse> {
    try {
      if (!aiValidationTransport) {
        throw new Error('AI validation transport not configured (setAIValidationTransport)');
      }
      return await aiValidationTransport(
        'validate-implementation-v4',
        request as unknown as Record<string, unknown>
      );
    } catch (error) {
      console.error('AI validation error:', error);
      return {
        valid: false,
        issues: [
          {
            severity: 'error',
            message: 'AI validation service unavailable',
          },
        ],
        suggestions: [],
      };
    }
  }
}

export const validationEngine = new ValidationEngine();
