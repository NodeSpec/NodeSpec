import { describe, it, expect, vi } from 'vitest';
import {
  AIDetectionStrategy,
  createNativeAIStrategy,
  createCustomAIStrategy,
  type DetectionContext,
} from '../domain/detection/index.js';

describe('AI Detection Strategy', () => {
  describe('AIDetectionStrategy', () => {
    it('should support all languages', () => {
      const strategy = new AIDetectionStrategy({ mode: 'native' });

      expect(strategy.supports({ language: 'javascript', artifactKind: 'source' })).toBe(true);
      expect(strategy.supports({ language: 'python', artifactKind: 'source' })).toBe(true);
      expect(strategy.supports({ language: 'go', artifactKind: 'source' })).toBe(true);
      expect(strategy.supports({ language: 'unknown', artifactKind: 'source' })).toBe(true);
    });

    it('should return low confidence on error', async () => {
      const strategy = new AIDetectionStrategy({ mode: 'native' });

      const context: DetectionContext = {
        language: 'javascript',
        artifactKind: 'source',
      };

      const result = await strategy.detect('const x = 1;', context);

      expect(result.confidence).toBe('low');
      expect(result.metadata?.strategy).toBe('ai');
      expect(result.metadata?.error).toBeDefined();
    });
  });

  describe('Native AI Strategy', () => {
    it('should create strategy with native mode', () => {
      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token'
      );

      expect(strategy.name).toBe('ai');
    });

    it('should use default model if not specified', () => {
      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token'
      );

      expect(strategy).toBeDefined();
    });

    it('should use custom model if specified', () => {
      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token',
        { model: 'gpt-4' }
      );

      expect(strategy).toBeDefined();
    });

    it('should fail gracefully when Supabase config missing', async () => {
      const strategy = new AIDetectionStrategy({ mode: 'native' });

      const result = await strategy.detect('const x = 1;', {
        language: 'javascript',
        artifactKind: 'source',
      });

      expect(result.confidence).toBe('low');
      expect(result.metadata?.error).toContain('Supabase configuration');
    });
  });

  describe('Custom AI Strategy', () => {
    it('should create strategy with custom mode', () => {
      const strategy = createCustomAIStrategy(
        'https://api.example.com/detect',
        { 'X-API-Key': 'test-key' }
      );

      expect(strategy.name).toBe('ai');
    });

    it('should support custom headers', () => {
      const strategy = createCustomAIStrategy(
        'https://api.example.com/detect',
        {
          'X-API-Key': 'test-key',
          'X-Custom-Header': 'custom-value',
        }
      );

      expect(strategy).toBeDefined();
    });

    it('should fail gracefully when endpoint missing', async () => {
      const strategy = new AIDetectionStrategy({ mode: 'custom' });

      const result = await strategy.detect('const x = 1;', {
        language: 'javascript',
        artifactKind: 'source',
      });

      expect(result.confidence).toBe('low');
      expect(result.metadata?.error).toContain('endpoint');
    });
  });

  describe('AI Response Validation', () => {
    it('should validate AI response schema', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          components: [
            { name: 'Button', type: 'component', exported: true },
          ],
          functions: [
            { name: 'handleClick', parameters: ['event'], exported: false },
          ],
          confidence: 'high',
        }),
      });

      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token'
      );

      const result = await strategy.detect('function Button() {}', {
        language: 'javascript',
        artifactKind: 'source',
      });

      expect(result.confidence).toBe('high');
      expect(result.components).toBeDefined();
      expect(result.functions).toBeDefined();
    });

    it('should reject invalid AI response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invalid: 'response',
        }),
      });

      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token'
      );

      const result = await strategy.detect('function Button() {}', {
        language: 'javascript',
        artifactKind: 'source',
      });

      expect(result.confidence).toBe('low');
      expect(result.metadata?.error).toContain('invalid response');
    });
  });

  describe('Detection Result Conversion', () => {
    it('should convert AI response to DetectionResult', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          components: [
            { name: 'UserList', type: 'component', exported: true },
            { name: 'UserCard', type: 'component', exported: false },
          ],
          functions: [
            { name: 'fetchUsers', parameters: [], exported: true, async: true },
          ],
          routes: [
            { path: '/api/users', method: 'GET' },
          ],
          imports: [
            { module: 'react', imports: ['useState', 'useEffect'], kind: 'named' },
          ],
          exports: [
            { name: 'UserList', kind: 'function' },
          ],
          confidence: 'high',
          summary: 'React component for displaying users',
        }),
      });

      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token'
      );

      const result = await strategy.detect('code here', {
        language: 'javascript',
        artifactKind: 'source',
        nodeType: 'web.frontend-spa',
      });

      expect(result.confidence).toBe('high');
      expect(result.components).toHaveLength(2);
      expect(result.functions).toHaveLength(1);
      expect(result.routes).toHaveLength(1);
      expect(result.imports).toHaveLength(1);
      expect(result.exports).toHaveLength(1);
      expect(result.metadata?.summary).toBe('React component for displaying users');
      expect(result.metadata?.strategy).toBe('ai');
      expect(result.metadata?.mode).toBe('native');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout after specified duration', async () => {
      // The strategy enforces its timeout by passing AbortSignal.timeout(ms)
      // to fetch — real fetch rejects when the signal aborts. A plain
      // promise mock ignores the signal, so it must listen for 'abort'
      // itself; otherwise the test hangs for the full mock delay.
      global.fetch = vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener('abort', () => reject(signal.reason));
          })
      );

      const strategy = createNativeAIStrategy(
        'https://test.supabase.co',
        async () => 'test-access-token',
        { timeout: 100 }
      );

      const result = await strategy.detect('code', {
        language: 'javascript',
        artifactKind: 'source',
      });

      expect(result.confidence).toBe('low');
      expect(result.metadata?.strategy).toBe('ai');
      expect(result.metadata?.error).toBeDefined();

      // The fetch call must have carried an abort signal — that is the
      // mechanism under test.
      const init = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }, 10000); // safety cap; the abort fires at ~100ms
  });
});
