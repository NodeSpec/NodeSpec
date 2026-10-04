// @vitest-environment jsdom
//
// Connect a repository: the token is the only thing a person types
// (owner ruling 2026-09-21).
//
// The form used to open with three free-text boxes — owner, repository,
// branch — and put the access token last, with two optional "browse"
// buttons bolted beside the boxes. The field that could answer the three
// questions sat below them. These tests drive the real SetupView: the
// token names the owners, an owner names its repositories, a repository
// names its branches, the API base URL sits at the bottom, and manual
// entry survives for a token that lists nothing.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { SetupView } from '../ui/components/panels/GitIntegrationModal.js';

type Repo = { owner: string; name: string; fullName: string; defaultBranch: string; isPrivate: boolean };

const REPOS: Repo[] = [
  { owner: 'acme', name: 'storefront', fullName: 'acme/storefront', defaultBranch: 'main', isPrivate: false },
  { owner: 'acme', name: 'billing', fullName: 'acme/billing', defaultBranch: 'trunk', isPrivate: true },
  { owner: 'benjamin', name: 'scratch', fullName: 'benjamin/scratch', defaultBranch: 'master', isPrivate: true },
];

function stubService(over: Partial<{ repos: Repo[]; branches: string[]; defaultBranch: string | null; reposThrow: string }> = {}) {
  const listRemoteRepositories = vi.fn(async () => {
    if (over.reposThrow) throw new Error(over.reposThrow);
    return over.repos ?? REPOS;
  });
  const listRemoteBranches = vi.fn(async () => ({
    branches: over.branches ?? ['main', 'release', 'spike'],
    defaultBranch: over.defaultBranch === undefined ? 'main' : over.defaultBranch,
  }));
  return { listRemoteRepositories, listRemoteBranches } as never;
}

