import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from '../ui/services/TemplateService.js';
import { ProjectService } from '../ui/services/ProjectService.js';
import type { PersistenceService } from '../ui/services/PersistenceService.js';
import type { TemplateRepository } from '../persistence/ports.js';
import type {
  ProjectTemplate,
  RepositoryResult,
  TemplateSpecification,
} from '../persistence/types.js';
import type { Graph, Node, Contract, Edge, Artifact } from '@nodespec/core/types.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';

function ok<T>(data: T): RepositoryResult<T> {
  return { success: true, data };
}

function err(message: string): RepositoryResult<never> {
  return { success: false, error: { code: 'DB_ERROR', message } };
}

function createTestGraph(): Graph {
  const nodeAId = '11111111-1111-1111-1111-111111111111';
  const nodeBId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const edgeId = '44444444-4444-4444-4444-444444444444';
  const artifactId = '55555555-5555-5555-5555-555555555555';
  const portAId = '66666666-6666-6666-6666-666666666666';
  const portBId = '77777777-7777-7777-7777-777777777777';

  const graph = createEmptyGraph();

  graph.nodes[nodeAId] = {
    id: nodeAId,
    type: 'service',
    label: 'API Service',
    metadata: {},
    ports: [{ id: portAId, direction: 'out', name: 'out', contractId }],
    artifacts: [artifactId],
  } as Node;

  graph.nodes[nodeBId] = {
    id: nodeBId,
    type: 'database',
    label: 'PostgreSQL',
    metadata: {},
    ports: [{ id: portBId, direction: 'in', name: 'in', contractId }],
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

  return graph;
}

function createTestTemplateSpecification(): TemplateSpecification {
  return {
    vision: 'A full-stack web application on AWS',
    preferences: {
      languages: ['TypeScript'],
      frameworks: ['React', 'Express'],
      databases: ['PostgreSQL'],
      deploymentTarget: 'aws',
      architecturePattern: 'monolith',
    },
    requirements: [
      {
        requirementId: 'REQ-001',
        name: 'Secure Login',
        description: 'Users must authenticate via OAuth',
        category: 'functional',
        acceptanceCriteria: [{ text: 'Login with email/password works' }],
        metadata: {},
      },
      {
        requirementId: 'REQ-002',
        name: 'Session Management',
        description: 'JWT-based sessions with refresh tokens',
        category: 'technical',
        acceptanceCriteria: [{ text: 'Tokens expire after 1 hour' }],
        metadata: {},
      },
    ],
    mappings: [
      {
        requirementId: 'REQ-001',
        nodeId: '11111111-1111-1111-1111-111111111111',
        mappingType: 'implements',
        confidence: 0.9,
        notes: 'API handles auth',
      },
    ],
  };
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

function createFullMockPersistence(templateRepo: TemplateRepository) {
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
    update: vi.fn().mockImplementation((_id: string, updates: any) =>
      Promise.resolve(ok({
        id: 'new-project-id',
        name: updates.name ?? 'From Template',
        ownerId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
    ),
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
    update: vi.fn().mockImplementation((_id: string, updates: any) =>
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

  const specRepo = {
    create: vi.fn().mockResolvedValue(ok({
      id: 'spec-id',
      projectId: 'new-project-id',
      vision: 'test',
      features: [],
      constraints: [],
      preferences: {},
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    })),
    getById: vi.fn(),
    getByProjectId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const reqRepo = {
    create: vi.fn(),
    bulkCreate: vi.fn().mockImplementation((inputs: any[]) =>
      Promise.resolve(ok(inputs.map((inp: any, idx: number) => ({
        id: `req-db-${idx}`,
        specificationId: inp.specificationId,
        requirementId: inp.requirementId,
        name: inp.name,
        description: inp.description,
        category: inp.category,
        status: 'pending',
        sectionId: null,
        source: inp.source || 'manual',

        locked: false,
        acceptanceCriteria: inp.acceptanceCriteria || [],
        metadata: inp.metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))))
    ),
    getById: vi.fn(),
    getBySpecificationId: vi.fn(),
    getByRequirementId: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getUnmapped: vi.fn(),
    search: vi.fn(),
    getDependencies: vi.fn(),
  };

  const mappingsRepo = {
    create: vi.fn(),
    bulkCreate: vi.fn().mockResolvedValue(ok([])),
    getById: vi.fn(),
    getBySpecificationId: vi.fn(),
    getByNodeId: vi.fn(),
    getByRequirementId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const supabaseClient = {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  };

  const persistence = {
    getTemplateRepository: () => templateRepo,
    getProjectRepository: () => projectRepo,
    getBranchRepository: () => branchRepo,
    getGraphRepository: () => graphRepo,
    getSpecificationRepository: () => specRepo,
    getRequirementsRepository: () => reqRepo,
    getMappingsRepository: () => mappingsRepo,
    getSupabaseClient: () => supabaseClient,
  } as unknown as PersistenceService;

  return {
    persistence,
    projectRepo,
    branchRepo,
    graphRepo,
    specRepo,
    reqRepo,
    mappingsRepo,
    supabaseClient,
  };
}

describe('ProjectService.updateProject (rename)', () => {
  it('updates project name through the repository', async () => {
    const templateRepo = createMockTemplateRepo();
    const { persistence, projectRepo } = createFullMockPersistence(templateRepo);
    const service = new ProjectService(persistence);

    const result = await service.updateProject('project-123', 'New Name');

    expect(result.name).toBe('New Name');
    expect(projectRepo.update).toHaveBeenCalledWith('project-123', { name: 'New Name' });
  });

  it('throws on repository error', async () => {
    const templateRepo = createMockTemplateRepo();
    const { persistence, projectRepo } = createFullMockPersistence(templateRepo);
    projectRepo.update.mockResolvedValue(err('Permission denied'));
    const service = new ProjectService(persistence);

    await expect(service.updateProject('project-123', 'Fail')).rejects.toThrow('Permission denied');
  });

  it('preserves metadata when only updating name', async () => {
    const templateRepo = createMockTemplateRepo();
    const { persistence, projectRepo } = createFullMockPersistence(templateRepo);
    const service = new ProjectService(persistence);

    await service.updateProject('project-123', 'Renamed');

    expect(projectRepo.update).toHaveBeenCalledWith('project-123', { name: 'Renamed' });
    const callArgs = projectRepo.update.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('metadata');
  });
});

describe('TemplateService.applyTemplateSpecification', () => {
  let templateRepo: ReturnType<typeof createMockTemplateRepo>;
  let mocks: ReturnType<typeof createFullMockPersistence>;
  let service: TemplateService;

  beforeEach(() => {
    templateRepo = createMockTemplateRepo();
    mocks = createFullMockPersistence(templateRepo);
    service = new TemplateService(mocks.persistence);
  });

  it('creates specification, requirements, and mappings from template', async () => {
    const spec = createTestTemplateSpecification();
    const template: ProjectTemplate = {
      id: generateUUID(),
      name: 'AWS Template',
      slug: 'aws-test',
      description: 'test',
      category: 'saas',
      graphData: createTestGraph(),
      templateSpecification: spec,
      thumbnailUrl: null,
      tags: [],
      technologies: [],
      nodeCount: 2,
      edgeCount: 1,
      authorType: 'official',
      authorId: null,
      isPublic: true,
      isFeatured: false,
      useCount: 0,
      upvoteCount: 0,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
    vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
      id: 'usage-1',
      templateId: template.id,
      userId: 'user-1',
      projectId: 'new-project-id',
      createdAt: new Date().toISOString(),
    }));

    await service.useTemplate(template.id, 'My AWS Project', 'user-1');

    expect(mocks.specRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        vision: spec.vision,
        projectId: 'new-project-id',
        createdBy: 'user-1',
        metadata: { source: 'template' },
      })
    );

    expect(mocks.reqRepo.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: 'REQ-001',
          name: 'Secure Login',
          source: 'imported',
          category: 'functional',
        }),
        expect.objectContaining({
          requirementId: 'REQ-002',
          name: 'Session Management',
          source: 'imported',
          category: 'technical',
        }),
      ])
    );

    expect(mocks.mappingsRepo.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: 'req-db-0',
          mappingType: 'implements',
          confidence: 0.9,
        }),
      ])
    );
  });

  it('uses "imported" as the source value for requirements', async () => {
    const spec = createTestTemplateSpecification();
    const template: ProjectTemplate = {
      id: generateUUID(),
      name: 'Test',
      slug: 'test',
      description: 'test',
      category: 'saas',
      graphData: createTestGraph(),
      templateSpecification: spec,
      thumbnailUrl: null,
      tags: [],
      technologies: [],
      nodeCount: 2,
      edgeCount: 1,
      authorType: 'official',
      authorId: null,
      isPublic: true,
      isFeatured: false,
      useCount: 0,
      upvoteCount: 0,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
    vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
      id: 'u1',
      templateId: template.id,
      userId: 'user-1',
      projectId: 'new-project-id',
      createdAt: new Date().toISOString(),
    }));

    await service.useTemplate(template.id, 'Test', 'user-1');

    const bulkCreateCall = mocks.reqRepo.bulkCreate.mock.calls[0][0];
    for (const req of bulkCreateCall) {
      expect(req.source).toBe('imported');
    }
  });

  it('remaps node IDs in mappings to fresh cloned IDs', async () => {
    const spec = createTestTemplateSpecification();
    const template: ProjectTemplate = {
      id: generateUUID(),
      name: 'Remap',
      slug: 'remap',
      description: 'test',
      category: 'saas',
      graphData: createTestGraph(),
      templateSpecification: spec,
      thumbnailUrl: null,
      tags: [],
      technologies: [],
      nodeCount: 2,
      edgeCount: 1,
      authorType: 'official',
      authorId: null,
      isPublic: true,
      isFeatured: false,
      useCount: 0,
      upvoteCount: 0,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
    vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
      id: 'u1',
      templateId: template.id,
      userId: 'user-1',
      projectId: 'new-project-id',
      createdAt: new Date().toISOString(),
    }));

    const result = await service.useTemplate(template.id, 'Remap', 'user-1');

    if (mocks.mappingsRepo.bulkCreate.mock.calls.length > 0) {
      const mappingInputs = mocks.mappingsRepo.bulkCreate.mock.calls[0][0];
      for (const mapping of mappingInputs) {
        expect(mapping.nodeId).not.toBe('11111111-1111-1111-1111-111111111111');
        expect(result.project.graph.nodes[mapping.nodeId]).toBeDefined();
      }
    }
  });

  it('skips specification application when templateSpecification is null', async () => {
    const template: ProjectTemplate = {
      id: generateUUID(),
      name: 'No Spec',
      slug: 'no-spec',
      description: 'test',
      category: 'saas',
      graphData: createTestGraph(),
      templateSpecification: null,
      thumbnailUrl: null,
      tags: [],
      technologies: [],
      nodeCount: 2,
      edgeCount: 1,
      authorType: 'official',
      authorId: null,
      isPublic: true,
      isFeatured: false,
      useCount: 0,
      upvoteCount: 0,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
    vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
      id: 'u1',
      templateId: template.id,
      userId: 'user-1',
      projectId: 'new-project-id',
      createdAt: new Date().toISOString(),
    }));

    await service.useTemplate(template.id, 'No Spec', 'user-1');

    expect(mocks.specRepo.create).not.toHaveBeenCalled();
    expect(mocks.reqRepo.bulkCreate).not.toHaveBeenCalled();
  });

  it('continues gracefully when spec creation fails', async () => {
    const spec = createTestTemplateSpecification();
    const template: ProjectTemplate = {
      id: generateUUID(),
      name: 'Fail Spec',
      slug: 'fail-spec',
      description: 'test',
      category: 'saas',
      graphData: createTestGraph(),
      templateSpecification: spec,
      thumbnailUrl: null,
      tags: [],
      technologies: [],
      nodeCount: 2,
      edgeCount: 1,
      authorType: 'official',
      authorId: null,
      isPublic: true,
      isFeatured: false,
      useCount: 0,
      upvoteCount: 0,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mocks.specRepo.create.mockResolvedValue(err('Spec creation failed'));

    vi.mocked(templateRepo.getById).mockResolvedValue(ok(template));
    vi.mocked(templateRepo.recordUsage).mockResolvedValue(ok({
      id: 'u1',
      templateId: template.id,
      userId: 'user-1',
      projectId: 'new-project-id',
      createdAt: new Date().toISOString(),
    }));

    const result = await service.useTemplate(template.id, 'Fail Spec', 'user-1');
    expect(result.project.project.id).toBe('new-project-id');
    expect(mocks.reqRepo.bulkCreate).not.toHaveBeenCalled();
  });
});
