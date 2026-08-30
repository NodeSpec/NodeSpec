import { describe, it, expect } from 'vitest';
import {
  detectDrift,
  calculateDriftMetrics,
  generateReconciliationSuggestions,
  shouldTriggerDriftDetection,
} from '@nodespec/core/specification-drift-detector.js';
import type { Graph } from '@nodespec/core/types.js';
import type { Requirement } from '../persistence/supabase/requirements-repository.js';
import type { RequirementMapping } from '../persistence/supabase/mappings-repository.js';

describe('Drift Detection System', () => {
  const createMockGraph = (): Graph => ({
    id: 'graph-1',
    schemaVersion: 1,
    version: 1,
    hash: 'test-hash',
    nodes: {
      'node-1': {
        id: 'node-1',
        type: 'web.rest-api',
        label: 'Auth API',
        metadata: { specificationGenerated: true },
        artifacts: [],
        ports: [],
        status: 'draft',
      },
      'node-2': {
        id: 'node-2',
        type: 'database.postgresql',
        label: 'Users DB',
        metadata: { specificationGenerated: true },
        artifacts: [],
        ports: [],
        status: 'draft',
      },
      'node-3': {
        id: 'node-3',
        type: 'cache.redis',
        label: 'Session Cache',
        metadata: { userAdded: true },
        artifacts: [],
        ports: [],
        status: 'draft',
      },
    },
    edges: {},
    contracts: {},
    artifacts: {},
    nodeGroups: {},
    metadata: {},
  });

  const createMockRequirements = (): Requirement[] => [
    {
      id: 'req-1',
      specificationId: 'spec-1',
      requirementId: 'FR-001',
      name: 'User Authentication',
      description: 'Users must be able to authenticate',
      category: 'functional',
      status: 'pending',
      sectionId: null,
      source: 'manual',

      locked: false,
      acceptanceCriteria: [{ text: 'Users can log in' }],
      metadata: { confidence: 0.95 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'req-2',
      specificationId: 'spec-1',
      requirementId: 'FR-002',
      name: 'Data Persistence',
      description: 'System must persist user data',
      category: 'functional',
      status: 'pending',
      sectionId: null,
      source: 'manual',

      locked: false,
      acceptanceCriteria: [{ text: 'Data survives restarts' }],
      metadata: { confidence: 0.9 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'req-3',
      specificationId: 'spec-1',
      requirementId: 'NFR-001',
      name: 'Performance',
      description: 'System must respond quickly',
      category: 'non-functional',
      status: 'pending',
      sectionId: null,
      source: 'manual',

      locked: false,
      acceptanceCriteria: [{ text: 'Response time < 100ms' }],
      metadata: { confidence: 0.85 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const createMockMappings = (): RequirementMapping[] => [
    {
      id: 'map-1',
      specificationId: 'spec-1',
      requirementId: 'req-1',
      nodeId: 'node-1',
      mappingType: 'implements',
      confidence: 0.95,
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
    },
    {
      id: 'map-2',
      specificationId: 'spec-1',
      requirementId: 'req-2',
      nodeId: 'node-2',
      mappingType: 'implements',
      confidence: 0.9,
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
    },
  ];

  describe('detectDrift', () => {
    it('detects orphaned requirements', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);

      const orphanedIssues = report.issues.filter(i => i.type === 'orphaned_requirement');
      expect(orphanedIssues).toHaveLength(1);
      expect(orphanedIssues[0].requirementId).toBe('req-3');
    });

    it('detects unmapped nodes', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings: RequirementMapping[] = [];

      const report = detectDrift(graph, requirements, mappings);

      const unmappedIssues = report.issues.filter(
        i => i.type === 'unmapped_node' || i.type === 'user_extension'
      );
      expect(unmappedIssues.length).toBeGreaterThan(0);
    });

    it('distinguishes user extensions from unmapped nodes', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);

      const userExtensions = report.issues.filter(i => i.type === 'user_extension');
      expect(userExtensions).toHaveLength(1);
      expect(userExtensions[0].nodeId).toBe('node-3');
      expect(userExtensions[0].severity).toBe('info');
    });

    it('calculates drift score correctly', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);

      expect(report.driftScore).toBeGreaterThan(0);
      expect(report.driftScore).toBeLessThanOrEqual(100);
    });

    it('generates summary based on drift level', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);

      expect(report.summary).toBeTruthy();
      expect(typeof report.summary).toBe('string');
    });

    it('categorizes issues by severity', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);

      expect(report.criticalIssues).toBeGreaterThanOrEqual(0);
      expect(report.warningIssues).toBeGreaterThanOrEqual(0);
      expect(report.infoIssues).toBeGreaterThanOrEqual(0);
      expect(report.totalIssues).toBe(
        report.criticalIssues + report.warningIssues + report.infoIssues
      );
    });
  });

  describe('calculateDriftMetrics', () => {
    it('calculates orphaned requirements correctly', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const metrics = calculateDriftMetrics(graph, requirements, mappings);

      expect(metrics.orphanedRequirements).toBe(1);
    });

    it('calculates unmapped nodes correctly', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const metrics = calculateDriftMetrics(graph, requirements, mappings);

      expect(metrics.unmappedNodes).toBeGreaterThanOrEqual(0);
    });

    it('identifies user extension nodes', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const metrics = calculateDriftMetrics(graph, requirements, mappings);

      expect(metrics.userExtensionNodes).toBe(1);
    });

    it('calculates coverage percentages', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const metrics = calculateDriftMetrics(graph, requirements, mappings);

      expect(metrics.requirementsCoverage).toBeGreaterThanOrEqual(0);
      expect(metrics.requirementsCoverage).toBeLessThanOrEqual(100);
      expect(metrics.nodesCoverage).toBeGreaterThanOrEqual(0);
      expect(metrics.nodesCoverage).toBeLessThanOrEqual(100);
    });

    it('determines overall health status', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const metrics = calculateDriftMetrics(graph, requirements, mappings);

      expect(['healthy', 'needs-attention', 'critical']).toContain(metrics.overallHealth);
    });
  });

  describe('generateReconciliationSuggestions', () => {
    it('suggests creating requirements for user extensions', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);
      const suggestions = generateReconciliationSuggestions(report, graph, requirements);

      const createReqSuggestions = suggestions.filter(s => s.type === 'create_requirement');
      expect(createReqSuggestions.length).toBeGreaterThan(0);
    });

    it('suggests creating mappings for unmapped nodes', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings: RequirementMapping[] = [];

      const report = detectDrift(graph, requirements, mappings);
      const suggestions = generateReconciliationSuggestions(report, graph, requirements);

      const createMapSuggestions = suggestions.filter(s => s.type === 'create_mapping');
      expect(createMapSuggestions.length).toBeGreaterThan(0);
    });

    it('prioritizes suggestions by priority and confidence', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);
      const suggestions = generateReconciliationSuggestions(report, graph, requirements);

      for (let i = 1; i < suggestions.length; i++) {
        const prev = suggestions[i - 1];
        const curr = suggestions[i];

        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const prevPriority = priorityOrder[prev.priority];
        const currPriority = priorityOrder[curr.priority];

        if (prevPriority === currPriority) {
          expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
        } else {
          expect(prevPriority).toBeLessThanOrEqual(currPriority);
        }
      }
    });

    it('includes confidence scores for all suggestions', () => {
      const graph = createMockGraph();
      const requirements = createMockRequirements();
      const mappings = createMockMappings();

      const report = detectDrift(graph, requirements, mappings);
      const suggestions = generateReconciliationSuggestions(report, graph, requirements);

      suggestions.forEach(suggestion => {
        expect(suggestion.confidence).toBeGreaterThan(0);
        expect(suggestion.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('shouldTriggerDriftDetection', () => {
    it('triggers after 5 patches', () => {
      expect(shouldTriggerDriftDetection(5, null)).toBe(true);
      expect(shouldTriggerDriftDetection(6, null)).toBe(true);
    });

    it('does not trigger before 5 patches', () => {
      expect(shouldTriggerDriftDetection(0, null)).toBe(false);
      expect(shouldTriggerDriftDetection(4, null)).toBe(false);
    });

    it('triggers after 2 minutes idle', () => {
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
      expect(shouldTriggerDriftDetection(1, threeMinutesAgo)).toBe(true);
    });

    it('does not trigger before 2 minutes idle', () => {
      const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);
      expect(shouldTriggerDriftDetection(1, oneMinuteAgo)).toBe(false);
    });
  });
});
