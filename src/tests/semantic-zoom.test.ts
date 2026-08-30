// N4 semantic zoom: band thresholds, the demotion matrix, and the adapter threading of
// altitude + sealedBoundary onto RF node data (first render-path consumer of the N1/N2.2
// axes). The load-bearing invariant: a boundary node NEVER explodes and never dissolves
// into an anonymous icon — its name+tech card is its interface at every band.
import { describe, expect, it } from 'vitest';
import { zoomBandForZoom, demotesToIcon, dominantChildTechnologies } from '../ui/utils/semantic-zoom.js';
import { mapNodeToRFNode } from '../ui/adapters/graph-to-reactflow.js';
import type { CatalogResolver } from '../persistence/supabase/catalog-repository.js';

describe('zoomBandForZoom — discrete bands, gesture-end sampling', () => {
  it('maps zoom values to detail / service / system', () => {
    expect(zoomBandForZoom(1.5)).toBe('detail');
    expect(zoomBandForZoom(0.75)).toBe('detail');
    expect(zoomBandForZoom(0.74)).toBe('service');
    expect(zoomBandForZoom(0.4)).toBe('service');
    expect(zoomBandForZoom(0.39)).toBe('system');
    expect(zoomBandForZoom(0.15)).toBe('system');
  });
});

describe('demotesToIcon — zoom bands with the boundary exemption', () => {
  it('detail band demotes nothing', () => {
    expect(demotesToIcon('detail', { isContainer: false })).toBe(false);
  });

  it('service band demotes nothing (M1c: the component band was never populated)', () => {
    expect(demotesToIcon('service', { isContainer: false })).toBe(false);
    expect(demotesToIcon('service', { isContainer: false })).toBe(false);
    expect(demotesToIcon('service', { isContainer: false })).toBe(false);
    // absent altitude (custom/unresolved) is treated as service — no demotion
    expect(demotesToIcon('service', { isContainer: false })).toBe(false);
  });

  it('system band demotes all leaves', () => {
    expect(demotesToIcon('system', { isContainer: false })).toBe(true);
    expect(demotesToIcon('system', { isContainer: false })).toBe(true);
  });

  it('containers are never demoted — they collapse instead', () => {
    expect(demotesToIcon('service', { isContainer: true })).toBe(false);
    expect(demotesToIcon('system', { isContainer: true })).toBe(false);
  });

  it('sealed-boundary nodes never demote at any band (never explodes, never dissolves)', () => {
    expect(demotesToIcon('service', { isContainer: false, sealedBoundary: true })).toBe(false);
    expect(demotesToIcon('system', { isContainer: false, sealedBoundary: true })).toBe(false);
  });
});

describe('N4.1 dominantChildTechnologies — a collapsed module reads as one thing', () => {
  it('dominant technology first; frequency ties break alphabetically; capped', () => {
    const kids = [
      { technology: 'react' }, { technology: 'react' }, { technology: 'react' },
      { technology: 'postgres' }, { technology: 'redis' },
      { technology: 'nodejs' }, { technology: 'nodejs' },
    ];
    expect(dominantChildTechnologies(kids)).toEqual(['react', 'nodejs', 'postgres']);
    expect(dominantChildTechnologies(kids, 2)).toEqual(['react', 'nodejs']);
  });

  it('children without a technology do not vote; empty in → empty out', () => {
    expect(dominantChildTechnologies([{ technology: null }, {}, { technology: 'react' }]))
      .toEqual(['react']);
    expect(dominantChildTechnologies([])).toEqual([]);
  });
});

// ── Adapter threading ────────────────────────────────────────────────────────────────

function role(id: string, over: Record<string, unknown> = {}) {
  return {
    id, label: id, description: '', whenToUse: null, iconName: 'box', color: '#000',
    rfVisualType: 'service', paletteCategory: 'Services', paletteCategoryLabel: 'Services',
    nature: 'build', interfaceKind: 'service', provider: null, capabilityTags: [],
    isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, defaultPorts: [], suggestedContracts: [], sortOrder: 1,
    deprecated: false, defaultTechnology: null,
    ...over,
  };
}

