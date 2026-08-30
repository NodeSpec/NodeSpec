// P0-2: acceptance-criteria bleed in task docs.
//
// Fixture mirrors the seeded V2 Test Bench (supabase/seed.sql): REQ-001 is mapped
// to BOTH nodes (API Service + Primary Database), REQ-002 only to API Service.
// The generator receives a requirementNodeMap so it can (a) label shared
// requirements, (b) label unmapped fallback requirements as unscoped, and
// (c) bound cross-node "Satisfied by" claims to the requirement's mapped nodes.
import { describe, expect, it } from 'vitest';
import {
  generateTaskDocument,
  type TaskDocumentInput,
} from '../../supabase/functions/_shared/task-document-generator.ts';

const NODE_A = 'node-a'; // API Service
const NODE_B = 'node-b'; // Primary Database

const nodeA = {
  id: NODE_A,
  label: 'API Service',
  type: 'backend-service',
  ports: [{ name: 'DB queries', direction: 'out' as const, contractId: 'c1' }],
};

const nodeB = {
  id: NODE_B,
  label: 'Primary Database',
  type: 'database',
  ports: [{ name: 'SQL interface', direction: 'in' as const, contractId: 'c1' }],
};

const graph = {
  nodes: { [NODE_A]: nodeA, [NODE_B]: nodeB },
  edges: {
    e1: { id: 'e1', source: NODE_A, target: NODE_B, contractId: 'c1' },
  },
  contracts: {
    c1: { id: 'c1', name: 'Task storage queries', kind: 'sql' },
  },
  artifacts: {},
};

const catalogs: TaskDocumentInput['catalogs'] = {
  nodeRoles: {},
  technologies: {},
  deploymentTargets: {},
  cloudProviderPatterns: [],
  scopeArchetypes: {},
};

// Criteria deliberately contain "task" so the fuzzy keyword matcher in
// buildAcceptanceCriteriaMap attributes them to the "Task storage queries" contract.
const REQ_001 = {
  requirementId: 'REQ-001',
  name: 'Persist and retrieve tasks',
  description: 'Tasks created through the API are stored durably.',
  category: 'functional',
  status: 'pending',
  acceptanceCriteria: [
    { text: 'POST /tasks stores a task and returns its id', met: false },
    { text: 'GET /tasks/:id returns the stored task after a service restart', met: false },
  ],
};

const REQ_002 = {
  requirementId: 'REQ-002',
  name: 'Expose a REST interface',
  description: 'The service exposes REST endpoints with JSON payloads.',
  category: 'functional',
  status: 'pending',
  acceptanceCriteria: [
    { text: 'All task endpoints accept and return application/json', met: false },
  ],
};

const requirementNodeMap: Record<string, string[]> = {
  'REQ-001': [NODE_A, NODE_B],
  'REQ-002': [NODE_A],
};

// N5.7/N5.11: the bottom "Acceptance Criteria Implementation Map" section was
// deliberately removed. Attribution lives on the synthesized Implementation
// Tasks: a verified cross-node claim renders as
//   `↳ serves: REQ-xxx "..." — coordinate with <node>`
// and each criterion box carries only a `→ covered by Task Tn` back-reference.
// Camera System refinement (2026-09-01): an UNVERIFIED keyword match no longer
// routes the criterion onto the contract task at all — the criterion keeps its
// own Implement work order on this node, and the keyword hit survives only as
//   `— possible coordination point: Contract "..." (keyword signal only)`.
// The `(unverified match)` serves variant is gone from generated docs.

