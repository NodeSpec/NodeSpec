// V3 AD.0 (owner 2026-09-24): who may act on a git integration, and what a
// webhook delivery must prove. Findings S1 (git-push and git-pull acted on any
// integration id for any signed-in user), S2 (the webhook accepted every
// delivery) and D9 (git-pull's default mode moved the baseline, loading
// nothing). Behaviour where the code is importable; the two Deno.serve entry
// points are pinned by order (the check runs before the token is decrypted).
import { gitPullModeAccess, mayUseIntegration } from '../_shared/git-access.ts';
import {
  newWebhookSecret,
  readWebhookSecret,
  timingSafeEqual,
  webhookRepoMatches,
  webhookSecretToKeep,
} from '../_shared/webhook-secret.ts';
import { encryptV2 } from '../_shared/crypto.ts';
import { FakeSupabase, assert, assertEquals, scriptSeatOwner } from './helpers.ts';

const PROJECT = 'proj-1';
const OWNER = 'user-owner';
const OTHER = 'user-other';

function db(role: string | null, ownerId = OWNER) {
  const fake = new FakeSupabase();
  fake.script('projects', 'select', { data: { owner_id: ownerId } });
  fake.script('project_members', 'select', { data: role ? { role, projects: { owner_id: ownerId } } : null });
  if (role) scriptSeatOwner(fake, ownerId); // seats are Team and above
  return fake;
}

// ── git-pull modes ─────────────────────────────────────────────────────────

Deno.test('AD.0: every git-pull mode names what it needs, and a missing mode is refused', () => {
  for (const m of ['tree-scan', 'selective-fetch']) assertEquals(gitPullModeAccess(m), 'read', m);
  assertEquals(gitPullModeAccess('content-fetch'), null, 'AD.4 retired content-fetch');
  for (const m of ['drift-check', 'restore-model', 'restore-spec', 'apply-criteria', 'resolve-change', 'proposal-baseline']) assertEquals(gitPullModeAccess(m), 'write', m);
  assertEquals(gitPullModeAccess(undefined), null, 'no default mode');
  assertEquals(gitPullModeAccess(''), null);
  assertEquals(gitPullModeAccess('push'), null);
  assertEquals(gitPullModeAccess('adopt-baseline'), null, 'AD.1d renamed it proposal-baseline');
  assertEquals(gitPullModeAccess('constructor'), null, 'a prototype key is not a mode');
});

// ── who may use an integration ─────────────────────────────────────────────

Deno.test('AD.0: the owner reads and writes', async () => {
  assert(await mayUseIntegration(db(null), { integrationProjectId: PROJECT, userId: OWNER, access: 'write' }));
  assert(await mayUseIntegration(db(null), { integrationProjectId: PROJECT, userId: OWNER, access: 'read' }));
});

Deno.test('AD.0: a contributor writes; a viewer reads but never writes', async () => {
  assert(await mayUseIntegration(db('contributor'), { integrationProjectId: PROJECT, userId: OTHER, access: 'write' }));
  assert(await mayUseIntegration(db('maintainer'), { integrationProjectId: PROJECT, userId: OTHER, access: 'write' }));
  assert(await mayUseIntegration(db('viewer'), { integrationProjectId: PROJECT, userId: OTHER, access: 'read' }));
  assertEquals(await mayUseIntegration(db('viewer'), { integrationProjectId: PROJECT, userId: OTHER, access: 'write' }), false);
});

// Owner 2026-09-27: the repository connection is the owner's or a
// maintainer's to manage (save-git-integration asks for "manage").
Deno.test('Audit: the owner and a maintainer manage the repository; a contributor, a viewer and a stranger do not', async () => {
  const manage = (role: string | null, userId = OTHER) =>
    mayUseIntegration(db(role), { integrationProjectId: PROJECT, userId, access: 'manage' });
  assert(await manage(null, OWNER), 'the owner');
  assert(await manage('maintainer'), 'a maintainer');
  assertEquals(await manage('contributor'), false, 'a contributor pushes but does not connect');
  assertEquals(await manage('viewer'), false);
  assertEquals(await manage(null), false, 'a stranger');
});

