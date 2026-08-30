import { describe, it, expect } from 'vitest';
import { createSupabaseSpecificationRepository } from '../persistence/supabase/specification-repository.js';

describe('Specification Repository Integration', () => {
  const store = new Map<string, any>();

  const mockSupabase = {
    from: (_table: string) => {
      let query: any = {
        data: null,
        error: null,
      };
      let eqColumn: string | null = null;
      let eqValue: any = null;
      let pendingUpdate: any = null;
      let pendingDelete = false;

      const methods = {
        insert: (data: any) => {
          const record = { ...data, id: data.id || 'test-spec-id', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          store.set(record.id, record);
          query.data = record;
          return methods;
        },
        select: (_columns?: string) => {
          return methods;
        },
        single: () => {
          if (pendingUpdate && eqColumn === 'id' && eqValue && store.has(eqValue)) {
            const existing = store.get(eqValue);
            const updated = { ...existing, ...pendingUpdate };
            store.set(eqValue, updated);
            query.data = updated;
          }
          if (pendingDelete && eqColumn === 'id' && eqValue) {
            store.delete(eqValue);
            return Promise.resolve({ data: null, error: null });
          }
          if (eqColumn === 'id' && eqValue && !pendingUpdate) {
            const found = store.get(eqValue);
            return Promise.resolve({ data: found || null, error: found ? null : { message: 'Not found' } });
          }
          return Promise.resolve({ data: query.data, error: query.error });
        },
        eq: (column: string, value: any) => {
          eqColumn = column;
          eqValue = value;
          return methods;
        },
        update: (data: any) => {
          pendingUpdate = data;
          return methods;
        },
        delete: () => {
          pendingDelete = true;
          return methods;
        },
        order: (_column: string, _options?: any) => {
          return Promise.resolve({ data: Array.from(store.values()), error: null });
        },
      };

      return methods;
    },
  } as any;

  const repo = createSupabaseSpecificationRepository(mockSupabase);

  describe('create', () => {
    it('should create a specification successfully', async () => {
      const result = await repo.create({
        vision: 'Build a todo app with React and Node.js',
        constraints: [{ type: 'technology', description: 'Must use TypeScript' }],
        preferences: {
          languages: ['typescript'],
          frameworks: ['react', 'express'],
          architecturePattern: 'monolith',
        },
        createdBy: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vision).toBe('Build a todo app with React and Node.js');
        expect(result.data.constraints).toHaveLength(1);
        expect(result.data.preferences.languages).toContain('typescript');
      }
    });

    it('should create specification with minimal data', async () => {
      const result = await repo.create({
        vision: 'Build something',
        createdBy: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vision).toBe('Build something');
        expect(result.data.constraints).toEqual([]);
        expect(result.data.preferences).toEqual({});
      }
    });

    it('should handle null projectId for new projects', async () => {
      const result = await repo.create({
        vision: 'Build an app',
        projectId: null,
        createdBy: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.projectId).toBeNull();
      }
    });
  });

  describe('getById', () => {
    it('should retrieve a specification by ID', async () => {
      const createResult = await repo.create({
        vision: 'Build a chat app',
        createdBy: 'user-123',
      });

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        const getResult = await repo.getById(createResult.data.id);
        expect(getResult.success).toBe(true);
      }
    });
  });

  describe('update', () => {
    it('should update specification vision', async () => {
      const createResult = await repo.create({
        vision: 'Original vision',
        createdBy: 'user-123',
      });

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        const updateResult = await repo.update(createResult.data.id, {
          vision: 'Updated vision',
        });

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.vision).toBe('Updated vision');
        }
      }
    });

    it('should update specification constraints', async () => {
      const createResult = await repo.create({
        vision: 'Build an app',
        createdBy: 'user-123',
      });

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        const updateResult = await repo.update(createResult.data.id, {
          constraints: [
            { type: 'technology', description: 'Must use TypeScript' },
          ],
        });

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.constraints).toHaveLength(1);
        }
      }
    });
  });

  describe('linkToProject', () => {
    it('should link specification to project', async () => {
      const createResult = await repo.create({
        vision: 'Build an app',
        projectId: null,
        createdBy: 'user-123',
      });

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        const linkResult = await repo.linkToProject(createResult.data.id, 'project-456');
        expect(linkResult.success).toBe(true);
      }
    });
  });

  describe('validation integration', () => {
    it('should accept valid specification structure', async () => {
      const result = await repo.create({
        vision: 'E-commerce platform with payment processing',
        constraints: [
          { type: 'technology', description: 'Must use TypeScript' },
          { type: 'deployment', description: 'Deploy on Vercel' },
        ],
        preferences: {
          languages: ['typescript'],
          frameworks: ['next.js', 'express'],
          databases: ['postgresql'],
          deploymentTarget: 'vercel',
          architecturePattern: 'monolith',
        },
        createdBy: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.constraints).toHaveLength(2);
        expect(result.data.preferences.languages).toContain('typescript');
      }
    });

    it('should handle specification with all optional fields empty', async () => {
      const result = await repo.create({
        vision: 'Build an application',
        constraints: [],
        preferences: {},
        createdBy: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.constraints).toEqual([]);
        expect(result.data.preferences).toEqual({});
      }
    });
  });
});
