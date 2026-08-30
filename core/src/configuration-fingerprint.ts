import type { Node, Graph, Artifact } from './types.js';
import type {
  NodeDomainMetadata,
  WebServiceMetadata,
  FrontendMetadata,
  DatabaseMetadata,
  AuthServiceMetadata,
  CacheMetadata,
  MessageQueueMetadata,
  ManagedServiceMetadata,
} from './node-metadata.js';
import { extractNodeDomainMetadata } from './node-metadata.js';
import { getNodeTypeById } from './node-types.js';
import { computeHash } from './utils.js';

export interface ConfigurationFingerprint {
  fingerprint: string;
  timestamp: string;
  fields: Record<string, unknown>;
}

export interface ConfigurationStaleness {
  nodeId: string;
  status: 'in_sync' | 'config_ahead' | 'no_artifacts' | 'no_config';
  currentFingerprint: ConfigurationFingerprint | null;
  lastArtifactFingerprint: ConfigurationFingerprint | null;
  changedFields: string[];
  message: string;
}

const WEB_SERVICE_CONFIG_FIELDS: (keyof WebServiceMetadata)[] = [
  'language', 'framework', 'runtime', 'version', 'port', 'baseUrl',
  'cors', 'rateLimit', 'authStrategy', 'healthCheckPath',
  'path', 'playground', 'depthLimit', 'complexityLimit', 'subscriptions',
  'reflection', 'deadlineMs', 'streaming', 'loadBalancing',
  'pingInterval', 'maxConnections', 'perMessageDeflate',
];

const FRONTEND_CONFIG_FIELDS: (keyof FrontendMetadata)[] = [
  'framework', 'frameworkVersion', 'language', 'buildTool',
  'deploymentType', 'packageManager', 'devServerPort',
  'stateManagement', 'styling', 'router',
];

const DATABASE_CONFIG_FIELDS: (keyof DatabaseMetadata)[] = [
  'dbType', 'version', 'host', 'port', 'database',
  'connectionPoolSize', 'backupStrategy',
];

const AUTH_SERVICE_CONFIG_FIELDS: (keyof AuthServiceMetadata)[] = [
  'provider', 'language', 'framework', 'mfaEnabled',
];

const CACHE_CONFIG_FIELDS: (keyof CacheMetadata)[] = [
  'cacheType', 'language', 'host', 'port', 'ttl',
  'maxSize', 'evictionPolicy', 'clusterMode', 'persistenceEnabled',
];

const MESSAGE_QUEUE_CONFIG_FIELDS: (keyof MessageQueueMetadata)[] = [
  'queueType', 'host', 'port',
];

const MANAGED_SERVICE_CONFIG_FIELDS: (keyof ManagedServiceMetadata)[] = [
  'provider', 'region', 'tier', 'version', 'port',
];

function getBaseConfigFields(metadataType: string): string[] {
  switch (metadataType) {
    case 'web-service': return [...WEB_SERVICE_CONFIG_FIELDS];
    case 'frontend': return [...FRONTEND_CONFIG_FIELDS];
    case 'database': return [...DATABASE_CONFIG_FIELDS];
    case 'auth-service': return [...AUTH_SERVICE_CONFIG_FIELDS];
    case 'cache': return [...CACHE_CONFIG_FIELDS];
    case 'message-queue': return [...MESSAGE_QUEUE_CONFIG_FIELDS];
    case 'managed-service': return [...MANAGED_SERVICE_CONFIG_FIELDS];
    default: return [];
  }
}

export function getConfigRelevantFields(
  nodeType: string,
  domainMetadata: NodeDomainMetadata,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const baseFields = getBaseConfigFields(domainMetadata.type);
  const data = domainMetadata.data as unknown as Record<string, unknown>;

  for (const key of baseFields) {
    if (data[key] !== undefined) {
      fields[key] = data[key];
    }
  }

  const typeDef = getNodeTypeById(nodeType);
  if (typeDef?.metadataSchema) {
    for (const key of Object.keys(typeDef.metadataSchema)) {
      if (data[key] !== undefined && !(key in fields)) {
        fields[key] = data[key];
      }
    }
  }

  if (typeDef?.defaultMetadata) {
    for (const key of Object.keys(typeDef.defaultMetadata)) {
      if (data[key] !== undefined && !(key in fields)) {
        fields[key] = data[key];
      }
    }
  }

  return fields;
}