Deno.test('Audit: a maintainer seat on a project whose owner is below Team manages nothing (decision 1)', async () => {
  const fake = new FakeSupabase();
  fake.script('projects', 'select', { data: { owner_id: OWNER } });
  fake.script('project_members', 'select', { data: { role: 'maintainer', projects: { owner_id: OWNER } } });
  scriptSeatOwner(fake, OWNER, 'indie');
  assertEquals(await mayUseIntegration(fake, { integrationProjectId: PROJECT, userId: OTHER, access: 'manage' }), false);
});

Deno.test('AD.0 (S1): a signed-in stranger holding the id gets nothing', async () => {
  assertEquals(await mayUseIntegration(db(null), { integrationProjectId: PROJECT, userId: OTHER, access: 'read' }), false);
  assertEquals(await mayUseIntegration(db(null), { integrationProjectId: PROJECT, userId: OTHER, access: 'write' }), false);
});

Deno.test('AD.0 (S1): an integration from another project is refused before any read', async () => {
  const fake = db(null);
  const ok = await mayUseIntegration(fake, {
    integrationProjectId: 'proj-other', requestedProjectId: PROJECT, userId: OWNER, access: 'write',
  });
  assertEquals(ok, false);
  assertEquals(fake.calls.length, 0, 'decided on the ids alone');
});

Deno.test('AD.0: an unknown project or a missing user is refused', async () => {
  const none = new FakeSupabase();
  none.script('projects', 'select', { data: null });
  assertEquals(await mayUseIntegration(none, { integrationProjectId: PROJECT, userId: OWNER, access: 'read' }), false);
  assertEquals(await mayUseIntegration(db(null), { integrationProjectId: PROJECT, userId: '', access: 'read' }), false);
});

