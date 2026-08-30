// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
import { describe, it, expect } from 'vitest';
import {
  validateCompleteness,
  canMarkNodeComplete,
  canMarkContractComplete,
  canMarkArtifactComplete,
  isDraftEntity,
  isCompleteEntity,
  scaffoldNodeFromTemplate,
  createContractStub,
  createArtifactStub,
} from '@nodespec/core/draft-semantics.js';
import { NODE_TEMPLATES, getTemplateById } from '@nodespec/core/templates.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import { createPatchMetadata } from '@nodespec/core/patch-factory.js';
import type { Node, Contract, Artifact, PatchOperation } from '@nodespec/core/types.js';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';

function createTestNode(overrides: Partial<Node> = {}): Node {
  return {
    id: NODE_ID,
    type: 'service',
    label: 'Test Service',
    ports: [
      { id: '11111111-0001-4001-8001-000000000001', name: 'in', direction: 'in' },
      { id: '11111111-0002-4002-8002-000000000002', name: 'out', direction: 'out' },
    ],
    artifacts: [],
    metadata: {},
    status: 'draft',
    ...overrides,
  };
}

function createTestContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: CONTRACT_ID,
    kind: 'rest',
    name: 'Test Contract',
    schema: {},
    metadata: {},
    status: 'draft',
    ...overrides,
  };
}

function createTestArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: ARTIFACT_ID,
    nodeId: NODE_ID,
    kind: 'source',
    path: 'src/index.ts',
    content: 'export const test = 1;',
    contentHash: 'abc123',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    metadata: {},
    status: 'draft',
    ...overrides,
  };
}

describe('Draft Semantics', () => {
  describe('validateCompleteness', () => {
    it('should return empty warnings for graph with complete entities', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode({ status: 'complete', label: 'Valid Service' });
      graph.artifacts[ARTIFACT_ID] = createTestArtifact({ status: 'complete', content: 'code' });
      graph.contracts[CONTRACT_ID] = createTestContract({ status: 'complete', name: 'Valid Contract' });

      const warnings = validateCompleteness(graph);
      expect(warnings).toHaveLength(0);
    });

    it('should return warnings for nodes with missing labels', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode({ label: 'New Node' });

      const warnings = validateCompleteness(graph);
      expect(warnings.some(w => w.entityType === 'node' && w.field === 'label')).toBe(true);
    });

    it('should return warnings for contracts without schemas', () => {
      const graph = createEmptyGraph();
      graph.contracts[CONTRACT_ID] = createTestContract({ schema: {} });

      const warnings = validateCompleteness(graph);
      expect(warnings.some(w => w.entityType === 'contract' && w.field === 'schema')).toBe(true);
    });

    it('should return warnings for artifacts with empty content', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode();
      graph.artifacts[ARTIFACT_ID] = createTestArtifact({ content: '' });

      const warnings = validateCompleteness(graph);
      expect(warnings.some(w => w.entityType === 'artifact' && w.field === 'content')).toBe(true);
    });

    it('should skip complete entities', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode({ status: 'complete', label: 'New Node' });

      const warnings = validateCompleteness(graph);
      const nodeWarnings = warnings.filter(w => w.entityId === NODE_ID);
      expect(nodeWarnings).toHaveLength(0);
    });
  });

  describe('canMarkNodeComplete', () => {
    it('should allow marking complete when requirements are met', () => {
      const graph = createEmptyGraph();
      const node = createTestNode({ label: 'Valid Service Name' });
      graph.nodes[NODE_ID] = node;
      graph.artifacts[ARTIFACT_ID] = createTestArtifact({ content: 'code' });

      const result = canMarkNodeComplete(node, graph);
      expect(result.canComplete).toBe(true);
      expect(result.missingRequirements).toHaveLength(0);
    });

    it('should not allow marking complete when label is invalid', () => {
      const graph = createEmptyGraph();
      const node = createTestNode({ label: 'New Node' });
      graph.nodes[NODE_ID] = node;

      const result = canMarkNodeComplete(node, graph);
      expect(result.canComplete).toBe(false);
      expect(result.missingRequirements.length).toBeGreaterThan(0);
    });
  });

  describe('canMarkContractComplete', () => {
    it('should allow marking complete when name is valid', () => {
      const contract = createTestContract({ name: 'User API Contract' });
      const result = canMarkContractComplete(contract);
      expect(result.canComplete).toBe(true);
    });

    it('should not allow marking complete when name is stub', () => {
      const contract = createTestContract({ name: 'Stub: Contract' });
      const result = canMarkContractComplete(contract);
      expect(result.canComplete).toBe(false);
    });
  });

  describe('canMarkArtifactComplete', () => {
    it('should allow marking complete when content is non-empty', () => {
      const artifact = createTestArtifact({ content: 'export const x = 1;' });
      const result = canMarkArtifactComplete(artifact);
      expect(result.canComplete).toBe(true);
    });

    it('should not allow marking complete when content is empty', () => {
      const artifact = createTestArtifact({ content: '' });
      const result = canMarkArtifactComplete(artifact);
      expect(result.canComplete).toBe(false);
    });
  });

  describe('isDraftEntity / isCompleteEntity', () => {
    it('should identify draft entities', () => {
      expect(isDraftEntity({ status: 'draft' })).toBe(true);
      expect(isDraftEntity({ status: undefined })).toBe(true);
      expect(isDraftEntity({})).toBe(true);
    });

    it('should identify complete entities', () => {
      expect(isCompleteEntity({ status: 'complete' })).toBe(true);
      expect(isCompleteEntity({ status: 'draft' })).toBe(false);
      expect(isCompleteEntity({})).toBe(false);
    });
  });

  describe('scaffoldNodeFromTemplate', () => {
    it('should create a node with all template defaults', () => {
      const template = NODE_TEMPLATES.find(t => t.id === 'web.rest-api')!;
      const nodeId = NODE_ID;

      const result = scaffoldNodeFromTemplate(template, nodeId);

      expect(result.node.id).toBe(nodeId);
      expect(result.node.type).toBe('web.rest-api');
      expect(result.node.status).toBe('draft');
      expect(result.node.ports?.length).toBe(2);
      expect(result.contracts.length).toBe(1);
    });

    it('should create draft ports', () => {
      const template = NODE_TEMPLATES[0];
      const result = scaffoldNodeFromTemplate(template, NODE_ID);

      for (const port of result.node.ports ?? []) {
        expect(port.status).toBe('draft');
      }
    });

    it('should create draft contracts', () => {
      const template = NODE_TEMPLATES[0];
      const result = scaffoldNodeFromTemplate(template, NODE_ID);

      for (const contract of result.contracts) {
        expect(contract.status).toBe('draft');
        expect(contract.name.startsWith('Stub:')).toBe(true);
      }
    });
  });

  describe('createContractStub', () => {
    it('should create a draft contract stub', () => {
      const contract = createContractStub(CONTRACT_ID, 'rest', 'API Contract');

      expect(contract.id).toBe(CONTRACT_ID);
      expect(contract.status).toBe('draft');
      expect(contract.name).toBe('Stub: API Contract');
      expect(contract.metadata?.isStub).toBe(true);
    });
  });

  describe('createArtifactStub', () => {
    it('should create a draft artifact stub', () => {
      const timestamp = '2024-01-01T00:00:00.000Z';
      const artifact = createArtifactStub(ARTIFACT_ID, NODE_ID, 'source', 'src/index.ts', timestamp);

      expect(artifact.id).toBe(ARTIFACT_ID);
      expect(artifact.nodeId).toBe(NODE_ID);
      expect(artifact.status).toBe('draft');
      expect(artifact.content).toBe('');
      expect(artifact.metadata?.isStub).toBe(true);
    });
  });
});

