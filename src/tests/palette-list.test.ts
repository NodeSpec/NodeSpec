// N4.5: the browse IS one alphabetical list (owner direction 2026-07-23) — technologies
// + generic node types merged A–Z with letter buckets for the snap rail, and Structure
// as a separate set (one Group row + hosting containers; the taxonomy N7's ONTOLOGY.md
// captures first-class).
import { describe, expect, it } from 'vitest';
import { buildTechnologyListItems, buildRoleListItems, buildStructureListItems, buildPlatformListItems, buildFunctionalRoleItems, buildAlphabeticalPalette, groupByLetter, familyForTechnology, familyPlatformRoleIds, familiesInList } from '../ui/utils/palette-list.js';
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';

function role(id: string, over: Record<string, unknown> = {}): NodeRole {
  return {
    id, label: id, description: 'Does things. More detail.', whenToUse: null, iconName: 'box', color: '#000',
    rfVisualType: 'service', paletteCategory: 'Services',
    nature: 'build', interfaceKind: 'service', provider: null, capabilityTags: [],
    isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, defaultPorts: [], suggestedContracts: [], sortOrder: 1,
    deprecated: false, defaultTechnology: null,
    ...over,
  } as NodeRole;
}

function tech(id: string, name: string, affinities: string[], aiContext: Record<string, unknown> = {}): TechnologyCatalogEntry {
  return {
    id, name, iconUrl: null, brandColor: '#111', secondaryColor: null, displayName: null, roleAffinities: affinities, aiContext, suggestedFiles: null,
    metadataSchema: null, commonConnections: null,
    isUserContributed: false, projectId: null, createdBy: null,
  } as TechnologyCatalogEntry;
}

const ROLES: NodeRole[] = [
  role('backend-service', { label: 'Backend Service' }),
  role('worker', { label: 'Worker' }),
  role('external-service', { label: 'External Service', nature: 'call', kind: 'external_system' }),
  role('cap', { label: 'Capability', nature: 'integrate', kind: 'platform_capability' }),
  role('dead', { label: 'Dead Role', deprecated: true }),
  role('docker-container', { label: 'Docker Container', isContainer: true, containerStyle: 'hosting', nature: 'build', kind: 'logical_group' }),
  role('aws', { label: 'AWS', isContainer: true, containerStyle: 'hosting', nature: 'host', kind: 'platform', provider: 'aws' }),
  // 2026-08-05 ruling fixtures: a provider-BRANDED non-platform container (never a
  // loose generic row) and a hardware container (a Functional concept).
  role('ecs-cluster', { label: 'ECS Cluster', isContainer: true, containerStyle: 'hosting', nature: 'build', provider: 'aws' }),
  role('robot', { label: 'Robot', isContainer: true, containerStyle: 'hosting', nature: 'build', paletteCategory: 'Hardware' }),
  // 2026-08-05 leaf ruling: Supabase (Managed) is ONE boundary node (nature
  // 'integrate' — the provider operates it), never a container.
  role('supabase', { label: 'Supabase (Managed)', nature: 'integrate', paletteCategory: 'Platform' }),
  role('application-module', { label: 'Application Module', isContainer: true, containerStyle: 'logical-boundary', nature: 'build', iconName: 'package', paletteCategory: 'Logical' }),
  role('bounded-context', { label: 'Bounded Context (DDD)', isContainer: true, containerStyle: 'logical-boundary', nature: 'build', kind: 'logical_group', paletteCategory: 'Logical' }),
  // 2026-08-05 audit stray: styled logical-boundary but filed OUTSIDE 'Logical' —
  // must never render as a Structure row (searchable only).
  role('service-mesh', { label: 'Service Mesh', isContainer: true, containerStyle: 'logical-boundary', nature: 'build', paletteCategory: 'Networking' }),
];

const TECHS: TechnologyCatalogEntry[] = [
  tech('react', 'React', ['backend-service'], { purpose: 'UI library. Component model.' }),
  tech('n8n', 'n8n', ['backend-service', 'worker'], { purpose: 'Workflow automation.' }),
  tech('orphan', 'Orphan', []),
  tech('zig', 'Zig', ['backend-service']),
  // N8.4a-1c (owner bench finding: EC2 absent from the sidebar): container-only affinity.
  tech('aws-ec2', 'Amazon EC2', ['docker-container'], { purpose: 'Resizable compute capacity.' }),
  // N8.4a-3b (owner: "AWS VPC doesn't appear under AWS"): TWO container affinities —
  // must list under its family with a drop-time picker (dragRoleId null).
  tech('aws-vpc', 'Amazon VPC', ['docker-container', 'aws'], { purpose: 'Isolated network.' }),
  tech('ghost', 'Ghost', ['dead']), // deprecated-only affinity — still skipped
  // The managed product is a TECHNOLOGY drop (its role is integrate — never
  // browsed loose per RULE B; the recognizable name is the entry point).
  tech('supabase', 'Supabase (Managed)', ['supabase'], { purpose: 'Managed backend-as-a-service.' }),
];