function stubCatalog(roles: Record<string, unknown>, techs: Record<string, unknown> = {}): CatalogResolver {
  return {
    resolveNodeType: (type: string) => {
      const r = roles[type];
      return r ? { role: r, technology: null, deploymentTarget: null } : null;
    },
    getRole: (id: string) => roles[id] ?? null,
    getTechnology: (id: string) => techs[id] ?? null,
  } as unknown as CatalogResolver;
}

function makeGraph(nodes: Record<string, unknown>) {
  return { nodes, edges: {}, contracts: {}, artifacts: {} } as never;
}

describe('adapter threads sealedBoundary onto RF node data', () => {
  it('a plain build role is not sealed (M1c: altitude no longer threaded — axis retired)', () => {
    const catalog = stubCatalog({ 'auth-service': role('auth-service', {}) });
    const graph = makeGraph({ a: { id: 'a', label: 'Auth', type: 'auth-service' } });
    const rf = mapNodeToRFNode((graph as { nodes: Record<string, never> }).nodes.a, graph, 'flat', catalog);
    expect(rf.data.sealedBoundary).toBeUndefined();
  });

  it('an engine-nature role is sealed', () => {
    const catalog = stubCatalog({ engine: role('engine', { nature: 'engine' }) });
    const graph = makeGraph({ e: { id: 'e', label: 'Engine', type: 'engine' } });
    const rf = mapNodeToRFNode((graph as { nodes: Record<string, never> }).nodes.e, graph, 'flat', catalog);
    expect(rf.data.sealedBoundary).toBe(true);
  });

  it('a boundary-engine TECHNOLOGY seals a leaf role too (N2.2 effectiveTreatment)', () => {
    const catalog = stubCatalog(
      { 'data-prep-pipeline': role('data-prep-pipeline', { nature: 'build' }) },
      { n8n: { id: 'n8n', name: 'n8n', aiContext: { treatmentOverride: 'boundary' } } },
    );
    const graph = makeGraph({ p: { id: 'p', label: 'Pipeline', type: 'data-prep-pipeline', technology: 'n8n' } });
    const rf = mapNodeToRFNode((graph as { nodes: Record<string, never> }).nodes.p, graph, 'flat', catalog);
    expect(rf.data.sealedBoundary).toBe(true);
  });

  it('no catalog → no axes, no crash (unresolved/custom types stay undemoted)', () => {
    const graph = makeGraph({ x: { id: 'x', label: 'X', type: 'mystery' } });
    const rf = mapNodeToRFNode((graph as { nodes: Record<string, never> }).nodes.x, graph, 'flat', null);
    expect(rf.data.altitude).toBeUndefined();
    expect(rf.data.sealedBoundary).toBeUndefined();
  });
});

describe('N4.4 bench fix: collapsed-chip technologies come from GRAPH truth', () => {
  it('container metadata carries dominant child technologies even when collapsed', () => {
    // Collapsed container: children are hidden parentId-less roots in the RF store, so
    // the adapter must supply the chip data — from graph.nodes, not the store.
    const graph = makeGraph({
      box: { id: 'box', label: 'Module', type: 'application-module', metadata: { containerExpanded: false } },
      a: { id: 'a', label: 'A', type: 'frontend-app', technology: 'react', parentId: 'box' },
      b: { id: 'b', label: 'B', type: 'frontend-app', technology: 'react', parentId: 'box' },
      d: { id: 'd', label: 'D', type: 'primary-db', technology: 'postgres', parentId: 'box' },
    });
    const rf = mapNodeToRFNode((graph as { nodes: Record<string, never> }).nodes.box, graph, 'nested', null);
    expect((rf.data.metadata as Record<string, unknown>).childTechnologies).toEqual(['react', 'postgres']);
  });

  it('childless nodes carry no childTechnologies key', () => {
    const graph = makeGraph({ solo: { id: 'solo', label: 'S', type: 'backend-service' } });
    const rf = mapNodeToRFNode((graph as { nodes: Record<string, never> }).nodes.solo, graph, 'nested', null);
    expect((rf.data.metadata as Record<string, unknown>).childTechnologies).toBeUndefined();
  });
});
