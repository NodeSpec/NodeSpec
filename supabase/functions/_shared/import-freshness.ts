/*
  Community edition stub — repo index freshness rides the repo-import
  pipeline, which is not part of the open-source distribution. The drift
  sweep imports this seam; here it reports 'unsupported' and the sweep
  continues unchanged. Available on NodeSpec hosted (Indie and above) and in
  enterprise builds — https://nodespec.io/pricing
*/
export interface TreeEntry { path: string; sha: string; size?: number }

export interface FreshnessDeps {
  fetchTree(): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  fetchFiles(paths: string[]): Promise<Array<{ path: string; content: string }>>;
}

export interface StaleNode {
  nodeId: string;
  modified: number;
  deleted: number;
  unverified: number;
  samples: string[];
}

export interface IndexFreshness {
  status: "refreshed" | "no_index" | "unsupported" | "tree_truncated" | "error";
  headSha?: string;
  treeFiles?: number;
  indexFiles?: number;
  added?: number;
  modified?: number;
  deleted?: number;
  unverified?: number;
  refreshed?: number;
  pendingRefresh?: number;
  staleNodes?: StaleNode[];
  detail?: string;
}

export const REFRESH_CAP = 0;

export function refreshRepoIndexForBranch(
  _supabase: unknown,
  _deps: FreshnessDeps,
  _args: { branchId: string; headSha: string; provider: string; cap?: number },
): Promise<IndexFreshness> {
  return Promise.resolve({ status: "no_index" });
}

export function describeIndexFreshness(_f: IndexFreshness | null | undefined): string | null {
  return null;
}
