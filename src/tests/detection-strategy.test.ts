import { describe, it, expect, beforeEach } from 'vitest';
import {
  DetectionCoordinator,
  createDefaultCoordinator,
  RegexStrategy,
  type DetectionContext,
} from '../domain/detection/index.js';

describe('Detection Strategy System', () => {
  describe('DetectionCoordinator', () => {
    let coordinator: DetectionCoordinator;

    beforeEach(() => {
      coordinator = createDefaultCoordinator();
    });

    it('should register and use strategies', async () => {
      const regexStrategy = new RegexStrategy();
      coordinator.registerStrategy(regexStrategy);

      expect(coordinator.getRegisteredStrategies()).toContain('regex');

      const context: DetectionContext = {
        language: 'javascript',
        artifactKind: 'source',
      };

      const result = await coordinator.detect('const x = 1;', context);
      expect(result).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should unregister strategies', () => {
      const regexStrategy = new RegexStrategy();
      coordinator.registerStrategy(regexStrategy);
      coordinator.unregisterStrategy('regex');

      expect(coordinator.getRegisteredStrategies()).not.toContain('regex');
    });

    it('should return empty result when no strategy supports context', async () => {
      const context: DetectionContext = {
        language: 'unknown-language',
        artifactKind: 'source',
      };

      const result = await coordinator.detect('code', context);
      expect(result.confidence).toBe('low');
    });

    it('should try strategies in order and use first supporting one', async () => {
      const regexStrategy = new RegexStrategy();
      coordinator.registerStrategy(regexStrategy);

      const context: DetectionContext = {
        language: 'javascript',
        artifactKind: 'source',
      };

      const result = await coordinator.detect('const API_KEY = process.env.API_KEY;', context);
      expect(result.envVars).toBeDefined();
      expect(result.envVars!.length).toBeGreaterThan(0);
    });
  });

  describe('RegexStrategy', () => {
    let strategy: RegexStrategy;

    beforeEach(() => {
      strategy = new RegexStrategy();
    });

    it('should support all languages', () => {
      expect(strategy.supports({ language: 'javascript', artifactKind: 'source' })).toBe(true);
      expect(strategy.supports({ language: 'python', artifactKind: 'source' })).toBe(true);
      expect(strategy.supports({ language: 'unknown', artifactKind: 'source' })).toBe(true);
    });

    it('should detect environment variables', async () => {
      const code = `
        const apiKey = process.env.API_KEY;
        const dbUrl = import.meta.env.DATABASE_URL;
      `;

      const context: DetectionContext = {
        language: 'javascript',
        artifactKind: 'source',
      };

      const result = await strategy.detect(code, context);
      expect(result.envVars).toBeDefined();
      expect(result.envVars!.length).toBeGreaterThan(0);
      expect(result.envVars!.some(v => v.name === 'API_KEY')).toBe(true);
      expect(result.envVars!.some(v => v.name === 'DATABASE_URL')).toBe(true);
    });

    it('should detect React components', async () => {
      const code = `
        import React from 'react';

        export function Button() {
          return <button>Click me</button>;
        }

        export const Card = () => {
          return <div>Card content</div>;
        };
      `;

      const context: DetectionContext = {
        language: 'typescript',
        artifactKind: 'source',
        framework: { name: 'React', type: 'frontend' },
      };

      const result = await strategy.detect(code, context);
      expect(result.components).toBeDefined();
      expect(result.components!.length).toBeGreaterThan(0);
      expect(result.components!.some(c => c.name === 'Button')).toBe(true);
    });

    it('should detect API routes', async () => {
      const code = `
        import express from 'express';
        const app = express();

        app.get('/api/users', (req, res) => {
          res.json({ users: [] });
        });

        app.post('/api/tasks', (req, res) => {
          res.json({ task: req.body });
        });
      `;

      const context: DetectionContext = {
        language: 'javascript',
        artifactKind: 'source',
        framework: { name: 'Express', type: 'backend' },
      };

      const result = await strategy.detect(code, context);
      expect(result.routes).toBeDefined();
      expect(result.routes!.length).toBe(2);
      expect(result.routes!.some(r => r.path === '/api/users' && r.method === 'GET')).toBe(true);
      expect(result.routes!.some(r => r.path === '/api/tasks' && r.method === 'POST')).toBe(true);
    });
  });
});
