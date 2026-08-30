// S1-3 chunk 7: the OAuth 2.1 + PKCE authorization surface, moved verbatim from mcp-server/
// index.ts (no logic change) — SENSITIVE (production auth must not drift). Discovery/metadata
// endpoints, dynamic client registration, the authorize page (session login + MFA), and the
// token exchange, plus their PKCE / token / HTML helpers. getOAuthCorsHeaders is also imported
// back by index.ts's router. Edge-safe: type-only SupabaseClient + relative ./shared.ts specifiers.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getBaseUrl, sha256Hex } from "./shared.ts";
import { isSelfHosted } from "../_shared/deployment.ts";

const ALLOWED_SCOPES = new Set(['read', 'write', 'propose']);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function getOAuthCorsHeaders(_req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyPkceChallenge(verifier: string, challenge: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  const computed = base64UrlEncode(hash);
  return computed === challenge;
}

function generateRandomToken(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Read the Authenticator Assurance Level claim from a GoTrue access token.
 *  aal2 means the session cleared a second factor. Decode-only (no signature
 *  check needed): the token was just minted by GoTrue for this same project
 *  and validated by getUser; we only read its already-trusted claim. Returns
 *  null on any malformed input so the caller fails closed. */
export function decodeJwtAal(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // JWT segments are UNPADDED base64url — atob throws on most unpadded
    // lengths, so pad first or every MFA user fails closed at the gate.
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { aal?: string };
    return claims.aal ?? null;
  } catch {
    return null;
  }
}

export function handleOAuthMetadata(req: Request): Response {
  const oauthCors = getOAuthCorsHeaders(req);
  const baseUrl = getBaseUrl();
  const metadata = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["read", "write", "propose"],
    token_endpoint_auth_methods_supported: ["none"],
    registration_endpoint: `${baseUrl}/register`,
    client_id_metadata_document_supported: true,
  };
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { ...oauthCors, 'Content-Type': 'application/json' },
  });
}

export function handleProtectedResourceMetadata(req: Request): Response {
  const oauthCors = getOAuthCorsHeaders(req);
  const baseUrl = getBaseUrl();
  const metadata = {
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ["read", "write", "propose"],
    bearer_methods_supported: ["header"],
  };
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { ...oauthCors, 'Content-Type': 'application/json' },
  });
}

export async function handleClientRegistration(req: Request): Promise<Response> {
  const oauthCors = getOAuthCorsHeaders(req);
  let clientName = 'MCP Client';
  let redirectUris: string[] = [];
  try {
    const body = await req.json();
    if (body.client_name) clientName = String(body.client_name);
    if (Array.isArray(body.redirect_uris)) redirectUris = body.redirect_uris.map(String);
  } catch {}
  const clientId = crypto.randomUUID();
  return new Response(JSON.stringify({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  }), {
    status: 201,
    headers: { ...oauthCors, 'Content-Type': 'application/json' },
  });
}