describe('P0-2: task-doc criteria bleed', () => {
  it('node B doc (scoped to REQ-001) contains no REQ-002 criteria and labels REQ-001 as shared', () => {
    const doc = generateTaskDocument({
      node: nodeB,
      graph,
      catalogs,
      requirements: [REQ_001],
      requirementNodeMap,
    });

    // The bleed: REQ-002 content must not appear in a node it is not mapped to.
    expect(doc).not.toContain('REQ-002');
    expect(doc).not.toContain('application/json');

    // Shared labeling: REQ-001 is also mapped to API Service.
    expect(doc).toContain('REQ-001');
    expect(doc).toContain('_Shared with: API Service — their slices live in their own task docs._');
  });

  it('node A doc labels REQ-001 shared with Primary Database, REQ-002 unlabeled (exclusive)', () => {
    const doc = generateTaskDocument({
      node: nodeA,
      graph,
      catalogs,
      requirements: [REQ_001, REQ_002],
      requirementNodeMap,
    });

    expect(doc).toContain('_Shared with: Primary Database — their slices live in their own task docs._');

    // REQ-002 is mapped only to this node: neither shared nor unscoped.
    const req002Requirements = doc.slice(doc.indexOf('### REQ-002'), doc.indexOf('## Interface Contracts'));
    expect(req002Requirements).not.toContain('Shared with');
    expect(req002Requirements).not.toContain('Unscoped');
  });

  it('bounds cross-node claims: REQ-001 keeps a verified coordinate claim, REQ-002 keeps its own work order', () => {
    const doc = generateTaskDocument({
      node: nodeA,
      graph,
      catalogs,
      requirements: [REQ_001, REQ_002],
      requirementNodeMap,
    });

    // REQ-001 is mapped to Primary Database -> the fuzzy contract match is
    // corroborated and renders as a verified serves-line with coordination.
    expect(doc).toContain(
      '↳ serves: REQ-001 "POST /tasks stores a task and returns its id" — coordinate with Primary Database'
    );
    expect(doc).toContain(
      '↳ serves: REQ-001 "GET /tasks/:id returns the stored task after a service restart" — coordinate with Primary Database'
    );

    // REQ-002 is NOT mapped to Primary Database -> the keyword hit must not
    // steer ownership: the criterion gets its own Implement work order and the
    // contract survives only as a soft coordination note (Camera System,
    // 2026-09-01 — the old path swept it onto the contract task and warned).
    expect(doc).toContain('Implement: "All task endpoints accept and return application/json"');
    expect(doc).toContain(
      '↳ serves: REQ-002 "All task endpoints accept and return application/json" — possible coordination point: Contract "Task storage queries" (sql) to Primary Database (keyword signal only)'
    );
    expect(doc).not.toContain('(unverified match)');
    expect(doc).not.toContain('verify or reassign');
  });

  it('labels requirements absent from the map as unscoped (the slice(0,10) fallback path)', () => {
    const REQ_003 = {
      requirementId: 'REQ-003',
      name: 'Unmapped requirement',
      description: 'Arrived via the unmapped fallback.',
      category: 'functional',
      status: 'pending',
      acceptanceCriteria: [{ text: 'Some criterion', met: false }],
    };

    const doc = generateTaskDocument({
      node: nodeA,
      graph,
      catalogs,
      requirements: [REQ_003],
      requirementNodeMap,
    });

    expect(doc).toContain('_Unscoped: no requirement-to-node mapping — included as fallback context._');
  });

  it('without a map (legacy input) generation still works and cross-node claims never assert', () => {
    const doc = generateTaskDocument({
      node: nodeA,
      graph,
      catalogs,
      requirements: [REQ_001, REQ_002],
    });

    // No map -> no sharing/unscoped labels (nothing to assert them from)...
    expect(doc).not.toContain('Shared with');
    expect(doc).not.toContain('Unscoped');

    // ...and no unverifiable cross-node satisfaction claims: every fuzzy
    // contract match stays this node's own Implement work order with at most
    // a soft coordination note — never a verified coordinate claim, never the
    // old self-distrusting "(unverified match)" line.
    expect(doc).toContain('Implement: "POST /tasks stores a task and returns its id"');
    expect(doc).toContain('possible coordination point: Contract "Task storage queries"');
    expect(doc).not.toContain('(unverified match)');
    expect(doc).not.toContain('— coordinate with Primary Database');
  });
});
