import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  deriveHandleBase,
  validateHandle,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
} from '../ui/services/ProfileService.js';
import type { User } from '@supabase/supabase-js';

// Public profiles (/u/:handle, hosted edition). The routing contracts guard
// the two-allowlist boot-redirect trap: App.tsx has TWO independent auth
// handlers (getSession + onAuthStateChange) that each bounce signed-in users
// to /app unless the path is exempted — a shared profile link opened by a
// signed-in user must survive both.
describe('Public profile routing', () => {
  const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

  it('registers the /u/:handle route gated by hosted edition', () => {
    expect(appSource).toContain('path="/u/:handle"');
    expect(appSource).toContain('PublicProfilePage');
    expect(appSource).toContain("import { isHostedEdition, hasTemplatesGallery, hasAdminPortal } from './ui/config/edition.js'");
  });

  it('exempts /u/ from BOTH boot redirects (getSession + onAuthStateChange)', () => {
    const hits = appSource.match(/currentPath\.startsWith\('\/u\/'\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('/u/:handle route appears before the catch-all wildcard route', () => {
    const routePos = appSource.indexOf('path="/u/:handle"');
    const catchAllPos = appSource.indexOf('path="*"');
    expect(routePos).toBeGreaterThan(-1);
    expect(routePos).toBeLessThan(catchAllPos);
  });

  it('/u/:handle route has no auth guard', () => {
    const lines = appSource.split('\n');
    const routeIndex = lines.findIndex(l => l.includes('path="/u/:handle"'));
    const block = lines.slice(routeIndex, routeIndex + 4).join('\n');
    expect(block).toContain('PublicProfilePage');
    expect(block).not.toContain('!user');
  });
});

describe('Handle validation (client mirror of the user_profiles CHECKs)', () => {
  it('accepts well-formed handles', () => {
    expect(validateHandle('jane-doe')).toBeNull();
    expect(validateHandle('a1b')).toBeNull();
    expect(validateHandle('x'.repeat(30))).toBeNull();
  });

  it('rejects bad shapes', () => {
    expect(validateHandle('ab')).not.toBeNull();          // too short
    expect(validateHandle('x'.repeat(31))).not.toBeNull(); // too long
    expect(validateHandle('-lead')).not.toBeNull();        // must start alphanumeric
    expect(validateHandle('Has Caps')).not.toBeNull();
    expect(validateHandle('dots.bad')).not.toBeNull();
  });

  it('rejects every reserved word', () => {
    for (const reserved of RESERVED_HANDLES) {
      expect(validateHandle(reserved), reserved).not.toBeNull();
    }
  });

  it('deriveHandleBase always yields a valid, unreserved handle', () => {
    const cases: Array<Pick<User, 'email' | 'user_metadata'>> = [
      { email: 'jane.doe@example.com', user_metadata: {} },
      { email: undefined, user_metadata: { full_name: 'Jane Doe' } },
      { email: 'x@example.com', user_metadata: {} },          // too-short local part
      { email: 'admin@example.com', user_metadata: {} },      // reserved word
      { email: undefined, user_metadata: {} },                // nothing at all
      // Non-latin local part. Written as \u escapes, not literal glyphs, so
      // every shipped source file stays pure ASCII — literal foreign-script
      // characters in a .ts file are an antivirus-heuristic magnet on a
      // zero-prevalence download (Defender false-positived this exact file,
      // 2026-08-28). Identical string at runtime.
      { email: '\u65E5\u672C\u8A9E@example.com', user_metadata: {} },
    ];
    for (const user of cases) {
      const base = deriveHandleBase(user);
      expect(HANDLE_PATTERN.test(base), base).toBe(true);
      expect(RESERVED_HANDLES.has(base), base).toBe(false);
      // Collision suffixes up to -20 must stay within the 30-char limit.
      expect(HANDLE_PATTERN.test(`${base}-20`), `${base}-20`).toBe(true);
    }
  });
});

describe('Profile surface contracts', () => {
  const accountPanel = readFileSync(
    resolve(__dirname, '../ui/components/panels/AccountPanel.tsx'),
    'utf-8'
  );
  const profileService = readFileSync(
    resolve(__dirname, '../ui/services/ProfileService.ts'),
    'utf-8'
  );
  const detailPage = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateDetailPage.tsx'),
    'utf-8'
  );

  it('AccountPanel mounts the editor tab only in the hosted edition', () => {
    expect(accountPanel).toContain('PublicProfileEditor');
    expect(accountPanel).toContain("isHostedEdition && activeTab === 'publicProfile'");
  });

  it('avatars use the single canonical per-user object with upsert', () => {
    expect(profileService).toContain('${userId}/avatar.png');
    expect(profileService).toContain('upsert: true');
  });

  it('template detail attributes community authors via profiles with a fallback', () => {
    expect(detailPage).toContain('getProfilesByUserIds');
    expect(detailPage).toContain('a community member');
  });
});