const resolver = {
  getAllRoles: () => ROLES,
  getAllTechnologies: () => TECHS,
  getRole: (id: string) => ROLES.find(r => r.id === id) ?? null,
  getTechnology: (id: string) => TECHS.find(t => t.id === id) ?? null,
} as unknown as CatalogResolver;

describe('buildTechnologyListItems', () => {
  it('one row per tech with live leaf affinities; single-affinity carries dragRoleId', () => {
    const items = buildTechnologyListItems(resolver);
    expect(items.map(i => i.id)).toEqual(['aws-ec2', 'aws-vpc', 'n8n', 'react', 'supabase', 'zig']); // alphabetical; orphan + ghost skipped
    const react = items.find(i => i.id === 'react')!;
    expect(react.dragRoleId).toBe('backend-service');
    expect(react.caption).toBe('UI library.');
    const n8n = items.find(i => i.id === 'n8n')!;
    expect(n8n.dragRoleId).toBeNull(); // multi-affinity → UsagePicker at drop
  });

  it('N8.4a-1c: a container-only-affinity tech (the EC2 case) LISTS, dropping as its container', () => {
    // Owner bench finding 2026-07-27: "I don't see amazon EC2 in our nodes list on
    // sidebar." aws-ec2's only affinity is a hosting container role — the old
    // leaf-only filter silently skipped it (docker/kubernetes class too).
    const items = buildTechnologyListItems(resolver);
    const ec2 = items.find(i => i.id === 'aws-ec2')!;
    expect(ec2).toBeDefined();
    expect(ec2.dragRoleId).toBe('docker-container'); // drops as the hosting container, tech bound
    expect(ec2.chip).toBe('Host');
    // Leaf affinities still take precedence when a tech has both.
    expect(items.find(i => i.id === 'react')!.dragRoleId).toBe('backend-service');
    // Deprecated-only affinities remain skipped.
    expect(items.find(i => i.id === 'ghost')).toBeUndefined();
  });

  it('N8.4a-3b: a MULTI-container-affinity tech (the VPC case) lists under its family with a picker', () => {
    const items = buildTechnologyListItems(resolver);
    const vpc = items.find(i => i.id === 'aws-vpc')!;
    expect(vpc).toBeDefined();
    expect(vpc.family).toBe('aws');       // appears under the AWS chip
    expect(vpc.dragRoleId).toBeNull();    // two container affinities → drop-time picker
    expect(vpc.chip).toBe('Host');
  });
});

describe('buildRoleListItems', () => {
  it('generic leaf roles only — no containers, capabilities, or deprecated', () => {
    const ids = buildRoleListItems(resolver).map(i => i.id);
    expect(ids).toEqual(['backend-service', 'external-service', 'worker']);
    expect(ids).not.toContain('docker-container');
    expect(ids).not.toContain('cap');
    expect(ids).not.toContain('dead');
  });
});

describe('buildStructureListItems — the organizational group roles ONLY (owner ruling 2026-08-05)', () => {
  it("the 'Logical'-filed logical-boundary roles, application-module first, all chipped Group", () => {
    const items = buildStructureListItems(resolver);
    expect(items.map(i => i.id)).toEqual(['application-module', 'bounded-context']);
    expect(items.every(i => i.chip === 'Group')).toBe(true);
    // hosting containers are a DIFFERENT concept — never Structure rows
    expect(items.map(i => i.id)).not.toContain('aws');
    expect(items.map(i => i.id)).not.toContain('docker-container');
    // logical-boundary strays filed outside 'Logical' (service-mesh class) stay out too
    expect(items.map(i => i.id)).not.toContain('service-mesh');
  });
});

