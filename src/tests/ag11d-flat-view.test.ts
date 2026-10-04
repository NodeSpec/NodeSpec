// AG.11d (owner 2026-09-28): a node has one parent, so a group that runs on a
// host sits inside the host. The functional (flat) view hides host boxes and
// keeps groups: the group still shows, holding its nodes, as it does in the
// deployment (nested) view inside the host.
import { describe, expect, it } from 'vitest';
import { mapGraphToRFNodes } from '../ui/adapters/graph-to-reactflow.js';
import type { CatalogResolver } from '../persistence/supabase/catalog-repository.js';

const ROLES: Record<string, { isContainer: boolean; containerStyle: string | null; rfVisualType: string; nature: string; canContain: string[] }> = {
  'docker-compose': { isContainer: true, containerStyle: 'hosting', rfVisualType: 'container', nature: 'build', canContain: ['application-module', 'backend-service'] },
  'application-module': { isContainer: true, containerStyle: 'logical-boundary', rfVisualType: 'container', nature: 'build', canContain: ['backend-service'] },
  'backend-service': { isContainer: false, containerStyle: null, rfVisualType: 'service', nature: 'build', canContain: [] },
};
const catalog = {
  getRole: (id: string) => (ROLES[id] ? { id, label: id, ...ROLES[id] } : null),
  getTechnology: () => null,
  resolveNodeType: (id: string) => (ROLES[id] ? { role: { id, label: id, ...ROLES[id] } } : null),
  getAllRoles: () => Object.entries(ROLES).map(([id, r]) => ({ id, label: id, ...r })),
} as unknown as CatalogResolver;

const graph = {
  id: 'g', schemaVersion: 8, version: 1, hash: '', edges: {}, contracts: {}, artifacts: {},
  nodes: {
    host: { id: 'host', type: 'docker-compose', label: 'Compose', metadata: {}, artifacts: [] },
    apps: { id: 'apps', type: 'application-module', label: 'Apps', parentId: 'host', placementKind: 'hosts', metadata: {}, artifacts: [] },
    api: { id: 'api', type: 'backend-service', label: 'API', parentId: 'apps', placementKind: 'contains', metadata: {}, artifacts: [] },
  },
} as never;

describe('AG.11d: a group in a host shows in both views', () => {
  it('the flat view hides the host and keeps the group, holding its node', () => {
    const rf = Object.fromEntries(mapGraphToRFNodes(graph, 'flat', catalog).map((n) => [n.id, n]));
    expect(rf.host.hidden).toBe(true);
    expect(rf.apps.hidden).toBe(false);
    expect(rf.apps.parentId).toBeUndefined();
    expect(rf.api.hidden).toBe(false);
    expect(rf.api.parentId).toBe('apps');
  });

  it('the nested view shows the group inside the host, the node inside the group', () => {
    const rf = Object.fromEntries(mapGraphToRFNodes(graph, 'nested', catalog).map((n) => [n.id, n]));
    expect(rf.apps.parentId).toBe('host');
    expect(rf.api.parentId).toBe('apps');
  });
});
