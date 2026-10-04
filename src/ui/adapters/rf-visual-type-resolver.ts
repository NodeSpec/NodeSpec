import { getContainerTypeById, hasCanContainRules } from '@nodespec/core/container-types.js';
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

// AB.5 (owner 2026-09-24): a role is a container because the catalog says it
// is one (is_container), never because of how it is drawn. desktop-app was
// made a leaf in M3 (an Electron app is one node whose UI framework is a
// field) but kept rf_visual_type 'container', so the canvas drew it as a box
// and let nodes be nested in it while import, the MCP tools and task packets
// treated it as a node. A leaf drawn as a container now draws as a service,
// and the database refuses the pair (20260924110000).
const drawnAs = (role: { rfVisualType: string; isContainer: boolean }) =>
  (role.rfVisualType === 'container' && !role.isContainer ? 'service' : role.rfVisualType);

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
      index.set(role.id, drawnAs(role));
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
      return drawnAs(resolved.role);
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

  // AG.11f: offline, a platform in the fallback admits by rule (its provider, natures,
  // interface kinds) rather than by id, as it does when the catalog is loaded.
  const containerDef = getContainerTypeById(nodeType);
  if (containerDef && hasCanContainRules(containerDef)) {
    return containerDef.containerStyle === 'logical-boundary' ? 'logicalBoundary' : 'container';
  }

  return 'service';
}

export function isContainerType(nodeType: string, catalog?: CatalogResolver | null): boolean {
  if (catalog) {
    const resolved = catalog.resolveNodeType(nodeType);
    if (resolved?.role) {
      // A container that admits nothing is a dead box, not a container; a
      // platform admits by nature, interface or provider rather than by id.
      const cc = resolved.role.canContain;
      const admits = Array.isArray(cc)
        ? cc.length > 0
        : !!(cc?.roleIds?.length || cc?.natures?.length || cc?.interfaceKinds?.length || cc?.providers?.length);
      return resolved.role.isContainer === true && admits;
    }
  }

  const rfType = resolveRFVisualType(nodeType, catalog);
  if (rfType === 'container') return true;

  const containerDef = getContainerTypeById(nodeType);
  return !!containerDef && hasCanContainRules(containerDef);
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
