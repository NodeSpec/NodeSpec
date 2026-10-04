// N4.5: the browse IS one alphabetical list (owner direction 2026-07-23) — technologies
// + generic node types merged A–Z with letter buckets for the snap rail, and Structure
// as a separate set (one Group row + hosting containers; the taxonomy N7's ONTOLOGY.md
// captures first-class).
import { describe, expect, it } from 'vitest';
import { buildTechnologyListItems, buildRoleListItems, buildStructureListItems, buildPlatformListItems, buildPlatformsAndHostsItems, buildFunctionalRoleItems, buildAlphabeticalPalette, groupByLetter, familyForTechnology, familyPlatformRoleIds, familiesInList, technologyVisibleInProject } from '../ui/utils/palette-list.js';
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';

function role(id: string, over: Record<string, unknown> = {}): NodeRole {
  return {
    id, label: id, description: 'Does things. More detail.', whenToUse: null, iconName: 'box', color: '#000',
    rfVisualType: 'service', paletteCategory: 'Services',
    nature: 'build', interfaceKind: 'service', provider: null, capabilityTags: [],
    isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, suggestedContracts: [], sortOrder: 1,
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
  it("the 'Logical'-filed logical-boundary roles, application-module first", () => {
    const items = buildStructureListItems(resolver);
    expect(items.map(i => i.id)).toEqual(['application-module', 'bounded-context']);
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
    // generic hosting concepts are Functional, not Platforms
    expect(items.map(i => i.id)).not.toContain('docker-container');
    expect(items.map(i => i.id)).not.toContain('robot');
    // an AWS-branded container is not a platform either — it lives under its technology
    expect(items.map(i => i.id)).not.toContain('ecs-cluster');
    expect(items.map(i => i.id)).not.toContain('application-module');
  });
});

describe('AG.1: generic hosts and devices list under Platforms and hosts, after the brand platforms', () => {
  it('unbranded hosting and hardware containers follow the platforms; branded ones never list', () => {
    const ids = buildPlatformsAndHostsItems(resolver).map(i => i.id);
    expect(ids).toEqual(['aws', 'docker-container', 'robot']); // platforms first, then hosts A to Z
    expect(ids).not.toContain('ecs-cluster');  // AWS-branded: reached through its technology and search
    expect(ids).not.toContain('application-module'); // a group: Structure
    const docker = buildPlatformsAndHostsItems(resolver).find(i => i.id === 'docker-container')!;
    expect(docker.dragRoleId).toBe('docker-container');
  });

  it('a provider filter narrows it to that provider\'s platform', () => {
    expect(buildPlatformsAndHostsItems(resolver, 'aws').map(i => i.id)).toEqual(['aws']);
    expect(buildPlatformsAndHostsItems(resolver, 'azure').map(i => i.id)).toEqual([]);
  });

  it('Node types holds functional leaves only', () => {
    const items = buildFunctionalRoleItems(resolver);
    expect(items.some(i => resolver.getRole(i.id)?.isContainer)).toBe(false);
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
      iconName: null, color: null, brandColor: null,
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

    // AG.2: a type's caption is its own first sentence, then its technology count.
    const db = buildFunctionalRoleItems(r).find(i => i.id === 'database')!;
    expect(db.caption).toBe('Does things · 2 technologies');
    // Tech-less exempt roles keep their first sentence alone.
    const sensor = buildFunctionalRoleItems(r).find(i => i.id === 'sensor')!;
    expect(sensor.caption).toBe('Does things.');
  });

  it('non-alphabetic leaders bucket under # at the end', () => {
    const groups = groupByLetter([
      { key: 'tech:x', kind: 'technology' as const, id: 'x', name: '4chan-api', caption: null, iconName: null, color: null, brandColor: null, dragRoleId: null, family: null },
      { key: 'tech:y', kind: 'technology' as const, id: 'y', name: 'Alpha', caption: null, iconName: null, color: null, brandColor: null, dragRoleId: null, family: null },
    ]);
    expect(groups.map(g => g.letter)).toEqual(['A', '#']);
  });
});

// AG.6c (owner 2026-09-28): a custom technology row belongs to one project. An admin, and a
// member of two projects, can read other projects' custom rows, so the palette shows one only
// inside its own project; with no project open it shows none.
describe('custom technologies stay in their project', () => {
  const custom = (id: string, projectId: string | null) => ({ ...tech(id, id, ['backend-service']), isUserContributed: true, projectId });
  const techs = [...TECHS, custom('ours', 'p1'), custom('theirs', 'p2'), custom('nobodys', null)];
  const r = { ...resolver, getAllTechnologies: () => techs, getTechnology: (id: string) => techs.find(t => t.id === id) ?? null } as unknown as CatalogResolver;

  it('inside p1: the catalog rows and p1\'s own custom row, never another project\'s', () => {
    const ids = buildAlphabeticalPalette(r, 'p1').map(i => i.id);
    expect(ids).toContain('ours');
    expect(ids).toContain('react');
    expect(ids).not.toContain('theirs');
    expect(ids).not.toContain('nobodys');
  });

  it('with no project: no custom row at all', () => {
    const ids = buildTechnologyListItems(r).map(i => i.id);
    expect(ids.filter(id => ['ours', 'theirs', 'nobodys'].includes(id))).toEqual([]);
    expect(ids).toContain('react');
  });

  it('the rule the picker and the search use too', () => {
    expect(technologyVisibleInProject(custom('ours', 'p1'), 'p1')).toBe(true);
    expect(technologyVisibleInProject(custom('theirs', 'p2'), 'p1')).toBe(false);
    expect(technologyVisibleInProject(custom('nobodys', null), 'p1')).toBe(false);
    expect(technologyVisibleInProject(tech('react', 'React', ['backend-service']), null)).toBe(true);
  });
});

