// N8.4c-1 — N4.7 merged the Firebase family INTO Google Cloud ("firebase is part of GCP
// and should not be its own thing"): the palette maps firebase-* under the Google Cloud
// chip, and firebase-* technologies nest in the gcp platform container. But the N8.4b-1c
// provider-coherence rule inferred the bare prefix, so it saw child `firebase` vs
// container `gcp` and REFUSED every Firebase node dropped into a Google Cloud project.
// The palette said one thing and the containment guard another.
import { describe, it, expect } from 'vitest';
import { canContainerHoldNode, providerOfNode, setRoleResolver, type RoleInfo } from '@nodespec/core/container-types.js';

const ROLES: Record<string, RoleInfo> = {
  gcp: { id: 'gcp', nature: 'host', provider: 'gcp', treatmentMode: 'container' },
  firebase: { id: 'firebase', nature: 'host', provider: 'firebase', treatmentMode: 'container' },
  aws: { id: 'aws', nature: 'host', provider: 'aws', treatmentMode: 'container' },
  'auth-provider': { id: 'auth-provider', nature: 'build', provider: null, treatmentMode: 'leaf' },
  database: { id: 'database', nature: 'build', provider: null, treatmentMode: 'leaf' },
};

function withResolver<T>(fn: () => T): T {
  setRoleResolver((id) => ROLES[id] ?? null);
  try { return fn(); } finally { setRoleResolver(null); }
}

describe('firebase- resolves to the gcp provider family', () => {
  it('a firebase-* technology reports provider gcp, not firebase', () => {
    expect(providerOfNode(null, 'firebase-auth')).toBe('gcp');
    expect(providerOfNode(null, 'gcp-firestore')).toBe('gcp');
  });

  it('the legacy firebase platform role reports gcp through its provider column too', () => {
    // Fixing only the prefix side would have swapped one refusal for another: a
    // firebase-* child inside a legacy Firebase container.
    expect(providerOfNode(ROLES.firebase)).toBe('gcp');
    expect(providerOfNode(ROLES.gcp)).toBe('gcp');
  });

  it('Firebase Auth drops into a Google Cloud project (was refused)', () => {
    expect(withResolver(() => canContainerHoldNode('gcp', 'auth-provider', undefined, 'firebase-auth'))).toBe(true);
  });

  it('a GCP technology still drops into a legacy Firebase container', () => {
    expect(withResolver(() => canContainerHoldNode('firebase', 'database', undefined, 'gcp-firestore'))).toBe(true);
  });

  it('cross-provider containment is still refused — the fix does not widen the rule', () => {
    expect(withResolver(() => canContainerHoldNode('aws', 'auth-provider', undefined, 'firebase-auth'))).toBe(false);
    expect(withResolver(() => canContainerHoldNode('gcp', 'database', undefined, 'aws-dynamodb'))).toBe(false);
  });

  it('platform-in-platform is still refused', () => {
    expect(withResolver(() => canContainerHoldNode('gcp', 'firebase'))).toBe(false);
  });
});

// ── N8.5″(d): DB-authority — the catalog seeds families; the static list is the FLOOR ──
// Union semantics are the behavior-identical guarantee: registration can only ADD
// prefixes, never remove or re-map what the static floor covers. A new provider is one
// catalog row (provider-stamped role), zero code changes.
describe('N8.5(d) catalog-seeded provider families', () => {
  it('GOLDEN: registration never changes inference for static-floor ids', async () => {
    const { inferProviderFromId, providerFamilyForId, registerProviderFamilies, resetRegisteredProviderFamilies } =
      await import('@nodespec/core/provider-inference.js');
    resetRegisteredProviderFamilies();
    const before = ['aws-lambda', 'gcp-cloud-run', 'firebase-auth', 'vercel-edge', 'aurora', 'express']
      .map(id => [id, providerFamilyForId(id)]);
    registerProviderFamilies(['digitalocean', 'aws', 'firebase', null, undefined, ' ']);
    const after = ['aws-lambda', 'gcp-cloud-run', 'firebase-auth', 'vercel-edge', 'aurora', 'express']
      .map(id => [id, providerFamilyForId(id)]);
    expect(after).toEqual(before);
    expect(inferProviderFromId('firebase-auth')).toBe('gcp'); // family collapse intact
    resetRegisteredProviderFamilies();
  });

  it('SCALABILITY: a new provider family works only after its catalog row registers it — zero code changes', async () => {
    const { inferProviderFromId, hasProviderPrefix, registerProviderFamilies, resetRegisteredProviderFamilies } =
      await import('@nodespec/core/provider-inference.js');
    resetRegisteredProviderFamilies();
    expect(inferProviderFromId('digitalocean-spaces')).toBeNull();
    registerProviderFamilies(['digitalocean']);
    expect(inferProviderFromId('digitalocean-spaces')).toBe('digitalocean');
    expect(hasProviderPrefix('digitalocean-spaces')).toBe(true);
    // Registered values go through the SAME family collapse as static prefixes.
    registerProviderFamilies(['firebase']);
    expect(inferProviderFromId('firebase-hosting')).toBe('gcp');
    resetRegisteredProviderFamilies();
  });
});
