// @vitest-environment jsdom
//
// V3 AD.1d (owner 2026-09-24): ticks are never dropped, and a card resolves
// only by the action that answered it. The server refuses an accept while
// ticks wait (`_shared/card-resolve.ts`); these tests hold the Git panel's
// half: the tick box applies task ticks too, Accept waits for the ticks,
// Dismiss names them, accepting every file resolves only a card whose files
// are all it asks, and auto-sync leaves a card an agent's proposal answers.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ReconciliationView } from '../ui/components/panels/GitIntegrationModal.js';
import { unappliedTickCounts, ticksPhrase, cardQuestionsBeyondFiles, isAutoSyncEligible } from '../ui/utils/git-auto-sync.js';
import type { GitChangeEvent } from '../ui/services/GitService.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const CRITERION_TICK = { deltas: [{ requirementId: 'REQ-001', text: 'signs in', direction: 'tick' as const }], flagged: [] };
const TASK_TICK = { deltas: [{ nodeId: 'n1', key: 'k1', displayId: 'T1', title: 'wire auth', direction: 'tick' as const }], flagged: [] };

function change(overrides: Partial<GitChangeEvent> = {}): GitChangeEvent {
  return {
    id: 'c1', commitSha: 'abc1234', commitMessage: 'edit', author: 'dev',
    changedFiles: [{ path: 'src/a.ts', action: 'modified' }],
    status: 'pending', createdAt: 't', source: 'sweep', branchName: 'main',
    artifactMatches: [{ path: 'src/a.ts', artifactId: 'a-src', nodeId: 'n1', nodeName: 'API' }],
    residuePaths: [],
    ...overrides,
  } as GitChangeEvent;
}

describe('AD.1d: what a card still asks', () => {
  it('counts ticks nobody applied, one kind at a time', () => {
    const c = change({ criterionDeltas: CRITERION_TICK, taskDeltas: TASK_TICK });
    expect(unappliedTickCounts(c)).toEqual({ criteria: 1, tasks: 1 });
    expect(unappliedTickCounts({ ...c, criteriaApplied: { at: 't', count: 1 } })).toEqual({ criteria: 0, tasks: 1 });
    expect(unappliedTickCounts({ ...c, ticksApplied: { at: 't', count: 1 } })).toEqual({ criteria: 1, tasks: 0 });
    expect(ticksPhrase({ criteria: 1, tasks: 2 })).toBe('1 criterion tick and 2 task ticks');
  });

  it('names the questions beyond the files: ticks, and a plane nobody loaded that differs', () => {
    expect(cardQuestionsBeyondFiles(change())).toEqual([]);
    expect(cardQuestionsBeyondFiles(change({ taskDeltas: TASK_TICK }))).toEqual(['ticks']);
    expect(cardQuestionsBeyondFiles(change({ modelChanged: true }))).toEqual(['model']);
    expect(cardQuestionsBeyondFiles(change({ modelChanged: true, restoredPlanes: ['model'] }))).toEqual([]);
    expect(cardQuestionsBeyondFiles(change({ modelChanged: true, modelDiff: { identical: true } as never }))).toEqual([]);
    expect(cardQuestionsBeyondFiles(change({ specChanged: true }))).toEqual(['spec']);
  });

  it('auto-sync leaves a card an agent\'s proposal answers', () => {
    const artifacts = { 'a-src': { status: 'draft', kind: 'source' } };
    expect(isAutoSyncEligible(change(), 'main', artifacts).eligible).toBe(true);
    expect(isAutoSyncEligible(change({ reconcileProposalId: 'p1' }), 'main', artifacts))
      .toEqual({ eligible: false, reason: 'proposal-pending' });
  });

  it('auto-sync works oldest card first', () => {
    const hook = readFileSync(resolve(__dirname, '../ui/hooks/useGitAutoSync.ts'), 'utf8');
    expect(hook).toMatch(/\.sort\(\(a, b\) => \(a\.createdAt \?\? ''\)\.localeCompare\(b\.createdAt \?\? ''\)\)/);
  });
});

