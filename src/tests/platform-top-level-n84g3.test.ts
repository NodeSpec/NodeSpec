// N8.4g-3 (owner ruling): a managed platform is operated by its vendor — nothing
// hosts it. Core mirror of the server pin (supabase/functions/tests/
// platform-top-level_test.ts); the two containment paths must agree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canContainerHoldNode, setRoleResolver, type RoleInfo } from '../../core/src/container-types';

const roles: Record<string, RoleInfo> = {
  supabase: { id: 'supabase', provider: 'supabase', treatmentMode: 'container' },
  aws: { id: 'aws', provider: 'aws', treatmentMode: 'container' },
  'docker-container': { id: 'docker-container', provider: null, treatmentMode: 'container' },
  'logical-zone': { id: 'logical-zone', provider: null, treatmentMode: 'container' },
  'auth-provider': { id: 'auth-provider', provider: null, treatmentMode: 'leaf' },
};

describe('N8.4g-3: platforms are top-level only (vendor-operated — nothing hosts them)', () => {
  beforeEach(() => {
    setRoleResolver((id: string) => roles[id] ?? null);
  });
  afterEach(() => {
    setRoleResolver(null);
  });

  it('refuses a platform inside a hosting container (docker)', () => {
    expect(canContainerHoldNode('docker-container', 'supabase')).toBe(false);
  });

  it('still refuses platform-in-platform (subsumed by the broader rule)', () => {
    expect(canContainerHoldNode('aws', 'supabase')).toBe(false);
  });

  it('allows a platform inside a purely organizational logical group', () => {
    expect(canContainerHoldNode('logical-zone', 'supabase')).toBe(true);
  });
});
