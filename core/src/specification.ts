import type {
  RequirementCategory,
  RequirementStatus,
  AcceptanceCriterion,
} from './specification-format.js';

export interface ProjectSpecification {
  vision: string;
  constraints: Constraint[];
  preferences: TechnologyPreferences;
  rawInput?: string;
  metadata?: Record<string, any>;
  lockedNodes?: string[]; // Array of node IDs locked from AI modifications
}

export interface Constraint {
  type: 'technology' | 'architecture' | 'deployment' | 'performance' | 'other';
  description: string;
}

export type ScopeArchetype =
  | 'simple-web-app'
  | 'cloud-native'
  | 'desktop-app'
  | 'mobile-app'
  | 'iot-embedded'
  | 'data-pipeline'
  | 'enterprise-platform';

export const SCOPE_ARCHETYPES: ScopeArchetype[] = [
  'simple-web-app',
  'cloud-native',
  'desktop-app',
  'mobile-app',
  'iot-embedded',
  'data-pipeline',
  'enterprise-platform',
];

export interface TechnologyPreferences {
  languages?: string[];
  frameworks?: string[];
  databases?: string[];
  deploymentTarget?: string;
  architecturePattern?: 'monolith' | 'microservices' | 'serverless' | 'unknown';
  scopeArchetypes?: ScopeArchetype[];
  specEnabled?: boolean;
}

export interface Requirement {
  requirementId: string;
  name: string;
  description: string;
  category: RequirementCategory;
  status: RequirementStatus;
  locked?: boolean;
  acceptanceCriteria: AcceptanceCriterion[];
  metadata: RequirementMetadata;
}

export interface RequirementMetadata {
  confidence?: number;
  rationale?: string;
  dependencies?: string[];
  [key: string]: any;
}

export interface RequirementMapping {
  requirementId: string | null;
  nodeId: string;
  mappingType: 'implements' | 'depends_on' | 'validates' | 'supports';
  confidence: number;
  notes?: string;
}

export type MappingType = RequirementMapping['mappingType'];
