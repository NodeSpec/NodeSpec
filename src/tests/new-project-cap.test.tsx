// @vitest-environment jsdom
/**
 * New project follows the plan's project cap, and nothing else (owner
 * 2026-09-28): the open source build creates projects freely; the managed
 * site's Free plan stops at HOSTED_COMMUNITY_PROJECT_LIMIT. Until this, the
 * editor's New Project handler also demanded the Indie feature
 * `unlimited_projects`, so on Free with one project, and in the open source
 * build at any count, the click did nothing.
 *
 * The real gate hook (useFeatureGate) is built per edition and handed to the
 * real Projects dialog; the account has no subscription row (Free, or the
 * container's Community).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const world = vi.hoisted(() => ({ projects: 0, example: false }));

vi.mock('../ui/context/ServiceContext.js', () => {
  const auth = { getSession: async () => ({ user: { id: 'person-1' }, session: { access_token: 't' } }) };
  const subscription = {
    getCurrentSubscription: async () => null,
    ensureFreeCustomer: async () => true,
    syncFromStripe: async () => undefined,
  };
  const project = {
    listProjects: async () => [
      // AJ.6: the account's example, when it has one, lists with the rest
      ...(world.example ? [{ id: 'p-ex', name: 'Harbor Lane Bakery (example)', ownerId: 'person-1', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z', metadata: { example: 'harbor-lane-bakery' } }] : []),
      ...Array.from({ length: world.projects }, (_, i) => ({
        id: `p${i}`, name: `Project ${i + 1}`, ownerId: 'person-1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
      })),
    ],
    resumePendingDeletes: async () => ({ failed: [] }),
  };
  return { useAuth: () => auth, useSubscription: () => subscription, useProject: () => project };
});

vi.mock('../persistence/supabase/client.js', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, getSupabaseClient: () => ({ rpc: async () => ({ data: null, error: null }) }) };
});

async function build(edition: string) {
  vi.stubEnv('VITE_NODESPEC_EDITION', edition);
  vi.stubEnv('VITE_NODESPEC_TEST_TIER', '');
  vi.resetModules();
  const { useFeatureGate } = await import('../ui/hooks/useFeatureGate.js');
  const { ProjectExplorer } = await import('../ui/components/panels/ProjectExplorer.js');
  const { ThemeProvider } = await import('../ui/theme/ThemeContext.js');
  const hook = renderHook(() => useFeatureGate());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { gate: hook.result.current, ProjectExplorer, ThemeProvider };
}

async function openProjects(edition: string, projects: number) {
  world.projects = projects;
  const { gate, ProjectExplorer, ThemeProvider } = await build(edition);
  const onCreateProject = vi.fn();
  render(
    <MemoryRouter>
      <ThemeProvider defaultMode="light" readOnly>
        <ProjectExplorer currentProjectId={null} onSelectProject={() => {}} onCreateProject={onCreateProject}
          onClose={() => {}} featureGate={gate} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  if (projects > 0) await screen.findByText(`Project ${projects}`);
  const button = screen.getByRole('button', { name: '+ New Project' });
  return { gate, onCreateProject, button };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  world.example = false;
});

describe('New Project follows the project cap', () => {
  it('the managed site on Free: the second project opens the create popup', async () => {
    const { gate, onCreateProject, button } = await openProjects('hosted', 1);
    expect(gate.plan).toBe('community');
    fireEvent.click(button);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Free includes 2 projects')).toBeNull();
  });

  it('the managed site on Free at two projects: the button is off and says why', async () => {
    const { onCreateProject, button } = await openProjects('hosted', 2);
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onCreateProject).not.toHaveBeenCalled();
    expect(screen.getByText('Free includes 2 projects')).toBeTruthy();
  });

  it('the open source build: no cap at any count', async () => {
    const { gate, onCreateProject, button } = await openProjects('', 5);
    expect(gate.plan).toBe('community');
    expect(gate.projectLimitReached(50)).toBe(false);
    fireEvent.click(button);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Free includes/)).toBeNull();
  });
});

// AJ.6 (owner 2026-09-30): the example every account gets does not count
// against the projects Free includes, and says so in the list.
describe('the example project and the cap', () => {
  it('Free with the example and one project of their own: a second is still offered; the example is labelled', async () => {
    world.example = true;
    const { onCreateProject, button } = await openProjects('hosted', 1);
    expect(screen.getByText('Harbor Lane Bakery (example)')).toBeTruthy();
    expect(screen.getByTestId('project-example').textContent).toBe('Example project, not counted in your plan');
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  it('Free with the example and two of their own: the cap, counted without the example', async () => {
    world.example = true;
    const { button } = await openProjects('hosted', 2);
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText('Free includes 2 projects')).toBeTruthy();
  });

  it('deleting the example says it is not made again', async () => {
    world.example = true;
    await openProjects('hosted', 1);
    // the example lists first, then the account's own
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(screen.getByText(/will be permanently deleted/).textContent).toContain('Harbor Lane Bakery (example)');
    expect(screen.getByTestId('project-delete-example').textContent).toBe(' The example is not made again.');
    cleanup();
    await openProjects('hosted', 1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    expect(screen.getByText(/will be permanently deleted/).textContent).toContain('Project 1');
    expect(screen.queryByTestId('project-delete-example')).toBeNull();
  });
});