function renderCard(c: GitChangeEvent, extra: Record<string, unknown> = {}) {
  const onResolve = vi.fn(async () => {});
  const onApplyCriteria = vi.fn(async () => {});
  const onAcceptArtifact = vi.fn(() => null);
  const gitService = {
    fetchFileContent: vi.fn(async (_id: string, paths: string[]) => paths.map((p) => ({ path: p, content: 'new' }))),
  };
  render(
    <ReconciliationView
      changes={[c]}
      onResolve={onResolve}
      integration={{ id: 'i1' } as never}
      gitService={gitService as never}
      graphArtifacts={{ 'a-src': { path: 'src/a.ts', content: 'old', nodeId: 'n1' } }}
      onAcceptArtifact={onAcceptArtifact}
      onApplyCriteria={onApplyCriteria}
      {...extra}
    />,
  );
  return { onResolve, onApplyCriteria, onAcceptArtifact };
}

describe('AD.1d: the Git panel never drops a tick', () => {
  it('Accept waits for ticks nobody applied, and says so', () => {
    renderCard(change({ criterionDeltas: CRITERION_TICK, taskDeltas: TASK_TICK }));
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Accept waits for the 1 criterion tick and 1 task tick above/)).toBeTruthy();
  });

  it('Accept is open once the ticks are applied', () => {
    renderCard(change({ criterionDeltas: CRITERION_TICK, criteriaApplied: { at: 't', count: 1 } }));
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('task ticks show in the box and apply through the same button', async () => {
    const { onApplyCriteria } = renderCard(change({ taskDeltas: TASK_TICK }));
    expect(screen.getByText('Tasks ticked in this commit:')).toBeTruthy();
    expect(screen.getByText('T1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark these tasks done' }));
    await waitFor(() => expect(onApplyCriteria).toHaveBeenCalledWith('c1'));
  });

  it('both kinds share one button', () => {
    renderCard(change({ criterionDeltas: CRITERION_TICK, taskDeltas: TASK_TICK }));
    expect(screen.getByRole('button', { name: 'Mark these criteria met and tasks done' })).toBeTruthy();
  });

  it('Dismiss names the ticks it sets aside before anything happens', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onResolve } = renderCard(change({ criterionDeltas: CRITERION_TICK, taskDeltas: TASK_TICK }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(confirm.mock.calls[0][0]).toContain('It also sets aside the 1 criterion tick and 1 task tick nobody applied.');
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('accepting every file resolves a card whose files are all it asks', async () => {
    const { onResolve, onAcceptArtifact } = renderCard(change());
    fireEvent.click(screen.getByRole('button', { name: /Accept 1 Changed File/ }));
    await waitFor(() => expect(onAcceptArtifact).toHaveBeenCalled());
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('c1', 'accepted'));
  });

  it('accepting every file leaves a card that still carries ticks or an unloaded model', async () => {
    for (const extra of [{ taskDeltas: TASK_TICK }, { modelChanged: true }]) {
      const { onResolve, onAcceptArtifact } = renderCard(change(extra));
      fireEvent.click(screen.getAllByRole('button', { name: /Accept 1 Changed File/ }).at(-1)!);
      await waitFor(() => expect(onAcceptArtifact).toHaveBeenCalled());
      // The batch has finished once its button is gone; any resolve would have run.
      await waitFor(() => expect(screen.queryAllByRole('button', { name: /Accept 1 Changed File/ })).toHaveLength(0));
      await new Promise((r) => setTimeout(r, 0));
      expect(onResolve).not.toHaveBeenCalled();
    }
  });

  it('a loaded plane says so and offers no second load; a waiting proposal is named', () => {
    renderCard(change({ modelChanged: true, restoredPlanes: ['model'], reconcileProposalId: 'p1' }), { onRestoreModel: vi.fn() });
    expect(screen.getByText('Loaded from the repository: model.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load repo model onto canvas/ })).toBeNull();
    expect(screen.getByText(/It resolves when you accept that proposal in Proposals/)).toBeTruthy();
  });
});
