// N9b-3: the static node-type registry is retired — the registry starts EMPTY and
// only the DB catalog populates it. Pre-hydration (or failed-load) lookups return
// undefined/empty — visible via the N9b-2 banner, never silently served stale data.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllNodeTypes,
  getNodeTypeById,
  isCatalogPopulated,
  populateDomains,
} from '../../core/src/node-types';

describe('N9b-3: static registry retired — DB-hydration only', () => {
  beforeEach(() => {
    populateDomains([]);
  });

  it('starts empty: no node types, nothing resolvable, catalog reads unpopulated', () => {
    expect(getAllNodeTypes()).toEqual([]);
    expect(getNodeTypeById('frontend.react')).toBeUndefined();
    expect(getNodeTypeById('frontend-app')).toBeUndefined();
    expect(isCatalogPopulated()).toBe(false);
  });

  it('populateDomains flips populated and serves exactly what the DB provided', () => {
    populateDomains([
      {
        id: 'apps',
        label: 'Apps',
        description: '',
        icon: '',
        nodeTypes: [
          { id: 'frontend-app', label: 'Frontend App', domainId: 'apps' } as never,
        ],
      } as never,
    ]);
    expect(isCatalogPopulated()).toBe(true);
    expect(getNodeTypeById('frontend-app')).toBeDefined();
    expect(getAllNodeTypes()).toHaveLength(1);
  });
});
