import type { ContractKind } from '../types';
import type { RoleResolver } from '../container-types';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCategory =
  | 'graph_structure'
  | 'contract_schema'
  | 'artifact_consistency'
  | 'dependency_alignment'
  | 'port_configuration'
  | 'configuration_consistency'
  | 'containment';

export interface GraphValidationIssue {
  id: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  message: string;
  description?: string;
  nodeId?: string;
  edgeId?: string;
  artifactId?: string;
  portId?: string;
  quickFixes: ValidationQuickFix[];
}

export interface ValidationQuickFix {
  id: string;
  label: string;
  description: string;
  action: QuickFixAction;
}

export type QuickFixAction =
  | { type: 'create_artifact'; artifactKind: string; nodeId: string; templateContent?: string }
  | { type: 'link_schema'; contractId: string; artifactId: string }
  | { type: 'add_port'; nodeId: string; direction: 'in' | 'out'; contractKind: ContractKind }
  | { type: 'create_edge'; sourceId: string; targetId: string; contractKind: ContractKind }
  | { type: 'update_contract'; edgeId: string; updates: object }
  | { type: 'run_ai_validation'; nodeId: string; validationType: 'schema_match' | 'dependency_check' }
  | { type: 'reconcile_ports'; nodeId: string; suggestedPorts: Array<{ name: string; direction: 'in' | 'out'; required?: boolean }> }
  | { type: 'mark_artifacts_stale'; nodeId: string; reason: string }
  | { type: 'unparent_node'; nodeId: string }
  | { type: 'regenerate_task'; nodeId: string }
  | { type: 'regenerate_code'; nodeId: string };

export interface GraphValidationResult {
  valid: boolean;
  issues: GraphValidationIssue[];
  timestamp: Date;
  nodeResults: Map<string, NodeValidationResult>;
  edgeResults: Map<string, EdgeValidationResult>;
}

export interface NodeValidationResult {
  nodeId: string;
  valid: boolean;
  issues: GraphValidationIssue[];
  completeness: {
    hasRequiredArtifacts: boolean;
    allPortsConnected: boolean;
    allContractsHaveSchemas: boolean;
  };
}

export interface EdgeValidationResult {
  edgeId: string;
  valid: boolean;
  issues: GraphValidationIssue[];
  contractValid: boolean;
  schemaPresent: boolean;
}

export interface ValidationRule {
  id: string;
  name: string;
  category: ValidationCategory;
  severity: ValidationSeverity;
  check: (context: ValidationContext) => GraphValidationIssue[];
}

export interface ValidationContext {
  graph: any;
  node?: any;
  edge?: any;
  artifact?: any;
  allArtifacts: Map<string, any>;
  allEdges: any[];
  roleResolver?: RoleResolver;
}

export interface AIValidationRequest {
  type: 'schema_match' | 'dependency_check';
  nodeId: string;
  schemaArtifactId?: string;
  implementationArtifactId?: string;
  context: string;
}

export interface AIValidationResponse {
  valid: boolean;
  issues: Array<{
    severity: ValidationSeverity;
    message: string;
    location?: string;
  }>;
  suggestions: string[];
}
