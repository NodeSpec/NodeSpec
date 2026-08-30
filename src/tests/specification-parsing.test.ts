import { describe, it, expect } from 'vitest';
import {
  generateRequirementId,
  inferPriorityFromText,
  inferCategoryFromText,
  detectSpecificationFormat,
  extractRequirementIdsFromText,
  validateParsedSpecification,
  type ParsedSpecification,
} from '@nodespec/core/specification-format.js';

describe('Specification Format Utilities', () => {
  describe('generateRequirementId', () => {
    it('generates consistent REQ- prefixed IDs regardless of category', () => {
      expect(generateRequirementId('functional', 1)).toBe('REQ-001');
      expect(generateRequirementId('functional', 42)).toBe('REQ-042');
      expect(generateRequirementId('functional', 123)).toBe('REQ-123');
    });

    it('generates REQ- prefix for non-functional category', () => {
      expect(generateRequirementId('non-functional', 5)).toBe('REQ-005');
    });

    it('generates REQ- prefix for technical category', () => {
      expect(generateRequirementId('technical', 10)).toBe('REQ-010');
    });

    it('generates REQ- prefix for business category', () => {
      expect(generateRequirementId('business', 3)).toBe('REQ-003');
    });
  });

  describe('inferPriorityFromText', () => {
    it('infers critical priority', () => {
      expect(inferPriorityFromText('This is critical for success')).toBe('critical');
      expect(inferPriorityFromText('Must have authentication')).toBe('critical');
      expect(inferPriorityFromText('Essential security feature')).toBe('critical');
    });

    it('infers high priority', () => {
      expect(inferPriorityFromText('High priority feature')).toBe('high');
      expect(inferPriorityFromText('Important requirement')).toBe('high');
      expect(inferPriorityFromText('Required for release')).toBe('high');
    });

    it('infers low priority', () => {
      expect(inferPriorityFromText('Low priority enhancement')).toBe('low');
      expect(inferPriorityFromText('Nice to have feature')).toBe('low');
      expect(inferPriorityFromText('Optional functionality')).toBe('low');
    });

    it('returns null when no priority keywords match', () => {
      expect(inferPriorityFromText('Some regular feature')).toBeNull();
      expect(inferPriorityFromText('Add user profile')).toBeNull();
    });
  });

  describe('inferCategoryFromText', () => {
    it('infers non-functional category', () => {
      expect(inferCategoryFromText('System must handle 10000 concurrent users (performance)')).toBe('non-functional');
      expect(inferCategoryFromText('The application should have 99.9% availability')).toBe('non-functional');
      expect(inferCategoryFromText('Security must meet OWASP standards')).toBe('non-functional');
      expect(inferCategoryFromText('Usability testing required')).toBe('non-functional');
    });

    it('infers technical category', () => {
      expect(inferCategoryFromText('Use PostgreSQL database technology')).toBe('technical');
      expect(inferCategoryFromText('Must use React framework')).toBe('technical');
      expect(inferCategoryFromText('Deploy on AWS platform')).toBe('technical');
      expect(inferCategoryFromText('Infrastructure requirements')).toBe('technical');
    });

    it('infers business category', () => {
      expect(inferCategoryFromText('Business rule for pricing')).toBe('business');
      expect(inferCategoryFromText('Revenue model requirements')).toBe('business');
      expect(inferCategoryFromText('Market research needed')).toBe('business');
      expect(inferCategoryFromText('Stakeholder approval required')).toBe('business');
    });

    it('defaults to functional category', () => {
      expect(inferCategoryFromText('User can login')).toBe('functional');
      expect(inferCategoryFromText('System exports data')).toBe('functional');
      expect(inferCategoryFromText('Add shopping cart')).toBe('functional');
    });
  });

  describe('detectSpecificationFormat', () => {
    it('detects structured format', () => {
      const structuredSpec = `
## VISION
Build a chat app

## FEATURES
- Feature 1
- Feature 2

## REQUIREMENTS
- FR-001: User login
`;
      expect(detectSpecificationFormat(structuredSpec)).toBe('structured');
    });

    it('detects structured format with requirement IDs', () => {
      const spec = `
Requirements:
- FR-001: User authentication
- NFR-002: Performance requirements
`;
      expect(detectSpecificationFormat(spec)).toBe('mixed');
    });

    it('detects natural format', () => {
      const naturalSpec = `
Build a todo app with user authentication.
Users should be able to create, edit, and delete todos.
The app must be fast and responsive.
`;
      expect(detectSpecificationFormat(naturalSpec)).toBe('natural');
    });
  });

  describe('extractRequirementIdsFromText', () => {
    it('extracts requirement IDs', () => {
      const text = `
The system has several requirements:
- FR-001: User login
- NFR-002: Performance
- TR-003: Use PostgreSQL
- BR-004: Pricing model
`;
      const ids = extractRequirementIdsFromText(text);
      expect(ids).toEqual(['FR-001', 'NFR-002', 'TR-003', 'BR-004']);
    });

    it('returns empty array when no IDs found', () => {
      const text = 'No requirement IDs in this text';
      expect(extractRequirementIdsFromText(text)).toEqual([]);
    });
  });

  describe('validateParsedSpecification', () => {
    it('validates a good specification', () => {
      const spec: ParsedSpecification = {
        vision: 'Build a comprehensive task management application',
        features: [
          { name: 'Task Creation', priority: 'high' },
          { name: 'Task Editing', priority: 'medium' },
        ],
        requirements: [
          {
            requirementId: 'FR-001',
            name: 'User Authentication',
            description: 'Users must be able to log in securely',
            category: 'functional',
            priority: 'high',
            acceptanceCriteria: [
              { text: 'Users can log in with email and password' },
              { text: 'Password must be at least 8 characters' },
            ],
            confidence: 0.9,
          },
        ],
        constraints: [],
        architecturePreferences: {
          languages: ['TypeScript'],
          frameworks: ['React'],
        },
        metadata: {
          format: 'structured',
          parsingConfidence: 0.85,
        },
      };

      const result = validateParsedSpecification(spec);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects short vision', () => {
      const spec: ParsedSpecification = {
        vision: 'Short',
        features: [],
        requirements: [
          {
            requirementId: 'FR-001',
            name: 'Test',
            description: 'Test requirement',
            category: 'functional',
            priority: 'high',
            acceptanceCriteria: [{ text: 'Test' }],
            confidence: 0.9,
          },
        ],
        constraints: [],
        architecturePreferences: {},
        metadata: {
          format: 'natural',
          parsingConfidence: 0.8,
        },
      };

      const result = validateParsedSpecification(spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Vision is too short. Provide at least 20 characters describing the project.');
    });

    it('detects missing requirements', () => {
      const spec: ParsedSpecification = {
        vision: 'Build a comprehensive application',
        features: [],
        requirements: [],
        constraints: [],
        architecturePreferences: {},
        metadata: {
          format: 'natural',
          parsingConfidence: 0.8,
        },
      };

      const result = validateParsedSpecification(spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No requirements found. Specify at least one requirement.');
    });

    it('detects duplicate requirement IDs', () => {
      const spec: ParsedSpecification = {
        vision: 'Build a comprehensive application',
        features: [],
        requirements: [
          {
            requirementId: 'FR-001',
            name: 'First',
            description: 'First requirement',
            category: 'functional',
            priority: 'high',
            acceptanceCriteria: [{ text: 'Test' }],
            confidence: 0.9,
          },
          {
            requirementId: 'FR-001',
            name: 'Duplicate',
            description: 'Duplicate requirement',
            category: 'functional',
            priority: 'high',
            acceptanceCriteria: [{ text: 'Test' }],
            confidence: 0.9,
          },
        ],
        constraints: [],
        architecturePreferences: {},
        metadata: {
          format: 'natural',
          parsingConfidence: 0.8,
        },
      };

      const result = validateParsedSpecification(spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate requirement ID: FR-001');
    });

    it('detects low confidence requirements', () => {
      const spec: ParsedSpecification = {
        vision: 'Build a comprehensive application',
        features: [],
        requirements: [
          {
            requirementId: 'FR-001',
            name: 'Unclear',
            description: 'Unclear requirement',
            category: 'functional',
            priority: 'high',
            acceptanceCriteria: [{ text: 'Test' }],
            confidence: 0.3,
          },
        ],
        constraints: [],
        architecturePreferences: {},
        metadata: {
          format: 'natural',
          parsingConfidence: 0.8,
        },
      };

      const result = validateParsedSpecification(spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Low confidence (0.3) for requirement: FR-001');
    });

    it('detects missing acceptance criteria', () => {
      const spec: ParsedSpecification = {
        vision: 'Build a comprehensive application',
        features: [],
        requirements: [
          {
            requirementId: 'FR-001',
            name: 'No Criteria',
            description: 'Requirement without criteria',
            category: 'functional',
            priority: 'high',
            acceptanceCriteria: [],
            confidence: 0.9,
          },
        ],
        constraints: [],
        architecturePreferences: {},
        metadata: {
          format: 'natural',
          parsingConfidence: 0.8,
        },
      };

      const result = validateParsedSpecification(spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No acceptance criteria for requirement: FR-001');
    });
  });
});
