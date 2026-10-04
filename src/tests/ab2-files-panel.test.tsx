// @vitest-environment jsdom
//
// AB.2 (owner 2026-09-23): the node's Files panel. A file bound to a node
// loads itself from the repository when opened (opening it again is the
// retry), so there is no "Load from repo" button. "Complete / Unlock" read
// like the node's own lock and is gone: editing a file marked complete
// reopens it as a draft in the same patch, and deleting one reopens then
// removes it. No suggested starting files: a node starts with the files
// someone adds.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderCanvas } from './helpers/reactflow-dom.js';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import { createNodeFromTemplatePatch, createUpdateArtifactPatch } from '@nodespec/core/patch-factory.js';
import { validatePatch } from '@nodespec/core/patch-engine.js';
import { getTemplateById } from '@nodespec/core/templates.js';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const { ArtifactWorkbenchPanel } = await import('../ui/components/panels/ArtifactWorkbenchPanel.js');

const NODE = '00000000-0000-4000-8000-0000000000a1';
const F1 = '00000000-0000-4000-8000-0000000000f1';
const S1 = '00000000-0000-4000-8000-0000000000f2';
const graph = (artifacts: Record<string, unknown>): Graph => ({
  id: 'g', schemaVersion: 1, version: 1, hash: 'h',
  nodes: { [NODE]: { id: NODE, type: 'backend-service', label: 'Checkout API', artifacts: Object.keys(artifacts) } } as never,
  edges: {}, contracts: {}, artifacts: artifacts as never,
});
const file = (id: string, over: Record<string, unknown> = {}) => ({
  id, nodeId: NODE, kind: 'source', path: `src/${id.slice(-2)}.ts`, content: 'export const a = 1;\n', contentHash: 'h1',
  createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', status: 'complete', ...over,
});

describe('AB.2 · the Files panel', () => {
  it('has no Load from repo, no Complete or Unlock, no suggested files', () => {
    const g = graph({ [F1]: file(F1), [S1]: file(S1, { status: 'suggested', content: undefined }) });
    const { container } = renderCanvas(<ArtifactWorkbenchPanel selectedNodeId={NODE} graph={g} onPatchGenerated={() => {}} />);
    const text = container.textContent ?? '';
    for (const gone of ['Load from repo', 'Unlock', 'Complete', 'Suggested files', 'Accept', 'Dismiss']) expect(text).not.toContain(gone);
    expect(text).toContain('1 file');
    expect(text).toContain('Delete');
  });

  it('saving an edit to a file marked complete reopens it as a draft, in one patch the engine accepts', async () => {
    const g = graph({ [F1]: file(F1) });
    const patches: PatchOperation[] = [];
    const { getByTestId } = renderCanvas(<ArtifactWorkbenchPanel selectedNodeId={NODE} graph={g} onPatchGenerated={(p) => patches.push(p)} />);
    fireEvent.change(getByTestId('editor'), { target: { value: 'export const a = 2;\n' } });
    await waitFor(() => expect(patches.some((p) => p.type === 'update_artifact')).toBe(true), { timeout: 2000 });
    const update = patches.find((p) => p.type === 'update_artifact') as { payload: { changes: Record<string, unknown> } } | undefined;
    expect(update?.payload.changes).toMatchObject({ content: 'export const a = 2;\n', status: 'draft' });
    expect(validatePatch(g, update as never).errors).toEqual([]);
  });

  it('deleting a file marked complete reopens it, then removes it', () => {
    const g = graph({ [F1]: file(F1) });
    const patches: PatchOperation[] = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { getByText } = renderCanvas(<ArtifactWorkbenchPanel selectedNodeId={NODE} graph={g} onPatchGenerated={(p) => patches.push(p)} />);
    fireEvent.click(getByText('Delete'));
    expect(patches.map((p) => p.type)).toEqual(['update_node', 'update_artifact', 'remove_artifact']);
    expect((patches[1] as { payload: { changes: unknown } }).payload.changes).toMatchObject({ status: 'draft' });
  });

  it('a file with no body loads itself when opened, and says so when it could not', async () => {
    const g = graph({ [F1]: file(F1, { content: undefined, contentHash: undefined }) });
    const load = vi.fn(async () => false);
    const { findByTestId } = renderCanvas(<ArtifactWorkbenchPanel selectedNodeId={NODE} graph={g} onPatchGenerated={() => {}} onLoadFromRepo={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledWith(F1));
    expect((await findByTestId('artifact-hydration')).textContent).toBe('This file could not be loaded from the repository. Open it again to retry.');
  });
});

describe('AB.2 · the engine and the templates', () => {
  it('filling in the missing body of a complete file is allowed; changing a complete file\'s body is not, unless it reopens', () => {
    const empty = graph({ [F1]: file(F1, { content: undefined, contentHash: undefined }) });
    const fill = createUpdateArtifactPatch(F1, { content: 'x', contentHash: 'hx', updatedAt: '2026-09-23T00:00:00Z' }, { actorType: 'human', summary: 'Load' });
    expect(validatePatch(empty, fill).errors).toEqual([]);
    const full = graph({ [F1]: file(F1) });
    expect(validatePatch(full, fill).errors.map((e) => e.code)).toEqual(['ARTIFACT_IMMUTABLE']);
    const reopen = createUpdateArtifactPatch(F1, { content: 'x', status: 'draft' }, { actorType: 'human', summary: 'Edit' });
    expect(validatePatch(full, reopen).errors).toEqual([]);
  });

  it('a node made from a template starts with no files', () => {
    expect(getTemplateById('rest-service')).toBeTruthy();
    const p = createNodeFromTemplatePatch('rest-service', NODE, 'A', { actorType: 'human', summary: 'Add' });
    expect(p.payload.artifacts).toEqual([]);
  });
});
