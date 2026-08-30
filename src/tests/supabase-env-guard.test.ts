import { describe, it, expect } from 'vitest';
import { resolveSupabaseConfig } from '../persistence/supabase/client';

// Task SB-0: dev builds must fail loudly instead of silently falling back to the
// production Supabase backend when env vars are missing. Production builds keep
// the fallback (Netlify sets env explicitly; revisit at Stage 4).

const STAGING_ENV = { url: 'http://127.0.0.1:54321', anonKey: 'local-anon-key' };
const PROD_URL = 'https://komnpkjlvgfworfbdrya.supabase.co';

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
      expect(msg).not.toContain(PROD_URL);
    }
  });

  it('production builds keep the fallback (Netlify behavior unchanged)', () => {
    const cfg = resolveSupabaseConfig({}, false);
    expect(cfg.url).toBe(PROD_URL);
    expect(cfg.anonKey.length).toBeGreaterThan(0);
  });
});
