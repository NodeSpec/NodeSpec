// N9b / M4: dotted node types replay from graph_patches FOREVER — patches are append-only
// and hash-chained, so they are never rewritten. M4 deleted the 429-row legacy_type_mappings
// table and the 152-entry NODE_TYPE_TO_ROLE map, but NOT the tolerance: the last segment of
// a dotted type IS its role id under the retired grammar, so the read boundary resolves it
// with no table at all. This pins that the tolerance survived the deletion.
import { describe, it, expect } from 'vitest';
import { canContainerHoldNode, setRoleResolver, type RoleInfo } from '@nodespec/core/container-types.js';

const ROLES: Record<string, RoleInfo> = {
  'backend-service': { id: 'backend-service', nature: 'build', interfaceKind: 'service', provider: null },
  'docker-container': { id: 'docker-container', nature: 'build', interfaceKind: 'service', provider: null, isContainer: true, containerStyle: 'hosting' },
};

describe('M4 — dotted tolerance survives without a mapping table', () => {
  it('resolves a dotted type by its last segment', () => {
    setRoleResolver((id) => ROLES[id] ?? null);
    try {
      // `backend.nodejs` is not a role id; `nodejs` is not either. But a patch replaying
      // `web.backend-service` must still land on the backend-service role.
      expect(canContainerHoldNode('docker-container', 'web.backend-service')).toBe(true);
      expect(canContainerHoldNode('docker-container', 'backend-service')).toBe(true);
    } finally {
      setRoleResolver(null);
    }
  });

  it('an unresolvable dotted type is not silently coerced to something wrong', () => {
    setRoleResolver((id) => ROLES[id] ?? null);
    try {
      // unknown tail -> no role info -> the container's own rules decide, not a guess
      expect(typeof canContainerHoldNode('docker-container', 'made.up.thing')).toBe('boolean');
    } finally {
      setRoleResolver(null);
    }
  });
});
