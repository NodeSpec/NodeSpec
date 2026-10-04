// @vitest-environment jsdom
//
// The walkthrough (owner 2026-09-30): "Reference the entire internal
// workflow, then upon a new account being created, do a walkthrough of the
// different functionalities of the application." One tour in the order a
// project runs; each stop takes the app to the surface it explains and
// spotlights the real control; a stop for what the project's plan does not
// carry is not in the tour at all (Q). These run the tour itself: the stop
// list by plan, where the card sits, and the rendered tour over a page that
// carries the anchors, step by step.
//
// AK.2 (owner 2026-10-01): connect one agent and set what it may do first,
// in the Agents panel itself; then workflows and constraints as recommended,
// not required; then Requirements, Plan, and Architecture with a node type
// dragged onto the canvas.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { walkthroughStops, placeCard, surfaceTarget, seenWalkthrough, HEADER_ITEMS, type WalkthroughContext, type WalkthroughSurface } from '../ui/components/common/walkthrough.js';
import { startCardShows } from '../ui/components/common/ProjectStartPopup.js';
import type { FeatureGate } from '../ui/hooks/useFeatureGate.js';

// The connect stop reads the header's evidence of a call (has_mcp_connection).
const mcp = vi.hoisted(() => ({ state: 'disconnected' as 'unknown' | 'connected' | 'disconnected', refresh: vi.fn() }));
vi.mock('../ui/hooks/useMcpConnection.js', () => ({ useMcpConnection: () => ({ state: mcp.state, refresh: mcp.refresh }) }));
const { OnboardingModal } = await import('../ui/components/common/OnboardingModal.js');

const FREE: WalkthroughContext = { workflows: false, plan: false, repoImport: false, team: false };
const INDIE: WalkthroughContext = { workflows: true, plan: true, repoImport: true, team: false };
const TEAM: WalkthroughContext = { ...INDIE, team: true };
const ids = (ctx: WalkthroughContext) => walkthroughStops(ctx).map((s) => s.id);
const text = (ctx: WalkthroughContext) => walkthroughStops(ctx).flatMap((s) => [s.title, ...s.body, ...(s.items ?? []).map((i) => `${i.title} ${i.text}`)]).join('\n');

