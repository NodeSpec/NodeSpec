import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from '../ui/services/TemplateService.js';
import type { PersistenceService } from '../ui/services/PersistenceService.js';
import type { TemplateRepository } from '../persistence/ports.js';
import type { ProjectTemplate, TemplateUsage, RepositoryResult } from '../persistence/types.js';
import type { Graph, Node, Contract, Edge, Artifact } from '@nodespec/core/types.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';

function createTestGraph(): Graph {
  const nodeAId = '11111111-1111-1111-1111-111111111111';
  const nodeBId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const edgeId = '44444444-4444-4444-4444-444444444444';
  const artifactId = '55555555-5555-5555-5555-555555555555';
  const portAId = '66666666-6666-6666-6666-666666666666';
  const portBId = '77777777-7777-7777-7777-777777777777';
  const groupId = '88888888-8888-8888-8888-888888888888';

  const graph = createEmptyGraph();

  graph.nodes[nodeAId] = {
    id: nodeAId,
    type: 'service',
    label: 'API Service',
    metadata: {},
    ports: [
      { id: portAId, direction: 'out', name: 'out', contractId },
    ],
    artifacts: [artifactId],
  } as Node;

  graph.nodes[nodeBId] = {
    id: nodeBId,
    type: 'database',
    label: 'PostgreSQL',
    metadata: {},
    ports: [
      { id: portBId, direction: 'in', name: 'in', contractId },
    ],
  } as Node;

  graph.contracts[contractId] = {
    id: contractId,
    kind: 'sql',
    name: 'DB Connection',
    schema: {},
    metadata: {},
  } as Contract;

  graph.edges[edgeId] = {
    id: edgeId,
    source: nodeAId,
    target: nodeBId,
    sourcePortId: portAId,
    targetPortId: portBId,
    contractId,
    label: 'queries',
    metadata: {},
  } as Edge;

  graph.artifacts[artifactId] = {
    id: artifactId,
    nodeId: nodeAId,
    kind: 'source',
    path: 'src/api/index.ts',
    content: 'export default {}',
    language: 'typescript',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  } as Artifact;

  graph.nodeGroups = {
    [groupId]: {
      id: groupId,
      label: 'Backend',
      nodeIds: [nodeAId, nodeBId],
      metadata: {},
    },
  };

  return graph;
}

function createTestTemplate(overrides?: Partial<ProjectTemplate>): ProjectTemplate {
  return {
    id: generateUUID(),
    name: 'Test SaaS Template',
    slug: 'test-saas',
    description: 'A test SaaS architecture',
    category: 'saas',
    graphData: createTestGraph(),
    templateSpecification: null,
    thumbnailUrl: null,
    tags: ['typescript', 'postgresql'],
    technologies: ['tech-1', 'tech-2'],
    nodeCount: 2,
    edgeCount: 1,
    authorType: 'official',
    authorId: null,
    isPublic: true,
    isFeatured: true,
    useCount: 42,
    upvoteCount: 0,
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function ok<T>(data: T): RepositoryResult<T> {
  return { success: true, data };
}

function err(message: string): RepositoryResult<never> {
  return { success: false, error: { code: 'DB_ERROR', message } };
}

function createMockTemplateRepo(): TemplateRepository {
  return {
    getById: vi.fn(),
    getBySlug: vi.fn(),
    list: vi.fn(),
    listByAuthor: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    recordUsage: vi.fn(),
    getUsageByUser: vi.fn(),
  };
}

function createMockPersistence(templateRepo: TemplateRepository): PersistenceService {
  const projectRepo = {
    create: vi.fn().mockResolvedValue(ok({
      id: 'new-project-id',
      name: 'From Template',
      ownerId: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    getById: vi.fn(),
    listByOwner: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const branchRepo = {
    create: vi.fn().mockResolvedValue(ok({
      id: 'new-branch-id',
      projectId: 'new-project-id',
      name: 'main',
      baseSnapshotId: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
    })),
    getById: vi.fn(),
    getByName: vi.fn(),
    listByProject: vi.fn(),
    update: vi.fn().mockImplementation((_id, updates) =>
      Promise.resolve(ok({
        id: 'new-branch-id',
        projectId: 'new-project-id',
        name: 'main',
        baseSnapshotId: updates.baseSnapshotId ?? null,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
      }))
    ),
    delete: vi.fn(),
  };

  const graphRepo = {
    loadSnapshot: vi.fn(),
    loadSnapshotById: vi.fn(),
    saveSnapshot: vi.fn().mockResolvedValue(ok({
      id: 'new-snapshot-id',
      projectId: 'new-project-id',
      branchId: 'new-branch-id',
      graphData: createEmptyGraph(),
      version: 1,
      hash: 'abc123',
      createdAt: new Date().toISOString(),
      patchSequence: 0,
    })),
    listSnapshots: vi.fn(),
    deleteSnapshot: vi.fn(),
  };

  // Chainable stub for the raw Supabase client used by
  // TemplateService.overwriteProjectWithTemplate to purge project-scoped
  // rows: supabase.from(table).delete().eq(column, value) is awaited.
  const supabaseStub = {
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: null, error: null })),
      })),
    })),
  };

  return {
    getTemplateRepository: () => templateRepo,
    getProjectRepository: () => projectRepo,
    getBranchRepository: () => branchRepo,
    getGraphRepository: () => graphRepo,
    getSupabaseClient: () => supabaseStub,
  } as unknown as PersistenceService;
}

