// N9b-2: the catalog load-state machine — a failed DB load must become an observable
// 'failed' state (the DegradedCatalogBanner renders it), never a silent fallback to
// the static registries. Retry resets to 'loading' and can reach 'ready'.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadCatalogMock = vi.fn();
vi.mock('../persistence/supabase/catalog-repository.js', () => ({
  loadCatalog: (...args: unknown[]) => loadCatalogMock(...args),
}));

// Minimal resolver satisfying everything getResolver() wires after a successful load.
const stubResolver = {
  getAllRoles: () => [],
  getAllTechnologies: () => [],
  getAllLegacyMappings: () => [],
  getRole: () => undefined,
  getTechnology: () => undefined,
  resolveNodeType: () => undefined,
  getTechnologiesForRole: () => [],
};

describe('N9b-2: catalog load-state machine', () => {
  beforeEach(async () => {
    vi.resetModules();
    loadCatalogMock.mockReset();
  });

  it('failed load → state "failed" with the error message; listeners notified', async () => {
    loadCatalogMock.mockRejectedValueOnce(new Error('db unreachable'));
    const { CatalogService } = await import('../ui/services/CatalogService.js');

    const seen: string[] = [];
    CatalogService.subscribeLoadState((s) => seen.push(s));

    await expect(CatalogService.getResolver()).rejects.toThrow('db unreachable');
    const { state, error } = CatalogService.getLoadState();
    expect(state).toBe('failed');
    expect(error).toContain('db unreachable');
    expect(seen).toContain('failed');
  });

  it('retryLoad after failure resets to loading, then ready on success', async () => {
    loadCatalogMock.mockRejectedValueOnce(new Error('boom'));
    const { CatalogService } = await import('../ui/services/CatalogService.js');
    await CatalogService.getResolver().catch(() => {});
    expect(CatalogService.getLoadState().state).toBe('failed');

    loadCatalogMock.mockResolvedValueOnce(stubResolver);
    const seen: string[] = [];
    CatalogService.subscribeLoadState((s) => seen.push(s));
    await CatalogService.retryLoad();
    expect(CatalogService.getLoadState().state).toBe('ready');
    expect(seen[0]).toBe('failed'); // immediate fire with current state
    expect(seen).toContain('loading');
    expect(seen).toContain('ready');
  });

  // N8.5″(b): a load that SUCCEEDED but skipped rows must read 'degraded', never a
  // false 'ready' — before this state, the skip count died in a console.warn while
  // the palette silently missed entries.
  it('resolver reporting skipped rows → state "degraded" with the count + first issues in the detail', async () => {
    loadCatalogMock.mockResolvedValueOnce({
      ...stubResolver,
      getCatalogIssues: () => ['node_role "drifted-role": rf_visual_type — invalid', 'technology "broken": name — required'],
    });
    const { CatalogService } = await import('../ui/services/CatalogService.js');
    await CatalogService.getResolver();
    const { state, error } = CatalogService.getLoadState();
    expect(state).toBe('degraded');
    expect(error).toContain('2 catalog row(s)');
    expect(error).toContain('drifted-role');
  });

  it('degraded is retryable; a clean reload reaches ready (and zero issues never degrades)', async () => {
    loadCatalogMock.mockResolvedValueOnce({ ...stubResolver, getCatalogIssues: () => ['x'] });
    const { CatalogService } = await import('../ui/services/CatalogService.js');
    await CatalogService.getResolver();
    expect(CatalogService.getLoadState().state).toBe('degraded');

    loadCatalogMock.mockResolvedValueOnce({ ...stubResolver, getCatalogIssues: () => [] });
    await CatalogService.retryLoad();
    expect(CatalogService.getLoadState().state).toBe('ready');
    expect(CatalogService.getLoadState().error).toBeNull();
  });

  it('subscribe fires immediately and unsubscribe stops delivery', async () => {
    const { CatalogService } = await import('../ui/services/CatalogService.js');
    const seen: string[] = [];
    const off = CatalogService.subscribeLoadState((s) => seen.push(s));
    expect(seen.length).toBe(1);
    off();
    loadCatalogMock.mockRejectedValueOnce(new Error('x'));
    await CatalogService.getResolver().catch(() => {});
    expect(seen.length).toBe(1);
  });
});
