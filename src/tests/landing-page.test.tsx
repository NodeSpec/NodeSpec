// @vitest-environment jsdom
/**
 * The hosted homepage (owner 2026-10-07: "Implement this exactly on our landing page
 * and ensure anything with login functionality still remains working"). The page is
 * rendered as a visitor gets it and driven by its own buttons: every way in to the
 * account forms still reaches them and still hands the app what it signs in with,
 * the contact and waitlist forms open, the product drawing and the use cases switch,
 * the prices are the pricing page's, and the questions the page answers are the ones
 * its structured data states. A self-hosted build still boots to sign-in with no
 * marketing around it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { deploymentTiers } from '../ui/components/pricing/pricing-data.js';
import { CONTROL, FAQ, HOW, PRICING, START_POINTS, USE_CASES } from '../ui/components/auth/landing/landing-content.js';

// Signed out, with nothing stored: the contact and waitlist forms read the session on mount.
vi.mock('../persistence/supabase/client.js', () => {
  const empty = Promise.resolve({ data: null, error: null });
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'eq', 'order', 'limit', 'insert']) query[m] = () => query;
  query.then = (resolve: (v: unknown) => unknown) => empty.then(resolve);
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: null }) }, from: () => query };
  return { getSupabaseClient: () => client };
});

// The captcha passes the moment it renders, so a submit carries its token.
vi.mock('@marsidev/react-turnstile', async () => {
  const React = await import('react');
  return {
    Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => {
      React.useEffect(() => { onSuccess('captcha-token'); }, []);
      return null;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = ReturnType<typeof vi.fn<any[], any>>;
type Handlers = Record<'onSignIn' | 'onSignUp' | 'onVerifyMfa' | 'onOAuthSignIn' | 'onPasswordReset' | 'onOauthMfaComplete', Fn>;

async function landing(edition: 'hosted' | '' | 'enterprise', opts: { path?: string; oauthMfaFactorId?: string; handlers?: Partial<Handlers> } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.resetModules();
  vi.stubEnv('VITE_NODESPEC_EDITION', edition);
  const { AuthLandingPage } = await import('../ui/components/auth/AuthLandingPage.js');
  const h: Handlers = {
    onSignIn: vi.fn(async () => undefined),
    onSignUp: vi.fn(async () => undefined),
    onVerifyMfa: vi.fn(async () => undefined),
    onOAuthSignIn: vi.fn(async () => undefined),
    onPasswordReset: vi.fn(async () => undefined),
    onOauthMfaComplete: vi.fn(),
    ...opts.handlers,
  };
  const props = h as unknown as Omit<Parameters<typeof AuthLandingPage>[0], 'oauthMfaFactorId'>;
  const page = render(
    <MemoryRouter initialEntries={[opts.path ?? '/']}>
      <Routes>
        <Route path="/" element={<AuthLandingPage {...props} oauthMfaFactorId={opts.oauthMfaFactorId ?? null} />} />
      </Routes>
    </MemoryRouter>,
  );
  return { page, h };
}

const field = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!;
const hero = () => document.querySelector<HTMLElement>('.lp-hero')!;
const formCard = () => within(document.querySelector<HTMLElement>('.landing-form-card')!);

describe('the hosted homepage', () => {
  it('is the redesign: one heading for the page, then its sections in order, then the footer', async () => {
    await landing('hosted');
    expect([...document.querySelectorAll('h1')].map((e) => e.textContent)).toEqual(['NodeSpec']);
    expect([...document.querySelectorAll('h2')].map((e) => e.textContent)).toEqual([
      HOW.heading.join(''), USE_CASES.heading, CONTROL.heading, START_POINTS.heading, PRICING.heading, FAQ.heading,
    ]);
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('Get Started Free opens the sign-up form at the top, and Sign In the sign-in form', async () => {
    await landing('hosted');
    expect(screen.queryByText('Create your account')).toBeNull();
    fireEvent.click(within(hero()).getByRole('button', { name: 'Get Started Free' }));
    expect(screen.getByText('Create your account')).toBeTruthy();
    fireEvent.click(within(document.querySelector('.lp-nav-actions')!).getByRole('button', { name: 'Sign In' }));
    expect(screen.getByText('Welcome back')).toBeTruthy();
    // the pricing card's way in reaches the same form
    fireEvent.click(within(document.getElementById('pricing')!).getByRole('button', { name: 'Get Started Free' }));
    expect(screen.getByText('Create your account')).toBeTruthy();
  });

  it('signing in hands over the address, the password and the captcha token; a second factor asks for the code and verifies it', async () => {
    const { h } = await landing('hosted', { handlers: { onSignIn: vi.fn(async () => ({ mfaRequired: true, factorId: 'factor-1' })) } });
    fireEvent.click(within(document.querySelector('.lp-nav-actions')!).getByRole('button', { name: 'Sign In' }));
    fireEvent.change(field('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(field('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(formCard().getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(h.onSignIn).toHaveBeenCalledWith('ada@example.com', 'secret-pass', 'captcha-token'));
    await screen.findByText('Two-factor authentication');
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
    await waitFor(() => expect(h.onVerifyMfa).toHaveBeenCalledWith('factor-1', '123456'));
  });

  it('signing up hands over the details and, when the address needs confirming, says to check the inbox', async () => {
    const { h } = await landing('hosted', { handlers: { onSignUp: vi.fn(async () => 'confirmation_needed' as const) } });
    fireEvent.click(within(hero()).getByRole('button', { name: 'Get Started Free' }));
    fireEvent.change(field('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(field('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    await waitFor(() => expect(h.onSignUp).toHaveBeenCalledWith('new@example.com', 'secret-pass', 'captcha-token'));
    await screen.findByText('Check your inbox');
    expect(screen.getByText('new@example.com')).toBeTruthy();
  });

  it('a forgotten password sends the reset link, and Google signs in with Google', async () => {
    const { h } = await landing('hosted');
    fireEvent.click(within(document.querySelector('.lp-nav-actions')!).getByRole('button', { name: 'Sign In' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(h.onOAuthSignIn).toHaveBeenCalledWith('google'));
    fireEvent.click(screen.getByText('Forgot password?'));
    fireEvent.change(field('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(h.onPasswordReset).toHaveBeenCalledWith('ada@example.com'));
    await screen.findByText('Check your email for a password reset link.');
  });

  it('a ?plan= link lands on the sign-up form, and a second factor after Google lands on the code', async () => {
    await landing('hosted', { path: '/?plan=indie' });
    expect(screen.getByText('Create your account')).toBeTruthy();
    cleanup();
    const { h } = await landing('hosted', { oauthMfaFactorId: 'factor-9' });
    await screen.findByText('Two-factor authentication');
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
    await waitFor(() => expect(h.onVerifyMfa).toHaveBeenCalledWith('factor-9', '654321'));
    await waitFor(() => expect(h.onOauthMfaComplete).toHaveBeenCalled());
  });

  it('?signup opens the sign-up form and ?signin the sign-in form, the links the Claude sign-in page and the templates use', async () => {
    for (const [path, heading] of [
      ['/?signup=claude', 'Create your account'],
      ['/?signup=templates', 'Create your account'],
      ['/?signin=claude', 'Welcome back'],
    ]) {
      await landing('hosted', { path });
      expect(screen.getByText(heading)).toBeTruthy();
      expect(document.querySelector('.landing-form-card')).toBeTruthy();
      cleanup();
    }
    // with neither, the managed homepage opens on its hero
    await landing('hosted', { path: '/' });
    expect(document.querySelector('.landing-form-card')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'NodeSpec' })).toBeTruthy();
  });

  it('Talk to Us opens the enterprise inquiry, and Join the waitlist the Team waitlist', async () => {
    await landing('hosted');
    expect(screen.queryByText('Enterprise Inquiry')).toBeNull();
    fireEvent.click(within(hero()).getByRole('button', { name: 'Talk to Us' }));
    expect(screen.getByText('Enterprise Inquiry')).toBeTruthy();
    expect(screen.queryByText('Join the Team waitlist')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }));
    expect(screen.getByText('Join the Team waitlist')).toBeTruthy();
  });

  it('the chips switch the product drawing between Workflows, Requirements and Architecture', async () => {
    await landing('hosted');
    const chips = within(screen.getByRole('group', { name: 'Product view' }));
    const drawing = () => document.querySelector('.lp-frame-desktop')!.getAttribute('aria-label');
    expect(drawing()).toMatch(/^NodeSpec Work, Workflows/);
    expect(chips.getByRole('button', { name: 'Workflows' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chips.getByRole('button', { name: 'Requirements' }));
    expect(drawing()).toMatch(/^NodeSpec Work, Requirements/);
    expect(chips.getByRole('button', { name: 'Requirements' }).getAttribute('aria-pressed')).toBe('true');
    expect(chips.getByRole('button', { name: 'Workflows' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chips.getByRole('button', { name: 'Architecture' }));
    expect(drawing()).toMatch(/^NodeSpec Architecture/);
    // the phone-sized app has no Architecture view: it keeps showing Workflows
    expect(document.querySelector('.lp-frame-phone')!.getAttribute('aria-label')).toMatch(/^NodeSpec Work, Workflows/);
  });

  it('the use cases switch between Developer and Strategic', async () => {
    await landing('hosted');
    const section = within(document.getElementById('use-cases')!);
    expect(section.getByText(USE_CASES.developer[0].title)).toBeTruthy();
    expect(section.queryByText('Back-office IT')).toBeNull();
    fireEvent.click(section.getByRole('button', { name: 'Strategic' }));
    expect(section.getByText('Back-office IT')).toBeTruthy();
    expect(section.getByText(USE_CASES.strategic[0].cases[0].title)).toBeTruthy();
    expect(section.queryByText(USE_CASES.developer[0].title)).toBeNull();
    expect(section.getByRole('button', { name: 'Strategic' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('every link is a page a crawler can follow or a section of this page that exists', async () => {
    await landing('hosted');
    const read = () => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);
    const developer = read();
    fireEvent.click(within(document.getElementById('use-cases')!).getByRole('button', { name: 'Strategic' }));
    const hrefs = [...developer, ...read()];
    for (const page of ['/templates', '/docs/mcp', '/blog', '/pricing', '/government', '/privacy', '/terms', '/templates/nextjs-supabase-stripe-saas']) {
      expect(hrefs, page).toContain(page);
    }
    const anchors = [...new Set(hrefs.filter((h) => h.startsWith('#')))];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(document.getElementById(anchor.slice(1)), anchor).not.toBeNull();
  });

  it('the prices are the pricing page\'s', async () => {
    await landing('hosted');
    const tier = (id: string) => deploymentTiers.find((t) => t.id === id)!;
    const card = (id: string) => document.querySelector(`[data-plan="${id}"]`)!.textContent!;
    expect(card('indie')).toContain(tier('indie').price.replace('/mo', ''));
    expect(card('indie')).toContain(`or ${/\$\d+/.exec(tier('indie').priceNote!)![0]} a year`);
    expect(card('team')).toContain(tier('team').price.replace('/user/mo', ''));
  });

  it('the questions the page answers are the ones its structured data states, word for word', async () => {
    await landing('hosted');
    const shown = [...document.querySelectorAll('#faq details')].map((d) => ({
      q: d.querySelector('summary h3')!.textContent, a: d.querySelector('p')!.textContent,
    }));
    expect(shown.length).toBe(FAQ.items.length);
    const blocks = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
    const faq = blocks.find((b) => b['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((e: { name: string; acceptedAnswer: { text: string } }) => ({ q: e.name, a: e.acceptedAnswer.text }))).toEqual(shown);
    // the first answer is open; the others open on a click
    expect((document.querySelectorAll('#faq details')[0] as HTMLDetailsElement).open).toBe(true);
    expect((document.querySelectorAll('#faq details')[1] as HTMLDetailsElement).open).toBe(false);
  });
});

describe('a self-hosted build', () => {
  it('boots to sign-in with its edition, no marketing around it and nothing for search engines', async () => {
    const { h } = await landing('');
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText('OSS Community')).toBeTruthy();
    for (const id of ['how', 'use-cases', 'control', 'pricing', 'faq']) expect(document.getElementById(id), id).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(document.querySelector('h1')).toBeNull();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    const nav = [...document.querySelectorAll('.lp-nav-links a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(nav).toEqual([['MCP Docs', '/docs/mcp']]);
    // and signing in still works there, without a captcha unless the install sets one
    fireEvent.change(field('Email'), { target: { value: 'ops@example.com' } });
    fireEvent.change(field('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(formCard().getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(h.onSignIn).toHaveBeenCalledWith('ops@example.com', 'secret-pass', undefined));
  });

  it('Enterprise keeps the template gallery in its nav', async () => {
    await landing('enterprise');
    expect(screen.getByText('Enterprise', { selector: '.lp-edition' })).toBeTruthy();
    const nav = [...document.querySelectorAll('.lp-nav-links a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(nav).toEqual([['Browse Templates', '/templates'], ['MCP Docs', '/docs/mcp']]);
    expect(document.getElementById('pricing')).toBeNull();
  });
});