describe('Scaffolding Patch Operations', () => {
  describe('create_node_from_template', () => {
    it('should apply scaffold patch and create draft entities', () => {
      const template = NODE_TEMPLATES.find(t => t.id === 'web.rest-api')!;
      const scaffolded = scaffoldNodeFromTemplate(template, NODE_ID);
      const graph = createEmptyGraph();

      const patch: PatchOperation = {
        type: 'create_node_from_template',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Create REST service from template',
        }),
        payload: {
          templateId: 'web.rest-api',
          nodeId: NODE_ID,
          node: scaffolded.node,
          contracts: scaffolded.contracts,
        },
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph!.nodes[NODE_ID]).toBeDefined();
      expect(result.graph!.nodes[NODE_ID].status).toBe('draft');
      for (const contract of scaffolded.contracts) {
        expect(result.graph!.contracts[contract.id]).toBeDefined();
        expect(result.graph!.contracts[contract.id].status).toBe('draft');
      }
    });

    it('should fail if node already exists', () => {
      const template = NODE_TEMPLATES[0];
      const scaffolded = scaffoldNodeFromTemplate(template, NODE_ID);
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode();

      const patch: PatchOperation = {
        type: 'create_node_from_template',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'test' }),
        payload: {
          templateId: template.id,
          nodeId: NODE_ID,
          node: scaffolded.node,
          contracts: scaffolded.contracts,
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_EXISTS');
    });
  });

  describe('instantiate_contract_stub', () => {
    it('should create draft contract stub', () => {
      const graph = createEmptyGraph();
      const contract = createContractStub(CONTRACT_ID, 'kafka', 'Event Schema');

      const patch: PatchOperation = {
        type: 'instantiate_contract_stub',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Create contract stub' }),
        payload: contract,
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph!.contracts[CONTRACT_ID]).toBeDefined();
      expect(result.graph!.contracts[CONTRACT_ID].status).toBe('draft');
    });
  });

  describe('attach_artifact_stub', () => {
    it('should create draft artifact stub attached to node', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode();
      const artifact = createArtifactStub(ARTIFACT_ID, NODE_ID, 'source', 'src/main.ts', '2024-01-01T00:00:00.000Z');

      const patch: PatchOperation = {
        type: 'attach_artifact_stub',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Attach artifact stub' }),
        payload: artifact,
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph!.artifacts[ARTIFACT_ID]).toBeDefined();
      expect(result.graph!.artifacts[ARTIFACT_ID].status).toBe('draft');
    });

    it('should fail if node does not exist', () => {
      const graph = createEmptyGraph();
      const artifact = createArtifactStub(ARTIFACT_ID, NODE_ID, 'source', 'src/main.ts', '2024-01-01T00:00:00.000Z');

      const patch: PatchOperation = {
        type: 'attach_artifact_stub',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Attach artifact stub' }),
        payload: artifact,
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_NOT_FOUND');
    });
  });

  describe('mark_entity_complete', () => {
    it('should mark node as complete', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode({ status: 'draft' });

      const patch: PatchOperation = {
        type: 'mark_entity_complete',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Mark node complete' }),
        payload: {
          entityType: 'node',
          entityId: NODE_ID,
        },
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph!.nodes[NODE_ID].status).toBe('complete');
    });

    it('should mark contract as complete', () => {
      const graph = createEmptyGraph();
      graph.contracts[CONTRACT_ID] = createTestContract({ status: 'draft' });

      const patch: PatchOperation = {
        type: 'mark_entity_complete',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Mark contract complete' }),
        payload: {
          entityType: 'contract',
          entityId: CONTRACT_ID,
        },
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph!.contracts[CONTRACT_ID].status).toBe('complete');
    });

    it('should mark artifact as complete', () => {
      const graph = createEmptyGraph();
      graph.nodes[NODE_ID] = createTestNode();
      graph.artifacts[ARTIFACT_ID] = createTestArtifact({ status: 'draft' });

      const patch: PatchOperation = {
        type: 'mark_entity_complete',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Mark artifact complete' }),
        payload: {
          entityType: 'artifact',
          entityId: ARTIFACT_ID,
        },
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph!.artifacts[ARTIFACT_ID].status).toBe('complete');
    });

    it('should mark port as complete', () => {
      const graph = createEmptyGraph();
      const portId = '11111111-0001-4001-8001-000000000001';
      graph.nodes[NODE_ID] = createTestNode({
        ports: [{ id: portId, name: 'in', direction: 'in', status: 'draft' }],
      });

      const patch: PatchOperation = {
        type: 'mark_entity_complete',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Mark port complete' }),
        payload: {
          entityType: 'port',
          entityId: portId,
          nodeId: NODE_ID,
        },
      };

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      const port = result.graph!.nodes[NODE_ID].ports?.find(p => p.id === portId);
      expect(port?.status).toBe('complete');
    });

    it('should fail if entity does not exist', () => {
      const graph = createEmptyGraph();

      const patch: PatchOperation = {
        type: 'mark_entity_complete',
        metadata: createPatchMetadata({ actorType: 'human', summary: 'Mark node complete' }),
        payload: {
          entityType: 'node',
          entityId: NODE_ID,
        },
      };

      const result = applyPatch(graph, patch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_NOT_FOUND');
    });
  });
});

