// MCP OAuth consent — Google sign-in lane (owner-reported 2026-08-29).
// A hosted user who signed up with Google has NO password identity, so the
// email form could never authorize MCP for them. The consent page gains a
// hosted-only "Continue with Google" that rides GoTrue's own implicit flow
// and re-enters the EXISTING session_token completion path — these pins hold
// the new lane's shape AND prove the working password lane did not move.
import { assert } from './helpers.ts';

const src = await Deno.readTextFile(new URL('../mcp-server/oauth.ts', import.meta.url));

Deno.test('google lane: redirect_to is the CONSTANT resume URL — never the consent URL with its query', () => {
  assert(src.includes("provider: 'google'"), 'provider param');
  assert(src.includes("'/auth/v1/authorize?'"), 'GoTrue authorize endpoint');
  // GoTrue matches redirect_to against the allowlist and on ANY mismatch
  // silently falls back to the Site URL: the user gets logged into the web
  // app while the MCP client waits forever (live-caught 2026-08-29 when the
  // consent URL's query string broke matching). Only a constant, query-free
  // URL is safe here.
  assert(src.includes("redirect_to: __params.baseUrl + '/authorize/resume'"), 'constant return URL');
  // The pending request (the consent URL, query and all) rides same-origin
  // storage instead — written to BOTH stores with a freshness timestamp.
  assert(src.includes("sessionStorage.setItem('nodespec_mcp_authreq'"), 'session stash');
  assert(src.includes("localStorage.setItem('nodespec_mcp_authreq'"), 'local stash backup');
  assert(src.includes("window.location.href.split('#')[0]"), 'stash holds the consent URL, fragment stripped');
});

Deno.test('resume trampoline: static, validated, and hands the fragment back to the real consent page', () => {
  assert(src.includes('export function handleOAuthResume'), 'handler exists');
  // Static trampoline: no Supabase client — nothing to validate server-side,
  // the consent page and completeAuthorization re-check everything.
  const fn = src.slice(src.indexOf('export function handleOAuthResume'), src.indexOf('export async function handleAuthorizeGet'));
  assert(!fn.includes('SupabaseClient'), 'trampoline takes no supabase client');
  // Open-redirect guard: the stashed target must be THIS server's consent
  // page, written within 10 minutes; the stash is cleared before use.
  assert(fn.includes("pending.url.indexOf(BASE + '/authorize?') === 0"), 'target locked to own consent page');
  assert(fn.includes('10 * 60 * 1000'), 'stash freshness bound');
  const clearIdx = fn.indexOf("removeItem('nodespec_mcp_authreq')");
  const useIdx = fn.indexOf('window.location.replace(pending.url');
  assert(clearIdx > -1 && useIdx > clearIdx, 'stash cleared before redirecting');
  // The session fragment is forwarded intact — the consent page's existing
  // resume script (factor check, TOTP, completion) takes over from there.
  assert(fn.includes('pending.url + window.location.hash'), 'fragment forwarded to consent page');
  assert(fn.includes("'Cache-Control': 'no-store'"), 'resume page is never cached');
});

Deno.test('resume trampoline: routed at /authorize/resume without touching the /authorize contract', async () => {
  const router = await Deno.readTextFile(new URL('../mcp-server/index.ts', import.meta.url));
  assert(router.includes("subPath === '/authorize/resume'"), 'route registered');
  assert(router.includes('handleOAuthResume(req)'), 'route dispatches to the trampoline');
  // The original /authorize dispatch is byte-identical in shape.
  assert(router.includes("subPath === '/authorize'"), '/authorize route intact');
});

Deno.test('google lane: fragment resume strips tokens from the address bar before anything else', () => {
  assert(src.includes("indexOf('access_token=')"), 'fragment detection');
  const stripIdx = src.indexOf("history.replaceState(null, '', window.location.pathname + window.location.search)");
  assert(stripIdx > -1, 'token stripped via replaceState');
  // Strip happens BEFORE proceedWithSession runs in resumeFromProvider.
  const resumeIdx = src.indexOf('async function resumeFromProvider');
  const proceedCallIdx = src.indexOf('await proceedWithSession(accessToken, btn)', resumeIdx);
  const stripInResume = src.indexOf('history.replaceState', resumeIdx);
  assert(stripInResume > resumeIdx && stripInResume < proceedCallIdx, 'strip precedes session use');
});

Deno.test('both lanes converge on ONE factor-check path (fail-closed, then TOTP or complete)', () => {
  // The password grant and the Google resume must share proceedWithSession —
  // a second copy of the factor check is how fail-open regressions start.
  const occurrences = src.split('await proceedWithSession(').length - 1;
  assert(occurrences === 2, `expected exactly 2 call sites (password + resume), found ${occurrences}`);
  assert(src.includes('Could not check two-factor status'), 'fail-closed message intact');
  assert(!src.includes('if (factorsResp.ok) {'), 'the fail-open branch shape must not return');
});

Deno.test('google lane: hidden required inputs cannot block the MFA submit', () => {
  // Google arrivals have empty email/password; a hidden required field makes
  // the browser refuse the TOTP form submit with no visible error.
  assert(src.includes("document.getElementById('email').required = false"), 'email required cleared');
  assert(src.includes("document.getElementById('password').required = false"), 'password required cleared');
});

Deno.test('google button is HOSTED-only: gated on !isSelfHosted, hidden markup by default', () => {
  assert(src.includes('googleEnabled: !isSelfHosted()'), 'render flag from deployment module');
  assert(src.includes('if (__params.googleEnabled)'), 'client reveal is gated');
  assert(src.includes('.btn-google { display: none;'), 'markup ships hidden');
});

Deno.test('offline-first: consent form enables when Turnstile never loads (server stays the enforcer)', () => {
  // An offline community container serves the consent page fine, but the
  // Turnstile script comes from Cloudflare — unreachable offline. The old
  // retry loop spun forever with the submit button disabled, so offline
  // users could never finish MCP sign-in (owner ruling 2026-08-31). After
  // bounded attempts the form enables with no captcha token; a deployment
  // that enforces captcha still rejects server-side.
  assert(src.includes('__turnstileAttempts++ < 50'), 'bounded retry, not an infinite spin');
  const giveUp = src.slice(src.indexOf('__turnstileAttempts++ < 50'));
  assert(giveUp.includes("document.getElementById('submitBtn').disabled = false"), 'form enables on give-up');
  assert(giveUp.includes("widget.style.display = 'none'"), 'dead widget hidden');
});

Deno.test('REGRESSION: the working password lane and the server contract did not move', () => {
  // Password grant with captcha still present, verbatim endpoint.
  assert(src.includes("'/auth/v1/token?grant_type=password'"), 'password grant intact');
  assert(src.includes('gotrue_meta_security'), 'captcha still attached to password grant');
  // The completion redirect still carries the same seven params.
  for (const p of ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'session_token']) {
    assert(src.includes(`${p}:`), `completion param ${p} intact`);
  }
  // Server-side: PKCE stays mandatory on GET /authorize (the Google return
  // trip re-renders through this same validation) and the AAL2 gate stands.
  assert(src.includes("'PKCE with S256 is required'"), 'PKCE requirement intact');
  assert(src.includes('Multi-factor authentication required'), 'server AAL2 refusal intact');
});
