// AG.11f (owner 2026-09-28): before the catalog loads, or when it fails to, the canvas
// draws from the offline container list. It lacked the ten platforms and the devices, so
// an AWS account or a Vercel project drew as a plain node until the catalog arrived.
//  - Every container role the catalog has (29 live, 2 retired) draws as a box offline,
//    a platform included although it admits by rule (provider, natures, interface kinds)
//    rather than by a list of ids.
//  - The layers follow AG.11c: exactly the networks and the cloud accounts place what
//    they hold; the app platforms, devices, runtimes and clusters run it.
//  - The live bench compares the list with node_roles (n8-catalog, ag10-catalog-round-two).
import { beforeEach, describe, expect, it } from 'vitest';
import { STATIC_CONTAINER_TYPE_DATA } from '@nodespec/core/container-type-data.js';
import { canContainerHoldNode, getContainerTypeById, populateContainerTypes } from '@nodespec/core/container-types.js';
import { isContainerType, isLogicalBoundaryType, resolveRFVisualType } from '../ui/adapters/rf-visual-type-resolver.js';

const PLATFORMS = ['aws', 'azure', 'gcp', 'cloudflare', 'supabase', 'vercel', 'netlify', 'railway', 'render', 'fly-io'];
const DEVICES = ['desktop-device', 'edge-device', 'gateway-device', 'robot', 'mobile-device'];

beforeEach(() => populateContainerTypes(STATIC_CONTAINER_TYPE_DATA));

describe('AG.11f: offline, the platforms and devices draw as boxes', () => {
  it('each platform and device is a container with no catalog loaded', () => {
    for (const id of [...PLATFORMS, ...DEVICES]) {
      expect(isContainerType(id, null), id).toBe(true);
      expect(resolveRFVisualType(id, null), id).toBe('container');
    }
  });

  it('a retired group still draws as a group, so an existing node keeps its box', () => {
    for (const id of ['embedded-system', 'game-engine-project']) {
      expect(isLogicalBoundaryType(id, null), id).toBe(true);
      expect(resolveRFVisualType(id, null), id).toBe('logicalBoundary');
    }
  });

  it('a leaf that was once a container stays a leaf', () => {
    for (const id of ['serverless-function', 'desktop-app', 'service-mesh', 'network-connection']) {
      expect(isContainerType(id, null), id).toBe(false);
    }
  });

  it('what a box may hold offline is what the catalog says', () => {
    expect(canContainerHoldNode('supabase', 'database')).toBe(true);
    expect(canContainerHoldNode('supabase', 'queue')).toBe(false);
    expect(canContainerHoldNode('vpc', 'network-connection')).toBe(true);
    expect(canContainerHoldNode('docker-container', 'game-server')).toBe(true);
    expect(canContainerHoldNode('subnet', 'queue')).toBe(true);
  });
});

describe('AG.11f: the offline layers follow how each container holds', () => {
  it('only the networks and the cloud accounts place what they hold', () => {
    const places = STATIC_CONTAINER_TYPE_DATA.filter((c) => c.layer === 'infrastructure').map((c) => c.id).sort();
    expect(places).toEqual(['aws', 'azure', 'cloudflare', 'gcp', 'subnet', 'supabase', 'vpc']);
  });

  it('the app platforms and the devices run what they hold', () => {
    for (const id of ['vercel', 'netlify', 'railway', 'render', 'fly-io', ...DEVICES]) {
      expect(getContainerTypeById(id)?.layer, id).toBe('runtime');
    }
    expect(getContainerTypeById('docker-container')?.label).toBe('Container or App Runtime');
  });

  it('a platform admits its own provider by rule', () => {
    const vercel = getContainerTypeById('vercel')!.canContain;
    expect(Array.isArray(vercel)).toBe(false);
    expect((vercel as { providers?: string[] }).providers).toEqual(['vercel']);
    expect((getContainerTypeById('gcp')!.canContain as { providers?: string[] }).providers).toEqual(['gcp', 'firebase']);
  });
});