describe('the stops follow the project, and the plan', () => {
  it('Free walks the loop and every surface it has: the agent first, then Requirements and Architecture', () => {
    expect(ids(FREE)).toEqual(['welcome', 'connect', 'permissions', 'requirements', 'architecture', 'nodes', 'skills', 'agents', 'git', 'export', 'header', 'finish']);
  });

  it('Free is told nothing its plan does not carry: no Plan, Workflows, constraints, repository import or Team', () => {
    const t = text(FREE);
    expect(t).not.toMatch(/\bPlan\b/);
    expect(t).not.toMatch(/Workflows|[Cc]onstraint|order of operations/);
    expect(t).not.toMatch(/import the repository|import it/);
    expect(t).not.toMatch(/\bTeam\b/);
  });

  it('Indie starts with workflows and constraints after the agent, adds Plan after Requirements, and the repository import under Git', () => {
    expect(ids(INDIE)).toEqual(['welcome', 'connect', 'permissions', 'workflows', 'requirements', 'plan', 'architecture', 'nodes', 'skills', 'agents', 'git', 'export', 'header', 'finish']);
    const git = walkthroughStops(INDIE).find((s) => s.id === 'git')!;
    expect(git.body.join(' ')).toContain('Ask your AI to import the repository');
    expect(walkthroughStops(FREE).find((s) => s.id === 'git')!.body).toHaveLength(1);
  });

  it('Team adds its seats beside Agents', () => {
    const t = ids(TEAM);
    expect(t.indexOf('team')).toBe(t.indexOf('agents') + 1);
    expect(ids(INDIE)).not.toContain('team');
  });

  it('every Work stop names its tab, and the tour ends back on Requirements', () => {
    const stops = walkthroughStops(TEAM);
    expect(stops.filter((s) => s.surface?.view === 'work').map((s) => [s.id, (s.surface as { tab: string }).tab])).toEqual([
      ['workflows', 'workflows'], ['requirements', 'requirements'], ['plan', 'plan'], ['finish', 'requirements'],
    ]);
  });

  it('the agent comes first: Connected, then Autonomy, in the Agents panel, where the person acts', () => {
    const [, connect, permissions] = walkthroughStops(FREE);
    expect([connect.id, connect.surface, connect.anchor, connect.interactive]).toEqual(['connect', { view: 'agents', tab: 'connected' }, 'agents-panel', true]);
    expect([permissions.id, permissions.surface, permissions.anchor, permissions.interactive]).toEqual(['permissions', { view: 'agents', tab: 'autonomy' }, 'agents-panel', true]);
    expect(connect.body.join(' ')).toContain('Before anything else, connect the one agent you will build with');
    // offline first (owner 2026-08-31): it never reads as a requirement
    expect(connect.body.join(' ')).toContain('No agent on hand? Go on');
    expect(permissions.body.join(' ')).toContain('Ask first');
    expect(permissions.body.join(' ')).toContain('Approve each puts every kind on Propose');
    // no other stop lets clicks through
    expect(walkthroughStops(TEAM).filter((s) => s.interactive).map((s) => s.id)).toEqual(['connect', 'permissions']);
  });

  it('the connect stop teaches the build\'s method: sign in on the managed platform, a key for a local client', () => {
    const managed = walkthroughStops({ ...FREE, connect: 'sign-in' })[1].body.join(' ');
    expect(managed).toContain('approve the sign-in it opens');
    expect(managed).toContain('An agent that cannot open a browser connects with a key');
    const local = walkthroughStops({ ...FREE, connect: 'key' })[1].body.join(' ');
    expect(local).toContain('It gives you a key once');
    expect(local).toContain('Claude Code, Codex, Gemini CLI, Antigravity, the Claude app, or any MCP client such as Hermes');
    expect(local).not.toContain('sign-in');
  });

  it('workflows and constraints are the recommended start, and say they are not required', () => {
    const w = walkthroughStops(INDIE).find((s) => s.id === 'workflows')!;
    expect(w.chapter).toBe('Recommended start');
    expect(w.body[0]).toBe('Recommended, not required: your agent writes requirements and carries the project forward without them.');
    expect(w.body.join(' ')).toContain('builds those first, and knows what it must not break');
  });

  it('Requirements says what matters, Plan how to read it, Architecture how to drop a node type on the canvas', () => {
    const stops = walkthroughStops(INDIE);
    const by = (id: string) => stops.find((s) => s.id === id)!.body.join(' ');
    expect(by('requirements')).toContain('Criteria start unmet');
    expect(by('requirements')).toContain('a manual one only when you approve its ticked box');
    expect(by('plan')).toContain('Each column is a set; everything in a set can be built at the same time');
    expect(by('plan')).toContain('Needs a decision');
    expect(by('architecture')).toContain('If you already know a change you want, make it here');
    expect(by('architecture')).toContain('drag it onto the canvas');
  });

  it('the welcome names the loop without promising more than the product does', () => {
    const welcome = walkthroughStops(FREE)[0].body.join(' ');
    // Autonomy can apply a kind of change on its own; the tour says so rather than "nothing applies itself".
    expect(welcome).toContain('you decide which kinds it may apply on its own');
    expect(welcome).toContain('a requirement counts as met only when a test proves it');
  });
});