/** True when a redirect_uri can only ever be received by a listener on the
 *  CONNECTING machine itself — the loopback interface. Exported for tests. */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
      || u.hostname === '[::1]' || u.hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * OSS/local trust lane (owner ruling 2026-09-01): a community container on
 * the user's own machine is a single-user tool, and the full consent
 * round-trip (log-dived authorize URL → email/password → redirect race
 * against mcp-remote's per-launch PKCE state) was failing real users. When
 * the deployment EXPLICITLY opts in via MCP_LOCAL_TRUST=true, /authorize
 * approves itself for the container's sole account and redirects straight
 * back to the client — no form, no window for the bridge to lose state in.
 *
 * Every guard fails CLOSED to the normal consent page (return null):
 *   1. self-hosted only — hosted short-circuits on the first check;
 *   2. MCP_LOCAL_TRUST=true set by the operator (selfhost.env), never a default
 *      the server invents;
 *   3. loopback redirect_uri only — the authorization code can only land on a
 *      listener on the connecting user's own machine, so a remote site's
 *      redirect can never harvest it;
 *   4. EXACTLY one account exists — the moment a second user signs up this is
 *      a shared deployment and everyone signs in for real;
 *   5. that account has no verified MFA factor — a user who enrolled 2FA has
 *      asked for stronger auth and keeps it.
 * PKCE still applies at /token exactly as for every other code.
 */
async function tryLocalTrustAuthorization(
  supabase: SupabaseClient,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  scope: string,
  state: string,
  oauthCors: Record<string, string>,
): Promise<Response | null> {
  if (!isSelfHosted()) return null;
  if ((Deno.env.get('MCP_LOCAL_TRUST') || '').toLowerCase() !== 'true') return null;
  if (!isLoopbackRedirect(redirectUri)) return null;
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 2 });
  if (error || !data?.users || data.users.length !== 1) return null;
  const user = data.users[0];
  const factors = (user as { factors?: Array<{ status?: string }> }).factors ?? [];
  if (factors.some((f) => f?.status === 'verified')) return null;
  return await mintCodeAndRedirect(
    supabase, user.id, clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, state, oauthCors,
  );
}

/**
 * GET /authorize/resume — the constant-URL return leg of the Google consent
 * lane. GoTrue's redirect allowlist falls back to the Site URL on any
 * mismatch (query strings included), so the provider round-trip returns to
 * THIS bare URL and a static trampoline re-enters the real consent page:
 * pending request from same-origin storage, session from the URL fragment
 * (which never reaches a server). No Supabase client, no state, no cookies —
 * the consent page and completeAuthorization re-validate everything.
 */
