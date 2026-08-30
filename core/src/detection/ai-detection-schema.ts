import { z } from 'zod';

export const FunctionInfoSchema = z.object({
  name: z.string(),
  parameters: z.array(z.string()),
  returnType: z.string().optional(),
  exported: z.boolean(),
  async: z.boolean().optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});

export const ClassInfoSchema = z.object({
  name: z.string(),
  exported: z.boolean(),
  methods: z.array(z.string()),
  extends: z.string().optional(),
  implements: z.array(z.string()).optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});

export const ImportInfoSchema = z.object({
  module: z.string(),
  imports: z.array(z.string()),
  kind: z.enum(['default', 'named', 'namespace', 'type']),
});

export const ExportInfoSchema = z.object({
  name: z.string(),
  kind: z.enum(['function', 'class', 'const', 'type']),
});

export const DetectedComponentSchema = z.object({
  name: z.string(),
  type: z.enum(['component', 'hook', 'page', 'layout']),
  exported: z.boolean(),
});

export const DetectedAPIRouteSchema = z.object({
  path: z.string(),
  method: z.string(),
  description: z.string().optional(),
});

export const DetectedEnvVarSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
});

export const DetectedDependencySchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  type: z.enum(['runtime', 'dev', 'peer']),
  category: z.enum(['framework', 'database', 'testing', 'ui', 'utility', 'build']).optional(),
});

export const AIDetectionResponseSchema = z.object({
  components: z.array(DetectedComponentSchema).optional(),
  functions: z.array(FunctionInfoSchema).optional(),
  classes: z.array(ClassInfoSchema).optional(),
  imports: z.array(ImportInfoSchema).optional(),
  exports: z.array(ExportInfoSchema).optional(),
  routes: z.array(DetectedAPIRouteSchema).optional(),
  envVars: z.array(DetectedEnvVarSchema).optional(),
  dependencies: z.array(DetectedDependencySchema).optional(),
  pages: z.array(z.object({
    name: z.string(),
    path: z.string(),
    component: z.string().optional(),
  })).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AIDetectionResponse = z.infer<typeof AIDetectionResponseSchema>;

export const AI_DETECTION_SYSTEM_PROMPT = `You are a code analysis assistant. Analyze the provided code and extract structured metadata.

Return ONLY valid JSON matching this exact schema:
{
  "components": [{ "name": string, "type": "component"|"hook"|"page"|"layout", "exported": boolean }],
  "functions": [{ "name": string, "parameters": string[], "returnType"?: string, "exported": boolean, "async"?: boolean }],
  "classes": [{ "name": string, "exported": boolean, "methods": string[], "extends"?: string }],
  "imports": [{ "module": string, "imports": string[], "kind": "default"|"named"|"namespace"|"type" }],
  "exports": [{ "name": string, "kind": "function"|"class"|"const"|"type" }],
  "routes": [{ "path": string, "method": string, "description"?: string }],
  "envVars": [{ "name": string, "required": boolean, "description"?: string }],
  "dependencies": [{ "name": string, "version"?: string, "type": "runtime"|"dev"|"peer", "category"?: "framework"|"database"|"testing"|"ui"|"utility"|"build" }],
  "pages": [{ "name": string, "path": string, "component"?: string }],
  "confidence": "high"|"medium"|"low",
  "summary"?: string
}

Rules:
- Only include fields that are present in the code
- Set confidence to "high" for clear, unambiguous code; "medium" for inferrable patterns; "low" for uncertain analysis
- For React: detect components (capitalized functions returning JSX), hooks (functions starting with "use")
- For APIs: detect routes (app.get, app.post, router methods, @app.route decorators)
- For package.json files: extract all dependencies from "dependencies", "devDependencies", and "peerDependencies" sections
- For requirements.txt files: extract all Python dependencies with versions
- For dependencies: categorize them (framework=React/Express/Django, database=postgres/mongodb, testing=jest/vitest, ui=tailwind/bootstrap, utility=lodash/axios, build=vite/webpack)
- For all code: detect imports, exports, functions, classes, environment variable usage
- Be precise: don't guess or hallucinate. If unsure, set confidence to "low"`;

export function buildAIDetectionPrompt(
  content: string,
  context: {
    language: string;
    artifactKind: string;
    nodeType?: string;
    filename?: string;
  }
): string {
  return `Analyze this ${context.language} code from a ${context.artifactKind} artifact${
    context.nodeType ? ` in a "${context.nodeType}" node` : ''
  }${context.filename ? ` (file: ${context.filename})` : ''}.

Code to analyze:
\`\`\`${context.language}
${content}
\`\`\`

Extract all relevant metadata according to the schema. Return only the JSON response.`;
}
