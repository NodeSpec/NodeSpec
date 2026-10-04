// @vitest-environment jsdom
/**
 * V3 1.2 (2026-09-19): one branch, one chip.
 *
 * Behaviour, not text: the chip is mounted with the props the top bar gives
 * it and asked what it shows. Two branch rows are handed in on purpose:
 * the multi-branch UI is retired, so a second row must change nothing on
 * screen and offer nothing to click.
 */
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { BranchChip } from '../ui/components/panels/BranchChip.js';

const twoRows = [
  { id: 'b1', name: 'main', isPrimary: true },
  { id: 'b2', name: 'feature/x', isPrimary: false },
];

describe('BranchChip', () => {
  it('shows the current branch and nothing to click, even when two branch rows exist', () => {
    const { container, getByTestId } = render(
      <BranchChip currentBranch="main" availableBranches={twoRows} gitDefaultBranch={null} />
    );
    expect(getByTestId('branch-chip').textContent).toContain('main');
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('[onclick], a, select, input')).toHaveLength(0);
    for (const gone of ['feature/x', 'New Branch', 'Delete', 'Branches']) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  it('annotates a bound git ref that is called something else, display only', () => {
    const { getByTestId } = render(
      <BranchChip currentBranch="main" availableBranches={twoRows} gitDefaultBranch="master" />
    );
    const chip = getByTestId('branch-chip');
    expect(chip.textContent).toContain('→ master');
    expect(chip.getAttribute('title')).toContain('bound to the git branch "master"');
  });

  it('stays quiet when the ref has the same name, and never annotates a non-primary branch', () => {
    const same = render(
      <BranchChip currentBranch="main" availableBranches={twoRows} gitDefaultBranch="main" />
    );
    expect(within(same.container).getByTestId('branch-chip').textContent).not.toContain('→');
    const secondary = render(
      <BranchChip currentBranch="feature/x" availableBranches={twoRows} gitDefaultBranch="master" />
    );
    expect(within(secondary.container).getByTestId('branch-chip').textContent).not.toContain('→');
  });

  it('reads primacy from the flag, with the naming rule only as the legacy fallback', () => {
    // a renamed trunk carries the flag under its real name: primary, no alias needed
    const renamed = render(
      <BranchChip currentBranch="master" availableBranches={[{ id: 'b', name: 'master', isPrimary: true }]} gitDefaultBranch="master" />
    );
    expect(within(renamed.container).getByTestId('branch-chip').textContent).not.toContain('→');
    // a legacy trunk with no flag but the old name is still treated as primary
    const legacy = render(
      <BranchChip currentBranch="main" availableBranches={[{ id: 'b', name: 'main' }]} gitDefaultBranch="trunk" />
    );
    expect(within(legacy.container).getByTestId('branch-chip').textContent).toContain('→ trunk');
  });

  it('carries the autosave dot', () => {
    const { getByTitle } = render(
      <BranchChip currentBranch="main" availableBranches={twoRows} hasUnsavedChanges />
    );
    expect(getByTitle('Unsaved canvas changes').textContent).toBe('●');
  });
});
