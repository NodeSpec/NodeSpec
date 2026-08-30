// S1-1: the pure detection modules moved to @nodespec/core; this barrel keeps the
// public surface identical by composing them with the ONE impure module that stays in
// src/ (ai-strategy.ts reads import.meta.env and performs fetches — explicitly excluded
// from the core move per V2_TASKS S1-1).
export * from '@nodespec/core/detection/types.js';
export { DetectionCoordinator, createDefaultCoordinator } from '@nodespec/core/detection/coordinator.js';
export { RegexStrategy } from '@nodespec/core/detection/regex-strategy.js';
export {
  AIDetectionStrategy,
  createNativeAIStrategy,
  createCustomAIStrategy,
  type AIDetectionConfig,
} from './ai-strategy.js';
export * from '@nodespec/core/detection/ai-detection-schema.js';
