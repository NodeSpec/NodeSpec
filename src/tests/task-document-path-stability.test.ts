// P0-4: task-doc path drift.
//
// Two coupled defects: (1) getTaskDocumentPath derived the file path from the node's
// CURRENT label only, and (2) the persisting call site recomputed that path every run
// and looked up the existing artifact by nodeId AND path. Renaming a node changed the
// recomputed path, missed the lookup, and created a duplicate artifact while orphaning
// the old one. The fix: the path gains a stable node-id suffix and is used only to
// seed FIRST creation; all lookups go through findExistingTaskArtifact (nodeId + kind),
// which these tests exercise directly — it is the exact function the agent loop now
// calls at the persisting call site.
import { describe, expect, it } from 'vitest';
import {
  findExistingTaskArtifact,
  getTaskDocumentPath,
} from '../../supabase/functions/_shared/task-document-generator.ts';

const NODE_ID = 'b0000000-0000-4000-8000-000000000a01';

describe('P0-4: getTaskDocumentPath', () => {
  it('embeds a short node-id suffix so first-creation paths are per-node unique', () => {
    expect(getTaskDocumentPath('API Service', NODE_ID)).toBe('.nodespec/tasks/api-service-b0000000.task.md');
  });

  it('two nodes with the SAME label get different paths (label collisions cannot overwrite)', () => {
    const a = getTaskDocumentPath('Worker', 'aaaaaaaa-0000-4000-8000-000000000001');
    const b = getTaskDocumentPath('Worker', 'bbbbbbbb-0000-4000-8000-000000000002');
    expect(a).not.toBe(b);
  });

  it('is deterministic for the same node', () => {
    expect(getTaskDocumentPath('API Service', NODE_ID)).toBe(getTaskDocumentPath('API Service', NODE_ID));
  });
});

describe('P0-4: findExistingTaskArtifact — the rename-stable lookup', () => {
  const legacyDoc = {
    id: 'art-1',
    nodeId: NODE_ID,
    kind: 'task',
    path: '.nodespec/tasks/old-label.task.md', // legacy label-only path, node since renamed
    content: '# Task: Old Label',
  };

  it('finds a doc stored under a legacy label-slug path after the node was renamed (reconcile, not duplicate)', () => {
    const artifacts = { 'art-1': legacyDoc };
    // The agent loop calls exactly this after a rename; a hit means UPDATE (keeping
    // the persisted path), a miss would have meant a duplicate add_artifact.
    const found = findExistingTaskArtifact(artifacts, NODE_ID);
    expect(found).not.toBeNull();
    expect(found!.id).toBe('art-1');
    expect(found!.path).toBe('.nodespec/tasks/old-label.task.md');
  });

  it('regenerate after rename touches exactly one artifact — no second doc appears', () => {
    const artifacts: Record<string, typeof legacyDoc> = { 'art-1': { ...legacyDoc } };

    // Simulate the persisting call site's branch decision across two runs post-rename:
    for (let run = 0; run < 2; run++) {
      const existing = findExistingTaskArtifact(artifacts, NODE_ID);
      if (existing) {
        existing.content = `# Task: New Label (run ${run})`; // update path untouched
      } else {
        const path = getTaskDocumentPath('New Label', NODE_ID);
        artifacts[`new-${run}`] = { id: `new-${run}`, nodeId: NODE_ID, kind: 'task', path, content: 'dup' };
      }
    }

    expect(Object.keys(artifacts)).toHaveLength(1);
    expect(artifacts['art-1'].path).toBe('.nodespec/tasks/old-label.task.md');
    expect(artifacts['art-1'].content).toContain('New Label');
  });

  it('ignores non-task artifacts for the same node', () => {
    const artifacts = {
      code: { id: 'code', nodeId: NODE_ID, kind: 'code', path: 'src/index.ts', content: '' },
      test: { id: 'test', nodeId: NODE_ID, kind: 'test-plan', path: 't.md', content: '' },
    };
    expect(findExistingTaskArtifact(artifacts, NODE_ID)).toBeNull();
  });

  it('ignores task docs belonging to other nodes', () => {
    const artifacts = { other: { id: 'other', nodeId: 'other-node', kind: 'task', path: 'x.task.md', content: '' } };
    expect(findExistingTaskArtifact(artifacts, NODE_ID)).toBeNull();
  });
});
