import { STATIC_CONTAINER_TYPE_DATA } from './container-type-data.js';
import { effectiveTreatment, type TreatmentMode, type NodeNature } from './ontology.js';
import { inferProviderFromId, normalizeProviderFamily } from './provider-inference.js';

export type ContainerStyle = 'hosting' | 'logical-boundary';

export interface CanContainRule {
  roleIds?: string[];
  /** M1c: replaces `kinds` (which held the retired 13-value `kind` vocabulary). */
  natures?: string[];
  /** M1c: replaces `functionalKinds`. */
  interfaceKinds?: string[];
  providers?: string[];
}

export interface RoleInfo {
  id: string;
  /** M1b: the collapsed behavioral axis. Absent = 'build' (the column default). */
  nature?: NodeNature;
  /** M1b: contract-birth axis. Absent = 'service'. */
  interfaceKind?: string | null;
  provider: string | null;
  /** N2.3: ontology treatment axis; absent = derived from nature + is_container. */
  treatmentMode?: TreatmentMode;
  isContainer?: boolean;
  /** M1b: 'logical-boundary' marks a PURELY ORGANIZATIONAL container — the only kind that
   *  may hold a `host` node (N8.4g-3). Every other container carries hosting semantics. */
  containerStyle?: 'hosting' | 'logical-boundary' | null;
}

export type RoleResolver = (roleId: string) => RoleInfo | null;

/** N2.3: resolves a technology id to its `ai_context.treatmentOverride` (or null).
 *  Registered by CatalogService alongside the role resolver. */
export type TechnologyTreatmentResolver = (technologyId: string) => string | null;

let _techTreatmentResolver: TechnologyTreatmentResolver | null = null;

export function setTechnologyTreatmentResolver(resolver: TechnologyTreatmentResolver | null): void {
  _techTreatmentResolver = resolver;
}

export interface ContainerTypeDefinition {
  id: string;
  label: string;
  description: string;
  icon: string;
  layer: 'infrastructure' | 'orchestration' | 'runtime' | 'logical';
  containerStyle: ContainerStyle;
  canContain: string[] | CanContainRule;
  defaultMetadata: Record<string, unknown>;
  metadataSchema: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    label: string;
    description: string;
    required?: boolean;
    default?: unknown;
  }>;
}

let _containerTypes: ContainerTypeDefinition[] = STATIC_CONTAINER_TYPE_DATA;
let _containerIndex: Map<string, ContainerTypeDefinition> | null = null;
let _roleResolver: RoleResolver | null = null;

function invalidateIndex(): void {
  _containerIndex = null;
}

function ensureIndex(): Map<string, ContainerTypeDefinition> {
  if (!_containerIndex) {
    _containerIndex = new Map();
    for (const ct of _containerTypes) {
      _containerIndex.set(ct.id, ct);
    }
  }
  return _containerIndex;
}