// Phase 3 of the catalog plan (owner 2026-09-28): the sidebar over the rows as migration
// 20260928130000 leaves them, beside the rows as they were.
describe('the catalog shape: what the sidebar offers', () => {
  const host = (id: string, paletteCategory: string, over: Record<string, unknown> = {}) =>
    role(id, { label: id, isContainer: true, containerStyle: 'hosting', paletteCategory, ...over });
  const shapeRoles = (retired: boolean) => [
    role('game-client', { label: 'Game Client', paletteCategory: 'Game Development' }),
    role('mobile-app', { label: 'Mobile App' }),
    role('desktop-app', { label: 'Desktop Application' }),
    role('firmware-service', { label: 'Firmware Service', paletteCategory: 'Hardware' }),
    role('microcontroller', { label: 'Microcontroller', paletteCategory: 'Hardware', deprecated: retired }),
    role('embedded-device', { label: 'Embedded Device', paletteCategory: 'Hardware', deprecated: retired }),
    role('embedded-system', { label: 'Embedded System', isContainer: true, containerStyle: 'logical-boundary', paletteCategory: 'Logical', deprecated: retired }),
    role('application-module', { label: 'Application Module', isContainer: true, containerStyle: 'logical-boundary', paletteCategory: 'Logical' }),
    host('edge-device', 'Hardware'),
    host('vpc', 'Networking'),
    host('subnet', 'Networking'),
  ];
  const shapeResolver = (roles: NodeRole[], techs: TechnologyCatalogEntry[]) => ({
    getAllRoles: () => roles,
    getAllTechnologies: () => techs,
    getRole: (id: string) => roles.find(r => r.id === id) ?? null,
    getTechnology: (id: string) => techs.find(t => t.id === id) ?? null,
  } as unknown as CatalogResolver);
  const offered = (r: CatalogResolver) => new Set([
    ...buildRoleListItems(r), ...buildFunctionalRoleItems(r), ...buildStructureListItems(r),
    ...buildPlatformsAndHostsItems(r), ...buildAlphabeticalPalette(r),
  ].map(i => i.id));

  it('AG.4: Microcontroller, Embedded Device and Embedded System are offered nowhere once retired; Edge Device, Firmware Service and Application Module are', () => {
    const before = offered(shapeResolver(shapeRoles(false), []));
    const after = offered(shapeResolver(shapeRoles(true), []));
    for (const id of ['microcontroller', 'embedded-device', 'embedded-system']) {
      expect(before.has(id), `${id} was offered before`).toBe(true);
      expect(after.has(id), `${id} is offered after`).toBe(false);
    }
    for (const id of ['edge-device', 'firmware-service', 'application-module']) expect(after.has(id), id).toBe(true);
  });

  it('AF.1: Unity drops as a Game Client with no picker; filed as an app first, it asked', () => {
    const drop = (affinities: string[]) =>
      buildTechnologyListItems(shapeResolver(shapeRoles(true), [tech('unity', 'Unity', affinities)]))[0].dragRoleId;
    expect(drop(['mobile-app', 'desktop-app', 'game-client'])).toBeNull();
    expect(drop(['game-client'])).toBe('game-client');
  });

  it('AG.7: a VPC product drops as a VPC with no picker; filed as VPC or Subnet, it asked', () => {
    const drop = (affinities: string[]) =>
      buildTechnologyListItems(shapeResolver(shapeRoles(true), [tech('aws-vpc', 'Amazon VPC', affinities)]))[0].dragRoleId;
    expect(drop(['vpc', 'subnet'])).toBeNull();
    expect(drop(['vpc'])).toBe('vpc');
  });
});

// AG.2 (owner 2026-09-28): 39 Node types rows read "generic, pick technology later (N
// available)", so Event Store, Event Stream, Message Broker and Message Queue read alike.
// Each row now says what the type is, then how many technologies it has.
describe('AG.2: captions say what each type is', () => {
  const roles: NodeRole[] = [
    role('queue', { label: 'Message Queue', description: 'Point-to-point work dispatch. One consumer per message.' }),
    role('event-stream', { label: 'Event Stream or Pub/Sub', description: 'Topics that many consumers read. Replay too.' }),
    role('cli-tool', { label: 'CLI Tool', description: 'A binary people run.' }),
  ];
  const techs = [
    tech('aws-sqs', 'SQS', ['queue']), tech('rabbitmq', 'RabbitMQ', ['queue']),
    tech('kafka', 'Kafka', ['event-stream']), tech('nats', 'NATS', ['event-stream']),
    tech('go', 'Go', ['cli-tool']),
  ];
  const r = {
    getAllRoles: () => roles, getAllTechnologies: () => techs,
    getRole: (id: string) => roles.find(x => x.id === id) ?? null,
    getTechnology: (id: string) => techs.find(t => t.id === id) ?? null,
  } as unknown as CatalogResolver;

  it('no two rows share a caption, even with the same technology count', () => {
    const captions = buildFunctionalRoleItems(r).map(i => i.caption);
    expect(new Set(captions).size).toBe(captions.length);
    expect(captions).toContain('Point-to-point work dispatch · 2 technologies');
    expect(captions).toContain('Topics that many consumers read · 2 technologies');
  });

  it('the count follows the type\'s own sentence, singular for one', () => {
    expect(buildFunctionalRoleItems(r).find(i => i.id === 'cli-tool')!.caption).toBe('A binary people run · 1 technology');
  });
});
