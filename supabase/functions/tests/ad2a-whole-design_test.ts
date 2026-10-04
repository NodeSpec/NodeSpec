// V3 AD.2a (owner 2026-09-24, ruling 5; invariant I12): model.json carries the
// whole design (each node's configuration, each contract's schema body) and no
// credential reaches git. Version 1 anchors still parse, verify and compare by
// architecture; contentHash stays architecture only in both versions.
import {
  isSecretName, isPlaceholder, looksLikeCredential, withholdCredentials, keepWithheldFromCanvas, WITHHELD,
} from '../_shared/credential-withhold.ts';
import {
  serializeModel, serializeModelWithReport, parseModel, verifyModelHash, coreModelHash, sameDesign, diffAnchors,
  anchorToPatches, MODEL_ANCHOR_VERSION, type ModelAnchor,
} from '../_shared/model-anchor.ts';
import { generateTaskDocument, computeTaskContextFingerprint, type TaskDocumentInput } from '../_shared/task-document-generator.ts';
import { assert, assertEquals } from './helpers.ts';

const N1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const N2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const E1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GH_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

// deno-lint-ignore no-explicit-any
function graph(config: Record<string, unknown> | undefined, schema?: Record<string, unknown>): any {
  return {
    nodes: {
      [N1]: { id: N1, type: 'backend-service', label: 'Orders API', technology: 'node', ports: [], metadata: config ? { config, configSource: 'manual', x: 1 } : {} },
      [N2]: { id: N2, type: 'database', label: 'Orders DB', ports: [], metadata: {} },
    },
    edges: { [E1]: { id: E1, source: N1, target: N2, contractId: C1 } },
    contracts: { [C1]: { id: C1, kind: 'data', name: 'orders', ...(schema ? { schema } : {}) } },
    artifacts: {},
  };
}

async function anchorOf(g: unknown): Promise<ModelAnchor> {
  const parsed = parseModel(await serializeModel(g as Record<string, unknown>));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.model;
}

// ── what counts as a credential ─────────────────────────────────────────

Deno.test('AD.2a (I12): a field is secret by its name, not by a word inside it', () => {
  for (const name of ['password', 'dbPassword', 'database_password', 'clientSecret', 'accessToken', 'apiKey', 'API_KEY', 'x-api-key', 'privateKey', 'jwtSecret', 'credentials', 'authorization', 'key']) {
    assert(isSecretName(name), name);
  }
  for (const name of ['partitionKey', 'primaryKey', 'secretName', 'tokenUrl', 'passwordPolicy', 'password_hash', 'region', 'maxTokens']) {
    assert(!isSecretName(name), name);
  }
});

Deno.test('AD.2a: placeholders are left alone; a credential is caught by its shape wherever it sits', () => {
  for (const v of ['', '${DB_PASSWORD}', '$DB_PASSWORD', '{{ secrets.KEY }}', '<your-api-key>', 'env:STRIPE_KEY', 'vault:kv/db', '****', 'changeme', WITHHELD]) {
    assert(isPlaceholder(v), v);
  }
  assert(!isPlaceholder('hunter2'));
  assert(looksLikeCredential('postgres://app:s3cret@db.internal:5432/orders'), 'inline password');
  assert(!looksLikeCredential('postgres://app:${DB_PASS}@db.internal:5432/orders'), 'a placeholder password');
  assert(!looksLikeCredential('postgres://db.internal:5432/orders'), 'no password');
  assert(looksLikeCredential('Server=db;User Id=app;Password=s3cret;'), 'key=value password');
  assert(looksLikeCredential(GH_TOKEN), 'GitHub token');
  // Built at run time so the file carries no credential-shaped literal the
  // publish gates would refuse (scripts/ship1/leak-patterns.mjs).
  assert(looksLikeCredential(['AKIA', 'IOSFODNN7EXAMPLE'].join('')), 'AWS key id');
  assert(looksLikeCredential(['-----BEGIN RSA ', 'PRIVATE KEY-----\nMIIE'].join('')), 'PEM');
  assert(!looksLikeCredential('us-east-1'));
});

