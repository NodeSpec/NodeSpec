import type { SupabaseClient } from '@supabase/supabase-js';

export interface TestCase {
  id: string;
  requirementId: string;
  testId: string;
  name: string;
  description?: string;
  testType: 'unit' | 'integration' | 'e2e' | 'acceptance' | 'performance' | 'security';
  framework?: string;
  status: 'not_started' | 'passed' | 'failed' | 'skipped' | 'running';
  implementation?: string;
  expectedResult?: string;
  artifactId?: string;
  artifactPath?: string;
  sourceArtifactIds?: string[];
  sourceContextHash?: string;
  stale: boolean;
  stalenessReason?: string | null;
  /** E1/E2 soft retirement: set = hidden from every count surface, row preserved.
   *  null clears (un-retire). Never a hard delete — evidence survives. */
  retiredAt?: string | null;
  retiredReason?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface TestCaseRow {
  id: string;
  requirement_id: string;
  test_id: string;
  name: string;
  description: string | null;
  test_type: string;
  framework: string | null;
  status: string;
  implementation: string | null;
  expected_result: string | null;
  artifact_id: string | null;
  artifact_path: string | null;
  source_artifact_ids: string[] | null;
  source_context_hash: string | null;
  stale: boolean;
  staleness_reason: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToTestCase(row: TestCaseRow): TestCase {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    testId: row.test_id,
    name: row.name,
    description: row.description ?? undefined,
    testType: row.test_type as TestCase['testType'],
    framework: row.framework ?? undefined,
    status: row.status as TestCase['status'],
    implementation: row.implementation ?? undefined,
    expectedResult: row.expected_result ?? undefined,
    artifactId: row.artifact_id ?? undefined,
    artifactPath: row.artifact_path ?? undefined,
    sourceArtifactIds: row.source_artifact_ids ?? undefined,
    sourceContextHash: row.source_context_hash ?? undefined,
    stale: row.stale ?? false,
    stalenessReason: row.staleness_reason ?? undefined,
    retiredAt: row.retired_at ?? undefined,
    retiredReason: row.retired_reason ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TestCaseRepository {
  getTestCasesByRequirementIds(requirementIds: string[]): Promise<TestCase[]>;
  getTestCase(testCaseId: string): Promise<TestCase | null>;
  createTestCase(testCase: Omit<TestCase, 'id' | 'createdAt' | 'updatedAt'>): Promise<TestCase>;
  updateTestCase(testCaseId: string, updates: Partial<Omit<TestCase, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TestCase>;
  deleteTestCase(testCaseId: string): Promise<void>;
  deleteTestCasesByRequirementId(requirementId: string): Promise<number>;
}

export function createSupabaseTestCaseRepository(client: SupabaseClient): TestCaseRepository {
  return {
    async getTestCasesByRequirementIds(requirementIds: string[]): Promise<TestCase[]> {
      if (requirementIds.length === 0) {
        return [];
      }

      // Retired cases (update_test_case retire lane) are excluded from every
      // canvas/summary surface — the rows survive for audit, they just stop counting.
      const { data, error } = await client
        .from('test_cases')
        .select('*')
        .in('requirement_id', requirementIds)
        .is('retired_at', null);

      if (error) {
        throw new Error(`Failed to fetch test cases: ${error.message}`);
      }

      return (data || []).map(rowToTestCase);
    },

    async getTestCase(testCaseId: string): Promise<TestCase | null> {
      const { data, error } = await client
        .from('test_cases')
        .select('*')
        .eq('id', testCaseId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch test case: ${error.message}`);
      }

      return data ? rowToTestCase(data) : null;
    },

    async createTestCase(testCase: Omit<TestCase, 'id' | 'createdAt' | 'updatedAt'>): Promise<TestCase> {
      const { data, error } = await client
        .from('test_cases')
        .insert({
          requirement_id: testCase.requirementId,
          test_id: testCase.testId,
          name: testCase.name,
          description: testCase.description ?? null,
          test_type: testCase.testType,
          framework: testCase.framework ?? null,
          status: testCase.status,
          implementation: testCase.implementation ?? null,
          expected_result: testCase.expectedResult ?? null,
          artifact_id: testCase.artifactId ?? null,
          artifact_path: testCase.artifactPath ?? null,
          metadata: testCase.metadata ?? {},
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create test case: ${error.message}`);
      }

      return rowToTestCase(data);
    },

    async updateTestCase(
      testCaseId: string,
      updates: Partial<Omit<TestCase, 'id' | 'createdAt' | 'updatedAt'>>
    ): Promise<TestCase> {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.requirementId !== undefined) updateData.requirement_id = updates.requirementId;
      if (updates.testId !== undefined) updateData.test_id = updates.testId;
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.testType !== undefined) updateData.test_type = updates.testType;
      if (updates.framework !== undefined) updateData.framework = updates.framework;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.implementation !== undefined) updateData.implementation = updates.implementation;
      if (updates.expectedResult !== undefined) updateData.expected_result = updates.expectedResult;
      if (updates.artifactId !== undefined) updateData.artifact_id = updates.artifactId;
      if (updates.artifactPath !== undefined) updateData.artifact_path = updates.artifactPath;
      if (updates.sourceArtifactIds !== undefined) updateData.source_artifact_ids = updates.sourceArtifactIds;
      if (updates.sourceContextHash !== undefined) updateData.source_context_hash = updates.sourceContextHash;
      if (updates.stale !== undefined) updateData.stale = updates.stale;
      if (updates.stalenessReason !== undefined) updateData.staleness_reason = updates.stalenessReason;
      if (updates.retiredAt !== undefined) updateData.retired_at = updates.retiredAt;
      if (updates.retiredReason !== undefined) updateData.retired_reason = updates.retiredReason;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

      const { data, error } = await client
        .from('test_cases')
        .update(updateData)
        .eq('id', testCaseId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update test case: ${error.message}`);
      }

      return rowToTestCase(data);
    },

    async deleteTestCase(testCaseId: string): Promise<void> {
      const { error } = await client
        .from('test_cases')
        .delete()
        .eq('id', testCaseId);

      if (error) {
        throw new Error(`Failed to delete test case: ${error.message}`);
      }
    },

    async deleteTestCasesByRequirementId(requirementId: string): Promise<number> {
      const { data, error } = await client
        .from('test_cases')
        .delete()
        .eq('requirement_id', requirementId)
        .select('id');

      if (error) {
        throw new Error(`Failed to delete test cases: ${error.message}`);
      }

      return data?.length ?? 0;
    },
  };
}
