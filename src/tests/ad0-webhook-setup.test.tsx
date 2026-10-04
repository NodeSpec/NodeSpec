// @vitest-environment jsdom
//
// V3 AD.0 (owner 2026-09-24): NodeSpec shows the webhook's URL and secret and
// the person adds them in GitHub or GitLab; NodeSpec never registers the
// webhook through the provider API. The server returns the secret to the owner
// on every save (save-git-integration); these tests hold the app's half: the
// service turns it into the URL the provider posts to, and the Git panel shows
// exactly the fields each provider asks for.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { GitService } from '../ui/services/GitService.js';
import { WebhookSetupNote } from '../ui/components/panels/GitIntegrationModal.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function serviceReturning(response: Record<string, unknown>) {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');
  const service = new GitService({} as never);
  const call = vi.spyOn(GitService.prototype as never, 'callFunction' as never).mockResolvedValue(response as never);
  return { service, call };
}

const CONFIG = { provider: 'github', repoOwner: 'acme', repoName: 'store', defaultBranch: 'main', accessToken: 'tok' };

describe('AD.0: the save carries the webhook to add', () => {
  it('builds the delivery URL from the integration id and passes the secret through', async () => {
    const { service } = serviceReturning({
      anchorAdopt: { detected: false },
      webhook: { integrationId: 'int 1', secret: 'a'.repeat(64), created: true },
    });
    const result = await service.saveIntegration('proj-1', CONFIG);
    expect(result.webhook).toEqual({
      url: 'https://abc.supabase.co/functions/v1/git-webhook?integration_id=int%201',
      secret: 'a'.repeat(64),
      created: true,
    });
  });

  it('says when the secret is the one already on file', async () => {
    const { service } = serviceReturning({ webhook: { integrationId: 'int-1', secret: 'kept', created: false } });
    expect((await service.saveIntegration('proj-1', CONFIG)).webhook?.created).toBe(false);
  });

  it('carries no webhook when the server returned none', async () => {
    const { service } = serviceReturning({ anchorAdopt: { detected: false } });
    expect((await service.saveIntegration('proj-1', CONFIG)).webhook).toBeUndefined();
  });
});

describe('AD.0: the Git panel shows what to enter', () => {
  const webhook = { url: 'https://abc.supabase.co/functions/v1/git-webhook?integration_id=int-1', secret: 'f00d'.repeat(16), created: true };

  it('GitHub: payload URL, content type, secret, the push event', () => {
    const { getByTestId } = render(<WebhookSetupNote provider="github" webhook={webhook} />);
    const text = getByTestId('webhook-setup').textContent ?? '';
    for (const part of ['Add a webhook for pushes', 'In GitHub', 'Payload URL', webhook.url, 'application/json', 'Secret', webhook.secret, 'Just the push event']) {
      expect(text).toContain(part);
    }
    expect(text).toContain('refuses any delivery without this secret');
  });

  it('GitLab: URL, secret token, push events', () => {
    const { getByTestId } = render(<WebhookSetupNote provider="gitlab" webhook={webhook} />);
    const text = getByTestId('webhook-setup').textContent ?? '';
    for (const part of ['In GitLab', 'URL', 'Secret token', webhook.secret, 'Push events']) expect(text).toContain(part);
    expect(text).not.toContain('Payload URL');
  });

  it('a kept secret says there is nothing to change if the webhook is already added', () => {
    const { getByTestId } = render(<WebhookSetupNote provider="github" webhook={{ ...webhook, created: false }} />);
    const text = getByTestId('webhook-setup').textContent ?? '';
    expect(text).toContain('Webhook for pushes');
    expect(text).toContain('If you already added the webhook, there is nothing to change.');
  });

  it('the copy carries no em or en dash', () => {
    const { getByTestId } = render(<WebhookSetupNote provider="github" webhook={webhook} />);
    expect(getByTestId('webhook-setup').textContent).not.toMatch(/[\u2013\u2014]/);
  });
});
