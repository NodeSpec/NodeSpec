import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/*
  Community Docker install (OSS-17 phase 1, owner ruling 2026-09-02): the
  user path is `docker compose up -d` — no Supabase CLI, no WSL, no bash
  bootstrap. These pins ship WITH the export (they read only shipped files)
  and hold the stack's load-bearing wiring: the single-origin gateway
  routes, the schema-apply lane, the functions router, and the
  localhost-only demo-secret posture.
*/

const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
const compose = read('deploy/community/docker-compose.yml');
const nginx = read('deploy/community/nginx.conf');
const env = read('deploy/community/.env.example');
const initScript = read('deploy/community/db-init/apply.sh');
const router = read('deploy/community/functions-main/index.ts');

describe('community compose — stack coherence', () => {
  it('postgres major version matches the CLI stack (one schema, two launchers)', () => {
    const major = compose.match(/supabase\/postgres:(\d+)\./)?.[1];
    const configToml = read('supabase/config.toml');
    expect(major).toBeDefined();
    expect(configToml).toContain(`major_version = ${major}`);
  });

  it('functions get the SAME deployment env the bootstrap lane composes', () => {
    // Missing any of these reproduces a known live failure: hosted-mode
    // billing on sign-in, kong-internal consent URLs, or dead MCP discovery.
    for (const line of [
      'NODESPEC_DEPLOYMENT: self-hosted',
      'ENCRYPTION_SECRET: ${ENCRYPTION_SECRET}',
      'MCP_PUBLIC_URL: ${SITE_URL}/functions/v1/mcp-server',
      'PUBLIC_SUPABASE_URL: ${SITE_URL}',
      'MCP_LOCAL_TRUST: ${MCP_LOCAL_TRUST}',
      'STRIPE_SECRET_KEY: sk_test_dummy_never_called_selfhost',
    ]) {
      expect(compose, `missing functions env: ${line}`).toContain(line);
    }
    expect(compose).toContain('"start", "--main-service", "/home/deno/functions/main"');
  });

  it('db-init applies supabase/migrations exactly once and never resets data', () => {
    expect(compose).toContain('../../supabase/migrations:/nodespec-migrations:ro');
    expect(initScript).toContain("to_regclass('public.projects')");
    expect(initScript).toContain('already present');
    expect(initScript).toContain("to_regclass('auth.users')");
    // Role passwords must align with .env or every sibling service 401s.
    for (const role of ['authenticator', 'supabase_auth_admin', 'supabase_storage_admin']) {
      expect(initScript).toContain(`ALTER USER ${role} WITH PASSWORD`);
    }
  });

  it('nginx is the whole gateway: five stripped routes + realtime socket + OAuth discovery', () => {
    expect(nginx).toContain('rewrite ^/auth/v1(/.*)$ $1 break');
    expect(nginx).toContain('rewrite ^/rest/v1(/.*)$ $1 break');
    expect(nginx).toContain('rewrite ^/storage/v1(/.*)$ $1 break');
    expect(nginx).toContain('rewrite ^/functions/v1(/.*)$ $1 break');
    // Realtime maps onto the socket mount and keeps the websocket upgrade.
    expect(nginx).toContain('rewrite ^/realtime/v1(/.*)$ /socket$1 break');
    expect(nginx).toContain('proxy_set_header Upgrade $http_upgrade');
    // MCP clients derive metadata by root-insertion; the SPA must never
    // answer these paths.
    expect(nginx).toContain('oauth-authorization-server|oauth-protected-resource');
    expect(nginx).toContain('/mcp-server/.well-known/$1');
  });

  it('the main router spawns per-function workers with full env passthrough', () => {
    expect(router).toContain('EdgeRuntime.userWorkers.create');
    expect(router).toContain('envVars: Object.entries(Deno.env.toObject())');
  });

  it('secret posture: one required value, demo keys loudly marked localhost-only', () => {
    expect(env).toMatch(/^ENCRYPTION_SECRET=$/m);
    expect(env).toContain('LOCALHOST ONLY');
    expect(env).toContain('MCP_LOCAL_TRUST=true');
    // The hosted edition must never be reachable from this file.
    expect(env).toMatch(/^VITE_NODESPEC_EDITION=$/m);
    expect(env).not.toContain('VITE_NODESPEC_EDITION=hosted');
  });

  it('gateway files stay LF — the whole point of the Docker path on Windows', () => {
    for (const [name, text] of [['compose', compose], ['nginx', nginx], ['apply.sh', initScript]] as const) {
      expect(text.includes('\r'), `${name} carries CRLF`).toBe(false);
    }
  });
});
