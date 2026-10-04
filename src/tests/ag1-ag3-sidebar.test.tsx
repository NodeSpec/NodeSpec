// @vitest-environment jsdom
// AG.1 and AG.3 (owner 2026-09-28): the real sidebar, rendered over a small catalog.
//  - AG.1: the browse follows the model's four layers: Node types (functional leaves),
//    Platforms and hosts (brand platforms first, then generic hosts and devices),
//    Structure (the groups), Technologies (A to Z). Search results use the same names.
//  - AG.3 ("chips out"): no row, search result or drop menu shows a Build, Connect,
//    Host or Group chip, and no row carries the nature sentence as its hover text.
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';

function role(id: string, label: string, over: Record<string, unknown> = {}): NodeRole {
  return {
    id, label, description: `${label} does its job. More detail.`, whenToUse: null, iconName: 'box', color: '#334155',
    rfVisualType: 'service', paletteCategory: 'Services', nature: 'build', interfaceKind: 'service', provider: null,
    capabilityTags: [], isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, suggestedContracts: [], sortOrder: 1, deprecated: false, defaultTechnology: null, ...over,
  } as NodeRole;
}
function tech(id: string, name: string, affinities: string[], purpose: string, configMode?: string): TechnologyCatalogEntry {
  return {
    id, name, iconUrl: null, brandColor: '#111111', secondaryColor: null, displayName: null, roleAffinities: affinities,
    aiContext: { purpose, ...(configMode ? { configMode } : {}) }, suggestedFiles: null, metadataSchema: null,
    commonConnections: null, isUserContributed: false, projectId: null, createdBy: null,
  } as TechnologyCatalogEntry;
}

const host = { isContainer: true, containerStyle: 'hosting', containerLayer: 'runtime' };
const ROLES = [
  role('queue', 'Message Queue', { paletteCategory: 'Messaging', interfaceKind: 'queue' }),
  role('backend-service', 'Backend Service'),
  role('worker', 'Background Worker'),
  role('aws', 'AWS', { ...host, nature: 'host', containerLayer: 'infrastructure', paletteCategory: 'Platform', provider: 'aws' }),
  role('docker-container', 'Container or App Runtime', { ...host, paletteCategory: 'Infrastructure' }),
  role('edge-device', 'Edge Device', { ...host, paletteCategory: 'Hardware' }),
  role('application-module', 'Application Module', { isContainer: true, containerStyle: 'logical-boundary', containerLayer: 'logical', paletteCategory: 'Logical' }),
];
const TECHS = [
  tech('rabbitmq', 'RabbitMQ', ['queue'], 'Open source message broker.', 'declarative'),
  tech('express', 'Express', ['backend-service'], 'Minimal web framework.'),
  tech('aws-sqs', 'Amazon SQS', ['queue'], 'Managed queue.', 'declarative'),
  tech('docker', 'Docker', ['docker-container'], 'Container runtime.'),
];
const resolver = {
  getAllRoles: () => ROLES,
  getAllTechnologies: () => TECHS,
  getRole: (id: string) => ROLES.find(r => r.id === id) ?? null,
  getTechnology: (id: string) => TECHS.find(t => t.id === id) ?? null,
  getRolesByCategory: () => [],
} as unknown as CatalogResolver;

vi.mock('../ui/hooks/useCatalog.js', () => ({ useCatalog: () => resolver }));

const { TabbedSidebar } = await import('../ui/components/layout/TabbedSidebar.js');

const EMPTY = { id: 'g', schemaVersion: 8, version: 0, hash: '', nodes: {}, edges: {}, contracts: {}, artifacts: {} } as never;
const CHIPS = ['Build', 'Connect', 'Host', 'Group'];
const NATURE_WORDS = /Service you build|Managed service|Hosting environment|Grouping|Provider-managed|External service/;

function renderSidebar() {
  return render(<ThemeProvider><TabbedSidebar graph={EMPTY} selectedArtifactId={null} /></ThemeProvider>);
}

function noChipsOrNatureTooltips(root: HTMLElement) {
  const leafTexts = [...root.querySelectorAll('span, div')]
    .filter(el => el.children.length === 0)
    .map(el => (el.textContent ?? '').trim());
  for (const chip of CHIPS) expect(leafTexts, `a "${chip}" chip`).not.toContain(chip);
  for (const el of root.querySelectorAll('[title]')) {
    expect(el.getAttribute('title') ?? '', 'a nature sentence as hover text').not.toMatch(NATURE_WORDS);
  }
}

describe('AG.1: the browse follows the four layers', () => {
  it('Node types, Platforms and hosts, Structure, Technologies, in that order, each holding its own kind', () => {
    const { container, getByText } = renderSidebar();
    const text = container.textContent ?? '';
    const order = ['Node types', 'Platforms and hosts', 'Structure', 'Technologies'].map(h => text.indexOf(h));
    expect(order.every(i => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // a host is under Platforms and hosts, not Node types; the platform comes first
    const nodeTypes = text.slice(order[0], order[1]);
    const hosts = text.slice(order[1], order[2]);
    expect(nodeTypes).toContain('Message Queue');
    expect(nodeTypes).not.toContain('Container or App Runtime');
    expect(hosts.indexOf('AWS')).toBeLessThan(hosts.indexOf('Container or App Runtime'));
    expect(hosts).toContain('Edge Device');
    expect(text.slice(order[2], order[3])).toContain('Application Module');
    getByText('RabbitMQ');
  });
});

describe('AG.3: chips come out of the app', () => {
  it('no browse row shows a chip or a nature sentence on hover', () => {
    const { container } = renderSidebar();
    noChipsOrNatureTooltips(container);
  });

  it('no search result shows one either, and hosts and groups search under their own names', () => {
    const { container, getByPlaceholderText } = renderSidebar();
    const box = container.querySelector('input[type="text"]') as HTMLInputElement ?? getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: 'worker' } });
    noChipsOrNatureTooltips(container);
    expect(container.textContent).toContain('Node types');
    expect(container.textContent).toContain('Background Worker');
    fireEvent.change(box, { target: { value: 'a' } });
    const text = container.textContent ?? '';
    expect(text).toContain('Platforms and hosts');
    noChipsOrNatureTooltips(container);
  });
});
