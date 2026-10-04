// AL.2 (owner 2026-10-01): Proposals must name the agent that filed a card.
// An OAuth agent was named by its client id, a random UUID. Registration now
// mints "<slug of the client's own name>.<uuid>", and every label reads the
// name back out of the id; a metadata-document client is named by its host;
// an id minted before keeps its eight-character prefix.
import { handleClientRegistration } from '../mcp-server/oauth.ts';
import { credentialLabel, credentialOf } from '../mcp-server/shared.ts';
import { clientSlug, oauthClientId, oauthClientKnownName, oauthClientName } from '../_shared/oauth-client.ts';
import { assert, assertEquals } from './helpers.ts';

const register = (body: unknown) => handleClientRegistration(new Request('http://mcp.test/register', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

Deno.test('registration mints an id that carries the client\'s own name, and answers it', async () => {
  const res = await register({ client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:33418/callback'] });
  assertEquals(res.status, 201);
  const out = await res.json() as { client_id: string; client_name: string };
  assertEquals(out.client_name, 'Claude Code');
  assert(/^claude-code\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(out.client_id), out.client_id);
  assertEquals(oauthClientName(out.client_id), 'claude-code');
});

Deno.test('a client with no usable name, or the generic default, gets a bare UUID id', async () => {
  for (const body of [{}, { client_name: '   ' }, { client_name: 'MCP Client' }, { client_name: '!!!' }]) {
    const out = await (await register(body)).json() as { client_id: string };
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(out.client_id), `${JSON.stringify(body)} -> ${out.client_id}`);
  }
});

Deno.test('the slug: lower case, one dash per run, at most 32 characters, no dash at either end', () => {
  assertEquals(clientSlug('Codex CLI (OpenAI)'), 'codex-cli-openai');
  assertEquals(clientSlug('  --Gemini__CLI--  '), 'gemini-cli');
  assertEquals(clientSlug('A'.repeat(40)), 'a'.repeat(32));
  assertEquals(clientSlug(`${'abc '.repeat(8)}xyz`).length <= 32, true);
  assert(!clientSlug(`${'abc '.repeat(8)}xyz`).endsWith('-'));
  assertEquals(oauthClientId('Cursor', '4b1c2e9a-1111-4222-8333-444444444444'), 'cursor.4b1c2e9a-1111-4222-8333-444444444444');
});

Deno.test('labels: a minted id by its name, a metadata URL by its host, an older id by its prefix', () => {
  const minted = 'claude-code.4b1c2e9a-1111-4222-8333-444444444444';
  assertEquals(oauthClientKnownName(minted), 'claude-code');
  assertEquals(oauthClientKnownName('https://claude.ai/oauth/mcp-oauth-client-metadata'), 'claude.ai');
  assertEquals(oauthClientKnownName('4b1c2e9a-1111-4222-8333-444444444444'), null);
  assertEquals(oauthClientName('4b1c2e9a-1111-4222-8333-444444444444'), '4b1c2e9a');
  assertEquals(credentialLabel(`oauth:user-1:${minted}`), 'oauth · claude-code');
  assertEquals(credentialOf({ userId: 'user-1', clientId: minted, authMethod: 'oauth_token' }).label, 'oauth · claude-code');
  assertEquals(credentialOf({ userId: 'user-1', clientId: '4b1c2e9a-1111-4222-8333-444444444444', authMethod: 'oauth_token' }).label, 'oauth · 4b1c2e9a');
  // a bare account id is no name
  assertEquals(credentialLabel('b0000000-0000-4000-8000-000000000001'), null);
});
