import type { Graph, Precondition } from './types.js';
import { CURRENT_GRAPH_SCHEMA_VERSION } from './schemas.js';

export function computeHash(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

export function checkPrecondition(graph: Graph, precondition: Precondition): boolean {
  const value = getValueAtPath(graph, precondition.path);

  switch (precondition.type) {
    case 'hash_match':
      return computeHash(value) === precondition.expected;
    case 'value_exists':
      return value !== undefined;
    case 'value_equals':
      return JSON.stringify(value) === JSON.stringify(precondition.expected);
    default:
      return false;
  }
}

export function createEmptyGraph(id?: string): Graph {
  return {
    id: id ?? generateUUID(),
    schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
    version: 0,
    hash: computeHash({}),
    nodes: {},
    edges: {},
    contracts: {},
    artifacts: {},
    metadata: {},
  };
}

export function updateGraphHash(graph: Graph): Graph {
  const { hash: _, ...graphWithoutHash } = graph;
  return {
    ...graph,
    hash: computeHash(graphWithoutHash),
  };
}

export function now(): string {
  return new Date().toISOString();
}

export function computeContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}
