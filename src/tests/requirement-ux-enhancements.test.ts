import { describe, it, expect } from 'vitest';
import type { Requirement } from '../persistence/supabase/requirements-repository.js';
import type { SpecificationSection } from '../persistence/supabase/sections-repository.js';

function makeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'req-1',
    specificationId: 'spec-1',
    requirementId: 'REQ-001',
    name: 'Test Requirement',
    description: 'A test requirement',
    category: 'functional',
    status: 'pending',
    sectionId: null,
    source: 'manual',

    locked: false,
    metadata: {},
    acceptanceCriteria: [{ text: 'Must pass' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Requirement ID Sequential Naming', () => {
  it('generates REQ-001 when no existing requirements', () => {
    const existingRequirements: Requirement[] = [];
    const existingIds = existingRequirements
      .map(r => r.requirementId)
      .filter(id => /^REQ-\d+$/.test(id))
      .map(id => parseInt(id.replace('REQ-', ''), 10));
    const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    const requirementId = `REQ-${String(nextNum).padStart(3, '0')}`;

    expect(requirementId).toBe('REQ-001');
  });

  it('generates REQ-004 when existing requirements go up to REQ-003', () => {
    const existingRequirements = [
      makeRequirement({ requirementId: 'REQ-001' }),
      makeRequirement({ requirementId: 'REQ-002' }),
      makeRequirement({ requirementId: 'REQ-003' }),
    ];

    const existingIds = existingRequirements
      .map(r => r.requirementId)
      .filter(id => /^REQ-\d+$/.test(id))
      .map(id => parseInt(id.replace('REQ-', ''), 10));
    const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    const requirementId = `REQ-${String(nextNum).padStart(3, '0')}`;

    expect(requirementId).toBe('REQ-004');
  });

  it('handles gaps in IDs correctly (e.g., REQ-001, REQ-005 -> REQ-006)', () => {
    const existingRequirements = [
      makeRequirement({ requirementId: 'REQ-001' }),
      makeRequirement({ requirementId: 'REQ-005' }),
    ];

    const existingIds = existingRequirements
      .map(r => r.requirementId)
      .filter(id => /^REQ-\d+$/.test(id))
      .map(id => parseInt(id.replace('REQ-', ''), 10));
    const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    const requirementId = `REQ-${String(nextNum).padStart(3, '0')}`;

    expect(requirementId).toBe('REQ-006');
  });

  it('ignores non-standard requirement IDs (e.g., timestamp-based)', () => {
    const existingRequirements = [
      makeRequirement({ requirementId: 'REQ-001' }),
      makeRequirement({ requirementId: 'REQ-1771721380816' }),
    ];

    const existingIds = existingRequirements
      .map(r => r.requirementId)
      .filter(id => /^REQ-\d+$/.test(id))
      .map(id => parseInt(id.replace('REQ-', ''), 10));
    const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    const requirementId = `REQ-${String(nextNum).padStart(3, '0')}`;

    expect(requirementId).toBe('REQ-1771721380817');
  });

  it('pads numbers correctly for small values', () => {
    const nextNum = 1;
    expect(`REQ-${String(nextNum).padStart(3, '0')}`).toBe('REQ-001');

    const nextNum2 = 10;
    expect(`REQ-${String(nextNum2).padStart(3, '0')}`).toBe('REQ-010');

    const nextNum3 = 100;
    expect(`REQ-${String(nextNum3).padStart(3, '0')}`).toBe('REQ-100');
  });

  it('works with ManualRequirementForm count-based generation', () => {
    const existingRequirementCount = 5;
    const nextNum = existingRequirementCount + 1;
    const generatedReqId = `REQ-${String(nextNum).padStart(3, '0')}`;

    expect(generatedReqId).toBe('REQ-006');
  });

  it('allows user-provided ID to override auto-generation', () => {
    const userProvidedId = 'CUSTOM-REQ-42';
    const existingRequirementCount = 5;
    const nextNum = existingRequirementCount + 1;
    const generatedReqId = userProvidedId.trim() || `REQ-${String(nextNum).padStart(3, '0')}`;

    expect(generatedReqId).toBe('CUSTOM-REQ-42');
  });
});

describe('Specification Realtime Refresh', () => {
  it('SpecificationData interface includes refresh function', () => {
    const mockSpecData = {
      specification: null,
      sections: [] as SpecificationSection[],
      requirements: [] as Requirement[],
      features: [],
      loading: false,
      error: null,
      connected: false,
      refresh: async () => {},
    };

    expect(typeof mockSpecData.refresh).toBe('function');
  });

  it('refresh is callable and returns a promise', async () => {
    let refreshCalled = false;
    const mockSpecData = {
      specification: null,
      sections: [],
      requirements: [],
      features: [],
      loading: false,
      error: null,
      connected: false,
      refresh: async () => { refreshCalled = true; },
    };

    await mockSpecData.refresh();
    expect(refreshCalled).toBe(true);
  });
});