Deno.test('AD.2a: withholding names every path, keeps everything else, and never withholds numbers', () => {
  const held = withholdCredentials({
    region: 'eu-west-1',
    database: { url: 'postgres://app:s3cret@db/orders', password: 'hunter2', port: 5432, poolKey: 'orders' },
    apiKey: '${API_KEY}',
    webhooks: [GH_TOKEN, 'https://example.com/hook'],
  }, 'config');
  assertEquals(held.withheld, ['config.database.url', 'config.database.password', 'config.webhooks[0]']);
  const v = held.value as Record<string, any>;
  assertEquals(v.region, 'eu-west-1');
  assertEquals(v.database.port, 5432);
  assertEquals(v.database.poolKey, 'orders');
  assertEquals(v.apiKey, '${API_KEY}', 'a placeholder is kept as written');
  assertEquals(v.webhooks[1], 'https://example.com/hook');
  const schema = withholdCredentials({ properties: { password: { type: 'string', default: 'hunter2', examples: ['s3cret'] } } }, 'schema');
  assertEquals(schema.withheld, ['schema.properties.password.default', 'schema.properties.password.examples[0]']);
  assertEquals((schema.value as any).properties.password.type, 'string', 'the schema keeps its shape');
});

Deno.test('AD.2a: a load keeps the canvas value where git withheld one, and never writes the placeholder', () => {
  const incoming = { region: 'eu-west-2', database: { password: WITHHELD, port: 5433 }, tokens: [WITHHELD, 'x'] };
  assertEquals(
    keepWithheldFromCanvas(incoming, { region: 'eu-west-1', database: { password: 'hunter2', port: 5432 }, tokens: ['t1'] }),
    { region: 'eu-west-2', database: { password: 'hunter2', port: 5433 }, tokens: ['t1', 'x'] },
  );
  assertEquals(keepWithheldFromCanvas(incoming, undefined), { region: 'eu-west-2', database: { port: 5433 }, tokens: ['x'] }, 'no canvas value: left out');
});

// ── the anchor ──────────────────────────────────────────────────────────

Deno.test('AD.2a: version 2 writes configuration and schema bodies, credentials withheld and named', async () => {
  const g = graph({ region: 'eu-west-1', dbPassword: 'hunter2' }, { type: 'object', properties: { token: { type: 'string', example: GH_TOKEN } } });
  const { text, withheld } = await serializeModelWithReport(g);
  assert(!text.includes('hunter2') && !text.includes(GH_TOKEN), 'no credential in the file');
  assertEquals(withheld, [
    { entity: 'node', id: N1, name: 'Orders API', path: 'config.dbPassword' },
    { entity: 'contract', id: C1, name: 'orders', path: 'schema.properties.token.example' },
  ]);
  const m = JSON.parse(text) as ModelAnchor;
  assertEquals(m.modelVersion, MODEL_ANCHOR_VERSION);
  // AG.13: version 3 is version 2 without ports; configuration and schemas stay.
  assertEquals(MODEL_ANCHOR_VERSION, 3);
  const node = m.nodes.find((n) => n.id === N1)!;
  assertEquals(node.config, { dbPassword: WITHHELD, region: 'eu-west-1' });
  assertEquals(node.configSource, 'manual');
  assert(typeof node.configHash === 'string');
  assert(!('config' in m.nodes.find((n) => n.id === N2)!), 'a node without configuration carries none');
  const contract = m.contracts[0];
  assertEquals((contract.schema as any).properties.token.example, WITHHELD);
  assert(await verifyModelHash(m), 'modelHash covers the details');
});

Deno.test('AD.2a: contentHash is architecture only, so configuration never moves it', async () => {
  const a = await anchorOf(graph(undefined));
  const b = await anchorOf(graph({ region: 'eu-west-1' }));
  assertEquals(a.nodes.find((n) => n.id === N1)!.contentHash, b.nodes.find((n) => n.id === N1)!.contentHash);
  assertEquals(await coreModelHash(a), await coreModelHash(b), 'the same architecture');
  assertEquals(await sameDesign(a, b), false, 'but not the same design: git and the canvas differ in configuration');
  assertEquals(diffAnchors(a, b).nodes.changed.map((n) => n.id), [N1]);
});

Deno.test('AD.2a: configuration is written the same whatever order its fields were typed in', async () => {
  const a = await serializeModel(graph({ region: 'eu-west-1', tier: 'gold' }));
  const b = await serializeModel(graph({ tier: 'gold', region: 'eu-west-1' }));
  assertEquals(a, b);
});

Deno.test('AD.2a: a version 1 anchor still parses, verifies, and compares by architecture only', async () => {
  const v2 = await anchorOf(graph({ region: 'eu-west-1' }, { type: 'object' }));
  // The same design as version 1 wrote it: no configuration, no schema body.
  const strip = <T extends Record<string, unknown>>(e: T) =>
    Object.fromEntries(Object.entries(e).filter(([k]) => !['config', 'configSource', 'configHash', 'schema'].includes(k)));
  const content = { nodes: v2.nodes.map(strip), edges: v2.edges, contracts: v2.contracts.map(strip), artifacts: v2.artifacts };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  const modelHash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
  const v1Text = JSON.stringify({ modelVersion: 1, generatedBy: 'nodespec', modelHash, ...content }, null, 2);
  const v1 = parseModel(v1Text);
  assert(v1.ok, 'version 1 parses');
  assert(await verifyModelHash(v1.model), 'and verifies');
  assertEquals(await coreModelHash(v1.model), await coreModelHash(v2), 'the same architecture across versions');
  assert(await sameDesign(v1.model, v2), 'version 1 says nothing about configuration, so architecture decides');
  assertEquals(diffAnchors(v1.model, v2).identical, true, 'and the diff shows no change');
});

