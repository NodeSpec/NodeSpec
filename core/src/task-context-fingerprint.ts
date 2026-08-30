import type { Graph } from './types.js';
import { computeHash } from './utils.js';

export interface TaskContextFingerprint {
  fingerprint: string;
  timestamp: string;
  fields: TaskContextFields;
}

export interface TaskContextFields {
  nodeRole: string;
  nodeTechnology: string | null;
  edgeSignatures: string[];
  requirementSignatures: string[];
  connectedNodeSignatures: string[];
  /** R6 parity gesture with the server fingerprint (Discovered #9). NOTE:
   *  this client mirror is ALREADY divergent from the server implementation
   *  (no configSignature, different edge-signature layout and hash fn, and
   *  its call sites pass no requirements) — staleness verdicts are
   *  SERVER-AUTHORITATIVE (packet-freshness / get_build_readiness); this
   *  module is a UI hint only. Full reconciliation deferred (D-series/N11). */
  visionHash: string;
}

export interface TaskStaleness {
  nodeId: string;
  status: 'in_sync' | 'stale' | 'no_task_document';
  currentFingerprint: TaskContextFingerprint | null;
  storedFingerprint: TaskContextFingerprint | null;
  changedAreas: string[];
  message: string;
}

export function computeTaskContextFingerprint(
  nodeId: string,
  graph: Graph,
  mappedRequirementIds?: string[],
  requirementTexts?: Record<string, string>,
  vision?: string,
): TaskContextFingerprint {
  const node = graph.nodes[nodeId];
  if (!node) {
    return {
      fingerprint: computeHash({}),
      timestamp: new Date().toISOString(),
      fields: { nodeRole: '', nodeTechnology: null, edgeSignatures: [], requirementSignatures: [], connectedNodeSignatures: [], visionHash: '' },
    };
  }

  const edgeSignatures: string[] = [];
  const connectedNodeSignatures: string[] = [];
  const seenConnected = new Set<string>();

  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;

    const contract = graph.contracts[edge.contractId];
    const contractKind = contract?.kind || 'unknown';
    const contractName = contract?.name || '';
    const interactionKind = contract?.interactionKind || '';
    const transport = contract?.transport || '';

    let schemaHash = '';
    if (contract && 'schemaRef' in contract && (contract as Record<string, unknown>).schemaRef) {
      const schemaArtifact = graph.artifacts[(contract as Record<string, unknown>).schemaRef as string];
      if (schemaArtifact?.content) {
        schemaHash = computeHash(schemaArtifact.content);
      }
    }

    edgeSignatures.push(`${edge.id}:${contractKind}:${interactionKind}:${transport}:${contractName}:${schemaHash}`);

    const connectedId = edge.source === nodeId ? edge.target : edge.source;
    if (!seenConnected.has(connectedId)) {
      seenConnected.add(connectedId);
      const connected = graph.nodes[connectedId];
      if (connected) {
        connectedNodeSignatures.push(`${connected.label}:${connected.type}:${connected.technology || ''}`);
      }
    }
  }

  const requirementSignatures: string[] = [];
  if (mappedRequirementIds) {
    for (const reqId of mappedRequirementIds.sort()) {
      const text = requirementTexts?.[reqId] || '';
      requirementSignatures.push(`${reqId}:${text}`);
    }
  }

  const fields: TaskContextFields = {
    nodeRole: node.type,
    nodeTechnology: node.technology ?? null,
    edgeSignatures: edgeSignatures.sort(),
    requirementSignatures: requirementSignatures.sort(),
    connectedNodeSignatures: connectedNodeSignatures.sort(),
    visionHash: vision ? computeHash(vision) : '',
  };

  return {
    fingerprint: computeHash(fields),
    timestamp: new Date().toISOString(),
    fields,
  };
}

export function assessTaskStaleness(
  nodeId: string,
  graph: Graph,
  mappedRequirementIds?: string[],
  requirementTexts?: Record<string, string>,
): TaskStaleness {
  const node = graph.nodes[nodeId];
  if (!node) {
    return { nodeId, status: 'no_task_document', currentFingerprint: null, storedFingerprint: null, changedAreas: [], message: 'Node not found' };
  }

  const taskArtifactId = (node.artifacts || []).find((aid: string) => {
    const a = graph.artifacts[aid];
    return a && a.kind === 'task';
  });

  if (!taskArtifactId) {
    const taskFromGraph = Object.values(graph.artifacts).find(
      (a) => a.nodeId === nodeId && a.kind === 'task'
    );
    if (!taskFromGraph) {
      return { nodeId, status: 'no_task_document', currentFingerprint: null, storedFingerprint: null, changedAreas: [], message: 'No task document exists for this node' };
    }

    return assessWithArtifact(taskFromGraph, nodeId, graph, mappedRequirementIds, requirementTexts);
  }

  const taskArtifact = graph.artifacts[taskArtifactId];
  if (!taskArtifact) {
    return { nodeId, status: 'no_task_document', currentFingerprint: null, storedFingerprint: null, changedAreas: [], message: 'Task artifact not found' };
  }

  return assessWithArtifact(taskArtifact, nodeId, graph, mappedRequirementIds, requirementTexts);
}

function assessWithArtifact(
  taskArtifact: { metadata?: Record<string, unknown> },
  nodeId: string,
  graph: Graph,
  mappedRequirementIds?: string[],
  requirementTexts?: Record<string, string>,
): TaskStaleness {
  const current = computeTaskContextFingerprint(nodeId, graph, mappedRequirementIds, requirementTexts);

  const stored = taskArtifact.metadata?.taskContextFingerprint as TaskContextFingerprint | undefined;
  if (!stored) {
    return {
      nodeId,
      status: 'stale',
      currentFingerprint: current,
      storedFingerprint: null,
      changedAreas: ['fingerprint missing'],
      message: 'Task document has no context fingerprint -- it may be out of date',
    };
  }

  if (stored.fingerprint === current.fingerprint) {
    return {
      nodeId,
      status: 'in_sync',
      currentFingerprint: current,
      storedFingerprint: stored,
      changedAreas: [],
      message: 'Task document is up to date',
    };
  }

  const changedAreas = detectChangedAreas(current.fields, stored.fields);

  return {
    nodeId,
    status: 'stale',
    currentFingerprint: current,
    storedFingerprint: stored,
    changedAreas,
    message: `Task document is stale -- ${changedAreas.join(', ')} changed since it was generated`,
  };
}

function detectChangedAreas(current: TaskContextFields, stored: TaskContextFields): string[] {
  const areas: string[] = [];

  if (current.nodeRole !== stored.nodeRole) areas.push('node role');
  if (current.nodeTechnology !== stored.nodeTechnology) areas.push('technology');
  if (JSON.stringify(current.edgeSignatures) !== JSON.stringify(stored.edgeSignatures)) areas.push('contracts');
  if (JSON.stringify(current.requirementSignatures) !== JSON.stringify(stored.requirementSignatures)) areas.push('requirements');
  if (JSON.stringify(current.connectedNodeSignatures) !== JSON.stringify(stored.connectedNodeSignatures)) areas.push('connected components');
  if ((current.visionHash ?? '') !== (stored.visionHash ?? '')) areas.push('project vision');

  return areas.length > 0 ? areas : ['context'];
}
