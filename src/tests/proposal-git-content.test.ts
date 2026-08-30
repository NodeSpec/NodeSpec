import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GIT_CONTENT_SENTINEL,
  collectGitContentRequests,
  injectGitContent,
} from '../ui/utils/proposal-git-content.js';
import { computeContentHash } from '@nodespec/core/utils.js';
import type { PatchOperation } from '@nodespec/core/types.js';

// C1 (docs/WORK_LOOP_PLAN.md): content-by-reference — "push code to git;
// propose bindings." The server stamps a sentinel + contentSource marker on
// bindings-only add_artifact patches; the accept lane materializes the real
// bytes before any patch lands. These are the pure halves plus the wiring.

function sentinelPatch(path: string, ref = 'abc123'): PatchOperation {
  return {
    type: 'add_artifact',
    metadata: { id: '9c1d0000-0000-4000-8000-000000000001', actorType: 'ai', summary: 's', timestamp: '2026-08-21T00:00:00.000Z' },
    payload: {
      id: '9c1d0000-0000-4000-8000-000000000002',
      nodeId: '9c1d0000-0000-4000-8000-000000000003',
      kind: 'source', path,
      content: GIT_CONTENT_SENTINEL,
      metadata: { contentSource: { type: 'git', ref } },
      createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    },
  } as unknown as PatchOperation;
}

describe('collectGitContentRequests', () => {
  it('finds sentinel patches with a well-formed marker, ignoring everything else', () => {
    const ordinary = { type: 'add_node', payload: { id: 'n1' } } as unknown as PatchOperation;
    const inline = {
      type: 'add_artifact', payload: { path: 'src/a.ts', content: 'real body' },
    } as unknown as PatchOperation;
    const { requests, malformed } = collectGitContentRequests([ordinary, sentinelPatch('src/new.ts'), inline]);
    expect(malformed).toEqual([]);
    expect(requests).toEqual([{ index: 1, path: 'src/new.ts', ref: 'abc123' }]);
  });

  it('a sentinel WITHOUT a usable ref is malformed — never silently applied as content', () => {
    const broken = sentinelPatch('src/new.ts');
    (broken.payload as { metadata?: unknown }).metadata = {};
    const { requests, malformed } = collectGitContentRequests([broken]);
    expect(requests).toEqual([]);
    expect(malformed).toEqual(['src/new.ts']);
  });
});

describe('injectGitContent', () => {
  it('swaps content in with the residue-bind stamping convention (hash + provenance)', () => {
    const body = 'export const notify = () => "hi";\n';
    const { patches, missing } = injectGitContent(
      [sentinelPatch('src/new.ts', 'ref9')],
      [{ index: 0, path: 'src/new.ts', ref: 'ref9' }],
      new Map([['src/new.ts', body]]),
    );
    expect(missing).toEqual([]);
    const payload = patches[0].payload as unknown as {
      content: string; contentHash: string; sourceProvenance: string;
      metadata: { contentSource: unknown; provenance: { origin: string; ref: string } };
    };
    expect(payload.content).toBe(body);
    expect(payload.contentHash).toBe(computeContentHash(body));
    expect(payload.sourceProvenance).toBe('git-content-ref');
    expect(payload.metadata.provenance.origin).toBe('git-content-ref');
    expect(payload.metadata.provenance.ref).toBe('ref9');
    // The server's marker survives as permanent provenance.
    expect(payload.metadata.contentSource).toEqual({ type: 'git', ref: 'ref9' });
  });

  it('a path absent from the fetch is reported missing and its patch left untouched', () => {
    const { patches, missing } = injectGitContent(
      [sentinelPatch('src/gone.ts')],
      [{ index: 0, path: 'src/gone.ts', ref: 'abc123' }],
      new Map(),
    );
    expect(missing).toEqual(['src/gone.ts']);
    expect((patches[0].payload as { content: string }).content).toBe(GIT_CONTENT_SENTINEL);
  });

  it('patches outside the request set are returned untouched by reference', () => {
    const other = { type: 'add_node', payload: { id: 'n1' } } as unknown as PatchOperation;
    const { patches } = injectGitContent([other], [], new Map());
    expect(patches[0]).toBe(other);
  });
});

