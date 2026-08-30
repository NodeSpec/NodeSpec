import type { DetectionStrategy, DetectionContext, DetectionResult } from '@nodespec/core/detection/types.js';
import {
  AIDetectionResponseSchema,
  AI_DETECTION_SYSTEM_PROMPT,
  buildAIDetectionPrompt,
  type AIDetectionResponse,
} from '@nodespec/core/detection/ai-detection-schema.js';

export interface AIDetectionConfig {
  mode: 'native' | 'custom';
  customEndpoint?: string;
  customHeaders?: Record<string, string>;
  model?: string;
  timeout?: number;
}

export class AIDetectionStrategy implements DetectionStrategy {
  readonly name = 'ai';

  constructor(
    private config: AIDetectionConfig,
    private supabaseUrl?: string,
    private getAccessToken?: () => Promise<string>
  ) {}

  supports(_context: DetectionContext): boolean {
    return true;
  }

  async detect(content: string, context: DetectionContext): Promise<DetectionResult> {
    try {
      const response = await this.callAI(content, context);
      return this.convertToDetectionResult(response);
    } catch (error) {
      console.error('AI detection failed:', error);
      return {
        confidence: 'low',
        metadata: {
          strategy: 'ai',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  private async callAI(content: string, context: DetectionContext): Promise<AIDetectionResponse> {
    if (this.config.mode === 'native') {
      return this.callNativeAI(content, context);
    } else {
      return this.callCustomAI(content, context);
    }
  }

  private async callNativeAI(
    content: string,
    context: DetectionContext
  ): Promise<AIDetectionResponse> {
    if (!this.supabaseUrl || !this.getAccessToken) {
      throw new Error('Supabase configuration required for native AI detection');
    }

    const token = await this.getAccessToken();
    const url = `${this.supabaseUrl}/functions/v1/code-detection-v4`;
    const prompt = buildAIDetectionPrompt(content, {
      language: context.language,
      artifactKind: context.artifactKind,
      nodeType: context.nodeType,
      filename: context.filename,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify({
        prompt,
        model: this.config.model || 'gpt-4o-mini',
        systemPrompt: AI_DETECTION_SYSTEM_PROMPT,
      }),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`Native AI detection failed: ${response.statusText}`);
    }

    const data = await response.json();
    return this.validateAIResponse(data);
  }

  private async callCustomAI(
    content: string,
    context: DetectionContext
  ): Promise<AIDetectionResponse> {
    if (!this.config.customEndpoint) {
      throw new Error('Custom endpoint required for custom AI detection mode');
    }

    const prompt = buildAIDetectionPrompt(content, {
      language: context.language,
      artifactKind: context.artifactKind,
      nodeType: context.nodeType,
      filename: context.filename,
    });

    const response = await fetch(this.config.customEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.customHeaders,
      },
      body: JSON.stringify({
        systemPrompt: AI_DETECTION_SYSTEM_PROMPT,
        userPrompt: prompt,
        model: this.config.model,
      }),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`Custom AI detection failed: ${response.statusText}`);
    }

    const data = await response.json();
    return this.validateAIResponse(data);
  }

  private validateAIResponse(data: unknown): AIDetectionResponse {
    const result = AIDetectionResponseSchema.safeParse(data);

    if (!result.success) {
      console.error('AI response validation failed:', result.error);
      throw new Error('AI returned invalid response format');
    }

    return result.data;
  }

  private convertToDetectionResult(aiResponse: AIDetectionResponse): DetectionResult {
    return {
      components: aiResponse.components,
      functions: aiResponse.functions,
      classes: aiResponse.classes,
      imports: aiResponse.imports,
      exports: aiResponse.exports,
      routes: aiResponse.routes,
      envVars: aiResponse.envVars,
      dependencies: aiResponse.dependencies,
      pages: aiResponse.pages,
      confidence: aiResponse.confidence,
      metadata: {
        strategy: 'ai',
        mode: this.config.mode,
        summary: aiResponse.summary,
        ...aiResponse.metadata,
      },
    };
  }
}

export function createNativeAIStrategy(
  supabaseUrl: string,
  getAccessToken: () => Promise<string>,
  config?: Partial<AIDetectionConfig>
): AIDetectionStrategy {
  return new AIDetectionStrategy(
    {
      mode: 'native',
      model: config?.model || 'gpt-4o-mini',
      timeout: config?.timeout || 30000,
    },
    supabaseUrl,
    getAccessToken
  );
}

export function createCustomAIStrategy(
  endpoint: string,
  headers?: Record<string, string>,
  config?: Partial<AIDetectionConfig>
): AIDetectionStrategy {
  return new AIDetectionStrategy({
    mode: 'custom',
    customEndpoint: endpoint,
    customHeaders: headers,
    model: config?.model,
    timeout: config?.timeout || 30000,
  });
}
