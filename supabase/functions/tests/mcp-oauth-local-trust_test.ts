// MCP OAuth — OSS/local single-user trust lane (owner ruling 2026-09-01).
// A community container on the user's own machine kept failing the bridge
// handshake: mcp-remote mints fresh PKCE state per launch, so a consent
// round-trip completed from a log-dived URL often answered a listener that
// no longer existed. With MCP_LOCAL_TRUST=true the authorize step approves
// itself for the container's sole account — instantly, no window to lose.
// These pins hold the lane's fail-closed shape and prove hosted never enters it.
import { assert } from './helpers.ts';
import { isLoopbackRedirect } from '../mcp-server/oauth.ts';

const src = await Deno.readTextFile(new URL('../mcp-server/oauth.ts', import.meta.url));

Deno.test('loopback gate: the code can only land on a listener on the connecting machine', () => {
  assert(isLoopbackRedirect('http://localhost:3334/oauth/callback'), 'mcp-remote default shape');
  assert(isLoopbackRedirect('http://127.0.0.1:12345/callback'), 'ipv4 loopback');
  assert(isLoopbackRedirect('https://localhost/cb'), 'https loopback fine');
  assert(!isLoopbackRedirect('https://example.com/cb'), 'remote host refused');
  assert(!isLoopbackRedirect('http://localhost.evil.example/cb'), 'prefix-spoof refused');
  assert(!isLoopbackRedirect('http://192.168.1.20/cb'), 'LAN address refused');
  assert(!isLoopbackRedirect('myapp://localhost/cb'), 'non-http scheme refused');
  assert(!isLoopbackRedirect('not a url'), 'garbage refused');
});

Deno.test('trust lane: five fail-closed gates, hosted short-circuits on the very first', () => {
  const start = src.indexOf('async function tryLocalTrustAuthorization');
  assert(start > -1, 'lane exists');
  const fn = src.slice(start, src.indexOf('export function handleOAuthResume'));
  // Order matters: a hosted deployment must return before any env read,
  // and every later guard falls through to the real consent page (null).
  const order = [
    'if (!isSelfHosted()) return null;',
    "Deno.env.get('MCP_LOCAL_TRUST')",
    'if (!isLoopbackRedirect(redirectUri)) return null;',
    'listUsers({ page: 1, perPage: 2 })',
    'data.users.length !== 1) return null;',
    "=== 'verified')) return null;",
    'mintCodeAndRedirect(',
  ];
  let at = -1;
  for (const needle of order) {
    const i = fn.indexOf(needle);
    assert(i > at, `gate out of order or missing: ${needle}`);
    at = i;
  }
});

Deno.test('trust lane never invents itself: explicit env opt-in, exact value', () => {
  assert(src.includes("(Deno.env.get('MCP_LOCAL_TRUST') || '').toLowerCase() !== 'true') return null;"),
    'anything but the literal true keeps the sign-in flow');
});

Deno.test('authorize flow order: session token first, trust lane second, consent page is the fall-through', () => {
  const get = src.slice(src.indexOf('export async function handleAuthorizeGet'));
  const session = get.indexOf('completeAuthorization(');
  const trust = get.indexOf('await tryLocalTrustAuthorization(');
  const consent = get.indexOf('const consentHtml');
  assert(session > -1 && trust > session && consent > trust,
    'expected session_token completion, then the trust attempt, then the consent page');
  assert(get.includes('if (trusted) return trusted;'), 'null falls through to the unchanged consent page');
});

Deno.test('ONE mint path: session completion and trust lane share mintCodeAndRedirect', () => {
  // A second copy of the code-mint block is how redirect/PKCE drift starts.
  const calls = src.split('await mintCodeAndRedirect(').length - 1;
  assert(calls === 2, `expected exactly 2 mint call sites (session + trust), found ${calls}`);
});

Deno.test('REGRESSION: the authenticated lanes did not weaken', () => {
  // PKCE stays mandatory on GET /authorize (the trust lane rides the same
  // validated params) and at /token for every code, trust-minted included.
  assert(src.includes("'PKCE with S256 is required'"), 'PKCE requirement intact');
  assert(src.includes('PKCE verification failed'), 'token exchange still verifies the challenge');
  // The server-side AAL2 refusal on the session lane stands, and the trust
  // lane refuses any account that enrolled a verified factor.
  assert(src.includes('Multi-factor authentication required'), 'server AAL2 refusal intact');
});
