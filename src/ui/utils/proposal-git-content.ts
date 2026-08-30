// C1 (docs/WORK_LOOP_PLAN.md): content-by-reference materialization — the
// accept-time half. propose_patches (server) stamps bindings-only add_artifact
// patches with a sentinel content string plus payload.metadata.contentSource
// = { type: 'git', ref }; THIS module finds those patches and swaps the real
// file bytes in before any patch lands, mirroring the residue-bind lane's
// stamping convention (contentHash + sourceProvenance + metadata.provenance).
//
// Pure functions — the fetch itself stays in ProposalService (GitService →
// git-pull edge function), so every decision here is unit-testable offline.
import type { PatchOperation } from '@nodespec/core/types.js';
import { computeContentHash } from '@nodespec/core/utils.js';

/** MUST equal the server's sentinel (mcp-server/tools/proposals.ts) — pinned
 *  by a cross-runtime parity test. */
export const GIT_CONTENT_SENTINEL = '__nodespec_git_content__';

export interface GitContentRequest {
  /** Index into the patches array. */
  index: number;
  path: string;
  ref: string;
}

/**
 * Find the patches whose content must be pulled from git. Only patches that
 * carry BOTH the sentinel and a well-formed contentSource marker qualify — a
 * sentinel without a ref (impossible via the server, conceivable via a
 * hand-written proposal row) is reported as malformed so the accept can fail
 * loudly instead of applying a literal sentinel string as file content.
 */
export function collectGitContentRequests(
  patches: PatchOperation[],
): { requests: GitContentRequest[]; malformed: string[] } {
  const requests: GitContentRequest[] = [];
  const malformed: string[] = [];
  patches.forEach((patch, index) => {
    if (patch.type !== 'add_artifact') return;
    const payload = patch.payload as { content?: string; path?: string; metadata?: Record<string, unknown> };
    if (payload?.content !== GIT_CONTENT_SENTINEL) return;
    const source = payload.metadata?.contentSource as { type?: string; ref?: string } | undefined;
    const path = typeof payload.path === 'string' ? payload.path : '';
    if (source?.type === 'git' && typeof source.ref === 'string' && source.ref.length > 0 && path) {
      requests.push({ index, path, ref: source.ref });
    } else {
      malformed.push(path || `(patch ${index}: no path)`);
    }
  });
  return { requests, malformed };
}

/**
 * Swap fetched content into the sentinel patches. Returns the new patches
 * array plus every requested path that was NOT in `files` — the caller must
 * treat a non-empty `missing` as fatal (a bindings-only artifact whose bytes
 * cannot be found must abort the accept, never land empty or as the sentinel).
 */
export function injectGitContent(
  patches: PatchOperation[],
  requests: GitContentRequest[],
  files: ReadonlyMap<string, string>,
): { patches: PatchOperation[]; missing: string[] } {
  const missing: string[] = [];
  const byIndex = new Map<number, GitContentRequest>(requests.map((r) => [r.index, r]));
  const next = patches.map((patch, index) => {
    const request = byIndex.get(index);
    if (!request) return patch;
    const content = files.get(request.path);
    if (content === undefined) {
      missing.push(request.path);
      return patch;
    }
    const payload = patch.payload as { metadata?: Record<string, unknown> };
    return {
      ...patch,
      payload: {
        ...(patch.payload as Record<string, unknown>),
        content,
        contentHash: computeContentHash(content),
        sourceProvenance: 'git-content-ref',
        metadata: {
          ...(payload.metadata ?? {}),
          provenance: {
            origin: 'git-content-ref',
            ref: request.ref,
            at: new Date().toISOString(),
          },
        },
      },
    } as unknown as PatchOperation;
  });
  return { patches: next, missing };
}