export const BUILTIN_CONTAINER_TYPES: ContainerTypeDefinition[] = new Proxy([] as ContainerTypeDefinition[], {
  get(_target, prop, receiver) {
    return Reflect.get(_containerTypes, prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(_containerTypes, prop);
  },
  ownKeys() {
    return Reflect.ownKeys(_containerTypes);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(_containerTypes, prop);
  },
});

export function getContainerTypeById(id: string): ContainerTypeDefinition | undefined {
  if (!id) return undefined;
  const index = ensureIndex();
  const direct = index.get(id);
  if (direct) return direct;
  // M4: table-free dotted tolerance — a replayed hash-chained patch can still carry
  // `cloud.vpc`, whose last segment IS the role id under the retired grammar.
  if (id.includes('.')) return index.get(id.split('.').pop()!);
  return undefined;
}

/** M4: node.type IS the role id. Dotted values from replayed patches resolve by their last
 *  segment — table-free tolerance, the same rule the rest of the read boundary uses. */
export function resolveContainerRoleId(id: string): string {
  if (!id.includes('.')) return id;
  const tail = id.split('.').pop()!;
  return ensureIndex().has(tail) ? tail : id;
}

/** N8.4b-1c: the provider a node belongs to — its technology's prefix wins (aws-vpc →
 *  aws), else the role's own provider column (the platform roles carry it). */
export function providerOfNode(info: { provider?: string | null } | null | undefined, technology?: string): string | null {
  if (technology) {
    const inferred = inferProviderFromId(technology);
    if (inferred) return inferred;
  }
  // N8.4c-1: the role's provider COLUMN goes through the same family mapping, so a
  // legacy `firebase` platform container and a firebase-* child agree on 'gcp'. Fixing
  // only the prefix side would have swapped one refusal for another.
  const declared = info?.provider ?? null;
  return normalizeProviderFamily(declared);
}

export function canContainerHoldNode(
  containerId: string,
  nodeType: string,
  roleResolver?: RoleResolver,
  nodeTechnology?: string,
  containerTechnology?: string,
): boolean {
  const containerDef = getContainerTypeById(containerId);

  // M4: node.type IS the role id (N9a). Dotted values can still arrive from a replayed
  // hash-chained patch, so the last segment is tried — table-free tolerance, no map.
  const resolvedType = nodeType.includes('.') ? nodeType.split('.').pop()! : nodeType;
  const resolver = roleResolver || _roleResolver;
  const info = resolver ? (resolver(resolvedType) || resolver(nodeType)) : null;
  const containerInfo = resolver ? resolver(containerId) : null;

  // ── ONTOLOGY INVARIANT: PROVIDER COHERENCE (owner CRITICAL 2026-07-27) ─────────────
  // "Azure services cannot be contained by AWS projects… azure nodes are still allowed
  // as children within aws nodes like AWS-VPC."
  // Evaluated BEFORE any enumeration and before the unknown-container permissive
  // fallback, so no path can bypass it. Two parts:
  //   (a) cross-provider containment is refused at ANY depth — an azure-* node cannot
  //       live inside an aws-* container. The generic container ROLES (vpc, subnet,
  //       k8s-cluster…) enumerate role ids with no provider awareness whatsoever, so
  //       `vpc` happily admitted a `k8s-cluster` regardless of whose cloud each was in;
  //       the provider now comes from the NODES' technologies, not the roles.
  //   (b) N8.4g-3 (owner ruling, supersedes the platform-in-platform special case):
  //       a platform is operated by its VENDOR — nothing HOSTS it. A platform child
  //       is refused in EVERY container except a purely organizational logical group
  //       (N5.16: only logical Structure is organizational; every other container
  //       carries hosting semantics). Covers Supabase (Managed) inside Docker, an
  //       AWS account inside an AWS account, and every case in between.
  const childProvider = providerOfNode(info, nodeTechnology);
  const containerProvider = providerOfNode(containerInfo, containerTechnology);
  if (childProvider && containerProvider && childProvider !== containerProvider) return false;
  // M1b: keyed on containerStyle, NOT on the container's nature. A deployment_container
  // (docker, vpc, k8s) is nature='build' just like a logical group is, so testing nature
  // here would have let a platform nest inside Docker — the exact case N8.4g-3 refuses.
  // "Purely organizational" IS containerStyle='logical-boundary' (N5.16).
  if (info?.nature === 'host' && containerInfo && containerInfo.containerStyle !== 'logical-boundary') return false;

  if (!containerDef) return true;

  // N2.3 precedence — treatment BEFORE any enumeration (V2_TASKS N2.3; §1.F.1). A child
  // whose EFFECTIVE treatment is boundary (role default, or raised by a boundary-engine
  // technology like n8n/NiFi) is an engine NodeSpec places — hand-enumerated canContain
  // lists never get to veto it. Placement inference then decides scopes vs hosts.
  // Leaf and container children fall through to the existing rules unchanged.
  if (info?.treatmentMode !== 'container') {
    const techOverride = nodeTechnology && _techTreatmentResolver ? _techTreatmentResolver(nodeTechnology) : null;
    if (effectiveTreatment(info?.treatmentMode ?? 'leaf', techOverride) === 'boundary') {
      return true;
    }
  }

  const rules = containerDef.canContain;

  if (Array.isArray(rules)) {
    if (rules.length === 0) return false;
    return rules.includes(resolvedType) || rules.includes(nodeType);
  }

  const rule = rules as CanContainRule;

  if (rule.roleIds && rule.roleIds.length > 0) {
    if (rule.roleIds.includes(resolvedType) || rule.roleIds.includes(nodeType)) {
      return true;
    }
  }

  if (info) {
    if (rule.natures && rule.natures.length > 0 && info.nature && rule.natures.includes(info.nature)) {
      return true;
    }
    if (rule.interfaceKinds && rule.interfaceKinds.length > 0 && info.interfaceKind && rule.interfaceKinds.includes(info.interfaceKind)) {
      return true;
    }
    if (rule.providers && rule.providers.length > 0 && info.provider && rule.providers.includes(normalizeProviderFamily(info.provider)!)) {
      return true;
    }
  }

  if (rule.providers && rule.providers.length > 0 && nodeTechnology) {
    const inferredProvider = inferProviderFromId(nodeTechnology);
    if (inferredProvider && rule.providers.includes(inferredProvider)) {
      return true;
    }
  }

  const noListsDefined = (!rule.roleIds || rule.roleIds.length === 0) &&
    (!rule.natures || rule.natures.length === 0) &&
    (!rule.interfaceKinds || rule.interfaceKinds.length === 0) &&
    (!rule.providers || rule.providers.length === 0);
  if (noListsDefined) return false;

  return false;
}

// M6: the prefix + family tables moved to provider-inference.ts — this file held one of
// FOUR copies, two of which were missing the family mapping. See that file for the two
// defects the duplication caused.

export function setRoleResolver(resolver: RoleResolver | null): void {
  _roleResolver = resolver;
}

/** N8.6(A): read access to the registered role resolver — the connect-time contract
 *  inference needs the target role's interfaceKind. Null before catalog hydration
 *  (callers fall back to the generic rest/request_response inference). */
export function resolveRoleInfo(roleId: string): RoleInfo | null {
  if (!_roleResolver) return null;
  return _roleResolver(roleId);
}

export function hasCanContainRules(def: { canContain: string[] | CanContainRule }): boolean {
  if (Array.isArray(def.canContain)) return def.canContain.length > 0;
  const rule = def.canContain;
  return !!(
    (rule.roleIds && rule.roleIds.length > 0) ||
    (rule.natures && rule.natures.length > 0) ||
    (rule.interfaceKinds && rule.interfaceKinds.length > 0) ||
    (rule.providers && rule.providers.length > 0)
  );
}

export function getCanContainRoleIds(def: { canContain: string[] | CanContainRule }): string[] {
  if (Array.isArray(def.canContain)) return def.canContain;
  return def.canContain.roleIds || [];
}

export function getContainersByLayer(layer: ContainerTypeDefinition['layer']): ContainerTypeDefinition[] {
  return _containerTypes.filter(ct => ct.layer === layer);
}

export function populateContainerTypes(types: ContainerTypeDefinition[]): void {
  _containerTypes = types;
  invalidateIndex();
}

export function isContainerTypesPopulated(): boolean {
  return _containerTypes !== STATIC_CONTAINER_TYPE_DATA;
}

export function getContainerTypes(): ContainerTypeDefinition[] {
  return _containerTypes;
}