describe('buildPlatformListItems — BRAND platforms only (owner ruling 2026-08-05)', () => {
  it("nature 'host' containers only — generic hosting and branded non-platforms excluded", () => {
    const items = buildPlatformListItems(resolver);
    expect(items.map(i => i.id)).toEqual(['aws']);
    // Supabase (Managed) is a LEAF boundary node now (2026-08-05 ruling) — it left
    // the Platforms browse and drops from the Technology list instead.
    expect(items.map(i => i.id)).not.toContain('supabase');
    expect(items.every(i => i.chip === 'Host')).toBe(true);
    // generic hosting concepts are Functional, not Platforms
    expect(items.map(i => i.id)).not.toContain('docker-container');
    expect(items.map(i => i.id)).not.toContain('robot');
    // an AWS-branded container is not a platform either — it lives under its technology
    expect(items.map(i => i.id)).not.toContain('ecs-cluster');
    expect(items.map(i => i.id)).not.toContain('application-module');
  });
});

describe('generic containers browse under Functional Node Types (owner ruling 2026-08-05)', () => {
  it('unbranded hosting/hardware containers list with Host chips; branded ones never do', () => {
    const ids = buildFunctionalRoleItems(resolver).map(i => i.id);
    expect(ids).toContain('docker-container'); // generic hosting concept
    expect(ids).toContain('robot');            // hardware concept
    expect(ids).not.toContain('aws');          // platform — its own section
    expect(ids).not.toContain('ecs-cluster');  // AWS-branded — reachable via aws-ecs tech + search only
    expect(ids).not.toContain('application-module'); // logical group — Structure
    const docker = buildFunctionalRoleItems(resolver).find(i => i.id === 'docker-container')!;
    expect(docker.chip).toBe('Host');
    expect(docker.dragRoleId).toBe('docker-container');
  });

  it('the Supabase (Managed) leaf role never browses loose (integrate — the tech row is the entry)', () => {
    expect(buildFunctionalRoleItems(resolver).map(i => i.id)).not.toContain('supabase');
    const supa = buildTechnologyListItems(resolver).find(i => i.id === 'supabase')!;
    expect(supa).toBeDefined();
    expect(supa.dragRoleId).toBe('supabase'); // single leaf affinity — drops directly
  });
});

