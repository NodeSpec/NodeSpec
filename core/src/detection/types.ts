import type {
  DetectedDependency,
  DetectedFramework,
  DetectedEnvVar,
  DetectedAPIRoute,
  DetectedComponent,
  DetectedPage,
} from '../dependency-detection.js';

export interface DetectionContext {
  language: string;
  artifactKind: 'source' | 'schema' | 'doc' | 'config' | 'build' | 'design';
  filename?: string;
  nodeType?: string;
  framework?: DetectedFramework;
}

export interface DetectionResult {
  components?: DetectedComponent[];
  functions?: FunctionInfo[];
  classes?: ClassInfo[];
  imports?: ImportInfo[];
  exports?: ExportInfo[];
  routes?: DetectedAPIRoute[];
  envVars?: DetectedEnvVar[];
  dependencies?: DetectedDependency[];
  pages?: DetectedPage[];
  confidence: 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
}

export interface FunctionInfo {
  name: string;
  parameters: string[];
  returnType?: string;
  exported: boolean;
  async?: boolean;
  startLine?: number;
  endLine?: number;
}

export interface ClassInfo {
  name: string;
  exported: boolean;
  methods: string[];
  extends?: string;
  implements?: string[];
  startLine?: number;
  endLine?: number;
}

export interface ImportInfo {
  module: string;
  imports: string[];
  kind: 'default' | 'named' | 'namespace' | 'type';
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'const' | 'type';
}

export interface DetectionStrategy {
  readonly name: string;

  supports(context: DetectionContext): boolean;

  detect(content: string, context: DetectionContext): Promise<DetectionResult>;
}

export interface DetectionCoordinator {
  detect(content: string, context: DetectionContext): Promise<DetectionResult>;

  registerStrategy(strategy: DetectionStrategy): void;

  unregisterStrategy(strategyName: string): void;
}