describe('where the card sits beside a spotlight', () => {
  const view = { width: 1440, height: 900 };
  const card = { width: 380, height: 240 };

  it('below a header control, its right edge on the control\'s', () => {
    expect(placeCard({ top: 10, left: 1200, width: 90, height: 32 }, card, view)).toEqual({ top: 56, left: 910, width: 380 });
  });

  it('above a control near the bottom (the canvas dock)', () => {
    expect(placeCard({ top: 820, left: 600, width: 300, height: 50 }, card, view)).toEqual({ top: 566, left: 520, width: 380 });
  });

  it('beside a tall column (the Nodes sidebar), on the side with room', () => {
    expect(placeCard({ top: 56, left: 0, width: 300, height: 844 }, card, view)).toEqual({ top: 56, left: 314, width: 380 });
    expect(placeCard({ top: 56, left: 1140, width: 300, height: 844 }, card, view)).toEqual({ top: 56, left: 746, width: 380 });
  });

  it('docked in the far bottom corner when the surface fills the window', () => {
    expect(placeCard({ top: 60, left: 240, width: 1180, height: 830 }, card, view)).toEqual({ top: 644, left: 16, width: 380 });
    expect(placeCard({ top: 60, left: 0, width: 1200, height: 830 }, card, view)).toEqual({ top: 644, left: 1044, width: 380 });
  });

  it('centred with nothing to point at, never off the window, and full width on a phone', () => {
    expect(placeCard(null, card, view)).toEqual({ top: 330, left: 530, width: 380 });
    const p = placeCard({ top: 10, left: 1400, width: 30, height: 30 }, card, view);
    expect(p.left + p.width).toBeLessThanOrEqual(view.width - 16);
    expect(placeCard({ top: 10, left: 300, width: 30, height: 30 }, card, { width: 390, height: 800 })).toEqual({ top: 544, left: 16, width: 358 });
  });
});

// ── the tour, rendered ────────────────────────────────────────────────────

