// P0-11 (Discovered, 2026-07-14): requirement→architecture edges silently dropped for
// out-port-only nodes. The node components render handles only for existing ports;
// req→arch edges always target handle 'in-0' and arch→deployment edges always source
// 'out-0'. normalizeArchNodePorts must therefore guarantee BOTH directions — the
// pre-fix version guaranteed only 'out', so the seeded API Service (one out port)
// swallowed every requirement edge while the sidebar showed the mapping as connected.
import { describe, expect, it } from 'vitest';
import { normalizeArchNodePorts } from '../ui/components/layout/DecompositionCanvas.js';

describe('normalizeArchNodePorts', () => {
  it('out-only ports gain an in port (the live bug: seeded API Service)', () => {
    const ports = normalizeArchNodePorts([{ id: 'p1', direction: 'out', name: 'DB queries' }]);
    expect(ports.some((p) => p.direction === 'in')).toBe(true);
    expect(ports.some((p) => p.direction === 'out')).toBe(true);
    // Original port preserved
    expect(ports.find((p) => p.id === 'p1')).toBeTruthy();
  });

  it('in-only ports gain an out port (deployment edges source out-0)', () => {
    const ports = normalizeArchNodePorts([{ id: 'p1', direction: 'in', name: 'SQL interface' }]);
    expect(ports.some((p) => p.direction === 'in')).toBe(true);
    expect(ports.some((p) => p.direction === 'out')).toBe(true);
  });

  it('nodes with both directions are passed through untouched', () => {
    const original = [
      { id: 'a', direction: 'in' as const },
      { id: 'b', direction: 'out' as const },
    ];
    expect(normalizeArchNodePorts(original)).toEqual(original);
  });

  it('port-less nodes get both directions', () => {
    for (const input of [undefined, []]) {
      const ports = normalizeArchNodePorts(input as never);
      expect(ports.some((p) => p.direction === 'in')).toBe(true);
      expect(ports.some((p) => p.direction === 'out')).toBe(true);
    }
  });

  it('multi-port nodes keep every original port', () => {
    const original = [
      { id: 'a', direction: 'out' as const },
      { id: 'b', direction: 'out' as const },
    ];
    const ports = normalizeArchNodePorts(original);
    expect(ports.filter((p) => p.direction === 'out')).toEqual(original);
    expect(ports.filter((p) => p.direction === 'in')).toHaveLength(1);
  });
});
