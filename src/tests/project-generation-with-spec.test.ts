import { describe, it, expect } from 'vitest';
import { validateSpecification, sanitizeSpecification } from '@nodespec/core/specification-validation.js';

describe('Project Generation with Specification Flow', () => {
  describe('End-to-end specification flow', () => {
    it('should validate and sanitize user input before generation', () => {
      const userInput = {
        vision: '  Todo app with React, Node.js, and PostgreSQL  ',
        features: [
          { name: 'User authentication', priority: 'high' as const },
          { name: '', priority: 'medium' as const },
          { name: 'Task management', priority: 'low' as const },
        ],
        constraints: [
          { type: 'technology' as const, description: 'Must use TypeScript' },
          { type: 'deployment' as const, description: '' },
        ],
        preferences: {
          languages: ['TypeScript', '', 'JAVASCRIPT'],
          frameworks: ['React', 'EXPRESS'],
          databases: ['PostgreSQL'],
        },
      };

      const sanitized = sanitizeSpecification(userInput);

      expect(sanitized.vision).toBe('Todo app with React, Node.js, and PostgreSQL');
      expect(sanitized.constraints).toHaveLength(1);
      expect(sanitized.preferences?.languages).toEqual(['typescript', 'javascript']);
      expect(sanitized.preferences?.frameworks).toEqual(['react', 'express']);
      expect(sanitized.preferences?.databases).toEqual(['postgresql']);

      const validation = validateSpecification(sanitized);
      expect(validation.valid).toBe(true);
    });

    it('should provide helpful suggestions for incomplete specifications', () => {
      const spec = {
        vision: 'Build a web dashboard for analytics',
      };

      const validation = validateSpecification(spec);

      expect(validation.valid).toBe(true);
      expect(validation.suggestions.length).toBeGreaterThan(0);

      const hasFrontendSuggestion = validation.suggestions.some(s =>
        s.toLowerCase().includes('frontend') || s.toLowerCase().includes('framework')
      );
      expect(hasFrontendSuggestion).toBe(true);
    });

    it('should validate technology choices to prevent bad combinations', () => {
      const spec = {
        vision: 'Build a mobile app',
        preferences: {
          languages: ['python'],
          frameworks: ['react'],
        },
      };

      const validation = validateSpecification(spec);

      const incompatibilityWarning = validation.errors.find(
        e => e.severity === 'warning' && e.message.includes('may not be compatible')
      );
      expect(incompatibilityWarning).toBeDefined();
    });

    it('should allow AI to decide when preferences are unknown', () => {
      const spec = {
        vision: 'Build a real-time chat application',
        preferences: {
          architecturePattern: 'unknown' as const,
        },
      };

      const validation = validateSpecification(spec);
      expect(validation.valid).toBe(true);
    });

    it('should handle feature priorities correctly', () => {
      const spec = {
        vision: 'E-commerce platform',
        features: [
          { name: 'Payment processing', priority: 'high' as const },
          { name: 'Product reviews', priority: 'medium' as const },
          { name: 'Wishlist', priority: 'low' as const },
        ],
      };

      const validation = validateSpecification(spec);
      expect(validation.valid).toBe(true);
      expect(spec.features).toHaveLength(3);
      expect(spec.features[0].priority).toBe('high');
    });

    it('should validate complex real-world specification', () => {
      const spec = {
        vision: 'Social media platform with real-time messaging, photo sharing, user profiles, news feed algorithm, and content moderation',
        features: [
          { name: 'User authentication and profiles', priority: 'high' as const },
          { name: 'Real-time messaging', priority: 'high' as const },
          { name: 'Photo upload and sharing', priority: 'high' as const },
          { name: 'News feed with personalized algorithm', priority: 'medium' as const },
          { name: 'Content moderation tools', priority: 'medium' as const },
          { name: 'Analytics dashboard', priority: 'low' as const },
        ],
        constraints: [
          { type: 'technology' as const, description: 'Must use TypeScript for type safety' },
          { type: 'performance' as const, description: 'Feed must load in under 1 second' },
          { type: 'deployment' as const, description: 'Must be scalable to millions of users' },
        ],
        preferences: {
          languages: ['typescript'],
          frameworks: ['react', 'next.js', 'express'],
          databases: ['postgresql', 'redis'],
          deploymentTarget: 'aws',
          architecturePattern: 'microservices' as const,
        },
      };

      const sanitized = sanitizeSpecification(spec);
      const validation = validateSpecification(sanitized);

      expect(validation.valid).toBe(true);
      expect(sanitized.constraints).toHaveLength(3);
      expect(sanitized.preferences?.languages).toContain('typescript');
      expect(sanitized.preferences?.architecturePattern).toBe('microservices');
    });

    it('should handle minimal lazy user input gracefully', () => {
      const spec = {
        vision: 'Make me a todo app',
      };

      const sanitized = sanitizeSpecification(spec);
      const validation = validateSpecification(sanitized);

      expect(validation.valid).toBe(true);
      expect(validation.suggestions.length).toBeGreaterThan(0);
    });

    it('should warn about deployment target mismatches', () => {
      const spec = {
        vision: 'Build a serverless application',
        preferences: {
          deploymentTarget: 'traditional-server',
        },
      };

      const validation = validateSpecification(spec);
      const warnings = validation.errors.filter(e => e.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should provide context-aware suggestions based on keywords', () => {
      const realtimeSpec = {
        vision: 'Real-time collaboration tool with WebSocket support',
      };

      const validation = validateSpecification(realtimeSpec);
      const realtimeSuggestion = validation.suggestions.find(s =>
        s.toLowerCase().includes('real-time') || s.toLowerCase().includes('websocket')
      );
      expect(realtimeSuggestion).toBeDefined();
    });

    it('should handle non-technical user input with suggestions', () => {
      const spec = {
        vision: 'I want an app where users can share photos with friends',
      };

      const validation = validateSpecification(spec);

      expect(validation.valid).toBe(true);
      expect(validation.suggestions.length).toBeGreaterThan(0);

      const suggestions = validation.suggestions.join(' ').toLowerCase();
      expect(
        suggestions.includes('frontend') ||
        suggestions.includes('backend') ||
        suggestions.includes('database')
      ).toBe(true);
    });
  });

  describe('Specification enhancement for AI prompt', () => {
    it('should format features for AI consumption', () => {
      const features = [
        { name: 'User authentication', priority: 'high' as const },
        { name: 'File upload', priority: 'medium' as const },
        { name: 'Admin dashboard', priority: 'low' as const },
      ];

      let enhancedSpec = 'Build an application';
      enhancedSpec += '\n\nRequired Features:\n';
      features.forEach((feature, idx) => {
        const priorityLabel = feature.priority ? ` [${feature.priority.toUpperCase()} PRIORITY]` : '';
        enhancedSpec += `${idx + 1}. ${feature.name}${priorityLabel}\n`;
      });

      expect(enhancedSpec).toContain('[HIGH PRIORITY]');
      expect(enhancedSpec).toContain('[MEDIUM PRIORITY]');
      expect(enhancedSpec).toContain('[LOW PRIORITY]');
      expect(enhancedSpec).toContain('User authentication');
    });

    it('should format preferences for AI consumption', () => {
      type ArchitecturePattern = 'monolith' | 'microservices' | 'serverless' | 'unknown';
      const preferences: {
        languages: string[];
        frameworks: string[];
        databases: string[];
        deploymentTarget: string;
        architecturePattern: ArchitecturePattern;
      } = {
        languages: ['typescript', 'python'],
        frameworks: ['react', 'express'],
        databases: ['postgresql', 'redis'],
        deploymentTarget: 'vercel',
        architecturePattern: 'microservices',
      };

      let enhancedSpec = 'Build an application';
      if (preferences.languages && preferences.languages.length > 0) {
        enhancedSpec += `\nPreferred Languages: ${preferences.languages.join(', ')}`;
      }
      if (preferences.frameworks && preferences.frameworks.length > 0) {
        enhancedSpec += `\nPreferred Frameworks: ${preferences.frameworks.join(', ')}`;
      }
      if (preferences.databases && preferences.databases.length > 0) {
        enhancedSpec += `\nPreferred Databases: ${preferences.databases.join(', ')}`;
      }
      if (preferences.architecturePattern && preferences.architecturePattern !== 'unknown') {
        enhancedSpec += `\nArchitecture Pattern: ${preferences.architecturePattern}`;
      }
      if (preferences.deploymentTarget) {
        enhancedSpec += `\nDeployment Target: ${preferences.deploymentTarget}`;
      }

      expect(enhancedSpec).toContain('typescript, python');
      expect(enhancedSpec).toContain('react, express');
      expect(enhancedSpec).toContain('postgresql, redis');
      expect(enhancedSpec).toContain('Architecture Pattern: microservices');
      expect(enhancedSpec).toContain('Deployment Target: vercel');
    });
  });
});
