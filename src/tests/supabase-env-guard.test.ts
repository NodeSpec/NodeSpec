import { describe, it, expect } from 'vitest';
import { resolveSupabaseConfig } from '../persistence/supabase/client';

// Task SB-0: dev builds must fail loudly instead of silently falling back to the
// production Supabase backend when env vars are missing. Audit (owner
// 2026-09-27): production builds too. The fallback shipped in the open source
// and Enterprise trees, so a container built without its .env talked to the
// managed backend; every Netlify context now sets its backend in netlify.toml.

const STAGING_ENV = { url: 'http://127.0.0.1:54321', anonKey: 'local-anon-key' };

describe('resolveSupabaseConfig (SB-0 env guard)', () => {
  it('uses explicit env values when both are set (dev)', () => {
    expect(resolveSupabaseConfig(STAGING_ENV, true)).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'local-anon-key',
    });
  });

  it('uses explicit env values when both are set (prod)', () => {
    expect(resolveSupabaseConfig(STAGING_ENV, false).url).toBe('http://127.0.0.1:54321');
  });

  it('THROWS in dev when env is missing — never falls back to production', () => {
    expect(() => resolveSupabaseConfig({}, true)).toThrowError(/\.env\.local/);
    expect(() => resolveSupabaseConfig({ url: 'http://127.0.0.1:54321' }, true)).toThrowError();
    expect(() => resolveSupabaseConfig({ anonKey: 'k' }, true)).toThrowError();
  });

  it('dev error message points at the runbook, and never contains the prod URL', () => {
    try {
      resolveSupabaseConfig({}, true);
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('STAGING_RUNBOOK');
      expect(msg).not.toContain('supabase.co');
    }
  });

  it('a production build with no backend refuses too, naming the two variables and no backend', () => {
    for (const env of [{}, { url: 'https://example.test' }, { anonKey: 'k' }]) {
      let msg = '';
      try {
        resolveSupabaseConfig(env, false);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY were not set');
      expect(msg).not.toContain('supabase.co');
    }
  });
});
