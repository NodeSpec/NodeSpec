import { getCanContainRoleIds, getContainerTypeById } from '@nodespec/core/container-types.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';

// M6: `database` is GONE from the accepted set — zero roles carry it (the `database` role
// itself is rf_visual_type='service'), M5's schema and DB CHECK forbid it, and the static
// index below already redirected the key to 'service'. It was a declared-but-dead value.
// `logicalBoundary` is NOT a DB value — it is derived from container_style at resolve time.
const VALID_RF_TYPES = new Set(['service', 'api', 'queue', 'cache', 'external', 'container', 'logicalBoundary', 'icon', 'library']);

const STATIC_RF_VISUAL_TYPES: Record<string, string> = {
  'service': 'service',
  'database': 'service',
  'api': 'api',
  'queue': 'queue',
  'cache': 'cache',
  'external': 'external',
  'container': 'container',
  'library': 'library',
};

let _rfTypeIndex: Map<string, string> | null = null;
let _catalogPopulated = false;

function ensureIndex(): Map<string, string> {
  if (!_rfTypeIndex) {
    _rfTypeIndex = new Map(Object.entries(STATIC_RF_VISUAL_TYPES));
  }
  return _rfTypeIndex;
}

export function populateRFVisualTypes(catalog: CatalogResolver): void {
  const index = new Map<string, string>();

  for (const role of catalog.getAllRoles()) {
    if (role.rfVisualType && VALID_RF_TYPES.has(role.rfVisualType)) {
      index.set(role.id, role.rfVisualType);
    }
  }

  _rfTypeIndex = index;
  _catalogPopulated = true;
}

export function isRFTypesPopulated(): boolean {
  return _catalogPopulated;
}

export function resolveRFVisualType(nodeType: string, catalog?: CatalogResolver | null): string {
  if (catalog) {
    const resolved = catalog.resolveNodeType(nodeType);
    if (resolved?.role?.rfVisualType) {
      if (resolved.role.containerStyle === 'logical-boundary') {
        return 'logicalBoundary';
      }
      return resolved.role.rfVisualType;
    }
  }

  const index = ensureIndex();
  const cached = index.get(nodeType);
  if (cached) {
    if (cached === 'container') {
      const containerDef = getContainerTypeById(nodeType);
      if (containerDef?.containerStyle === 'logical-boundary') {
        return 'logicalBoundary';
      }
    }
    return cached;
  }

  const containerDef = getContainerTypeById(nodeType);
  if (containerDef && getCanContainRoleIds(containerDef).length > 0) {
    return containerDef.containerStyle === 'logical-boundary' ? 'logicalBoundary' : 'container';
  }

  return 'service';
}

export function isContainerType(nodeType: string, catalog?: CatalogResolver | null): boolean {
  if (catalog) {
    const resolved = catalog.resolveNodeType(nodeType);
    if (resolved?.role) {
      return resolved.role.rfVisualType === 'container' ||
        (resolved.role.isContainer && getCanContainRoleIds(resolved.role).length > 0);
    }
  }

  const rfType = resolveRFVisualType(nodeType, catalog);
  if (rfType === 'container') return true;

  const containerDef = getContainerTypeById(nodeType);
  return !!containerDef && getCanContainRoleIds(containerDef).length > 0;
}

export function isLogicalBoundaryType(nodeType: string, catalog?: CatalogResolver | null): boolean {
  if (catalog) {
    const resolved = catalog.resolveNodeType(nodeType);
    if (resolved?.role) {
      return resolved.role.containerStyle === 'logical-boundary';
    }
  }
  const containerDef = getContainerTypeById(nodeType);
  return !!containerDef && containerDef.containerStyle === 'logical-boundary';
}

// M6: `hasTechnologyLogo` deleted. It asked the resolver for a technology, but since M4
// made resolveNodeType a ROLE lookup it always returns `technology: null` — so the function
// returned false unconditionally. It had no production caller; only its test noticed.
