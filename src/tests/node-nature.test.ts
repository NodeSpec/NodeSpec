// N3.5: the plain-language layer + direct-hit search ranking (owner requirements:
// "terminology as to what constitutes a node is key"; "search AWS S3 or Apache Nifi and it
// comes up instead of having to hunt for it"). Server twin of the nature wording:
// supabase/functions/_shared/catalog-search.ts::describeNature — phrases must stay aligned.
import { describe, expect, it } from 'vitest';
import { deriveNodeNature, rankCatalogMatches, isCustomDependencyRole, paletteChip, usagePhraseForRole, providerPlatformRoleId } from '../ui/utils/node-nature.js';
import type { NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';

function role(over: Partial<NodeRole>): NodeRole {
  return {
    id: 'r', label: 'R', description: '', whenToUse: null, iconName: 'box', color: '#000',
    rfVisualType: 'service', paletteCategory: 'Services',
    nature: 'build', interfaceKind: 'service', provider: null, capabilityTags: [],
    isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, defaultPorts: [], suggestedContracts: [], sortOrder: 1,
    deprecated: false, defaultTechnology: null,
    ...over,
  } as NodeRole;
}

function tech(aiContext: Record<string, unknown>): TechnologyCatalogEntry {
  return { id: 't', name: 'T', iconUrl: null, brandColor: '#000', secondaryColor: null,
    displayName: null, roleAffinities: [], aiContext,
    suggestedFiles: null, metadataSchema: null, commonConnections: null,
    isUserContributed: false, projectId: null, createdBy: null };
}

describe('deriveNodeNature — plain language from the axes', () => {
  it('covers the seven natures', () => {
    expect(deriveNodeNature(role({ isContainer: true, containerStyle: 'hosting' })).chip).toBe('Hosts');
    expect(deriveNodeNature(role({ isContainer: true, containerStyle: 'logical-boundary' })).chip).toBe('Groups');
    expect(deriveNodeNature(role({ nature: 'call' })).chip).toBe('You call');
    expect(deriveNodeNature(role({ nature: 'host' })).chip).toBe('You host');
    expect(deriveNodeNature(role({ nature: 'integrate' })).chip).toBe('Managed');
    expect(deriveNodeNature(role({ nature: 'engine' })).chip).toBe('Engine');
    expect(deriveNodeNature(role({})).line).toBe('Service you build');
  });

  it('a boundary-engine technology raises a leaf role; definition-as-code refines the wording', () => {
    const n8n = tech({ treatmentOverride: 'boundary', configMode: 'definition-as-code' });
    const nature = deriveNodeNature(role({}), n8n);
    expect(nature.chip).toBe('Engine');
    expect(nature.line).toContain('definition file lives in your repo');
  });

  // N8.1b (owner bench feedback 2026-07-26): a serverless-function node bound to
  // aws-lambda read "Service you build" — a half-truth. Provider-backed technologies
  // refine the fallthrough. Twin phrases: catalog-search.ts::describeNature.
  it('a provider technology with configMode code reads as a managed runtime', () => {
    const lambda = { ...tech({ configMode: 'code' }), id: 'aws-lambda' };
    const nature = deriveNodeNature(role({}), lambda);
    expect(nature.line).toBe('Managed runtime — you write the code, the provider runs it');
    expect(nature.chip).toBe('You build');
  });

  it('declarative/external configModes read as managed services on a generic role', () => {
    const s3 = { ...tech({ configMode: 'declarative' }), id: 'aws-s3' };
    expect(deriveNodeNature(role({}), s3).chip).toBe('Managed');
  });

  it('an UNSTAMPED provider technology still reads managed (prefix inference)', () => {
    const scheduler = { ...tech({}), id: 'gcp-cloud-scheduler' };
    expect(deriveNodeNature(role({}), scheduler).line).toBe('Managed service — provider runs it, you configure it');
  });

  it('non-provider technologies keep the plain build line', () => {
    const react = { ...tech({}), id: 'react' };
    expect(deriveNodeNature(role({}), react).line).toBe('Service you build');
  });
});

describe('N3.7 paletteChip — the ONLY recognition-time vocabulary: Build / Connect / Host', () => {
  it('collapses the seven natures into three words (or none)', () => {
    expect(paletteChip(role({}))).toBe('Build');
    expect(paletteChip(role({ nature: 'call' }))).toBe('Connect');
    expect(paletteChip(role({ nature: 'integrate' }))).toBe('Connect');
    expect(paletteChip(role({ nature: 'engine' }))).toBe('Connect');
    expect(paletteChip(role({}), tech({ treatmentOverride: 'boundary' }))).toBe('Connect');
    expect(paletteChip(role({ nature: 'host' }))).toBe('Host');
    expect(paletteChip(role({ isContainer: true, containerStyle: 'hosting' }))).toBe('Host');
    expect(paletteChip(role({ isContainer: true, containerStyle: 'logical-boundary' }))).toBeNull();
  });
});

describe('N3.7 usagePhraseForRole — drop-time question in usage terms, never taxonomy', () => {
  it('takes the first when_to_use sentence, strips the "Choose for" preamble, bounds length', () => {
    expect(usagePhraseForRole(role({ whenToUse: 'Choose for ETL pipelines that transform raw data. Examples: dbt.' })))
      .toBe('ETL pipelines that transform raw data.');
    expect(usagePhraseForRole(role({ whenToUse: null, label: 'Scheduled Trigger' }))).toBe('Scheduled Trigger');
    const long = usagePhraseForRole(role({ whenToUse: 'Choose for ' + 'x'.repeat(200) }));
    expect(long.length).toBeLessThanOrEqual(80);
  });
});

describe('isCustomDependencyRole — custom tags name DEPENDENCIES, never your own app', () => {
  it('build-nature roles: custom name = label only (React-style scaffolding stays a build brief)', () => {
    expect(isCustomDependencyRole(role({ nature: 'build' }))).toBe(false);
    expect(isCustomDependencyRole(role({ nature: 'build' }))).toBe(false);
  });

  it('external / platform / managed / engine roles: custom name = uncatalogued dependency', () => {
    expect(isCustomDependencyRole(role({ nature: 'call' }))).toBe(true);
    expect(isCustomDependencyRole(role({ nature: 'host' }))).toBe(true);
    expect(isCustomDependencyRole(role({ nature: 'integrate' }))).toBe(true);
    expect(isCustomDependencyRole(role({ nature: 'engine' }))).toBe(true);
  });
});

describe('N3.8 providerPlatformRoleId — brand-name services demand their platform parent', () => {
  it('maps provider-prefixed technology ids to the provider platform role', () => {
    expect(providerPlatformRoleId('aws-s3')).toBe('aws');
    expect(providerPlatformRoleId('azure-functions')).toBe('azure');
    expect(providerPlatformRoleId('gcp-bigquery')).toBe('gcp');
    // 2026-08-05 (owner, applying the 4g-3 two-lane ruling): supabase-* is
    // LANE-NEUTRAL — OSS components self-host; PLACEMENT decides the lane, so
    // supabase-auth must NOT auto-parent into a Supabase (Managed) container.
    expect(providerPlatformRoleId('supabase-auth')).toBeNull();
    // N4.7 (owner: "firebase is part of GCP" — full merge): firebase-* drops nest
    // under the Google Cloud platform container, not a standalone Firebase one.
    expect(providerPlatformRoleId('firebase-firestore')).toBe('gcp');
    expect(providerPlatformRoleId('cloudflare-workers')).toBe('cloudflare');
  });

  it('non-provider and absent technologies stay unparented', () => {
    expect(providerPlatformRoleId('postgres')).toBeNull();
    expect(providerPlatformRoleId('apache-nifi')).toBeNull();
    // "athena" without the aws- prefix is just a name — no provider claim to act on
    expect(providerPlatformRoleId('athena')).toBeNull();
    expect(providerPlatformRoleId(undefined)).toBeNull();
    expect(providerPlatformRoleId(null)).toBeNull();
  });

  it('N4.6 audit strays: unprefixed provider services map via the alias table', () => {
    expect(providerPlatformRoleId('aurora')).toBe('aws');
    expect(providerPlatformRoleId('dynamodb')).toBe('aws');
    expect(providerPlatformRoleId('ec2')).toBe('aws');
    expect(providerPlatformRoleId('cosmosdb')).toBe('azure');
  });
});

describe('rankCatalogMatches — direct hits first', () => {
  const entries = [
    { id: 'aws-s3', name: 'AWS S3', displayName: 'Amazon S3', purpose: 'Object storage' },
    { id: 'aws-s3-glacier', name: 'AWS S3 Glacier', purpose: 'Archival storage' },
    { id: 'apache-nifi', name: 'Apache NiFi', purpose: 'Dataflow engine for moving data' },
    { id: 'minio', name: 'MinIO', purpose: 'S3-compatible object storage' },
    { id: 'postgres', name: 'PostgreSQL', purpose: 'Relational database' },
  ];

  it('"AWS S3" → aws-s3 exact-first, glacier second, purpose-hits last', () => {
    const r = rankCatalogMatches('AWS S3', entries);
    expect(r[0].id).toBe('aws-s3');
    expect(r[1].id).toBe('aws-s3-glacier');
  });

  it('"apache nifi" tokenizes across hyphens/case', () => {
    expect(rankCatalogMatches('apache nifi', entries)[0].id).toBe('apache-nifi');
    expect(rankCatalogMatches('NIFI', entries)[0].id).toBe('apache-nifi');
  });

  it('"s3" ranks the exact-family names above the purpose mention', () => {
    const ids = rankCatalogMatches('s3', entries).map(e => e.id);
    expect(ids.indexOf('aws-s3')).toBeLessThan(ids.indexOf('minio'));
  });

  it('no match → empty; never throws on blank', () => {
    expect(rankCatalogMatches('kafka', entries)).toHaveLength(0);
    expect(rankCatalogMatches('  ', entries)).toHaveLength(0);
  });
});
