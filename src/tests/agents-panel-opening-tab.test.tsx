// @vitest-environment jsdom
/**
 * The Agents panel opens on Proposals whenever something waits for a
 * decision (owner 2026-09-28). The header badge counts every kind; the panel
 * picked its tab from the canvas proposals alone, so with only outcome,
 * requirement or promotion proposals waiting it opened on Repository, and a
 * Review link from Work landed there too.
 *
 * The real panel renders; its data hooks answer from `world`, and the tab
 * bodies it would draw are stand-ins that name themselves.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { Graph } from '@nodespec/core/types.js';

const world = vi.hoisted(() => ({ queuePending: 0, canvasPending: [] as unknown[], lists: 0 }));

vi.mock('../ui/context/ServiceContext.js', () => {
  // One object each, as the app's context gives: a fresh one per render would
  // re-run every effect that depends on it.
  const proposals = { listProposalsByBranch: async () => { world.lists += 1; return world.canvasPending; } };
  const patches = { loadPatches: async () => [] };
  return { useProposal: () => proposals, usePatch: () => patches };
});
vi.mock('../persistence/supabase/client.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getSupabaseClient: () => ({}) }));
vi.mock('../ui/services/GitService.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  GitService: class {
    getRecentChangeEvents = async () => [];
    getRepoSyncEvents = async () => [];
    getBranchGitRef = async () => null;
    getIntegration = async () => null;
  },
}));
vi.mock('../ui/components/ideation/useApprovalsQueue.js', () => ({
  useApprovalsQueue: () => ({ pending: world.queuePending, items: [], refresh: async () => {} }),
  queuePlanFrom: () => ({}),
}));
vi.mock('../ui/hooks/useProjectFeatureGate.js', () => ({ useProjectFeatureGate: () => ({ loading: false, can: () => true, plan: 'team' }) }));
vi.mock('../ui/components/ideation/useAgentPresence.js', () => ({ useAgentPresence: () => ({ holds: [], refresh: async () => {} }) }));
vi.mock('../ui/components/ideation/useAutonomySettings.js', () => ({ useAutonomySettings: () => ({ loading: true, policy: {} }) }));
vi.mock('../ui/components/ideation/useAgentConnections.js', () => ({ useAgentConnections: () => ({ loading: true, error: null, active: 0, limit: 1 }) }));
vi.mock('../ui/components/ideation/ApprovalsQueue.js', () => ({
  ApprovalsWaiting: () => <div>the proposals list</div>,
  ApprovalsHistory: () => null,
}));
vi.mock('../ui/components/ideation/AutonomyOverlay.js', () => ({ AutonomyOverlay: () => <div>the autonomy settings</div> }));
vi.mock('../ui/components/ideation/DecisionPage.js', () => ({ DecisionPage: () => null }));
vi.mock('../ui/components/ideation/ConnectedAgents.js', () => ({ ConnectedAgents: () => <div>the connected agents</div> }));
vi.mock('../ui/components/panels/AgentRoster.js', () => ({ AgentRoster: () => null }));
vi.mock('../ui/components/panels/AgentAvatars.js', () => ({ AgentAvatars: () => null }));

import { ChangesPanel, openingTab } from '../ui/components/panels/ChangesPanel.js';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';

const graph = { nodes: {}, edges: {}, contracts: {}, artifacts: {} } as unknown as Graph;

function open(focusProposalId: string | null = null) {
  render(
    <ThemeProvider defaultMode="light" readOnly>
      <ChangesPanel isOpen onClose={() => {}} projectId="p1" branchId="b1" branchName="main" hasGitIntegration
        graph={graph} onReviewProposal={() => {}} focusProposalId={focusProposalId} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  world.queuePending = 0;
  world.canvasPending = [];
  world.lists = 0;
});

// AL.20 (owner 2026-10-02: production lagging): the canvas proposals behind
// the header badge are read every 30 seconds even with the panel closed. A
// hidden tab read them too; now it waits, and coming back reads once.
describe('the badge read waits while the tab is hidden', () => {
  it('every 30 s while shown, none while hidden, one on coming back', async () => {
    // Only the interval clocks are faked: the badge read runs on one.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); }); };
    try {
      render(
        <ThemeProvider defaultMode="light" readOnly>
          <ChangesPanel isOpen={false} onClose={() => {}} projectId="p1" branchId="b1" branchName="main" hasGitIntegration
            graph={graph} onReviewProposal={() => {}} focusProposalId={null} />
        </ThemeProvider>,
      );
      await tick(0);
      const first = world.lists;
      expect(first).toBeGreaterThan(0);
      await tick(30_000);
      expect(world.lists).toBe(first + 1);
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await tick(10 * 60_000);
      expect(world.lists).toBe(first + 1);
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await tick(0);
      expect(world.lists).toBe(first + 2);
    } finally {
      hidden = false;
      vi.useRealTimers();
    }
  });
});

// AK (owner 2026-10-01): the header's MCP button opens the panel on Connected,
// and the walkthrough walks it from Connected to Autonomy while it stays open.
describe('another surface opens the panel on a tab', () => {
  const panel = (openOn: { tab: 'connected' | 'autonomy' | 'pending'; at: number } | null, isOpen = true) => (
    <ThemeProvider defaultMode="light" readOnly>
      <ChangesPanel isOpen={isOpen} onClose={() => {}} projectId="p1" branchId="b1" branchName="main" hasGitIntegration
        graph={graph} onReviewProposal={() => {}} focusProposalId={null} openOn={openOn} />
    </ThemeProvider>
  );

  it('opens on the tab asked for, over the one it would pick, and moves when asked again', () => {
    world.queuePending = 3;
    const view = render(panel({ tab: 'connected', at: 1 }));
    expect(screen.getByText('the connected agents')).toBeTruthy();
    expect(screen.queryByText('the proposals list')).toBeNull();
    act(() => { view.rerender(panel({ tab: 'autonomy', at: 2 })); });
    expect(screen.getByText('the autonomy settings')).toBeTruthy();
    expect(screen.getByTestId('proposals-panel').getAttribute('data-tour')).toBe('agents-panel');
  });

  it('hidden and shown again (a review over it), it comes back on the tab asked for', () => {
    world.queuePending = 3;
    const view = render(panel({ tab: 'autonomy', at: 5 }, false));
    act(() => { view.rerender(panel({ tab: 'autonomy', at: 5 }, true)); });
    expect(screen.getByText('the autonomy settings')).toBeTruthy();
  });

  it('opened with nothing asked, it picks its own tab as before', () => {
    world.queuePending = 3;
    render(panel(null));
    expect(screen.getByText('the proposals list')).toBeTruthy();
  });
});

describe('the Agents panel opens where the decisions are', () => {
  it('only outcome, requirement or promotion proposals waiting: Proposals', () => {
    world.queuePending = 2;
    open();
    expect(screen.getByText('the proposals list')).toBeTruthy();
    expect(screen.queryByText('Check for changes now')).toBeNull();
  });

  it('nothing waiting: Repository', () => {
    open();
    expect(screen.queryByText('the proposals list')).toBeNull();
    expect(screen.getByText('Check for changes now')).toBeTruthy();
  });

  it('opened on a proposal (Review from Work), even before the queue has counted it: Proposals', () => {
    open('proposal-7');
    expect(screen.getByText('the proposals list')).toBeTruthy();
  });

  it('the rule itself', () => {
    expect(openingTab(0, false)).toBe('repository');
    expect(openingTab(1, false)).toBe('pending');
    expect(openingTab(0, true)).toBe('pending');
  });
});

// Owner 2026-09-29: the Agents popup's close X was off screen. Five tabs with
// their notes are wider than the 540px panel; in one row that could neither
// wrap nor shrink, the X at its end was pushed past the panel edge and clipped
// (measured in Chromium at 360 to 1440px wide: 22px past the edge at every
// width). The tabs now wrap in their own box and the X sits outside it.
describe('the Agents panel close button stays in view', () => {
  it('the close button is outside the tabs, never shrinks, and closes the panel', () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider defaultMode="light" readOnly>
        <ChangesPanel isOpen onClose={onClose} projectId="p1" branchId="b1" branchName="main" hasGitIntegration
          graph={graph} onReviewProposal={() => {}} focusProposalId={null} />
      </ThemeProvider>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const tabs = screen.getByTestId('changes-tabs');
    expect(tabs.contains(close)).toBe(false);
    expect(screen.getByTestId('changes-header').lastElementChild).toBe(close);
    expect(tabs.style.flexWrap).toBe('wrap');
    expect(parseFloat(tabs.style.minWidth)).toBe(0);
    expect(close.style.flexShrink).toBe('0');
    for (const name of ['Proposals', 'Connected', 'Repository', 'History']) {
      expect(tabs.textContent).toContain(name);
    }
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
