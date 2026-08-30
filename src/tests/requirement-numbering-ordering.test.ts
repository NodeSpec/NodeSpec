// R6 commit 1 (Discovered #8): numbering race + numeric ordering, client half.
// Pins: sortRequirementsNaturally (REQ-1000 lexicographic break), and
// createRequirementAutoNumbered's fresh-rows compute + 23505 retry — the
// panel's stale in-memory max+1 raced concurrent quick-adds into unique
// violations.
import { describe, it, expect, vi } from 'vitest';
import { sortRequirementsNaturally } from '../persistence/supabase/requirements-repository.js';
import { SpecificationService } from '../ui/services/SpecificationService.js';
import type { Requirement } from '../persistence/supabase/requirements-repository.js';

const req = (requirementId: string): Requirement =>
  ({ id: requirementId, requirementId, specificationId: 's1', name: requirementId } as unknown as Requirement);

describe('sortRequirementsNaturally', () => {
  it('orders numerically where lexicographic breaks: REQ-2 < REQ-10 < REQ-1000', () => {
    const sorted = sortRequirementsNaturally([req('REQ-10'), req('REQ-1000'), req('REQ-2')]);
    expect(sorted.map((r) => r.requirementId)).toEqual(['REQ-2', 'REQ-10', 'REQ-1000']);
  });

  it('keeps non-standard ids stable relative to each other', () => {
    const sorted = sortRequirementsNaturally([req('REQ-003'), req('CUSTOM-A'), req('REQ-001')]);
    expect(sorted.map((r) => r.requirementId)).toEqual(['CUSTOM-A', 'REQ-001', 'REQ-003']);
  });
});

describe('createRequirementAutoNumbered', () => {
  function serviceWith(repo: Record<string, unknown>) {
    const persistence = { getRequirementsRepository: () => repo } as never;
    return new SpecificationService(persistence);
  }

  it('computes from FRESH rows and retries once on the 23505 race', async () => {
    const getBySpec = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [req('REQ-001')] })          // attempt 1 sees 1 row
      .mockResolvedValueOnce({ success: true, data: [req('REQ-001'), req('REQ-002')] }); // racer landed
    const create = vi.fn()
      .mockResolvedValueOnce({ success: false, error: { message: 'duplicate', code: '23505' } })
      .mockResolvedValueOnce({ success: true, data: req('REQ-003') });

    const svc = serviceWith({ getBySpecificationId: getBySpec, create });
    const result = await svc.createRequirementAutoNumbered({
      specificationId: 's1', name: 'n', description: '', category: 'functional',
      acceptanceCriteria: [], source: 'manual',
    } as never);

    expect(result.requirementId).toBe('REQ-003');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].requirementId).toBe('REQ-002');
    expect(create.mock.calls[1][0].requirementId).toBe('REQ-003');
  });

  it('does not retry non-race failures — surfaces them honestly', async () => {
    const getBySpec = vi.fn().mockResolvedValue({ success: true, data: [] });
    const create = vi.fn().mockResolvedValue({ success: false, error: { message: 'RLS says no', code: '42501' } });

    const svc = serviceWith({ getBySpecificationId: getBySpec, create });
    await expect(svc.createRequirementAutoNumbered({
      specificationId: 's1', name: 'n', description: '', category: 'functional',
      acceptanceCriteria: [], source: 'manual',
    } as never)).rejects.toThrow('RLS says no');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('starts at REQ-001 on an empty spec', async () => {
    const getBySpec = vi.fn().mockResolvedValue({ success: true, data: [] });
    const create = vi.fn().mockResolvedValue({ success: true, data: req('REQ-001') });
    const svc = serviceWith({ getBySpecificationId: getBySpec, create });
    await svc.createRequirementAutoNumbered({
      specificationId: 's1', name: 'n', description: '', category: 'functional',
      acceptanceCriteria: [], source: 'manual',
    } as never);
    expect(create.mock.calls[0][0].requirementId).toBe('REQ-001');
  });
});
