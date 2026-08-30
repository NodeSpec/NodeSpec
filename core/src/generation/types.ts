import { z } from 'zod';
import type { Graph, Node, Edge, Contract, Artifact, ContractKind } from '../types.js';

export type GenerationMode = 'create' | 'refine';

export interface ArchitectureSpecification {
  mode: GenerationMode;
  description: string;
  existingGraph?: Graph;
  constraints?: string[];
  preferences?: {
    preferredLanguages?: string[];
    deploymentTarget?: string;
    scalabilityRequirements?: string;
  };
}

export const GeneratedNodeSchema = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  parentLabel: z.string().optional(),
});

export const GeneratedPortSchema = z.object({
  name: z.string(),
  direction: z.enum(['in', 'out']),
  required: z.boolean().optional(),
});

export const GeneratedContractSchema = z.object({
  name: z.string(),
  kind: z.string(),
  description: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
  schemaContent: z.string().optional(),
});

export const GeneratedArtifactSchema = z.object({
  path: z.string(),
  kind: z.enum(['source', 'schema', 'doc', 'config', 'build']),
  content: z.string(),
  description: z.string().optional(),
});

export const GeneratedEdgeSchema = z.object({
  sourceLabel: z.string(),
  targetLabel: z.string(),
  contractName: z.string(),
  description: z.string().optional(),
});

export const ArchitectureGenerationResponseSchema = z.object({
  understanding: z.string(),
  nodes: z.array(z.object({
    nodeInfo: GeneratedNodeSchema,
    ports: z.array(GeneratedPortSchema),
    artifacts: z.array(GeneratedArtifactSchema),
  })),
  edges: z.array(GeneratedEdgeSchema),
  contracts: z.array(GeneratedContractSchema),
  warnings: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
});

export type ArchitectureGenerationResponse = z.infer<typeof ArchitectureGenerationResponseSchema>;

export interface ParsedArchitecture {
  understanding: string;
  nodes: Array<{
    node: Node;
    artifacts: Artifact[];
  }>;
  edges: Edge[];
  contracts: Contract[];
  schemaArtifacts: Artifact[];
  warnings: string[];
  recommendations: string[];
  specification?: {
    vision: string;
    features?: Array<{ name: string; description?: string }>;
    constraints?: Array<{ type: string; description: string }>;
    preferences?: {
      languages?: string[];
      frameworks?: string[];
      databases?: string[];
      deploymentTarget?: string;
      architecturePattern?: 'monolith' | 'microservices' | 'serverless' | 'unknown';
    };
  };
}

export interface GenerationContext {
  availableNodeTypes: string[];
  availableContractKinds: ContractKind[];
  nodeTypeDescriptions: Record<string, string>;
  commonPatterns: string[];
  bestPractices: string[];
}
