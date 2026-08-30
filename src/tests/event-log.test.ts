import { describe, it, expect } from 'vitest';
import {
  extractEventLog,
  filterEventLogByActor,
  filterEventLogByPatchType,
  groupEventLogByActor,
  getEventLogSummary,
} from '@nodespec/core/event-log.js';
import {
  createAddNodePatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';
import { generateUUID } from '@nodespec/core/utils.js';
import type { Node, PatchOperation } from '@nodespec/core/types.js';

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Node ${id.slice(0, 8)}`,
    data: {},
    metadata: {},
  };
}

describe('Event Log', () => {
  describe('extractEventLog', () => {
    it('should extract event entries from patches', () => {
      const nodeId = generateUUID();
      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createUpdateNodePatch(
          nodeId,
          { label: 'Updated' },
          { actorType: 'ai', summary: 'Update label' }
        ),
      ];

      const log = extractEventLog(patches);

      expect(log).toHaveLength(2);
      expect(log[0].patchType).toBe('add_node');
      expect(log[0].actorType).toBe('human');
      expect(log[1].patchType).toBe('update_node');
      expect(log[1].actorType).toBe('ai');
    });

    it('should include all metadata fields', () => {
      const nodeId = generateUUID();
      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'system',
          summary: 'System generated node',
          preconditions: [{ type: 'value_exists', path: 'version' }],
        }),
      ];

      const log = extractEventLog(patches);

      expect(log[0].preconditions).toHaveLength(1);
      expect(log[0].summary).toBe('System generated node');
    });
  });

  describe('filterEventLogByActor', () => {
    it('should filter by actor type', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId1), {
          actorType: 'human',
          summary: 'Human add',
        }),
        createAddNodePatch(createTestNode(nodeId2), {
          actorType: 'ai',
          summary: 'AI add',
        }),
      ];

      const log = extractEventLog(patches);
      const humanOnly = filterEventLogByActor(log, 'human');
      const aiOnly = filterEventLogByActor(log, 'ai');

      expect(humanOnly).toHaveLength(1);
      expect(humanOnly[0].actorType).toBe('human');
      expect(aiOnly).toHaveLength(1);
      expect(aiOnly[0].actorType).toBe('ai');
    });
  });

  describe('filterEventLogByPatchType', () => {
    it('should filter by patch type', () => {
      const nodeId = generateUUID();
      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add',
        }),
        createUpdateNodePatch(
          nodeId,
          { label: 'Updated' },
          { actorType: 'human', summary: 'Update' }
        ),
      ];

      const log = extractEventLog(patches);
      const addOnly = filterEventLogByPatchType(log, 'add_node');
      const updateOnly = filterEventLogByPatchType(log, 'update_node');

      expect(addOnly).toHaveLength(1);
      expect(updateOnly).toHaveLength(1);
    });
  });

  describe('groupEventLogByActor', () => {
    it('should group entries by actor type', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const nodeId3 = generateUUID();
      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId1), {
          actorType: 'human',
          summary: 'Human 1',
        }),
        createAddNodePatch(createTestNode(nodeId2), {
          actorType: 'ai',
          summary: 'AI 1',
        }),
        createAddNodePatch(createTestNode(nodeId3), {
          actorType: 'human',
          summary: 'Human 2',
        }),
      ];

      const log = extractEventLog(patches);
      const grouped = groupEventLogByActor(log);

      expect(grouped.human).toHaveLength(2);
      expect(grouped.ai).toHaveLength(1);
    });
  });

  describe('getEventLogSummary', () => {
    it('should provide accurate summary', () => {
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const patches: PatchOperation[] = [
        createAddNodePatch(createTestNode(nodeId1), {
          actorType: 'human',
          summary: 'Add 1',
        }),
        createAddNodePatch(createTestNode(nodeId2), {
          actorType: 'ai',
          summary: 'Add 2',
        }),
        createUpdateNodePatch(
          nodeId1,
          { label: 'Updated' },
          { actorType: 'human', summary: 'Update 1' }
        ),
      ];

      const log = extractEventLog(patches);
      const summary = getEventLogSummary(log);

      expect(summary.totalPatches).toBe(3);
      expect(summary.byActorType.human).toBe(2);
      expect(summary.byActorType.ai).toBe(1);
      expect(summary.byPatchType.add_node).toBe(2);
      expect(summary.byPatchType.update_node).toBe(1);
      expect(summary.timeRange.earliest).not.toBeNull();
      expect(summary.timeRange.latest).not.toBeNull();
    });

    it('should handle empty log', () => {
      const summary = getEventLogSummary([]);

      expect(summary.totalPatches).toBe(0);
      expect(summary.timeRange.earliest).toBeNull();
      expect(summary.timeRange.latest).toBeNull();
    });
  });
});
