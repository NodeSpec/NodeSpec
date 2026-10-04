// @vitest-environment jsdom
//
// A new account reaches its first project (owner 2026-09-30, with the
// walkthrough: "upon a new account being created, do a walkthrough"). The
// walkthrough opens on the first project, so the sign-in has to get there.
// The auth client emits SIGNED_IN while a password sign-in or a two-factor
// check is still pending, which the app's listener skips, and after the
// check only MFA_CHALLENGE_VERIFIED. What loads the project is the route
// change: "/" sends a signed-in person to "/app", the router hands the auth
// effect a new navigate, and the effect reads the session again. Here the
// real App runs against a scripted auth client and project list: both
// sign-ins land on the first-project screen, and nothing loads while the
// code is still owed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string }; access_token: string },
  listeners: [] as Listener[],
  secondFactor: false,
  verified: false,
  listed: [] as string[],
  // AJ.6: what the database answers for the account's example, and the order things were asked in
  example: null as null | string,
  order: [] as string[],
  own: false,
}));
const OWN_ROW = { id: 'own-1', name: 'My shop', ownerId: 'user-new', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', metadata: {} };
const EXAMPLE_ROW = { id: 'ex-1', name: 'Harbor Lane Bakery (example)', ownerId: 'user-new', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z', metadata: { example: 'harbor-lane-bakery' } };
const SESSION = { user: { id: 'user-new', email: 'new@acme.test' }, access_token: 't' };

vi.mock('../persistence/supabase/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      onAuthStateChange: (fn: Listener) => { auth.listeners.push(fn); return { data: { subscription: { unsubscribe: () => {} } } }; },
      signInWithPassword: async () => {
        auth.session = SESSION;
        // As the client does: SIGNED_IN at once, before the caller has checked the second factor.
        auth.listeners.forEach((fn) => fn('SIGNED_IN', SESSION));
        return { data: { session: SESSION }, error: null };
      },
      updateUser: async () => ({ data: {}, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: auth.secondFactor && !auth.verified ? { currentLevel: 'aal1', nextLevel: 'aal2' } : { currentLevel: auth.verified ? 'aal2' : 'aal1', nextLevel: auth.verified ? 'aal2' : 'aal1' },
          error: null,
        }),
        listFactors: async () => ({ data: { totp: auth.secondFactor ? [{ id: 'factor-1', status: 'verified' }] : [] }, error: null }),
        challenge: async () => ({ data: { id: 'challenge-1' }, error: null }),
        verify: async () => {
          auth.verified = true;
          auth.listeners.forEach((fn) => fn('MFA_CHALLENGE_VERIFIED', auth.session));
          return { data: {}, error: null };
        },
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async (fn: string) => {
      auth.order.push(`rpc:${fn}`);
      return fn === 'ensure_example_project' ? { data: auth.example, error: null } : { data: null, error: null };
    },
  }),
}));
vi.mock('../persistence/supabase/project-repository.js', () => ({
  createSupabaseProjectRepository: () => ({
    listForUser: async (userId: string) => { auth.listed.push(userId); auth.order.push('list'); return { success: true, data: [...(auth.example ? [EXAMPLE_ROW] : []), ...(auth.own ? [OWN_ROW] : [])] }; },
    getById: async () => ({ success: true, data: null }),
    delete: async () => ({ success: true }),
  }),
}));
vi.mock('../persistence/supabase/branch-repository.js', () => ({ createSupabaseBranchRepository: () => ({
  listByProject: async () => ({ success: true, data: [{ id: 'b-ex', projectId: 'ex-1', name: 'main', isPrimary: true, createdAt: '2026-09-30T00:00:00Z' }] }),
}) }));
vi.mock('../persistence/supabase/graph-repository.js', () => ({ createSupabaseGraphRepository: () => ({
  loadSnapshot: async () => {
    const { createEmptyGraph } = await import('@nodespec/core/utils.js');
    return { success: true, data: { graphData: createEmptyGraph('0a000000-0000-4000-8000-000000000001') } };
  },
}) }));
vi.mock('../ui/hooks/useTimeInApp.js', () => ({ useTimeInApp: () => {} }));
vi.mock('../ui/context/index.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ServiceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../ui/index.js', () => ({ GraphEditor: (p: { projectId?: string; projectName?: string }) => <div data-testid="editor" data-project={p.projectId}>{p.projectName}</div> }));
vi.mock('../ui/components/panels/ProjectCreatePopup.js', () => ({ ProjectCreatePopup: () => <div data-testid="first-project">Name your first project</div> }));
vi.mock('../ui/components/auth/index.js', () => ({
  ResetPasswordPage: () => null,
  AuthLandingPage: ({ onSignIn, onVerifyMfa }: { onSignIn: (e: string, p: string) => Promise<{ mfaRequired?: boolean; factorId?: string } | void>; onVerifyMfa: (f: string, c: string) => Promise<void> }) => (
    <div data-testid="landing">
      <button onClick={() => { void onSignIn('new@acme.test', 'pw'); }}>Sign in</button>
      <button onClick={() => { void onVerifyMfa('factor-1', '123456'); }}>Verify code</button>
    </div>
  ),
}));

