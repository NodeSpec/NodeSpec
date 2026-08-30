// N9b-3: the ~6,800-line static registry (node-type-data.ts) is RETIRED. Domains are
// DB-hydrated only (CatalogService → populateDomains); before hydration — or after a
// failed load — every lookup returns undefined/empty, which every consumer already
// handles, and the failed state is VISIBLE via the N9b-2 DegradedCatalogBanner
// instead of silently serving stale hardcoded data.

export interface PortTemplate {
  name: string;
  direction: 'in' | 'out';
  required?: boolean;
  schemaRef?: string;
}

export type SetupInstructionType =
  | 'account_setup'
  | 'dashboard_config'
  | 'environment_variable'
  | 'dns_config'
  | 'webhook_config'
  | 'sdk_install'
  | 'manual_workflow'
  | 'billing'
  | 'toolchain_install'
  | 'certificate'
  | 'permissions';

export interface SetupInstruction {
  title: string;
  type: SetupInstructionType;
  instructions: string;
  commands?: string[];
  url?: string;
  required: boolean;
}

export interface AIContext {
  purpose: string;
  typicalTech: string[];
  bestPractices: string[];
  antiPatterns: string[];
  setupInstructions?: SetupInstruction[];
}

export interface MetadataFieldSchema {
  /** N8.1b: 'multiselect' = checkbox list over `options`, value is string[] — the
   *  "which parts of this API/service do you use" pattern (e.g. Stripe apiAreas). */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'multiselect' | 'array' | 'object';
  label: string;
  description: string;
  required?: boolean;
  default?: unknown;
  options?: string[] | number[];
  min?: number;
  max?: number;
  pattern?: string;
}

export interface SuggestedFile {
  kind: 'source' | 'schema' | 'doc' | 'config' | 'build' | 'design';
  path: string;
  description: string;
  language?: string;
  required?: boolean;
}

export interface DomainNodeType {
  id: string;
  label: string;
  domain: string;
  description: string;
  icon: string;
  color: string;
  aiContext: AIContext;
  defaultPorts?: PortTemplate[];
  suggestedContracts?: string[];
  commonConnections?: string[];
  defaultMetadata?: Record<string, unknown>;
  metadataSchema?: Record<string, MetadataFieldSchema>;
  suggestedFiles?: SuggestedFile[];
  comingSoon?: boolean;
}

export interface NodeTypeDomain {
  id: string;
  label: string;
  description: string;
  icon: string;
  nodeTypes: DomainNodeType[];
  comingSoon?: boolean;
}

let _domains: NodeTypeDomain[] = [];
let _nodeIndex: Map<string, DomainNodeType> | null = null;
let _domainIndex: Map<string, NodeTypeDomain> | null = null;

function invalidateIndexes(): void {
  _nodeIndex = null;
  _domainIndex = null;
}

function ensureNodeIndex(): Map<string, DomainNodeType> {
  if (!_nodeIndex) {
    _nodeIndex = new Map();
    for (const domain of _domains) {
      for (const nt of domain.nodeTypes) {
        _nodeIndex.set(nt.id, nt);
      }
    }
  }
  return _nodeIndex;
}

function ensureDomainIndex(): Map<string, NodeTypeDomain> {
  if (!_domainIndex) {
    _domainIndex = new Map();
    for (const domain of _domains) {
      _domainIndex.set(domain.id, domain);
    }
  }
  return _domainIndex;
}

export const DOMAIN_NODE_TYPES: NodeTypeDomain[] = new Proxy([] as NodeTypeDomain[], {
  get(_target, prop, receiver) {
    return Reflect.get(_domains, prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(_domains, prop);
  },
  ownKeys() {
    return Reflect.ownKeys(_domains);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(_domains, prop);
  },
});

export function getNodeTypeDomains(): NodeTypeDomain[] {
  return _domains;
}

export function getNodeTypeById(id: string): DomainNodeType | undefined {
  return ensureNodeIndex().get(id);
}

export function getDomainById(id: string): NodeTypeDomain | undefined {
  return ensureDomainIndex().get(id);
}

export function getAllNodeTypes(): DomainNodeType[] {
  return _domains.flatMap(d => d.nodeTypes);
}

export function populateDomains(domains: NodeTypeDomain[]): void {
  _domains = domains;
  invalidateIndexes();
}

export function isCatalogPopulated(): boolean {
  return _domains.length > 0;
}