export function handleOAuthResume(_req: Request): Response {
  const baseUrl = getBaseUrl();
  const resumeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NodeSpec - Completing sign-in</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1419; color: #e6e9ef; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #1a1f2e; border: 1px solid #2a3040; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; text-align: center; }
    .msg { color: #8b95a5; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="msg" id="msg">Completing sign-in&hellip;</div>
  </div>
  <script>
    (function () {
      var BASE = ${JSON.stringify(baseUrl)};
      var raw = null;
      try { raw = sessionStorage.getItem('nodespec_mcp_authreq') || localStorage.getItem('nodespec_mcp_authreq'); } catch (_e) { /* storage unavailable */ }
      try { sessionStorage.removeItem('nodespec_mcp_authreq'); } catch (_e) { /* ignore */ }
      try { localStorage.removeItem('nodespec_mcp_authreq'); } catch (_e) { /* ignore */ }

      var pending = null;
      try { pending = raw && JSON.parse(raw); } catch (_e) { /* corrupt stash */ }

      // Same-origin storage only ever holds what OUR consent page wrote, but
      // validate anyway: the target must be this server's own consent page,
      // written within the last 10 minutes — never an open redirect.
      var valid = pending && typeof pending.url === 'string'
        && pending.url.indexOf(BASE + '/authorize?') === 0
        && typeof pending.ts === 'number'
        && (Date.now() - pending.ts) < 10 * 60 * 1000;

      if (!valid) {
        document.getElementById('msg').innerHTML =
          'Sign-in finished, but the pending connection request was not found in this browser.<br/><br/>' +
          'Return to your MCP client (for example Claude), start the connection again, and choose Google sign-in — it will pick up your session.';
        return;
      }

      // Hand the fragment (session tokens, or a provider error) to the real
      // consent page — its resume script takes it from here.
      window.location.replace(pending.url + window.location.hash);
    })();
  </script>
</body>
</html>`;
  return new Response(resumeHtml, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleAuthorizeGet(req: Request, supabase: SupabaseClient): Promise<Response> {
  const oauthCors = getOAuthCorsHeaders(req);
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';
  const state = url.searchParams.get('state') || '';
  const scope = url.searchParams.get('scope') || 'read write propose';

  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return new Response('PKCE with S256 is required', {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'text/plain' },
    });
  }

  if (!redirectUri) {
    return new Response('redirect_uri is required', {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'text/plain' },
    });
  }

  const validScopes = scope.split(' ').filter((s: string) => ALLOWED_SCOPES.has(s));
  if (validScopes.length === 0) {
    return new Response('Invalid scope requested', {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'text/plain' },
    });
  }
  const sanitizedScope = validScopes.join(' ');

  const sessionToken = url.searchParams.get('session_token');
  if (sessionToken) {
    return await completeAuthorization(
      supabase, sessionToken, clientId, redirectUri, codeChallenge, codeChallengeMethod, sanitizedScope, state, oauthCors
    );
  }

  // OSS/local trust lane — self-approves for an explicitly trusted
  // single-user container; null falls through to the normal consent page.
  const trusted = await tryLocalTrustAuthorization(
    supabase, clientId, redirectUri, codeChallenge, codeChallengeMethod, sanitizedScope, state, oauthCors,
  );
  if (trusted) return trusted;

  const baseUrl = getBaseUrl();
  const scopeBadgesHtml = validScopes.map((s: string) => `<span class="scope-badge">${escapeHtml(s)}</span>`).join('');

  const turnstileSiteKey = Deno.env.get('TURNSTILE_SITE_KEY') || '0x4AAAAAAC35x_nOg9ZE0X0Z';

  const jsParams = JSON.stringify({
    baseUrl,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
    scope: sanitizedScope,
    // The consent page runs in the USER'S BROWSER — it needs the public auth
    // origin, not the runtime-internal SUPABASE_URL (on self-host that is
    // http://kong:8000 and the sign-in fetch dies; live-caught 2026-08-25).
    // Hosted sets no PUBLIC_SUPABASE_URL, so its behavior is unchanged.
    supabaseUrl: Deno.env.get('PUBLIC_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || '',
    supabaseAnonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
    turnstileSiteKey,
    // Google sign-in on the consent page is a HOSTED surface: users who
    // signed up with Google have no password identity, so without this they
    // cannot authorize MCP at all (owner-reported 2026-08-29). Self-hosted
    // stacks keep the exact page they had — the button never renders there.
    googleEnabled: !isSelfHosted(),
  });

  const consentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NodeSpec - Authorize Connection</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1419; color: #e6e9ef; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #1a1f2e; border: 1px solid #2a3040; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; }
    .logo { font-size: 20px; font-weight: 600; color: #e6e9ef; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #8b95a5; margin-bottom: 24px; }
    .section-label { font-size: 12px; font-weight: 500; color: #8b95a5; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    .info-box { background: #141820; border: 1px solid #2a3040; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px; color: #c0c8d4; }
    .scopes { display: flex; gap: 6px; margin-bottom: 20px; flex-wrap: wrap; }
    .scope-badge { font-size: 11px; font-weight: 500; padding: 4px 10px; border-radius: 4px; background: #1e293b; color: #60a5fa; border: 1px solid #2a3f5f; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; font-weight: 500; color: #c0c8d4; margin-bottom: 6px; }
    .form-group input { width: 100%; padding: 10px 12px; font-size: 14px; background: #141820; border: 1px solid #2a3040; border-radius: 6px; color: #e6e9ef; outline: none; }
    .form-group input:focus { border-color: #3b82f6; }
    .btn { width: 100%; padding: 10px; font-size: 14px; font-weight: 500; border: none; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
    .btn-primary { background: #3b82f6; color: white; margin-bottom: 8px; }
    .btn-primary:hover { background: #2563eb; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; color: #8b95a5; border: 1px solid #2a3040; }
    .btn-secondary:hover { background: #1e2433; }
    .btn-google { display: none; background: #ffffff; color: #1f2937; margin-bottom: 4px; align-items: center; justify-content: center; gap: 10px; }
    .btn-google:hover { background: #f3f4f6; }
    .auth-divider { display: none; align-items: center; gap: 12px; margin: 14px 0; color: #5a6373; font-size: 12px; }
    .auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: #2a3040; }
    .error { color: #f87171; font-size: 12px; margin-top: 8px; display: none; }
    .notice { font-size: 11px; color: #6b7585; margin-top: 16px; line-height: 1.5; text-align: center; }
    .turnstile-wrapper { margin-bottom: 16px; min-height: 65px; display: flex; justify-content: center; }
    .mfa-step { display: none; }
    .mfa-step.active { display: block; }
    .login-step { display: block; }
    .login-step.hidden { display: none; }
    .mfa-info { font-size: 13px; color: #c0c8d4; margin-bottom: 16px; }
    .totp-input { text-align: center; font-size: 24px; letter-spacing: 8px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">NodeSpec</div>
    <div class="subtitle">An external agent wants to connect to your projects.</div>

    <div class="section-label">Requested Permissions</div>
    <div class="scopes">
      ${scopeBadgesHtml}
    </div>

    <div class="info-box">
      Sign in with your NodeSpec account to authorize this connection. The agent will be able to access your projects according to the permissions above.
    </div>

    <button type="button" class="btn btn-google" id="googleBtn">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
      Continue with Google
    </button>
    <div class="auth-divider" id="authDivider">or sign in with email</div>

    <form id="authForm">
      <div id="loginStep" class="login-step">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password" />
        </div>
        <div class="turnstile-wrapper">
          <div id="turnstileWidget"></div>
        </div>
      </div>

      <div id="mfaStep" class="mfa-step">
        <div class="mfa-info">Enter the 6-digit code from your authenticator app.</div>
        <div class="form-group">
          <label for="totpCode">Verification Code</label>
          <input type="text" id="totpCode" name="totpCode" class="totp-input" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" />
        </div>
      </div>

      <div id="errorMsg" class="error"></div>
      <button type="submit" class="btn btn-primary" id="submitBtn" disabled>Sign In &amp; Authorize</button>
      <button type="button" class="btn btn-secondary" onclick="window.close()">Cancel</button>
    </form>

    <div class="notice">
      All agent actions go through the standard review workflow.<br/>
      Nothing is applied automatically.
    </div>
  </div>

  <script>
    const __params = ${jsParams};
    let __captchaToken = null;
    let __mfaState = null; // { accessToken, factorId }

    // Render Turnstile widget
    function initTurnstile() {
      if (window.turnstile) {
        window.turnstile.render('#turnstileWidget', {
          sitekey: __params.turnstileSiteKey,
          theme: 'dark',
          callback: function(token) {
            __captchaToken = token;
            document.getElementById('submitBtn').disabled = false;
          },
          'error-callback': function() {
            __captchaToken = null;
            document.getElementById('submitBtn').disabled = false;
          },
          'expired-callback': function() {
            __captchaToken = null;
            document.getElementById('submitBtn').disabled = true;
            if (window.turnstile) window.turnstile.reset('#turnstileWidget');
          },
        });
      } else if (__turnstileAttempts++ < 50) {
        setTimeout(initTurnstile, 100);
      } else {
        // Turnstile never loaded — an OFFLINE or captcha-blocked machine
        // (owner offline-first ruling 2026-08-31: the community container
        // must work with no internet at all). Enable the form; the captcha
        // token is simply omitted, and the SERVER stays the enforcement
        // point — a deployment with captcha enforced still rejects the
        // grant, exactly as it would any missing token.
        var widget = document.getElementById('turnstileWidget');
        if (widget) widget.style.display = 'none';
        document.getElementById('submitBtn').disabled = false;
      }
    }
    var __turnstileAttempts = 0;
    initTurnstile();

    function showError(msg) {
      const errEl = document.getElementById('errorMsg');
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }

    function hideError() {
      document.getElementById('errorMsg').style.display = 'none';
    }

    function completeAuthorization(sessionToken) {
      window.location.href = __params.baseUrl + '/authorize?' + new URLSearchParams({
        client_id: __params.clientId,
        redirect_uri: __params.redirectUri,
        code_challenge: __params.codeChallenge,
        code_challenge_method: __params.codeChallengeMethod,
        state: __params.state,
        scope: __params.scope,
        session_token: sessionToken,
      }).toString();
    }

    // Shared by the password grant AND the Google fragment resume: any GoTrue
    // session token enters here, gets the factor check, and either completes
    // or steps into TOTP. The server re-validates everything (AAL2 included),
    // so this is UX routing — never the enforcement point.
    async function proceedWithSession(accessToken, btn) {
      // Check if MFA is required by listing user factors
      const factorsResp = await fetch(__params.supabaseUrl + '/auth/v1/user', {
        headers: {
          'apikey': __params.supabaseAnonKey,
          'Authorization': 'Bearer ' + accessToken,
        },
      });

      // FAIL CLOSED: if the factor check cannot run, that is an error —
      // never "no MFA". The old fail-open here completed authorization with
      // an AAL1 token whenever this fetch hiccuped, skipping the TOTP step
      // (and the server now refuses that token anyway).
      if (!factorsResp.ok) {
        throw new Error('Could not check two-factor status — please try signing in again.');
      }
      const userData = await factorsResp.json();
      const factors = userData.factors || [];
      const verifiedTotp = factors.find(function(f) { return f.factor_type === 'totp' && f.status === 'verified'; });

      if (verifiedTotp) {
        // MFA required - show TOTP step. Hidden inputs must not block the
        // form: the Google path arrives with email/password empty, and a
        // hidden required field makes the browser refuse to submit.
        __mfaState = { accessToken: accessToken, factorId: verifiedTotp.id };
        document.getElementById('email').required = false;
        document.getElementById('password').required = false;
        document.getElementById('loginStep').classList.add('hidden');
        document.getElementById('mfaStep').classList.add('active');
        btn.textContent = 'Verify & Authorize';
        btn.disabled = false;
        document.getElementById('totpCode').focus();
        return;
      }

      // No verified factor - complete authorization
      completeAuthorization(accessToken);
    }

    // ── Google sign-in (hosted only): users who signed up with Google have
    // no password identity, so the email form can never work for them. The
    // round-trip is GoTrue's own implicit flow, and the session comes back
    // in the URL FRAGMENT — it never reaches any server.
    //
    // redirect_to MUST be a constant, query-free URL: GoTrue matches it
    // against the redirect allowlist and on ANY mismatch silently falls back
    // to the Site URL — the user ends up logged into the web app while the
    // MCP client waits forever (live-caught 2026-08-29 with the consent URL's
    // query string). So the pending request (this page's full URL) rides
    // same-origin storage, and /authorize/resume trampolines back here.
    function startGoogleSignIn() {
      const stash = JSON.stringify({ url: window.location.href.split('#')[0], ts: Date.now() });
      try { sessionStorage.setItem('nodespec_mcp_authreq', stash); } catch (_e) { /* private mode */ }
      try { localStorage.setItem('nodespec_mcp_authreq', stash); } catch (_e) { /* private mode */ }
      window.location.href = __params.supabaseUrl + '/auth/v1/authorize?' + new URLSearchParams({
        provider: 'google',
        redirect_to: __params.baseUrl + '/authorize/resume',
      }).toString();
    }

    async function resumeFromProvider() {
      const hash = window.location.hash;
      if (!hash || hash.indexOf('access_token=') === -1) {
        if (hash && hash.indexOf('error') !== -1) {
          const eFrag = new URLSearchParams(hash.slice(1));
          history.replaceState(null, '', window.location.pathname + window.location.search);
          showError(eFrag.get('error_description') || 'Google sign-in was cancelled — you can try again or use email.');
        }
        return;
      }
      const frag = new URLSearchParams(hash.slice(1));
      const accessToken = frag.get('access_token');
      // Strip the tokens from the address bar immediately.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      if (!accessToken) return;

      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Authorizing...';
      try {
        await proceedWithSession(accessToken, btn);
      } catch (err) {
        // Fall back to the email form — the session may have expired mid-flow.
        showError(err.message);
        btn.textContent = 'Sign In & Authorize';
      }
    }

    if (__params.googleEnabled) {
      const googleBtn = document.getElementById('googleBtn');
      googleBtn.style.display = 'flex';
      document.getElementById('authDivider').style.display = 'flex';
      googleBtn.addEventListener('click', startGoogleSignIn);
    }
    resumeFromProvider();

    async function handleMfaVerify() {
      const btn = document.getElementById('submitBtn');
      const code = document.getElementById('totpCode').value.trim();
      if (code.length !== 6) {
        showError('Please enter a 6-digit code');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      hideError();

      try {
        // Create challenge
        const challengeResp = await fetch(
          __params.supabaseUrl + '/auth/v1/factors/' + __mfaState.factorId + '/challenge',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': __params.supabaseAnonKey,
              'Authorization': 'Bearer ' + __mfaState.accessToken,
            },
          }
        );
        if (!challengeResp.ok) {
          const err = await challengeResp.json();
          throw new Error(err.message || 'Failed to create MFA challenge');
        }
        const challengeData = await challengeResp.json();

        // Verify TOTP code
        const verifyResp = await fetch(
          __params.supabaseUrl + '/auth/v1/factors/' + __mfaState.factorId + '/verify',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': __params.supabaseAnonKey,
              'Authorization': 'Bearer ' + __mfaState.accessToken,
            },
            body: JSON.stringify({ challenge_id: challengeData.id, code: code }),
          }
        );
        if (!verifyResp.ok) {
          const err = await verifyResp.json();
          throw new Error(err.message || 'Invalid verification code');
        }
        const verifyData = await verifyResp.json();
        completeAuthorization(verifyData.access_token);
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Verify & Authorize';
      }
    }

    async function handleLogin() {
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      hideError();

      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        const body = { email, password };
        if (__captchaToken) {
          body.gotrue_meta_security = { captcha_token: __captchaToken };
        }

        const resp = await fetch(__params.supabaseUrl + '/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': __params.supabaseAnonKey },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error_description || err.msg || 'Invalid credentials');
        }

        const data = await resp.json();
        const accessToken = data.access_token;

        await proceedWithSession(accessToken, btn);
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Sign In & Authorize';
        // Reset Turnstile for retry
        if (window.turnstile) {
          __captchaToken = null;
          window.turnstile.reset('#turnstileWidget');
          btn.disabled = true;
        }
      }
    }

    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (__mfaState) {
        await handleMfaVerify();
      } else {
        await handleLogin();
      }
    });
  </script>
</body>
</html>`;

  return new Response(consentHtml, {
    status: 200,
    headers: { ...oauthCors, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function completeAuthorization(
  supabase: SupabaseClient,
  sessionToken: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  scope: string,
  state: string,
  oauthCors: Record<string, string>,
): Promise<Response> {
  const { data: { user }, error: authError } = await supabase.auth.getUser(sessionToken);
  if (authError || !user) {
    return new Response('Authentication failed. Please try again.', {
      status: 401,
      headers: { ...oauthCors, 'Content-Type': 'text/plain' },
    });
  }

  // SECURITY: enforce MFA server-side. The consent page's factor check is UX,
  // not enforcement — a password-only (AAL1) session token must never mint an
  // authorization code for a user who has a verified factor. Without this a
  // scripted password grant (or a client that completes before the TOTP step)
  // gets a working token, bypassing 2FA (found 2026-08-26). It is also the
  // quality bug: the premature AAL1 completion produced a token whose session
  // was degraded — "connected, no tools, error" — until the code was entered.
  // The factor list comes from the SAME getUser call above (GoTrue returns
  // `factors` on the user object) — never from a PostgREST query against the
  // auth schema, which is not exposed and would fail-open silently.
  const factors = (user as { factors?: Array<{ status?: string }> }).factors ?? [];
  const hasVerifiedFactor = factors.some((f) => f?.status === 'verified');
  if (hasVerifiedFactor && decodeJwtAal(sessionToken) !== 'aal2') {
    return new Response(
      'Multi-factor authentication required. Enter the code from your authenticator app to finish signing in.',
      { status: 401, headers: { ...oauthCors, 'Content-Type': 'text/plain' } },
    );
  }

  return await mintCodeAndRedirect(
    supabase, user.id, clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, state, oauthCors,
  );
}

/** Mint a one-shot authorization code for an ALREADY-AUTHENTICATED user and
 *  302 back to the client. Shared by the session-token completion path and
 *  the local trust lane — both arrive here only after their own gates. */
async function mintCodeAndRedirect(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  scope: string,
  state: string,
  oauthCors: Record<string, string>,
): Promise<Response> {
  const code = generateRandomToken(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const scopes = scope.split(' ').filter(Boolean);

  const { error: insertError } = await supabase
    .from('mcp_oauth_codes')
    .insert({
      code,
      user_id: userId,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scopes,
      state,
      expires_at: expiresAt,
    });

  if (insertError) {
    return new Response('Failed to create authorization code', {
      status: 500,
      headers: { ...oauthCors, 'Content-Type': 'text/plain' },
    });
  }

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return Response.redirect(redirectUrl.toString(), 302);
}

export async function handleTokenExchange(req: Request, supabase: SupabaseClient): Promise<Response> {
  const oauthCors = getOAuthCorsHeaders(req);
  const contentType = req.headers.get('content-type') || '';
  let params: URLSearchParams;

  if (contentType.includes('application/x-www-form-urlencoded')) {
    params = new URLSearchParams(await req.text());
  } else if (contentType.includes('application/json')) {
    const json = await req.json();
    params = new URLSearchParams();
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'string') params.set(k, v);
    }
  } else {
    params = new URLSearchParams(await req.text());
  }

  const grantType = params.get('grant_type');

  if (grantType !== 'authorization_code') {
    return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  const code = params.get('code');
  const codeVerifier = params.get('code_verifier');
  const redirectUri = params.get('redirect_uri');

  if (!code || !codeVerifier) {
    return new Response(JSON.stringify({ error: 'invalid_request', error_description: 'code and code_verifier are required' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  const { data: codeEntry, error: codeError } = await supabase
    .from('mcp_oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', false)
    .maybeSingle();

  if (codeError || !codeEntry) {
    return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  if (new Date(codeEntry.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Authorization code expired' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  if (redirectUri && redirectUri !== codeEntry.redirect_uri) {
    return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  const pkceValid = await verifyPkceChallenge(codeVerifier, codeEntry.code_challenge);
  if (!pkceValid) {
    return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  const clientIdParam = params.get('client_id') || codeEntry.client_id;
  if (clientIdParam !== codeEntry.client_id) {
    return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'client_id mismatch' }), {
      status: 400,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  await supabase
    .from('mcp_oauth_codes')
    .update({ used: true })
    .eq('id', codeEntry.id);

  const accessToken = `nst_${generateRandomToken(32)}`;
  const tokenHash = await sha256Hex(accessToken);
  const TOKEN_TTL_DAYS = 7;
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: tokenError } = await supabase
    .from('mcp_oauth_tokens')
    .insert({
      access_token_hash: tokenHash,
      user_id: codeEntry.user_id,
      client_id: codeEntry.client_id,
      scopes: codeEntry.scopes,
      expires_at: tokenExpiresAt,
    });

  if (tokenError) {
    return new Response(JSON.stringify({ error: 'server_error', error_description: 'Failed to create access token' }), {
      status: 500,
      headers: { ...oauthCors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_DAYS * 86400,
    scope: (codeEntry.scopes as string[]).join(' '),
  }), {
    status: 200,
    headers: { ...oauthCors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