describe('C1 wiring contracts', () => {
  const proposalService = readFileSync(resolve(__dirname, '../ui/services/ProposalService.ts'), 'utf-8');
  const serverTool = readFileSync(
    resolve(__dirname, '../../supabase/functions/mcp-server/tools/proposals.ts'),
    'utf-8',
  );
  const clientUtil = readFileSync(resolve(__dirname, '../ui/utils/proposal-git-content.js').replace(/\.js$/, '.ts'), 'utf-8');

  it('the sentinel is identical across runtimes (server stamps, client materializes)', () => {
    expect(serverTool).toContain('"__nodespec_git_content__"');
    expect(clientUtil).toContain("'__nodespec_git_content__'");
  });

  it('acceptProposal materializes git content BEFORE any patch lands', () => {
    expect(proposalService).toContain('collectGitContentRequests');
    expect(proposalService).toContain('injectGitContent');
    // Materialization precedes patch insertion — a fetch failure must abort
    // with nothing applied, so a re-accept resumes cleanly.
    expect(proposalService.indexOf('collectGitContentRequests'))
      .toBeLessThan(proposalService.indexOf('appendPatches'));
    // Missing bytes are fatal, never a warning.
    expect(proposalService).toContain('push the commit named by content_ref');
  });

  it('content is fetched at the stamped ref through the existing git-pull lane', () => {
    expect(proposalService).toMatch(/fetchFileContent\(integration\.id, paths, undefined, ref\)/);
  });

  it('every doc surface teaches the lane (registry, docs page, skill) — same-commit sync rule', () => {
    const registry = readFileSync(
      resolve(__dirname, '../../supabase/functions/mcp-server/tool-registry.ts'), 'utf-8');
    const docsPage = readFileSync(resolve(__dirname, '../ui/components/docs/MCPDocsPage.tsx'), 'utf-8');
    const skill = readFileSync(resolve(__dirname, '../../skills/nodespec-developer/SKILL.md'), 'utf-8');
    const llmsFull = readFileSync(resolve(__dirname, '../../public/llms-full.txt'), 'utf-8');
    for (const [name, text] of [['registry', registry], ['docs page', docsPage], ['skill', skill]] as const) {
      expect(text, `${name} must document content_ref`).toContain('content_ref');
    }
    expect(skill).toContain('Push code; propose bindings');
    expect(llmsFull).toContain('bindings-only');
  });

  // C2 (docs/WORK_LOOP_PLAN.md): chunked sessions ride the same sync rule.
  it('every doc surface teaches chunked sessions (proposal_id + finalize)', () => {
    const registry = readFileSync(
      resolve(__dirname, '../../supabase/functions/mcp-server/tool-registry.ts'), 'utf-8');
    const docsPage = readFileSync(resolve(__dirname, '../ui/components/docs/MCPDocsPage.tsx'), 'utf-8');
    const skill = readFileSync(resolve(__dirname, '../../skills/nodespec-developer/SKILL.md'), 'utf-8');
    const llmsFull = readFileSync(resolve(__dirname, '../../public/llms-full.txt'), 'utf-8');
    for (const [name, text] of [['registry', registry], ['docs page', docsPage], ['skill', skill]] as const) {
      expect(text, `${name} must document proposal_id`).toContain('proposal_id');
      expect(text, `${name} must document finalize`).toContain('finalize');
    }
    expect(registry).toContain('CHUNKED SESSIONS');
    expect(llmsFull).toContain('chunked sessions');
    // The staged convention: sessions are invisible until finalized, and the
    // review surface must keep filtering to 'pending' for that to hold.
    const changesPanel = readFileSync(resolve(__dirname, '../ui/components/panels/ChangesPanel.tsx'), 'utf-8');
    expect(changesPanel).toContain("listProposalsByBranch(branchId, 'pending')");
  });

  // C3 (docs/WORK_LOOP_PLAN.md): honest partial reporting rides the same rule.
  it('every doc surface teaches the truncation guards (expected_patch_count)', () => {
    const registry = readFileSync(
      resolve(__dirname, '../../supabase/functions/mcp-server/tool-registry.ts'), 'utf-8');
    const docsPage = readFileSync(resolve(__dirname, '../ui/components/docs/MCPDocsPage.tsx'), 'utf-8');
    const skill = readFileSync(resolve(__dirname, '../../skills/nodespec-developer/SKILL.md'), 'utf-8');
    const llmsFull = readFileSync(resolve(__dirname, '../../public/llms-full.txt'), 'utf-8');
    for (const [name, text] of [['registry', registry], ['docs page', docsPage], ['skill', skill], ['llms-full', llmsFull]] as const) {
      expect(text, `${name} must document expected_patch_count`).toContain('expected_patch_count');
    }
    expect(registry).toContain('HONEST DELIVERY');
    // A truncated request body dies at the transport's JSON parse — that lane
    // must answer with the chunked continuation, not a generic 500.
    const serverIndex = readFileSync(
      resolve(__dirname, '../../supabase/functions/mcp-server/index.ts'), 'utf-8');
    expect(serverIndex).toContain('truncated in transit');
    expect(serverIndex).toContain('nothing was received or stored');
  });
});