// ── the entry points check before they decrypt ─────────────────────────────

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test('AD.0 (S1): git-push checks the caller before it decrypts the token, and refuses as not found', () => {
  const push = src('../git-push/index.ts');
  const check = push.indexOf('mayUseIntegration(serviceClient');
  assert(check > 0, 'git-push calls the access check');
  assert(check < push.indexOf('decryptWithUpgrade(token)'), 'before the token is decrypted');
  assert(/requestedProjectId: projectId/.test(push), 'the integration must be the named project\'s');
  assert(/access: "write"/.test(push), 'every git-push action writes');
  assert(/INTEGRATION_NOT_FOUND[\s\S]{0,80}status: 404/.test(push), 'a refusal reads as an unknown id');
  assert(/select\("id, project_id, provider/.test(push), 'the project id is read to check it');
});

Deno.test('AD.0 (S1, D9): git-pull needs a mode and checks access by it before decrypting; AD.4 retired content-fetch', () => {
  const pull = src('../git-pull/index.ts');
  assert(!/mode \|\| 'content-fetch'/.test(pull), 'no default mode');
  assert(/const access = gitPullModeAccess\(mode\);[\s\S]{0,120}if \(!access\)/.test(pull), 'an unknown or missing mode is refused');
  const resolver = pull.slice(pull.indexOf('async function resolveIntegrationAndToken('), pull.indexOf('Deno.serve('));
  assert(resolver.indexOf('mayUseIntegration(') > 0, 'the resolver checks access');
  assert(resolver.indexOf('mayUseIntegration(') < resolver.indexOf('decryptWithUpgrade(token)'), 'before the token is decrypted');
  for (const gone of ['handleContentFetch', 'pullFromGitHub', 'pullFromGitLab', "'content-fetch'"]) assert(!pull.includes(gone), `${gone} retired`);
  assert(!Deno.readTextFileSync(new URL('../../../src/ui/services/GitService.ts', import.meta.url)).includes("'content-fetch'"), 'the app never asks for it');
});

// ── the webhook secret ─────────────────────────────────────────────────────

Deno.test('AD.0 (S2): a new secret is 64 hex characters and never repeats', () => {
  const a = newWebhookSecret();
  const b = newWebhookSecret();
  assert(/^[0-9a-f]{64}$/.test(a), a);
  assert(a !== b);
});

Deno.test('AD.0 (S2): a save keeps the secret for the same repository and makes a new one otherwise', () => {
  assertEquals(webhookSecretToKeep('kept', false), 'kept');
  assertEquals(webhookSecretToKeep('kept', true), null, 'a different repository gets a new secret');
  assertEquals(webhookSecretToKeep(null, false), null, 'none on file: make one');
});

Deno.test('AD.0 (S2): the stored secret reads back from its envelope; nothing or garbage reads as none', async () => {
  const prior = Deno.env.get('ENCRYPTION_SECRET');
  Deno.env.set('ENCRYPTION_SECRET', 'ad0-test-encryption-secret-0123456789');
  try {
    const plain = newWebhookSecret();
    const stored = await encryptV2(plain, 'ad0-test-encryption-secret-0123456789');
    assertEquals(await readWebhookSecret(stored), plain);
    const wrongKey = await encryptV2(plain, 'another-key-entirely-9876543210');
    assertEquals(await readWebhookSecret(wrongKey), null, 'an unreadable envelope verifies nothing');
  } finally {
    if (prior === undefined) Deno.env.delete('ENCRYPTION_SECRET'); else Deno.env.set('ENCRYPTION_SECRET', prior);
  }
  assertEquals(await readWebhookSecret(null), null);
  assertEquals(await readWebhookSecret('  '), null);
  assertEquals(await readWebhookSecret('set-by-hand'), 'set-by-hand', 'a plain value is taken as written');
});

Deno.test('AD.0 (S2): the comparison is exact', () => {
  assert(timingSafeEqual('abc', 'abc'));
  assertEquals(timingSafeEqual('abc', 'abd'), false);
  assertEquals(timingSafeEqual('abc', 'abcd'), false);
  assertEquals(timingSafeEqual('', 'a'), false);
});

Deno.test('AD.0 (S2): a delivery must name the integration\'s repository', () => {
  assert(webhookRepoMatches('github', { repository: { full_name: 'Acme/Store' } }, 'acme', 'store'), 'case does not matter');
  assertEquals(webhookRepoMatches('github', { repository: { full_name: 'acme/other' } }, 'acme', 'store'), false);
  assertEquals(webhookRepoMatches('github', {}, 'acme', 'store'), false, 'naming none is refused');
  assert(webhookRepoMatches('gitlab', { project: { path_with_namespace: 'group/sub/store' } }, 'group/sub', 'store'));
  assertEquals(webhookRepoMatches('gitlab', { repository: { full_name: 'group/sub/store' } }, 'group/sub', 'store'), false,
    'GitLab names the project, not a repository');
  assertEquals(webhookRepoMatches('github', { repository: { full_name: 'acme/store' } }, null, 'store'), false);
});

Deno.test('AD.0 (S2): save-git-integration stores the secret encrypted and returns it with the integration id', () => {
  const save = src('../save-git-integration/index.ts');
  assert(/webhookSecretToKeep\(await readWebhookSecret\(existing\?\.webhook_secret\), bindingChanged\)/.test(save));
  assert(/const encryptedWebhookSecret = await encrypt\(webhookSecret\)/.test(save));
  assertEquals((save.match(/webhook_secret: encryptedWebhookSecret/g) ?? []).length, 2, 'written on update and on insert');
  assert(/const webhook = \{ integrationId, secret: webhookSecret, created: keptSecret === null \}/.test(save));
  assert(/renameReason: primaryRename\.reason \} : null, webhook \}/.test(save), 'returned on its own key');
});
