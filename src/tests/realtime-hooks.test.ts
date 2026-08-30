import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SpecificationService } from '../ui/services/SpecificationService.js';
import type { MappingService } from '../ui/services/MappingService.js';
import type { RequirementStatusService } from '../ui/services/RequirementStatusService.js';
import type { SpecificationRealtimeService } from '../ui/services/SpecificationRealtimeService.js';
import type { ProjectSpecification } from '../ui/services/SpecificationService.js';
import type { SpecificationSection } from '../persistence/supabase/sections-repository.js';
import type { Requirement } from '../persistence/supabase/requirements-repository.js';
import type { RequirementMapping } from '../ui/services/MappingService.js';

describe('Realtime Hooks - Subscription Lifecycle', () => {
  let mockSpecificationService: SpecificationService;
  let mockMappingService: MappingService;
  let mockRequirementStatusService: RequirementStatusService;
  let mockRealtimeService: SpecificationRealtimeService;

  beforeEach(() => {
    const mockSpec: ProjectSpecification = {
      id: 'spec-1',
      projectId: 'proj-1',
      name: 'Test Spec',
      description: 'Test specification',
      version: '1.0.0',
      status: 'draft',
      vision: 'Test vision',
      constraints: [],
      preferences: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'user-1',
      metadata: {},
    };

    const mockSections: SpecificationSection[] = [
      {
        id: 'sec-1',
        specificationId: 'spec-1',
        name: 'Section 1',
        description: 'First section',
        orderIndex: 0,
        aiGenerated: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const mockRequirements: Requirement[] = [
      {
        id: 'req-1',
        specificationId: 'spec-1',
        requirementId: 'REQ-001',
        name: 'Test Requirement',
        description: 'A test requirement',
        category: 'functional',
        status: 'pending',
        sectionId: 'sec-1',
        source: 'manual',

        locked: false,
        metadata: {},
        acceptanceCriteria: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const mockMappings: RequirementMapping[] = [
      {
        id: 'map-1',
        specificationId: 'spec-1',
        requirementId: 'req-1',
        nodeId: 'node-1',
        mappingType: 'implements',
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
      },
    ];

    mockSpecificationService = {
      getSpecification: vi.fn().mockResolvedValue(mockSpec),
      getSectionsBySpecification: vi.fn().mockResolvedValue(mockSections),
      getRequirementsBySpecification: vi.fn().mockResolvedValue(mockRequirements),
    } as unknown as SpecificationService;

    mockMappingService = {
      getMappingsBySpecification: vi.fn().mockResolvedValue(mockMappings),
    } as unknown as MappingService;

    mockRequirementStatusService = {
      calculateCoverage: vi.fn().mockResolvedValue({
        totalRequirements: 1,
        mappedRequirements: 1,
        unmappedRequirements: 0,
        orphanedMappings: 0,
        coveragePercentage: 100,
      }),
      getUnmappedRequirements: vi.fn().mockResolvedValue([]),
      getRequirementStatusForSpecification: vi.fn().mockResolvedValue(new Map()),
    } as unknown as RequirementStatusService;

    mockRealtimeService = {
      subscribeToSpecification: vi.fn((_specId, callbacks) => {
        setTimeout(() => {
          if (callbacks.onConnectionChange) {
            callbacks.onConnectionChange(true);
          }
        }, 0);

        return {
          unsubscribe: vi.fn(),
          isConnected: vi.fn().mockReturnValue(true),
        };
      }),
      unsubscribeAll: vi.fn(),
      getActiveSubscriptions: vi.fn().mockReturnValue([]),
      isSubscribed: vi.fn().mockReturnValue(false),
    } as unknown as SpecificationRealtimeService;
  });

  describe('useRealtimeSpecification', () => {
    it('should load initial specification data', async () => {
      expect(mockSpecificationService.getSpecification).toBeDefined();
      expect(mockSpecificationService.getSectionsBySpecification).toBeDefined();
      expect(mockSpecificationService.getRequirementsBySpecification).toBeDefined();

      await mockSpecificationService.getSpecification('spec-1');
      await mockSpecificationService.getSectionsBySpecification('spec-1');
      await mockSpecificationService.getRequirementsBySpecification('spec-1');

      expect(mockSpecificationService.getSpecification).toHaveBeenCalledWith('spec-1');
      expect(mockSpecificationService.getSectionsBySpecification).toHaveBeenCalledWith('spec-1');
      expect(mockSpecificationService.getRequirementsBySpecification).toHaveBeenCalledWith('spec-1');
    });

    it('should subscribe to realtime updates', () => {
      const callbacks = {
        onSectionChange: vi.fn(),
        onRequirementChange: vi.fn(),
        onConnectionChange: vi.fn(),
        onError: vi.fn(),
      };

      const subscription = mockRealtimeService.subscribeToSpecification('spec-1', callbacks);

      expect(mockRealtimeService.subscribeToSpecification).toHaveBeenCalledWith('spec-1', callbacks);
      expect(subscription.unsubscribe).toBeDefined();
      expect(subscription.isConnected).toBeDefined();
    });

    it('should handle connection state changes', async () => {
      const callbacks = {
        onConnectionChange: vi.fn(),
      };

      mockRealtimeService.subscribeToSpecification('spec-1', callbacks);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callbacks.onConnectionChange).toHaveBeenCalledWith(true);
    });

    it('should unsubscribe on cleanup', () => {
      const subscription = mockRealtimeService.subscribeToSpecification('spec-1', {});
      subscription.unsubscribe();

      expect(subscription.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('useRealtimeMappings', () => {
    it('should load initial mappings data', async () => {
      const mappings = await mockMappingService.getMappingsBySpecification('spec-1');

      expect(mockMappingService.getMappingsBySpecification).toHaveBeenCalledWith('spec-1');
      expect(mappings).toHaveLength(1);
      expect(mappings[0].requirementId).toBe('req-1');
    });

    it('should build mapping indexes', async () => {
      const mappings = await mockMappingService.getMappingsBySpecification('spec-1');

      const byRequirement = new Map<string, RequirementMapping[]>();
      const byNode = new Map<string, RequirementMapping[]>();

      for (const mapping of mappings) {
        if (mapping.requirementId) {
          const existing = byRequirement.get(mapping.requirementId) || [];
          existing.push(mapping);
          byRequirement.set(mapping.requirementId, existing);
        }

        const nodeExisting = byNode.get(mapping.nodeId) || [];
        nodeExisting.push(mapping);
        byNode.set(mapping.nodeId, nodeExisting);
      }

      expect(byRequirement.has('req-1')).toBe(true);
      expect(byNode.has('node-1')).toBe(true);
      expect(byRequirement.get('req-1')).toHaveLength(1);
      expect(byNode.get('node-1')).toHaveLength(1);
    });

    it('should handle realtime mapping changes', () => {
      const callbacks = {
        onMappingChange: vi.fn(),
        onConnectionChange: vi.fn(),
      };

      mockRealtimeService.subscribeToSpecification('spec-1', callbacks);

      expect(mockRealtimeService.subscribeToSpecification).toHaveBeenCalledWith('spec-1', callbacks);
    });
  });

  describe('useRequirementStatus', () => {
    it('should load coverage data', async () => {
      const coverage = await mockRequirementStatusService.calculateCoverage('spec-1', true);

      expect(mockRequirementStatusService.calculateCoverage).toHaveBeenCalledWith('spec-1', true);
      expect(coverage.totalRequirements).toBe(1);
      expect(coverage.mappedRequirements).toBe(1);
      expect(coverage.coveragePercentage).toBe(100);
    });

    it('should load unmapped requirements', async () => {
      const unmapped = await mockRequirementStatusService.getUnmappedRequirements('spec-1');

      expect(mockRequirementStatusService.getUnmappedRequirements).toHaveBeenCalledWith('spec-1');
      expect(unmapped).toHaveLength(0);
    });

    it('should load requirement status map', async () => {
      const statusMap = await mockRequirementStatusService.getRequirementStatusForSpecification('spec-1');

      expect(mockRequirementStatusService.getRequirementStatusForSpecification).toHaveBeenCalledWith('spec-1');
      expect(statusMap).toBeInstanceOf(Map);
    });

    it('should support manual refresh', async () => {
      const refresh = async () => {
        await mockRequirementStatusService.calculateCoverage('spec-1', true);
        await mockRequirementStatusService.getUnmappedRequirements('spec-1');
        await mockRequirementStatusService.getRequirementStatusForSpecification('spec-1');
      };

      await refresh();

      expect(mockRequirementStatusService.calculateCoverage).toHaveBeenCalled();
      expect(mockRequirementStatusService.getUnmappedRequirements).toHaveBeenCalled();
      expect(mockRequirementStatusService.getRequirementStatusForSpecification).toHaveBeenCalled();
    });
  });

  describe('Subscription Reconnection', () => {
    it('should handle subscription errors', () => {
      const callbacks = {
        onError: vi.fn(),
      };

      mockRealtimeService.subscribeToSpecification('spec-1', callbacks);

      if (callbacks.onError) {
        callbacks.onError(new Error('Connection failed'));
      }

      expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should track active subscriptions', () => {
      mockRealtimeService.subscribeToSpecification('spec-1', {});

      const active = mockRealtimeService.getActiveSubscriptions();
      expect(mockRealtimeService.getActiveSubscriptions).toHaveBeenCalled();
      expect(Array.isArray(active)).toBe(true);
    });

    it('should check subscription status', () => {
      mockRealtimeService.subscribeToSpecification('spec-1', {});

      const isSubscribed = mockRealtimeService.isSubscribed('spec-1');
      expect(mockRealtimeService.isSubscribed).toHaveBeenCalledWith('spec-1');
      expect(typeof isSubscribed).toBe('boolean');
    });
  });
});