Deno.test('AD.2a: parse refuses an unknown version and a body of the wrong shape', () => {
  const base = { generatedBy: 'nodespec', modelHash: 'x', nodes: [], edges: [], contracts: [], artifacts: [] };
  // AG.13: version 3 (version 2 without ports) parses; the next is unknown.
  assertEquals(parseModel(JSON.stringify({ ...base, modelVersion: 4 })).ok, false);
  assertEquals(parseModel(JSON.stringify({ ...base, modelVersion: 2, nodes: [{ id: N1, type: 't', label: 'l', ports: [], config: 'x' }] })).ok, false);
  assertEquals(parseModel(JSON.stringify({ ...base, modelVersion: 2, contracts: [{ id: C1, kind: 'k', name: 'n', schema: [] }] })).ok, false);
});

Deno.test('AD.2a: an adopt carries configuration and schemas, never a withheld placeholder', async () => {
  const m = await anchorOf(graph({ region: 'eu-west-1', dbPassword: 'hunter2' }, { type: 'object', properties: { token: { type: 'string', default: GH_TOKEN } } }));
  const patches = anchorToPatches(m, 'git-adopt');
  const node = patches.find((p) => p.type === 'add_node' && p.payload.id === N1)!;
  assertEquals(node.payload.metadata, { config: { region: 'eu-west-1' }, configSource: 'manual' });
  const contract = patches.find((p) => p.type === 'add_contract')!;
  assertEquals(contract.payload.schema, { type: 'object', properties: { token: { type: 'string' } } });
  assert(!JSON.stringify(patches).includes(WITHHELD));
});

// ── task docs are committed too ─────────────────────────────────────────

const catalogs: TaskDocumentInput['catalogs'] = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };

Deno.test('AD.2a (I12): a task doc names a credential in the configuration and a schema, and never writes it', () => {
  const g = graph({ region: 'eu-west-1', dbPassword: 'hunter2' }, { type: 'object', properties: { token: { type: 'string', example: GH_TOKEN } } });
  const doc = generateTaskDocument({ node: g.nodes[N1], graph: g, catalogs, requirements: [] });
  assert(doc.includes('**region:** eu-west-1'), 'ordinary configuration is written');
  assert(doc.includes('**dbPassword:** kept out of git because it looks like a credential; ask the user for it'));
  assert(!doc.includes('hunter2') && !doc.includes(GH_TOKEN), 'no credential in the document');
});

Deno.test('AD.2a: a task doc goes stale only when its configuration holds a credential', () => {
  const plain = graph({ region: 'eu-west-1' });
  const secret = graph({ region: 'eu-west-1', dbPassword: 'hunter2' });
  const secret2 = graph({ region: 'eu-west-1', dbPassword: 'hunter3' });
  const fp = (g: any) => computeTaskContextFingerprint(g.nodes[N1], g).fingerprint;
  assert(fp(plain) !== fp(secret), 'adding a field still moves it');
  assertEquals(fp(secret), fp(secret2), 'a credential\'s value is not in the fingerprint, as it is not in the document');
});

// ── the push names what it withheld ─────────────────────────────────────

Deno.test('AD.2a wiring: the push writes the anchor with its report and names the withheld values', () => {
  const push = Deno.readTextFileSync(new URL('../git-push/index.ts', import.meta.url));
  assert(/const anchorWrite = await serializeModelWithReport\(graph\);\s*files\.push\(\{ path: MODEL_ANCHOR_PATH, content: anchorWrite\.text \}\)/.test(push));
  assert(/const withheld: WithheldValue\[\] = plan\.write\.some\(\(f\) => f\.path === MODEL_ANCHOR_PATH\) \? anchorWrite\.withheld : \[\]/.test(push), 'only when model.json is written');
  assertEquals((push.match(/\.\.\.\(withheld\.length \? \{ withheld \} : \{\}\)/g) ?? []).length, 2, 'in the log and the result');
  for (const f of ['../git-push/index.ts', '../save-git-integration/index.ts', '../_shared/git-drift.ts']) {
    const src = Deno.readTextFileSync(new URL(f, import.meta.url));
    assert(!/coreModelHash\(/.test(src), `${f} compares whole designs, never architecture alone`);
  }
});
