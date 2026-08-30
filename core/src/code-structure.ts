import { z } from 'zod';

export const CodeEntityTypeSchema = z.enum([
  'class',
  'function',
  'interface',
  'method',
  'module',
  'struct',
  'trait',
]);

export const CodeVisibilitySchema = z.enum(['public', 'private', 'protected']);

export const ParameterSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
});

export const CodeEntitySchema = z.object({
  id: z.string(),
  type: CodeEntityTypeSchema,
  name: z.string(),
  parent: z.string().optional(),
  lineStart: z.number(),
  lineEnd: z.number(),
  visibility: CodeVisibilitySchema.optional(),
  isExported: z.boolean(),
  parameters: z.array(ParameterSchema).optional(),
  returnType: z.string().optional(),
  complexity: z.number().optional(),
  dependencies: z.array(z.string()),
});

export const RelationshipTypeSchema = z.enum([
  'calls',
  'imports',
  'extends',
  'implements',
  'composes',
]);

export const RelationshipStrengthSchema = z.enum(['tight', 'loose']);

export const CodeRelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: RelationshipTypeSchema,
  strength: RelationshipStrengthSchema,
});

export const CodeModuleSchema = z.object({
  name: z.string(),
  path: z.string(),
  entities: z.array(z.string()),
});

export const CodeMetricsSchema = z.object({
  totalLines: z.number(),
  totalFunctions: z.number(),
  totalClasses: z.number(),
  averageComplexity: z.number(),
  couplingScore: z.number(),
  circularDependencies: z.array(z.array(z.string())),
});

export const ParseDepthSchema = z.enum(['shallow', 'deep']);

export const CodeStructureSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  nodeId: z.string(),
  projectId: z.string(),
  entities: z.array(CodeEntitySchema),
  relationships: z.array(CodeRelationshipSchema),
  modules: z.array(CodeModuleSchema).optional(),
  metrics: CodeMetricsSchema.optional(),
  language: z.string(),
  parseDepth: ParseDepthSchema,
  contentHash: z.string().optional(),
  parsedAt: z.string(),
  parserVersion: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CodeEntityType = z.infer<typeof CodeEntityTypeSchema>;
export type CodeVisibility = z.infer<typeof CodeVisibilitySchema>;
export type Parameter = z.infer<typeof ParameterSchema>;
export type CodeEntity = z.infer<typeof CodeEntitySchema>;
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type RelationshipStrength = z.infer<typeof RelationshipStrengthSchema>;
export type CodeRelationship = z.infer<typeof CodeRelationshipSchema>;
export type CodeModule = z.infer<typeof CodeModuleSchema>;
export type CodeMetrics = z.infer<typeof CodeMetricsSchema>;
export type ParseDepth = z.infer<typeof ParseDepthSchema>;
export type CodeStructure = z.infer<typeof CodeStructureSchema>;

export interface ParseCodeStructureRequest {
  artifactId: string;
  artifactContent: string;
  language: string;
  parseDepth?: ParseDepth;
}

export interface ParseCodeStructureResponse {
  success: boolean;
  artifactId: string;
  structure: {
    entities: CodeEntity[];
    relationships: CodeRelationship[];
    modules: CodeModule[];
    metrics: CodeMetrics;
  };
}

export function detectLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();

  const extensionMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
  };

  return extensionMap[ext || ''] || 'other';
}

export function calculateComplexityColor(complexity?: number): string {
  if (!complexity) return '#6b7280';
  if (complexity < 5) return '#10b981';
  if (complexity < 10) return '#f59e0b';
  return '#ef4444';
}

export function calculateCouplingColor(couplingScore: number): string {
  if (couplingScore < 30) return '#10b981';
  if (couplingScore < 60) return '#f59e0b';
  return '#ef4444';
}

export function getEntityIcon(type: CodeEntityType): string {
  const icons: Record<CodeEntityType, string> = {
    class: '🏛️',
    function: '⚡',
    interface: '📋',
    method: '🔧',
    module: '📦',
    struct: '🧱',
    trait: '🎭',
  };
  return icons[type] || '📄';
}

export function getRelationshipColor(type: RelationshipType): string {
  const colors: Record<RelationshipType, string> = {
    calls: '#10b981',
    imports: '#6366f1',
    extends: '#f59e0b',
    implements: '#8b5cf6',
    composes: '#ec4899',
  };
  return colors[type] || '#6b7280';
}

export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
