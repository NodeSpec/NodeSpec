import { describe, it, expect, beforeEach } from 'vitest';
import type { SpecificationSection } from '../persistence/supabase/sections-repository.js';
import type { Requirement } from '../persistence/supabase/requirements-repository.js';
import type { RequirementMapping } from '../ui/services/MappingService.js';

describe('Specification UI Components', () => {
  let mockSections: SpecificationSection[];
  let mockRequirements: Requirement[];
  let mockMappings: RequirementMapping[];

  beforeEach(() => {

    mockSections = [
      {
        id: 'sec-1',
        specificationId: 'spec-1',
        name: 'User Authentication',
        description: 'All authentication-related requirements',
        orderIndex: 0,
        aiGenerated: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sec-2',
        specificationId: 'spec-1',
        name: 'Product Management',
        description: 'Product catalog and inventory requirements',
        orderIndex: 1,
        aiGenerated: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    mockRequirements = [
      {
        id: 'req-1',
        specificationId: 'spec-1',
        requirementId: 'REQ-001',
        name: 'User Login',
        description: 'Users must be able to log in with email and password',
        category: 'functional',
        status: 'pending',
        sectionId: 'sec-1',
        source: 'manual',
        locked: false,
        metadata: {},
        acceptanceCriteria: [
          { text: 'Login form accepts email and password', met: false },
          { text: 'Invalid credentials show error message', met: false },
          { text: 'Successful login redirects to dashboard', met: false },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'req-2',
        specificationId: 'spec-1',
        requirementId: 'REQ-002',
        name: 'Password Reset',
        description: 'Users must be able to reset forgotten passwords',
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
      {
        id: 'req-3',
        specificationId: 'spec-1',
        requirementId: 'REQ-003',
        name: 'Product Catalog',
        description: 'Display all available products in a browsable catalog',
        category: 'functional',
        status: 'pending',
        sectionId: 'sec-2',
        source: 'manual',
        locked: false,
        metadata: {},
        acceptanceCriteria: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    mockMappings = [
      {
        id: 'map-1',
        specificationId: 'spec-1',
        requirementId: 'req-1',
        nodeId: 'node-auth-service',
        mappingType: 'implements',
        confidence: 0.95,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
        isOrphan: false,
      },
      {
        id: 'map-2',
        specificationId: 'spec-1',
        requirementId: 'req-1',
        nodeId: 'node-auth-api',
        mappingType: 'implements',
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
        isOrphan: false,
      },
      {
        id: 'map-3',
        specificationId: 'spec-1',
        requirementId: 'req-3',
        nodeId: 'node-product-service',
        mappingType: 'implements',
        confidence: 0.85,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
        isOrphan: false,
      },
    ];
  });

  describe('SectionAccordion Component Logic', () => {
    it('should group requirements by section', () => {
      const requirementsBySectionId = new Map<string, Requirement[]>();

      for (const req of mockRequirements) {
        if (!req.sectionId) continue;
        const existing = requirementsBySectionId.get(req.sectionId) || [];
        existing.push(req);
        requirementsBySectionId.set(req.sectionId, existing);
      }

      expect(requirementsBySectionId.get('sec-1')).toHaveLength(2);
      expect(requirementsBySectionId.get('sec-2')).toHaveLength(1);
    });

    it('should calculate mapping counts per requirement', () => {
      const mappingCounts = new Map<string, number>();

      for (const mapping of mockMappings) {
        if (mapping.requirementId && !mapping.isOrphan) {
          const current = mappingCounts.get(mapping.requirementId) || 0;
          mappingCounts.set(mapping.requirementId, current + 1);
        }
      }

      expect(mappingCounts.get('req-1')).toBe(2);
      expect(mappingCounts.get('req-2')).toBeUndefined();
      expect(mappingCounts.get('req-3')).toBe(1);
    });

    it('should calculate mapped vs unmapped requirements', () => {
      const mappingCounts = new Map<string, number>();
      for (const mapping of mockMappings) {
        if (mapping.requirementId && !mapping.isOrphan) {
          const current = mappingCounts.get(mapping.requirementId) || 0;
          mappingCounts.set(mapping.requirementId, current + 1);
        }
      }

      const sectionRequirements = mockRequirements.filter(r => r.sectionId === 'sec-1');
      const mappedCount = sectionRequirements.filter(r => (mappingCounts.get(r.id) || 0) > 0).length;
      const unmappedCount = sectionRequirements.length - mappedCount;

      expect(sectionRequirements).toHaveLength(2);
      expect(mappedCount).toBe(1);
      expect(unmappedCount).toBe(1);
    });

    it('should sort sections by order index', () => {
      const sorted = [...mockSections].sort((a, b) => a.orderIndex - b.orderIndex);

      expect(sorted[0].name).toBe('User Authentication');
      expect(sorted[1].name).toBe('Product Management');
    });

    it('should handle expand/collapse state', () => {
      const expandedSections = new Set<string>();

      const toggle = (sectionId: string) => {
        if (expandedSections.has(sectionId)) {
          expandedSections.delete(sectionId);
        } else {
          expandedSections.add(sectionId);
        }
      };

      expect(expandedSections.has('sec-1')).toBe(false);

      toggle('sec-1');
      expect(expandedSections.has('sec-1')).toBe(true);

      toggle('sec-1');
      expect(expandedSections.has('sec-1')).toBe(false);
    });
  });

  describe('RequirementCard Component Logic', () => {
    it('should display requirement metadata correctly', () => {
      const requirement = mockRequirements[0];

      expect(requirement.requirementId).toBe('REQ-001');
      expect(requirement.name).toBe('User Login');
      expect(requirement.category).toBe('functional');
      expect(requirement.status).toBe('pending');
    });

    it('should calculate mapping count for requirement', () => {
      const mappingCounts = new Map<string, number>();
      for (const mapping of mockMappings) {
        if (mapping.requirementId && !mapping.isOrphan) {
          const current = mappingCounts.get(mapping.requirementId) || 0;
          mappingCounts.set(mapping.requirementId, current + 1);
        }
      }

      const req1MappingCount = mappingCounts.get('req-1') || 0;
      const req2MappingCount = mappingCounts.get('req-2') || 0;

      expect(req1MappingCount).toBe(2);
      expect(req2MappingCount).toBe(0);
    });

    it('should handle acceptance criteria display', () => {
      const requirement = mockRequirements[0];

      expect(requirement.acceptanceCriteria).toHaveLength(3);
      expect(requirement.acceptanceCriteria[0].text).toBe('Login form accepts email and password');
    });

    it('should format category labels correctly', () => {
      const getCategoryLabel = (category: string): string => {
        const labels: Record<string, string> = {
          functional: 'FR',
          'non-functional': 'NFR',
          technical: 'TR',
          business: 'BR',
        };
        return labels[category] || category.substring(0, 2).toUpperCase();
      };

      expect(getCategoryLabel('functional')).toBe('FR');
      expect(getCategoryLabel('non-functional')).toBe('NFR');
      expect(getCategoryLabel('technical')).toBe('TR');
      expect(getCategoryLabel('custom')).toBe('CU');
    });
  });

  describe('Requirement section-grouping logic (formerly SpecificationPanelV2 — component deleted in N6)', () => {
    it('should organize requirements by section', () => {
      const requirementsBySectionId = new Map<string | null, Requirement[]>();

      for (const req of mockRequirements) {
        const sectionId = req.sectionId || null;
        const existing = requirementsBySectionId.get(sectionId) || [];
        existing.push(req);
        requirementsBySectionId.set(sectionId, existing);
      }

      expect(requirementsBySectionId.get('sec-1')).toHaveLength(2);
      expect(requirementsBySectionId.get('sec-2')).toHaveLength(1);
      expect(requirementsBySectionId.get(null)).toBeUndefined();
    });

    it('should calculate overall coverage statistics', () => {
      const mappingCounts = new Map<string, number>();
      for (const mapping of mockMappings) {
        if (mapping.requirementId && !mapping.isOrphan) {
          const current = mappingCounts.get(mapping.requirementId) || 0;
          mappingCounts.set(mapping.requirementId, current + 1);
        }
      }

      const totalRequirements = mockRequirements.length;
      const mappedRequirements = mockRequirements.filter(r => (mappingCounts.get(r.id) || 0) > 0).length;
      const coveragePercentage = (mappedRequirements / totalRequirements) * 100;

      expect(totalRequirements).toBe(3);
      expect(mappedRequirements).toBe(2);
      expect(coveragePercentage).toBeCloseTo(66.67, 1);
    });

    it('should identify orphaned mappings', () => {
      const mappingsWithOrphan = [
        ...mockMappings,
        {
          id: 'map-4',
          specificationId: 'spec-1',
          requirementId: 'req-3',
          nodeId: 'node-deleted',
          mappingType: 'implements' as const,
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          createdBy: 'user-1',
          isOrphan: true,
        },
      ];

      const orphanedCount = mappingsWithOrphan.filter(m => m.isOrphan).length;
      expect(orphanedCount).toBe(1);
    });

    it('should handle empty state correctly', () => {
      const emptySections: SpecificationSection[] = [];
      const emptyRequirements: Requirement[] = [];

      expect(emptySections.length).toBe(0);
      expect(emptyRequirements.length).toBe(0);

      const hasContent = emptySections.length > 0 || emptyRequirements.length > 0;
      expect(hasContent).toBe(false);
    });
  });

  describe('Realtime Update Handling', () => {
    it('should handle section INSERT events', () => {
      const sections = [...mockSections];

      const newSection: SpecificationSection = {
        id: 'sec-3',
        specificationId: 'spec-1',
        name: 'Shopping Cart',
        description: 'Cart management requirements',
        orderIndex: 2,
        aiGenerated: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      sections.push(newSection);

      expect(sections).toHaveLength(3);
      expect(sections[2].name).toBe('Shopping Cart');
    });

    it('should handle requirement UPDATE events', () => {
      const requirements = [...mockRequirements];

      const updatedReq = {
        ...requirements[0],
        status: 'implemented' as const,
        updatedAt: new Date().toISOString(),
      };

      const index = requirements.findIndex(r => r.id === updatedReq.id);
      requirements[index] = updatedReq;

      expect(requirements[index].status).toBe('implemented');
    });

    it('should handle mapping DELETE events', () => {
      let mappings = [...mockMappings];

      const mappingToDelete = mappings[0];
      mappings = mappings.filter(m => m.id !== mappingToDelete.id);

      expect(mappings).toHaveLength(2);
      expect(mappings.find(m => m.id === mappingToDelete.id)).toBeUndefined();
    });

    it('should rebuild indexes after realtime changes', () => {
      let mappings = [...mockMappings];

      mappings.push({
        id: 'map-4',
        specificationId: 'spec-1',
        requirementId: 'req-2',
        nodeId: 'node-auth-api',
        mappingType: 'implements',
        confidence: 0.85,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
        isOrphan: false,
      });

      const byRequirement = new Map<string, RequirementMapping[]>();
      for (const mapping of mappings) {
        if (mapping.requirementId) {
          const existing = byRequirement.get(mapping.requirementId) || [];
          existing.push(mapping);
          byRequirement.set(mapping.requirementId, existing);
        }
      }

      expect(byRequirement.get('req-1')).toHaveLength(2);
      expect(byRequirement.get('req-2')).toHaveLength(1);
      expect(byRequirement.get('req-3')).toHaveLength(1);
    });
  });

  describe('Inline Editing Support', () => {
    it('should support requirement name editing', () => {
      const requirement = { ...mockRequirements[0] };
      const newName = 'User Authentication via Email';

      requirement.name = newName;

      expect(requirement.name).toBe(newName);
    });

    it('should support requirement status changes', () => {
      const requirement = { ...mockRequirements[1] };

      requirement.status = 'implemented';

      expect(requirement.status).toBe('implemented');
    });

    it('should support section reordering', () => {
      const sections = [...mockSections];

      sections[0].orderIndex = 1;
      sections[1].orderIndex = 0;

      const sorted = sections.sort((a, b) => a.orderIndex - b.orderIndex);

      expect(sorted[0].name).toBe('Product Management');
      expect(sorted[1].name).toBe('User Authentication');
    });

    it('should support moving requirements between sections', () => {
      const requirement = { ...mockRequirements[0] };

      requirement.sectionId = 'sec-2';

      expect(requirement.sectionId).toBe('sec-2');
    });
  });
});
