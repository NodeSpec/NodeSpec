import { z } from 'zod';

export const RequirementPrioritySchema = z.string().nullable().optional();
export type RequirementPriority = z.infer<typeof RequirementPrioritySchema>;

export const RequirementCategorySchema = z.enum(['functional', 'non-functional', 'technical', 'business']);
export type RequirementCategory = z.infer<typeof RequirementCategorySchema>;

export const RequirementStatusSchema = z.enum(['pending', 'in-progress', 'implemented', 'validated', 'blocked']);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const AcceptanceCriterionSchema = z.object({
  text: z.string(),
  met: z.boolean().optional(),
  testId: z.string().optional(),
  // R5c/R5e — the evidence audit trail (R3-4b two-half convention: `met` says
  // WHAT, `provenance` says where it came from). Written by the git-tick accept
  // lane ('git'), the Spec-view toggle ('ui'), and R5d's completion tool ('mcp').
  provenance: z.object({
    source: z.string(),
    commitSha: z.string().optional(),
    actor: z.string().optional(),
    at: z.string(),
  }).optional(),
  // R5e — the criterion is still met, but the source its git tick vouched for has
  // changed since: a prompt to re-verify, never a retraction. Cleared by an
  // explicit human toggle (which IS the re-verification).
  evidenceStale: z.object({
    at: z.string(),
    commitSha: z.string().optional(),
    reason: z.string(),
  }).optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ParsedRequirementSchema = z.object({
  requirementId: z.string(),
  name: z.string(),
  description: z.string(),
  category: RequirementCategorySchema,
  priority: z.string().nullable().optional(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema),
  rationale: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  locked: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ParsedRequirement = z.infer<typeof ParsedRequirementSchema>;

export const ParsedConstraintSchema = z.object({
  type: z.enum(['technology', 'architecture', 'deployment', 'performance', 'security', 'compliance', 'cost', 'other']),
  description: z.string(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type ParsedConstraint = z.infer<typeof ParsedConstraintSchema>;

export const ArchitecturePreferencesSchema = z.object({
  languages: z.array(z.string()).optional(),
  frameworks: z.array(z.string()).optional(),
  databases: z.array(z.string()).optional(),
  deploymentTarget: z.string().optional(),
  architecturePattern: z.enum(['monolith', 'microservices', 'serverless', 'event-driven', 'layered', 'unknown']).optional(),
  cloudProvider: z.string().optional(),
  containerization: z.boolean().optional(),
});
export type ArchitecturePreferences = z.infer<typeof ArchitecturePreferencesSchema>;

export const QualityAttributeSchema = z.object({
  name: z.string(),
  target: z.string(),
  measurement: z.string().optional(),
  priority: z.string().nullable().optional(),
});
export type QualityAttribute = z.infer<typeof QualityAttributeSchema>;

export const ParsedSpecificationSchema = z.object({
  vision: z.string(),
  features: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    priority: z.string().nullable().optional(),
  })),
  requirements: z.array(ParsedRequirementSchema),
  constraints: z.array(ParsedConstraintSchema),
  architecturePreferences: ArchitecturePreferencesSchema,
  qualityAttributes: z.array(QualityAttributeSchema).optional(),
  metadata: z.object({
    format: z.enum(['natural', 'structured', 'mixed']),
    parsingConfidence: z.number().min(0).max(1),
    detectedPatterns: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  }),
});
export type ParsedSpecification = z.infer<typeof ParsedSpecificationSchema>;

export function generateRequirementId(_category: RequirementCategory, index: number): string {
  // Use consistent REQ- prefix for all requirement types to ensure proper feature mapping
  // Category information is preserved in the category field
  const prefix = 'REQ';
  const paddedIndex = String(index).padStart(3, '0');
  return `${prefix}-${paddedIndex}`;
}

export function inferPriorityFromText(text: string): string | null {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('critical') || lowerText.includes('must have') || lowerText.includes('essential')) {
    return 'critical';
  }
  if (lowerText.includes('high') || lowerText.includes('important') || lowerText.includes('required')) {
    return 'high';
  }
  if (lowerText.includes('low') || lowerText.includes('nice to have') || lowerText.includes('optional')) {
    return 'low';
  }
  if (lowerText.includes('medium') || lowerText.includes('normal')) {
    return 'medium';
  }
  return null;
}

export function inferCategoryFromText(text: string): RequirementCategory {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('performance') || lowerText.includes('scalability') ||
      lowerText.includes('availability') || lowerText.includes('reliability') ||
      lowerText.includes('security') || lowerText.includes('usability')) {
    return 'non-functional';
  }
  if (lowerText.includes('technology') || lowerText.includes('framework') ||
      lowerText.includes('platform') || lowerText.includes('infrastructure')) {
    return 'technical';
  }
  if (lowerText.includes('business') || lowerText.includes('revenue') ||
      lowerText.includes('market') || lowerText.includes('stakeholder')) {
    return 'business';
  }
  return 'functional';
}

export const SPECIFICATION_TEMPLATE = `# Project Specification

## VISION
[Brief description of what you want to build]

## FEATURES
- Feature 1 [HIGH PRIORITY]
- Feature 2 [MEDIUM PRIORITY]
- Feature 3

## REQUIREMENTS
### Functional Requirements
- REQ-001: [Requirement name]
  Description: [Detailed description]
  Category: functional
  Acceptance Criteria:
    - Criterion 1
    - Criterion 2

### Non-Functional Requirements
- REQ-002: [Requirement name]
  Category: non-functional
  Target: [Measurable target, e.g., "< 100ms response time"]

## CONSTRAINTS
- Technology: [e.g., "Must use TypeScript"]
- Compliance: [e.g., "Must comply with GDPR"]
- Cost: [e.g., "Maximum $500/month infrastructure cost"]

## ARCHITECTURE PREFERENCES
- Languages: TypeScript, Python
- Frameworks: React, Node.js
- Databases: PostgreSQL, Redis
- Pattern: Microservices
- Cloud: AWS

## QUALITY ATTRIBUTES
- Performance: Handle 10,000 concurrent users
- Availability: 99.9% uptime
- Security: OAuth2 authentication`;

export function detectSpecificationFormat(text: string): 'natural' | 'structured' | 'mixed' {
  const hasStructuredHeaders = /^##?\s+(VISION|FEATURES|REQUIREMENTS|CONSTRAINTS)/m.test(text);
  const hasRequirementIds = /\b(FR|NFR|TR|BR)-\d{3}\b/.test(text);

  if (hasStructuredHeaders || hasRequirementIds) {
    const structuredRatio = (text.match(/^##?\s+/gm) || []).length / (text.split('\n').length || 1);
    return structuredRatio > 0.2 ? 'structured' : 'mixed';
  }

  return 'natural';
}

export function extractRequirementIdsFromText(text: string): string[] {
  const regex = /\b(FR|NFR|TR|BR)-\d{3}\b/g;
  return Array.from(text.matchAll(regex)).map(match => match[0]);
}

export function validateParsedSpecification(spec: ParsedSpecification): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!spec.vision || spec.vision.trim().length < 20) {
    errors.push('Vision is too short. Provide at least 20 characters describing the project.');
  }

  if (spec.requirements.length === 0) {
    errors.push('No requirements found. Specify at least one requirement.');
  }

  const requirementIds = new Set<string>();
  for (const req of spec.requirements) {
    if (requirementIds.has(req.requirementId)) {
      errors.push(`Duplicate requirement ID: ${req.requirementId}`);
    }
    requirementIds.add(req.requirementId);

    if (req.confidence < 0.5) {
      errors.push(`Low confidence (${req.confidence}) for requirement: ${req.requirementId}`);
    }

    if (req.acceptanceCriteria.length === 0) {
      errors.push(`No acceptance criteria for requirement: ${req.requirementId}`);
    }
  }

  if (spec.metadata.parsingConfidence < 0.6) {
    errors.push(`Overall parsing confidence is low: ${spec.metadata.parsingConfidence}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