describe('Draft to Complete Transitions via Branch Replay', () => {
  it('should maintain draft status through patch replay', () => {
    const template = NODE_TEMPLATES[0];
    const scaffolded = scaffoldNodeFromTemplate(template, NODE_ID);
    let graph = createEmptyGraph();

    const createPatch: PatchOperation = {
      type: 'create_node_from_template',
      metadata: createPatchMetadata({ actorType: 'human', summary: 'Create from template' }),
      payload: {
        templateId: template.id,
        nodeId: NODE_ID,
        node: scaffolded.node,
        contracts: scaffolded.contracts,
      },
    };

    let result = applyPatch(graph, createPatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.nodes[NODE_ID].status).toBe('draft');

    const completePatch: PatchOperation = {
      type: 'mark_entity_complete',
      metadata: createPatchMetadata({ actorType: 'human', summary: 'Mark complete' }),
      payload: {
        entityType: 'node',
        entityId: NODE_ID,
      },
    };

    result = applyPatch(graph, completePatch);
    expect(result.success).toBe(true);
    expect(result.graph!.nodes[NODE_ID].status).toBe('complete');
  });
});

describe('Template Registry', () => {
  it('should have required templates', () => {
    expect(NODE_TEMPLATES.length).toBeGreaterThanOrEqual(3);

    const templateIds = NODE_TEMPLATES.map(t => t.id);
    expect(templateIds).toContain('web.rest-api');
    expect(templateIds).toContain('messaging.rabbitmq');
    expect(templateIds).toContain('frontend.react');
  });

  it('should find templates by id', () => {
    const template = getTemplateById('web.rest-api');
    expect(template).toBeDefined();
    expect(template?.nodeType).toBe('web.rest-api');
  });

  it('should support legacy template IDs via mapping', () => {
    const template = getTemplateById('rest-service');
    expect(template).toBeDefined();
    expect(template?.nodeType).toBe('web.rest-api');
  });

  it('should have valid template structures', () => {
    for (const template of NODE_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.nodeType).toBeTruthy();
      // Not all node types have default ports (e.g., databases, caches)
      expect(template.defaultPorts).toBeDefined();
      expect(template.artifactPlaceholders.length).toBeGreaterThan(0);
    }
  });
});
