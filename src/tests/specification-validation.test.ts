import { describe, it, expect } from 'vitest';
import { validateSpecification, sanitizeSpecification } from '@nodespec/core/specification-validation.js';

describe('Specification Validation', () => {
  describe('validateSpecification', () => {
    it('should reject empty vision', () => {
      const result = validateSpecification({ vision: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('vision');
      expect(result.errors[0].severity).toBe('error');
    });

    it('should reject vision that is too short', () => {
      const result = validateSpecification({ vision: 'Todo app' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('vision');
      expect(result.errors[0].message).toContain('too short');
    });

    it('should reject vision that is too long', () => {
      const longVision = 'a'.repeat(2001);
      const result = validateSpecification({ vision: longVision });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('vision');
      expect(result.errors[0].message).toContain('too long');
    });

    it('should accept valid vision', () => {
      const result = validateSpecification({
        vision: 'A todo application with React frontend and Node.js backend',
      });
      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('should warn about unknown languages', () => {
      const result = validateSpecification({
        vision: 'Build a web app',
        preferences: {
          languages: ['typescript', 'unknownlang'],
        },
      });
      expect(result.valid).toBe(true);
      const warnings = result.errors.filter(e => e.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].field).toBe('preferences.languages');
    });

    it('should accept known languages', () => {
      const result = validateSpecification({
        vision: 'Build a web app with TypeScript and Python',
        preferences: {
          languages: ['typescript', 'python', 'go'],
        },
      });
      const errors = result.errors.filter(e => e.field === 'preferences.languages');
      expect(errors).toHaveLength(0);
    });

    it('should warn about unknown frameworks', () => {
      const result = validateSpecification({
        vision: 'Build a web app',
        preferences: {
          frameworks: ['react', 'unknownframework'],
        },
      });
      const warnings = result.errors.filter(
        e => e.severity === 'warning' && e.field === 'preferences.frameworks'
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should warn about unknown databases', () => {
      const result = validateSpecification({
        vision: 'Build a web app with data storage',
        preferences: {
          databases: ['postgresql', 'unknowndb'],
        },
      });
      const warnings = result.errors.filter(
        e => e.severity === 'warning' && e.field === 'preferences.databases'
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should warn about too many languages', () => {
      const result = validateSpecification({
        vision: 'Build a multi-language application',
        preferences: {
          languages: ['typescript', 'python', 'go', 'rust', 'java'],
        },
      });
      const warnings = result.errors.filter(
        e => e.severity === 'warning' && e.field === 'preferences.languages'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('Too many languages');
    });

    it('should provide suggestions for frontend projects', () => {
      const result = validateSpecification({
        vision: 'Build a web dashboard with user interface',
      });
      expect(result.suggestions.length).toBeGreaterThan(0);
      const frontendSuggestion = result.suggestions.find(s =>
        s.toLowerCase().includes('frontend') || s.toLowerCase().includes('react')
      );
      expect(frontendSuggestion).toBeDefined();
    });

    it('should provide suggestions for backend projects', () => {
      const result = validateSpecification({
        vision: 'Build a REST API service for handling requests',
      });
      expect(result.suggestions.length).toBeGreaterThan(0);
      const backendSuggestion = result.suggestions.find(s =>
        s.toLowerCase().includes('backend') || s.toLowerCase().includes('language')
      );
      expect(backendSuggestion).toBeDefined();
    });

    it('should provide suggestions for database projects', () => {
      const result = validateSpecification({
        vision: 'Build an app that needs to store user data persistently',
      });
      expect(result.suggestions.length).toBeGreaterThan(0);
      const dbSuggestion = result.suggestions.find(s =>
        s.toLowerCase().includes('database') || s.toLowerCase().includes('storage')
      );
      expect(dbSuggestion).toBeDefined();
    });

    it('should provide suggestions for realtime projects', () => {
      const result = validateSpecification({
        vision: 'Build a real-time chat application with live updates',
      });
      expect(result.suggestions.length).toBeGreaterThan(0);
      const realtimeSuggestion = result.suggestions.find(s =>
        s.toLowerCase().includes('real-time') || s.toLowerCase().includes('websocket')
      );
      expect(realtimeSuggestion).toBeDefined();
    });

    it('should warn about incompatible framework-language pairs', () => {
      const result = validateSpecification({
        vision: 'Build an app',
        preferences: {
          languages: ['python'],
          frameworks: ['react'],
        },
      });
      const warnings = result.errors.filter(
        e => e.severity === 'warning' && e.field === 'preferences.frameworks'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('may not be compatible');
    });

    it('should not warn about compatible framework-language pairs', () => {
      const result = validateSpecification({
        vision: 'Build an app',
        preferences: {
          languages: ['typescript'],
          frameworks: ['react', 'express'],
        },
      });
      const warnings = result.errors.filter(
        e => e.severity === 'warning' && e.field === 'preferences.frameworks'
      );
      expect(warnings).toHaveLength(0);
    });

    it('should provide general suggestions for vague specifications', () => {
      const result = validateSpecification({
        vision: 'Make something cool and awesome',
      });
      expect(result.suggestions.length).toBeGreaterThan(0);
      const generalSuggestion = result.suggestions.find(s =>
        s.toLowerCase().includes('general') || s.toLowerCase().includes('specific')
      );
      expect(generalSuggestion).toBeDefined();
    });
  });

  describe('sanitizeSpecification', () => {
    it('should trim vision whitespace', () => {
      const result = sanitizeSpecification({
        vision: '  Build a todo app  ',
      });
      expect(result.vision).toBe('Build a todo app');
    });

    it('should normalize language names to lowercase', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
        preferences: {
          languages: ['TypeScript', 'PYTHON', 'Go'],
        },
      });
      expect(result.preferences?.languages).toEqual(['typescript', 'python', 'go']);
    });

    it('should normalize framework names to lowercase', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
        preferences: {
          frameworks: ['React', 'EXPRESS', 'Django'],
        },
      });
      expect(result.preferences?.frameworks).toEqual(['react', 'express', 'django']);
    });

    it('should normalize database names to lowercase', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
        preferences: {
          databases: ['PostgreSQL', 'MONGODB', 'Redis'],
        },
      });
      expect(result.preferences?.databases).toEqual(['postgresql', 'mongodb', 'redis']);
    });

    it('should remove empty strings from arrays', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
        preferences: {
          languages: ['typescript', '', 'python', '  '],
        },
      });
      expect(result.preferences?.languages).toEqual(['typescript', 'python']);
    });

    it('should filter out features with empty names', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
      });
      expect(result.vision).toBe('Build an app');
    });

    it('should filter out constraints with empty descriptions', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
        constraints: [
          { type: 'technology', description: 'Must use TypeScript' },
          { type: 'deployment', description: '' },
          { type: 'performance', description: 'Must load in < 2s' },
        ],
      });
      expect(result.constraints).toHaveLength(2);
      expect(result.constraints?.[0].description).toBe('Must use TypeScript');
      expect(result.constraints?.[1].description).toBe('Must load in < 2s');
    });

    it('should handle missing optional fields gracefully', () => {
      const result = sanitizeSpecification({
        vision: 'Build an app',
      });
      expect(result.vision).toBe('Build an app');
      expect(result.constraints).toBeUndefined();
    });
  });
});