const { default: App } = await import('../App.js');

const settle = async () => { for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  auth.session = null; auth.listeners.length = 0; auth.secondFactor = false; auth.verified = false; auth.listed.length = 0;
  auth.example = null; auth.order.length = 0; auth.own = false;
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => cleanup());

describe('a new account reaches its first project on sign-in', () => {
  it('a password sign-in with no second factor lands on the first-project screen, no refocus needed', async () => {
    const { getByRole, findByTestId, queryByText } = render(<App />);
    await settle();
    fireEvent.click(getByRole('button', { name: 'Sign in' }));
    await settle();
    expect(await findByTestId('first-project')).toBeTruthy();
    expect(queryByText('Loading project...')).toBeNull();
    expect(auth.listed).toEqual(['user-new']);
    expect(window.location.pathname).toBe('/app');
  });

  it('with a second factor: nothing loads until the code is verified, then the first-project screen', async () => {
    auth.secondFactor = true;
    const { getByRole, findByTestId, queryByTestId, getByTestId } = render(<App />);
    await settle();
    fireEvent.click(getByRole('button', { name: 'Sign in' }));
    await settle();
    expect(getByTestId('landing')).toBeTruthy();
    expect(queryByTestId('first-project')).toBeNull();
    expect(auth.listed).toEqual([]);
    fireEvent.click(getByRole('button', { name: 'Verify code' }));
    await settle();
    expect(await findByTestId('first-project')).toBeTruthy();
    expect(auth.listed).toEqual(['user-new']);
  });
});

// AJ.6 (owner 2026-09-30): every account has an example project, made on the
// first sign-in; a new account lands in it (the walkthrough then runs over it).
describe('a new account lands in its example project', () => {
  it('the app asks for the example before it lists the projects, and opens it', async () => {
    auth.example = 'ex-1';
    const { getByRole, findByTestId, queryByTestId } = render(<App />);
    await settle();
    fireEvent.click(getByRole('button', { name: 'Sign in' }));
    await settle();
    const editor = await findByTestId('editor');
    expect(editor.getAttribute('data-project')).toBe('ex-1');
    expect(editor.textContent).toBe('Harbor Lane Bakery (example)');
    expect(queryByTestId('first-project')).toBeNull();
    expect(auth.order.filter((o) => o === 'rpc:ensure_example_project' || o === 'list').slice(0, 2)).toEqual(['rpc:ensure_example_project', 'list']);
    expect(localStorage.getItem('specgraph_current_project')).toBe('ex-1');
    // every gate on the page knows it is the example before it draws: nothing asks again
    const { readProjectExample } = await import('../ui/hooks/useProjectFeatureGate.js');
    expect(await readProjectExample('ex-1')).toBe(true);
    expect(auth.order).not.toContain('rpc:is_example_project');
  });

  it('an existing account with a project of its own opens that project, not the newer example', async () => {
    auth.example = 'ex-1';
    auth.own = true;
    const { getByRole, findByTestId } = render(<App />);
    await settle();
    fireEvent.click(getByRole('button', { name: 'Sign in' }));
    await settle();
    expect((await findByTestId('editor')).getAttribute('data-project')).toBe('own-1');
  });

  it('an account whose example was deleted (or an older database) opens as before', async () => {
    const { getByRole, findByTestId } = render(<App />);
    await settle();
    fireEvent.click(getByRole('button', { name: 'Sign in' }));
    await settle();
    expect(await findByTestId('first-project')).toBeTruthy();
    expect(auth.order).toContain('rpc:ensure_example_project');
  });
});