describe('buildAlphabeticalPalette + groupByLetter', () => {
  it('N4.7: the A–Z stream is TECHNOLOGY-ONLY — roles live in their own section', () => {
    const items = buildAlphabeticalPalette(resolver);
    expect(items.every(i => i.kind === 'technology')).toBe(true);
    const groups = groupByLetter(items);
    expect(groups.map(g => g.letter)).toEqual(['A', 'N', 'R', 'S', 'Z']); // A = Amazon EC2 (N8.4a-1c fixture)
    const n = groups.find(g => g.letter === 'N')!;
    expect(n.items.map(i => i.id)).toEqual(['n8n']);
  });

  it('N4.6: provider families derive from prefix, alias, and brand name', () => {
    // clean prefix convention
    expect(familyForTechnology('aws-s3', 'Amazon S3')).toBe('aws');
    expect(familyForTechnology('gcp-bigquery', 'BigQuery')).toBe('gcp');
    // audit strays: unprefixed ids whose brand lives in the alias map / name
    expect(familyForTechnology('aurora', 'Amazon Aurora')).toBe('aws');
    expect(familyForTechnology('cosmosdb', 'Azure Cosmos DB')).toBe('azure');
    // name-only heuristic (future imports before N8 normalization)
    expect(familyForTechnology('some-new-thing', 'AWS Some New Thing')).toBe('aws');
    expect(familyForTechnology('esxi', 'VMware ESXi')).toBe('vmware');
    // the platform identifier itself
    expect(familyForTechnology('aws', 'Amazon Web Services')).toBe('aws');
    // 2026-08-05: the 4g-2 hosting platforms' prefixes are registered (the recorded
    // "vercel- is not a known prefix" looseness is closed)
    expect(familyForTechnology('vercel-edge', 'Vercel Edge Functions')).toBe('vercel');
    expect(familyForTechnology('railway-postgres', 'Railway Postgres')).toBe('railway');
    // non-branded stays familyless
    expect(familyForTechnology('react', 'React')).toBeNull();
  });

  it('N4.7: firebase folds into the Google Cloud family — never its own chip', () => {
    expect(familyForTechnology('firebase-firestore', 'Firebase Firestore')).toBe('gcp');
    expect(familyForTechnology('firebase-auth', 'Firebase Auth')).toBe('gcp');
    expect(familyForTechnology('firebase', 'Firebase')).toBe('gcp');
    expect(familyForTechnology('some-thing', 'Firebase Something')).toBe('gcp');
    // the Structure filter under the Google Cloud chip covers BOTH containers
    expect(familyPlatformRoleIds('gcp')).toEqual(['gcp', 'firebase']);
    expect(familyPlatformRoleIds('aws')).toEqual(['aws']);
  });

  it('N4.6: familiesInList counts members, largest first, hides singletons', () => {
    const mk = (id: string, family: string | null) => ({
      key: `tech:${id}`, nature: 'build', kind: 'technology' as const, id, name: id, caption: null,
      chip: null, natureLine: '', iconName: null, color: null, brandColor: null,
      dragRoleId: null, family,
    });
    const chips = familiesInList([
      mk('aws-s3', 'aws'), mk('aws-lambda', 'aws'), mk('aws-athena', 'aws'),
      mk('azure-functions', 'azure'), mk('cosmosdb', 'azure'),
      mk('cloudflare-workers', 'cloudflare'), // singleton — hidden
      mk('react', null),
    ]);
    expect(chips.map(f => `${f.key}:${f.count}`)).toEqual(['aws:3', 'azure:2']);
    expect(chips[0].label).toBe('AWS');
    // N4.7: member tech ids ride along so the chip can borrow a member's logo.
    expect(chips[0].sampleTechIds).toEqual(['aws-s3', 'aws-lambda', 'aws-athena']);
  });

  it('N4.7: Functional Node Types — pure-provider and dead-end roles hidden, generic value kept', () => {
    // Owner 2026-07-25: generic roles that lead to a language/framework choice are
    // value-added; ones that can only lead to a platform selection (RULE A) or to
    // nothing (RULE B) are confusing as generic drops. Presentation-only.
    const roles: NodeRole[] = [
      role('backend-service', { label: 'Backend Service' }),                                  // generic — stays
      role('cdn', { label: 'CDN', paletteCategory: 'Networking' }),                           // RULE A — all techs provider
      role('dns', { label: 'DNS', paletteCategory: 'Networking' }),                           // RULE B — zero techs, app_service
      role('sensor', { label: 'Sensor', nature: 'build', paletteCategory: 'Hardware' }), // exempt kind
      role('firmware-service', { label: 'Firmware Service', paletteCategory: 'Hardware' }),   // Hardware app_service — exempt
      role('external-data', { label: 'External Data', nature: 'call', paletteCategory: 'External' }), // exempt kind
      role('iac-workflow', { label: 'IaC Workflow', nature: 'engine', paletteCategory: 'Automation' }), // exempt kind
      role('database', { label: 'Database', paletteCategory: 'Database' }),                   // mixed — stays
    ];
    const techs: TechnologyCatalogEntry[] = [
      tech('express', 'Express', ['backend-service']),
      tech('aws-cloudfront', 'AWS CloudFront', ['cdn']),
      tech('cloudflare-cdn', 'Cloudflare CDN', ['cdn']),
      tech('postgresql', 'PostgreSQL', ['database']),
      tech('aws-rds-postgresql', 'AWS RDS PostgreSQL', ['database']),
    ];
    const r = {
      getAllRoles: () => roles,
      getAllTechnologies: () => techs,
      getRole: (id: string) => roles.find(x => x.id === id) ?? null,
      getTechnology: (id: string) => techs.find(t => t.id === id) ?? null,
    } as unknown as CatalogResolver;

    const ids = buildFunctionalRoleItems(r).map(i => i.id);
    expect(ids).not.toContain('cdn');  // RULE A
    expect(ids).not.toContain('dns');  // RULE B
    expect(ids).toContain('backend-service');
    expect(ids).toContain('database');
    expect(ids).toContain('sensor');
    expect(ids).toContain('firmware-service');
    expect(ids).toContain('external-data');
    expect(ids).toContain('iac-workflow');

    // Roles with technologies carry the pick-later caption with the count.
    const db = buildFunctionalRoleItems(r).find(i => i.id === 'database')!;
    expect(db.caption).toBe('generic — pick technology later (2 available)');
    // Tech-less exempt roles keep their description caption.
    const sensor = buildFunctionalRoleItems(r).find(i => i.id === 'sensor')!;
    expect(sensor.caption).not.toContain('pick technology later');
  });

  it('non-alphabetic leaders bucket under # at the end', () => {
    const groups = groupByLetter([
      { key: 'tech:x', kind: 'technology' as const, id: 'x', name: '4chan-api', caption: null, chip: null, natureLine: '', iconName: null, color: null, brandColor: null, dragRoleId: null, family: null },
      { key: 'tech:y', kind: 'technology' as const, id: 'y', name: 'Alpha', caption: null, chip: null, natureLine: '', iconName: null, color: null, brandColor: null, dragRoleId: null, family: null },
    ]);
    expect(groups.map(g => g.letter)).toEqual(['A', '#']);
  });
});