const ANCHORS = ['mcp', 'agents-panel', 'skills', 'views', 'work-requirements', 'work-plan', 'work-workflows', 'nodes-sidebar', 'canvas-dock', 'changes', 'team', 'git', 'export', 'templates', 'help', 'notifications', 'account'];
const page: HTMLElement[] = [];
function placeAnchors(keys: string[]) {
  keys.forEach((key, i) => {
    const el = document.createElement('div');
    el.setAttribute('data-tour', key);
    el.getBoundingClientRect = () => ({ top: 10 + i, left: 20 * i, width: 40, height: 20, right: 20 * i + 40, bottom: 30 + i, x: 20 * i, y: 10 + i, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    page.push(el);
  });
}

const gate = (plan: 'free' | 'indie' | 'team', loading = false, example = false): FeatureGate => {
  const carried = (f: string) => (plan === 'team' ? true : plan === 'indie' ? f !== 'team_lanes' : false);
  // AJ.6: the example shows every feature; what the plan does not carry is view only
  return {
    plan: plan as FeatureGate['plan'], subscription: null, loading,
    can: (f) => example || carried(f),
    check: () => ({ allowed: false, rule: {} as never }), projectLimitReached: () => false, refresh: async () => {}, refreshUntilActive: () => {},
    ...(example ? { example: true, viewOnly: (f: string) => !carried(f) } : {}),
  };
};

function tour(props: { plan?: 'free' | 'indie' | 'team'; loading?: boolean; firstRun?: boolean; noGate?: boolean; example?: boolean; creates?: boolean } = {}) {
  const onClose = vi.fn();
  const onCreateProject = vi.fn();
  const surfaces: WalkthroughSurface[] = [];
  const utils = render(
    <ThemeProvider>
      <OnboardingModal
        onClose={onClose}
        firstRun={props.firstRun}
        featureGate={props.noGate ? undefined : gate(props.plan ?? 'free', props.loading, props.example)}
        onSurface={(s) => surfaces.push(s)}
        onCreateProject={props.creates ? onCreateProject : undefined}
      />
    </ThemeProvider>,
  );
  const stopId = () => utils.getByTestId('walkthrough-card').getAttribute('data-stop');
  const spot = () => utils.queryByTestId('walkthrough-spotlight')?.getAttribute('data-anchor') ?? null;
  const press = (name: RegExp) => act(() => { fireEvent.click(utils.getByRole('button', { name })); });
  return { ...utils, onClose, onCreateProject, surfaces, stopId, spot, press };
}

beforeEach(() => { vi.useFakeTimers(); mcp.state = 'disconnected'; mcp.refresh.mockClear(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  while (page.length) page.pop()!.remove();
});

describe('the tour, rendered over the app', () => {
  it('a new Free account: every stop in turn, each surface opened and each control lit, then Start my project', () => {
    placeAnchors(ANCHORS);
    const t = tour({ firstRun: true });
    const seen: Array<[string | null, string | null]> = [];
    for (let i = 0; i < 12; i++) {
      seen.push([t.stopId(), t.spot()]);
      if (i < 11) t.press(/^(Next|Connect later)$/);
    }
    expect(seen).toEqual([
      ['welcome', null], ['connect', 'agents-panel'], ['permissions', 'agents-panel'], ['requirements', 'work-requirements'],
      ['architecture', 'nodes-sidebar'], ['nodes', 'canvas-dock'], ['skills', 'skills'], ['agents', 'changes'], ['git', 'git'], ['export', 'export'],
      ['header', 'templates'], ['finish', null],
    ]);
    expect(t.surfaces).toEqual([
      { view: 'agents', tab: 'connected' }, { view: 'agents', tab: 'autonomy' },
      { view: 'work', tab: 'requirements' }, { view: 'architecture' }, { view: 'architecture' }, { view: 'work', tab: 'requirements' },
    ]);
    expect(t.onClose).not.toHaveBeenCalled();
    t.press(/Start my project/);
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it('the connect stop waits for a first call without holding the tour, and says when the agent has called', () => {
    placeAnchors(ANCHORS);
    const t = tour({ firstRun: true });
    t.press(/^Next$/);
    const status = t.getByTestId('walkthrough-connect-status');
    expect([status.getAttribute('data-connected'), status.textContent]).toEqual(['false', 'Waiting for your agent\'s first call.']);
    // it asks again while the person connects
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mcp.refresh).toHaveBeenCalled();
    t.press(/^Connect later$/);
    expect(t.stopId()).toBe('permissions');
    cleanup();
    mcp.state = 'connected';
    const done = tour();
    done.press(/^Next$/);
    expect(done.getByTestId('walkthrough-connect-status').textContent).toBe('Your agent has called NodeSpec. Next, set what it may do.');
    expect(done.queryByRole('button', { name: /^Connect later$/ })).toBeNull();
    done.press(/^Next$/);
    expect(done.stopId()).toBe('permissions');
  });

  it('on the agent stops clicks reach the panel and typing there never moves the tour; elsewhere the tour holds the page', () => {
    placeAnchors(ANCHORS);
    const t = tour();
    const layer = () => t.getByTestId('walkthrough');
    expect(layer().style.pointerEvents).toBe('');
    t.press(/^Next$/);
    expect(t.stopId()).toBe('connect');
    expect(layer().style.pointerEvents).toBe('none');
    expect(t.getByTestId('walkthrough-card').style.pointerEvents).toBe('auto');
    const field = document.createElement('input');
    document.body.appendChild(field);
    page.push(field);
    act(() => { fireEvent.keyDown(field, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyDown(field, { key: 'Escape' }); });
    expect(t.stopId()).toBe('connect');
    expect(t.onClose).not.toHaveBeenCalled();
    t.press(/^Connect later$/);
    t.press(/^Next$/);
    expect(t.stopId()).toBe('requirements');
    expect(layer().style.pointerEvents).toBe('');
  });

  it('an Indie project opens Plan and Workflows; a Team project spotlights Team', () => {
    placeAnchors(ANCHORS);
    const indie = tour({ plan: 'indie' });
    for (let i = 0; i < 3; i++) indie.press(/^(Next|Connect later)$/);
    expect([indie.stopId(), indie.spot()]).toEqual(['workflows', 'work-workflows']);
    for (let i = 0; i < 2; i++) indie.press(/^Next$/);
    expect([indie.stopId(), indie.spot()]).toEqual(['plan', 'work-plan']);
    expect(indie.surfaces).toEqual([{ view: 'agents', tab: 'connected' }, { view: 'agents', tab: 'autonomy' }, { view: 'work', tab: 'workflows' }, { view: 'work', tab: 'requirements' }, { view: 'work', tab: 'plan' }]);
    cleanup();
    const team = tour({ plan: 'team' });
    for (let i = 0; i < 10; i++) team.press(/^(Next|Connect later)$/);
    expect([team.stopId(), team.spot()]).toEqual(['team', 'team']);
  });

  it('fails closed: while the plan loads, or with no plan at all, the tour is the Free one', () => {
    placeAnchors(ANCHORS);
    for (const props of [{ plan: 'team' as const, loading: true }, { noGate: true }]) {
      const t = tour(props);
      expect(t.getByTestId('walkthrough-card').textContent).toContain('1 of 12');
      cleanup();
    }
  });

  it('the header stop lists only the controls this build draws, and lights the one clicked', () => {
    placeAnchors(ANCHORS.filter((a) => a !== 'templates'));
    const t = tour();
    for (let i = 0; i < 10; i++) t.press(/^(Next|Connect later)$/);
    expect(t.stopId()).toBe('header');
    const rows = t.getAllByRole('button', { pressed: false }).concat(t.getAllByRole('button', { pressed: true })).map((b) => b.textContent);
    expect(rows.some((r) => r?.startsWith('Browse Templates'))).toBe(false);
    expect(t.spot()).toBe('help');
    act(() => { fireEvent.click(t.getByRole('button', { name: /^Notifications/ })); });
    expect(t.spot()).toBe('notifications');
    expect(HEADER_ITEMS.map((i) => i.anchor)).toEqual(['templates', 'help', 'notifications', 'account']);
  });

  it('a control that is not on the page gets no spotlight, and the card still explains it', () => {
    placeAnchors(ANCHORS.filter((a) => a !== 'export'));
    const t = tour();
    for (let i = 0; i < 9; i++) t.press(/^(Next|Connect later)$/);
    expect(t.stopId()).toBe('export');
    expect(t.spot()).toBeNull();
    expect(t.getByTestId('walkthrough-card').textContent).toContain('The project as files');
  });

  it('a surface drawn after the stop opens it is spotlighted once it appears', () => {
    placeAnchors(ANCHORS.filter((a) => a !== 'work-requirements'));
    const t = tour();
    for (let i = 0; i < 3; i++) t.press(/^(Next|Connect later)$/);
    expect([t.stopId(), t.spot()]).toEqual(['requirements', null]);
    placeAnchors(['work-requirements']);
    act(() => { vi.advanceTimersByTime(350); });
    expect(t.spot()).toBe('work-requirements');
  });

  it('Back, the arrow keys, Skip tour and Escape; a reopened tour ends on Done', () => {
    placeAnchors(ANCHORS);
    const t = tour();
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(t.stopId()).toBe('permissions');
    t.press(/^Back$/);
    expect(t.stopId()).toBe('connect');
    act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
    expect(t.stopId()).toBe('welcome');
    t.press(/^Skip tour$/);
    expect(t.onClose).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(t.onClose).toHaveBeenCalledTimes(2);
    cleanup();
    const again = tour();
    for (let i = 0; i < 11; i++) again.press(/^(Next|Connect later)$/);
    expect(again.queryByRole('button', { name: /Start my project/ })).toBeNull();
    again.press(/^Done$/);
    expect(again.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the editor around the tour', () => {
  it('a new account (no settings row) has not seen it; its own row decides after that; a failed read leaves it to this browser', () => {
    expect(seenWalkthrough({ data: null, error: null }, true)).toBe(false);
    expect(seenWalkthrough({ data: { has_seen_onboarding: false }, error: null }, true)).toBe(false);
    expect(seenWalkthrough({ data: { has_seen_onboarding: true }, error: null }, false)).toBe(true);
    expect(seenWalkthrough({ data: null, error: { message: 'network' } }, true)).toBe(true);
    expect(seenWalkthrough({ data: null, error: { message: 'network' } }, false)).toBe(false);
    expect(seenWalkthrough(null, true)).toBe(true);
  });

  it('a stop\'s surface: Architecture is the view alone; a Work stop opens the view and focuses its tab', () => {
    expect(surfaceTarget({ view: 'architecture' }, 9)).toEqual({ view: 'architecture', focus: null });
    expect(surfaceTarget({ view: 'work', tab: 'plan' }, 9)).toEqual({ view: 'ideation', focus: { kind: 'tab', tab: 'plan', at: 9 } });
  });

  it('the Start card waits for the walkthrough, and shows on an empty project once it closes', () => {
    const empty = { projectId: 'p1', walkthroughOpen: false, creatingProject: false, stagingSpec: false, dismissed: false, loading: false, vision: null, requirements: 0, nodes: 0 };
    expect(startCardShows(empty)).toBe(true);
    expect(startCardShows({ ...empty, walkthroughOpen: true })).toBe(false);
    for (const busy of [{ creatingProject: true }, { stagingSpec: true }, { dismissed: true }, { loading: true }, { projectId: null }]) {
      expect(startCardShows({ ...empty, ...busy })).toBe(false);
    }
    for (const filled of [{ vision: 'A shelf app' }, { requirements: 1 }, { nodes: 2 }]) {
      expect(startCardShows({ ...empty, ...filled })).toBe(false);
    }
  });
});

// AJ.6 (owner 2026-09-30): a new account lands in its example and the tour runs
// over it: every stop the build ships, Team as Team mode, and the last button
// starts the account's own project. Skipping only closes.
describe('the tour over the example', () => {
  it('a new Free account: every stop, Team mode among them, then Create your own project opens the create popup', () => {
    placeAnchors([...ANCHORS, 'work-plan', 'work-workflows', 'team']);
    const t = tour({ firstRun: true, example: true, creates: true });
    const seen: Array<string | null> = [];
    for (let i = 0; i < 15; i++) {
      seen.push(t.stopId());
      if (i < 14) t.press(/^(Next|Connect later)$/);
    }
    expect(seen).toEqual(['welcome', 'connect', 'permissions', 'workflows', 'requirements', 'plan', 'architecture', 'nodes', 'skills', 'agents', 'team', 'git', 'export', 'header', 'finish']);
    expect(t.queryByRole('button', { name: /Start my project/ })).toBeNull();
    t.press(/^Create your own project$/);
    expect(t.onCreateProject).toHaveBeenCalledTimes(1);
    expect(t.onClose).not.toHaveBeenCalled();
  });

  it('the Team mode stop spotlights the Team button and says it is view only below Team', () => {
    placeAnchors([...ANCHORS, 'work-plan', 'work-workflows', 'team']);
    const t = tour({ example: true, creates: true });
    for (let i = 0; i < 10; i++) t.press(/^(Next|Connect later)$/);
    expect(t.stopId()).toBe('team');
    expect(t.spot()).toBe('team');
    const card = t.getByTestId('walkthrough-card').textContent ?? '';
    expect(card).toContain('Team mode');
    expect(card).toContain('Rosa, Sam and Lena');
    expect(card).toContain('View only. Team mode is on Team and above');
  });

  it('skipping or Escape over the example only closes; with no create door the last button is Done', () => {
    placeAnchors(ANCHORS);
    const t = tour({ example: true, creates: true });
    t.press(/^Skip tour$/);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(t.onClose).toHaveBeenCalledTimes(2);
    expect(t.onCreateProject).not.toHaveBeenCalled();
    cleanup();
    const bare = tour({ example: true });
    for (let i = 0; i < 20 && !bare.queryByRole('button', { name: /^Done$/ }); i++) bare.press(/^(Next|Connect later)$/);
    expect(bare.queryByRole('button', { name: /Create your own project/ })).toBeNull();
    bare.press(/^Done$/);
    expect(bare.onClose).toHaveBeenCalledTimes(1);
  });
});
