import type { DetectionStrategy, DetectionContext, DetectionResult } from './types.js';
import {
  detectEnvVars,
  detectAPIRoutes,
  detectReactComponents,
  detectReactPages,
} from '../dependency-detection.js';

export class RegexStrategy implements DetectionStrategy {
  readonly name = 'regex';

  supports(_context: DetectionContext): boolean {
    return true;
  }

  async detect(content: string, context: DetectionContext): Promise<DetectionResult> {
    const result: DetectionResult = {
      confidence: 'medium',
      metadata: { strategy: 'regex' },
    };

    result.envVars = detectEnvVars(content);

    if (this.isJavaScriptLike(context.language)) {
      result.routes = detectAPIRoutes(content, context.framework?.name);

      if (this.isReactContext(content, context)) {
        result.components = detectReactComponents(content);
        result.pages = detectReactPages(content);
      }
    }

    return result;
  }

  private isJavaScriptLike(language: string): boolean {
    return ['javascript', 'typescript', 'jsx', 'tsx'].includes(language.toLowerCase());
  }

  private isReactContext(content: string, context: DetectionContext): boolean {
    const frameworkName = context.framework?.name?.toLowerCase() || '';
    const isReactFramework = frameworkName.includes('react') || frameworkName.includes('next');

    const hasReactImports = content.includes('react') ||
                             content.includes('React') ||
                             content.includes('useState') ||
                             content.includes('useEffect');

    const hasReactPatterns = /function\s+[A-Z]\w+\s*\(/.test(content);

    return isReactFramework || hasReactImports || hasReactPatterns;
  }
}