export function computeConfigFingerprint(
  nodeType: string,
  metadata: Record<string, unknown>,
): ConfigurationFingerprint {
  // N5.5: metadata.config (the schema-driven DynamicMetadataForm values) is the live
  // configuration representation — its edits MUST move the fingerprint so packet
  // freshness (C1) catches them. domainMetadata stays as read-compat for old nodes.
  const config = metadata.config as Record<string, unknown> | undefined;
  const configFields: Record<string, unknown> = {};
  if (config && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      configFields[`config.${key}`] = value;
    }
  }

  const domainMeta = metadata.domainMetadata as NodeDomainMetadata | undefined;
  const legacyFields = (domainMeta && domainMeta.type && domainMeta.data)
    ? getConfigRelevantFields(nodeType, domainMeta)
    : {};

  const fields = { ...legacyFields, ...configFields };

  return {
    fingerprint: computeHash(fields),
    timestamp: new Date().toISOString(),
    fields,
  };
}

function findChangedFields(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
): string[] {
  const allKeys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const changed: string[] = [];

  for (const key of allKeys) {
    const a = JSON.stringify(current[key] ?? null);
    const b = JSON.stringify(previous[key] ?? null);
    if (a !== b) {
      changed.push(key);
    }
  }

  return changed.sort();
}

export function assessConfigStaleness(node: Node, graph: Graph): ConfigurationStaleness {
  const domainMetadata = extractNodeDomainMetadata(node.metadata);

  if (!domainMetadata) {
    return {
      nodeId: node.id,
      status: 'no_config',
      currentFingerprint: null,
      lastArtifactFingerprint: null,
      changedFields: [],
      message: 'No configuration metadata found on this node.',
    };
  }

  const currentFingerprint = computeConfigFingerprint(
    node.type,
    node.metadata ?? {},
  );

  const nodeArtifactIds = node.artifacts ?? [];
  const realArtifacts: Artifact[] = [];

  for (const aid of nodeArtifactIds) {
    const artifact = graph.artifacts[aid];
    if (artifact && artifact.status !== 'suggested') {
      realArtifacts.push(artifact);
    }
  }

  if (realArtifacts.length === 0) {
    return {
      nodeId: node.id,
      status: 'no_artifacts',
      currentFingerprint,
      lastArtifactFingerprint: null,
      changedFields: [],
      message: 'Configuration exists but no code artifacts have been generated yet.',
    };
  }

  let lastArtifactFingerprint: ConfigurationFingerprint | null = null;

  for (const artifact of realArtifacts) {
    const meta = artifact.metadata as Record<string, unknown> | undefined;
    if (meta?.lastConfigFingerprint) {
      const stored = meta.lastConfigFingerprint as ConfigurationFingerprint;
      if (
        !lastArtifactFingerprint ||
        stored.timestamp > lastArtifactFingerprint.timestamp
      ) {
        lastArtifactFingerprint = stored;
      }
    }
  }

  if (!lastArtifactFingerprint) {
    return {
      nodeId: node.id,
      status: 'config_ahead',
      currentFingerprint,
      lastArtifactFingerprint: null,
      changedFields: Object.keys(currentFingerprint.fields).sort(),
      message: 'Artifacts exist but were generated before configuration tracking was enabled.',
    };
  }

  if (currentFingerprint.fingerprint === lastArtifactFingerprint.fingerprint) {
    return {
      nodeId: node.id,
      status: 'in_sync',
      currentFingerprint,
      lastArtifactFingerprint,
      changedFields: [],
      message: 'Configuration matches the last artifact generation.',
    };
  }

  const changedFields = findChangedFields(
    currentFingerprint.fields,
    lastArtifactFingerprint.fields,
  );

  return {
    nodeId: node.id,
    status: 'config_ahead',
    currentFingerprint,
    lastArtifactFingerprint,
    changedFields,
    message: `Configuration has changed since last artifact generation. Changed fields: ${changedFields.join(', ')}.`,
  };
}
