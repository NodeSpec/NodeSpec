/*
  Community edition stub — the repo-import reverse-engineering pipeline is not
  part of the open-source distribution. The service surface survives so the
  git integration UI compiles; every lane reports the feature's home. Repo
  import is available on NodeSpec hosted (Indie and above) and in enterprise
  builds — https://nodespec.io/pricing
*/
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ImportJobFrameVerdict {
  verdict: 'subject' | 'support' | 'undetermined';
  score: number;
  margin: number;
}

export interface ImportJobSkeletonGroup {
  idx: number;
  label: string;
  dirs: string[];
  suggestedRole: string;
  confidence: number;
  frame?: ImportJobFrameVerdict;
}

export interface ImportJobSkeleton {
  headSha: string;
  totalEntries: number;
  groups: ImportJobSkeletonGroup[];
}

export interface ImportJobView {
  id: string;
  status: 'pending' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  skeleton: ImportJobSkeleton | null;
  open_questions: Array<{ kind: string; group: string; detail: string }>;
  proposal_id: string | null;
  metrics: Record<string, number>;
  error: string | null;
}

export interface ImportDriveProgress {
  phase: 'skeleton' | 'fetch' | 'enrich' | 'synthesize';
  detail: string;
  skeleton?: ImportJobSkeleton | null;
}

const NOT_INCLUDED =
  'Repo import is not included in the community edition — available on NodeSpec hosted (Indie and above): https://nodespec.io/pricing';

export class ImportJobService {
  constructor(_supabase: SupabaseClient) {}

  getJob(_jobId: string): Promise<ImportJobView | null> {
    return Promise.resolve(null);
  }

  getLatestJobForProject(_projectId: string): Promise<ImportJobView | null> {
    return Promise.resolve(null);
  }

  drive(_jobId: string, _onProgress?: (p: ImportDriveProgress) => void): Promise<ImportJobView> {
    return Promise.reject(new Error(NOT_INCLUDED));
  }

  subscribe(_jobId: string, _onChange: (job: ImportJobView) => void): () => void {
    return () => {};
  }
}
