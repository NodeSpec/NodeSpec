// @vitest-environment jsdom
/**
 * Export's Commit to Git card carries no upsell (owner 2026-09-28). Git push
 * is on every plan in every edition, but the card read the plan through a
 * gate that answered no while it was loading, and meanwhile drew a lock,
 * "Available on Architect and Pro plans" and "Upgrade to Architect", names
 * of plans that no longer exist. The card now asks no plan at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectExportModal } from '../ui/components/common/ProjectExportModal.js';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import type { ProjectExportData } from '../ui/utils/export-context.js';

const data = {
  meta: { projectName: 'Checkout', exportedAt: '', schemaVersion: 8, graphHash: '', nodeCount: 0, edgeCount: 0, contractCount: 0, artifactCount: 0, testCount: 0 },
  nodes: [], edges: [], contracts: [], artifacts: [],
} as unknown as ProjectExportData;

function open(hasGitIntegration: boolean) {
  // the modal reads the backend's address for its icons, as a dev build does
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  const onPushToGit = vi.fn();
  render(
    <MemoryRouter>
      <ThemeProvider defaultMode="light" readOnly>
        <ProjectExportModal data={data} onClose={() => {}} hasGitIntegration={hasGitIntegration} onPushToGit={onPushToGit} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  return onPushToGit;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Export's Commit to Git card", () => {
  it('no repository yet: Connect Repository opens the Git panel, and no plan is named', () => {
    const onPushToGit = open(false);
    fireEvent.click(screen.getByRole('button', { name: /Connect Repository/ }));
    expect(onPushToGit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/\bArchitect\b/)).toBeNull();
    expect(screen.queryByText(/Upgrade/)).toBeNull();
    expect(screen.queryByText(/Pro plans/)).toBeNull();
  });

  it('a repository connected: Commit opens the Git panel', () => {
    const onPushToGit = open(true);
    fireEvent.click(screen.getByRole('button', { name: /^Commit$/ }));
    expect(onPushToGit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Upgrade to/)).toBeNull();
  });
});
