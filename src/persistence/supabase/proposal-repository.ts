import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AIProposal,
  ProposalPatch,
  ProposalStatus,
} from '@nodespec/core/ai-proposal.js';
import type { RepositoryResult } from '../types.js';
import type { ProposalRepository } from '../ports.js';

function sanitizeForJsonb(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\u0000/g, '').replace(/\\u0000/g, '');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJsonb);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitizeForJsonb(v);
    }
    return result;
  }
  return value;
}

interface ProposalRow {
  id: string;
  ai_run_id: string;
  source_branch_id: string;
  proposal_branch_id: string;
  status: ProposalStatus;
  patches: ProposalPatch[];
  validation_expectations: string[];
  metadata: Record<string, unknown> | null;
  created_at: string;
  reviewed_at: string | null;
  merged_at: string | null;
}

function rowToProposal(row: ProposalRow): AIProposal {
  return {
    id: row.id,
    aiRunId: row.ai_run_id,
    sourceBranchId: row.source_branch_id,
    proposalBranchId: row.proposal_branch_id,
    status: row.status,
    patches: row.patches,
    validationExpectations: row.validation_expectations ?? [],
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? undefined,
    mergedAt: row.merged_at ?? undefined,
  };
}

export function createSupabaseProposalRepository(client: SupabaseClient): ProposalRepository {
  return {
    async create(proposal): Promise<RepositoryResult<AIProposal>> {
      const { data, error } = await client
        .from('ai_proposals')
        .insert({
          id: proposal.id,
          ai_run_id: proposal.aiRunId,
          source_branch_id: proposal.sourceBranchId,
          proposal_branch_id: proposal.proposalBranchId,
          status: proposal.status,
          patches: sanitizeForJsonb(proposal.patches) as ProposalPatch[],
          validation_expectations: proposal.validationExpectations,
          metadata: proposal.metadata ?? {},
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProposal(data) };
    },

    async getById(proposalId): Promise<RepositoryResult<AIProposal | null>> {
      const { data, error } = await client
        .from('ai_proposals')
        .select()
        .eq('id', proposalId)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToProposal(data) : null };
    },

    async getByAIRunId(aiRunId): Promise<RepositoryResult<AIProposal | null>> {
      const { data, error } = await client
        .from('ai_proposals')
        .select()
        .eq('ai_run_id', aiRunId)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToProposal(data) : null };
    },

    async listByBranch(branchId, status): Promise<RepositoryResult<AIProposal[]>> {
      let query = client
        .from('ai_proposals')
        .select()
        .eq('source_branch_id', branchId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToProposal) };
    },

    async updateStatus(proposalId, status): Promise<RepositoryResult<AIProposal>> {
      const { data, error } = await client
        .from('ai_proposals')
        .update({ status })
        .eq('id', proposalId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProposal(data) };
    },

    async updatePatches(proposalId, patches): Promise<RepositoryResult<AIProposal>> {
      const { data, error } = await client
        .from('ai_proposals')
        .update({ patches: sanitizeForJsonb(patches) as ProposalPatch[] })
        .eq('id', proposalId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProposal(data) };
    },

    async markReviewed(proposalId): Promise<RepositoryResult<AIProposal>> {
      const { data, error } = await client
        .from('ai_proposals')
        .update({ reviewed_at: new Date().toISOString() })
        .eq('id', proposalId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProposal(data) };
    },

    async markMerged(proposalId): Promise<RepositoryResult<AIProposal>> {
      const { data, error } = await client
        .from('ai_proposals')
        .update({
          status: 'merged',
          merged_at: new Date().toISOString(),
        })
        .eq('id', proposalId)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProposal(data) };
    },

    async delete(proposalId): Promise<RepositoryResult<void>> {
      const { error } = await client
        .from('ai_proposals')
        .delete()
        .eq('id', proposalId);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: undefined };
    },
  };
}
