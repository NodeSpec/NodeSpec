import { describe, it, expect } from 'vitest';
import { NodeGroupSchema } from '@nodespec/core/schemas.js';
import type { NodeGroup, Graph } from '@nodespec/core/types.js';
import { GraphSchema } from '@nodespec/core/schemas.js';

describe('NodeGroup Schema', () => {
  it('should validate a complete NodeGroup', () => {
    const nodeGroup: NodeGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: 'Microservice Boundary',
      nodeIds: [
        '223e4567-e89b-12d3-a456-426614174001',
        '323e4567-e89b-12d3-a456-426614174002',
      ],
      position: {
        x: 100,
        y: 200,
      },
      style: {
        backgroundColor: '#f0f0f0',
        borderColor: '#333333',
      },
      metadata: {
        deploymentType: 'kubernetes',
        namespace: 'production',
      },
    };

    expect(() => NodeGroupSchema.parse(nodeGroup)).not.toThrow();
  });

  it('should validate a minimal NodeGroup', () => {
    const minimalGroup: NodeGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: 'Simple Group',
      nodeIds: [],
    };

    expect(() => NodeGroupSchema.parse(minimalGroup)).not.toThrow();
  });

  it('should reject NodeGroup with invalid id', () => {
    const invalidGroup = {
      id: 'not-a-uuid',
      label: 'Test Group',
      nodeIds: [],
    };

    expect(() => NodeGroupSchema.parse(invalidGroup)).toThrow();
  });

  it('should reject NodeGroup with empty label', () => {
    const invalidGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: '',
      nodeIds: [],
    };

    expect(() => NodeGroupSchema.parse(invalidGroup)).toThrow();
  });

  it('should reject NodeGroup with invalid node IDs', () => {
    const invalidGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: 'Test Group',
      nodeIds: ['not-a-uuid'],
    };

    expect(() => NodeGroupSchema.parse(invalidGroup)).toThrow();
  });

  it('should validate position coordinates', () => {
    const groupWithPosition: NodeGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: 'Positioned Group',
      nodeIds: [],
      position: {
        x: 150.5,
        y: -200.75,
      },
    };

    expect(() => NodeGroupSchema.parse(groupWithPosition)).not.toThrow();
  });

  it('should validate custom styles', () => {
    const styledGroup: NodeGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: 'Styled Group',
      nodeIds: [],
      style: {
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderColor: '#ff0000',
      },
    };

    expect(() => NodeGroupSchema.parse(styledGroup)).not.toThrow();
  });

  it('should validate partial style', () => {
    const partialStyleGroup: NodeGroup = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      label: 'Partial Style',
      nodeIds: [],
      style: {
        backgroundColor: '#ffffff',
      },
    };

    expect(() => NodeGroupSchema.parse(partialStyleGroup)).not.toThrow();
  });
});

describe('Graph with NodeGroups', () => {
  it('should validate Graph with nodeGroups', () => {
    const graph: Graph = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      schemaVersion: 2,
      version: 1,
      hash: 'abc123',
      nodes: {},
      edges: {},
      contracts: {},
      artifacts: {},
      nodeGroups: {
        '223e4567-e89b-12d3-a456-426614174001': {
          id: '223e4567-e89b-12d3-a456-426614174001',
          label: 'API Gateway',
          nodeIds: [],
        },
      },
    };

    expect(() => GraphSchema.parse(graph)).not.toThrow();
  });

  it('should validate Graph without nodeGroups', () => {
    const graph: Graph = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      schemaVersion: 2,
      version: 1,
      hash: 'abc123',
      nodes: {},
      edges: {},
      contracts: {},
      artifacts: {},
    };

    expect(() => GraphSchema.parse(graph)).not.toThrow();
  });

  it('should validate Graph with multiple nodeGroups', () => {
    const graph: Graph = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      schemaVersion: 2,
      version: 1,
      hash: 'abc123',
      nodes: {
        '323e4567-e89b-12d3-a456-426614174001': {
          id: '323e4567-e89b-12d3-a456-426614174001',
          type: 'service',
          label: 'Auth Service',
        },
        '423e4567-e89b-12d3-a456-426614174002': {
          id: '423e4567-e89b-12d3-a456-426614174002',
          type: 'service',
          label: 'User Service',
        },
      },
      edges: {},
      contracts: {},
      artifacts: {},
      nodeGroups: {
        '223e4567-e89b-12d3-a456-426614174001': {
          id: '223e4567-e89b-12d3-a456-426614174001',
          label: 'Authentication Cluster',
          nodeIds: ['323e4567-e89b-12d3-a456-426614174001'],
          style: {
            backgroundColor: '#e3f2fd',
            borderColor: '#1976d2',
          },
        },
        '523e4567-e89b-12d3-a456-426614174003': {
          id: '523e4567-e89b-12d3-a456-426614174003',
          label: 'User Management',
          nodeIds: ['423e4567-e89b-12d3-a456-426614174002'],
          style: {
            backgroundColor: '#f3e5f5',
            borderColor: '#7b1fa2',
          },
        },
      },
    };

    expect(() => GraphSchema.parse(graph)).not.toThrow();
  });

  it('should validate nested container metadata', () => {
    const graph: Graph = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      schemaVersion: 2,
      version: 1,
      hash: 'abc123',
      nodes: {},
      edges: {},
      contracts: {},
      artifacts: {},
      nodeGroups: {
        '223e4567-e89b-12d3-a456-426614174001': {
          id: '223e4567-e89b-12d3-a456-426614174001',
          label: 'Cloud Region',
          nodeIds: [],
          metadata: {
            region: 'us-east-1',
            provider: 'aws',
            environment: 'production',
            tags: ['critical', 'high-availability'],
          },
        },
      },
    };

    expect(() => GraphSchema.parse(graph)).not.toThrow();
  });
});
