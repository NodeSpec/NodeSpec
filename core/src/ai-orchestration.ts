import { z } from 'zod';

export const IntentCategorySchema = z.enum([
  'specification',
  'requirements',
  'features',
  'architecture',
  'artifacts',
  'refinement',
  'analysis',
  'validation',
  'traceability',
  'mapping',
  'incremental',
]);

export type IntentCategory = z.infer<typeof IntentCategorySchema>;

export const IntentActionSchema = z.enum([
  'create',
  'update',
  'delete',
  'refine',
  'generate',
  'explain',
  'validate',
]);

export type IntentAction = z.infer<typeof IntentActionSchema>;

export const IntentScopeSchema = z.enum([
  'global',
  'section',
  'specific',
]);

export type IntentScope = z.infer<typeof IntentScopeSchema>;

export const ClassifiedIntentSchema = z.object({
  category: IntentCategorySchema,
  action: IntentActionSchema,
  scope: IntentScopeSchema,
  entities: z.array(z.string()).optional(),
  entityTypes: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

export type ClassifiedIntent = z.infer<typeof ClassifiedIntentSchema>;