/** The modal's own state, so the form behaves as it does in the app. */
function Harness({ service, onSave = vi.fn(), hasExisting = false, seed }: { service: never; onSave?: () => void; hasExisting?: boolean; seed?: { owner: string; name: string; branch: string } }) {
  const [provider, setProvider] = useState<'github' | 'gitlab'>('github');
  const [repoOwner, setRepoOwner] = useState(seed?.owner ?? '');
  const [repoName, setRepoName] = useState(seed?.name ?? '');
  const [defaultBranch, setDefaultBranch] = useState(seed?.branch ?? 'main');
  const [accessToken, setAccessToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  return (
    <SetupView
      provider={provider} onProviderChange={setProvider}
      repoOwner={repoOwner} onRepoOwnerChange={setRepoOwner}
      repoName={repoName} onRepoNameChange={setRepoName}
      defaultBranch={defaultBranch} onDefaultBranchChange={setDefaultBranch}
      accessToken={accessToken} onAccessTokenChange={setAccessToken}
      baseUrl={baseUrl} onBaseUrlChange={setBaseUrl}
      saving={false} hasExisting={hasExisting} onSave={onSave}
      gitService={service}
    />
  );
}

const optionsOf = (el: HTMLElement) => [...el.querySelectorAll('option')].filter((o) => !o.disabled).map((o) => o.value);
const typeToken = (getByTestId: (id: string) => HTMLElement, token = 'ghp_live') =>
  fireEvent.change(getByTestId('git-token'), { target: { value: token } });
const connect = async (getByTestId: (id: string) => HTMLElement, token = 'ghp_live') => {
  typeToken(getByTestId, token);
  await act(async () => { fireEvent.click(getByTestId('git-connect')); });
};

describe('the token is the first and only thing typed', () => {
  it('before a token there is nothing to fill in, and Connect is shut', () => {
    const { getByTestId, queryByTestId } = render(<Harness service={stubService()} />);
    expect((getByTestId('git-connect') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('git-awaiting-token').textContent).toContain('Connect above and this fills itself');
    for (const gone of ['git-owner-select', 'git-repo-select', 'git-owner-input', 'git-repo-input']) {
      expect(queryByTestId(gone), gone).toBeNull();
    }
    // the token, the base URL and Save are the only controls that exist yet
    expect(getByTestId('git-token')).toBeTruthy();
    expect(getByTestId('git-base-url')).toBeTruthy();
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a token opens Connect; connecting reads the repositories with that token', async () => {
    const service = stubService();
    const { getByTestId } = render(<Harness service={service} />);
    typeToken(getByTestId);
    expect((getByTestId('git-connect') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(getByTestId('git-connect')); });
    expect((service as unknown as { listRemoteRepositories: ReturnType<typeof vi.fn> }).listRemoteRepositories)
      .toHaveBeenCalledWith('github', 'ghp_live', undefined);
  });

  it('the API base URL rides the read, and sits at the bottom of the form', async () => {
    const service = stubService();
    const { getByTestId, container } = render(<Harness service={service} />);
    fireEvent.change(getByTestId('git-base-url'), { target: { value: 'https://ghe.example.com/api/v3' } });
    await connect(getByTestId);
    expect((service as unknown as { listRemoteRepositories: ReturnType<typeof vi.fn> }).listRemoteRepositories)
      .toHaveBeenCalledWith('github', 'ghp_live', 'https://ghe.example.com/api/v3');
    // order on the page: token, then the three answers, then the base URL
    const order = [...container.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
    expect(order.indexOf('git-token')).toBeLessThan(order.indexOf('git-owner-select'));
    expect(order.indexOf('git-owner-select')).toBeLessThan(order.indexOf('git-repo-select'));
    expect(order.indexOf('git-repo-select')).toBeLessThan(order.indexOf('git-branch-select'));
    expect(order.indexOf('git-branch-select')).toBeLessThan(order.indexOf('git-base-url'));
    expect(order.indexOf('git-base-url')).toBeLessThan(order.indexOf('git-save'));
  });
});

describe('the token names the owner, the owner names the repository, the repository names the branch', () => {
  it('several owners are offered and nothing is chosen for the person', async () => {
    const { getByTestId } = render(<Harness service={stubService()} />);
    await connect(getByTestId);
    const owner = getByTestId('git-owner-select') as HTMLSelectElement;
    expect(optionsOf(owner)).toEqual(['acme', 'benjamin']);
    expect(owner.value).toBe('');
    // the repository question waits for its answer
    expect((getByTestId('git-repo-select') as HTMLSelectElement).disabled).toBe(true);
    expect(getByTestId('git-repo-select').textContent).toContain('Choose an owner first');
  });

  it('one owner is the ordinary case: it is chosen, so the next question is the repository', async () => {
    const service = stubService({ repos: REPOS.filter((r) => r.owner === 'acme') });
    const { getByTestId } = render(<Harness service={service} />);
    await connect(getByTestId);
    await waitFor(() => expect((getByTestId('git-owner-select') as HTMLSelectElement).value).toBe('acme'));
    const repo = getByTestId('git-repo-select') as HTMLSelectElement;
    expect(repo.disabled).toBe(false);
    expect(optionsOf(repo)).toEqual(['billing', 'storefront']);
  });

  it('choosing an owner narrows the repositories to that owner, and the private ones say so', async () => {
    const { getByTestId } = render(<Harness service={stubService()} />);
    await connect(getByTestId);
    fireEvent.change(getByTestId('git-owner-select'), { target: { value: 'acme' } });
    const repo = getByTestId('git-repo-select') as HTMLSelectElement;
    expect(optionsOf(repo)).toEqual(['billing', 'storefront']);
    expect(repo.textContent).toContain('billing (private)');
    expect(repo.textContent).not.toContain('scratch');
    fireEvent.change(getByTestId('git-owner-select'), { target: { value: 'benjamin' } });
    expect(optionsOf(getByTestId('git-repo-select'))).toEqual(['scratch']);
  });

  it('choosing a repository reads ITS branches and preselects the provider default', async () => {
    const service = stubService({ branches: ['trunk', 'main', 'next'], defaultBranch: 'trunk' });
    const { getByTestId } = render(<Harness service={service} />);
    await connect(getByTestId);
    fireEvent.change(getByTestId('git-owner-select'), { target: { value: 'acme' } });
    await act(async () => { fireEvent.change(getByTestId('git-repo-select'), { target: { value: 'billing' } }); });
    expect((service as unknown as { listRemoteBranches: ReturnType<typeof vi.fn> }).listRemoteBranches)
      .toHaveBeenCalledWith('github', 'ghp_live', 'acme', 'billing', undefined);
    await waitFor(() => {
      const branch = getByTestId('git-branch-select') as HTMLSelectElement;
      expect(optionsOf(branch)).toEqual(['trunk', 'main', 'next']);
      expect(branch.value).toBe('trunk');
    });
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('changing the owner clears the repository, so a mismatched pair can never be saved', async () => {
    const { getByTestId } = render(<Harness service={stubService()} />);
    await connect(getByTestId);
    fireEvent.change(getByTestId('git-owner-select'), { target: { value: 'acme' } });
    await act(async () => { fireEvent.change(getByTestId('git-repo-select'), { target: { value: 'billing' } }); });
    await waitFor(() => expect((getByTestId('git-repo-select') as HTMLSelectElement).value).toBe('billing'));
    fireEvent.change(getByTestId('git-owner-select'), { target: { value: 'benjamin' } });
    expect((getByTestId('git-repo-select') as HTMLSelectElement).value).toBe('');
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('GitLab is the same form', () => {
  it('the provider switch re-reads with the GitLab token and its own placeholders', async () => {
    const service = stubService({ repos: [{ owner: 'group/sub', name: 'service', fullName: 'group/sub/service', defaultBranch: 'main', isPrivate: true }] });
    const { getByTestId, getByText } = render(<Harness service={service} />);
    fireEvent.click(getByText('GitLab'));
    expect((getByTestId('git-token') as HTMLInputElement).placeholder).toBe('glpat_...');
    expect((getByTestId('git-base-url') as HTMLInputElement).placeholder).toBe('https://gitlab.example.com/api/v4');
    await connect(getByTestId, 'glpat_live');
    expect((service as unknown as { listRemoteRepositories: ReturnType<typeof vi.fn> }).listRemoteRepositories)
      .toHaveBeenCalledWith('gitlab', 'glpat_live', undefined);
    // a nested namespace is an owner like any other
    await waitFor(() => expect((getByTestId('git-owner-select') as HTMLSelectElement).value).toBe('group/sub'));
    expect(optionsOf(getByTestId('git-repo-select'))).toEqual(['service']);
  });

  it('switching providers throws away the other provider\'s answers', async () => {
    const { getByTestId, queryByTestId, getByText } = render(<Harness service={stubService()} />);
    await connect(getByTestId);
    expect(queryByTestId('git-owner-select')).toBeTruthy();
    fireEvent.click(getByText('GitLab'));
    expect(queryByTestId('git-owner-select')).toBeNull();
    expect(getByTestId('git-awaiting-token')).toBeTruthy();
  });
});

describe('a person is never stuck behind a failed read', () => {
  it('a token that lists nothing says why and opens the manual fields', async () => {
    const { getByTestId } = render(<Harness service={stubService({ repos: [] })} />);
    await connect(getByTestId);
    await waitFor(() => expect(getByTestId('git-browse-error').textContent).toContain('sees no repositories'));
    expect(getByTestId('git-browse-error').textContent).toContain('fine-grained token');
    expect(getByTestId('git-owner-input')).toBeTruthy();
    expect(getByTestId('git-repo-input')).toBeTruthy();
  });

  it('a provider that refuses says so, and the by-hand door is still open', async () => {
    const { getByTestId, queryByTestId } = render(<Harness service={stubService({ reposThrow: 'GitHub repository list failed (401)' })} />);
    await connect(getByTestId);
    await waitFor(() => expect(getByTestId('git-browse-error').textContent).toContain('401'));
    expect(queryByTestId('git-awaiting-token')).toBeTruthy();
    fireEvent.click(getByTestId('git-manual-toggle'));
    expect(getByTestId('git-owner-input')).toBeTruthy();
  });

  it('by hand: owner, repository and a branch read on demand, and Save opens', async () => {
    const service = stubService();
    const { getByTestId } = render(<Harness service={service} />);
    typeToken(getByTestId);
    fireEvent.click(getByTestId('git-manual-toggle'));
    fireEvent.change(getByTestId('git-owner-input'), { target: { value: 'acme' } });
    fireEvent.change(getByTestId('git-repo-input'), { target: { value: 'unlisted' } });
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(getByTestId('git-branch-input')); });
    expect((getByTestId('git-branch-input') as HTMLInputElement).value).toBe('main');
  });

  it('editing the token or the base URL after a read throws the stale answers away', async () => {
    const { getByTestId, queryByTestId } = render(<Harness service={stubService()} />);
    await connect(getByTestId);
    expect(queryByTestId('git-owner-select')).toBeTruthy();
    fireEvent.change(getByTestId('git-token'), { target: { value: 'ghp_other' } });
    expect(queryByTestId('git-owner-select')).toBeNull();
    await connect(getByTestId, 'ghp_again');
    expect(queryByTestId('git-owner-select')).toBeTruthy();
    fireEvent.change(getByTestId('git-base-url'), { target: { value: 'https://ghe.example.com/api/v3' } });
    expect(queryByTestId('git-owner-select')).toBeNull();
  });

  it('an existing integration asks for a NEW token, and still asks for it first', () => {
    const { getByTestId, container } = render(<Harness service={stubService()} hasExisting />);
    expect(container.textContent).toContain('New access token');
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Settings on a connected project SHOWS the repository it is connected to, not the placeholder', () => {
    // The modal seeds the form from the stored integration; hiding it behind
    // "connect first" would hide what is connected behind a step already taken.
    const { getByTestId, queryByTestId } = render(
      <Harness service={stubService()} hasExisting seed={{ owner: 'acme', name: 'storefront', branch: 'trunk' }} />,
    );
    expect(queryByTestId('git-awaiting-token')).toBeNull();
    expect((getByTestId('git-owner-input') as HTMLInputElement).value).toBe('acme');
    expect((getByTestId('git-repo-input') as HTMLInputElement).value).toBe('storefront');
    expect((getByTestId('git-branch-input') as HTMLInputElement).value).toBe('trunk');
  });

  it('re-reading with a token that lost the repository clears it, so a stale pair is never saved', async () => {
    // the token now sees only benjamin/scratch; the stored acme/storefront is gone
    const service = stubService({ repos: [REPOS[2]] });
    const { getByTestId } = render(
      <Harness service={service} hasExisting seed={{ owner: 'acme', name: 'storefront', branch: 'trunk' }} />,
    );
    await connect(getByTestId);
    await waitFor(() => expect((getByTestId('git-owner-select') as HTMLSelectElement).value).toBe('benjamin'));
    expect((getByTestId('git-repo-select') as HTMLSelectElement).value).toBe('');
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-reading with a token that still has the repository keeps it', async () => {
    const service = stubService();
    const { getByTestId } = render(
      <Harness service={service} hasExisting seed={{ owner: 'acme', name: 'storefront', branch: 'main' }} />,
    );
    await connect(getByTestId);
    await waitFor(() => expect((getByTestId('git-owner-select') as HTMLSelectElement).value).toBe('acme'));
    expect((getByTestId('git-repo-select') as HTMLSelectElement).value).toBe('storefront');
    expect((getByTestId('git-save') as HTMLButtonElement).disabled).toBe(false);
  });
});