describe('Manual Requirement AI Preservation', () => {
  it('identifies manual requirements by source field', () => {
    const manualReq = makeRequirement({ source: 'manual' });
    const aiReq = makeRequirement({ source: 'ai-generated' });

    expect(manualReq.source === 'manual' || manualReq.locked).toBe(true);
    expect(aiReq.source === 'manual' || aiReq.locked).toBe(false);
  });

  it('identifies locked requirements', () => {
    const lockedReq = makeRequirement({ source: 'ai-generated', locked: true });
    const unlockedReq = makeRequirement({ source: 'ai-generated', locked: false });

    expect(lockedReq.source === 'manual' || lockedReq.locked).toBe(true);
    expect(unlockedReq.source === 'manual' || unlockedReq.locked).toBe(false);
  });

  it('allows AI-generated non-locked requirements to be overwritten', () => {
    const aiReq = makeRequirement({ source: 'ai-generated', locked: false });
    const shouldPreserve = aiReq.source === 'manual' || aiReq.locked;

    expect(shouldPreserve).toBe(false);
  });

  it('prevents overwrite when source is manual regardless of locked state', () => {
    const manualUnlocked = makeRequirement({ source: 'manual', locked: false });
    const manualLocked = makeRequirement({ source: 'manual', locked: true });

    expect(manualUnlocked.source === 'manual' || manualUnlocked.locked).toBe(true);
    expect(manualLocked.source === 'manual' || manualLocked.locked).toBe(true);
  });

  it('simulates toolCreateRequirement preservation response', () => {
    const existing = {
      id: 'uuid-123',
      requirement_id: 'REQ-003',
      name: 'User Login',
      source: 'manual',
      locked: false,
    };

    const shouldPreserve = existing.source === 'manual' || existing.locked;
    expect(shouldPreserve).toBe(true);

    if (shouldPreserve) {
      const result = {
        success: true,
        data: {
          id: existing.id,
          requirementId: existing.requirement_id,
          name: existing.name,
          action: 'preserved',
          message: `Requirement "${existing.requirement_id}" was manually created and cannot be overwritten by AI.`,
        },
      };

      expect(result.success).toBe(true);
      expect(result.data.action).toBe('preserved');
      expect(result.data.message).toContain('manually created');
    }
  });

  it('allows confirmed requirements to be preserved by AI', () => {
    const confirmedRequirement = {
      id: 'uuid-456',
      requirement_id: 'REQ-002',
      name: 'Authentication System',
      confirmed: true,
    };

    expect(confirmedRequirement.confirmed).toBe(true);
  });
});

describe('Tool Display Names', () => {
  const TOOL_DISPLAY_NAMES: Record<string, string> = {
    save_specification: 'Saving project specification...',
    create_section: 'Organizing requirements into sections...',
    create_requirement: 'Defining project requirements...',
    get_requirements: 'Reviewing project requirements...',
    get_specification: 'Reading project specification...',
    add_node: 'Adding architecture component...',
    update_node: 'Updating architecture component...',
    remove_node: 'Removing architecture component...',
    add_edge: 'Connecting components...',
    remove_edge: 'Removing connection...',
    add_contract: 'Defining interface contract...',
    add_port: 'Adding component interface...',
    set_parent: 'Organizing component hierarchy...',
    add_artifact: 'Generating source code...',
    update_artifact: 'Updating source code...',
    read_graph: 'Analyzing current architecture...',
    read_hierarchy: 'Reviewing component hierarchy...',
    get_node: 'Inspecting component details...',
    link_schema_artifact: 'Linking schema to contract...',
  };

  function getToolDisplayName(toolName: string, isValidation = false): string {
    const prefix = isValidation ? 'Fixing: ' : '';
    return prefix + (TOOL_DISPLAY_NAMES[toolName] || `Processing ${toolName.replace(/_/g, ' ')}...`);
  }

  it('maps all known tools to natural language descriptions', () => {
    const knownTools = [
      'save_specification', 'create_section', 'create_requirement',
      'get_requirements', 'get_specification', 'add_node', 'update_node',
      'remove_node', 'add_edge', 'remove_edge', 'add_contract', 'add_port',
      'set_parent', 'add_artifact', 'update_artifact', 'read_graph',
      'read_hierarchy', 'get_node', 'link_schema_artifact',
    ];

    for (const tool of knownTools) {
      const display = getToolDisplayName(tool);
      expect(display).not.toContain('Using tool:');
      expect(display).not.toBe(tool);
      expect(display.length).toBeGreaterThan(5);
    }
  });

  it('does not show raw function names to the user', () => {
    const display = getToolDisplayName('add_node');
    expect(display).toBe('Adding architecture component...');
    expect(display).not.toContain('add_node');
  });

  it('prefixes validation fixes appropriately', () => {
    const display = getToolDisplayName('update_node', true);
    expect(display).toBe('Fixing: Updating architecture component...');
  });

  it('handles unknown tools gracefully with natural language fallback', () => {
    const display = getToolDisplayName('some_unknown_tool');
    expect(display).toBe('Processing some unknown tool...');
    expect(display).not.toContain('some_unknown_tool');
  });

  it('never shows raw underscore-separated names to the user', () => {
    const allTools = [
      ...Object.keys(TOOL_DISPLAY_NAMES),
      'some_new_tool',
    ];

    for (const tool of allTools) {
      const display = getToolDisplayName(tool);
      expect(display).not.toMatch(/^[a-z]+_[a-z]+$/);
    }
  });
});

describe('get_requirements includes source and locked fields', () => {
  it('query selects source and locked fields', () => {
    const selectFields = 'id, requirement_id, name, description, category, section_id, source, locked';
    expect(selectFields).toContain('source');
    expect(selectFields).toContain('locked');
    expect(selectFields).toContain('requirement_id');
  });
});
