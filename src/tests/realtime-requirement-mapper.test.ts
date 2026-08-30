// R6 commit 2 (Discovered #7): the realtime requirement mapper used to drop
// architectureTrace and confirmed — any realtime UPDATE stripped them from
// in-memory state until the next full refresh (trace lane and confirmation
// badge silently emptied). Pins both fields surviving the mapper, snake and
// camel case forms, and safe defaults.
import { describe, it, expect } from 'vitest';
import { mapRealtimeToRequirement } from '../ui/hooks/useRealtimeSpecification.js';

const baseRow = {
  id: 'r1',
  specification_id: 's1',
  requirement_id: 'REQ-001',
  name: 'Store tasks',
  description: 'd',
  category: 'functional',
  status: 'pending',
  section_id: null,
  source: 'manual',
  locked: false,
  acceptance_criteria: [{ text: 'x', met: false }],
  metadata: {},
  created_at: 't0',
  updated_at: 't1',
};

describe('mapRealtimeToRequirement (Discovered #7)', () => {
  it('carries architecture_trace and confirmed through an UPDATE payload', () => {
    const mapped = mapRealtimeToRequirement({
      ...baseRow,
      architecture_trace: ['node-a', 'node-b'],
      confirmed: true,
    });
    expect(mapped.architectureTrace).toEqual(['node-a', 'node-b']);
    expect(mapped.confirmed).toBe(true);
  });

  it('accepts camelCase forms (in-memory re-maps)', () => {
    const mapped = mapRealtimeToRequirement({
      ...baseRow,
      architectureTrace: ['node-c'],
      confirmed: true,
    });
    expect(mapped.architectureTrace).toEqual(['node-c']);
    expect(mapped.confirmed).toBe(true);
  });

  it('defaults safely when the fields are absent', () => {
    const mapped = mapRealtimeToRequirement(baseRow);
    expect(mapped.architectureTrace).toEqual([]);
    expect(mapped.confirmed).toBe(false);
  });
});