describe('TemplateService', () => {
  let templateRepo: ReturnType<typeof createMockTemplateRepo>;
  let persistence: PersistenceService;
  let service: TemplateService;

  beforeEach(() => {
    templateRepo = createMockTemplateRepo();
    persistence = createMockPersistence(templateRepo);
    service = new TemplateService(persistence);
  });

  describe('listTemplates', () => {
    it('returns templates from repository with default filters', async () => {
      const templates = [createTestTemplate(), createTestTemplate({ slug: 'other' })];
      vi.mocked(templateRepo.list).mockResolvedValue(ok(templates));

      const result = await service.listTemplates();

      expect(result).toHaveLength(2);
      expect(templateRepo.list).toHaveBeenCalledWith(undefined);
    });

    it('passes filter parameters through to repository', async () => {
      vi.mocked(templateRepo.list).mockResolvedValue(ok([]));

      await service.listTemplates({ category: 'saas', tags: ['react'], sortBy: 'popular' });

      expect(templateRepo.list).toHaveBeenCalledWith({
        category: 'saas',
        tags: ['react'],
        sortBy: 'popular',
      });
    });

    it('throws on repository error', async () => {
      vi.mocked(templateRepo.list).mockResolvedValue(err('Connection failed'));

      await expect(service.listTemplates()).rejects.toThrow('Connection failed');
    });
  });

  describe('getTemplate', () => {
    it('returns a single template by ID', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));

      const result = await service.getTemplate(template.id);

      expect(result).toEqual(template);
      expect(templateRepo.getById).toHaveBeenCalledWith(template.id);
    });

    it('returns null when template does not exist', async () => {
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(null));

      const result = await service.getTemplate('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getTemplateBySlug', () => {
    it('returns a template by slug', async () => {
      const template = createTestTemplate({ slug: 'my-saas' });
      vi.mocked(templateRepo.getBySlug).mockResolvedValue(ok(template));

      const result = await service.getTemplateBySlug('my-saas');

      expect(result).toEqual(template);
      expect(templateRepo.getBySlug).toHaveBeenCalledWith('my-saas');
    });
  });

  describe('getFeaturedTemplates', () => {
    it('delegates to listTemplates with featured filter', async () => {
      vi.mocked(templateRepo.list).mockResolvedValue(ok([]));

      await service.getFeaturedTemplates();

      expect(templateRepo.list).toHaveBeenCalledWith({
        isFeatured: true,
        sortBy: 'featured',
      });
    });
  });

  describe('getTemplatesByCategory', () => {
    it('delegates to listTemplates with category filter', async () => {
      vi.mocked(templateRepo.list).mockResolvedValue(ok([]));

      await service.getTemplatesByCategory('microservices');

      expect(templateRepo.list).toHaveBeenCalledWith({
        category: 'microservices',
        sortBy: 'popular',
      });
    });
  });

  describe('searchTemplates', () => {
    it('delegates to listTemplates with search filter', async () => {
      vi.mocked(templateRepo.list).mockResolvedValue(ok([]));

      await service.searchTemplates('react dashboard');

      expect(templateRepo.list).toHaveBeenCalledWith({
        search: 'react dashboard',
      });
    });
  });

  describe('useTemplate', () => {
    it('creates a new project seeded from the template graph', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'usage-1',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'My Project', 'user-1');

      expect(result.project.project.id).toBe('new-project-id');
      expect(result.project.branch.name).toBe('main');
      expect(result.usage.templateId).toBe(template.id);

      const projectRepo = persistence.getProjectRepository();
      expect(projectRepo.create).toHaveBeenCalledWith('My Project', 'user-1', {
        sourceTemplateId: template.id,
        sourceTemplateSlug: template.slug,
      });

      const graphRepo = persistence.getGraphRepository();
      expect(graphRepo.saveSnapshot).toHaveBeenCalled();
    });

    it('generates fresh UUIDs for all graph entities', async () => {
      const template = createTestTemplate();
      const originalNodeIds = Object.keys(template.graphData.nodes);
      const originalEdgeIds = Object.keys(template.graphData.edges);
      const originalContractIds = Object.keys(template.graphData.contracts);
      const originalArtifactIds = Object.keys(template.graphData.artifacts);

      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'usage-1',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'Fresh Project', 'user-1');
      const clonedGraph = result.project.graph;

      const clonedNodeIds = Object.keys(clonedGraph.nodes);
      const clonedEdgeIds = Object.keys(clonedGraph.edges);
      const clonedContractIds = Object.keys(clonedGraph.contracts);
      const clonedArtifactIds = Object.keys(clonedGraph.artifacts);

      expect(clonedNodeIds).toHaveLength(originalNodeIds.length);
      expect(clonedEdgeIds).toHaveLength(originalEdgeIds.length);
      expect(clonedContractIds).toHaveLength(originalContractIds.length);
      expect(clonedArtifactIds).toHaveLength(originalArtifactIds.length);

      for (const oldId of originalNodeIds) {
        expect(clonedNodeIds).not.toContain(oldId);
      }
      for (const oldId of originalEdgeIds) {
        expect(clonedEdgeIds).not.toContain(oldId);
      }
      for (const oldId of originalContractIds) {
        expect(clonedContractIds).not.toContain(oldId);
      }
      for (const oldId of originalArtifactIds) {
        expect(clonedArtifactIds).not.toContain(oldId);
      }

      expect(clonedGraph.id).not.toBe(template.graphData.id);
    });

    it('preserves structural relationships with remapped IDs', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'usage-1',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'Structural', 'user-1');
      const g = result.project.graph;

      const edge = Object.values(g.edges)[0];
      expect(g.nodes[edge.source]).toBeDefined();
      expect(g.nodes[edge.target]).toBeDefined();
      expect(g.contracts[edge.contractId]).toBeDefined();

      if (edge.sourcePortId) {
        const sourceNode = g.nodes[edge.source];
        const port = sourceNode.ports?.find(p => p.id === edge.sourcePortId);
        expect(port).toBeDefined();
      }

      if (edge.targetPortId) {
        const targetNode = g.nodes[edge.target];
        const port = targetNode.ports?.find(p => p.id === edge.targetPortId);
        expect(port).toBeDefined();
      }

      const artifact = Object.values(g.artifacts)[0];
      expect(g.nodes[artifact.nodeId]).toBeDefined();

      const nodeWithArtifacts = Object.values(g.nodes).find(n => (n.artifacts ?? []).length > 0);
      if (nodeWithArtifacts) {
        for (const artId of nodeWithArtifacts.artifacts!) {
          expect(g.artifacts[artId]).toBeDefined();
        }
      }
    });

    it('preserves node groups with remapped node IDs', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'usage-1',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'Groups', 'user-1');
      const g = result.project.graph;

      expect(g.nodeGroups).toBeDefined();
      const groups = Object.values(g.nodeGroups!);
      expect(groups).toHaveLength(1);

      const group = groups[0];
      expect(group.label).toBe('Backend');
      expect(group.nodeIds).toHaveLength(2);
      for (const nodeId of group.nodeIds) {
        expect(g.nodes[nodeId]).toBeDefined();
      }

      const originalGroupIds = Object.keys(template.graphData.nodeGroups!);
      const clonedGroupIds = Object.keys(g.nodeGroups!);
      for (const oldId of originalGroupIds) {
        expect(clonedGroupIds).not.toContain(oldId);
      }
    });

    it('records template usage and increments use count', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'usage-1',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      await service.useTemplate(template.id, 'My Project', 'user-1');

      expect(templateRepo.recordUsage).toHaveBeenCalledWith(
        template.id,
        'user-1',
        'new-project-id'
      );
    });

    it('throws when template not found', async () => {
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(null));

      await expect(
        service.useTemplate('nonexistent', 'Project', 'user-1')
      ).rejects.toThrow('Template not found');
    });

    it('throws on repository error during template fetch', async () => {
      vi.mocked(templateRepo.getById).mockResolvedValue(err('Network error'));

      await expect(
        service.useTemplate('some-id', 'Project', 'user-1')
      ).rejects.toThrow('Network error');
    });
  });

  describe('overwriteProjectWithTemplate', () => {
    it('saves a fresh graph snapshot to existing project', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'usage-2',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'existing-project',
        createdAt: new Date().toISOString(),
      }));

      const graph = await service.overwriteProjectWithTemplate(
        template.id,
        'existing-project',
        'existing-branch',
        'user-1'
      );

      const graphRepo = persistence.getGraphRepository();
      expect(graphRepo.saveSnapshot).toHaveBeenCalledWith(
        'existing-project',
        'existing-branch',
        graph,
        0
      );

      expect(templateRepo.recordUsage).toHaveBeenCalledWith(
        template.id,
        'user-1',
        'existing-project'
      );

      const originalNodeIds = Object.keys(template.graphData.nodes);
      const newNodeIds = Object.keys(graph.nodes);
      for (const oldId of originalNodeIds) {
        expect(newNodeIds).not.toContain(oldId);
      }
    });

    it('throws when template not found', async () => {
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(null));

      await expect(
        service.overwriteProjectWithTemplate('bad-id', 'proj', 'branch', 'user')
      ).rejects.toThrow('Template not found');
    });
  });

  describe('getMyTemplates', () => {
    it('returns templates authored by the user', async () => {
      const templates = [
        createTestTemplate({ authorType: 'community', authorId: 'user-1' }),
      ];
      vi.mocked(templateRepo.listByAuthor).mockResolvedValue(ok(templates));

      const result = await service.getMyTemplates('user-1');

      expect(result).toHaveLength(1);
      expect(templateRepo.listByAuthor).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getMyUsageHistory', () => {
    it('returns usage records for the user', async () => {
      const usage: TemplateUsage[] = [
        {
          id: 'usage-1',
          templateId: 'template-1',
          userId: 'user-1',
          projectId: 'proj-1',
          createdAt: new Date().toISOString(),
        },
      ];
      vi.mocked(templateRepo.getUsageByUser).mockResolvedValue(ok(usage));

      const result = await service.getMyUsageHistory('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].templateId).toBe('template-1');
    });
  });

  describe('cloneGraphWithFreshIds (via useTemplate)', () => {
    it('handles graph with no nodeGroups', async () => {
      const graph = createTestGraph();
      delete (graph as any).nodeGroups;
      const template = createTestTemplate({ graphData: graph });

      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'u1',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'No Groups', 'user-1');

      expect(result.project.graph.nodeGroups).toBeUndefined();
    });

    it('handles empty graph gracefully', async () => {
      const emptyGraph = createEmptyGraph();
      const template = createTestTemplate({ graphData: emptyGraph });

      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'u2',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'Empty', 'user-1');
      const g = result.project.graph;

      expect(Object.keys(g.nodes)).toHaveLength(0);
      expect(Object.keys(g.edges)).toHaveLength(0);
      expect(Object.keys(g.contracts)).toHaveLength(0);
      expect(Object.keys(g.artifacts)).toHaveLength(0);
    });

    it('handles nodes with parentId relationships', async () => {
      const graph = createTestGraph();
      const parentId = Object.keys(graph.nodes)[0];
      const childId = Object.keys(graph.nodes)[1];
      graph.nodes[childId] = { ...graph.nodes[childId], parentId };
      const template = createTestTemplate({ graphData: graph });

      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'u3',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result = await service.useTemplate(template.id, 'Parent', 'user-1');
      const g = result.project.graph;

      const childNode = Object.values(g.nodes).find(n => n.parentId !== undefined);
      expect(childNode).toBeDefined();
      expect(g.nodes[childNode!.parentId!]).toBeDefined();
    });

    it('produces unique IDs across multiple clones', async () => {
      const template = createTestTemplate();
      vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
      vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
        id: 'u',
        templateId: template.id,
        userId: 'user-1',
        projectId: 'new-project-id',
        createdAt: new Date().toISOString(),
      }));

      const result1 = await service.useTemplate(template.id, 'Clone 1', 'user-1');
      const result2 = await service.useTemplate(template.id, 'Clone 2', 'user-1');

      const ids1 = Object.keys(result1.project.graph.nodes);
      const ids2 = Object.keys(result2.project.graph.nodes);

      for (const id of ids1) {
        expect(ids2).not.toContain(id);
      }
    });
  });
});
