import type {
  DetectionStrategy,
  DetectionContext,
  DetectionResult,
  DetectionCoordinator as IDetectionCoordinator,
} from './types.js';

export class DetectionCoordinator implements IDetectionCoordinator {
  private strategies: Map<string, DetectionStrategy> = new Map();
  private strategyOrder: string[] = [];

  registerStrategy(strategy: DetectionStrategy): void {
    this.strategies.set(strategy.name, strategy);
    if (!this.strategyOrder.includes(strategy.name)) {
      this.strategyOrder.unshift(strategy.name);
    }
  }

  unregisterStrategy(strategyName: string): void {
    this.strategies.delete(strategyName);
    this.strategyOrder = this.strategyOrder.filter(name => name !== strategyName);
  }

  async detect(content: string, context: DetectionContext): Promise<DetectionResult> {
    for (const strategyName of this.strategyOrder) {
      const strategy = this.strategies.get(strategyName);

      if (!strategy) continue;

      if (strategy.supports(context)) {
        try {
          const result = await strategy.detect(content, context);
          return result;
        } catch (error) {
          console.warn(`Strategy ${strategyName} failed:`, error);
          continue;
        }
      }
    }

    return this.emptyResult();
  }

  private emptyResult(): DetectionResult {
    return {
      components: [],
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      routes: [],
      envVars: [],
      dependencies: [],
      confidence: 'low',
    };
  }

  getRegisteredStrategies(): string[] {
    return [...this.strategyOrder];
  }
}

export function createDefaultCoordinator(): DetectionCoordinator {
  const coordinator = new DetectionCoordinator();
  return coordinator;
}
